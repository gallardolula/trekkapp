/** Turning the paths OpenStreetMap knows into trails somebody can walk.
 *
 *  OpenStreetMap does not hold trails. It holds ways, which are whatever
 *  length of path a contributor happened to draw in one go, so a single
 *  sendero arrives as two or five fragments that share a name and touch at
 *  their ends. Reading them straight into a catalogue gives three entries
 *  called "trekking Huertas Malas", none of which is the walk.
 *
 *  What is here is the joining and the filtering. Fetching, elevation and
 *  writing live in make-catalogue.ts, so the decisions about what counts as
 *  a trail can be tested without a network.
 */
import { haversineDistance } from '../../../src/domain/geo';
import type { Point } from '../../../src/domain/types';

/** One way as Overpass returns it, with its geometry inline. */
export interface OsmWay {
  id: number;
  tags: Record<string, string>;
  geometry: { lat: number; lon: number }[];
}

export interface JoinedPath {
  /** The ways this was built from, in the order they were joined. */
  sources: number[];
  name: string;
  tags: Record<string, string>;
  points: Point[];
}

/** How close two ends have to be to be the same place on the ground. */
const JOIN_TOLERANCE_M = 40;

/** Below this it is a connector, a bridge or a driveway, not an outing. */
export const MIN_LENGTH_M = 800;

/** Above this it is a long distance route, which is a different product. */
export const MAX_LENGTH_M = 40_000;

/** Names that describe a structure rather than a route somebody walks. */
const A_STRUCTURE = /^(puente|pasarela|escalera|escalinata|rampa|acceso|entrada|salida)\b/i;

/**
 * Names that belong to the road network.
 *
 * A provincial route tagged as a track is still a road, and somebody
 * following it on foot is walking on one. The tagging is not wrong, it
 * just answers a different question than this catalogue asks.
 */
const A_ROAD = /\b(ruta (provincial|nacional)|autopista|autov[ií]a|avenida)\b/i;

/**
 * Names in which a contributor recorded their own doubt.
 *
 * "Sendero supuesto" and "Sendero Supuesto - A Investigar" are both in the
 * real data for this area. Somebody drew a line they were not sure about
 * and said so, and passing that on as a trail to walk would turn an
 * honest note into a claim.
 */
const A_DOUBT = /\b(supuest[oa]|a investigar|aproximad[oa]|sin confirmar|dudoso)\b/i;

/**
 * Joins the fragments of each named path into as few lines as possible.
 *
 * Grouped by name first, because two paths that touch and are called
 * different things are two paths. Within a group the fragments are chained
 * end to end, reversing one where that is what makes the ends meet:
 * nothing orients a way in the direction anybody walks it, and half of
 * them are drawn backwards.
 */
export function joinByName(ways: OsmWay[]): JoinedPath[] {
  const groups = new Map<string, OsmWay[]>();
  for (const way of ways) {
    const name = (way.tags['name'] ?? '').trim();
    if (!name || way.geometry.length < 2) continue;
    const key = name.toLocaleLowerCase('es');
    const bucket = groups.get(key);
    if (bucket) bucket.push(way);
    else groups.set(key, [way]);
  }

  const joined: JoinedPath[] = [];
  for (const group of groups.values()) joined.push(...chain(group));
  return joined;
}

/** Chains what touches, leaving separate lines for what does not. */
function chain(group: OsmWay[]): JoinedPath[] {
  const left = group.map((w) => ({
    way: w,
    points: w.geometry.map((p) => ({ lat: p.lat, lon: p.lon }) as Point),
  }));

  const out: JoinedPath[] = [];

  while (left.length > 0) {
    const first = left.shift()!;
    const line: Point[] = [...first.points];
    const sources = [first.way.id];

    // Grown from both ends until nothing else reaches either of them. A
    // fragment in the middle of a path would otherwise end the chain with
    // half the trail still on the floor.
    let extended = true;
    while (extended) {
      extended = false;
      for (let i = 0; i < left.length; i++) {
        const candidate = left[i]!;
        const attached = attach(line, candidate.points);
        if (!attached) continue;
        line.length = 0;
        line.push(...attached);
        sources.push(candidate.way.id);
        left.splice(i, 1);
        extended = true;
        break;
      }
    }

    out.push({
      sources,
      name: (first.way.tags['name'] ?? '').trim(),
      tags: first.way.tags,
      points: line,
    });
  }

  return out;
}

/** The line with the fragment attached, whichever way round it fits. */
function attach(line: Point[], piece: Point[]): Point[] | null {
  const head = line[0]!;
  const tail = line[line.length - 1]!;
  const start = piece[0]!;
  const end = piece[piece.length - 1]!;
  const near = (a: Point, b: Point) => haversineDistance(a, b) <= JOIN_TOLERANCE_M;

  if (near(tail, start)) return [...line, ...piece.slice(1)];
  if (near(tail, end)) return [...line, ...[...piece].reverse().slice(1)];
  if (near(head, end)) return [...piece, ...line.slice(1)];
  if (near(head, start)) return [...[...piece].reverse(), ...line.slice(1)];
  return null;
}

/** Length of a line along the ground, in metres. */
export function lengthOf(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineDistance(points[i - 1]!, points[i]!);
  return total;
}

/**
 * Whether a joined path belongs in a catalogue of walks.
 *
 * Deliberately blunt. The data is contributed by people with different
 * ideas of what deserves a name, so some of what passes will be dull and
 * some of what is rejected would have been fine. The costly mistake is the
 * other one: an entry that is not a walk teaches somebody that the
 * catalogue cannot be trusted.
 */
export function worthWalking(path: JoinedPath): boolean {
  if (A_STRUCTURE.test(path.name)) return false;
  if (A_ROAD.test(path.name)) return false;
  if (A_DOUBT.test(path.name)) return false;

  // A paved track is a road whatever it is called.
  const surface = path.tags['surface'];
  if (surface === 'asphalt' || surface === 'paved' || surface === 'concrete') return false;

  const length = lengthOf(path.points);
  if (length < MIN_LENGTH_M || length > MAX_LENGTH_M) return false;

  // A path that never leaves a small circle is a loop around a car park.
  const start = path.points[0]!;
  const travels = path.points.some((p) => haversineDistance(start, p) > 250);
  return travels;
}

