/** Technical attributes derived from a trail track.
 *
 *  None of these values is entered by hand: they are all computed from the
 *  sequence of points. That is what makes the difficulty a computed state
 *  rather than a figure declared by whoever publishes the route.
 */
import { haversineDistance } from './geo';
import { Level, Point, TrailAttributes } from './types';

/**
 * Elevation noise discarded when accumulating ascent, in metres.
 *
 * A satellite receiver estimates elevation far less precisely than horizontal
 * position, and it drifts even with the device at rest. Without this
 * threshold a flat trail would accumulate hundreds of metres of false gain.
 */
export const ELEVATION_NOISE_THRESHOLD_M = 3;

/** Total length of the route, in metres. */
export function totalDistance(points: Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += haversineDistance(points[i], points[i + 1]);
  }
  return total;
}

/**
 * Sum of every ascent along the route, in metres.
 *
 * Only positive differences count, and only when they exceed the noise
 * threshold, always compared against the last elevation taken as valid rather
 * than the immediately preceding point. A sustained gentle climb therefore
 * accumulates correctly even when each individual step falls below it.
 */
export function elevationGain(
  points: Point[],
  thresholdM: number = ELEVATION_NOISE_THRESHOLD_M,
): number {
  const withElevation = points.filter((p) => typeof p.ele === 'number');
  if (withElevation.length < 2) return 0;

  let total = 0;
  let reference = withElevation[0].ele as number;

  for (let i = 1; i < withElevation.length; i++) {
    const current = withElevation[i].ele as number;
    const delta = current - reference;
    if (Math.abs(delta) < thresholdM) continue; // drift: the reference holds
    if (delta > 0) total += delta;
    reference = current;
  }
  return total;
}

/**
 * Metres of ascent considered equivalent to one kilometre on the flat.
 *
 * A rule of thumb common in mountaineering: climbing 100 metres costs about
 * as much, in time and effort, as walking a kilometre over flat ground. It is
 * the basis of the effort index.
 */
export const ASCENT_METERS_PER_FLAT_KM = 100;

/** Effort index thresholds separating the three difficulty levels. */
export const BEGINNER_THRESHOLD = 8;
export const INTERMEDIATE_THRESHOLD = 18;

/**
 * Flat equivalent distance, in kilometres.
 *
 * Combines length and elevation gain into a single comparable number, so that
 * two trails of equal distance but different gain are not classified alike.
 */
export function effortIndex(distanceM: number, gainM: number): number {
  return distanceM / 1000 + gainM / ASCENT_METERS_PER_FLAT_KM;
}

/** Maps the effort index onto one of the three difficulty levels. */
export function classifyDifficulty(index: number): Level {
  if (index <= BEGINNER_THRESHOLD) return 'beginner';
  if (index <= INTERMEDIATE_THRESHOLD) return 'intermediate';
  return 'advanced';
}

/**
 * Naismith's rule, the walking pace over flat ground, in km an hour.
 *
 * The rule was stated by William W. Naismith in 1892 as three miles an
 * hour, which is where the five comes from.
 */
export const NAISMITH_FLAT_KMH = 5;

/**
 * Naismith's rule, the ascent added as an hour, in metres.
 *
 * Two thousand feet in the original, taken here as the six hundred metres
 * the rule is quoted as ever since.
 */
export const NAISMITH_ASCENT_M_PER_HOUR = 600;

/**
 * Roughly how long a trail takes to walk, in minutes.
 *
 * Naismith's rule and nothing added to it: an hour for every five
 * kilometres of ground and an hour more for every six hundred metres of
 * ascent. It is quoted that way in every mountaineering manual, which is
 * the reason to use it rather than a figure of our own. It counts walking
 * and not stops, and descent costs nothing.
 *
 * Deliberately separate from the effort index. The index exists to
 * classify difficulty and answers a different question with a different
 * constant; folding the two together would mean that a change to the
 * difficulty bands silently moved every time shown on screen.
 *
 * An estimate, and nothing in the application depends on it, which is why
 * it is not one of the stored attributes.
 */
export function estimatedMinutes(distanceM: number, elevationGainM: number): number {
  const hours =
    distanceM / 1000 / NAISMITH_FLAT_KMH + elevationGainM / NAISMITH_ASCENT_M_PER_HOUR;
  return Math.round(hours * 60);
}

/** Computes every derived attribute of a track in one pass. */
export function computeAttributes(points: Point[]): TrailAttributes {
  const distanceM = totalDistance(points);
  const elevationGainM = elevationGain(points);
  const index = effortIndex(distanceM, elevationGainM);
  return {
    distanceM,
    elevationGainM,
    effortIndex: index,
    difficulty: classifyDifficulty(index),
  };
}
