/** Rules that hold without a database behind them. */
import { hashPassword, passwordProblems, verifyPassword } from '../auth/password';
import { readAccessToken, signAccessToken } from '../auth/tokens';
import { validateGeometry } from '../routes/trails';
import type { Point } from '../../../src/domain/types';

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
  it('round trips the identity and the role', async () => {
    const token = await signAccessToken({ userId: 'abc-123', role: 'moderator' });
    await expect(readAccessToken(token)).resolves.toEqual({
      userId: 'abc-123',
      role: 'moderator',
    });
  });

  it('rejects a token whose payload was altered', async () => {
    const token = await signAccessToken({ userId: 'abc-123', role: 'hiker' });
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'abc-123', role: 'moderator' }))
      .toString('base64url');
    await expect(readAccessToken(`${header}.${forged}.${signature}`)).resolves.toBeNull();
  });

  it('rejects something that is not a token at all', async () => {
    await expect(readAccessToken('nonsense')).resolves.toBeNull();
  });
});

describe('validateGeometry', () => {
  const inSierras = (lat: number, lon: number, time?: string): Point =>
    time ? { lat, lon, time } : { lat, lon };

  it('accepts a track inside the covered region', () => {
    expect(
      validateGeometry([inSierras(-31.65, -64.68), inSierras(-31.66, -64.69)]),
    ).toBeNull();
  });

  it('rejects a track outside the covered region', () => {
    // Cartography this project does not serve cannot be moderated usefully.
    expect(validateGeometry([inSierras(-31.65, -64.68), inSierras(27.98, 86.92)])).toBe(
      'outside_covered_region',
    );
  });

  it('rejects a speed no walker reaches', () => {
    const points = [
      inSierras(-31.65, -64.68, '2026-11-08T10:00:00.000Z'),
      inSierras(-31.55, -64.68, '2026-11-08T10:01:00.000Z'), // around 11 km in a minute
    ];
    expect(validateGeometry(points)).toBe('implausible_speed');
  });

  it('accepts a plausible walking speed', () => {
    const points = [
      inSierras(-31.65, -64.68, '2026-11-08T10:00:00.000Z'),
      inSierras(-31.6505, -64.6805, '2026-11-08T10:01:00.000Z'),
    ];
    expect(validateGeometry(points)).toBeNull();
  });

  it('skips the speed check where a timestamp is missing', () => {
    // Several export tools drop the time, and that is not a reason to
    // refuse an otherwise valid track.
    const points = [inSierras(-31.65, -64.68), inSierras(-31.55, -64.68)];
    expect(validateGeometry(points)).toBeNull();
  });

  it('ignores a pair whose timestamps do not advance', () => {
    const points = [
      inSierras(-31.65, -64.68, '2026-11-08T10:00:00.000Z'),
      inSierras(-31.6501, -64.6801, '2026-11-08T10:00:00.000Z'),
    ];
    expect(validateGeometry(points)).toBeNull();
  });
});
