import {
  evaluateDeviation,
  evaluateDownload,
  evaluateWeather,
  READINGS_TO_CLOSE,
  READINGS_TO_OPEN,
  TOLERANCE_RADIUS_M,
} from '../rules';
import { computeAttributes } from '../trail';
import {
  DeviationState,
  Forecast,
  INITIAL_DEVIATION_STATE,
  Level,
  TrailAttributes,
} from '../types';

const attrs = (distanceM: number, gainM: number): TrailAttributes => {
  const index = distanceM / 1000 + gainM / 100;
  return {
    distanceM,
    elevationGainM: gainM,
    effortIndex: index,
    difficulty: index <= 8 ? 'beginner' : index <= 18 ? 'intermediate' : 'advanced',
  };
};

describe('evaluateDownload', () => {
  it('asks for no confirmation when difficulty matches the level', () => {
    expect(evaluateDownload(attrs(5000, 200), 'beginner')).toEqual({
      allowed: true,
      requiresConfirmation: false,
    });
  });

  it('asks for no confirmation when the hiker exceeds the difficulty', () => {
    expect(evaluateDownload(attrs(5000, 200), 'advanced').requiresConfirmation).toBe(false);
  });

  it('requires confirmation from a beginner facing an advanced trail', () => {
    const r = evaluateDownload(attrs(20_000, 1500), 'beginner');
    expect(r.requiresConfirmation).toBe(true);
    expect(r.reason).toContain('avanzado');
    expect(r.reason).toContain('principiante');
  });

  it('never blocks the download: the final call is the hiker’s', () => {
    expect(evaluateDownload(attrs(30_000, 2500), 'beginner').allowed).toBe(true);
  });

  it('states distance and gain in the reason, so the warning is explainable', () => {
    const r = evaluateDownload(attrs(20_000, 1500), 'beginner');
    expect(r.reason).toContain('20.0 km');
    expect(r.reason).toContain('1500 m');
  });
});

describe('evaluateDeviation', () => {
  /** Applies a series of distances and returns the history of results. */
  const run = (distances: number[]) => {
    let state: DeviationState = INITIAL_DEVIATION_STATE;
    return distances.map((d) => {
      const r = evaluateDeviation(d, state);
      state = r.state;
      return r;
    });
  };

  it('stays quiet while the hiker is on the track', () => {
    const rs = run([5, 12, 30, 8]);
    expect(rs.every((r) => !r.shouldAlert && !r.state.offTrack)).toBe(true);
  });

  it('ignores a single stray reading beyond the radius', () => {
    // Receiver error can exceed the radius on an isolated fix.
    expect(run([10, 80, 10, 12]).some((r) => r.shouldAlert)).toBe(false);
  });

  it('alerts only on the third consecutive reading beyond the radius', () => {
    const rs = run([80, 90, 100]);
    expect(rs[0].shouldAlert).toBe(false);
    expect(rs[1].shouldAlert).toBe(false);
    expect(rs[2].shouldAlert).toBe(true);
    expect(rs[2].state.offTrack).toBe(true);
  });

  it('alerts once and does not repeat while still off track', () => {
    const rs = run([80, 90, 100, 120, 150, 200]);
    expect(rs.filter((r) => r.shouldAlert)).toHaveLength(1);
    expect(rs[rs.length - 1].state.offTrack).toBe(true);
  });

  it('does not clear the alert on barely returning inside the radius', () => {
    const justInside = TOLERANCE_RADIUS_M - 1; // 49 m: inside radius, outside re-entry
    const rs = run([80, 90, 100, justInside, justInside, justInside]);
    expect(rs[rs.length - 1].state.offTrack).toBe(true);
    expect(rs.some((r) => r.shouldClearAlert)).toBe(false);
  });

  it('clears the alert after three readings within 70 % of the radius', () => {
    const reentry = TOLERANCE_RADIUS_M * 0.5; // 25 m
    const rs = run([80, 90, 100, reentry, reentry, reentry]);
    expect(rs[rs.length - 1].shouldClearAlert).toBe(true);
    expect(rs[rs.length - 1].state.offTrack).toBe(false);
  });

  it('alerts again if the hiker strays once more after returning', () => {
    const r = TOLERANCE_RADIUS_M * 0.5;
    expect(run([80, 90, 100, r, r, r, 80, 90, 100]).filter((x) => x.shouldAlert)).toHaveLength(2);
  });

  it('honours a custom tolerance radius', () => {
    let state = INITIAL_DEVIATION_STATE;
    for (let i = 0; i < READINGS_TO_OPEN; i++) {
      state = evaluateDeviation(150, state, 200).state;
    }
    expect(state.offTrack).toBe(false); // 150 m is no deviation with a 200 m radius
  });

  it('keeps the opening and closing constants consistent with the tested behaviour', () => {
    expect(READINGS_TO_OPEN).toBe(3);
    expect(READINGS_TO_CLOSE).toBe(3);
  });
});

describe('evaluateWeather', () => {
  const base: Forecast = {
    date: '2026-09-20',
    precipitationMm: 0,
    windKmh: 10,
    minTempC: 12,
    maxTempC: 24,
  };

  it('raises nothing on a benign forecast', () => {
    const a = evaluateWeather(base);
    expect(a.severity).toBe('none');
    expect(a.reasons).toHaveLength(0);
  });

  it('warns on reaching the precipitation threshold', () => {
    const a = evaluateWeather({ ...base, precipitationMm: 12 });
    expect(a.severity).toBe('warning');
    expect(a.reasons[0]).toContain('12 mm');
  });

  it('escalates to risk on doubling the threshold', () => {
    expect(evaluateWeather({ ...base, precipitationMm: 25 }).severity).toBe('risk');
  });

  it('collects the reasons of several conditions at once', () => {
    expect(evaluateWeather({ ...base, precipitationMm: 12, windKmh: 45 }).reasons).toHaveLength(2);
  });

  it('lets a risk condition override a warning one', () => {
    expect(evaluateWeather({ ...base, precipitationMm: 12, windKmh: 100 }).severity).toBe('risk');
  });

  it('warns on a minimum temperature below zero', () => {
    expect(evaluateWeather({ ...base, minTempC: -1 }).severity).toBe('warning');
  });

  it('records when it ran, so its age can be shown offline', () => {
    const at = new Date('2026-09-20T08:00:00.000Z');
    expect(evaluateWeather(base, undefined, at).evaluatedAt).toBe('2026-09-20T08:00:00.000Z');
  });
});

describe('integration: computed attributes feed the download rule', () => {
  it('asks a beginner for no confirmation on a short flat trail', () => {
    const points = Array.from({ length: 21 }, (_, i) => ({
      lat: -31.9 + i * 0.0009,
      lon: -64.8,
      ele: 800,
    }));
    const a = computeAttributes(points);
    expect(a.difficulty).toBe<Level>('beginner');
    expect(evaluateDownload(a, 'beginner').requiresConfirmation).toBe(false);
  });

  it('does ask on a sustained climb', () => {
    // ~10 km with 1400 m of ascent: effort index about 24
    const points = Array.from({ length: 101 }, (_, i) => ({
      lat: -31.9 + i * 0.0009,
      lon: -64.8,
      ele: 800 + i * 14,
    }));
    const a = computeAttributes(points);
    expect(a.difficulty).toBe<Level>('advanced');
    expect(evaluateDownload(a, 'beginner').requiresConfirmation).toBe(true);
  });
});
