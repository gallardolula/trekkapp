/** The forecast cache.
 *
 *  The upstream provider is replaced by a double. What is under test is
 *  the caching, which is the entire reason this endpoint exists: the
 *  provider must be called once per trail and per freshness window, not
 *  once per device that asks.
 */

import type { FastifyInstance } from 'fastify';

jest.mock('../weather/openMeteo', () => ({ fetchForecast: jest.fn() }));

import { buildApp } from '../app';
import { pool } from '../db/pool';
import { resetSchema } from './schema';
import { CACHE_TTL_MS } from '../routes/forecast';
import { fetchForecast } from '../weather/openMeteo';

jest.setTimeout(60_000);

const upstream = fetchForecast as jest.MockedFunction<typeof fetchForecast>;

let app: FastifyInstance;

/**
 * A track the validation accepts, placed by `nth` so that two calls do not
 * contribute the same route twice.
 */
const TRACK = (nth = 0) =>
  Array.from({ length: 24 }, (_, i) => ({
    lat: -31.65 - nth * 0.05 - i * 0.0004,
    lon: -64.68 - i * 0.0004,
    ele: 2100 + i * 4,
  }));

const today = () => new Date().toISOString().slice(0, 10);

const DAY = () => ({
  date: today(),
  precipitationMm: 12,
  windKmh: 45,
  minTempC: 2,
  maxTempC: 14,
});

beforeAll(async () => {
  await resetSchema(pool);
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE users, trails, track_points, forecasts CASCADE');
  upstream.mockReset();
});

let counter = 0;

/** Creates an account, a trail with geometry, and returns a usable token. */
async function published() {
  const email = `forecast${++counter}.${Date.now()}@example.test`;
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { name: 'Luciana', email, password: 'Sierras2026!', level: 'intermediate' },
  });
  const token = registered.json().accessToken as string;

  // A valid contribution is published by the system, so there is nothing to
  // review and nobody to review it. Each call puts its trail somewhere else
  // in the Sierras, because a second recording of the same route is now
  // refused as a duplicate.
  const created = await app.inject({
    method: 'POST',
    url: '/api/trails',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: `Balcón Norte ${counter}`, points: TRACK(counter) },
  });
  return { token, trailId: created.json().id as string };
}

const get = (app: FastifyInstance, trailId: string, token: string) =>
  app.inject({
    method: 'GET',
    url: `/api/trails/${trailId}/forecast`,
    headers: { authorization: `Bearer ${token}` },
  });

describe('authorisation', () => {
  it('refuses an unauthenticated request', async () => {
    const { trailId } = await published();
    const response = await app.inject({
      method: 'GET',
      url: `/api/trails/${trailId}/forecast`,
    });
    expect(response.statusCode).toBe(401);
  });

  it('answers 404 for a trail that does not exist', async () => {
    const { token } = await published();
    const response = await get(app, '00000000-0000-4000-8000-000000000000', token);
    expect(response.statusCode).toBe(404);
  });
});

describe('caching', () => {
  it('calls the provider on the first request and stores the result', async () => {
    const { token, trailId } = await published();
    upstream.mockResolvedValue({ daily: [DAY()], hourly: [] });

    const response = await get(app, trailId, token);

    expect(response.statusCode).toBe(200);
    expect(response.json().source).toBe('upstream');
    expect(response.json().days[0].forecast.precipitationMm).toBe(12);
    expect(upstream).toHaveBeenCalledTimes(1);

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM forecasts WHERE trail_id = $1', [trailId]);
    expect(rows[0].n).toBe(1);
  });

  it('does not call the provider again within the freshness window', async () => {
    // This is the whole point of the endpoint. Three devices planning the
    // same outing must produce one upstream call, not three.
    const { token, trailId } = await published();
    upstream.mockResolvedValue({ daily: [DAY()], hourly: [] });

    await get(app, trailId, token);
    const second = await get(app, trailId, token);
    const third = await get(app, trailId, token);

    expect(upstream).toHaveBeenCalledTimes(1);
    expect(second.json().source).toBe('cache');
    expect(third.json().source).toBe('cache');
  });

  it('calls the provider again once the stored forecast is older than the window', async () => {
    const { token, trailId } = await published();
    upstream.mockResolvedValue({ daily: [DAY()], hourly: [] });
    await get(app, trailId, token);

    await pool.query(
      `UPDATE forecasts SET obtained_at = now() - ($2 || ' milliseconds')::interval - interval '1 minute'
        WHERE trail_id = $1`,
      [trailId, String(CACHE_TTL_MS)],
    );

    const response = await get(app, trailId, token);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(response.json().source).toBe('upstream');
  });

  it('asks the provider about the middle of the track and not its start', async () => {
    // A trail long enough for the weather to differ along it is better
    // represented by its middle than by a trailhead down in a valley.
    const { token, trailId } = await published();
    upstream.mockResolvedValue({ daily: [DAY()], hourly: [] });

    await get(app, trailId, token);

    const [lat, lon] = upstream.mock.calls[0]!;
    const middle = TRACK(counter)[12]!;
    expect(lat).toBeCloseTo(middle.lat, 6);
    expect(lon).toBeCloseTo(middle.lon, 6);
  });
});

describe('when the provider does not answer', () => {
  it('serves a stale forecast rather than nothing, and says so', async () => {
    // A forecast read as stale is still useful. Presenting it as current
    // would not be, which is why the age travels with it.
    const { token, trailId } = await published();
    upstream.mockResolvedValue({ daily: [DAY()], hourly: [] });
    await get(app, trailId, token);

    await pool.query(
      `UPDATE forecasts SET obtained_at = now() - interval '3 days' WHERE trail_id = $1`,
      [trailId],
    );
    upstream.mockResolvedValue({ daily: [], hourly: [] });

    const response = await get(app, trailId, token);

    expect(response.statusCode).toBe(200);
    expect(response.json().source).toBe('stale');
    expect(response.json().days[0].forecast.precipitationMm).toBe(12);
  });

  it('answers 503 when there is nothing stored either', async () => {
    const { token, trailId } = await published();
    upstream.mockResolvedValue({ daily: [], hourly: [] });

    const response = await get(app, trailId, token);

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('forecast_unavailable');
  });
});

describe('a trail without geometry', () => {
  it('answers 409, because there is no point to ask about', async () => {
    const { token, trailId } = await published();
    await pool.query('DELETE FROM track_points WHERE trail_id = $1', [trailId]);

    const response = await get(app, trailId, token);

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('trail_without_geometry');
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe('the hours ahead', () => {
  const HOURS = Array.from({ length: 30 }, (_, i) => ({
    time: new Date(Date.now() + i * 3600_000).toISOString(),
    tempC: 14 + i,
    rainChance: i * 2,
    windKmh: 10 + i,
  }));

  it('passes the hourly series through on a fresh answer', async () => {
    const { token, trailId } = await published();
    upstream.mockResolvedValue({ daily: [DAY()], hourly: HOURS });

    const response = await get(app, trailId, token);
    expect(response.json().source).toBe('upstream');
    expect(response.json().hourly.length).toBeGreaterThan(0);
  });

  it('answers the cached request with hours too', async () => {
    // The days live in the database and the hours do not, so a hit on one
    // and a miss on the other would serve a forecast with no hours at all,
    // which is most of what a trail's page shows.
    const { token, trailId } = await published();
    upstream.mockResolvedValue({ daily: [DAY()], hourly: HOURS });

    await get(app, trailId, token);
    const second = await get(app, trailId, token);

    expect(second.json().source).toBe('cache');
    expect(second.json().hourly.length).toBeGreaterThan(0);
  });

  it('drops the hours already behind the hiker', async () => {
    const { token, trailId } = await published();
    upstream.mockResolvedValue({
      daily: [DAY()],
      hourly: [
        { time: new Date(Date.now() - 5 * 3600_000).toISOString(), tempC: 9, rainChance: 0, windKmh: 4 },
        ...HOURS,
      ],
    });

    const response = await get(app, trailId, token);
    const first = new Date(response.json().hourly[0].time).getTime();
    expect(first).toBeGreaterThan(Date.now() - 60 * 60_000);
  });

  it('still honours the window when the provider sends no hours', async () => {
    // Otherwise a provider without an hourly series defeats the cache and
    // is asked again on every request.
    const { token, trailId } = await published();
    upstream.mockResolvedValue({ daily: [DAY()], hourly: [] });

    await get(app, trailId, token);
    const second = await get(app, trailId, token);

    expect(second.json().source).toBe('cache');
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
