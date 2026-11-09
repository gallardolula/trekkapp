/** What the system accepts into the catalogue, and what it refuses.
 *
 *  These checks are what replaced the moderator, so they carry the whole
 *  weight of the decision. Each one is pinned against a track that fails it
 *  and a track that passes it, because a check that rejects everything
 *  keeps the catalogue as clean as a check that rejects nothing keeps it
 *  dangerous, and from the outside both look like it is working.
 */
import type { Point } from '../../../src/domain/types';
import { isDuplicateOf, validateGeometry } from '../trails/validation';

/** A plausible walked track in the Sierras: climbs gently, goes somewhere. */
function track(
  points = 24,
  { lat = -31.65, lon = -64.68, ele = 2100, climb = 4, step = 0.0004 } = {},
): Point[] {
  return Array.from({ length: points }, (_, i) => ({
    lat: lat - i * step,
    lon: lon - i * step,
    ele: ele + i * climb,
  }));
}

describe('a track that should be published', () => {
  it('passes', () => {
    expect(validateGeometry(track())).toBeNull();
  });

  it('passes without any elevation, which many exported files lack', () => {
    const flat = track().map(({ lat, lon }) => ({ lat, lon }));
    expect(validateGeometry(flat)).toBeNull();
  });

  it('passes when it returns to where it started, because a loop is a route', () => {
    const out = track(20);
    const back = [...out].reverse().slice(1);
    expect(validateGeometry([...out, ...back])).toBeNull();
  });

  it('passes at a walking pace, when the file carries times', () => {
    const timed = track().map((p, i) => ({
      ...p,
      time: new Date(Date.parse('2026-11-09T08:00:00.000Z') + i * 60_000).toISOString(),
    }));
    expect(validateGeometry(timed)).toBeNull();
  });
});

describe('a track that should not', () => {
  it('refuses one with too few points to be a recording', () => {
    expect(validateGeometry(track(4))?.reason).toBe('too_few_points');
  });

  it('refuses one outside the area this project serves', () => {
    expect(validateGeometry(track(24, { lat: 27.98, lon: 86.92 }))?.reason).toBe(
      'outside_covered_region',
    );
  });

  it('refuses one too short to be a route', () => {
    expect(validateGeometry(track(12, { step: 0.00002 }))?.reason).toBe('too_short');
  });

  it('refuses one longer than any single outing', () => {
    expect(validateGeometry(track(1400, { step: 0.0004, climb: 0 }))?.reason).toBe('too_long');
  });

  it('refuses one with a jump no walker made', () => {
    // Two separate outings in one file, or a recording that lost the
    // signal. Following it would send somebody across whatever lies
    // between, which is the whole reason this is refused rather than
    // smoothed over.
    const broken = [...track(12), ...track(12, { lat: -31.9, lon: -64.9 })];
    expect(validateGeometry(broken)?.reason).toBe('gap_too_large');
  });

  it('refuses one that climbs more between two fixes than anybody climbs', () => {
    const spike = track();
    spike[10] = { ...spike[10]!, ele: 4000 };
    expect(validateGeometry(spike)?.reason).toBe('implausible_climb');
  });

  it('refuses one whose average grade is not walkable', () => {
    expect(validateGeometry(track(24, { climb: 60, step: 0.0008 }))?.reason).toBe(
      'implausible_grade',
    );
  });

  it('refuses one recorded in a vehicle', () => {
    const driven = track(24, { step: 0.002, climb: 0 }).map((p, i) => ({
      ...p,
      time: new Date(Date.parse('2026-11-09T08:00:00.000Z') + i * 10_000).toISOString(),
    }));
    expect(validateGeometry(driven)?.reason).toBe('implausible_speed');
  });

  it('refuses a recorder left running in one place', () => {
    const still = Array.from({ length: 300 }, (_, i) => ({
      lat: -31.65 + Math.sin(i) * 0.0002,
      lon: -64.68 + Math.cos(i) * 0.0002,
      ele: 2100,
    }));
    expect(validateGeometry(still)?.reason).toBe('not_a_route');
  });
});

describe('where the problem is', () => {
  it('names the point, so the contributor can look at the file', () => {
    const broken = [...track(12), ...track(12, { lat: -31.9, lon: -64.9 })];
    expect(validateGeometry(broken)?.atPoint).toBe(12);
  });
});

describe('recognising the same route twice', () => {
  it('calls a second recording of the same path a duplicate', () => {
    // Recorded on a different day, so the fixes land a few metres off.
    const again = track().map((p) => ({
      ...p,
      lat: p.lat + 0.00008,
      lon: p.lon - 0.00006,
    }));
    expect(isDuplicateOf(again, track())).toBe(true);
  });

  it('does not call a different valley a duplicate', () => {
    expect(isDuplicateOf(track(24, { lat: -32.4, lon: -65.1 }), track())).toBe(false);
  });

  it('does not call two paths that merely share a stretch a duplicate', () => {
    // They start together and part ways. Treating this as a duplicate would
    // keep every trail that leaves from the same trailhead out of the
    // catalogue.
    const shared = track(12);
    const fork = shared[11]!;
    const diverging = [
      ...shared,
      // Turns east where the other one keeps going west.
      ...Array.from({ length: 12 }, (_, i) => ({
        lat: fork.lat - i * 0.0004,
        lon: fork.lon + i * 0.0004,
        ele: fork.ele! + i * 4,
      })),
    ];
    expect(isDuplicateOf(diverging, track())).toBe(false);
  });

  it('says nothing is a duplicate of an empty catalogue entry', () => {
    expect(isDuplicateOf(track(), [])).toBe(false);
  });
});
