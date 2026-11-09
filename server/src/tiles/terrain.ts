/** Reading the height of the ground anywhere in the covered area.
 *
 *  The heights come from the public terrain tiles of the AWS Open Data
 *  registry, which need no account and are derived from SRTM and NASADEM
 *  among others. They arrive encoded in the colour channels of a PNG,
 *  which is why this reads images rather than a terrain format.
 *
 *  Written once and used twice: the contour archive traces lines through a
 *  whole grid of these, and the catalogue asks for one height at a time
 *  along a path taken from OpenStreetMap, which carries none. Both are
 *  build time tasks on a laptop with a connection, which is the opposite
 *  of the conditions their output is used under.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PNG } from 'pngjs';

const TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

/** What the dataset writes where it has no measurement. */
export const NO_DATA = -32768;

export const lonToX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;

export function latToY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

export const xToLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;

export function yToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Where downloaded terrain tiles are kept between runs.
 *
 * A region is the better part of a thousand tiles, and changing a contour
 * interval or regenerating the catalogue means asking for the same ground,
 * which has not moved. Safe to delete at any time.
 */
export const cacheDir = (tilesDir: string) => join(tilesDir, '..', 'cache', 'terrarium');

/** Fetches one terrain tile, retrying, because this makes hundreds of them. */
export async function fetchTerrainTile(
  cache: string,
  z: number,
  x: number,
  y: number,
): Promise<Buffer | null> {
  const path = join(cache, String(z), String(x), `${y}.png`);
  if (existsSync(path)) return readFileSync(path);

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(`${TERRAIN}/${z}/${x}/${y}.png`);
      // Outside the coverage of the dataset, which over the ocean is normal.
      if (response.status === 404 || response.status === 403) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const body = Buffer.from(await response.arrayBuffer());
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body);
      return body;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  return null;
}

/**
 * Decodes one pixel of a terrarium tile into metres above sea level.
 *
 * The height is offset so that it is never negative and spread across the
 * three colour channels, which is what lets a PNG carry it losslessly.
 */
export function decodeHeight(image: PNG, px: number, py: number): number {
  const p = (py * image.width + px) * 4;
  return image.data[p]! * 256 + image.data[p + 1]! + image.data[p + 2]! / 256 - 32768;
}

/**
 * Reads heights one point at a time, holding the tiles it has decoded.
 *
 * A path from OpenStreetMap runs over a handful of tiles and asks for
 * hundreds of points, almost all of them from the tile the one before came
 * from, so decoding on every call would dominate the cost of the whole
 * catalogue.
 */
export class TerrainSampler {
  private readonly decoded = new Map<string, PNG | null>();

  constructor(
    private readonly cache: string,
    private readonly zoom = 13,
  ) {}

  /** Metres above sea level, or null where the dataset has nothing. */
  async heightAt(lat: number, lon: number): Promise<number | null> {
    const fx = lonToX(lon, this.zoom);
    const fy = latToY(lat, this.zoom);
    const x = Math.floor(fx);
    const y = Math.floor(fy);
    const key = `${x}/${y}`;

    if (!this.decoded.has(key)) {
      const png = await fetchTerrainTile(this.cache, this.zoom, x, y);
      this.decoded.set(key, png ? PNG.sync.read(png) : null);
    }

    const image = this.decoded.get(key);
    if (!image) return null;

    const px = Math.min(255, Math.max(0, Math.floor((fx - x) * 256)));
    const py = Math.min(255, Math.max(0, Math.floor((fy - y) * 256)));
    const metres = decodeHeight(image, px, py);
    return metres <= NO_DATA ? null : metres;
  }
}
