/** Upload and delta of trail-condition reports.
 *
 *  Reports are written on the trail, where there is no coverage, and travel
 *  up whenever the hiker next has a connection. Everything here is built
 *  around that delay: the identifier comes from the device, the upload is a
 *  batch, and sending the same batch twice has to be harmless.
 */
import type { FastifyInstance } from 'fastify';

import { pool, withTransaction } from '../db/pool';
import { deltaQuerySchema, reportBatchSchema } from '../schemas';

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Uploads a batch of reports.
   *
   * Idempotent by the device-generated identifier. A retry after a response
   * that never arrived carries the same identifiers and changes nothing,
   * which is what lets the device keep an entry in its queue until it sees
   * a confirmation.
   *
   * A report whose trail is unknown to the server is reported back as
   * rejected rather than failing the batch, so one bad row cannot block the
   * rest of a hike's reports forever.
   */
  app.post('/api/reports', { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = reportBatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }

    const userId = request.user!.id;
    const accepted: string[] = [];
    const rejected: { id: string; reason: string }[] = [];

    await withTransaction(async (client) => {
      for (const report of parsed.data.reports) {
        const trail = await client.query('SELECT 1 FROM trails WHERE id = $1', [report.trailId]);
        if (trail.rowCount === 0) {
          rejected.push({ id: report.id, reason: 'unknown_trail' });
          continue;
        }

        const { rows } = await client.query<{ owner_id: string }>(
          `INSERT INTO reports (id, trail_id, owner_id, kind, comment, lat, lon, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO NOTHING
           RETURNING owner_id`,
          [
            report.id,
            report.trailId,
            userId,
            report.kind,
            report.comment ?? null,
            report.lat ?? null,
            report.lon ?? null,
            report.createdAt,
          ],
        );

        if (rows.length > 0) {
          accepted.push(report.id);
          continue;
        }

        // Nothing was inserted, so the identifier already exists. A repeat
        // of the sender's own report is the ordinary retry and counts as
        // accepted. The same identifier under a different owner is not,
        // and would mean a device generated a colliding one.
        const existing = await client.query<{ owner_id: string }>(
          'SELECT owner_id FROM reports WHERE id = $1',
          [report.id],
        );
        if (existing.rows[0]?.owner_id === userId) accepted.push(report.id);
        else rejected.push({ id: report.id, reason: 'identifier_conflict' });
      }
    });

    return reply.send({ accepted, rejected });
  });

  /**
   * Reports of published trails since a cursor, for the device to show.
   *
   * Each row says whether it belongs to the caller. The device cannot work
   * that out on its own, because a report of its own that was accepted
   * comes back indistinguishable from anybody else's.
   */
  app.get('/api/reports', { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = deltaQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query' });
    const { since, limit } = parsed.data;

    const { rows } = await pool.query<{
      id: string;
      trail_id: string;
      kind: string;
      comment: string | null;
      lat: number | null;
      lon: number | null;
      created_at: Date;
      owner_id: string;
      cursor_value: string;
    }>(
      // Formatted by the database to keep microsecond precision; see the
      // note on the cursor in routes/trails.ts.
      `SELECT r.id, r.trail_id, r.kind, r.comment, r.lat, r.lon, r.created_at, r.owner_id,
              to_char(r.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_value
         FROM reports r
         JOIN trails t ON t.id = r.trail_id
        WHERE t.status = 'published'
          AND ($1::timestamptz IS NULL OR r.updated_at > $1)
        ORDER BY r.updated_at
        LIMIT $2`,
      [since ?? null, limit],
    );

    const last = rows[rows.length - 1];
    return reply.send({
      reports: rows.map((r) => ({
        id: r.id,
        trailId: r.trail_id,
        kind: r.kind,
        comment: r.comment ?? undefined,
        lat: r.lat ?? undefined,
        lon: r.lon ?? undefined,
        createdAt: r.created_at.toISOString(),
        own: r.owner_id === request.user!.id,
      })),
      cursor: last ? last.cursor_value : since ?? null,
      complete: rows.length < limit,
    });
  });
}
