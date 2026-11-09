/** Identifiers generated on the device.
 *
 *  Anything the hiker creates on the trail is identified here rather than by
 *  the server, because there is no server at that moment. The identifier is
 *  also what makes the upload idempotent: a batch that is sent twice, after
 *  a response that never arrived, carries the same identifiers and changes
 *  nothing. See docs/adr/0004.
 *
 *  Version 4 UUIDs, which is what the server stores and validates. A scheme
 *  built from the clock looks unique on one device and is not: two phones
 *  that report the same obstacle within the same millisecond produce the
 *  same identifier, and the second report would silently take the place of
 *  the first.
 */

/** Thrown when the random source did not return the expected bytes. */
export class InvalidIdSourceError extends Error {
  constructor(received: string) {
    super(`expected 32 hexadecimal digits, received ${received.length}`);
    this.name = 'InvalidIdSourceError';
  }
}

/**
 * Builds a version 4 UUID out of sixteen random bytes, given as hexadecimal.
 *
 * The randomness comes from the caller, so the one part worth testing, the
 * layout, can be tested without one. Two groups of bits are not random: the
 * version, which must read 4, and the variant, whose two high bits must read
 * 10. Leaving them as they came produces a string that looks like a UUID and
 * is rejected by anything that parses one, which is exactly the failure this
 * module exists to avoid.
 */
export function uuidFromHex(hex: string): string {
  const digits = hex.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (digits.length !== 32) throw new InvalidIdSourceError(digits);

  const version = `4${digits.slice(13, 16)}`;
  const variant = `${((parseInt(digits[16]!, 16) & 0x3) | 0x8).toString(16)}${digits.slice(17, 20)}`;

  return [digits.slice(0, 8), digits.slice(8, 12), version, variant, digits.slice(20, 32)].join(
    '-',
  );
}

/** Whether a string is shaped like the identifiers the server accepts. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
