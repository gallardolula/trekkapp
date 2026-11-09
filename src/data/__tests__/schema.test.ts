/** The migrations, applied to a real SQLite database.
 *
 *  Nothing in the application can damage the hiker's data as thoroughly as
 *  a migration, and a migration only ever runs once on each device, with
 *  whatever that device happens to hold. So they are exercised here against
 *  Node's own SQLite, which is the same engine the phone runs, with the same
 *  foreign keys switched on.
 */
import { DatabaseSync } from 'node:sqlite';

import { isUuid } from '../../domain/identity';
import { MIGRATIONS, PREVIOUS_ACCOUNT_CLEANUP, retargetTrail, SCHEMA_VERSION } from '../schema';

/** Opens a database migrated up to `upTo`, counted as the application does. */
function migrated(upTo: number = MIGRATIONS.length): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (let v = 0; v < upTo; v++) db.exec(MIGRATIONS[v]!);
  return db;
}

describe('the set of migrations', () => {
  it('declares a version that matches how many there are', () => {
    // The application stores this number in user_version, so a mismatch
    // would leave a device claiming to hold a schema it does not have.
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length);
  });

  it('applies in order from an empty database', () => {
    const db = migrated();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain('trails');
    expect(tables).toContain('reports');
    expect(tables).toContain('hikes');
    expect(tables).toContain('sync_state');
    // The temporary table the rewrite uses must not outlive it.
    expect(tables).not.toContain('id_map');
    db.close();
  });
});

describe('rewriting the identifiers created under the clock scheme', () => {
  /** A device as it stood before the rewrite: schema v4, old identifiers. */
  function deviceBeforeTheRewrite(): DatabaseSync {
    const db = migrated(4);
    db.exec(`
      INSERT INTO trails (id, name, distance_m, elevation_gain_m, effort_index,
                          difficulty, status, source, created_at)
      VALUES ('imported-1762700000000', 'Filo de prueba', 2060, 156, 2.3,
              'beginner', 'pending_review', 'imported', '2026-11-08T10:00:00.000Z');

      INSERT INTO trails (id, name, distance_m, elevation_gain_m, effort_index,
                          difficulty, status, source, created_at)
      VALUES ('7b1f0c2a-0001-4a00-8000-000000000001', 'Quebrada del Condorito',
              9000, 300, 10, 'intermediate', 'published', 'preloaded',
              '2026-11-01T10:00:00.000Z');

      INSERT INTO track_points (trail_id, position, lat, lon)
      VALUES ('imported-1762700000000', 0, -31.6, -64.7);

      INSERT INTO hikes (id, trail_id, started_at)
      VALUES ('hike-1762700001000', 'imported-1762700000000', '2026-11-08T11:00:00.000Z');

      INSERT INTO reports (id, trail_id, kind, comment, created_at)
      VALUES ('report-1762700002000', 'imported-1762700000000', 'obstacle',
              'Árbol caído', '2026-11-08T11:30:00.000Z');

      INSERT INTO reports (id, trail_id, kind, created_at)
      VALUES ('report-1762700003000', '7b1f0c2a-0001-4a00-8000-000000000001',
              'water', '2026-11-08T12:00:00.000Z');

      INSERT INTO sync_queue (entity, entity_id, operation, created_at)
      VALUES ('report', 'report-1762700002000', 'create', '2026-11-08T11:30:00.000Z'),
             ('report', 'report-1762700003000', 'create', '2026-11-08T12:00:00.000Z');
    `);
    return db;
  }

  let db: DatabaseSync;

  beforeEach(() => {
    db = deviceBeforeTheRewrite();
    db.exec(MIGRATIONS[4]!);
  });

  afterEach(() => db.close());

  const ids = (sql: string) => db.prepare(sql).all().map((r) => (r as { id: string }).id);

  it('gives every report an identifier the server would accept', () => {
    const all = ids('SELECT id FROM reports');
    expect(all).toHaveLength(2);
    expect(all.every(isUuid)).toBe(true);
  });

  it('gives the imported trail one as well', () => {
    const all = ids("SELECT id FROM trails WHERE source = 'imported'");
    expect(all).toHaveLength(1);
    expect(isUuid(all[0]!)).toBe(true);
  });

  it('leaves the preloaded trails alone, which already had one', () => {
    expect(ids("SELECT id FROM trails WHERE source = 'preloaded'")).toEqual([
      '7b1f0c2a-0001-4a00-8000-000000000001',
    ]);
  });

  it('keeps every report, because each is the only copy of what was seen', () => {
    const comments = db
      .prepare('SELECT comment FROM reports WHERE comment IS NOT NULL')
      .all()
      .map((r) => (r as { comment: string }).comment);
    expect(comments).toEqual(['Árbol caído']);
  });

  it('keeps the queue pointing at the reports it was queued for', () => {
    const rows = db
      .prepare(
        `SELECT q.entity_id FROM sync_queue q
           JOIN reports r ON r.id = q.entity_id
          WHERE q.entity = 'report'`,
      )
      .all();
    // Two entries were queued, and both still find their report. An entry
    // that lost it would never be sent and never be cleared.
    expect(rows).toHaveLength(2);
  });

  it('moves the geometry, the walk and the report onto the renamed trail', () => {
    const trail = ids("SELECT id FROM trails WHERE source = 'imported'")[0]!;
    const count = (table: string) =>
      (
        db.prepare(`SELECT COUNT(*) AS id FROM ${table} WHERE trail_id = ?`).get(trail) as {
          id: number;
        }
      ).id;
    expect(count('track_points')).toBe(1);
    expect(count('hikes')).toBe(1);
    expect(count('reports')).toBe(1);
  });

  it('leaves nothing pointing at a trail that is gone', () => {
    // The rewrite copies the trail and deletes the original, and the
    // original's cascade would take the children with it if any had been
    // left behind.
    const orphans = db
      .prepare(
        `SELECT COUNT(*) AS id FROM track_points
          WHERE trail_id NOT IN (SELECT id FROM trails)`,
      )
      .get() as { id: number };
    expect(orphans.id).toBe(0);
  });

  it('changes nothing on a device that has no old identifiers', () => {
    const clean = migrated(4);
    clean.exec(`
      INSERT INTO trails (id, name, distance_m, elevation_gain_m, effort_index,
                          difficulty, status, source, created_at)
      VALUES ('7b1f0c2a-0001-4a00-8000-000000000001', 'Quebrada del Condorito',
              9000, 300, 10, 'intermediate', 'published', 'preloaded',
              '2026-11-01T10:00:00.000Z');
    `);
    clean.exec(MIGRATIONS[4]!);
    expect(
      clean.prepare('SELECT id FROM trails').all().map((r) => (r as { id: string }).id),
    ).toEqual(['7b1f0c2a-0001-4a00-8000-000000000001']);
    clean.close();
  });
});

describe('handing the device to another account', () => {
  /** A device in use: a catalogue, an import, a walk, reports and cursors. */
  function deviceInUse(): DatabaseSync {
    const db = migrated();
    db.exec(`
      INSERT INTO profile (id, name, email, level, updated_at, user_id)
      VALUES (1, 'Luciana', 'luciana@example.test', 'intermediate',
              '2026-11-09T10:00:00.000Z', 'aaaaaaaa-0000-4000-8000-000000000001');

      INSERT INTO trails (id, name, distance_m, elevation_gain_m, effort_index,
                          difficulty, status, source, downloaded_at, created_at)
      VALUES ('7b1f0c2a-0001-4a00-8000-000000000001', 'Quebrada del Condorito',
              9000, 300, 10, 'intermediate', 'published', 'preloaded',
              '2026-11-09T10:05:00.000Z', '2026-11-01T10:00:00.000Z'),
             ('bbbbbbbb-0000-4000-8000-000000000002', 'Filo de prueba',
              2060, 156, 2.3, 'beginner', 'local', 'imported',
              NULL, '2026-11-08T10:00:00.000Z');

      INSERT INTO track_points (trail_id, position, lat, lon) VALUES
        ('7b1f0c2a-0001-4a00-8000-000000000001', 0, -31.6, -64.7),
        ('bbbbbbbb-0000-4000-8000-000000000002', 0, -31.5, -64.6);

      INSERT INTO hikes (id, trail_id, started_at)
      VALUES ('cccccccc-0000-4000-8000-000000000003',
              '7b1f0c2a-0001-4a00-8000-000000000001', '2026-11-09T11:00:00.000Z');

      INSERT INTO hike_points (hike_id, position, lat, lon, time)
      VALUES ('cccccccc-0000-4000-8000-000000000003', 0, -31.6, -64.7,
              '2026-11-09T11:00:05.000Z');

      INSERT INTO reports (id, trail_id, kind, created_at)
      VALUES ('dddddddd-0000-4000-8000-000000000004',
              '7b1f0c2a-0001-4a00-8000-000000000001', 'obstacle',
              '2026-11-09T11:30:00.000Z');

      INSERT INTO sync_queue (entity, entity_id, operation, created_at)
      VALUES ('report', 'dddddddd-0000-4000-8000-000000000004', 'create',
              '2026-11-09T11:30:00.000Z');

      INSERT INTO sync_state (key, value, updated_at)
      VALUES ('cursor.trails', '2026-11-09T10:00:00.000000Z', '2026-11-09T10:00:00.000Z');

      INSERT INTO issued_alerts (trail_id, kind, issued_at)
      VALUES ('7b1f0c2a-0001-4a00-8000-000000000001', 'deviation',
              '2026-11-09T11:20:00.000Z');

      INSERT INTO forecasts (trail_id, date, precipitation_mm, wind_kmh,
                             min_temp_c, max_temp_c, obtained_at)
      VALUES ('7b1f0c2a-0001-4a00-8000-000000000001', '2026-11-10', 0, 12, 8, 21,
              '2026-11-09T10:10:00.000Z');
    `);
    return db;
  }

  let db: DatabaseSync;
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  beforeEach(() => {
    db = deviceInUse();
    db.exec(PREVIOUS_ACCOUNT_CLEANUP);
  });

  afterEach(() => db.close());

  it('empties the queue, so no report travels up under the wrong name', () => {
    // The strongest reason this cannot be skipped. An unsent report left
    // behind would be attributed to somebody who never wrote it.
    expect(count('sync_queue')).toBe(0);
  });

  it('drops the cursors, so the new account receives the catalogue from the start', () => {
    expect(count('sync_state')).toBe(0);
  });

  it('takes the walks, the reports and the alert log', () => {
    expect(count('hikes')).toBe(0);
    expect(count('reports')).toBe(0);
    expect(count('issued_alerts')).toBe(0);
  });

  it('takes the points of those walks with them', () => {
    expect(count('hike_points')).toBe(0);
  });

  it('keeps the preloaded catalogue, which belongs to nobody', () => {
    // Downloading it again needs coverage, and somebody signing in may be
    // about to leave without any.
    const rows = db.prepare('SELECT id, downloaded_at FROM trails').all() as {
      id: string;
      downloaded_at: string | null;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('7b1f0c2a-0001-4a00-8000-000000000001');
    expect(rows[0]!.downloaded_at).not.toBeNull();
  });

  it('keeps the geometry of what it kept, and only that', () => {
    const rows = db.prepare('SELECT DISTINCT trail_id AS id FROM track_points').all();
    expect(rows).toEqual([{ id: '7b1f0c2a-0001-4a00-8000-000000000001' }]);
  });

  it('takes the trail the previous account imported', () => {
    expect(count("trails WHERE source = 'imported'")).toBe(0);
  });

  it('leaves nothing pointing at a row that is gone', () => {
    // Every table here declares a foreign key, so a missed delete shows up
    // as an orphan rather than an error.
    const orphans = (table: string, column: string, parent: string) =>
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM ${table}
              WHERE ${column} IS NOT NULL
                AND ${column} NOT IN (SELECT id FROM ${parent})`,
          )
          .get() as { n: number }
      ).n;
    expect(orphans('track_points', 'trail_id', 'trails')).toBe(0);
    expect(orphans('forecasts', 'trail_id', 'trails')).toBe(0);
    expect(orphans('hike_points', 'hike_id', 'hikes')).toBe(0);
  });

  it('leaves the profile row in place, for the sign in to overwrite', () => {
    expect(count('profile')).toBe(1);
  });
});

describe('retiring the waiting state', () => {
  /** A device as it stood at v5, holding a trail that was waiting. */
  function waitingForAReview(): DatabaseSync {
    const db = migrated(5);
    db.exec(`
      INSERT INTO trails (id, name, distance_m, elevation_gain_m, effort_index,
                          difficulty, status, source, downloaded_at, created_at)
      VALUES ('bbbbbbbb-0000-4000-8000-000000000002', 'Filo de prueba',
              2060, 156, 2.3, 'beginner', 'pending_review', 'imported',
              '2026-11-08T12:00:00.000Z', '2026-11-08T10:00:00.000Z'),
             ('7b1f0c2a-0001-4a00-8000-000000000001', 'Quebrada del Condorito',
              9000, 300, 10, 'intermediate', 'published', 'preloaded',
              NULL, '2026-11-01T10:00:00.000Z');

      INSERT INTO track_points (trail_id, position, lat, lon)
      VALUES ('bbbbbbbb-0000-4000-8000-000000000002', 0, -31.5, -64.6);
    `);
    return db;
  }

  let db: DatabaseSync;
  const status = (id: string) =>
    (db.prepare('SELECT status FROM trails WHERE id = ?').get(id) as { status: string }).status;

  beforeEach(() => {
    db = waitingForAReview();
    db.exec(MIGRATIONS[5]!);
  });

  afterEach(() => db.close());

  it('calls a trail that never left this phone what it is', () => {
    // It was never in a queue. Nothing ever sent it anywhere, and there is
    // no longer a queue to be in.
    expect(status('bbbbbbbb-0000-4000-8000-000000000002')).toBe('local');
  });

  it('leaves a published trail published', () => {
    expect(status('7b1f0c2a-0001-4a00-8000-000000000001')).toBe('published');
  });

  it('keeps what the rebuilt table held, including the download', () => {
    const row = db
      .prepare('SELECT name, downloaded_at FROM trails WHERE id = ?')
      .get('bbbbbbbb-0000-4000-8000-000000000002') as {
      name: string;
      downloaded_at: string | null;
    };
    expect(row.name).toBe('Filo de prueba');
    expect(row.downloaded_at).toBe('2026-11-08T12:00:00.000Z');
  });

  it('keeps the geometry attached after the table is rebuilt', () => {
    // The table is dropped and recreated, so this is where the points of
    // every downloaded trail would quietly disappear.
    const points = db
      .prepare('SELECT COUNT(*) AS n FROM track_points WHERE trail_id = ?')
      .get('bbbbbbbb-0000-4000-8000-000000000002') as { n: number };
    expect(points.n).toBe(1);
  });

  it('refuses the state that no longer exists', () => {
    expect(() =>
      db.exec(`
        INSERT INTO trails (id, name, distance_m, elevation_gain_m, effort_index,
                            difficulty, status, source, created_at)
        VALUES ('cccccccc-0000-4000-8000-000000000003', 'Nuevo', 1000, 50, 1.2,
                'beginner', 'pending_review', 'imported', '2026-11-09T10:00:00.000Z')
      `),
    ).toThrow();
  });

  it('leaves the foreign keys switched back on', () => {
    // The migration turns them off to rebuild the table. Leaving them off
    // would silently disarm every cascade for the rest of the session.
    const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
  });
});

describe('giving reports a vocabulary', () => {
  let db: DatabaseSync;
  const kinds = () =>
    db
      .prepare('SELECT id, kind, comment FROM reports ORDER BY id')
      .all() as { id: string; kind: string; comment: string | null }[];

  beforeEach(() => {
    db = migrated(6);
    db.exec(`
      INSERT INTO trails (id, name, distance_m, elevation_gain_m, effort_index,
                          difficulty, status, source, created_at)
      VALUES ('7b1f0c2a-0001-4a00-8000-000000000001', 'Quebrada del Condorito',
              9000, 300, 10, 'intermediate', 'published', 'preloaded',
              '2026-11-01T10:00:00.000Z');

      INSERT INTO reports (id, trail_id, kind, comment, created_at) VALUES
        ('a0000000-0000-4000-8000-000000000001',
         '7b1f0c2a-0001-4a00-8000-000000000001', 'Vado crecido', NULL,
         '2026-11-09T10:00:00.000Z'),
        ('a0000000-0000-4000-8000-000000000002',
         '7b1f0c2a-0001-4a00-8000-000000000001', 'Marca borrada', NULL,
         '2026-11-09T10:05:00.000Z'),
        ('a0000000-0000-4000-8000-000000000003',
         '7b1f0c2a-0001-4a00-8000-000000000001', 'Paso cerrado', NULL,
         '2026-11-09T10:10:00.000Z'),
        ('a0000000-0000-4000-8000-000000000004',
         '7b1f0c2a-0001-4a00-8000-000000000001', 'Puente con tablones flojos',
         'Del lado norte', '2026-11-09T10:15:00.000Z');
    `);
    db.exec(MIGRATIONS[6]!);
  });

  afterEach(() => db.close());

  it('maps the wordings the screen used to show onto identifiers', () => {
    expect(kinds().slice(0, 3).map((r) => r.kind)).toEqual([
      'flooded_ford',
      'lost_markings',
      'path_blocked',
    ]);
  });

  it('turns anything else into the open kind', () => {
    expect(kinds()[3]!.kind).toBe('other');
  });

  it('keeps what somebody wrote, because it was about a real path', () => {
    expect(kinds()[3]!.comment).toBe('Puente con tablones flojos. Del lado norte');
  });

  it('leaves a report that already uses the vocabulary alone', () => {
    const clean = migrated(6);
    clean.exec(`
      INSERT INTO trails (id, name, distance_m, elevation_gain_m, effort_index,
                          difficulty, status, source, created_at)
      VALUES ('7b1f0c2a-0001-4a00-8000-000000000001', 'Quebrada', 9000, 300, 10,
              'intermediate', 'published', 'preloaded', '2026-11-01T10:00:00.000Z');
      INSERT INTO reports (id, trail_id, kind, comment, created_at)
      VALUES ('b0000000-0000-4000-8000-000000000001',
              '7b1f0c2a-0001-4a00-8000-000000000001', 'no_water', 'Seca',
              '2026-11-09T10:00:00.000Z');
    `);
    clean.exec(MIGRATIONS[6]!);
    const row = clean.prepare('SELECT kind, comment FROM reports').get() as {
      kind: string;
      comment: string;
    };
    expect(row.kind).toBe('no_water');
    expect(row.comment).toBe('Seca');
    clean.close();
  });
});

describe('photographs of a walk', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = migrated();
    db.exec(`
      INSERT INTO trails (id, name, distance_m, elevation_gain_m, effort_index,
                          difficulty, status, source, created_at)
      VALUES ('7b1f0c2a-0001-4a00-8000-000000000001', 'Quebrada', 9000, 300, 10,
              'intermediate', 'published', 'preloaded', '2026-11-01T10:00:00.000Z');
      INSERT INTO hikes (id, trail_id, started_at)
      VALUES ('cccccccc-0000-4000-8000-000000000003',
              '7b1f0c2a-0001-4a00-8000-000000000001', '2026-11-09T11:00:00.000Z');
      INSERT INTO hike_photos (id, hike_id, uri, lat, lon, taken_at)
      VALUES ('dddddddd-0000-4000-8000-000000000001',
              'cccccccc-0000-4000-8000-000000000003',
              'file:///fotos/una.jpg', -31.6, -64.7, '2026-11-09T11:30:00.000Z');
    `);
  });

  afterEach(() => db.close());

  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  it('keeps only the address of the file, not the file', () => {
    const row = db.prepare('SELECT uri FROM hike_photos').get() as { uri: string };
    expect(row.uri).toBe('file:///fotos/una.jpg');
  });

  it('goes with the walk when the walk is deleted', () => {
    // Otherwise deleting an outing leaves its photographs with nothing to
    // belong to and no screen that would ever show them again.
    db.exec("DELETE FROM hikes WHERE id = 'cccccccc-0000-4000-8000-000000000003'");
    expect(count('hike_photos')).toBe(0);
  });

  it('refuses a photograph of a walk that does not exist', () => {
    expect(() =>
      db.exec(`
        INSERT INTO hike_photos (id, hike_id, uri, taken_at)
        VALUES ('eeeeeeee-0000-4000-8000-000000000001', 'no-existe',
                'file:///x.jpg', '2026-11-09T12:00:00.000Z')
      `),
    ).toThrow();
  });

  it('accepts one taken where the receiver had not answered', () => {
    // Under trees and in a valley there is no fix, and that is no reason
    // to lose the photograph.
    db.exec(`
      INSERT INTO hike_photos (id, hike_id, uri, taken_at)
      VALUES ('eeeeeeee-0000-4000-8000-000000000002',
              'cccccccc-0000-4000-8000-000000000003', 'file:///dos.jpg',
              '2026-11-09T12:00:00.000Z')
    `);
    expect(count('hike_photos')).toBe(2);
  });
});

describe('moving a trail onto the identifier the server assigned', () => {
  const LOCAL = 'aaaaaaaa-0000-4000-8000-00000000000a';
  const SERVER = 'bbbbbbbb-0000-4000-8000-00000000000b';

  let db: DatabaseSync;

  beforeEach(() => {
    db = migrated();
    db.exec(`
      INSERT INTO trails (id, name, distance_m, elevation_gain_m, effort_index,
                          difficulty, status, source, downloaded_at, created_at)
      VALUES ('${LOCAL}', 'Filo de prueba', 2060, 156, 2.3, 'beginner',
              'local', 'imported', '2026-11-09T12:00:00.000Z',
              '2026-11-09T10:00:00.000Z');

      INSERT INTO track_points (trail_id, position, lat, lon)
      VALUES ('${LOCAL}', 0, -31.5, -64.6), ('${LOCAL}', 1, -31.51, -64.61);

      INSERT INTO reports (id, trail_id, kind, created_at)
      VALUES ('cccccccc-0000-4000-8000-00000000000c', '${LOCAL}', 'no_water',
              '2026-11-09T11:00:00.000Z');

      INSERT INTO forecasts (trail_id, date, precipitation_mm, wind_kmh,
                             min_temp_c, max_temp_c, obtained_at)
      VALUES ('${LOCAL}', '2026-11-10', 0, 12, 8, 21, '2026-11-09T10:10:00.000Z');

      INSERT INTO issued_alerts (trail_id, kind, issued_at)
      VALUES ('${LOCAL}', 'level', '2026-11-09T11:20:00.000Z');

      INSERT INTO hikes (id, trail_id, started_at)
      VALUES ('dddddddd-0000-4000-8000-00000000000d', '${LOCAL}',
              '2026-11-09T11:00:00.000Z');
    `);

    for (const [sql, params] of retargetTrail(LOCAL, SERVER)) {
      db.prepare(sql).run(...(params as never[]));
    }
  });

  afterEach(() => db.close());

  const one = (sql: string, ...p: string[]) => db.prepare(sql).get(...(p as never[]));
  const count = (table: string, id: string) =>
    (one(`SELECT COUNT(*) AS n FROM ${table} WHERE trail_id = ?`, id) as { n: number }).n;

  it('leaves exactly one trail, under the server identifier', () => {
    const rows = db.prepare('SELECT id FROM trails').all() as { id: string }[];
    expect(rows).toEqual([{ id: SERVER }]);
  });

  it('publishes it, because the server accepted it', () => {
    expect((one('SELECT status FROM trails WHERE id = ?', SERVER) as { status: string }).status)
      .toBe('published');
  });

  it('keeps what the hiker had done to it', () => {
    const row = one('SELECT name, downloaded_at FROM trails WHERE id = ?', SERVER) as {
      name: string;
      downloaded_at: string | null;
    };
    expect(row.name).toBe('Filo de prueba');
    expect(row.downloaded_at).toBe('2026-11-09T12:00:00.000Z');
  });

  it('moves every child onto the new identifier', () => {
    expect(count('track_points', SERVER)).toBe(2);
    expect(count('reports', SERVER)).toBe(1);
    expect(count('forecasts', SERVER)).toBe(1);
    expect(count('issued_alerts', SERVER)).toBe(1);
    expect(count('hikes', SERVER)).toBe(1);
  });

  it('leaves nothing behind on the old one', () => {
    for (const table of ['track_points', 'reports', 'forecasts', 'issued_alerts', 'hikes']) {
      expect(count(table, LOCAL)).toBe(0);
    }
  });

  it('leaves nothing pointing at a trail that is gone', () => {
    // Deleting the original cascades, so a child the sequence forgot to
    // move would be deleted rather than orphaned, and silently.
    const stranded = one(
      `SELECT COUNT(*) AS n FROM track_points WHERE trail_id NOT IN (SELECT id FROM trails)`,
    ) as { n: number };
    expect(stranded.n).toBe(0);
  });
});
