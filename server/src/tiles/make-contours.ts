/** Builds the contour archive for a region.
 *
 *  Run once per region, offline, and the result is served as a second
 *  vector source beside the basemap. Usage:
 *
 *      npm run contours -- sierras-de-cordoba
 *
 *  The elevation comes from the public terrain tiles of the AWS Open Data
 *  registry, which need no account, are derived from SRTM and NASADEM
 *  among others, and are published under their original terms. The heights
 *  arrive encoded in the colour channels of a PNG, which is why this reads
 *  images rather than a terrain format.
 *
 *  Nothing here is on the hot path. It is slow, it downloads tens of
 *  megabytes, and it runs on a laptop with a connection, which is exactly
 *  the opposite of the conditions the output is used under.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';

import geojsonvt from 'geojson-vt';
import { PNG } from 'pngjs';
import vtpbf from 'vt-pbf';

import { buildContours, isIndex, longEnough, toGeographic, type HeightGrid } from './contours';

/** Where the heights come from. Public, no credentials, no rate limit. */
const TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

/**
 * Zoom the elevation is read at.
 *
 * At thirteen a sample is about twenty metres on the ground at this
 * latitude, which is what a twenty five metre contour needs to look like
 * terrain rather than noise. Each step down halves the detail and quarters
 * the download.
 */
const SOURCE_ZOOM = 13;

/** Metres between contours, and how often one is drawn heavier and labelled. */
const INTERVAL = 25;
const INDEX_EVERY = 4; // so every 100 m

/** Zooms the contour archive itself is written at. */
const MIN_ZOOM = 11;
const MAX_ZOOM = 14;

interface RegionDefinition {
  id: string;
  name: string;
  bounds: { west: number; south: number; east: number; north: number };
}

// ------------------------------------------------------------- the grid --

const lonToX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;

function latToY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

const xToLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;

function yToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Where downloaded terrain tiles are kept between runs.
 *
 * A region is the better part of a thousand tiles, and changing the
 * contour interval or fixing the tracing means running this again. Without
 * a cache every such run downloads the same tens of megabytes of ground
 * that has not moved. Safe to delete at any time.
 */
const cacheDir = (tilesDir: string) => join(tilesDir, '..', 'cache', 'terrarium');

/** Fetches one terrain tile, retrying, because this makes hundreds of them. */
async function fetchTile(
  cache: string,
  z: number,
  x: number,
  y: number,
): Promise<Buffer | null> {
  const path = join(cache, String(z), String(x), `${y}.png`);
  if (existsSync(path)) return readFileSync(path);

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(`${TERRAIN}/${z}/${x}/${y}.png`);
      // Outside the coverage of the dataset, which over the ocean is normal.
      if (response.status === 404 || response.status === 403) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const body = Buffer.from(await response.arrayBuffer());
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body);
      return body;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  return null;
}

/**
 * Downloads the elevation covering a region into one grid.
 *
 * One grid rather than one per tile, because a contour that crosses a tile
 * boundary has to be a single line. Stitching them afterwards is harder
 * than holding the whole region in memory, and for a region this size the
 * memory is a few hundred megabytes on a laptop.
 */
async function loadGrid(region: RegionDefinition, cache: string): Promise<HeightGrid> {
  const z = SOURCE_ZOOM;
  const x0 = Math.floor(lonToX(region.bounds.west, z));
  const x1 = Math.floor(lonToX(region.bounds.east, z));
  const y0 = Math.floor(latToY(region.bounds.north, z));
  const y1 = Math.floor(latToY(region.bounds.south, z));

  const across = x1 - x0 + 1;
  const down = y1 - y0 + 1;
  const width = across * 256;
  const height = down * 256;
  const values = new Int16Array(width * height).fill(-32768);

  const total = across * down;
  console.log(`  elevation: ${total} tiles at zoom ${z} (${width} by ${height} samples)`);

  let done = 0;
  // Downloaded a row at a time, in parallel within the row. Enough to keep
  // the connection busy without opening hundreds of sockets at once.
  for (let ty = y0; ty <= y1; ty++) {
    const row = await Promise.all(
      Array.from({ length: across }, (_, i) => fetchTile(cache, z, x0 + i, ty)),
    );

    row.forEach((png, i) => {
      done++;
      if (!png) return;
      const image = PNG.sync.read(png);
      const offsetX = i * 256;
      const offsetY = (ty - y0) * 256;

      for (let py = 0; py < 256; py++) {
        for (let px = 0; px < 256; px++) {
          const p = (py * image.width + px) * 4;
          // Terrarium encoding: the height in metres, offset so that it is
          // never negative, spread across the three colour channels.
          const metres =
            image.data[p]! * 256 + image.data[p + 1]! + image.data[p + 2]! / 256 - 32768;
          values[(offsetY + py) * width + offsetX + px] = Math.round(metres);
        }
      }
    });

    process.stdout.write(`\r  downloaded ${done} of ${total}`);
  }
  process.stdout.write('\n');

  return {
    width,
    height,
    values,
    bounds: {
      west: xToLon(x0, z),
      east: xToLon(x1 + 1, z),
      north: yToLat(y0, z),
      south: yToLat(y1 + 1, z),
    },
  };
}

// ----------------------------------------------------------- the archive --

/** Writes the lines out as an MBTiles archive of vector tiles. */
function writeArchive(path: string, region: RegionDefinition, features: GeoJSON.Feature[]): void {
  mkdirSync(dirname(path), { recursive: true });
  rmSync(path, { force: true });

  const tiles = new geojsonvt(
    { type: 'FeatureCollection', features } as GeoJSON.FeatureCollection,
    {
      maxZoom: MAX_ZOOM,
      indexMaxZoom: MAX_ZOOM,
      tolerance: 3,
      extent: 4096,
      buffer: 64,
    },
  );

  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE metadata (name TEXT, value TEXT);
    CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
    CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
  `);

  const insert = db.prepare('INSERT INTO tiles VALUES (?, ?, ?, ?)');
  let written = 0;

  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
    const x0 = Math.floor(lonToX(region.bounds.west, z));
    const x1 = Math.floor(lonToX(region.bounds.east, z));
    const y0 = Math.floor(latToY(region.bounds.north, z));
    const y1 = Math.floor(latToY(region.bounds.south, z));

    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const tile = tiles.getTile(z, x, y);
        if (!tile) continue;

        // Clipping a line to a tile can leave a piece with a single point
        // in it, at a corner the line only grazes. The renderer refuses it
        // and says so as "invalid geometry in line layer", naming neither
        // the tile nor the line, so it is easier to never write one.
        const features = tile.features
          .map((f) => ({
            ...f,
            geometry: (f.geometry as [number, number][][]).filter((part) => part.length >= 2),
          }))
          .filter((f) => f.geometry.length > 0);

        if (features.length === 0) continue;

        const buffer = gzipSync(
          vtpbf.fromGeojsonVt({ contours: { features } }, { version: 2 }),
        );
        // MBTiles counts rows from the bottom and every map client counts
        // them from the top. The same flip the basemap archive needs.
        insert.run(z, x, 2 ** z - 1 - y, buffer);
        written++;
      }
    }
  }

  const meta = db.prepare('INSERT INTO metadata VALUES (?, ?)');
  const { west, south, east, north } = region.bounds;
  for (const [name, value] of [
    ['name', `${region.name} contours`],
    ['format', 'pbf'],
    ['type', 'overlay'],
    ['version', '1'],
    ['minzoom', String(MIN_ZOOM)],
    ['maxzoom', String(MAX_ZOOM)],
    ['bounds', `${west},${south},${east},${north}`],
    ['description', `Curvas de nivel cada ${INTERVAL} m`],
    [
      'json',
      JSON.stringify({
        vector_layers: [
          {
            id: 'contours',
            fields: { ele: 'Number', index: 'Boolean' },
            minzoom: MIN_ZOOM,
            maxzoom: MAX_ZOOM,
          },
        ],
      }),
    ],
  ]) {
    meta.run(name, value);
  }

  db.close();
  console.log(`  wrote ${written} tiles to ${path}`);
}

// -------------------------------------------------------------- the run --

async function run(): Promise<void> {
  const wanted = process.argv[2];
  if (!wanted) {
    console.error('Usage: npm run contours -- <region-id>');
    process.exit(1);
  }

  const tilesDir = process.env['TILES_DIR'];
  if (!tilesDir) {
    console.error('TILES_DIR is not set. It says where the archives live.');
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
    console.error(`Unknown region ${wanted}. Known: ${regions.map((r) => r.id).join(', ')}`);
    process.exit(1);
  }

  console.log(`Contours for ${region.name}, every ${INTERVAL} m`);

  const grid = await loadGrid(region, cacheDir(tilesDir));

  console.log('  tracing');
  const lines = longEnough(buildContours(grid, INTERVAL));

  const features: GeoJSON.Feature[] = lines
    .map((line) => ({ elevation: line.elevation, points: toGeographic(line.points, grid) }))
    // Checked after projecting and not before. Rounding the coordinates
    // collapses points that were distinct on the grid, so a line long
    // enough in grid space can come out of here with one point in it, and
    // a line of one point is geometry the renderer refuses.
    .filter((line) => line.points.length >= 2)
    .map((line) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: line.points },
      properties: {
        ele: line.elevation,
        // Resolved here rather than in the style, so the rule lives next to
        // the interval it depends on and the phone does no arithmetic.
        index: isIndex(line.elevation, INTERVAL, INDEX_EVERY),
      },
    }));

  const indexed = features.filter((f) => f.properties!['index']).length;
  console.log(`  ${features.length} lines, ${indexed} of them labelled`);

  const path = join(tilesDir, `${region.id}-contours.mbtiles`);
  writeArchive(path, region, features);

  // A note beside the archive, because the licence of the elevation data
  // travels with what is derived from it.
  writeFileSync(
    join(tilesDir, `${region.id}-contours.txt`),
    [
      `Curvas de nivel cada ${INTERVAL} m, una marcada cada ${INTERVAL * INDEX_EVERY} m.`,
      `Generadas el ${new Date().toISOString().slice(0, 10)} a partir de los`,
      'Terrain Tiles del AWS Open Data Registry, derivados de SRTM y NASADEM.',
      '',
      `Zoom de origen ${SOURCE_ZOOM}, archivo de zoom ${MIN_ZOOM} a ${MAX_ZOOM}.`,
    ].join('\n'),
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
