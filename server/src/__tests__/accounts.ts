/** Creating a usable account in a test.
 *
 *  Registration is two exchanges now: the form, and the code that arrives by
 *  mail. Every test that needs a token needs both, and three files were
 *  writing the first one out by hand, so it lives here instead.
 *
 *  The code is read from the mailer's outbox, which is where a message goes
 *  when no transport is configured. That is the case under test, so nothing
 *  has to be stubbed and the real route is exercised, mail and all.
 */
import type { FastifyInstance } from 'fastify';

import { clearOutbox, outbox } from '../mail/mailer';

export interface Account {
  email: string;
  token: string;
  refreshToken: string;
  userId: string;
}

/** The six digits of the last message sent to an address. */
export function codeSentTo(email: string): string {
  const message = [...outbox].reverse().find((m) => m.to.toLowerCase() === email.toLowerCase());
  if (!message) throw new Error(`no code was sent to ${email}`);
  const found = /\b(\d{6})\b/.exec(message.text);
  if (!found) throw new Error(`no six digit code in the message to ${email}: ${message.text}`);
  return found[1]!;
}

let counter = 0;

/** An address nothing else in the suite will claim. */
export function uniqueEmail(prefix = 'hiker'): string {
  return `${prefix}${++counter}.${Date.now()}@example.test`;
}

/**
 * Registers, reads the code and verifies, leaving an account that can be
 * used. Overrides go to the registration payload.
 */
export async function createAccount(
  app: FastifyInstance,
  overrides: Record<string, unknown> = {},
): Promise<Account> {
  const email = (overrides['email'] as string) ?? uniqueEmail();

  const registered = await app.inject({
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
  if (registered.statusCode !== 202) {
    throw new Error(`registration answered ${registered.statusCode}: ${registered.body}`);
  }

  const verified = await app.inject({
    method: 'POST',
    url: '/api/auth/register/verify',
    payload: { email, code: codeSentTo(email) },
  });
  if (verified.statusCode !== 201) {
    throw new Error(`verification answered ${verified.statusCode}: ${verified.body}`);
  }

  const body = verified.json();
  return {
    email,
    token: body.accessToken,
    refreshToken: body.refreshToken,
    userId: body.user.id,
  };
}

export { clearOutbox };
