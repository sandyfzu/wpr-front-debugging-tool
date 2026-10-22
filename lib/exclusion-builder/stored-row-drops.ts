/**
 * Why WP Rocket's settings save does not store a typed row — the one
 * declaring site of the ids (the WP Rocket parity table imports them). Leaf
 * module with no imports and erasable syntax only, so the parity dev script
 * can load it under Node's native TypeScript.
 *
 * - `empty` — nothing is left once trimmed and sanitized;
 * - `zero` — the row is (or sanitizes to) `"0"`, which PHP's `array_filter`
 *   treats as empty;
 * - `duplicate` — an earlier row has the same stored form;
 * - `invalid-pattern` — the form-submit check finds a pattern PCRE rejects;
 * - `safe-mode` — Delay JS with "Safe Mode for jQuery" on removes its own
 *   three patterns.
 */
export type StoredRowDropReason = 'empty' | 'zero' | 'duplicate' | 'invalid-pattern' | 'safe-mode';

/** Every drop reason, for validating authored data. */
export const STORED_ROW_DROP_REASONS: readonly StoredRowDropReason[] = [
  'empty',
  'zero',
  'duplicate',
  'invalid-pattern',
  'safe-mode'
];
