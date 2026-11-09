/** Account creation, sign in, token refresh and sign out.
 *
 *  This is the only part of the system that requires connectivity for the
 *  hiker to get started. Everything the walk itself needs runs on the
 *  device, so these endpoints are called once per device and not once per
 *  outing.
 */
import type { FastifyInstance } from 'fastify';

import { hashPassword, passwordProblems, verifyPassword } from '../auth/password';
import {
  issueRefreshToken,
  revokeAllSessions,
  rotateRefreshToken,
  signAccessToken,
} from '../auth/tokens';
import { pool, withTransaction } from '../db/pool';
import { profileUpdateSchema, refreshSchema, registerSchema, sessionSchema } from '../schemas';
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
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
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

    try {
      const result = await withTransaction(async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO users (email, password_hash, name, level)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [email, passwordHash, name, level],
        );
        const user = rows[0]!;
        const refresh = await issueRefreshToken(user.id, client);
        return { user, refresh };
      });

      const accessToken = await signAccessToken({ userId: result.user.id });

      return reply.code(201).send({
        user: { id: result.user.id, name, email, level },
        accessToken,
        refreshToken: result.refresh.token,
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
}
