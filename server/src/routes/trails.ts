/** Catalogue delta, track geometry and contributed trails.
 *
 *  The derived attributes are recomputed here with the very same domain code
 *  the device runs, imported rather than reimplemented. Two copies of the
 *  rule would drift, and a client and a server disagreeing about how
 *  demanding a trail is would defeat the purpose of checking it at all.
 */
import type { FastifyInstance } from 'fastify';

import { haversineDistance } from '../../../src/domain/geo';
import { computeAttributes } from '../../../src/domain/trail';
import type { Point } from '../../../src/domain/types';
import { pool, withTransaction } from '../db/pool';
import { deltaQuerySchema, reviewSchema, trailSubmissionSchema } from '../schemas';

// Coarse envelope of the Sierras de Córdoba. A contribution outside it is
// not cartography this project serves, so it is refused at the door rather
// than entering a moderation queue nobody can act on.
const COVERED_REGION = { minLat: -33.6, maxLat: -30.5, minLon: -65.6, maxLon: -63.7 };

// A track whose consecutive points imply a speed no walker reaches was
// almost certainly recorded in a vehicle or is corrupt.
const MAX_WALKING_SPEED_MS = 4.2; // around 15 km/h

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
      const { rows } = await pool.query<{ status: string }>(
        'SELECT status FROM trails WHERE id = $1',
        [request.params.id],
      );
      const trail = rows[0];
      if (!trail) return reply.code(404).send({ error: 'not_found' });
      if (trail.status !== 'published' && request.user!.role !== 'moderator') {
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

  /** A trail contributed by a hiker. It enters pending review, never published. */
  app.post('/api/trails', { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = trailSubmissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const { name, description, points } = parsed.data;

    const rejection = validateGeometry(points);
    if (rejection) return reply.code(422).send({ error: 'invalid_track', reason: rejection });

    // Computed here, from the geometry, and never read from the request.
    const attributes = computeAttributes(points as Point[]);

    const id = await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO trails
           (name, description, distance_m, elevation_gain_m, effort_index,
            difficulty, status, owner_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending_review', $7)
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

    return reply.code(201).send({ id, status: 'pending_review', attributes });
  });

  // ------------------------------------------------------------ moderation --

  app.get(
    '/api/moderation/trails',
    { preHandler: [app.requireModerator] },
    async (_request, reply) => {
      const { rows } = await pool.query<TrailRow & { owner_id: string | null }>(
        `SELECT id, name, description, distance_m, elevation_gain_m, effort_index,
                difficulty, status, updated_at, ${CURSOR('updated_at')} AS cursor_value, owner_id
           FROM trails
          WHERE status = 'pending_review'
          ORDER BY created_at`,
      );
      return reply.send({ trails: rows.map(present) });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/moderation/trails/:id/review',
    { preHandler: [app.requireModerator] },
    async (request, reply) => {
      const parsed = reviewSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const { rows } = await pool.query<{ id: string; status: string }>(
        `UPDATE trails
            SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4
          WHERE id = $1 AND status = 'pending_review'
          RETURNING id, status`,
        [request.params.id, parsed.data.decision, request.user!.id, parsed.data.note ?? null],
      );
      const trail = rows[0];
      // Either it does not exist or somebody else already reviewed it. The
      // condition on the UPDATE is what stops two moderators from both
      // deciding on the same submission.
      if (!trail) return reply.code(409).send({ error: 'not_pending' });

      return reply.send({ id: trail.id, status: trail.status });
    },
  );
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

/** Returns a rejection code, or null when the geometry is plausible. */
export function validateGeometry(points: Point[]): string | null {
  for (const p of points) {
    if (
      p.lat < COVERED_REGION.minLat ||
      p.lat > COVERED_REGION.maxLat ||
      p.lon < COVERED_REGION.minLon ||
      p.lon > COVERED_REGION.maxLon
    ) {
      return 'outside_covered_region';
    }
  }

  // Speed is only checkable where both points carry a timestamp, which a
  // track exported from some tools does not.
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (!a.time || !b.time) continue;
    const seconds = (Date.parse(b.time) - Date.parse(a.time)) / 1000;
    if (seconds <= 0) continue;
    if (haversineDistance(a, b) / seconds > MAX_WALKING_SPEED_MS) {
      return 'implausible_speed';
    }
  }

  return null;
}
