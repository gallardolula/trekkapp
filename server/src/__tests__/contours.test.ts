/** Contour generation, against grids whose answer is known by hand.
 *
 *  This is arithmetic nobody can eyeball on a finished map. A contour drawn
 *  slightly wrong still looks like a contour, and a hiker reading it would
 *  believe a slope that is not there, so the cases are checked against
 *  shapes whose contours can be worked out on paper: a plane that tilts one
 *  way, a cone, a plateau, a saddle.
 */
import {
  buildContours,
  isIndex,
  longEnough,
  toGeographic,
  type HeightGrid,
} from '../tiles/contours';

const BOUNDS = { west: -65, south: -32, east: -64, north: -31 };

/** A grid whose height at each sample is given by a function. */
function grid(width: number, height: number, f: (col: number, row: number) => number): HeightGrid {
  const values = new Int16Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) values[row * width + col] = Math.round(f(col, row));
  }
  return { width, height, values, bounds: BOUNDS };
}

describe('a slope that rises evenly to the east', () => {
  // Ten metres per column, so a contour every 100 m lands every ten
  // columns, and each one runs straight down the grid.
  const slope = grid(41, 11, (col) => col * 10);

  it('draws one line per level the ground crosses', () => {
    const lines = buildContours(slope, 100);
    expect(lines.map((l) => l.elevation).sort((a, b) => a - b)).toEqual([0, 100, 200, 300]);
  });

  it('runs each line from one edge of the grid to the other', () => {
    const line = buildContours(slope, 100).find((l) => l.elevation === 200)!;
    const rows = line.points.map((p) => p[1]);
    expect(Math.min(...rows)).toBeCloseTo(0, 5);
    expect(Math.max(...rows)).toBeCloseTo(10, 5);
  });

  it('puts the line where the ground reaches that height', () => {
    // 200 m is at column 20, and the level is offset half a metre, so the
    // line sits a twentieth of a column past it.
    const line = buildContours(slope, 100).find((l) => l.elevation === 200)!;
    for (const [col] of line.points) expect(col).toBeCloseTo(20.05, 2);
  });

  it('stitches the cells into one line rather than a pile of fragments', () => {
    // Ten cells tall, so eleven points if every crossing was joined.
    const line = buildContours(slope, 100).find((l) => l.elevation === 200)!;
    expect(line.points).toHaveLength(11);
  });

  it('refuses an interval that is not a height', () => {
    expect(() => buildContours(slope, 0)).toThrow();
    expect(() => buildContours(slope, -50)).toThrow();
  });
});

describe('a cone', () => {
  // A peak of 1000 m in the middle falling away in every direction.
  const cone = grid(61, 61, (col, row) => {
    const d = Math.hypot(col - 30, row - 30);
    return Math.max(0, 1000 - d * 30);
  });

  it('closes each contour into a ring', () => {
    const line = buildContours(cone, 100).find((l) => l.elevation === 500)!;
    const first = line.points[0]!;
    const last = line.points[line.points.length - 1]!;
    expect(last[0]).toBeCloseTo(first[0], 5);
    expect(last[1]).toBeCloseTo(first[1], 5);
  });

  it('nests the rings, the higher one inside the lower', () => {
    const radius = (elevation: number) => {
      const line = buildContours(cone, 100).find((l) => l.elevation === elevation)!;
      const distances = line.points.map((p) => Math.hypot(p[0] - 30, p[1] - 30));
      return distances.reduce((a, b) => a + b, 0) / distances.length;
    };
    expect(radius(800)).toBeLessThan(radius(500));
    expect(radius(500)).toBeLessThan(radius(200));
  });

  it('keeps every ring centred on the summit', () => {
    const line = buildContours(cone, 100).find((l) => l.elevation === 700)!;
    const xs = line.points.map((p) => p[0]);
    const ys = line.points.map((p) => p[1]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(30, 1);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(30, 1);
  });
});

describe('ground that does not produce contours', () => {
  it('draws nothing across a plateau', () => {
    // Every sample the same. The half metre offset is what stops a level
    // landing exactly on it and producing a tangle, which is the usual
    // failure over water and over the flat tops of the sierras.
    expect(buildContours(grid(20, 20, () => 900), 100)).toEqual([]);
  });

  it('draws nothing when the grid is entirely void', () => {
    const empty: HeightGrid = {
      width: 8,
      height: 8,
      values: new Int16Array(64).fill(-32768),
      bounds: BOUNDS,
    };
    expect(buildContours(empty, 50)).toEqual([]);
  });

  it('stops at the edge of a hole rather than drawing a cliff into it', () => {
    // A slope with a square of missing data in the middle. Interpolating
    // against the void marker would draw a wall around the hole.
    const holed = grid(41, 21, (col, row) =>
      col >= 15 && col <= 25 && row >= 8 && row <= 12 ? -32768 : col * 10,
    );
    const line = buildContours(holed, 100).find((l) => l.elevation === 200);
    expect(line).toBeDefined();
    for (const [, row] of line!.points) expect(row < 8 || row > 12).toBe(true);
  });
});

describe('a saddle', () => {
  it('resolves the ambiguous cell instead of crossing the lines', () => {
    // Two summits and two valleys meeting in the middle: the case where
    // the corners alone do not say which way the contour turns.
    const saddle = grid(41, 41, (col, row) => {
      const x = (col - 20) / 10;
      const y = (row - 20) / 10;
      return 1000 + (x * x - y * y) * 200;
    });
    const lines = buildContours(saddle, 100);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      for (const [col, row] of l.points) {
        expect(Number.isFinite(col)).toBe(true);
        expect(Number.isFinite(row)).toBe(true);
      }
    }
  });
});

describe('placing the lines on the earth', () => {
  const flat = grid(11, 11, (col) => col * 10);

  it('spreads longitude evenly, because the grid does', () => {
    const line = toGeographic(
      [
        [0, 0],
        [10, 0],
      ],
      flat,
    );
    expect(line[0]![0]).toBeCloseTo(-65, 6);
    expect(line[1]![0]).toBeCloseTo(-64, 6);
  });

  it('lands the corners of the grid on the corners of its box', () => {
    const line = toGeographic(
      [
        [0, 0],
        [10, 10],
      ],
      flat,
    );
    expect(line[0]![1]).toBeCloseTo(-31, 6);
    expect(line[1]![1]).toBeCloseTo(-32, 6);
  });

  it('spaces the rows in Mercator and not in latitude', () => {
    // The grid came from square tiles in Web Mercator, where a row near
    // the equator covers more latitude than one away from it. Treating the
    // rows as evenly spaced in latitude slides every contour off the
    // ground it belongs to, by more at the edges than in the middle.
    const middle = toGeographic([[0, 5]], flat)[0]![1];
    const evenlyInLatitude = -31.5;
    expect(middle).not.toBeCloseTo(evenlyInLatitude, 5);
    expect(Math.abs(middle - evenlyInLatitude)).toBeLessThan(0.02);
  });
});

describe('what reaches the map', () => {
  it('drops the specks a noisy grid produces', () => {
    const lines = [
      { elevation: 100, points: [[0, 0], [1, 1]] as [number, number][] },
      {
        elevation: 200,
        points: [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]] as [number, number][],
      },
    ];
    expect(longEnough(lines).map((l) => l.elevation)).toEqual([200]);
  });

  it('marks every fourth line as the one that carries a number', () => {
    // Without an index line a slope is a set of identical stripes nobody
    // can count.
    expect([0, 25, 50, 75, 100, 125].filter((e) => isIndex(e, 25))).toEqual([0, 100]);
  });
});

describe('geometry the renderer will accept', () => {
  // MapLibre refuses a line with a repeated point or with fewer than two,
  // and says so once per worker as "invalid geometry in line layer",
  // which names neither the layer nor the line.
  const slope = grid(41, 21, (col) => col * 10);

  it('never repeats a point within a line', () => {
    for (const line of buildContours(slope, 25)) {
      const projected = toGeographic(line.points, slope);
      for (let i = 1; i < projected.length; i++) {
        const a = projected[i - 1]!;
        const b = projected[i]!;
        expect(`${a[0]},${a[1]}`).not.toBe(`${b[0]},${b[1]}`);
      }
    }
  });

  it('never repeats a point in grid space either', () => {
    for (const line of buildContours(slope, 25)) {
      for (let i = 1; i < line.points.length; i++) {
        const a = line.points[i - 1]!;
        const b = line.points[i]!;
        expect(a[0] === b[0] && a[1] === b[1]).toBe(false);
      }
    }
  });

  it('drops a point that rounding collapsed onto the one before it', () => {
    // Two grid positions a few centimetres apart on the ground round to
    // the same coordinate, and the pair is a zero length piece of line.
    const tiny: HeightGrid = {
      width: 11,
      height: 11,
      values: new Int16Array(121),
      bounds: { west: -65, south: -32.000001, east: -64.999999, north: -32 },
    };
    const projected = toGeographic(
      [
        [0, 0],
        [0.0001, 0],
        [10, 10],
      ],
      tiny,
    );
    expect(projected.length).toBeLessThan(3);
  });

  it('leaves a line of genuinely distinct points alone', () => {
    const projected = toGeographic(
      [
        [0, 0],
        [20, 10],
        [40, 20],
      ],
      slope,
    );
    expect(projected).toHaveLength(3);
  });
});
