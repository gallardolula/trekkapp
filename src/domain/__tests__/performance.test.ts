/** The performance RNF02 commits to, measured rather than assumed.
 *
 *  RNF02 says evaluating a position against a five thousand point track must
 *  not exceed fifty milliseconds. That is the budget for `distanceToTrack`,
 *  which runs on every reading of the receiver during a hike and is what the
 *  deviation alert depends on.
 *
 *  The figures are printed as well as asserted. A requirement of this kind
 *  is defended with a number, and a test that only says "passed" leaves
 *  nobody able to say what the number was.
 *
 *  Measured here on the development machine, which is not the phone. The
 *  budget is the same but the engine is not, so this is an upper bound on
 *  the algorithm and not a substitute for the device figure, which the
 *  measurements screen in the application produces. See docs/measurements.md.
 */
import {
  report,
  REPORT_SIZES,
  RNF02_BUDGET_MS,
  RNF02_POINTS,
  timeEvaluation,
  windingTrack,
  worstCaseFor,
} from '../benchmark';
import { Point } from '../types';

describe('RNF02, evaluating a position against the track', () => {
  const track = windingTrack(RNF02_POINTS);

  // Three positions, because the loop does not cost the same from all of
  // them. The last is the worst case: the nearest segment is the final one,
  // so every earlier segment is measured and discarded.
  const positions: { name: string; at: Point }[] = [
    { name: 'on the track, at the start', at: track[0]! },
    { name: 'on the track, halfway', at: track[Math.floor(RNF02_POINTS / 2)]! },
    { name: 'off the track, past the end', at: worstCaseFor(track) },
  ];

  it.each(positions)('stays within the budget $name', ({ name, at }) => {
    const t = timeEvaluation(at, track);
    console.log(
      `  RNF02  ${name.padEnd(28)} mediana ${t.medianMs.toFixed(3)} ms  p95 ${t.p95Ms.toFixed(3)} ms  de ${RNF02_BUDGET_MS} ms`,
    );
    // The tail and not the middle, because a budget is about the slow case.
    expect(t.p95Ms).toBeLessThan(RNF02_BUDGET_MS);
  });

  it('reports the whole curve, which is what the document quotes', () => {
    const rows = report();
    for (const t of rows) {
      console.log(
        `  RNF02  ${String(t.points).padStart(6)} puntos  mediana ${t.medianMs.toFixed(3)} ms  p95 ${t.p95Ms.toFixed(3)} ms  max ${t.maxMs.toFixed(3)} ms`,
      );
    }
    // Headroom is part of the answer. A figure that only just fits at the
    // size the requirement names says nothing about what happens past it.
    for (const t of rows) expect(t.p95Ms).toBeLessThan(RNF02_BUDGET_MS);
    expect(rows.map((t) => t.points)).toEqual([...REPORT_SIZES]);
  });

  it('grows with the track and not faster', () => {
    // The loop visits every segment once, so four times the points should
    // cost about four times as much. A worse curve than that would mean the
    // cost is somewhere other than where this test is looking.
    const [small, large] = [2500, 10000].map((n) => {
      const t = windingTrack(n);
      return timeEvaluation(worstCaseFor(t), t, 40);
    });
    const factor = large!.medianMs / small!.medianMs;
    console.log(`  RNF02  ${'2500 -> 10000 puntos'.padEnd(28)} x${factor.toFixed(2)} por x4 de puntos`);
    expect(factor).toBeLessThan(8);
  });
});
