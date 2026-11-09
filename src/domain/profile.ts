/** The shape of a walk, as height against distance.
 *
 *  Two trails of the same length and the same total climb can be entirely
 *  different outings. One rises steadily all morning; the other is flat for
 *  six kilometres and then stands on end. The numbers on the catalogue card
 *  cannot tell them apart, and this is what does.
 *
 *  Pure arithmetic over a track, so the drawing is a drawing and the
 *  reasoning about terrain is testable without one.
 */
import { haversineDistance } from './geo';
import type { Point } from './types';

export interface ProfileSample {
  /** Metres walked from the start of the trail. */
  distanceM: number;
  /** Metres above sea level. */
  elevationM: number;
}

export interface TrailProfile {
  samples: ProfileSample[];
  lengthM: number;
  minM: number;
  maxM: number;
  /**
   * The steepest sustained stretch, as a rise over a run.
   *
   * Measured over a window rather than between two points, because two
   * adjacent fixes of a satellite receiver can imply a cliff that is not
   * there, and what somebody wants to know is whether there is a hard
   * stretch rather than whether there is a hard step.
   */
  steepest: { grade: number; fromM: number; toM: number } | null;
}

/** How long a stretch has to be before its slope means anything. */
const WINDOW_M = 250;

/**
 * Builds the profile of a track, thinned to at most `samples` points.
 *
 * Thinned because a trail holds thousands of points and the drawing is a
 * few hundred pixels wide, so the rest is work nobody can see. The ends are
 * always kept: the start and the summit are the two points somebody looks
 * for first.
 */
export function buildProfile(track: Point[], samples = 160): TrailProfile | null {
  const withHeight = track.filter((p) => typeof p.ele === 'number');
  // Fewer than two heights is a track whose elevation was never recorded,
  // which several export tools produce. There is no profile to draw and
  // saying so is better than drawing a flat line that claims there is.
  if (withHeight.length < 2) return null;

  const all: ProfileSample[] = [];
  let distance = 0;
  for (let i = 0; i < withHeight.length; i++) {
    if (i > 0) distance += haversineDistance(withHeight[i - 1]!, withHeight[i]!);
    all.push({ distanceM: distance, elevationM: withHeight[i]!.ele! });
  }

  const elevations = all.map((s) => s.elevationM);
  const lengthM = all[all.length - 1]!.distanceM;

  return {
    samples: thin(all, samples),
    lengthM,
    minM: Math.min(...elevations),
    maxM: Math.max(...elevations),
    // Measured on the filtered series, because a single bad reading is a
    // cliff and then a wall, and whoever reads the figure would plan
    // around a slope that is not on the mountain. The drawing keeps the
    // heights as they were recorded.
    steepest: steepestStretch(despiked(all)),
  };
}

/**
 * Removes isolated bad readings, keeping real slopes untouched.
 *
 * A median of three neighbours, which is the standard answer to impulse
 * noise and the right one here: a barometric altimeter passing a door, or
 * a satellite fix arriving with a bad vertical component, moves one sample
 * and leaves its neighbours alone. An average would smear such a spike
 * across the stretch instead of discarding it, and would also round off
 * the genuinely steep ground this is meant to find.
 */
function despiked(samples: ProfileSample[]): ProfileSample[] {
  if (samples.length < 3) return samples;

  return samples.map((s, i) => {
    if (i === 0 || i === samples.length - 1) return s;
    const three = [
      samples[i - 1]!.elevationM,
      s.elevationM,
      samples[i + 1]!.elevationM,
    ].sort((a, b) => a - b);
    return { distanceM: s.distanceM, elevationM: three[1]! };
  });
}

/** Keeps `count` evenly spaced samples, ends included. */
function thin(samples: ProfileSample[], count: number): ProfileSample[] {
  if (samples.length <= count) return samples;
  const step = (samples.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => samples[Math.round(i * step)]!);
}

/** The hardest stretch of at least `WINDOW_M`, or null on a short track. */
function steepestStretch(samples: ProfileSample[]): TrailProfile['steepest'] {
  let best: TrailProfile['steepest'] = null;
  let start = 0;

  for (let end = 1; end < samples.length; end++) {
    // Slide the start forward while the window is longer than it needs to
    // be, so every window measured is as short as the rule allows and the
    // steepest one is not diluted by flat ground behind it.
    while (samples[end]!.distanceM - samples[start + 1]!.distanceM >= WINDOW_M) start++;

    const run = samples[end]!.distanceM - samples[start]!.distanceM;
    if (run < WINDOW_M) continue;

    const rise = samples[end]!.elevationM - samples[start]!.elevationM;
    const grade = rise / run;
    if (!best || grade > best.grade) {
      best = { grade, fromM: samples[start]!.distanceM, toM: samples[end]!.distanceM };
    }
  }

  return best;
}

/**
 * How a grade reads to somebody deciding whether to go.
 *
 * The bands are the ones walkers use rather than anything derived: under a
 * tenth is ground you walk without thinking, a fifth is a climb you feel,
 * and beyond a third you are using your hands sooner or later.
 */
export function describeGrade(grade: number): string {
  const percent = Math.round(grade * 100);
  if (percent < 5) return `${percent} % de pendiente, prácticamente llano`;
  if (percent < 12) return `${percent} % de pendiente, subida suave`;
  if (percent < 22) return `${percent} % de pendiente, subida sostenida`;
  if (percent < 35) return `${percent} % de pendiente, tramo exigente`;
  return `${percent} % de pendiente, trepada`;
}
