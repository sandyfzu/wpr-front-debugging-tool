/**
 * Extension version strings as the browsers define them: one to four
 * dot-separated integers, each 0–65535 with no leading zero (Chrome's
 * manifest rule; Firefox accepts the same shape). Missing trailing parts
 * read as 0, so `3.0` equals `3.0.0`.
 */

/** A parsed version: its integer parts, most significant first (1–4 of them). */
export type ExtensionVersion = readonly number[];

/** One version part: `0`, or an integer without a leading zero. */
const PART = /^(?:0|[1-9]\d{0,4})$/;

/** The largest value one part may hold. */
const PART_MAX = 65_535;

/**
 * Parse a version string.
 *
 * @param input Any value (stored, manifest-read or event-delivered).
 * @returns The parts, or null when the input is not a valid version.
 */
export function parseExtensionVersion(input: unknown): ExtensionVersion | null {
  if (typeof input !== 'string') return null;
  const parts = input.split('.');
  if (parts.length > 4) return null;
  const numbers: number[] = [];
  for (const part of parts) {
    if (!PART.test(part)) return null;
    const value = Number(part);
    if (value > PART_MAX) return null;
    numbers.push(value);
  }
  return numbers;
}

/**
 * Order two parsed versions.
 *
 * @param a The first version.
 * @param b The second version.
 * @returns Negative when `a` is older, positive when newer, 0 when equal.
 */
export function compareExtensionVersions(a: ExtensionVersion, b: ExtensionVersion): number {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
