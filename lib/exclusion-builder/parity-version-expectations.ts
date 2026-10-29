/**
 * Version-keyed expectations of the parity tables (both the exclusion and the
 * simulation table): a row's top-level outputs are what the reference WP
 * Rocket build (the latest stable) derives; `byVersion` holds, per other
 * supported version, only the output fields that build derives differently —
 * JSON `null` meaning "this build derives no such field" (no output is ever
 * `null` itself). The dev script writes an entry only where builds differ; readers resolve a
 * row for one version with {@link expectationsFor}.
 *
 * Runtime imports carry their `.ts` extension and reach only leaf modules, so
 * the dev script can load this module under Node's native TypeScript.
 */
import { isRecord } from '../../utils/is-record.ts';
import { SUPPORTED_WPR_VERSIONS, type SupportedWprVersion } from '../wp-rocket/versions.ts';

/** The row key holding the per-version output overrides. */
export const VERSION_EXPECTATIONS_KEY = 'byVersion';

/**
 * Per supported version (not the reference), the output fields it derives
 * differently; `null` marks a field it does not derive at all.
 */
export type VersionExpectations = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/** A row that may carry version-keyed expectations. */
export interface VersionedRow {
  readonly byVersion?: VersionExpectations;
}

/**
 * One JSON value as comparable text, object keys sorted at every depth so
 * key order never makes two equal values differ (rows hold JSON data only).
 *
 * @param value The value; `undefined` (an absent field) compares as its own text.
 */
function json(value: unknown): string {
  if (value === undefined) return 'undefined';
  return JSON.stringify(value, (_key, nested: unknown) =>
    isRecord(nested)
      ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : nested
  );
}

/**
 * Fields with one version's overrides applied: a value replaces the field, a
 * `null` removes it.
 *
 * @param own The row's fields.
 * @param overrides The version's overrides (none: `own` as is).
 * @returns A new record.
 */
export function withOverrides<R extends Readonly<Record<string, unknown>>>(
  own: R,
  overrides: Readonly<Record<string, unknown>> | undefined
): R {
  const merged = Object.entries({ ...own, ...overrides });
  return Object.fromEntries(merged.filter(([, value]) => value !== null)) as R;
}

/**
 * Parse a row's `byVersion` strictly: absent, or a non-empty object keyed by
 * supported versions other than the reference, each a non-empty object of
 * overridable output fields whose values differ from the row's own (an equal
 * value is never written, so it is a hand edit); `null` only for a field the
 * row has.
 *
 * @param row The row record (holds `byVersion` and the top-level outputs).
 * @param overridable The output keys this row may override.
 * @param reference The table's reference version (`header.plugin`).
 * @param fail Throws the table's parse error for this row.
 * @param supported The supported versions (default: the registry).
 * @returns The overrides, or `undefined` when the row has none.
 */
export function parseVersionExpectations(
  row: Readonly<Record<string, unknown>>,
  overridable: readonly string[],
  reference: string,
  fail: (problem: string) => never,
  supported: readonly SupportedWprVersion[] = SUPPORTED_WPR_VERSIONS
): VersionExpectations | undefined {
  const value = row[VERSION_EXPECTATIONS_KEY];
  if (value === undefined) return undefined;
  const where = `"${VERSION_EXPECTATIONS_KEY}"`;
  if (!isRecord(value) || Object.keys(value).length === 0) {
    fail(`${where} must be a non-empty object`);
  }
  const out: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const [version, fields] of Object.entries(value)) {
    if (version === reference) fail(`${where} must not name the reference version ${reference}`);
    if (!supported.some((candidate) => candidate.version === version)) {
      fail(`${where} key "${version}" is not a supported WP Rocket version`);
    }
    if (!isRecord(fields) || Object.keys(fields).length === 0) {
      fail(`${where}.${version} must be a non-empty object`);
    }
    for (const [key, field] of Object.entries(fields)) {
      if (!overridable.includes(key)) {
        fail(`${where}.${version} has "${key}", which is not an output of this row`);
      }
      if (field === null && row[key] === undefined) {
        fail(`${where}.${version}.${key} is null, but the row has no "${key}" to remove`);
      }
      if (json(field) === json(row[key])) {
        fail(`${where}.${version}.${key} equals the row's own value (write only differences)`);
      }
    }
    out[version] = fields;
  }
  return out;
}

/**
 * A row as one version expects it: its own fields with that version's
 * overrides applied (a `null` override removes the field), without `byVersion`. The reference version (or any
 * version without an entry) gets the top-level outputs.
 *
 * @param row The row.
 * @param version The WP Rocket version.
 */
export function expectationsFor<R extends VersionedRow>(
  row: R,
  version: string
): Omit<R, 'byVersion'> {
  const { byVersion, ...own } = row;
  return withOverrides(own, byVersion?.[version]);
}

/**
 * The reference build's rows with every other build's differing outputs as
 * `byVersion` entries (versions in the given order, fields in row order; a
 * field another build does not derive is written as `null`).
 *
 * @param reference The reference build's rows.
 * @param others Every other build: its version and its rows (same ids, same order).
 * @param overridable The output keys a row may override.
 * @returns The rows, `byVersion` last where any build differs.
 * @throws {@link Error} when a build derives another row set, or differs on a
 *   field that is not an overridable output (inputs are the same for every
 *   build, so that is a script defect).
 */
export function withVersionExpectations(
  reference: readonly Readonly<Record<string, unknown>>[],
  others: readonly {
    readonly version: string;
    readonly rows: readonly Readonly<Record<string, unknown>>[];
  }[],
  overridable: (row: Readonly<Record<string, unknown>>) => readonly string[]
): Record<string, unknown>[] {
  return reference.map((row, index) => {
    const id = String(row.id);
    const byVersion: Record<string, Record<string, unknown>> = {};
    for (const other of others) {
      const fresh = other.rows[index];
      if (fresh === undefined || String(fresh.id) !== id) {
        throw new Error(`WP Rocket ${other.version} derives another row set (at "${id}")`);
      }
      const allowed = overridable(row);
      const fields: Record<string, unknown> = {};
      for (const key of new Set([...Object.keys(row), ...Object.keys(fresh)])) {
        if (json(row[key]) === json(fresh[key])) continue;
        if (!allowed.includes(key)) {
          throw new Error(`WP Rocket ${other.version}: ${id}.${key} differs but is not an output`);
        }
        // JSON has no `undefined`: the field this build lacks is an explicit `null`.
        fields[key] = fresh[key] ?? null;
      }
      if (Object.keys(fields).length > 0) byVersion[other.version] = fields;
    }
    return Object.keys(byVersion).length === 0
      ? { ...row }
      : { ...row, [VERSION_EXPECTATIONS_KEY]: byVersion };
  });
}
