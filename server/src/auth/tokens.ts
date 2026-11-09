/** Access and refresh tokens.
 *
 *  The access token is short lived and carries the identity, so an ordinary
 *  request needs no database round trip to be authorised. The refresh token
 *  is long lived, is stored only as a hash, and rotates on every use.
 *
 *  Rotation is what turns a stolen refresh token into a detectable event:
 *  the legitimate device and the attacker cannot both exchange the same
 *  token, and the second attempt arrives on a row already marked as used.
 */
import { createHash, randomBytes } from 'node:crypto';

import { SignJWT, jwtVerify } from 'jose';
import type { PoolClient } from 'pg';

import { config } from '../config';
import { pool } from '../db/pool';

// There is one kind of account. The moderator role was removed together
// with the review queue it existed for, because a contributed trail is now
// validated by the system and published or refused. See
// trails/validation.ts for what the checks can and cannot establish.
export interface AccessClaims {
  userId: string;
}

const key = new TextEncoder().encode(config.jwtSecret);
const ISSUER = 'trekkapp';

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${config.accessTokenMinutes}m`)
    .sign(key);
}

/** Returns the claims, or null when the token is absent, altered or expired. */
export async function readAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER });
    if (!payload.sub) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

// The refresh token is an opaque random string, not a JWT. Nothing reads its
// content, so there is nothing to gain from making it readable, and keeping
// it opaque means the stored hash is the only way to recognise it.
const fingerprint = (token: string) => createHash('sha256').update(token).digest('hex');

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

export async function issueRefreshToken(
  userId: string,
  client: PoolClient | typeof pool = pool,
): Promise<IssuedRefreshToken> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.refreshTokenDays * 24 * 60 * 60 * 1000);
  await client.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, fingerprint(token), expiresAt],
  );
  return { token, expiresAt };
}

export type RotationResult =
  | { ok: true; userId: string; refresh: IssuedRefreshToken; accessToken: string }
  | { ok: false; reason: 'unknown' | 'expired' | 'reused' };

/**
 * Exchanges a refresh token for a new pair, in a single transaction.
 *
 * Presenting a token that was already exchanged is treated as a compromise
 * and every session of that account is revoked, because the legitimate
 * device and whoever copied the token cannot be told apart at this point.
 */
export async function rotateRefreshToken(token: string): Promise<RotationResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{
      id: string;
      user_id: string;
      expires_at: Date;
      used_at: Date | null;
    }>(
      `SELECT t.id, t.user_id, t.expires_at, t.used_at
         FROM refresh_tokens t
        WHERE t.token_hash = $1
          FOR UPDATE OF t`,
      [fingerprint(token)],
    );

    const row = rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'unknown' };
    }
    if (row.used_at) {
      // Reuse. Revoke everything rather than guess which side is genuine.
      await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [row.user_id]);
      await client.query('COMMIT');
      return { ok: false, reason: 'reused' };
    }
    if (row.expires_at.getTime() <= Date.now()) {
      await client.query('DELETE FROM refresh_tokens WHERE id = $1', [row.id]);
      await client.query('COMMIT');
      return { ok: false, reason: 'expired' };
    }

    await client.query('UPDATE refresh_tokens SET used_at = now() WHERE id = $1', [row.id]);
    const refresh = await issueRefreshToken(row.user_id, client);
    const accessToken = await signAccessToken({ userId: row.user_id });
    await client.query('COMMIT');
    return { ok: true, userId: row.user_id, refresh, accessToken };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Drops every session of a user, used on sign out and on reuse detection. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
}

/** Removes expired and already exchanged rows, so the table does not grow forever. */
export async function purgeStaleTokens(): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM refresh_tokens
      WHERE expires_at < now()
         OR (used_at IS NOT NULL AND used_at < now() - INTERVAL '1 day')`,
  );
  return rowCount ?? 0;
}
