/** Geospatial calculations over a trail track.
 *
 *  Everything here runs on the device and without connectivity. It is the
 *  basis for both the difficulty classification and the deviation alert.
 */
import { Point } from './types';

const EARTH_RADIUS_M = 6_371_008.8; // mean Earth radius (IUGG)

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Great circle distance between two points, in metres.
 *
 * Uses the haversine formula, which assumes a spherical Earth. Over trail
 * distances, tens of kilometres at most, the error against an ellipsoidal
 * model is negligible.
 */
export function haversineDistance(a: Point, b: Point): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const latA = toRadians(a.lat);
  const latB = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Local equirectangular projection: converts a point to planar metres taking
 * `origin` as reference.
 *
 * Over short distances the distortion is minimal, and working on a plane lets
 * the point to segment distance be solved with elementary algebra instead of
 * spherical trigonometry.
 */
function toPlane(p: Point, origin: Point): { x: number; y: number } {
  const refLat = toRadians(origin.lat);
  return {
    x: toRadians(p.lon - origin.lon) * Math.cos(refLat) * EARTH_RADIUS_M,
    y: toRadians(p.lat - origin.lat) * EARTH_RADIUS_M,
  };
}

/**
 * Distance in metres from `p` to the segment running from `a` to `b`.
 *
 * This is the distance to the closest point of the segment, which may be an
 * endpoint when the projection falls outside it. It matters: measuring only
 * against the track vertices would overstate the deviation along the long
 * straight stretches that mountain trails often have.
 */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const pp = toPlane(p, a);
  const pb = toPlane(b, a);

  const squaredLength = pb.x ** 2 + pb.y ** 2;
  if (squaredLength === 0) return haversineDistance(p, a); // degenerate segment

  // t is the projection's position along the segment, clamped to [0, 1].
  let t = (pp.x * pb.x + pp.y * pb.y) / squaredLength;
  t = Math.max(0, Math.min(1, t));

  const dx = pp.x - t * pb.x;
  const dy = pp.y - t * pb.y;
  return Math.sqrt(dx ** 2 + dy ** 2);
}

export interface DistanceToTrackResult {
  /** Distance to the nearest point of the track, in metres. */
  meters: number;
  /** Index of the nearest segment, which tells which stretch the hiker is on. */
  segmentIndex: number;
}

/**
 * Distance from the hiker to the trail track.
 *
 * Walks every segment and returns the minimum. This runs continuously during
 * a hike and the deviation alert depends on it.
 */
export function distanceToTrack(p: Point, track: Point[]): DistanceToTrackResult {
  if (track.length === 0) {
    throw new Error('The track cannot be empty');
  }
  if (track.length === 1) {
    return { meters: haversineDistance(p, track[0]), segmentIndex: 0 };
  }

  let best = Infinity;
  let index = 0;
  for (let i = 0; i < track.length - 1; i++) {
    const d = distanceToSegment(p, track[i], track[i + 1]);
    if (d < best) {
      best = d;
      index = i;
    }
  }
  return { meters: best, segmentIndex: index };
}
