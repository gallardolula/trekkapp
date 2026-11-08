/** Password hashing and policy.
 *
 *  Argon2id with the minimum parameters the OWASP password storage cheat
 *  sheet recommends. The choice over bcrypt is that its cost scales in
 *  memory and not only in computing time, which is what makes a brute force
 *  run on parallel hardware expensive.
 *
 *  The minimums are taken rather than higher values because this memory is
 *  spent by the server on every sign in, and the volume of authentication is
 *  low: the hike needs no active session, so a hiker signs in once per
 *  device and not once per outing.
 */
import { Algorithm, hash, verify } from '@node-rs/argon2';

const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456, // 19 MiB, expressed in KiB
  timeCost: 2,
  parallelism: 1,
} as const;

/** A per user random value is added by the library and kept inside the hash. */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

/** Returns false on a malformed stored hash instead of throwing. */
export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain, OPTIONS);
  } catch {
    return false;
  }
}

export const MIN_PASSWORD_LENGTH = 8;

const RULES: { test: RegExp; code: string }[] = [
  { test: /[A-Z]/, code: 'uppercase' },
  { test: /[a-z]/, code: 'lowercase' },
  { test: /[0-9]/, code: 'digit' },
  { test: /[^A-Za-z0-9]/, code: 'symbol' },
];

/**
 * Returns the codes of the rules the password fails, empty when it passes.
 *
 * Codes rather than sentences, because the wording the hiker reads belongs
 * to the application and is written in its own language.
 */
export function passwordProblems(plain: string): string[] {
  const problems: string[] = [];
  if (plain.length < MIN_PASSWORD_LENGTH) problems.push('too_short');
  for (const rule of RULES) {
    if (!rule.test.test(plain)) problems.push(rule.code);
  }
  return problems;
}
