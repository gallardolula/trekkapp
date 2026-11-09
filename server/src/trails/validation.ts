/** Whether a contributed trail can enter the shared catalogue.
 *
 *  This module is what replaced the moderator. The decision used to belong
 *  to a person looking at a line on a map, and that person could not
 *  actually establish most of what mattered, so what the review gave was a
 *  guarantee it could not keep. These checks are narrower and honest about
 *  it: they establish that a track is a plausible walked route inside the
 *  area this project serves, and nothing more.
 *
 *  What they deliberately do not establish, because no amount of geometry
 *  can, is whether the route crosses private land or a reserve that
 *  requires a permit, whether it is closed for the season, which in the
 *  Sierras de Córdoba happens every year over fire risk, and whether it
 *  holds a ford that is lethal in flood or a passage that needs hands. A
 *  trail that passes here is marked as automatically validated and not
 *  verified on the ground, and that wording is the protection. See
 *  docs/adr/0007.
 *
 *  Every rejection names a reason the contributor can act on, because a
 *  contribution refused without one is a contribution lost.
 */
import { haversineDistance } from '../../../src/domain/geo';
import type { Point } from '../../../src/domain/types';

/** Coarse envelope of the Sierras de Córdoba, which is the served area. */
export const COVERED_REGION = { minLat: -33.6, maxLat: -30.5, minLon: -65.6, maxLon: -63.7 };

/** A speed no walker holds. Above it the track came from a vehicle. */
const MAX_WALKING_SPEED_MS = 4.2; // around 15 km/h

/** Below this a track is a few metres of noise rather than a route. */
const MIN_LENGTH_M = 400;

/** Above this it is a multi-day expedition or several outings concatenated. */
const MAX_LENGTH_M = 80_000;

const MIN_POINTS = 10;

/** A step this long means the recorder lost the signal or the file is cut. */
const MAX_STEP_M = 500;

/** Climbing this between two consecutive fixes is a sensor fault. */
const MAX_STEP_CLIMB_M = 120;

/** Gaining more than this per metre walked is not terrain anybody walks. */
const MAX_AVERAGE_GRADE = 0.45;

export type RejectionReason =
  | 'too_few_points'
  | 'outside_covered_region'
  | 'too_short'
  | 'too_long'
  | 'gap_too_large'
  | 'implausible_climb'
  | 'implausible_grade'
  | 'implausible_speed'
  | 'not_a_route'
  | 'duplicate_of_existing';

export interface Rejection {
  reason: RejectionReason;
  /** Where in the track it was found, when that is meaningful. */
  atPoint?: number;
}

/**
 * Checks a track on its own, with no knowledge of the catalogue.
 *
 * Returns the first problem found, or null. First and not all of them: the
 * checks are ordered from the most structural to the most specific, so the
 * first one to fire is the one worth telling somebody about.
 */
export function validateGeometry(points: Point[]): Rejection | null {
  if (points.length < MIN_POINTS) return { reason: 'too_few_points' };

  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (
      p.lat < COVERED_REGION.minLat ||
      p.lat > COVERED_REGION.maxLat ||
      p.lon < COVERED_REGION.minLon ||
      p.lon > COVERED_REGION.maxLon
    ) {
      return { reason: 'outside_covered_region', atPoint: i };
    }
  }

  let length = 0;
  let climb = 0;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const step = haversineDistance(a, b);

    // A jump of half a kilometre between consecutive fixes is not a path
    // somebody walked. It is a recording that lost the signal, or two
    // separate outings stitched into one file, and following it on the
    // ground would send somebody straight across whatever lies between.
    if (step > MAX_STEP_M) return { reason: 'gap_too_large', atPoint: i };

    length += step;

    if (typeof a.ele === 'number' && typeof b.ele === 'number') {
      const rise = b.ele - a.ele;
      if (Math.abs(rise) > MAX_STEP_CLIMB_M) {
        return { reason: 'implausible_climb', atPoint: i };
      }
      if (rise > 0) climb += rise;
    }

    // Speed is only checkable where both points carry a timestamp, which a
    // track exported from some tools does not.
    if (a.time && b.time) {
      const seconds = (Date.parse(b.time) - Date.parse(a.time)) / 1000;
      if (seconds > 0 && step / seconds > MAX_WALKING_SPEED_MS) {
        return { reason: 'implausible_speed', atPoint: i };
      }
    }
  }

  if (length < MIN_LENGTH_M) return { reason: 'too_short' };
  if (length > MAX_LENGTH_M) return { reason: 'too_long' };
  if (climb / length > MAX_AVERAGE_GRADE) return { reason: 'implausible_grade' };

  // A track that never leaves a small circle is somebody who left the
  // recorder running, not a route from one place to another. Measured
  // against the span of the whole track rather than its length, so a
  // legitimate loop, which is long but does travel, still passes.
  if (span(points) < MIN_LENGTH_M / 4 && !travels(points)) {
    return { reason: 'not_a_route' };
  }

  return null;
}

/** The largest distance between the enclosing box's opposite corners. */
function span(points: Point[]): number {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  return haversineDistance(
    { lat: Math.min(...lats), lon: Math.min(...lons) },
    { lat: Math.max(...lats), lon: Math.max(...lons) },
  );
}

/** Whether the track gets meaningfully away from where it started. */
function travels(points: Point[]): boolean {
  const start = points[0]!;
  return points.some((p) => haversineDistance(start, p) > MIN_LENGTH_M / 2);
}

/**
 * Whether a track is the same route as one already in the catalogue.
 *
 * Without this the catalogue fills with twenty recordings of the Quebrada
 * del Condorito, which is not a moderation problem in disguise but a
 * genuine one: somebody looking for a trail cannot tell which of the
 * twenty to download, and the one they pick is arbitrary.
 *
 * The comparison is deliberately crude. Two tracks count as the same when
 * nearly every point of the new one falls close to some point of the old,
 * which is true of two recordings of one path and false of two paths that
 * merely share a stretch.
 */
export function isDuplicateOf(candidate: Point[], existing: Point[], toleranceM = 60): boolean {
  if (existing.length === 0 || candidate.length === 0) return false;

  const sampled = sample(candidate, 60);
  const against = sample(existing, 400);
  const near = sampled.filter((p) =>
    against.some((q) => haversineDistance(p, q) <= toleranceM),
  ).length;

  return near / sampled.length >= 0.9;
}

/** Thins a track to at most `count` points, keeping the ends. */
function sample(points: Point[], count: number): Point[] {
  if (points.length <= count) return points;
  const step = (points.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => points[Math.round(i * step)]!);
}
