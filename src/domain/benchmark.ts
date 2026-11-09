/** Measuring what the requirements commit to.
 *
 *  RNF02 puts a budget on evaluating a position against the track, and a
 *  budget is only a claim until somebody measures it. This is the
 *  instrument: it builds a track of a given size, times the evaluation, and
 *  reports the spread rather than a single number.
 *
 *  One module and not two, because the figure has to be taken on the
 *  development machine and on the device, and two copies of a benchmark are
 *  two benchmarks. The test suite calls this, and so does the measurements
 *  screen that runs on the phone, so the two numbers are comparable.
 *
 *  The device figure is the one that counts. The requirement is about a
 *  hiker's phone, and the engine there is Hermes rather than the one a
 *  laptop runs, which is slower on exactly this kind of numeric loop.
 */
import { distanceToTrack } from './geo';
import { Point } from './types';

export interface Timing {
  /** Milliseconds for one evaluation, the middle of the samples. */
  medianMs: number;
  meanMs: number;
  /** The slow tail, which is what a budget is really about. */
  p95Ms: number;
  minMs: number;
  maxMs: number;
  samples: number;
  points: number;
}

/**
 * A track of the shape the catalogue actually holds.
 *
 * Not a straight line. On a straight track the nearest segment is found
 * early and never beaten, which is the cheapest path through the loop
 * rather than a representative one, and the figure would flatter the
 * implementation.
 */
export function windingTrack(points: number): Point[] {
  const track: Point[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / points;
    track.push({
      lat: -31.65 - t * 0.18 + Math.sin(t * 40) * 0.004,
      lon: -64.68 - t * 0.12 + Math.cos(t * 33) * 0.004,
      ele: 1800 + t * 900 + Math.sin(t * 18) * 40,
    });
  }
  return track;
}

/**
 * The worst position to be in, which is the one worth measuring.
 *
 * Past the end of the track, so the nearest segment is the last one and
 * every earlier segment is measured and discarded.
 */
export const worstCaseFor = (track: Point[]): Point => {
  const last = track[track.length - 1]!;
  return { lat: last.lat - 0.02, lon: last.lon - 0.02 };
};

/** How many evaluations are thrown away before measuring begins. */
const WARMUP = 20;

/**
 * Times one evaluation, repeated.
 *
 * Warmed up first, so what is reported is the steady state rather than the
 * cost of the engine compiling the function on its first call.
 */
export function timeEvaluation(position: Point, track: Point[], samples = 60): Timing {
  for (let i = 0; i < WARMUP; i++) distanceToTrack(position, track);

  const taken: number[] = [];
  for (let i = 0; i < samples; i++) {
    const started = now();
    distanceToTrack(position, track);
    taken.push(now() - started);
  }
  taken.sort((a, b) => a - b);

  const total = taken.reduce((sum, v) => sum + v, 0);
  return {
    medianMs: taken[Math.floor(taken.length / 2)]!,
    meanMs: total / taken.length,
    p95Ms: taken[Math.min(taken.length - 1, Math.floor(taken.length * 0.95))]!,
    minMs: taken[0]!,
    maxMs: taken[taken.length - 1]!,
    samples: taken.length,
    points: track.length,
  };
}

/** The clock, wherever this runs. */
function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** The sizes the report covers, with the one the requirement names in the middle. */
export const REPORT_SIZES = [1000, 2500, 5000, 10000] as const;

/** The budget RNF02 commits to, in milliseconds. */
export const RNF02_BUDGET_MS = 50;

/** The track size RNF02 names. */
export const RNF02_POINTS = 5000;

/** One row per size, each measured at its own worst case. */
export function report(sizes: readonly number[] = REPORT_SIZES, samples = 40): Timing[] {
  return sizes.map((n) => {
    const track = windingTrack(n);
    return timeEvaluation(worstCaseFor(track), track, samples);
  });
}
