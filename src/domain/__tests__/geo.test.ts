import { distanceToSegment, distanceToTrack, haversineDistance } from '../geo';
import { Point } from '../types';

/** One degree of latitude is about 111,320 m on any meridian. */
const M_PER_LAT_DEGREE = 111_320;

describe('haversineDistance', () => {
  it('returns zero between a point and itself', () => {
    const p: Point = { lat: -31.9, lon: -64.8 };
    expect(haversineDistance(p, p)).toBe(0);
  });

  it('measures one degree of latitude within 1 % error', () => {
    const d = haversineDistance({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    expect(d).toBeGreaterThan(M_PER_LAT_DEGREE * 0.99);
    expect(d).toBeLessThan(M_PER_LAT_DEGREE * 1.01);
  });

  it('is symmetric', () => {
    const a: Point = { lat: -31.9, lon: -64.8 };
    const b: Point = { lat: -31.95, lon: -64.75 };
    expect(haversineDistance(a, b)).toBeCloseTo(haversineDistance(b, a), 6);
  });

  it('shortens one degree of longitude as latitude grows', () => {
    const atEquator = haversineDistance({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    const atCordoba = haversineDistance({ lat: -31.9, lon: 0 }, { lat: -31.9, lon: 1 });
    expect(atCordoba).toBeLessThan(atEquator);
    // cos(31.9°) ≈ 0.849
    expect(atCordoba / atEquator).toBeCloseTo(Math.cos((31.9 * Math.PI) / 180), 3);
  });
});

describe('distanceToSegment', () => {
  const a: Point = { lat: 0, lon: 0 };
  const b: Point = { lat: 0, lon: 1 };

  it('measures the perpendicular when the projection falls inside', () => {
    const p: Point = { lat: 0.001, lon: 0.5 };
    expect(distanceToSegment(p, a, b)).toBeCloseTo(0.001 * M_PER_LAT_DEGREE, -1);
  });

  it('measures against the endpoint when the projection falls outside', () => {
    const p: Point = { lat: 0, lon: 1.5 };
    expect(distanceToSegment(p, a, b)).toBeCloseTo(haversineDistance(p, b), -1);
  });

  it('returns zero for a point lying on the segment', () => {
    expect(distanceToSegment({ lat: 0, lon: 0.5 }, a, b)).toBeCloseTo(0, 3);
  });

  it('handles a degenerate segment without dividing by zero', () => {
    const p: Point = { lat: 0.001, lon: 0 };
    const d = distanceToSegment(p, a, a);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeCloseTo(haversineDistance(p, a), 6);
  });
});

describe('distanceToTrack', () => {
  // L shaped track: runs down a meridian, then turns east.
  const track: Point[] = [
    { lat: 0, lon: 0 },
    { lat: -0.01, lon: 0 },
    { lat: -0.01, lon: 0.01 },
  ];

  it('picks the nearest segment, not the first one', () => {
    const r = distanceToTrack({ lat: -0.0101, lon: 0.005 }, track);
    expect(r.segmentIndex).toBe(1);
    expect(r.meters).toBeLessThan(20);
  });

  it('does not overstate the distance mid way along a long straight stretch', () => {
    // Measured only against the vertices this point would read about 550 m;
    // against the segment it reads about 11 m, which is the real distance.
    const r = distanceToTrack({ lat: -0.005, lon: 0.0001 }, track);
    expect(r.meters).toBeLessThan(20);
  });

  it('works with a single point track', () => {
    const r = distanceToTrack({ lat: 0.001, lon: 0 }, [{ lat: 0, lon: 0 }]);
    expect(r.meters).toBeCloseTo(M_PER_LAT_DEGREE * 0.001, -1);
  });

  it('rejects an empty track', () => {
    expect(() => distanceToTrack({ lat: 0, lon: 0 }, [])).toThrow();
  });
});
