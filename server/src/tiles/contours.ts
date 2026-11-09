/** Turning a grid of heights into contour lines.
 *
 *  The basemap carries no elevation, and for a map somebody reads on a
 *  mountain that is the missing half: a trail drawn across blank ground
 *  says nothing about whether the next kilometre is a stroll or a climb.
 *  The OpenMapTiles schema has no contours, so they are generated here from
 *  a separate elevation source and served as a second vector source.
 *
 *  Marching squares, which is the standard way. The grid is walked cell by
 *  cell; for every contour level that passes through a cell, the crossing
 *  points on its four edges are found by linear interpolation and joined
 *  into a segment. The segments are then stitched into long lines, because
 *  a contour broken into thousands of two point fragments renders badly,
 *  labels worse, and costs several times the bytes.
 *
 *  Everything here is pure arithmetic over a grid, with no knowledge of
 *  where the numbers came from or where the lines are going, which is what
 *  makes it testable without a network or a tile archive.
 */

/** Heights in metres, row major, north to south and west to east. */
export interface HeightGrid {
  width: number;
  height: number;
  /** Metres above sea level. Sea level itself is 0, below it is negative. */
  values: Int16Array;
  /** Geographic box the grid covers, corner to corner of its outer pixels. */
  bounds: { west: number; south: number; east: number; north: number };
}

export type Position = [number, number];

export interface ContourLine {
  /** The height this line follows, in metres. */
  elevation: number;
  /** Longitude and latitude pairs, in drawing order. */
  points: Position[];
}

/** No data. The elevation source writes this where it has no measurement. */
const VOID = -32768;

/**
 * Builds contour lines at every multiple of `interval` the grid crosses.
 *
 * Levels are offset by half a metre so a contour never runs exactly along
 * a row of equal samples, which is common over water and over the flat
 * tops of the sierras. On such a plateau a level that lands exactly on the
 * sample value produces a tangle of degenerate segments instead of a line.
 */
export function buildContours(grid: HeightGrid, interval: number): ContourLine[] {
  if (interval <= 0) throw new Error('The contour interval must be positive');

  let min = Infinity;
  let max = -Infinity;
  for (const v of grid.values) {
    if (v === VOID) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) return [];

  const lines: ContourLine[] = [];
  const first = Math.ceil((min - 0.5) / interval);
  const last = Math.floor((max - 0.5) / interval);

  for (let n = first; n <= last; n++) {
    // Normalised, because `Math.ceil` of a small negative gives negative
    // zero and it propagates through the multiplication. On a map at sea
    // level that reaches the reader as a contour labelled "-0 m".
    const level = n === 0 ? 0 : n * interval;
    const segments = traceLevel(grid, level + 0.5);
    for (const points of stitch(segments)) lines.push({ elevation: level, points });
  }

  return lines;
}

/** One cell's worth of crossings, in grid coordinates. */
type Segment = [number, number, number, number];

/**
 * Every segment of one contour level, in grid coordinates.
 *
 * The cell corners are numbered from the top left clockwise, and which
 * edges a contour crosses follows from which corners are above the level.
 * Of the sixteen cases, two are empty and two are ambiguous saddles; the
 * saddles are resolved by comparing the level against the average of the
 * four corners, which is the usual choice and keeps neighbouring cells
 * consistent with each other.
 */
function traceLevel(grid: HeightGrid, level: number): Segment[] {
  const { width, height, values } = grid;
  const segments: Segment[] = [];

  for (let row = 0; row < height - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
      const tl = values[row * width + col]!;
      const tr = values[row * width + col + 1]!;
      const br = values[(row + 1) * width + col + 1]!;
      const bl = values[(row + 1) * width + col]!;

      // A cell touching a hole in the data produces nothing. Interpolating
      // against the void marker would draw a cliff that is not there.
      if (tl === VOID || tr === VOID || br === VOID || bl === VOID) continue;

      let index = 0;
      if (tl > level) index |= 8;
      if (tr > level) index |= 4;
      if (br > level) index |= 2;
      if (bl > level) index |= 1;
      if (index === 0 || index === 15) continue;

      // Where the level crosses each edge, as a fraction along it.
      const top: Position = [col + fraction(tl, tr, level), row];
      const right: Position = [col + 1, row + fraction(tr, br, level)];
      const bottom: Position = [col + fraction(bl, br, level), row + 1];
      const left: Position = [col, row + fraction(tl, bl, level)];

      // A segment whose ends coincide is not a segment. It happens where
      // the level passes exactly through a corner of the cell, and it
      // reaches the map as a line of zero length, which the renderer
      // refuses as invalid geometry.
      const push = (a: Position, b: Position) => {
        if (a[0] === b[0] && a[1] === b[1]) return;
        segments.push([a[0], a[1], b[0], b[1]]);
      };

      switch (index) {
        case 1:
        case 14:
          push(left, bottom);
          break;
        case 2:
        case 13:
          push(bottom, right);
          break;
        case 3:
        case 12:
          push(left, right);
          break;
        case 4:
        case 11:
          push(top, right);
          break;
        case 6:
        case 9:
          push(top, bottom);
          break;
        case 7:
        case 8:
          push(top, left);
          break;
        // The saddles. Which pair of corners the contour wraps around
        // depends on the middle of the cell, not on the corners alone.
        case 5: {
          const middle = (tl + tr + br + bl) / 4;
          if (middle > level) {
            push(top, left);
            push(bottom, right);
          } else {
            push(top, right);
            push(left, bottom);
          }
          break;
        }
        case 10: {
          const middle = (tl + tr + br + bl) / 4;
          if (middle > level) {
            push(top, right);
            push(left, bottom);
          } else {
            push(top, left);
            push(bottom, right);
          }
          break;
        }
      }
    }
  }

  return segments;
}

/** How far between two samples the level falls, from 0 to 1. */
function fraction(a: number, b: number, level: number): number {
  if (a === b) return 0.5;
  const t = (level - a) / (b - a);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Joins the loose segments of one level into continuous lines.
 *
 * Segments meet exactly, because neighbouring cells interpolate the same
 * edge from the same pair of samples, so they can be matched on their
 * endpoints without a tolerance. The coordinates are still rounded before
 * being used as keys, since they are the result of a division and two
 * cells can land a bit apart in the last place.
 *
 * A segment is matched on either of its ends and reversed when needed,
 * rather than assuming they all point the same way around the slope.
 * Marching squares gives no such guarantee, and relying on one leaves
 * every ring cut open at the point where the direction flips.
 *
 * Each chain is also grown from both ends. Starting in the middle of a
 * contour and only following it forwards would throw away everything
 * behind the starting point, which is most of the line as often as not.
 */
function stitch(segments: Segment[]): Position[][] {
  const key = (x: number, y: number) => `${x.toFixed(5)},${y.toFixed(5)}`;
  const at = new Map<string, Segment[]>();

  const index = (k: string, s: Segment) => {
    const bucket = at.get(k);
    if (bucket) bucket.push(s);
    else at.set(k, [s]);
  };

  for (const s of segments) {
    index(key(s[0], s[1]), s);
    index(key(s[2], s[3]), s);
  }

  const used = new Set<Segment>();

  /** The far end of an unused segment touching this point, if there is one. */
  function step(x: number, y: number): Position | null {
    const bucket = at.get(key(x, y));
    if (!bucket) return null;
    for (const s of bucket) {
      if (used.has(s)) continue;
      used.add(s);
      // Whichever end was not the one we arrived on.
      return key(s[0], s[1]) === key(x, y) ? [s[2], s[3]] : [s[0], s[1]];
    }
    return null;
  }

  const lines: Position[][] = [];

  for (const seed of segments) {
    if (used.has(seed)) continue;
    used.add(seed);

    const points: Position[] = [
      [seed[0], seed[1]],
      [seed[2], seed[3]],
    ];

    for (;;) {
      const tail = points[points.length - 1]!;
      const next = step(tail[0], tail[1]);
      if (!next) break;
      points.push(next);
      // A closed ring: the contour came back to where it started.
      if (key(next[0], next[1]) === key(points[0]![0], points[0]![1])) break;
    }

    // Open at the far end too, unless it already closed on itself.
    const head = points[0]!;
    const tail = points[points.length - 1]!;
    if (key(head[0], head[1]) !== key(tail[0], tail[1])) {
      for (;;) {
        const first = points[0]!;
        const previous = step(first[0], first[1]);
        if (!previous) break;
        points.unshift(previous);
      }
    }

    if (points.length >= 2) lines.push(points);
  }

  return lines;
}

/**
 * Moves a line from grid coordinates into longitude and latitude.
 *
 * The grid came from square tiles in Web Mercator, so its rows are evenly
 * spaced in that projection and not in latitude. Spacing them evenly in
 * latitude instead would slide every contour north or south of where it
 * belongs, by more at the edges of the region than at its middle.
 */
export function toGeographic(line: Position[], grid: HeightGrid): Position[] {
  const { width, height, bounds } = grid;
  const northY = mercatorY(bounds.north);
  const southY = mercatorY(bounds.south);

  const projected = line.map(([col, row]) => {
    const lon = bounds.west + (col / (width - 1)) * (bounds.east - bounds.west);
    const y = northY + (row / (height - 1)) * (southY - northY);
    return [round(lon), round(fromMercatorY(y))] as Position;
  });

  // Rounding is the last thing that happens to a coordinate, and two points
  // a few centimetres apart land on the same one. A repeated point is a
  // zero length piece of line, which the renderer refuses outright.
  return withoutRepeats(projected);
}

/** Drops a point identical to the one before it. */
function withoutRepeats(points: Position[]): Position[] {
  const kept: Position[] = [];
  for (const p of points) {
    const previous = kept[kept.length - 1];
    if (previous && previous[0] === p[0] && previous[1] === p[1]) continue;
    kept.push(p);
  }
  return kept;
}

/** Six decimal places is about ten centimetres, far beyond what a contour means. */
const round = (v: number) => Math.round(v * 1e6) / 1e6;

function mercatorY(lat: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const r = (clamped * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + r / 2));
}

function fromMercatorY(y: number): number {
  return ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
}

/**
 * Drops lines too short to be worth drawing.
 *
 * A grid of real measurements is noisy, and near a level a few adjacent
 * samples wobbling across it produce specks a few pixels long. They cost
 * bytes on the phone and read as dirt on the map.
 */
export function longEnough(lines: ContourLine[], minimumPoints = 4): ContourLine[] {
  return lines.filter((l) => l.points.length >= minimumPoints);
}

/**
 * Whether a contour is an index line, the heavier one drawn every so often
 * and the only one that carries its height as a label.
 *
 * Without them a slope is a set of identical lines nobody can count. With
 * one in five picked out and numbered, the reader finds a height and
 * counts from it.
 */
export function isIndex(elevation: number, interval: number, every = 4): boolean {
  return Math.round(elevation / interval) % every === 0;
}
