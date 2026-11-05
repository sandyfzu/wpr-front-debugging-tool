/**
 * Opaque random identities (128 bits, fixed-width hex) for one-off handles
 * such as a capture or a run: no page-derived data, and usable on plain
 * HTTP pages too (`getRandomValues` exists in insecure contexts;
 * `randomUUID` does not).
 */

/** The shape every identity from {@link createRandomId} has. */
const RANDOM_ID_SHAPE = /^[\da-f]{32}$/i;

/**
 * Create one identity.
 *
 * @returns 32 hexadecimal characters.
 */
export function createRandomId(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) =>
    part.toString(16).padStart(8, '0')
  ).join('');
}

/**
 * Whether an untrusted value has an identity's shape.
 *
 * @param value The boundary value.
 */
export function isRandomId(value: unknown): value is string {
  return typeof value === 'string' && RANDOM_ID_SHAPE.test(value);
}
