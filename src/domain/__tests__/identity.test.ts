import { InvalidIdSourceError, isUuid, uuidFromHex } from '../identity';

const SIXTEEN_BYTES = 'ffffffffffffffffffffffffffffffff';

describe('building an identifier', () => {
  it('lays the bytes out in the five groups of a UUID', () => {
    expect(uuidFromHex('0123456789abcdef0123456789abcdef')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('marks it as version 4 whatever the random bytes said', () => {
    // The thirteenth digit carries the version and is not random. Passing
    // it through is what produces a string that reads like a UUID and is
    // rejected by the server, which is the failure this guards.
    expect(uuidFromHex(SIXTEEN_BYTES)[14]).toBe('4');
    expect(uuidFromHex('0'.repeat(32))[14]).toBe('4');
  });

  it('forces the two high bits of the variant, so it always reads 8 to b', () => {
    expect(uuidFromHex(SIXTEEN_BYTES)[19]).toBe('b');
    expect(uuidFromHex('0'.repeat(32))[19]).toBe('8');
  });

  it('accepts what SQLite returns, which is uppercase', () => {
    expect(uuidFromHex('0123456789ABCDEF0123456789ABCDEF')).toBe(
      uuidFromHex('0123456789abcdef0123456789abcdef'),
    );
  });

  it('refuses a source that did not give sixteen bytes', () => {
    expect(() => uuidFromHex('abcd')).toThrow(InvalidIdSourceError);
    expect(() => uuidFromHex('')).toThrow(InvalidIdSourceError);
  });

  it('produces something the server would accept', () => {
    expect(isUuid(uuidFromHex(SIXTEEN_BYTES))).toBe(true);
    expect(isUuid(uuidFromHex('0'.repeat(32)))).toBe(true);
  });

  it('keeps every random byte, so distinct bytes give distinct identifiers', () => {
    const a = uuidFromHex('0123456789abcdef0123456789abcde0');
    const b = uuidFromHex('0123456789abcdef0123456789abcde1');
    expect(a).not.toBe(b);
  });
});

describe('recognising an identifier', () => {
  it('rejects the clock based scheme the application used before', () => {
    expect(isUuid('report-1762700000000')).toBe(false);
    expect(isUuid('imported-1762700000000')).toBe(false);
  });

  it('rejects a slug, which is what the preloaded trails once used', () => {
    expect(isUuid('quebrada-del-condorito')).toBe(false);
  });

  it('accepts the identifiers of the preloaded catalogue', () => {
    expect(isUuid('7b1f0c2a-0001-4a00-8000-000000000001')).toBe(true);
  });
});
