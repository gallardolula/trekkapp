import { buildProfile, describeGrade } from '../profile';
import type { Point } from '../types';

/** A track running north, a point every hundred metres or so. */
function track(elevations: number[]): Point[] {
  return elevations.map((ele, i) => ({ lat: -31.65 + i * 0.0009, lon: -64.68, ele }));
}

describe('building the profile', () => {
  it('measures distance along the ground, not point by point', () => {
    const p = buildProfile(track([1000, 1010, 1020]))!;
    // Three points about a hundred metres apart.
    expect(p.lengthM).toBeGreaterThan(180);
    expect(p.lengthM).toBeLessThan(220);
  });

  it('reports the lowest and highest ground on the walk', () => {
    const p = buildProfile(track([900, 1200, 1100, 1500, 800]))!;
    expect(p.minM).toBe(800);
    expect(p.maxM).toBe(1500);
  });

  it('starts at zero distance', () => {
    expect(buildProfile(track([900, 950]))!.samples[0]!.distanceM).toBe(0);
  });

  it('keeps both ends when it thins a long track', () => {
    const long = track(Array.from({ length: 2000 }, (_, i) => 900 + i));
    const p = buildProfile(long, 50)!;
    expect(p.samples).toHaveLength(50);
    expect(p.samples[0]!.elevationM).toBe(900);
    expect(p.samples[49]!.elevationM).toBe(2899);
  });

  it('says there is no profile when the track carries no heights', () => {
    // Several export tools drop the elevation. Drawing a flat line would
    // claim the walk is flat, which is a different thing from not knowing.
    const flat: Point[] = [
      { lat: -31.65, lon: -64.68 },
      { lat: -31.64, lon: -64.68 },
    ];
    expect(buildProfile(flat)).toBeNull();
  });

  it('says there is none for a track of a single point', () => {
    expect(buildProfile(track([900]))).toBeNull();
  });
});

describe('the hardest stretch', () => {
  it('finds the steep part of a walk that is otherwise flat', () => {
    // Twenty points flat, then ten climbing a hundred metres each.
    const elevations = [...Array(20).fill(1000), ...Array(10).fill(0).map((_, i) => 1000 + (i + 1) * 100)];
    const p = buildProfile(track(elevations))!;
    expect(p.steepest!.grade).toBeGreaterThan(0.8);
    // It begins after the flat kilometres, not at the start.
    expect(p.steepest!.fromM).toBeGreaterThan(1500);
  });

  it('ignores a single implausible step between two fixes', () => {
    // One bad reading in the middle of level ground. Measured between two
    // points it is a cliff; measured over a stretch it is nothing.
    const elevations = Array(40).fill(1000);
    elevations[20] = 1400;
    const p = buildProfile(track(elevations))!;
    expect(p.steepest!.grade).toBeLessThan(0.5);
  });

  it('reports a descent as the least steep rather than the steepest', () => {
    const p = buildProfile(track(Array.from({ length: 30 }, (_, i) => 2000 - i * 20)))!;
    expect(p.steepest!.grade).toBeLessThan(0);
  });

  it('has none on a track shorter than a stretch worth measuring', () => {
    expect(buildProfile(track([1000, 1010]))!.steepest).toBeNull();
  });
});

describe('putting a grade into words', () => {
  it('reads the bands a walker uses', () => {
    expect(describeGrade(0.02)).toContain('llano');
    expect(describeGrade(0.08)).toContain('suave');
    expect(describeGrade(0.18)).toContain('sostenida');
    expect(describeGrade(0.28)).toContain('exigente');
    expect(describeGrade(0.5)).toContain('trepada');
  });

  it('says the number too, because the words are a summary of it', () => {
    expect(describeGrade(0.18)).toContain('18 %');
  });
});
