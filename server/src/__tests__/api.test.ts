/** End to end behaviour of the endpoints, against a real database.
 *
 *  Exercised through Fastify's `inject`, so no port is opened and the tests
 *  run as fast as the queries allow.
 */

import type { FastifyInstance } from 'fastify';

import { buildApp } from '../app';
import { pool } from '../db/pool';
import { clearOutbox, codeSentTo } from './accounts';
import { resetSchema } from './schema';

jest.setTimeout(60_000);

let app: FastifyInstance;

/**
 * A track the validation accepts: inside the Sierras, long enough, climbing
 * at a rate somebody walks. Built rather than written out so a test that
 * needs a different shape can ask for one.
 */
function track(
  points = 24,
  { lat = -31.65, lon = -64.68, ele = 2100, climb = 4, step = 0.0004 } = {},
) {
  return Array.from({ length: points }, (_, i) => ({
    lat: lat - i * step,
    lon: lon - i * step,
    ele: ele + i * climb,
  }));
}

const TRACK = track();

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
  await pool.query('TRUNCATE users, trails, track_points, reports, tombstones CASCADE');
  clearOutbox();
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

/**
 * Registers and confirms the address, which is what a test that wants a
 * usable token means by creating an account. The code is read from the
 * mailer's outbox, so the real route runs, mail and all.
 */
async function account(overrides: Record<string, unknown> = {}) {
  const started = await register(overrides);
  if (started.response.statusCode !== 202) {
    throw new Error(`registration answered ${started.response.statusCode}: ${started.response.body}`);
  }
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register/verify',
    payload: { email: started.email, code: codeSentTo(started.email) },
  });
  return { response, body: response.json(), email: started.email };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('registration', () => {
  it('returns a usable pair of tokens once the address is confirmed', async () => {
    const { response, body } = await account();
    expect(response.statusCode).toBe(201);
    expect(body.user.level).toBe('intermediate');
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
  });

  it('never returns the password hash', async () => {
    const { body } = await account();
    expect(JSON.stringify(body)).not.toContain('argon2');
  });

  it('refuses a weak password and lists every failing rule', async () => {
    const { response, body } = await register({ password: 'corta' });
    expect(response.statusCode).toBe(400);
    expect(body.problems).toContain('too_short');
    expect(body.problems).toContain('uppercase');
  });

  it('refuses an address that is already registered', async () => {
    const { email } = await account();
    const { response, body } = await register({ email });
    expect(response.statusCode).toBe(409);
    expect(body.error).toBe('email_taken');
  });

  it('treats the address as case insensitive', async () => {
    // Otherwise the same person could end up with two accounts and only
    // one of them holding their reports.
    const { email } = await account();
    const { response } = await register({ email: email.toUpperCase() });
    expect(response.statusCode).toBe(409);
  });
});

describe('email verification', () => {
  const verify = (email: string, code: string) =>
    app.inject({ method: 'POST', url: '/api/auth/register/verify', payload: { email, code } });

  const resend = (email: string) =>
    app.inject({ method: 'POST', url: '/api/auth/register/resend', payload: { email } });

  const signIn = (email: string, password = 'Sierras2026!') =>
    app.inject({ method: 'POST', url: '/api/auth/session', payload: { email, password } });

  it('hands back no tokens until the address is confirmed', async () => {
    const { response, body, email } = await register();
    expect(response.statusCode).toBe(202);
    expect(body.status).toBe('verification_sent');
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
    expect(codeSentTo(email)).toMatch(/^\d{6}$/);
  });

  it('refuses to sign in before the address is confirmed', async () => {
    const { email } = await register();
    const response = await signIn(email);
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('email_not_verified');
  });

  it('refuses a wrong code and says how many guesses are left', async () => {
    const { email } = await register();
    const response = await verify(email, '000000');
    // One in a million that the code really was 000000, which would make
    // this the rare run where the assertion below is the wrong one.
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_code');
    expect(response.json().attemptsLeft).toBe(4);
  });

  it('kills the code after five wrong guesses', async () => {
    const { email } = await register();
    const code = codeSentTo(email);
    for (let i = 0; i < 5; i++) await verify(email, '000001');

    const spent = await verify(email, code);
    expect(spent.statusCode).toBe(410);
    expect(spent.json().error).toBe('exhausted');
  });

  it('does not lock the account out of signing in when the code is guessed at', async () => {
    // The attempts belong to the code. Counted on the account, a stranger
    // guessing at somebody's code would shut them out of their own sign in.
    const { email } = await register();
    for (let i = 0; i < 6; i++) await verify(email, '000001');

    // Past the cooldown, which a run of wrong guesses does not shorten.
    await pool.query(
      `UPDATE email_codes SET created_at = now() - interval '2 minutes'
        WHERE user_id = (SELECT id FROM users WHERE lower(email) = lower($1))`,
      [email],
    );
    expect((await resend(email)).statusCode).toBe(202);
    const confirmed = await verify(email, codeSentTo(email));
    expect(confirmed.statusCode).toBe(201);

    const signedIn = await signIn(email);
    expect(signedIn.statusCode).toBe(200);
  });

  it('refuses a code that has run out of time', async () => {
    const { email } = await register();
    const code = codeSentTo(email);
    await pool.query(
      `UPDATE email_codes SET expires_at = now() - interval '1 minute'
        WHERE user_id = (SELECT id FROM users WHERE lower(email) = lower($1))`,
      [email],
    );
    const response = await verify(email, code);
    expect(response.statusCode).toBe(410);
    expect(response.json().error).toBe('expired');
  });

  it('refuses a code that was already spent', async () => {
    const { email } = await register();
    const code = codeSentTo(email);
    expect((await verify(email, code)).statusCode).toBe(201);

    const again = await verify(email, code);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('already_verified');
  });

  it('does not let a code confirm a different address', async () => {
    const first = await register();
    const second = await register();
    const response = await verify(second.email, codeSentTo(first.email));
    expect(response.statusCode).toBe(400);
  });

  it('lets a second registration replace an address nobody confirmed', async () => {
    // Otherwise registering with somebody else's address and walking away
    // would keep them out of their own for good.
    const { email } = await register();
    const retry = await register({ email, password: 'OtraClave2026!', name: 'Otra' });
    expect(retry.response.statusCode).toBe(202);

    const confirmed = await verify(email, codeSentTo(email));
    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.json().user.name).toBe('Otra');
    expect((await signIn(email, 'OtraClave2026!')).statusCode).toBe(200);
  });

  it('will not send another code inside the cooldown', async () => {
    const { email } = await register();
    const response = await resend(email);
    expect(response.statusCode).toBe(429);
    expect(response.json().retryAfterSeconds).toBeGreaterThan(0);
  });

  it('sends another code once the cooldown has run out', async () => {
    const { email } = await register();
    const first = codeSentTo(email);
    await pool.query(
      `UPDATE email_codes SET created_at = now() - interval '2 minutes'
        WHERE user_id = (SELECT id FROM users WHERE lower(email) = lower($1))`,
      [email],
    );
    expect((await resend(email)).statusCode).toBe(202);

    const second = codeSentTo(email);
    expect(second).not.toBe(first);
    expect((await verify(email, first)).statusCode).toBe(400);
    expect((await verify(email, second)).statusCode).toBe(201);
  });

  it('answers a resend for an unknown address the same way as for a real one', async () => {
    // A different answer would turn this into a way to ask which addresses
    // are registered.
    const { email } = await register();
    await pool.query(
      `UPDATE email_codes SET created_at = now() - interval '2 minutes'
        WHERE user_id = (SELECT id FROM users WHERE lower(email) = lower($1))`,
      [email],
    );
    const known = await resend(email);
    const unknown = await resend('nobody.at.all@example.test');
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(Object.keys(unknown.json()).sort()).toEqual(Object.keys(known.json()).sort());
  });

  it('refuses a code that is not six digits without spending an attempt', async () => {
    const { email } = await register();
    expect((await verify(email, '12')).statusCode).toBe(400);
    expect((await verify(email, 'abcdef')).statusCode).toBe(400);

    const { rows } = await pool.query<{ attempts: number }>(
      `SELECT attempts FROM email_codes
        WHERE user_id = (SELECT id FROM users WHERE lower(email) = lower($1))`,
      [email],
    );
    expect(rows[0]!.attempts).toBe(0);
  });
});

describe('sign in', () => {
  it('returns tokens for the right password', async () => {
    const { email } = await account();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/session',
      payload: { email, password: 'Sierras2026!' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().accessToken).toBeTruthy();
  });

  it('answers the same way for a wrong password and an unknown address', async () => {
    const { email } = await account();
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
    const { email } = await account();
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

  it('says until when, so the hiker knows to wait rather than give up', async () => {
    const { email } = await account();
    await failFiveTimes(email);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/session',
      payload: { email, password: 'Sierras2026!' },
    });
    const until = new Date(response.json().until).getTime();
    expect(until).toBeGreaterThan(Date.now());
  });

  it('answers a locked account the same way whatever password arrives', async () => {
    // The lock is checked before the password, which is the only order that
    // makes it a lock. Checked afterwards, every guess was still verified
    // against the hash and the one person it stopped was the owner.
    const { email } = await account();
    await failFiveTimes(email);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/session',
      payload: { email, password: 'TodaviaIncorrecta1!' },
    });
    expect(response.statusCode).toBe(423);
  });

  it('lets the account back in once the lock has run out', async () => {
    const { email } = await account();
    await failFiveTimes(email);
    await pool.query("UPDATE users SET locked_until = now() - interval '1 minute' WHERE lower(email) = lower($1)", [
      email,
    ]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/session',
      payload: { email, password: 'Sierras2026!' },
    });
    expect(response.statusCode).toBe(200);
  });

  async function failFiveTimes(email: string): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/session',
        payload: { email, password: 'Incorrecta1!' },
      });
    }
  }
});

describe('refresh token rotation', () => {
  it('returns a different token on each exchange', async () => {
    const { body } = await account();
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
    const { body } = await account();
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

  it('no longer serves the moderation queue to anybody', async () => {
    // The role and its two endpoints are gone. Kept as a test because a
    // route that quietly came back would reintroduce a profile nothing in
    // the application can grant.
    const { body } = await account();
    const response = await app.inject({
      method: 'GET',
      url: '/api/moderation/trails',
      headers: auth(body.accessToken),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('contributed trails', () => {
  it('recomputes the attributes and ignores anything the client sends', async () => {
    const { body } = await account();
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
    expect(response.json().attributes.distanceM).toBeLessThan(3000);
    expect(response.json().status).toBe('published');
  });

  it('publishes a valid contribution straight away', async () => {
    // There is no queue to wait in. What a reviewer could establish from a
    // track, the checks establish; what they could not, neither could the
    // reviewer. See trails/validation.ts.
    const { body } = await account();
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
    expect(catalogue.json().trails).toHaveLength(1);
    expect(catalogue.json().trails[0].status).toBe('published');
  });

  it('refuses a second recording of a trail already in the catalogue', async () => {
    // Without this the catalogue fills with copies of the same route and
    // somebody looking for it cannot tell which one to download.
    const { body } = await account();
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/api/trails',
        headers: auth(body.accessToken),
        payload: { name: 'Balcón Norte', points: TRACK },
      });

    expect((await send()).statusCode).toBe(201);
    const second = await send();
    expect(second.statusCode).toBe(409);
    expect(second.json().reason).toBe('duplicate_of_existing');
  });

  it('refuses a track with a jump no walker made', async () => {
    const { body } = await account();
    const broken = [...track(12), ...track(12, { lat: -31.9, lon: -64.9 })];
    const response = await app.inject({
      method: 'POST',
      url: '/api/trails',
      headers: auth(body.accessToken),
      payload: { name: 'Dos salidas en un archivo', points: broken },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().reason).toBe('gap_too_large');
  });

  it('refuses a track too short to be a route', async () => {
    const { body } = await account();
    const response = await app.inject({
      method: 'POST',
      url: '/api/trails',
      headers: auth(body.accessToken),
      payload: { name: 'La vuelta manzana', points: track(12, { step: 0.00002 }) },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().reason).toBe('too_short');
  });

  it('names where the problem is, so the contributor can fix the file', async () => {
    const { body } = await account();
    const broken = [...track(12), ...track(12, { lat: -31.9, lon: -64.9 })];
    const response = await app.inject({
      method: 'POST',
      url: '/api/trails',
      headers: auth(body.accessToken),
      payload: { name: 'Dos salidas en un archivo', points: broken },
    });
    expect(response.json().atPoint).toBe(12);
  });

  it('refuses a track outside the covered region', async () => {
    const { body } = await account();
    const response = await app.inject({
      method: 'POST',
      url: '/api/trails',
      headers: auth(body.accessToken),
      payload: {
        name: 'Everest',
        points: track(24, { lat: 27.98, lon: 86.92, ele: 5300 }),
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().reason).toBe('outside_covered_region');
  });

  it('refuses a track of a single point', async () => {
    const { body } = await account();
    const response = await app.inject({
      method: 'POST',
      url: '/api/trails',
      headers: auth(body.accessToken),
      payload: { name: 'Un punto', points: [TRACK[0]] },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('the catalogue delta', () => {
  /** Registers somebody and contributes a trail, which is now published. */
  async function contributed(points = TRACK) {
    const { body } = await account();
    const token = body.accessToken as string;
    const created = await app.inject({
      method: 'POST',
      url: '/api/trails',
      headers: auth(token),
      payload: { name: 'Balcón Norte', points },
    });
    return { token, trailId: created.json().id as string };
  }

  it('lets a trail through the delta exactly once', async () => {
    const { token } = await contributed();

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

  it('returns the full geometry of a published trail', async () => {
    const { token, trailId } = await contributed();
    const response = await app.inject({
      method: 'GET',
      url: `/api/trails/${trailId}/track`,
      headers: auth(token),
    });
    expect(response.json().points).toHaveLength(TRACK.length);
    expect(response.json().points[0].lat).toBeCloseTo(TRACK[0]!.lat, 6);
  });

  it('keeps a withdrawn trail out of the catalogue', async () => {
    const { token, trailId } = await contributed();
    await pool.query("UPDATE trails SET status = 'withdrawn' WHERE id = $1", [trailId]);
    const response = await app.inject({ method: 'GET', url: '/api/trails', headers: auth(token) });
    expect(response.json().trails).toHaveLength(0);
  });

  it('still lets whoever contributed it retrieve a withdrawn trail', async () => {
    // The rule used to name the moderator rather than the owner, so the one
    // person who could not retrieve their own contribution was its author.
    const { token, trailId } = await contributed();
    await pool.query("UPDATE trails SET status = 'withdrawn' WHERE id = $1", [trailId]);
    const response = await app.inject({
      method: 'GET',
      url: `/api/trails/${trailId}/track`,
      headers: auth(token),
    });
    expect(response.statusCode).toBe(200);
  });

  it('hides a withdrawn trail from everybody else', async () => {
    const { trailId } = await contributed();
    await pool.query("UPDATE trails SET status = 'withdrawn' WHERE id = $1", [trailId]);
    const other = await account();
    const response = await app.inject({
      method: 'GET',
      url: `/api/trails/${trailId}/track`,
      headers: auth(other.body.accessToken),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('report upload', () => {
  // Each call contributes a trail somewhere else in the Sierras. Two
  // recordings of the same route are now refused as duplicates, so a fixed
  // track would make every test after the first one fail for a reason that
  // has nothing to do with reports.
  let elsewhere = 0;

  async function publishedTrail() {
    const { body } = await account();
    const token = body.accessToken as string;
    const created = await app.inject({
      method: 'POST',
      url: '/api/trails',
      headers: auth(token),
      payload: {
        name: `Balcón Norte ${++elsewhere}`,
        points: track(24, { lat: -31.65 - elsewhere * 0.05 }),
      },
    });
    return { token, trailId: created.json().id as string };
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

  it('rejects a malformed row without failing the rest of the batch', async () => {
    // The device keeps a report queued until this endpoint names it, so
    // refusing the whole batch over one row left that row stopping every
    // later synchronisation, the catalogue included. An identifier built
    // from the clock, which earlier versions of the application generated,
    // is exactly how that happened.
    const { token, trailId } = await publishedTrail();
    const good = '55555555-5555-4555-8555-555555555555';
    const response = await app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: auth(token),
      payload: {
        reports: [
          ...report(trailId, good).reports,
          { id: 'report-1762700002000', trailId, kind: 'otro', createdAt: '2026-11-08T12:00:00.000Z' },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().accepted).toEqual([good]);
    expect(response.json().rejected).toEqual([
      { id: 'report-1762700002000', reason: 'invalid_report' },
    ]);
  });

  it('answers 400 only when the envelope itself is not a batch', async () => {
    const { token } = await publishedTrail();
    const response = await app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: auth(token),
      payload: { reports: [] },
    });
    expect(response.statusCode).toBe(400);
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

    const other = await account();
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
