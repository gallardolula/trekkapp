/** The code that proves somebody holds the address they registered with.
 *
 *  Six digits, because it is typed on a phone from a message read on the
 *  same phone, and a longer secret would be copied and pasted or written
 *  down. Six digits is only a million possibilities, so the strength is not
 *  in the code but in what surrounds it: it dies after fifteen minutes,
 *  after five wrong guesses and after being used once, and a new one can be
 *  asked for only every sixty seconds.
 *
 *  Stored as a hash, like the passwords and the refresh tokens. The same
 *  Argon2 parameters as a password are more than this needs, which is the
 *  point; it costs the server a fraction of a second once per registration
 *  and costs anybody working through a stolen table the whole million.
 *
 *  A dead code is not deleted and not marked spent. It stays as the reason
 *  the next attempt is refused, and the replacement is what retires it.
 *
 *  Attempts are counted against the code and never against the account.
 *  Counting them on the account would mean that guessing at somebody's
 *  verification code locks them out of signing in, which hands a stranger a
 *  way to shut an account down.
 */
import { randomInt } from 'node:crypto';

import type { PoolClient } from 'pg';

import { pool } from '../db/pool';
import { hashPassword, verifyPassword } from './password';

/**
 * What spending a code does.
 *
 * Both kinds prove the same thing, that somebody can read what was sent to
 * the address. What they are then allowed to do with that proof is the only
 * difference, and it is enough of one that a code issued for the first must
 * never be accepted for the second.
 */
export type CodePurpose = 'verify_email' | 'reset_password';

/** How long a code is good for. */
export const CODE_TTL_MINUTES = 15;

/** How many wrong guesses a single code survives. */
export const MAX_ATTEMPTS = 5;

/** How long before another code can be asked for. */
export const RESEND_COOLDOWN_SECONDS = 60;

/** Six digits, from the system's source rather than Math.random. */
function freshCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Issues a code for an account, retiring whatever it had.
 *
 * Returns the code itself, which is the only moment it exists in the clear.
 * The caller sends it and forgets it.
 */
export async function issueCode(
  userId: string,
  sentTo: string,
  purpose: CodePurpose,
  client: PoolClient | typeof pool = pool,
): Promise<string> {
  const code = freshCode();
  const hash = await hashPassword(code);

  // The live code is marked spent rather than deleted, so the row that says
  // a code was issued at all survives for as long as the account does.
  await client.query(
    `UPDATE email_codes SET consumed_at = now()
      WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [userId, purpose],
  );
  await client.query(
    `INSERT INTO email_codes (user_id, code_hash, sent_to, purpose, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval)`,
    [userId, hash, sentTo, purpose, String(CODE_TTL_MINUTES)],
  );

  return code;
}

/**
 * Seconds still to wait before another code may be asked for, or zero.
 *
 * Read from the live code's own age, so a restart of the server does not
 * reset the cooldown and a caller cannot get a fresh code per process.
 */
export async function cooldownRemaining(userId: string, purpose: CodePurpose): Promise<number> {
  const { rows } = await pool.query<{ seconds: number }>(
    `SELECT ceil($2 - extract(epoch FROM now() - created_at))::int AS seconds
       FROM email_codes
      WHERE user_id = $1 AND purpose = $3 AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId, RESEND_COOLDOWN_SECONDS, purpose],
  );
  return Math.max(0, rows[0]?.seconds ?? 0);
}

export type CheckResult =
  | { ok: true }
  | { ok: false; reason: 'no_code' | 'expired' | 'exhausted' | 'wrong'; attemptsLeft: number };

interface CodeRow {
  id: string;
  code_hash: string;
  attempts: number;
  expired: boolean;
}

/**
 * Checks a code against the account's live one and spends it when it matches.
 *
 * The attempt is recorded before the answer is returned, so a caller that
 * abandons the request mid-way has still used up a guess.
 */
export async function checkCode(
  userId: string,
  code: string,
  sentTo: string,
  purpose: CodePurpose,
): Promise<CheckResult> {
  const { rows } = await pool.query<CodeRow>(
    `SELECT id, code_hash, attempts, (expires_at <= now()) AS expired
       FROM email_codes
      WHERE user_id = $1 AND purpose = $3 AND consumed_at IS NULL
        AND lower(sent_to) = lower($2)
      LIMIT 1`,
    [userId, sentTo, purpose],
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: 'no_code', attemptsLeft: 0 };

  // A code that is out of time or out of guesses keeps its row rather than
  // being marked spent. The row is what lets the next attempt be answered
  // with the reason, and 'ask for another code' is a different thing to
  // tell somebody than 'there is no code', which is what a spent row says.
  // Issuing the replacement is what retires it.
  if (row.expired) return { ok: false, reason: 'expired', attemptsLeft: 0 };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'exhausted', attemptsLeft: 0 };

  const matches = await verifyPassword(row.code_hash, code);

  if (!matches) {
    const { rows: after } = await pool.query<{ attempts: number }>(
      'UPDATE email_codes SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts',
      [row.id],
    );
    const used = after[0]?.attempts ?? MAX_ATTEMPTS;
    return { ok: false, reason: 'wrong', attemptsLeft: Math.max(0, MAX_ATTEMPTS - used) };
  }

  await pool.query('UPDATE email_codes SET consumed_at = now() WHERE id = $1', [row.id]);
  return { ok: true };
}
