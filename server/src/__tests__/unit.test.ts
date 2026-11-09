/** Rules that hold without a database behind them. */
import { hashPassword, passwordProblems, verifyPassword } from '../auth/password';
import { readAccessToken, signAccessToken } from '../auth/tokens';

describe('passwordProblems', () => {
  it('accepts a password that meets every rule', () => {
    expect(passwordProblems('Sierras2026!')).toEqual([]);
  });

  it('reports every failing rule at once and not just the first', () => {
    // The point of returning a list is that the person is not sent back and
    // forth discovering one requirement at a time.
    expect(passwordProblems('corta')).toEqual(['too_short', 'uppercase', 'digit', 'symbol']);
  });

  it('rejects a password of seven characters that is otherwise valid', () => {
    expect(passwordProblems('Abc123!')).toEqual(['too_short']);
  });

  it.each([
    ['sierras2026!', 'uppercase'],
    ['SIERRAS2026!', 'lowercase'],
    ['SierrasAbc!!', 'digit'],
    ['Sierras20260', 'symbol'],
  ])('%s is missing %s', (password, expected) => {
    expect(passwordProblems(password)).toEqual([expected]);
  });
});

describe('password hashing', () => {
  // Argon2id is deliberately slow, so these get room beyond the default.
  jest.setTimeout(20_000);

  it('verifies a password against its own hash', async () => {
    const stored = await hashPassword('Sierras2026!');
    await expect(verifyPassword(stored, 'Sierras2026!')).resolves.toBe(true);
  });

  it('rejects a different password', async () => {
    const stored = await hashPassword('Sierras2026!');
    await expect(verifyPassword(stored, 'Sierras2027!')).resolves.toBe(false);
  });

  it('produces a different hash for the same password', async () => {
    // Different because of the per user random value, which is what stops
    // two identical passwords from being recognisable as such in a dump.
    const a = await hashPassword('Sierras2026!');
    const b = await hashPassword('Sierras2026!');
    expect(a).not.toEqual(b);
  });

  it('returns false instead of throwing on a malformed stored hash', async () => {
    await expect(verifyPassword('not-a-hash', 'Sierras2026!')).resolves.toBe(false);
  });
});

describe('access tokens', () => {
  it('round trips the identity', async () => {
    // The identity and nothing else. The token used to carry a role, which
    // went with the moderator it existed for.
    const token = await signAccessToken({ userId: 'abc-123' });
    await expect(readAccessToken(token)).resolves.toEqual({ userId: 'abc-123' });
  });

  it('rejects a token whose payload was altered', async () => {
    const token = await signAccessToken({ userId: 'abc-123' });
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'otra-persona' }))
      .toString('base64url');
    await expect(readAccessToken(`${header}.${forged}.${signature}`)).resolves.toBeNull();
  });

  it('rejects something that is not a token at all', async () => {
    await expect(readAccessToken('nonsense')).resolves.toBeNull();
  });
});
