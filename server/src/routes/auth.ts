/** Account creation, sign in, token refresh and sign out.
 *
 *  This is the only part of the system that requires connectivity for the
 *  hiker to get started. Everything the walk itself needs runs on the
 *  device, so these endpoints are called once per device and not once per
 *  outing.
 */
import type { FastifyInstance } from 'fastify';

import {
  checkCode,
  CODE_TTL_MINUTES,
  cooldownRemaining,
  issueCode,
} from '../auth/codes';
import { hashPassword, passwordProblems, verifyPassword } from '../auth/password';
import { lockMessage, recoveryMessage, sendMail, verificationMessage } from '../mail/mailer';
import {
  issueRefreshToken,
  revokeAllSessions,
  rotateRefreshToken,
  signAccessToken,
} from '../auth/tokens';
import { pool, withTransaction } from '../db/pool';
import {
  profileUpdateSchema,
  refreshSchema,
  registerSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  resendCodeSchema,
  sessionSchema,
  verifyCodeSchema,
} from '../schemas';
import type { Level } from '../../../src/domain/types';

const LOCK_AFTER_FAILURES = 5;
const LOCK_MINUTES = 15;

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  level: Level;
  failed_attempts: number;
  locked_until: Date | null;
  email_verified_at: Date | null;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Starts a registration, which no longer finishes here.
   *
   * The account row is written and nothing is handed back. An address is
   * a claim until somebody proves they can read what is sent to it, and
   * this endpoint used to return a usable pair of tokens the instant a
   * form was submitted, so anybody could sign up as anybody.
   *
   * See docs/adr/0016.
   */
  app.post('/api/auth/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const { name, email, password, level } = parsed.data;

    // Every failing rule is reported at once, so the person is not sent back
    // and forth discovering one requirement at a time.
    const problems = passwordProblems(password);
    if (problems.length > 0) {
      return reply.code(400).send({ error: 'weak_password', problems });
    }

    const passwordHash = await hashPassword(password);

    // An address carrying a verified account is taken and that is the end of
    // it. One carrying an unverified account is not: nobody has proved they
    // hold it, so the registration arriving now replaces the one that was
    // abandoned. Without this, registering with somebody else's address and
    // never confirming it would keep them out of their own for good.
    const existing = await pool.query<{ id: string; verified: boolean }>(
      'SELECT id, email_verified_at IS NOT NULL AS verified FROM users WHERE lower(email) = lower($1)',
      [email],
    );
    const held = existing.rows[0];
    if (held?.verified) return reply.code(409).send({ error: 'email_taken' });

    let userId: string;
    try {
      userId = await withTransaction(async (client) => {
        if (held) {
          await client.query(
            `UPDATE users
                SET email = $2, password_hash = $3, name = $4, level = $5,
                    failed_attempts = 0, locked_until = NULL
              WHERE id = $1`,
            [held.id, email, passwordHash, name, level],
          );
          return held.id;
        }
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO users (email, password_hash, name, level)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [email, passwordHash, name, level],
        );
        return rows[0]!.id;
      });
    } catch (error) {
      // The unique index on lower(email) is what enforces that the address
      // identifies one account, and it does so even under two simultaneous
      // registrations, which a prior SELECT would not.
      if ((error as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'email_taken' });
      }
      throw error;
    }

    await sendCode(userId, email);

    return reply.code(202).send({
      status: 'verification_sent',
      email,
      expiresInMinutes: CODE_TTL_MINUTES,
    });
  });

  /**
   * Finishes a registration, and is the only place tokens are first issued.
   *
   * Answers 201 with exactly what the registration used to answer, so a
   * device that gets this far is in the state it was in before.
   */
  app.post('/api/auth/register/verify', async (request, reply) => {
    const parsed = verifyCodeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const { email, code } = parsed.data;

    const { rows } = await pool.query<UserRow & { verified: boolean }>(
      `SELECT id, name, email, level, email_verified_at IS NOT NULL AS verified
         FROM users WHERE lower(email) = lower($1)`,
      [email],
    );
    const user = rows[0];

    // An unknown address is answered as a wrong code rather than as an
    // unknown address, so this does not become a way to ask which addresses
    // are registered. An address that is already verified is told so,
    // because the registration endpoint reveals as much and the device
    // needs to know to send the person to sign in instead.
    if (!user) return reply.code(400).send({ error: 'invalid_code', attemptsLeft: 0 });
    if (user.verified) return reply.code(409).send({ error: 'already_verified' });

    const result = await checkCode(user.id, code, email, 'verify_email');
    if (!result.ok) {
      if (result.reason === 'wrong') {
        return reply.code(400).send({ error: 'invalid_code', attemptsLeft: result.attemptsLeft });
      }
      // Expired, spent, or guessed at five times. All three need a new code
      // rather than another guess, which is a different thing to tell
      // somebody than that the digits were wrong.
      return reply.code(410).send({ error: result.reason });
    }

    await pool.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [user.id]);

    const refresh = await issueRefreshToken(user.id);
    const accessToken = await signAccessToken({ userId: user.id });

    return reply.code(201).send({
      user: { id: user.id, name: user.name, email: user.email, level: user.level },
      accessToken,
      refreshToken: refresh.token,
    });
  });

  /** Another code, at most one a minute. */
  app.post('/api/auth/register/resend', async (request, reply) => {
    const parsed = resendCodeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const { email } = parsed.data;

    const { rows } = await pool.query<{ id: string; verified: boolean }>(
      'SELECT id, email_verified_at IS NOT NULL AS verified FROM users WHERE lower(email) = lower($1)',
      [email],
    );
    const user = rows[0];

    // Accepted whatever the state of the address, and nothing is sent when
    // there is nothing to send. A different answer for an address that is
    // not registered would turn this into a way to enumerate them.
    const accepted = {
      status: 'verification_sent',
      email,
      expiresInMinutes: CODE_TTL_MINUTES,
    };
    if (!user || user.verified) return reply.code(202).send(accepted);

    const wait = await cooldownRemaining(user.id, 'verify_email');
    if (wait > 0) return reply.code(429).send({ error: 'too_soon', retryAfterSeconds: wait });

    await sendCode(user.id, email);
    return reply.code(202).send(accepted);
  });

  app.post('/api/auth/session', async (request, reply) => {
    const parsed = sessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body' });
    }
    const { email, password } = parsed.data;

    const { rows } = await pool.query<UserRow>(
      'SELECT * FROM users WHERE lower(email) = lower($1)',
      [email],
    );
    const user = rows[0];

    // Before the password, and not after. Verified afterwards, the lock
    // stopped nobody: every guess was still checked against the hash, the
    // counter was raised again on each one, and the only person who ever
    // saw the lock was the owner arriving with the right password. Which
    // means it does reveal that an address is registered, and that is the
    // accepted cost of telling somebody who mistyped why they cannot get
    // in and for how long.
    if (user?.locked_until && user.locked_until.getTime() > Date.now()) {
      return reply
        .code(423)
        .send({ error: 'account_locked', until: user.locked_until.toISOString() });
    }

    // The password is verified even when no account matches, so that the
    // response time does not reveal which addresses are registered.
    const stored = user?.password_hash ?? (await hashPassword('placeholder-for-timing'));
    const matches = await verifyPassword(stored, password);

    if (!user || !matches) {
      if (user) await registerFailure(user);
      return reply.code(401).send({ error: 'invalid_credentials' });
    }

    // The password is right but the address was never proved, which is
    // where somebody who closed the application before entering their code
    // ends up. A fresh code goes out, subject to the same cooldown, and the
    // device is sent to the screen that asks for it.
    if (user.email_verified_at === null) {
      const wait = await cooldownRemaining(user.id, 'verify_email');
      if (wait === 0) await sendCode(user.id, user.email);
      return reply
        .code(403)
        .send({ error: 'email_not_verified', email: user.email, retryAfterSeconds: wait });
    }

    await pool.query(
      'UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1',
      [user.id],
    );

    const refresh = await issueRefreshToken(user.id);
    const accessToken = await signAccessToken({ userId: user.id });

    return reply.send({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        level: user.level,
      },
      accessToken,
      refreshToken: refresh.token,
    });
  });

  /**
   * Asks for a code to choose a new password.
   *
   * Accepted whatever the address turns out to be, and nothing is sent when
   * there is nothing to send. A different answer would turn this into a way
   * to ask which addresses are registered, which is the one thing a
   * recovery endpoint must not become.
   *
   * Only an account whose address was proved can be recovered. An unproved
   * one has a registration to finish instead, and signing in already sends
   * somebody there; allowing recovery on it would be a second way to claim
   * an address nobody has held. See docs/adr/0017.
   */
  app.post('/api/auth/password/forgot', async (request, reply) => {
    const parsed = passwordResetRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const { email } = parsed.data;

    const { rows } = await pool.query<{ id: string; verified: boolean }>(
      'SELECT id, email_verified_at IS NOT NULL AS verified FROM users WHERE lower(email) = lower($1)',
      [email],
    );
    const user = rows[0];
    const accepted = { status: 'recovery_sent', email, expiresInMinutes: CODE_TTL_MINUTES };

    if (!user || !user.verified) return reply.code(202).send(accepted);

    const wait = await cooldownRemaining(user.id, 'reset_password');
    if (wait > 0) return reply.code(429).send({ error: 'too_soon', retryAfterSeconds: wait });

    const code = await issueCode(user.id, email, 'reset_password');
    await sendMail({ to: email, ...recoveryMessage(code, CODE_TTL_MINUTES) });
    return reply.code(202).send(accepted);
  });

  /**
   * Sets the new password and hands back a session.
   *
   * Every other session of the account is revoked first. Somebody
   * recovering a password may be doing it because another person has the
   * old one, and leaving that person's refresh token alive would make the
   * whole exercise pointless.
   *
   * A session is issued rather than sending them back to sign in. They have
   * just proved they hold the address and they have just chosen the
   * password, which is strictly more than signing in asks for.
   */
  app.post('/api/auth/password/reset', async (request, reply) => {
    const parsed = passwordResetSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const { email, code, password } = parsed.data;

    const problems = passwordProblems(password);
    if (problems.length > 0) return reply.code(400).send({ error: 'weak_password', problems });

    const { rows } = await pool.query<UserRow & { verified: boolean }>(
      `SELECT id, name, email, level, email_verified_at IS NOT NULL AS verified
         FROM users WHERE lower(email) = lower($1)`,
      [email],
    );
    const user = rows[0];

    // An unknown or unproved address is answered as a wrong code, for the
    // same reason the request above is always accepted.
    if (!user || !user.verified) {
      return reply.code(400).send({ error: 'invalid_code', attemptsLeft: 0 });
    }

    const result = await checkCode(user.id, code, email, 'reset_password');
    if (!result.ok) {
      if (result.reason === 'wrong') {
        return reply.code(400).send({ error: 'invalid_code', attemptsLeft: result.attemptsLeft });
      }
      return reply.code(410).send({ error: result.reason });
    }

    const passwordHash = await hashPassword(password);
    await pool.query(
      `UPDATE users SET password_hash = $2, failed_attempts = 0, locked_until = NULL
        WHERE id = $1`,
      [user.id, passwordHash],
    );
    await revokeAllSessions(user.id);

    const refresh = await issueRefreshToken(user.id);
    const accessToken = await signAccessToken({ userId: user.id });

    return reply.code(201).send({
      user: { id: user.id, name: user.name, email: user.email, level: user.level },
      accessToken,
      refreshToken: refresh.token,
    });
  });

  app.post('/api/auth/refresh', async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

    const result = await rotateRefreshToken(parsed.data.refreshToken);
    if (!result.ok) {
      // Reuse means every session of the account was just revoked, and the
      // device is told so it can send the person to sign in again.
      return reply.code(401).send({ error: 'invalid_refresh_token', reason: result.reason });
    }
    return reply.send({
      accessToken: result.accessToken,
      refreshToken: result.refresh.token,
    });
  });

  app.post(
    '/api/auth/logout',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      await revokeAllSessions(request.user!.id);
      return reply.code(204).send();
    },
  );

  app.get('/api/auth/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { rows } = await pool.query<UserRow>(
      'SELECT id, email, name, level FROM users WHERE id = $1',
      [request.user!.id],
    );
    const user = rows[0];
    if (!user) return reply.code(404).send({ error: 'not_found' });
    return reply.send({
      id: user.id,
      name: user.name,
      email: user.email,
      level: user.level,
    });
  });

  // The declared level changes on the device and travels up on the next
  // synchronisation, which is why this is an ordinary authenticated write
  // and not part of the sign in exchange.
  app.patch('/api/auth/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = profileUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

    const { rows } = await pool.query<UserRow>(
      `UPDATE users
          SET name = COALESCE($2, name),
              level = COALESCE($3, level)
        WHERE id = $1
        RETURNING id, email, name, level`,
      [request.user!.id, parsed.data.name ?? null, parsed.data.level ?? null],
    );
    const user = rows[0]!;
    return reply.send({
      id: user.id,
      name: user.name,
      email: user.email,
      level: user.level,
    });
  });
}

/** Counts a failed attempt and locks the account once the threshold is met. */
/**
 * Issues a code and sends it.
 *
 * Failure to deliver is not failure to register. The account row stays and
 * the person asks for another code, which is better than rolling back an
 * account they may already have been told was created.
 */
async function sendCode(userId: string, email: string): Promise<void> {
  const code = await issueCode(userId, email, 'verify_email');
  await sendMail({ to: email, ...verificationMessage(code, CODE_TTL_MINUTES) });
}

async function registerFailure(user: UserRow): Promise<void> {
  const attempts = user.failed_attempts + 1;
  const locked = attempts >= LOCK_AFTER_FAILURES;
  await pool.query(
    `UPDATE users
        SET failed_attempts = $2,
            locked_until = CASE WHEN $3 THEN now() + ($4 || ' minutes')::interval ELSE locked_until END
      WHERE id = $1`,
    [user.id, locked ? 0 : attempts, locked, String(LOCK_MINUTES)],
  );

  // The owner is told, because they are the only person who can tell the
  // two cases apart. Five mistyped attempts of their own need no action; five
  // from somebody else are the reason this message exists. Sent on the lock
  // and not on each failure, so a forgotten password does not produce five
  // mails.
  if (locked) {
    await sendMail({ to: user.email, ...lockMessage(LOCK_MINUTES) });
  }
}
