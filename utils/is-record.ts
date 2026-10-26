/**
 * Whether a value is a plain-object-shaped record (not null, not an array):
 * the first gate every untrusted payload crosses before its field checks.
 * Structural only — class instances pass; the caller's field checks reject
 * what a wrong shape would do with them.
 */
export function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

/**
 * A record's own property value; an inherited one reads as absent, so a
 * polluted prototype can never supply a field an untrusted payload lacks.
 *
 * @param record The record (already past {@link isRecord}).
 * @param key The property name.
 * @returns The own value, or `undefined` when the key is not an own property.
 */
export function ownValue(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * Whether every own enumerable key of a record is one of `allowed` — the
 * exact-shape gate for payloads whose unknown fields must be refused, not
 * ignored. Missing keys pass; the caller's field checks require them.
 *
 * @param record The record (already past {@link isRecord}).
 * @param allowed The permitted key names.
 */
export function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}
