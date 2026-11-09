/** Access to the local SQLite database and the domain repositories.
 *
 *  The whole application works against this database: it is the heart of the
 *  offline-first architecture. Synchronising with the server is a separate,
 *  later process that reads from `sync_queue`.
 */
import * as SQLite from 'expo-sqlite';

import { uuidFromHex } from '../domain/identity';
import { computeAttributes } from '../domain/trail';
import { Forecast, Level, Point, Trail, TrailStatus } from '../domain/types';
import { MIGRATIONS, PREVIOUS_ACCOUNT_CLEANUP, retargetTrail } from './schema';

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

/**
 * A fresh identifier for something created on the device.
 *
 * The random bytes come from SQLite, which seeds its generator from the
 * operating system. React Native exposes no web crypto, so the alternative
 * would have been `Math.random`, and the whole idempotency of the upload
 * rests on these not colliding between devices.
 */
export async function newId(): Promise<string> {
  const db = await openDatabase();
  const row = await db.getFirstAsync<{ bytes: string }>(
    'SELECT hex(randomblob(16)) AS bytes',
  );
  return uuidFromHex(row!.bytes);
}

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
  // A trail imported from a file exists only on this phone until it is
  // contributed. It used to be stored as pending review, which described a
  // queue that no longer exists and that it was never in to begin with,
  // since nothing ever sent it anywhere.
  const status: TrailStatus =
    input.status ?? (input.source === 'imported' ? 'local' : 'published');

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
/**
 * A coarse version of a track, for drawing it small.
 *
 * The home screen draws one of these per card, and a trail holds thousands
 * of points. Reading them all to turn them into a shape a few centimetres
 * wide would make the list stutter for detail nobody can see at that size,
 * so the thinning is done by the database and not after the fact.
 */
export async function readTrackShape(trailId: string, atMost = 120): Promise<Point[]> {
  const db = await openDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM track_points WHERE trail_id = ?',
    trailId,
  );
  const total = row?.n ?? 0;
  if (total === 0) return [];

  const step = Math.max(1, Math.ceil(total / atMost));
  const rows = await db.getAllAsync<{ lat: number; lon: number; ele: number | null }>(
    `SELECT lat, lon, ele FROM track_points
      WHERE trail_id = ? AND (position % ? = 0 OR position = ?)
      ORDER BY position`,
    trailId,
    step,
    total - 1,
  );
  return rows.map((r) => ({ lat: r.lat, lon: r.lon, ...(r.ele !== null ? { ele: r.ele } : {}) }));
}

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
 *
 * The identifier is assigned here rather than by the caller, so that every
 * report carries one the server can store whatever screen wrote it.
 */
export async function saveReport(r: NewReport): Promise<string> {
  const db = await openDatabase();
  const createdAt = now();
  const id = await newId();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO reports (id, trail_id, kind, comment, lat, lon, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
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
      id,
      createdAt,
    );
  });

  return id;
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

// ------------------------------------------------------------ sync state --

/** Reads a value the synchronisation remembers between runs, such as a cursor. */
export async function readSyncState(key: string): Promise<string | null> {
  const db = await openDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM sync_state WHERE key = ?',
    key,
  );
  return row?.value ?? null;
}

export async function saveSyncState(key: string, value: string): Promise<void> {
  const db = await openDatabase();
  await db.runAsync(
    `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    value,
    now(),
  );
}

// --------------------------------------------------------------- identity --

export async function saveUserId(userId: string): Promise<void> {
  const db = await openDatabase();
  await db.runAsync('UPDATE profile SET user_id = ?, updated_at = ? WHERE id = 1', userId, now());
}

/**
 * Makes an account the one this device belongs to.
 *
 * Called when signing in, which is the one moment the device can find
 * itself holding somebody else's data. If the account that was here before
 * is a different one, what belonged to it is cleared before the new profile
 * is written, because an unsent report left in the queue would otherwise
 * travel up under the new account's name.
 *
 * Returns whether anything was cleared, so the screen can say so rather
 * than leaving the hiker to notice that their walks are gone.
 */
export async function adoptAccount(account: {
  userId: string;
  name: string;
  email: string;
  level: Level;
}): Promise<{ replaced: boolean }> {
  const db = await openDatabase();
  const previous = await readUserId();
  const replaced = previous !== null && previous !== account.userId;

  if (replaced) await db.execAsync(PREVIOUS_ACCOUNT_CLEANUP);

  await saveProfile({ name: account.name, email: account.email, level: account.level });
  await saveUserId(account.userId);

  return { replaced };
}

export async function readUserId(): Promise<string | null> {
  const db = await openDatabase();
  const row = await db.getFirstAsync<{ user_id: string | null }>(
    'SELECT user_id FROM profile WHERE id = 1',
  );
  return row?.user_id ?? null;
}

// ------------------------------------------------------- outbound reports --

export interface PendingReport {
  id: string;
  trailId: string;
  kind: string;
  comment?: string;
  lat?: number;
  lon?: number;
  createdAt: string;
}

/** Reports waiting in the queue, oldest first, with the queue's own order. */
export async function listPendingReports(limit = 100): Promise<PendingReport[]> {
  const db = await openDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    trail_id: string;
    kind: string;
    comment: string | null;
    lat: number | null;
    lon: number | null;
    created_at: string;
  }>(
    `SELECT r.id, r.trail_id, r.kind, r.comment, r.lat, r.lon, r.created_at
       FROM sync_queue q
       JOIN reports r ON r.id = q.entity_id
      WHERE q.entity = 'report' AND q.operation = 'create'
      ORDER BY q.created_at
      LIMIT ?`,
    limit,
  );
  return rows.map((r) => ({
    id: r.id,
    trailId: r.trail_id,
    kind: r.kind,
    createdAt: r.created_at,
    ...(r.comment !== null ? { comment: r.comment } : {}),
    ...(r.lat !== null ? { lat: r.lat } : {}),
    ...(r.lon !== null ? { lon: r.lon } : {}),
  }));
}

/**
 * Confirms reports the server accepted.
 *
 * The report is stamped and its queue entry removed in one transaction, so
 * the queue can never be emptied for something that was not recorded as
 * sent, nor keep an entry for something already confirmed.
 */
export async function confirmReportsSent(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDatabase();
  const marks = ids.map(() => '?').join(', ');
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE reports SET synchronised_at = ? WHERE id IN (${marks})`,
      now(),
      ...ids,
    );
    await db.runAsync(
      `DELETE FROM sync_queue WHERE entity = 'report' AND entity_id IN (${marks})`,
      ...ids,
    );
  });
}

/**
 * Records a rejection against the queue entry without dropping it.
 *
 * The entry stays so the failure is visible and can be inspected, rather
 * than a report disappearing with no trace of why it never arrived.
 */
export async function recordSyncFailure(id: string, reason: string): Promise<void> {
  const db = await openDatabase();
  await db.runAsync(
    `UPDATE sync_queue SET attempts = attempts + 1, last_error = ?
      WHERE entity = 'report' AND entity_id = ?`,
    reason,
    id,
  );
}

// -------------------------------------------------------- inbound records --

/** A trail as the server describes it, with the attributes it computed. */
export interface RemoteTrail {
  id: string;
  name: string;
  description?: string;
  status: TrailStatus;
  updatedAt: string;
  attributes: {
    distanceM: number;
    elevationGainM: number;
    effortIndex: number;
    difficulty: Level;
  };
}

/**
 * Stores a trail received from the server.
 *
 * Unlike `saveTrail`, the attributes are not recomputed. The server
 * recalculated them on ingest from the same geometry and the same domain
 * code, and recomputing them here would only create a second opinion.
 */
export async function saveRemoteTrail(trail: RemoteTrail): Promise<void> {
  const db = await openDatabase();
  await db.runAsync(
    `INSERT INTO trails
       (id, name, description, distance_m, elevation_gain_m, effort_index,
        difficulty, status, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'preloaded', ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       distance_m = excluded.distance_m,
       elevation_gain_m = excluded.elevation_gain_m,
       effort_index = excluded.effort_index,
       difficulty = excluded.difficulty,
       status = excluded.status,
       updated_at = excluded.updated_at`,
    trail.id,
    trail.name,
    trail.description ?? null,
    trail.attributes.distanceM,
    trail.attributes.elevationGainM,
    trail.attributes.effortIndex,
    trail.attributes.difficulty,
    trail.status,
    now(),
    trail.updatedAt,
  );
}

/** Replaces the geometry of a trail with the one the server holds. */
export async function saveTrackPoints(trailId: string, points: Point[]): Promise<void> {
  const db = await openDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM track_points WHERE trail_id = ?', trailId);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      await db.runAsync(
        'INSERT INTO track_points (trail_id, position, lat, lon, ele, time) VALUES (?, ?, ?, ?, ?, ?)',
        trailId,
        i,
        p.lat,
        p.lon,
        p.ele ?? null,
        p.time ?? null,
      );
    }
  });
}

export async function countTrackPoints(trailId: string): Promise<number> {
  const db = await openDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM track_points WHERE trail_id = ?',
    trailId,
  );
  return row?.n ?? 0;
}

export interface RemoteReport {
  id: string;
  trailId: string;
  kind: string;
  comment?: string;
  lat?: number;
  lon?: number;
  createdAt: string;
}

/**
 * Stores a report received from the server.
 *
 * A report of this hiker's own comes back once the server accepts it, and
 * it is the very same row, recognised by the identifier the device
 * generated. The ownership flag is therefore only set on insert and left
 * alone afterwards.
 */
export async function saveRemoteReport(report: RemoteReport, own: boolean): Promise<void> {
  const db = await openDatabase();
  await db.runAsync(
    `INSERT INTO reports
       (id, trail_id, kind, comment, lat, lon, created_at, synchronised_at, is_own)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       kind = excluded.kind,
       comment = excluded.comment,
       synchronised_at = excluded.synchronised_at`,
    report.id,
    report.trailId,
    report.kind,
    report.comment ?? null,
    report.lat ?? null,
    report.lon ?? null,
    report.createdAt,
    now(),
    own ? 1 : 0,
  );
}

export async function trailExists(trailId: string): Promise<boolean> {
  const db = await openDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM trails WHERE id = ?',
    trailId,
  );
  return (row?.n ?? 0) > 0;
}

export interface StoredReport {
  id: string;
  trailId: string;
  kind: string;
  comment?: string;
  /** Where on the path it was left. Absent on reports made before this. */
  lat?: number;
  lon?: number;
  createdAt: string;
  pending: boolean;
}

/** Reports of a trail, newest first, for the trail detail screen. */
export async function listTrailReports(trailId: string, limit = 20): Promise<StoredReport[]> {
  const db = await openDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    trail_id: string;
    kind: string;
    comment: string | null;
    lat: number | null;
    lon: number | null;
    created_at: string;
    synchronised_at: string | null;
  }>(
    `SELECT id, trail_id, kind, comment, lat, lon, created_at, synchronised_at
       FROM reports WHERE trail_id = ? ORDER BY created_at DESC LIMIT ?`,
    trailId,
    limit,
  );
  return rows.map((r) => ({
    id: r.id,
    trailId: r.trail_id,
    kind: r.kind,
    createdAt: r.created_at,
    pending: r.synchronised_at === null,
    ...(r.comment !== null ? { comment: r.comment } : {}),
    ...(r.lat !== null ? { lat: r.lat } : {}),
    ...(r.lon !== null ? { lon: r.lon } : {}),
  }));
}

// ------------------------------------------------------------------ hikes --

/** Starts recording a walk and returns its identifier. */
export async function startHike(trailId: string): Promise<string> {
  const db = await openDatabase();
  const id = await newId();
  await db.runAsync(
    'INSERT INTO hikes (id, trail_id, started_at) VALUES (?, ?, ?)',
    id,
    trailId,
    now(),
  );
  return id;
}

/**
 * Appends a position to the walk being recorded.
 *
 * One row per fix, written as it arrives rather than buffered in memory.
 * A hike lasts hours and the application can be killed at any point; what
 * is on disk is what survives.
 */
export async function appendHikePoint(
  hikeId: string,
  position: number,
  p: Point,
): Promise<void> {
  const db = await openDatabase();
  await db.runAsync(
    'INSERT OR REPLACE INTO hike_points (hike_id, position, lat, lon, ele, time) VALUES (?, ?, ?, ?, ?, ?)',
    hikeId,
    position,
    p.lat,
    p.lon,
    p.ele ?? null,
    p.time ?? now(),
  );
}

/**
 * Closes a recorded walk.
 *
 * A walk with no position readings is discarded rather than stored. It
 * means the hiker opened the screen and left, or the receiver never
 * reported, and neither is something worth keeping in a history.
 */
export async function finishHike(
  hikeId: string,
  summary: { distanceM: number; deviations: number },
): Promise<void> {
  const db = await openDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM hike_points WHERE hike_id = ?',
    hikeId,
  );
  if ((row?.n ?? 0) === 0) {
    await db.runAsync('DELETE FROM hikes WHERE id = ?', hikeId);
    return;
  }
  await db.runAsync(
    'UPDATE hikes SET finished_at = ?, distance_m = ?, deviations = ? WHERE id = ?',
    now(),
    summary.distanceM,
    summary.deviations,
    hikeId,
  );
}

/**
 * Removes walks that recorded nothing.
 *
 * Earlier versions opened a recording when the screen opened rather than
 * when the hiker started, so merely looking at a trail left an empty row
 * behind. This clears those and anything the application failed to close.
 */
export async function discardEmptyHikes(): Promise<number> {
  const db = await openDatabase();
  const result = await db.runAsync(
    `DELETE FROM hikes
      WHERE id NOT IN (SELECT DISTINCT hike_id FROM hike_points)`,
  );
  return result.changes;
}

export interface HikeSummary {
  id: string;
  trailId: string;
  trailName: string;
  startedAt: string;
  finishedAt: string | null;
  distanceM: number;
  deviations: number;
  points: number;
}

/** The hiker's own history, newest first. */
export async function listHikes(limit = 30): Promise<HikeSummary[]> {
  const db = await openDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    trail_id: string;
    trail_name: string;
    started_at: string;
    finished_at: string | null;
    distance_m: number;
    deviations: number;
    points: number;
  }>(
    `SELECT h.id, h.trail_id, t.name AS trail_name, h.started_at, h.finished_at,
            h.distance_m, h.deviations,
            (SELECT COUNT(*) FROM hike_points p WHERE p.hike_id = h.id) AS points
       FROM hikes h
       JOIN trails t ON t.id = h.trail_id
      ORDER BY h.started_at DESC
      LIMIT ?`,
    limit,
  );
  return rows.map((r) => ({
    id: r.id,
    trailId: r.trail_id,
    trailName: r.trail_name,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    distanceM: r.distance_m,
    deviations: r.deviations,
    points: r.points,
  }));
}

/**
 * Removes one walk from the history.
 *
 * The hiker's own record is theirs to curate. Earlier versions recorded
 * a simulated walk the moment the screen opened, so a history can hold
 * entries nobody chose to make, and those cannot be told apart from real
 * ones by looking at the data.
 */
export async function deleteHike(hikeId: string): Promise<void> {
  const db = await openDatabase();
  // The points go with it through the foreign key, but only when the
  // constraint is enforced, and it is cheaper to be explicit than to
  // depend on a pragma set elsewhere.
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM hike_points WHERE hike_id = ?', hikeId);
    await db.runAsync('DELETE FROM hikes WHERE id = ?', hikeId);
  });
}

/** The recorded path of one walk, for showing it over the trail. */
export async function readHikePoints(hikeId: string): Promise<Point[]> {
  const db = await openDatabase();
  const rows = await db.getAllAsync<{ lat: number; lon: number; ele: number | null; time: string }>(
    'SELECT lat, lon, ele, time FROM hike_points WHERE hike_id = ? ORDER BY position',
    hikeId,
  );
  return rows.map((r) => ({
    lat: r.lat,
    lon: r.lon,
    ...(r.ele !== null ? { ele: r.ele } : {}),
    time: r.time,
  }));
}

/**
 * Removes preloaded trails the application no longer ships.
 *
 * Seeding alone only ever adds, so a device that has been through several
 * versions accumulates every catalogue it was ever installed with. Only
 * preloaded rows are touched: a trail somebody imported is theirs, and one
 * the server sent arrives again on the next delta.
 */
export async function forgetPreloadedExcept(keep: string[]): Promise<void> {
  const db = await openDatabase();
  if (keep.length === 0) return;
  const marks = keep.map(() => '?').join(',');
  await db.runAsync(
    `DELETE FROM trails WHERE source = 'preloaded' AND id NOT IN (${marks})`,
    ...keep,
  );
}

// ----------------------------------------------------------------- photos --

export interface HikePhoto {
  id: string;
  hikeId: string;
  uri: string;
  lat?: number;
  lon?: number;
  takenAt: string;
  note?: string;
}

/**
 * Records a photograph taken during a walk.
 *
 * The file has already been copied into the application's own directory
 * by the caller; what is stored here is where it went. A photograph is a
 * megabyte or two and a database row is not where that belongs.
 */
export async function savePhoto(photo: {
  hikeId: string;
  uri: string;
  lat?: number;
  lon?: number;
  note?: string;
}): Promise<string> {
  const db = await openDatabase();
  const id = await newId();
  await db.runAsync(
    `INSERT INTO hike_photos (id, hike_id, uri, lat, lon, taken_at, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    photo.hikeId,
    photo.uri,
    photo.lat ?? null,
    photo.lon ?? null,
    now(),
    photo.note ?? null,
  );
  return id;
}

export async function listPhotos(hikeId: string): Promise<HikePhoto[]> {
  const db = await openDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    hike_id: string;
    uri: string;
    lat: number | null;
    lon: number | null;
    taken_at: string;
    note: string | null;
  }>('SELECT * FROM hike_photos WHERE hike_id = ? ORDER BY taken_at', hikeId);

  return rows.map((r) => ({
    id: r.id,
    hikeId: r.hike_id,
    uri: r.uri,
    takenAt: r.taken_at,
    ...(r.lat !== null ? { lat: r.lat } : {}),
    ...(r.lon !== null ? { lon: r.lon } : {}),
    ...(r.note !== null ? { note: r.note } : {}),
  }));
}

/** How many photographs each of these walks holds, for the history list. */
export async function countPhotos(hikeIds: string[]): Promise<Record<string, number>> {
  if (hikeIds.length === 0) return {};
  const db = await openDatabase();
  const marks = hikeIds.map(() => '?').join(',');
  const rows = await db.getAllAsync<{ hike_id: string; n: number }>(
    `SELECT hike_id, COUNT(*) AS n FROM hike_photos
      WHERE hike_id IN (${marks}) GROUP BY hike_id`,
    ...hikeIds,
  );
  return Object.fromEntries(rows.map((r) => [r.hike_id, r.n]));
}

/**
 * Forgets a photograph, returning the file so the caller can delete it.
 *
 * The row and the file are two things and only one of them is in a
 * transaction. The row goes first: a file with no row is wasted space, and
 * a row with no file is a gallery with a hole in it.
 */
export async function forgetPhoto(photoId: string): Promise<string | null> {
  const db = await openDatabase();
  const row = await db.getFirstAsync<{ uri: string }>(
    'SELECT uri FROM hike_photos WHERE id = ?',
    photoId,
  );
  if (!row) return null;
  await db.runAsync('DELETE FROM hike_photos WHERE id = ?', photoId);
  return row.uri;
}

/** The files of a walk, so they can be deleted along with it. */
export async function photoFilesOf(hikeId: string): Promise<string[]> {
  const db = await openDatabase();
  const rows = await db.getAllAsync<{ uri: string }>(
    'SELECT uri FROM hike_photos WHERE hike_id = ?',
    hikeId,
  );
  return rows.map((r) => r.uri);
}

// ------------------------------------------------- contributing a trail --

/**
 * Queues a trail for contribution, in the same queue the reports use.
 *
 * Queued rather than sent, because a trail is imported wherever the hiker
 * happens to be, which is often where there is no signal. It travels on
 * the next synchronisation like everything else the device produced.
 */
export async function queueTrailContribution(trailId: string): Promise<void> {
  const db = await openDatabase();
  await db.runAsync(
    `INSERT INTO sync_queue (entity, entity_id, operation, created_at)
     VALUES ('trail', ?, 'create', ?)
     ON CONFLICT (entity, entity_id, operation) DO NOTHING`,
    trailId,
    now(),
  );
}

export interface PendingTrail {
  id: string;
  name: string;
  description?: string;
  points: Point[];
}

/** Trails waiting to be contributed, oldest first. */
export async function listPendingTrails(limit = 5): Promise<PendingTrail[]> {
  const db = await openDatabase();
  const rows = await db.getAllAsync<{ id: string; name: string; description: string | null }>(
    `SELECT t.id, t.name, t.description
       FROM sync_queue q
       JOIN trails t ON t.id = q.entity_id
      WHERE q.entity = 'trail' AND q.operation = 'create'
      ORDER BY q.created_at
      LIMIT ?`,
    limit,
  );

  const pending: PendingTrail[] = [];
  for (const r of rows) {
    pending.push({
      id: r.id,
      name: r.name,
      points: await readTrackPoints(r.id),
      ...(r.description !== null ? { description: r.description } : {}),
    });
  }
  return pending;
}

/**
 * Adopts the identifier the server assigned to a contributed trail.
 *
 * The server generates its own, so without this the same path exists twice
 * under two identities: reports written here reference a trail the server
 * has never heard of, and the next delta brings its copy down beside the
 * local one. Everything hanging off the trail moves with it, inside one
 * transaction, because a half-moved trail is worse than either end of it.
 */
export async function adoptServerTrail(localId: string, serverId: string): Promise<void> {
  const db = await openDatabase();
  if (localId === serverId) {
    await db.runAsync("UPDATE trails SET status = 'published' WHERE id = ?", localId);
  } else {
    await db.withTransactionAsync(async () => {
      for (const [sql, params] of retargetTrail(localId, serverId)) {
        await db.runAsync(sql, ...(params as never[]));
      }
    });
  }
  await db.runAsync(
    "DELETE FROM sync_queue WHERE entity = 'trail' AND entity_id = ?",
    localId,
  );
}

/** Gives up on contributing a trail, which stays on this phone. */
export async function stopContributing(trailId: string, reason: string): Promise<void> {
  const db = await openDatabase();
  await db.runAsync(
    `UPDATE sync_queue SET attempts = attempts + 1, last_error = ?
      WHERE entity = 'trail' AND entity_id = ?`,
    reason,
    trailId,
  );
}
