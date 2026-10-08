/**
 * Whether a value is a plain-object-shaped record (not null, not an array):
 * the first gate every untrusted payload crosses before its field checks.
 * Structural only — class instances pass; the caller's field checks reject
 * what a wrong shape would do with them.
 */
export function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
