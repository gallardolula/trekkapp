import {
  classifyDifficulty,
  computeAttributes,
  effortIndex,
  elevationGain,
  ELEVATION_NOISE_THRESHOLD_M,
  totalDistance,
} from '../trail';
import { Point } from '../types';

describe('totalDistance', () => {
  it('is zero for a single point track', () => {
    expect(totalDistance([{ lat: 0, lon: 0 }])).toBe(0);
  });

  it('is zero for an empty track', () => {
    expect(totalDistance([])).toBe(0);
  });

  it('adds up consecutive legs', () => {
    const points: Point[] = [
      { lat: 0, lon: 0 },
      { lat: 0.001, lon: 0 },
      { lat: 0.002, lon: 0 },
    ];
    expect(totalDistance(points)).toBeCloseTo(222.6, 0); // two legs of ~111 m
  });
});

describe('elevationGain', () => {
  it('is zero when no point carries elevation', () => {
    expect(elevationGain([{ lat: 0, lon: 0 }, { lat: 0.1, lon: 0 }])).toBe(0);
  });

  it('adds ascents only and ignores descents', () => {
    const points: Point[] = [
      { lat: 0, lon: 0, ele: 100 },
      { lat: 0, lon: 0, ele: 150 }, // +50
      { lat: 0, lon: 0, ele: 120 }, // -30, ignored
      { lat: 0, lon: 0, ele: 170 }, // +50
    ];
    expect(elevationGain(points)).toBe(100);
  });

  it('discards elevation drift below the threshold', () => {
    // A ±2 m wobble with the device at rest must accumulate nothing.
    const points: Point[] = [100, 102, 100, 101, 99].map((ele) => ({ lat: 0, lon: 0, ele }));
    expect(elevationGain(points)).toBe(0);
  });

  it('accumulates a sustained climb even when each step is below the threshold', () => {
    // Twenty 2 m steps: each is below the threshold, but the reference does
    // not move, so the real 40 m climb is still detected.
    const points: Point[] = Array.from({ length: 21 }, (_, i) => ({
      lat: 0,
      lon: 0,
      ele: 100 + i * 2,
    }));
    expect(elevationGain(points)).toBeGreaterThan(30);
  });

  it('honours a configurable noise threshold', () => {
    const points: Point[] = [
      { lat: 0, lon: 0, ele: 100 },
      { lat: 0, lon: 0, ele: 104 },
    ];
    expect(elevationGain(points, ELEVATION_NOISE_THRESHOLD_M)).toBe(4);
    expect(elevationGain(points, 10)).toBe(0);
  });

  it('skips points without elevation in between', () => {
    const points: Point[] = [
      { lat: 0, lon: 0, ele: 100 },
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0, ele: 150 },
    ];
    expect(elevationGain(points)).toBe(50);
  });
});

describe('effortIndex and classifyDifficulty', () => {
  it('treats 100 m of ascent as one flat kilometre', () => {
    expect(effortIndex(0, 100)).toBeCloseTo(1, 6);
    expect(effortIndex(1000, 0)).toBeCloseTo(1, 6);
  });

  it('separates two trails of equal distance and different gain', () => {
    expect(classifyDifficulty(effortIndex(10_000, 100))).toBe('intermediate');
    expect(classifyDifficulty(effortIndex(10_000, 1200))).toBe('advanced');
  });

  it('classifies at the threshold boundaries', () => {
    expect(classifyDifficulty(8)).toBe('beginner');
    expect(classifyDifficulty(8.01)).toBe('intermediate');
    expect(classifyDifficulty(18)).toBe('intermediate');
    expect(classifyDifficulty(18.01)).toBe('advanced');
  });
});

describe('computeAttributes', () => {
  it('derives every attribute from the track, with nothing entered by hand', () => {
    const points: Point[] = Array.from({ length: 51 }, (_, i) => ({
      lat: -31.9 + i * 0.0009,
      lon: -64.8,
      ele: 800 + i * 10,
    }));
    const a = computeAttributes(points);

    expect(a.distanceM).toBeGreaterThan(4900);
    expect(a.distanceM).toBeLessThan(5100);
    expect(a.elevationGainM).toBeCloseTo(500, 0);
    expect(a.effortIndex).toBeCloseTo(a.distanceM / 1000 + 5, 1);
    expect(a.difficulty).toBe('intermediate');
  });

  it('does not fail on an empty track', () => {
    const a = computeAttributes([]);
    expect(a.distanceM).toBe(0);
    expect(a.elevationGainM).toBe(0);
    expect(a.difficulty).toBe('beginner');
  });
});
