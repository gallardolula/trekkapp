/** End to end behaviour of the endpoints, against a real database.
 *
 *  Exercised through Fastify's `inject`, so no port is opened and the tests
 *  run as fast as the queries allow.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';

import { buildApp } from '../app';
import { pool } from '../db/pool';

jest.setTimeout(60_000);

let app: FastifyInstance;

const TRACK = [
  { lat: -31.65, lon: -64.68, ele: 2100 },
  { lat: -31.652, lon: -64.682, ele: 2160 },
  { lat: -31.655, lon: -64.685, ele: 2240 },
];

beforeAll(async () => {
  const sql = readFileSync(join(__dirname, '..', 'db', 'migrations', '001_initial.sql'), 'utf8');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.query(sql);
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE users, trails, track_points, reports, tombstones CASCADE');
});

let counter = 0;
const uniqueEmail = () => `hiker${++counter}.${Date.now()}@example.test`;

async function register(overrides: Record<string, unknown> = {}) {
  const email = (overrides['email'] as string) ?? uniqueEmail();
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Luciana',
      email,
      password: 'Sierras2026!',
      level: 'intermediate',
      ...overrides,
    },
  });
  return { response, body: response.json(), email };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('registration', () => {
  it('creates the account and returns a usable pair of tokens', async () => {
    const { response, body } = await register();
    expect(response.statusCode).toBe(201);
    expect(body.user.level).toBe('intermediate');
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
  });

  it('never returns the password hash', async () => {
    const { body } = await register();
    expect(JSON.stringify(body)).not.toContain('argon2');
  });

  it('refuses a weak password and lists every failing rule', async () => {
    const { response, body } = await register({ password: 'corta' });
    expect(response.statusCode).toBe(400);
    expect(body.problems).toContain('too_short');
    expect(body.problems).toContain('uppercase');
  });

  it('refuses an address that is already registered', async () => {
    const { email } = await register();
    const { response, body } = await register({ email });
    expect(response.statusCode).toBe(409);
    expect(body.error).toBe('email_taken');
  });

  it('treats the address as case insensitive', async () => {
    // Otherwise the same person could end up with two accounts and only
    // one of them holding their reports.
    const { email } = await register();
    const { response } = await register({ email: email.toUpperCase() });
    expect(response.statusCode).toBe(409);
  });
});

describe('sign in', () => {
  it('returns tokens for the right password', async () => {
    const { email } = await register();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/session',
      payload: { email, password: 'Sierras2026!' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().accessToken).toBeTruthy();
  });

  it('answers the same way for a wrong password and an unknown address', async () => {
    const { email } = await register();
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/session',
      payload: { email, password: 'Incorrecta1!' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/session',
      payload: { email: 'nobody@example.test', password: 'Incorrecta1!' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('locks the account after five consecutive failures', async () => {
    const { email } = await register();
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/session',
        payload: { email, password: 'Incorrecta1!' },
      });
    }
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/session',
      payload: { email, password: 'Sierras2026!' },
    });
    expect(response.statusCode).toBe(423);
    expect(response.json().error).toBe('account_locked');
  });
});

describe('refresh token rotation', () => {
  it('returns a different token on each exchange', async () => {
    const { body } = await register();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: body.refreshToken },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().refreshToken).not.toBe(body.refreshToken);
  });

  it('revokes every session when an already used token is presented again', async () => {
    // Reuse means the token was copied. The genuine device and whoever
    // copied it cannot be told apart, so both are signed out.
    const { body } = await register();
    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: body.refreshToken },
    });
    const rotated = first.json().refreshToken;

    const reuse = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: body.refreshToken },
    });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().reason).toBe('reused');

    const afterwards = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: rotated },
    });
    expect(afterwards.statusCode).toBe(401);
  });
});

describe('authorisation', () => {
  it('refuses an unauthenticated read of the catalogue', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/trails' });
    expect(response.statusCode).toBe(401);
  });

  it('refuses the moderation queue to a hiker', async () => {
    const { body } = await register();
    const response = await app.inject({
      method: 'GET',
      url: '/api/moderation/trails',
      headers: auth(body.accessToken),
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('contributed trails', () => {
  it('recomputes the attributes and ignores anything the client sends', async () => {
    const { body } = await register();
    const response = await app.inject({
      method: 'POST',
      url: '/api/trails',
      headers: auth(body.accessToken),
      payload: {
        name: 'Balcón Norte',
        points: TRACK,
        // Supplied on purpose. The schema drops them and the server derives
        // its own, which is what stops a contributor from publishing a hard
        // route declared as easy.
        attributes: { distanceM: 99999, difficulty: 'advanced' },
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().attributes.distanceM).toBeLessThan(2000);
    expect(response.json().status).toBe('pending_review');
  });

  it('keeps a contribution out of the catalogue until it is reviewed', async () => {
    const { body } = await register();
    await app.inject({
      method: 'POST',
      url: '/api/trails',
      headers: auth(body.accessToken),
      payload: { name: 'Balcón Norte', points: TRACK },
    });
    const catalogue = await app.inject({
      method: 'GET',
      url: '/api/trails',
      headers: auth(body.accessToken),
    });
    expect(catalogue.json().trails).toHaveLength(0);
  });

  it('refuses a track outside the covered region', async () => {
    const { body } = await register();
    const response = await app.inject({
      method: 'POST',
      url: '/api/trails',
      headers: auth(body.accessToken),
      payload: {
        name: 'Everest',
        points: [
          { lat: 27.98, lon: 86.92 },
          { lat: 27.99, lon: 86.93 },
        ],
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().reason).toBe('outside_covered_region');
  });

  it('refuses a track of a single point', async () => {
    const { body } = await register();
    const response = await app.inject({
      method: 'POST',
      url: '/api/trails',
      headers: auth(body.accessToken),
      payload: { name: 'Un punto', points: [TRACK[0]] },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('moderation and the catalogue delta', () => {
  async function moderator() {
    const { body, email } = await register();
    await pool.query("UPDATE users SET role = 'moderator' WHERE lower(email) = lower($1)", [email]);
    const session = await app.inject({
      method: 'POST',
      url: '/api/auth/session',
      payload: { email, password: 'Sierras2026!' },
    });
    return session.json().accessToken as string;
  }

  it('publishes a trail and lets it through the delta exactly once', async () => {
    const token = await moderator();
    const created = await app.inject({
      method: 'POST',
      url: '/api/trails',
      headers: auth(token),
      payload: { name: 'Balcón Norte', points: TRACK },
    });
    const id = created.json().id;

    await app.inject({
      method: 'POST',
      url: `/api/moderation/trails/${id}/review`,
      headers: auth(token),
      payload: { decision: 'published' },
    });

    const first = await app.inject({ method: 'GET', url: '/api/trails', headers: auth(token) });
    expect(first.json().trails).toHaveLength(1);

    // The row must not come back on the next synchronisation. It did once,
    // because the cursor was rebuilt from a JavaScript Date and lost the
    // microseconds PostgreSQL keeps.
    const cursor = first.json().cursor;
    const second = await app.inject({
      method: 'GET',
      url: `/api/trails?since=${encodeURIComponent(cursor)}`,
      headers: auth(token),
    });
    expect(second.json().trails).toHaveLength(0);
  });

  it('refuses a second review of the same submission', async () => {
    const token = await moderator();
    const created = await app.inject({
      method: 'POST',
      url: '/api/trails',
      headers: auth(token),
      payload: { name: 'Balcón Norte', points: TRACK },
    });
    const id = created.json().id;
    const url = `/api/moderation/trails/${id}/review`;

    const first = await app.inject({
      method: 'POST',
      url,
      headers: auth(token),
      payload: { decision: 'published' },
    });
    const second = await app.inject({
      method: 'POST',
      url,
      headers: auth(token),
      payload: { decision: 'rejected' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
  });

  it('returns the full geometry of a published trail', async () => {
    const token = await moderator();
    const created = await app.inject({
      method: 'POST',
      url: '/api/trails',
      headers: auth(token),
      payload: { name: 'Balcón Norte', points: TRACK },
    });
    const id = created.json().id;
    await app.inject({
      method: 'POST',
      url: `/api/moderation/trails/${id}/review`,
      headers: auth(token),
      payload: { decision: 'published' },
    });

    const track = await app.inject({
      method: 'GET',
      url: `/api/trails/${id}/track`,
      headers: auth(token),
    });
    expect(track.json().points).toHaveLength(TRACK.length);
    expect(track.json().points[0].lat).toBeCloseTo(TRACK[0]!.lat, 6);
  });
});

describe('report upload', () => {
  async function publishedTrail() {
    const { body, email } = await register();
    await pool.query("UPDATE users SET role = 'moderator' WHERE lower(email) = lower($1)", [email]);
    const session = await app.inject({
      method: 'POST',
      url: '/api/auth/session',
      payload: { email, password: 'Sierras2026!' },
    });
    const token = session.json().accessToken as string;
    const created = await app.inject({
      method: 'POST',
      url: '/api/trails',
      headers: auth(token),
      payload: { name: 'Balcón Norte', points: TRACK },
    });
    const id = created.json().id as string;
    await app.inject({
      method: 'POST',
      url: `/api/moderation/trails/${id}/review`,
      headers: auth(token),
      payload: { decision: 'published' },
    });
    void body;
    return { token, trailId: id };
  }

  const report = (trailId: string, id: string) => ({
    reports: [
      {
        id,
        trailId,
        kind: 'arroyo_crecido',
        comment: 'Vado con agua alta',
        lat: -31.655,
        lon: -64.685,
        createdAt: '2026-11-08T12:00:00.000Z',
      },
    ],
  });

  it('accepts a batch and stores it', async () => {
    const { token, trailId } = await publishedTrail();
    const id = '11111111-1111-4111-8111-111111111111';
    const response = await app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: auth(token),
      payload: report(trailId, id),
    });
    expect(response.json().accepted).toEqual([id]);
  });

  it('is idempotent, so a retry cannot duplicate a report', async () => {
    // This is what lets the device keep a queue entry until it actually
    // sees a confirmation, instead of guessing whether the upload landed.
    const { token, trailId } = await publishedTrail();
    const id = '22222222-2222-4222-8222-222222222222';
    const payload = report(trailId, id);

    const first = await app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: auth(token),
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: auth(token),
      payload,
    });

    expect(first.json().accepted).toEqual([id]);
    expect(second.json().accepted).toEqual([id]);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM reports WHERE id = $1', [id]);
    expect(rows[0].n).toBe(1);
  });

  it('rejects one bad row without failing the rest of the batch', async () => {
    const { token, trailId } = await publishedTrail();
    const good = '33333333-3333-4333-8333-333333333333';
    const orphan = '44444444-4444-4444-8444-444444444444';
    const response = await app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: auth(token),
      payload: {
        reports: [
          ...report(trailId, good).reports,
          {
            id: orphan,
            trailId: '00000000-0000-4000-8000-000000000000',
            kind: 'otro',
            createdAt: '2026-11-08T12:00:00.000Z',
          },
        ],
      },
    });
    expect(response.json().accepted).toEqual([good]);
    expect(response.json().rejected).toEqual([{ id: orphan, reason: 'unknown_trail' }]);
  });

  it('marks which reports belong to the caller', async () => {
    // The device cannot work this out on its own, because a report of its
    // own that was accepted comes back looking like anybody else's.
    const { token, trailId } = await publishedTrail();
    const mine = '66666666-6666-4666-8666-666666666666';
    await app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: auth(token),
      payload: report(trailId, mine),
    });

    const other = await register();
    const theirs = '77777777-7777-4777-8777-777777777777';
    await app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: auth(other.body.accessToken),
      payload: report(trailId, theirs),
    });

    const seenByOther = await app.inject({
      method: 'GET',
      url: '/api/reports',
      headers: auth(other.body.accessToken),
    });
    const rows: { id: string; own: boolean }[] = seenByOther.json().reports;
    expect(rows.find((r) => r.id === theirs)?.own).toBe(true);
    expect(rows.find((r) => r.id === mine)?.own).toBe(false);
  });

  it('does not return the same report twice across synchronisations', async () => {
    const { token, trailId } = await publishedTrail();
    await app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: auth(token),
      payload: report(trailId, '55555555-5555-4555-8555-555555555555'),
    });

    const first = await app.inject({ method: 'GET', url: '/api/reports', headers: auth(token) });
    expect(first.json().reports).toHaveLength(1);

    const cursor = first.json().cursor;
    const second = await app.inject({
      method: 'GET',
      url: `/api/reports?since=${encodeURIComponent(cursor)}`,
      headers: auth(token),
    });
    expect(second.json().reports).toHaveLength(0);
  });
});
