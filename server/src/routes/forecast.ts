/** Forecast for a trail, cached and shared.
 *
 *  The request goes through here and not from the phone for two reasons.
 *  The upstream provider is called once per trail and per day rather than
 *  once per device, which is what keeps a free, unauthenticated service
 *  usable. And the coordinates asked about are the trail's own, taken from
 *  its geometry, instead of whatever the device happens to send.
 *
 *  See docs/adr/0007.
 */
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

import { pool } from '../db/pool';
import { fetchForecast, type Forecast } from '../weather/openMeteo';

/**
 * How long a stored forecast is served before the provider is asked again.
 *
 * Three hours is short enough that a day's outlook does not go stale
 * before a hiker leaves, and long enough that a group planning the same
 * outing produces one upstream call rather than one each.
 */
export const CACHE_TTL_MS = 3 * 60 * 60 * 1000;

interface Row {
  date: string;
  precipitation_mm: number;
  wind_kmh: number;
  min_temp_c: number;
  max_temp_c: number;
  obtained_at: Date;
}

const present = (r: Row) => ({
  forecast: {
    date: r.date,
    precipitationMm: r.precipitation_mm,
    windKmh: r.wind_kmh,
    minTempC: r.min_temp_c,
    maxTempC: r.max_temp_c,
  },
  obtainedAt: r.obtained_at.toISOString(),
});

/**
 * The point the forecast is asked about.
 *
 * The middle of the track rather than its start. A trail long enough for
 * the weather to differ along it is better represented by its middle than
 * by a trailhead that may sit in a valley.
 */
async function midpoint(
  client: PoolClient | typeof pool,
  trailId: string,
): Promise<{ lat: number; lon: number } | null> {
  const { rows } = await client.query<{ lat: number; lon: number }>(
    `SELECT lat, lon FROM track_points
      WHERE trail_id = $1
      ORDER BY position
      OFFSET (SELECT count(*) / 2 FROM track_points WHERE trail_id = $1)
      LIMIT 1`,
    [trailId],
  );
  return rows[0] ?? null;
}

export async function forecastRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/api/trails/:id/forecast',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const trailId = request.params.id;

      const trail = await pool.query<{ status: string }>(
        'SELECT status FROM trails WHERE id = $1',
        [trailId],
      );
      if (trail.rowCount === 0) return reply.code(404).send({ error: 'not_found' });

      const fresh = await pool.query<Row>(
        `SELECT date::text AS date, precipitation_mm, wind_kmh, min_temp_c, max_temp_c, obtained_at
           FROM forecasts
          WHERE trail_id = $1
            AND date >= current_date
            AND obtained_at > now() - ($2 || ' milliseconds')::interval
          ORDER BY date`,
        [trailId, String(CACHE_TTL_MS)],
      );

      if (fresh.rowCount && fresh.rowCount > 0) {
        return reply.send({ trailId, days: fresh.rows.map(present), source: 'cache' });
      }

      const point = await midpoint(pool, trailId);
      if (!point) return reply.code(409).send({ error: 'trail_without_geometry' });

      const { daily: days, hourly } = await fetchForecast(point.lat, point.lon);

      if (days.length === 0) {
        // The provider did not answer. Anything already stored, even past
        // its freshness window, beats nothing: the device shows it with
        // its age, and a stale forecast read as stale is still useful.
        const stale = await pool.query<Row>(
          `SELECT date::text AS date, precipitation_mm, wind_kmh, min_temp_c, max_temp_c, obtained_at
             FROM forecasts
            WHERE trail_id = $1 AND date >= current_date
            ORDER BY date`,
          [trailId],
        );
        if (stale.rowCount && stale.rowCount > 0) {
          // No hours with a stale answer. They are only worth reading
          // while they are still ahead of the hiker, and these are not.
          return reply.send({ trailId, days: stale.rows.map(present), hourly: [], source: 'stale' });
        }
        return reply.code(503).send({ error: 'forecast_unavailable' });
      }

      await store(trailId, days);

      const obtainedAt = new Date().toISOString();
      return reply.send({
        trailId,
        days: days.map((forecast) => ({ forecast, obtainedAt })),
        hourly,
        source: 'upstream',
      });
    },
  );
}

async function store(trailId: string, days: Forecast[]): Promise<void> {
  for (const d of days) {
    await pool.query(
      `INSERT INTO forecasts
         (trail_id, date, precipitation_mm, wind_kmh, min_temp_c, max_temp_c, obtained_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (trail_id, date) DO UPDATE SET
         precipitation_mm = excluded.precipitation_mm,
         wind_kmh = excluded.wind_kmh,
         min_temp_c = excluded.min_temp_c,
         max_temp_c = excluded.max_temp_c,
         obtained_at = excluded.obtained_at`,
      [trailId, d.date, d.precipitationMm, d.windKmh, d.minTempC, d.maxTempC],
    );
  }
}
