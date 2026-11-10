/** Builds the preloaded catalogue of a region from OpenStreetMap.
 *
 *  Run once, offline, and the result ships inside the application. Usage:
 *
 *      npm run catalogue -- sierras-de-cordoba
 *
 *  The application used to be installed with four trails written out by
 *  hand, which is not a catalogue. This asks OpenStreetMap for the named
 *  paths of the region, joins the fragments each one arrives in, throws
 *  away what is not a walk, and gives every point a height from the same
 *  terrain data the contours came from, because OpenStreetMap carries
 *  none and without it there is no profile and no difficulty.
 *
 *  The attributes are then computed by the very domain code the
 *  application runs, so a trail that shipped with the install is measured
 *  exactly like one somebody imports from a file.
 *
 *  The data is OpenStreetMap's, under the Open Database Licence, which
 *  requires attribution and travels with anything derived from it. The
 *  notice is written beside the output and shown in the application.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { computeAttributes } from '../../../src/domain/trail';
import type { Point } from '../../../src/domain/types';
import { uuidFromHex } from '../../../src/domain/identity';
import { cacheDir, TerrainSampler } from '../tiles/terrain';
import { joinByName, lengthOf, worthWalking, type OsmWay } from './osm';

/**
 * Overpass servers, tried in turn and then again after a wait.
 *
 * They answer with a gateway timeout whenever they are busy, which is
 * often, and trying another one is the documented answer rather than a
 * workaround. Only servers carrying the whole planet are listed: a
 * national mirror answers a query about Argentina perfectly happily, with
 * nothing in it.
 */
const OVERPASS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/** How many times to go round the list before giving up. */
const ROUNDS = 4;

/**
 * Which ways are asked for.
 *
 * `path` and `track` are the rural ones. `footway` is pavement and brings
 * in town squares and pedestrian crossings, which is most of what made an
 * earlier attempt at this unusable.
 */
const QUERY = (b: Bounds) => `[out:json][timeout:180];
(
  way["highway"~"^(path|track)$"]["name"](${b.south},${b.west},${b.north},${b.east});
  relation["route"="hiking"](${b.south},${b.west},${b.north},${b.east});
);
out geom;`;

interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface RegionDefinition {
  id: string;
  name: string;
  bounds: Bounds;
}

interface OverpassElement {
  type: 'way' | 'relation' | 'node';
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
}

/** One trail of the generated catalogue. */
interface CatalogueTrail {
  id: string;
  name: string;
  description: string;
  /** Where it came from, so a regenerated catalogue can be compared. */
  osm: number[];
  points: Point[];
}

// ------------------------------------------------------------- fetching --

async function askOverpass(bounds: Bounds): Promise<OverpassElement[]> {
  const body = new URLSearchParams({ data: QUERY(bounds) });

  for (let round = 0; round < ROUNDS; round++) {
    for (const host of OVERPASS) {
      try {
        const response = await fetch(host, {
          method: 'POST',
          body,
          headers: { 'user-agent': 'TrekkApp/0.1 (trabajo final de grado)' },
        });
        if (!response.ok) {
          console.log(`  ${host} answered ${response.status}`);
          continue;
        }
        const json = (await response.json()) as { elements: OverpassElement[] };
        console.log(`  ${host} answered with ${json.elements.length} elements`);
        // An empty answer from a server that is working means a mirror
        // that does not hold this part of the world, so the next one is
        // asked rather than the region being declared empty.
        if (json.elements.length > 0) return json.elements;
      } catch (error) {
        console.log(`  ${host} did not answer (${String(error)})`);
      }
    }

    if (round < ROUNDS - 1) {
      const wait = 15 * 2 ** round;
      console.log(`  every server was busy, waiting ${wait} s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }

  throw new Error('No Overpass server answered with anything. Try again in a few minutes.');
}

/**
 * Flattens what Overpass returned into plain ways.
 *
 * A hiking relation is a list of ways with their geometry inline, so its
 * members become ways carrying the relation's name. That is what lets a
 * formally tagged route and a set of individually named paths go through
 * exactly the same joining.
 */
function asWays(elements: OverpassElement[]): OsmWay[] {
  const ways: OsmWay[] = [];

  for (const element of elements) {
    if (element.type === 'way' && element.geometry) {
      ways.push({ id: element.id, tags: element.tags ?? {}, geometry: element.geometry });
    }

    if (element.type === 'relation' && element.members) {
      const name = element.tags?.['name'];
      if (!name) continue;
      element.members
        .filter((m) => m.type === 'way' && m.geometry && m.role !== 'backward')
        .forEach((m, i) => {
          ways.push({
            id: element.id * 1000 + i,
            tags: { ...element.tags, name },
            geometry: m.geometry!,
          });
        });
    }
  }

  return ways;
}

// ------------------------------------------------------------ identities --

/**
 * A stable identifier, derived from the ways the trail was built from.
 *
 * Derived and not random, so regenerating the catalogue updates the trails
 * instead of filling the device with second copies of each one. The server
 * identifies trails by UUID, so the hash is folded into that shape.
 */
function identify(sources: number[]): string {
  const seed = `openstreetmap:${[...sources].sort((a, b) => a - b).join(',')}`;
  return uuidFromHex(createHash('sha256').update(seed).digest('hex').slice(0, 32));
}

// -------------------------------------------------------------- the run --

async function run(): Promise<void> {
  const wanted = process.argv[2];
  const tilesDir = process.env['TILES_DIR'];
  if (!wanted || !tilesDir) {
    console.error('Usage: TILES_DIR=… npm run catalogue -- <region-id>');
    process.exit(1);
  }

  const catalogue = join(tilesDir, '..', 'regions.json');
  if (!existsSync(catalogue)) {
    console.error(`No region catalogue at ${catalogue}`);
    process.exit(1);
  }

  const regions = JSON.parse(readFileSync(catalogue, 'utf8')).regions as RegionDefinition[];
  const region = regions.find((r) => r.id === wanted);
  if (!region) {
    console.error(`Unknown region ${wanted}`);
    process.exit(1);
  }

  console.log(`Catalogue for ${region.name}`);

  const elements = await askOverpass(region.bounds);
  const ways = asWays(elements);
  console.log(`  ${ways.length} named ways and route members`);

  const joined = joinByName(ways);
  console.log(`  joined into ${joined.length} paths`);

  const keep = joined.filter(worthWalking).sort((a, b) => lengthOf(b.points) - lengthOf(a.points));
  console.log(`  ${keep.length} of them are walks`);

  // The heights, one path at a time, from the tiles the contours already
  // downloaded. A path with no height anywhere is dropped: without it
  // there is no profile, no ascent and no difficulty, which is most of
  // what the catalogue is for.
  const sampler = new TerrainSampler(cacheDir(tilesDir));
  const trails: CatalogueTrail[] = [];

  for (const path of keep) {
    const points: Point[] = [];
    for (const p of path.points) {
      const ele = await sampler.heightAt(p.lat, p.lon);
      points.push(ele === null ? p : { ...p, ele: Math.round(ele) });
    }
    if (!points.some((p) => typeof p.ele === 'number')) continue;

    trails.push({
      id: identify(path.sources),
      name: path.name,
      // No prose. The trail is described by its figures and its profile,
      // which the application draws, and not by a paragraph under them.
      description: '',
      osm: path.sources,
      points,
    });
    process.stdout.write(`\r  heights for ${trails.length} of ${keep.length}`);
  }
  process.stdout.write('\n');

  // A catalogue of almost nothing means the query failed in some way that
  // still returned, and overwriting a good file with it would be worse
  // than failing. Caught here rather than discovered on a phone.
  if (trails.length < 5) {
    console.error(`Only ${trails.length} trails came out of this. Nothing was written.`);
    process.exit(1);
  }

  const file = join(__dirname, '..', '..', '..', 'src', 'startup', 'catalogue.json');
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        region: region.id,
        generated: new Date().toISOString().slice(0, 10),
        attribution: 'Trazados © colaboradores de OpenStreetMap, bajo licencia ODbL.',
        trails,
      },
      null,
      1,
    )}\n`,
  );

  const summary = trails
    .slice(0, 10)
    .map((t) => {
      const a = computeAttributes(t.points);
      return `    ${t.name.slice(0, 40).padEnd(42)} ${(a.distanceM / 1000).toFixed(1)} km  ${Math.round(a.elevationGainM)} m  ${a.difficulty}`;
    })
    .join('\n');

  console.log(`  wrote ${trails.length} trails to ${file}`);
  console.log(summary);

  // The catalogue is of no use to the server until it holds these trails
  // too. A report cites a trail and a forecast is cached against one, and
  // the server refuses both for a trail it does not know, so a catalogue
  // that ships without being seeded gives the phone trails whose weather
  // and reports cannot work.
  console.log('\n  now run: npm run seed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
