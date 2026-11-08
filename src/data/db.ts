/** Access to the local SQLite database and the domain repositories.
 *
 *  The whole application works against this database: it is the heart of the
 *  offline-first architecture. Synchronising with the server is a separate,
 *  later process that reads from `sync_queue`.
 */
import * as SQLite from 'expo-sqlite';

import { computeAttributes } from '../domain/trail';
import { Forecast, Level, Point, Trail, TrailStatus } from '../domain/types';
import { MIGRATIONS } from './schema';

// The file name changed when the schema moved to English identifiers, so a
// device holding the previous one starts from a clean database instead of
// migrating tables that no longer exist.
const DATABASE_NAME = 'trekkapp.sqlite';

export type Theme = 'light' | 'dark';
export type TrailSource = 'preloaded' | 'imported';
export type AlertKind = 'deviation' | 'weather' | 'level';

let database: SQLite.SQLiteDatabase | null = null;

/** Opens the database and applies any pending migration. Idempotent. */
export async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;

  const connection = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await connection.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const row = await connection.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = row?.user_version ?? 0;

  for (let v = currentVersion; v < MIGRATIONS.length; v++) {
    await connection.execAsync(MIGRATIONS[v]);
    await connection.execAsync(`PRAGMA user_version = ${v + 1}`);
  }

  database = connection;
  return database;
}

/** Closes the database. Only used in tests and when resetting storage. */
export async function closeDatabase(): Promise<void> {
  await database?.closeAsync();
  database = null;
}

const now = () => new Date().toISOString();

// ---------------------------------------------------------------- profile --

export interface Profile {
  name: string;
  email: string;
  level: Level;
  theme: Theme;
}

/** Returns the hiker's profile, or null when they have not signed up yet. */
export async function readProfile(): Promise<Profile | null> {
  const db = await openDatabase();
  const row = await db.getFirstAsync<{
    name: string | null;
    email: string | null;
    level: Level;
    theme: Theme | null;
  }>('SELECT name, email, level, theme FROM profile WHERE id = 1');
  if (!row) return null;
  return {
    name: row.name ?? '',
    email: row.email ?? '',
    level: row.level,
    theme: row.theme ?? 'light',
  };
}

/**
 * Creates the hiker's account or updates its data.
 *
 * No credential is kept on the device. Identity is validated against the
 * server when synchronising, so that the hike can run without a session.
 */
export async function saveProfile(p: {
  name: string;
  email: string;
  level: Level;
  theme?: Theme;
}): Promise<void> {
  const db = await openDatabase();
  await db.runAsync(
    `INSERT INTO profile (id, name, email, level, theme, updated_at)
     VALUES (1, ?, ?, ?, COALESCE(?, 'light'), ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       email = excluded.email,
       level = excluded.level,
       theme = COALESCE(excluded.theme, profile.theme),
       updated_at = excluded.updated_at`,
    p.name,
    p.email,
    p.level,
    p.theme ?? null,
    now(),
  );
}

export async function saveTheme(theme: Theme): Promise<void> {
  const db = await openDatabase();
  await db.runAsync('UPDATE profile SET theme = ?, updated_at = ? WHERE id = 1', theme, now());
}

export async function saveLevel(level: Level): Promise<void> {
  const db = await openDatabase();
  await db.runAsync('UPDATE profile SET level = ?, updated_at = ? WHERE id = 1', level, now());
}

// ----------------------------------------------------------------- trails --

interface TrailRow {
  id: string;
  name: string;
  description: string | null;
  distance_m: number;
  elevation_gain_m: number;
  effort_index: number;
  difficulty: Level;
  status: TrailStatus;
  downloaded_at: string | null;
}

/** A trail without its points, so the catalogue can be listed cheaply. */
export type TrailSummary = Omit<Trail, 'points'> & { downloadedAt: string | null };

const toSummary = (r: TrailRow): TrailSummary => ({
  id: r.id,
  name: r.name,
  description: r.description ?? undefined,
  status: r.status,
  downloadedAt: r.downloaded_at,
  attributes: {
    distanceM: r.distance_m,
    elevationGainM: r.elevation_gain_m,
    effortIndex: r.effort_index,
    difficulty: r.difficulty,
  },
});

/**
 * Stores a trail together with its track.
 *
 * The technical attributes are computed here from the points and never
 * received from outside, so nobody can publish a route declaring a difficulty
 * its geometry does not support.
 */
export async function saveTrail(input: {
  id: string;
  name: string;
  description?: string;
  points: Point[];
  source: TrailSource;
  status?: TrailStatus;
}): Promise<TrailSummary> {
  const db = await openDatabase();
  const attributes = computeAttributes(input.points);
  // A route contributed by a hiker arrives pending review.
  const status =
    input.status ?? (input.source === 'imported' ? 'pending_review' : 'published');

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO trails
         (id, name, description, distance_m, elevation_gain_m, effort_index,
          difficulty, status, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         distance_m = excluded.distance_m,
         elevation_gain_m = excluded.elevation_gain_m,
         effort_index = excluded.effort_index,
         difficulty = excluded.difficulty`,
      input.id,
      input.name,
      input.description ?? null,
      attributes.distanceM,
      attributes.elevationGainM,
      attributes.effortIndex,
      attributes.difficulty,
      status,
      input.source,
      now(),
    );

    await db.runAsync('DELETE FROM track_points WHERE trail_id = ?', input.id);
    for (let i = 0; i < input.points.length; i++) {
      const p = input.points[i];
      await db.runAsync(
        'INSERT INTO track_points (trail_id, position, lat, lon, ele, time) VALUES (?, ?, ?, ?, ?, ?)',
        input.id,
        i,
        p.lat,
        p.lon,
        p.ele ?? null,
        p.time ?? null,
      );
    }
  });

  return {
    id: input.id,
    name: input.name,
    description: input.description,
    attributes,
    status,
    downloadedAt: null,
  };
}

export async function listTrails(): Promise<TrailSummary[]> {
  const db = await openDatabase();
  const rows = await db.getAllAsync<TrailRow>(
    `SELECT id, name, description, distance_m, elevation_gain_m, effort_index,
            difficulty, status, downloaded_at
       FROM trails ORDER BY name`,
  );
  return rows.map(toSummary);
}

/** Loads the full track. Called when opening a trail, never when listing. */
export async function readTrackPoints(trailId: string): Promise<Point[]> {
  const db = await openDatabase();
  const rows = await db.getAllAsync<{
    lat: number;
    lon: number;
    ele: number | null;
    time: string | null;
  }>('SELECT lat, lon, ele, time FROM track_points WHERE trail_id = ? ORDER BY position', trailId);

  return rows.map((r) => ({
    lat: r.lat,
    lon: r.lon,
    ...(r.ele !== null ? { ele: r.ele } : {}),
    ...(r.time !== null ? { time: r.time } : {}),
  }));
}

export async function markDownloaded(trailId: string): Promise<void> {
  const db = await openDatabase();
  await db.runAsync('UPDATE trails SET downloaded_at = ? WHERE id = ?', now(), trailId);
}

// ---------------------------------------------------------------- reports --

export interface NewReport {
  id: string;
  trailId: string;
  kind: string;
  comment?: string;
  lat?: number;
  lon?: number;
}

/**
 * Stores a report and enqueues it for synchronisation, in one transaction.
 *
 * Making both writes atomic is what guarantees that no report is left stored
 * but never sent, nor a queue entry left without its report.
 */
export async function saveReport(r: NewReport): Promise<void> {
  const db = await openDatabase();
  const createdAt = now();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO reports (id, trail_id, kind, comment, lat, lon, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      r.id,
      r.trailId,
      r.kind,
      r.comment ?? null,
      r.lat ?? null,
      r.lon ?? null,
      createdAt,
    );
    await db.runAsync(
      `INSERT INTO sync_queue (entity, entity_id, operation, created_at)
       VALUES ('report', ?, 'create', ?)
       ON CONFLICT (entity, entity_id, operation) DO NOTHING`,
      r.id,
      createdAt,
    );
  });
}

export async function countPendingSync(): Promise<number> {
  const db = await openDatabase();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_queue');
  return row?.n ?? 0;
}

// -------------------------------------------------------------- forecasts --

export async function saveForecast(trailId: string, f: Forecast): Promise<void> {
  const db = await openDatabase();
  await db.runAsync(
    `INSERT INTO forecasts
       (trail_id, date, precipitation_mm, wind_kmh, min_temp_c, max_temp_c, obtained_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(trail_id, date) DO UPDATE SET
       precipitation_mm = excluded.precipitation_mm,
       wind_kmh = excluded.wind_kmh,
       min_temp_c = excluded.min_temp_c,
       max_temp_c = excluded.max_temp_c,
       obtained_at = excluded.obtained_at`,
    trailId,
    f.date,
    f.precipitationMm,
    f.windKmh,
    f.minTempC,
    f.maxTempC,
    now(),
  );
}

/** Returns the stored forecast together with when it was obtained. */
export async function readForecast(
  trailId: string,
  date: string,
): Promise<{ forecast: Forecast; obtainedAt: string } | null> {
  const db = await openDatabase();
  const r = await db.getFirstAsync<{
    date: string;
    precipitation_mm: number;
    wind_kmh: number;
    min_temp_c: number;
    max_temp_c: number;
    obtained_at: string;
  }>('SELECT * FROM forecasts WHERE trail_id = ? AND date = ?', trailId, date);

  if (!r) return null;
  return {
    forecast: {
      date: r.date,
      precipitationMm: r.precipitation_mm,
      windKmh: r.wind_kmh,
      minTempC: r.min_temp_c,
      maxTempC: r.max_temp_c,
    },
    obtainedAt: r.obtained_at,
  };
}

// ----------------------------------------------------------------- alerts --

/** Records an issued warning and, where it applies, the hiker's decision. */
export async function recordAlert(a: {
  trailId?: string;
  kind: AlertKind;
  detail?: string;
  accepted?: boolean;
}): Promise<void> {
  const db = await openDatabase();
  await db.runAsync(
    `INSERT INTO issued_alerts (trail_id, kind, detail, accepted, issued_at)
     VALUES (?, ?, ?, ?, ?)`,
    a.trailId ?? null,
    a.kind,
    a.detail ?? null,
    a.accepted === undefined ? null : a.accepted ? 1 : 0,
    now(),
  );
}
