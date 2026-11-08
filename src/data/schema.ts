/** Local database schema.
 *
 *  A SQLite database embedded in the device: everything the application needs
 *  during a hike lives here, with no server and no connectivity.
 *
 *  Migrations are applied in order and cumulatively. SQLite's `user_version`
 *  records the last one applied, so updating the application does not force
 *  the hiker to lose the trails already downloaded.
 */

export const SCHEMA_VERSION = 1;

export const MIGRATIONS: string[] = [
  // v1 - initial schema
  `
  CREATE TABLE IF NOT EXISTS trails (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    distance_m      REAL NOT NULL,
    elevation_gain_m REAL NOT NULL,
    effort_index    REAL NOT NULL,
    difficulty      TEXT NOT NULL CHECK (difficulty IN ('beginner','intermediate','advanced')),
    status          TEXT NOT NULL DEFAULT 'pending_review'
                         CHECK (status IN ('published','pending_review')),
    source          TEXT NOT NULL CHECK (source IN ('preloaded','imported')),
    downloaded_at   TEXT,
    created_at      TEXT NOT NULL
  );

  -- Track points live in their own table rather than as JSON inside the
  -- trail: the sequence is walked on every position fix, and a blob would
  -- force a full parse each time.
  CREATE TABLE IF NOT EXISTS track_points (
    trail_id  TEXT NOT NULL REFERENCES trails(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL,
    lat       REAL NOT NULL,
    lon       REAL NOT NULL,
    ele       REAL,
    time      TEXT,
    PRIMARY KEY (trail_id, position)
  );

  -- The hiker's account. A single row, enforced by the CHECK. No credential
  -- is stored on the device: identity is validated against the server when
  -- synchronising, so the hike can run without an active session.
  CREATE TABLE IF NOT EXISTS profile (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    name        TEXT,
    email       TEXT,
    level       TEXT NOT NULL CHECK (level IN ('beginner','intermediate','advanced')),
    theme       TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light','dark')),
    updated_at  TEXT NOT NULL
  );

  -- Trail condition reports written during a hike.
  CREATE TABLE IF NOT EXISTS reports (
    id             TEXT PRIMARY KEY,
    trail_id       TEXT NOT NULL REFERENCES trails(id) ON DELETE CASCADE,
    kind           TEXT NOT NULL,
    comment        TEXT,
    lat            REAL,
    lon            REAL,
    created_at     TEXT NOT NULL,
    synchronised_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_reports_trail ON reports(trail_id);

  -- Synchronisation queue. The UNIQUE constraint is what stops an
  -- interrupted sync from enqueuing the same work twice.
  CREATE TABLE IF NOT EXISTS sync_queue (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity      TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    operation   TEXT NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    last_error  TEXT,
    created_at  TEXT NOT NULL,
    UNIQUE (entity, entity_id, operation)
  );

  -- Forecast stored next to the trail, so the warning can still be shown once
  -- there is no connectivity, stating when it was obtained.
  CREATE TABLE IF NOT EXISTS forecasts (
    trail_id         TEXT NOT NULL REFERENCES trails(id) ON DELETE CASCADE,
    date             TEXT NOT NULL,
    precipitation_mm REAL NOT NULL,
    wind_kmh         REAL NOT NULL,
    min_temp_c       REAL NOT NULL,
    max_temp_c       REAL NOT NULL,
    obtained_at      TEXT NOT NULL,
    PRIMARY KEY (trail_id, date)
  );

  -- Traceability: what the system warned, when, and what the person decided.
  -- In a system whose subject is safety this is evidence, not an accessory.
  CREATE TABLE IF NOT EXISTS issued_alerts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    trail_id   TEXT REFERENCES trails(id) ON DELETE SET NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('deviation','weather','level')),
    detail     TEXT,
    accepted   INTEGER,
    issued_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_trail ON issued_alerts(trail_id);
  `,
];
