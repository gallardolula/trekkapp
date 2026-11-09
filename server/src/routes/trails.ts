/** Catalogue delta, track geometry and contributed trails.
 *
 *  The derived attributes are recomputed here with the very same domain code
 *  the device runs, imported rather than reimplemented. Two copies of the
 *  rule would drift, and a client and a server disagreeing about how
 *  demanding a trail is would defeat the purpose of checking it at all.
 */
import type { FastifyInstance } from 'fastify';

import { computeAttributes } from '../../../src/domain/trail';
import type { Point } from '../../../src/domain/types';
import { pool, withTransaction } from '../db/pool';
import { deltaQuerySchema, trailSubmissionSchema } from '../schemas';
import { isDuplicateOf, validateGeometry } from '../trails/validation';

interface TrailRow {
  id: string;
  name: string;
  description: string | null;
  distance_m: number;
  elevation_gain_m: number;
  effort_index: number;
  difficulty: string;
  status: string;
  updated_at: Date;
  cursor_value: string;
}

// The cursor must keep the microsecond precision PostgreSQL stores. A
// JavaScript Date only holds milliseconds, so round-tripping through one
// truncates the value and the comparison `updated_at > cursor` lets the
// last row of a page through again on the next synchronisation, forever.
// The value is therefore formatted by the database and never rebuilt here.
const CURSOR = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const present = (r: TrailRow) => ({
  id: r.id,
  name: r.name,
  description: r.description ?? undefined,
  status: r.status,
  updatedAt: r.updated_at.toISOString(),
  attributes: {
    distanceM: r.distance_m,
    elevationGainM: r.elevation_gain_m,
    effortIndex: r.effort_index,
    difficulty: r.difficulty,
  },
});

export async function trailRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Catalogue since a cursor.
   *
   * The device stores the `cursor` of its last successful sync and asks for
   * what changed after it. Deletions travel as tombstones, because a row
   * that no longer exists cannot announce its own removal.
   */
  app.get('/api/trails', { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = deltaQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query' });
    const { since, limit } = parsed.data;

    const { rows } = await pool.query<TrailRow>(
      `SELECT id, name, description, distance_m, elevation_gain_m, effort_index,
              difficulty, status, updated_at, ${CURSOR('updated_at')} AS cursor_value
         FROM trails
        WHERE status = 'published'
          AND ($1::timestamptz IS NULL OR updated_at > $1)
        ORDER BY updated_at
        LIMIT $2`,
      [since ?? null, limit],
    );

    const deleted = await pool.query<{ entity_id: string; cursor_value: string }>(
      `SELECT entity_id, ${CURSOR('deleted_at')} AS cursor_value
         FROM tombstones
        WHERE entity = 'trail'
          AND ($1::timestamptz IS NULL OR deleted_at > $1)
        ORDER BY deleted_at
        LIMIT $2`,
      [since ?? null, limit],
    );

    // The next cursor is the newest value actually returned, never `now()`.
    // Taking the clock would skip anything written between the query and
    // the response. Both lists arrive ordered and in the same format, so
    // the largest string is the newest instant.
    const candidates = [
      ...rows.map((r) => r.cursor_value),
      ...deleted.rows.map((r) => r.cursor_value),
    ];
    const cursor = candidates.length > 0 ? candidates.reduce((a, b) => (a > b ? a : b)) : since ?? null;

    return reply.send({
      trails: rows.map(present),
      deleted: deleted.rows.map((r) => r.entity_id),
      cursor,
      // Says whether another page is waiting, so the device knows to ask again.
      complete: rows.length < limit && deleted.rows.length < limit,
    });
  });

  /** Full geometry. Kept out of the catalogue because it is large. */
  app.get<{ Params: { id: string } }>(
    '/api/trails/:id/track',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { rows } = await pool.query<{ status: string; owner_id: string | null }>(
        'SELECT status, owner_id FROM trails WHERE id = $1',
        [request.params.id],
      );
      const trail = rows[0];
      if (!trail) return reply.code(404).send({ error: 'not_found' });

      // A withdrawn trail stays reachable by whoever contributed it, so
      // somebody whose route was taken out of the catalogue can still see
      // it and still walk it. The rule used to name the moderator instead
      // of the owner, which meant the one person who could not retrieve
      // their own contribution was the person who made it.
      if (trail.status !== 'published' && trail.owner_id !== request.user!.id) {
        return reply.code(404).send({ error: 'not_found' });
      }

      const points = await pool.query<{
        lat: number;
        lon: number;
        ele: number | null;
        time: Date | null;
      }>(
        'SELECT lat, lon, ele, time FROM track_points WHERE trail_id = $1 ORDER BY position',
        [request.params.id],
      );

      return reply.send({
        trailId: request.params.id,
        points: points.rows.map((p) => ({
          lat: p.lat,
          lon: p.lon,
          ...(p.ele !== null ? { ele: p.ele } : {}),
          ...(p.time !== null ? { time: p.time.toISOString() } : {}),
        })),
      });
    },
  );

  /**
   * A trail contributed by a hiker.
   *
   * Validated here and published, or refused with a reason. There is no
   * queue and nobody to work it: what a reviewer could establish by looking
   * at a track, these checks establish, and what they could not establish
   * the reviewer could not either. See trails/validation.ts.
   *
   * A trail that passes carries an owner, and that is what the catalogue
   * shows it by. Contributed and not verified on the ground is a different
   * thing from the preloaded routes, and saying so is the honest part of
   * dropping the review.
   */
  app.post('/api/trails', { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = trailSubmissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const { name, description, points } = parsed.data;

    const rejection = validateGeometry(points as Point[]);
    if (rejection) {
      return reply.code(422).send({
        error: 'invalid_track',
        reason: rejection.reason,
        ...(rejection.atPoint !== undefined ? { atPoint: rejection.atPoint } : {}),
      });
    }

    // Compared against what is published rather than against everything, so
    // a contribution is never refused for matching a trail nobody can see.
    const duplicate = await findDuplicate(points as Point[]);
    if (duplicate) {
      return reply
        .code(409)
        .send({ error: 'invalid_track', reason: 'duplicate_of_existing', trailId: duplicate });
    }

    // Computed here, from the geometry, and never read from the request.
    const attributes = computeAttributes(points as Point[]);

    const id = await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO trails
           (name, description, distance_m, elevation_gain_m, effort_index,
            difficulty, status, owner_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'published', $7)
         RETURNING id`,
        [
          name,
          description ?? null,
          attributes.distanceM,
          attributes.elevationGainM,
          attributes.effortIndex,
          attributes.difficulty,
          request.user!.id,
        ],
      );
      const trailId = rows[0]!.id;
      await insertPoints(client, trailId, points as Point[]);
      return trailId;
    });

    return reply.code(201).send({ id, status: 'published', attributes });
  });
}

async function insertPoints(
  client: { query: (q: string, v: unknown[]) => Promise<unknown> },
  trailId: string,
  points: Point[],
): Promise<void> {
  // One statement with every row rather than one per point. A five thousand
  // point track would otherwise mean five thousand round trips.
  const values: unknown[] = [];
  const tuples = points.map((p, i) => {
    const base = i * 6;
    values.push(trailId, i, p.lat, p.lon, p.ele ?? null, p.time ?? null);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
  });
  await client.query(
    `INSERT INTO track_points (trail_id, position, lat, lon, ele, time) VALUES ${tuples.join(', ')}`,
    values,
  );
}


/**
 * The published trail this track is a second recording of, if there is one.
 *
 * Compared only against trails whose enclosing box overlaps, because
 * comparing every point of a candidate against every point of the whole
 * catalogue would make a contribution cost more the more the catalogue
 * grows, and two routes in different valleys cannot be the same route.
 */
async function findDuplicate(points: Point[]): Promise<string | null> {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const margin = 0.01; // roughly a kilometre, the tolerance of the comparison

  const { rows } = await pool.query<{ id: string }>(
    `SELECT DISTINCT t.id
       FROM trails t
       JOIN track_points p ON p.trail_id = t.id
      WHERE t.status = 'published'
        AND p.lat BETWEEN $1 AND $2
        AND p.lon BETWEEN $3 AND $4`,
    [
      Math.min(...lats) - margin,
      Math.max(...lats) + margin,
      Math.min(...lons) - margin,
      Math.max(...lons) + margin,
    ],
  );

  for (const row of rows) {
    const existing = await pool.query<{ lat: number; lon: number }>(
      'SELECT lat, lon FROM track_points WHERE trail_id = $1 ORDER BY position',
      [row.id],
    );
    if (isDuplicateOf(points, existing.rows)) return row.id;
  }

  return null;
}
