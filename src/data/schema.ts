/** Local database schema.
 *
 *  A SQLite database embedded in the device: everything the application needs
 *  during a hike lives here, with no server and no connectivity.
 *
 *  Migrations are applied in order and cumulatively. SQLite's `user_version`
 *  records the last one applied, so updating the application does not force
 *  the hiker to lose the trails already downloaded.
 */

export const SCHEMA_VERSION = 8;

/**
 * A version 4 UUID built by SQLite itself.
 *
 * Used by the migration that rewrites the identifiers created under the old
 * scheme. `randomblob` draws on the generator SQLite seeds from the
 * operating system, so the rewritten identifiers are as good as the ones the
 * application now generates. The version and variant digits are fixed
 * rather than random, which is what makes the result parse as a UUID.
 */
const UUID = `lower(
  hex(randomblob(4)) || '-' ||
  hex(randomblob(2)) || '-4' ||
  substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', abs(random()) % 4 + 1, 1) ||
  substr(hex(randomblob(2)), 2) || '-' ||
  hex(randomblob(6))
)`;

/**
 * Clears what belonged to the account that was signed in before.
 *
 * Run when somebody signs in on a device that was holding a different
 * account. The queue is the reason this cannot be skipped: an unsent report
 * left there would travel up under the new account's name, attributed to
 * somebody who never wrote it. The cursors have to go for the opposite
 * reason, because they claim the device already holds everything up to a
 * point and the new account would never receive what came before it.
 *
 * The preloaded catalogue and its geometry stay. They belong to nobody, and
 * downloading them again needs coverage the hiker may not have at the
 * moment they sign in. A trail somebody imported is not part of that
 * catalogue and goes with the account that imported it.
 */
export const PREVIOUS_ACCOUNT_CLEANUP = `
  DELETE FROM sync_queue;
  DELETE FROM sync_state;
  DELETE FROM issued_alerts;
  DELETE FROM hikes;
  DELETE FROM reports;
  DELETE FROM trails WHERE source = 'imported';
`;

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

  // v2 - what synchronising with the server needs
  `
  -- Delta cursors and anything else the sync has to remember between runs.
  -- A table rather than a preferences file, so a cursor advances inside the
  -- same transaction that stores the rows it accounts for.
  CREATE TABLE IF NOT EXISTS sync_state (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  -- The account lives on the server. The identifier is kept here so a report
  -- can be attributed before the first synchronisation, and so the device
  -- can tell that the profile it holds belongs to the session it has.
  ALTER TABLE profile ADD COLUMN user_id TEXT;

  -- Reports written on this device and reports pulled from the server share
  -- a table, because a report of mine comes back from the server once it is
  -- accepted and is then the very same row. The flag is what the profile
  -- uses to list only what this hiker wrote.
  ALTER TABLE reports ADD COLUMN is_own INTEGER NOT NULL DEFAULT 1;

  -- Mirrors the server's cursor column, so a trail already up to date is not
  -- written again on every delta.
  ALTER TABLE trails ADD COLUMN updated_at TEXT;
  `,

  // v3 - the preloaded trails take identifiers the server can represent
  `
  -- Until now a preloaded trail was identified by a slug, which the server
  -- cannot store because it identifies trails by UUID. The seed now uses
  -- fixed UUIDs, so the rows written under the old scheme are removed to
  -- avoid holding the same trail twice under two identities. Nothing is
  -- lost: the seed rewrites them on the next start, and a trail the hiker
  -- imported is not preloaded and is left alone.
  DELETE FROM trails WHERE source = 'preloaded' AND length(id) <> 36;
  `,

  // v4 - the hike as it was actually walked
  `
  -- What the hiker did, as opposed to what the trail says. The two differ
  -- whenever somebody takes a detour, turns back early or loses the path,
  -- and the difference is the interesting part.
  CREATE TABLE IF NOT EXISTS hikes (
    id           TEXT PRIMARY KEY,
    trail_id     TEXT NOT NULL REFERENCES trails(id) ON DELETE CASCADE,
    started_at   TEXT NOT NULL,
    finished_at  TEXT,
    distance_m   REAL NOT NULL DEFAULT 0,
    -- How many times the deviation alert opened during the walk. Kept here
    -- rather than counted from issued_alerts so a hike keeps its own record
    -- even if the alert log is pruned.
    deviations   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_hikes_trail ON hikes(trail_id);

  -- Separate rows for the same reason the trail's own geometry is: the
  -- sequence is appended to on every position fix and read whole.
  CREATE TABLE IF NOT EXISTS hike_points (
    hike_id   TEXT NOT NULL REFERENCES hikes(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL,
    lat       REAL NOT NULL,
    lon       REAL NOT NULL,
    ele       REAL,
    time      TEXT NOT NULL,
    PRIMARY KEY (hike_id, position)
  );
  `,

  // v5 - identifiers the server can store
  `
  -- A report and an imported trail used to be identified by the clock, as
  -- 'report-1762700000000'. The server identifies both by UUID and rejects
  -- the whole upload when one row does not carry one, so a single report
  -- written under the old scheme blocked every later synchronisation.
  --
  -- The rows are kept and renamed rather than discarded: a report describes
  -- a fallen tree somebody found, and it is the only copy there is.
  CREATE TEMP TABLE id_map (kind TEXT NOT NULL, old TEXT NOT NULL, new TEXT NOT NULL);

  INSERT INTO id_map (kind, old, new)
  SELECT 'trail', id, ${UUID} FROM trails WHERE length(id) <> 36;

  -- A trail is a parent row, and the foreign keys declare no ON UPDATE, so
  -- renaming it in place would be refused. The row is copied under its new
  -- identifier, the children are pointed at the copy, and the original is
  -- deleted: by then nothing refers to it, so the cascade takes nothing.
  INSERT INTO trails (id, name, description, distance_m, elevation_gain_m, effort_index,
                      difficulty, status, source, downloaded_at, created_at, updated_at)
  SELECT m.new, t.name, t.description, t.distance_m, t.elevation_gain_m, t.effort_index,
         t.difficulty, t.status, t.source, t.downloaded_at, t.created_at, t.updated_at
    FROM trails t JOIN id_map m ON m.kind = 'trail' AND m.old = t.id;

  UPDATE track_points
     SET trail_id = (SELECT new FROM id_map WHERE kind = 'trail' AND old = track_points.trail_id)
   WHERE trail_id IN (SELECT old FROM id_map WHERE kind = 'trail');

  UPDATE reports
     SET trail_id = (SELECT new FROM id_map WHERE kind = 'trail' AND old = reports.trail_id)
   WHERE trail_id IN (SELECT old FROM id_map WHERE kind = 'trail');

  UPDATE forecasts
     SET trail_id = (SELECT new FROM id_map WHERE kind = 'trail' AND old = forecasts.trail_id)
   WHERE trail_id IN (SELECT old FROM id_map WHERE kind = 'trail');

  UPDATE issued_alerts
     SET trail_id = (SELECT new FROM id_map WHERE kind = 'trail' AND old = issued_alerts.trail_id)
   WHERE trail_id IN (SELECT old FROM id_map WHERE kind = 'trail');

  UPDATE hikes
     SET trail_id = (SELECT new FROM id_map WHERE kind = 'trail' AND old = hikes.trail_id)
   WHERE trail_id IN (SELECT old FROM id_map WHERE kind = 'trail');

  DELETE FROM trails WHERE id IN (SELECT old FROM id_map WHERE kind = 'trail');

  -- A report is a child row and nothing declares a foreign key to it, so it
  -- is renamed where it stands. Its queue entry travels with it, and has to
  -- move first: afterwards there is nothing left to match it by.
  INSERT INTO id_map (kind, old, new)
  SELECT 'report', id, ${UUID} FROM reports WHERE length(id) <> 36;

  UPDATE sync_queue
     SET entity_id = (SELECT new FROM id_map WHERE kind = 'report' AND old = sync_queue.entity_id)
   WHERE entity = 'report'
     AND entity_id IN (SELECT old FROM id_map WHERE kind = 'report');

  UPDATE reports
     SET id = (SELECT new FROM id_map WHERE kind = 'report' AND old = reports.id)
   WHERE id IN (SELECT old FROM id_map WHERE kind = 'report');

  DROP TABLE id_map;
  `,

  // v6 - the trail states say what is true
  `
  -- 'pending_review' described a queue a moderator worked. Nobody could
  -- hold that role, nothing ever left that state, and a review of a track
  -- on a screen could not establish what mattered about a route anyway.
  -- The server validates a contribution and publishes or refuses it now.
  --
  -- What the device holds under that name is a trail imported from a file,
  -- which was never sent anywhere and exists only here, so it becomes
  -- 'local'. 'withdrawn' is the other new state, for a trail that was in
  -- the shared catalogue and was taken out of it.
  --
  -- SQLite cannot alter a CHECK, so the table is rebuilt. The order
  -- matters: foreign keys are deferred for the rename, the rows are copied,
  -- and only then do the children find their parent again.
  PRAGMA foreign_keys = OFF;

  CREATE TABLE trails_v6 (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    distance_m      REAL NOT NULL,
    elevation_gain_m REAL NOT NULL,
    effort_index    REAL NOT NULL,
    difficulty      TEXT NOT NULL CHECK (difficulty IN ('beginner','intermediate','advanced')),
    status          TEXT NOT NULL DEFAULT 'local'
                         CHECK (status IN ('published','withdrawn','local')),
    source          TEXT NOT NULL CHECK (source IN ('preloaded','imported')),
    downloaded_at   TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT
  );

  INSERT INTO trails_v6
    (id, name, description, distance_m, elevation_gain_m, effort_index,
     difficulty, status, source, downloaded_at, created_at, updated_at)
  SELECT id, name, description, distance_m, elevation_gain_m, effort_index,
         difficulty,
         CASE WHEN status = 'pending_review' THEN 'local' ELSE status END,
         source, downloaded_at, created_at, updated_at
    FROM trails;

  DROP TABLE trails;
  ALTER TABLE trails_v6 RENAME TO trails;

  PRAGMA foreign_keys = ON;
  `,

  // v7 - a report says what kind of thing it is, in a vocabulary
  `
  -- The kind used to be whatever Spanish wording the screen happened to
  -- show, stored as it read. Two people describing the same obstacle left
  -- two different kinds, nothing could count them together, and changing a
  -- label on screen would have changed what the stored rows meant.
  --
  -- It is an identifier now, from the catalogue in domain/reports.ts, which
  -- also carries the severity that decides whether enough reports take a
  -- trail out of the catalogue. See that file.
  UPDATE reports SET kind = 'flooded_ford'  WHERE kind = 'Vado crecido';
  UPDATE reports SET kind = 'lost_markings' WHERE kind = 'Marca borrada';
  UPDATE reports SET kind = 'path_blocked'  WHERE kind = 'Paso cerrado';

  -- Anything else was free text. It becomes 'other', and the wording moves
  -- into the comment rather than being thrown away: somebody wrote it about
  -- a real thing they found on a real path.
  UPDATE reports
     SET comment = CASE
           WHEN comment IS NULL OR comment = '' THEN kind
           ELSE kind || '. ' || comment
         END,
         kind = 'other'
   WHERE kind NOT IN (
     'path_blocked', 'flooded_ford', 'lost_markings',
     'loose_terrain', 'no_water', 'livestock', 'other'
   );
  `,

  // v8 - photographs of your own walk
  `
  -- Taken during a walk and kept on the phone that took them. They are
  -- not sent anywhere, not attached to a report and not visible to anyone
  -- else, which is what makes them cost nothing to moderate: there is no
  -- audience to protect. What somebody photographs on their own outing is
  -- theirs the way the track of that outing is.
  --
  -- The file itself lives in the application's own directory and only its
  -- address is stored here. A photograph is a megabyte or two and a
  -- database row is not where that belongs.
  CREATE TABLE IF NOT EXISTS hike_photos (
    id         TEXT PRIMARY KEY,
    hike_id    TEXT NOT NULL REFERENCES hikes(id) ON DELETE CASCADE,
    uri        TEXT NOT NULL,
    -- Where it was taken, when the receiver had answered by then. It is
    -- what lets a photograph sit on the map at the place it belongs to.
    lat        REAL,
    lon        REAL,
    taken_at   TEXT NOT NULL,
    note       TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_photos_hike ON hike_photos(hike_id);
  `,
];

/**
 * Moves a trail, and everything hanging off it, onto another identifier.
 *
 * Needed when a trail the device created is accepted by the server, which
 * assigns an identifier of its own: the row has to become that one, or the
 * same path exists twice under two identities, reports written about it
 * reference a trail the server has never heard of, and the next delta
 * brings the server's copy down alongside the local one.
 *
 * A trail is a parent row and the foreign keys declare no ON UPDATE, so
 * renaming it in place is refused. The row is copied under the new
 * identifier, the children are pointed at the copy, and only then is the
 * original deleted, by which time nothing refers to it and the cascade
 * takes nothing. The same shape as the rewrite in migration v5.
 *
 * Returned as statements rather than executed here so the sequence can be
 * exercised against real SQLite, which is the only way to catch a child
 * table that was forgotten.
 */
export function retargetTrail(from: string, to: string): [string, unknown[]][] {
  return [
    [
      `INSERT INTO trails (id, name, description, distance_m, elevation_gain_m,
                           effort_index, difficulty, status, source,
                           downloaded_at, created_at, updated_at)
       SELECT ?, name, description, distance_m, elevation_gain_m, effort_index,
              difficulty, 'published', source, downloaded_at, created_at, updated_at
         FROM trails WHERE id = ?`,
      [to, from],
    ],
    ['UPDATE track_points SET trail_id = ? WHERE trail_id = ?', [to, from]],
    ['UPDATE reports SET trail_id = ? WHERE trail_id = ?', [to, from]],
    ['UPDATE forecasts SET trail_id = ? WHERE trail_id = ?', [to, from]],
    ['UPDATE issued_alerts SET trail_id = ? WHERE trail_id = ?', [to, from]],
    ['UPDATE hikes SET trail_id = ? WHERE trail_id = ?', [to, from]],
    ['DELETE FROM trails WHERE id = ?', [from]],
  ];
}
