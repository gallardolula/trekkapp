/** Reads a vector tile archive produced by Planetiler.
 *
 *  An MBTiles file is a SQLite database, so it is read with the runtime's
 *  own SQLite rather than a dependency. Archives are opened once and kept
 *  open: a hike downloads thousands of tiles and reopening the file per
 *  request would dominate the cost of serving one.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface RegionDefinition {
  id: string;
  name: string;
  description: string;
  bounds: { west: number; south: number; east: number; north: number };
  minZoom: number;
  maxZoom: number;
}

export interface RegionStatus extends RegionDefinition {
  available: boolean;
  sizeBytes: number;
  tileCount: number;
  /** Changes whenever the archive is regenerated, so a device can tell. */
  version: string;
}

const open = new Map<string, DatabaseSync>();

function archivePath(directory: string, id: string): string {
  return join(directory, `${id}.mbtiles`);
}

function database(directory: string, id: string): DatabaseSync | null {
  const cached = open.get(id);
  if (cached) return cached;

  const path = archivePath(directory, id);
  if (!existsSync(path)) return null;

  const db = new DatabaseSync(path, { readOnly: true });
  open.set(id, db);
  return db;
}

export function closeArchives(): void {
  for (const db of open.values()) db.close();
  open.clear();
}

export function describe(directory: string, region: RegionDefinition): RegionStatus {
  const path = archivePath(directory, region.id);
  if (!existsSync(path)) {
    return { ...region, available: false, sizeBytes: 0, tileCount: 0, version: 'none' };
  }

  const stat = statSync(path);
  const db = database(directory, region.id)!;
  const row = db.prepare('SELECT count(*) AS n FROM tiles').get() as { n: number };

  return {
    ...region,
    available: true,
    sizeBytes: stat.size,
    tileCount: Number(row.n),
    // Derived from the file itself, so regenerating the archive changes it
    // without anyone having to remember to bump a number.
    version: `${stat.mtimeMs.toFixed(0)}-${stat.size}`,
  };
}

/**
 * Returns one tile, or null when the archive or the tile is absent.
 *
 * MBTiles addresses rows by the TMS scheme, whose vertical axis runs the
 * other way round from the one every map client uses. The conversion
 * happens here so nothing above this file has to know.
 */
export function readTile(
  directory: string,
  id: string,
  z: number,
  x: number,
  y: number,
): Uint8Array | null {
  const db = database(directory, id);
  if (!db) return null;

  const flippedY = 2 ** z - 1 - y;
  const row = db
    .prepare('SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?')
    .get(z, x, flippedY) as { tile_data: Uint8Array } | undefined;

  return row?.tile_data ?? null;
}
