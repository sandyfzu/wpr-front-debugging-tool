/**
 * The simulation data file's format and its strict reader — the single
 * declaring site of `public/wp-rocket-simulation/simulation-data.json`'s
 * shape. The file is generated from the pinned WP Rocket zips by the parity
 * dev script (`pnpm parity:wp-rocket --write`), never hand-edited, and ships
 * as a packaged asset (copied as-is from `public/`).
 *
 * Content-keyed: each supported WP Rocket version names its Delay JS runtime,
 * IE fallback and `delay_js_exclusions` list by sha256, and the texts and row
 * lists live once under that key — versions with identical bytes share one
 * entry. Text sha256 = sha256 of the text's UTF-8 bytes; list sha256 = sha256
 * of `JSON.stringify(rows)`.
 *
 * Structural only: whether each entry really hashes to its key is the
 * caller's check. Runtime imports carry their `.ts` extension and reach only
 * leaf modules, so the dev script can load this module under Node's native
 * TypeScript.
 */
import { hasOnlyKeys, isRecord, ownValue } from '../../utils/is-record.ts';

/** The format version this reader accepts (bumped on any incompatible shape change). */
export const SIMULATION_DATA_FORMAT = 1;

/** Where the data file sits in the built extension (and under `public/` in the repo). */
export const SIMULATION_DATA_PATH = 'wp-rocket-simulation/simulation-data.json';

/** One supported WP Rocket version's inputs, each by content key. */
export interface SimulationVersionData {
  /** The Delay JS runtime (`assets/js/lazyload-scripts.min.js`) and its own version (`this.v`). */
  readonly runtime: { readonly sha256: string; readonly version: string };
  /** The IE fallback script text (`DelayJS\HTML::get_ie_fallback()`). */
  readonly ieFallback: { readonly sha256: string };
  /** The bundled `delay_js_exclusions` list (plugin-root `dynamic-lists.json`). */
  readonly delayJsExclusions: { readonly sha256: string; readonly count: number };
}

/** The whole data file. */
export interface SimulationData {
  readonly format: typeof SIMULATION_DATA_FORMAT;
  /** WP Rocket version (e.g. `3.23.5.1`) → its inputs. */
  readonly versions: Readonly<Record<string, SimulationVersionData>>;
  /** sha256 → runtime or IE fallback text. */
  readonly texts: Readonly<Record<string, string>>;
  /** sha256 → exclusion list rows. */
  readonly rowLists: Readonly<Record<string, readonly string[]>>;
}

/** A read: the data, or the first problem found (naming the offending key). */
export type SimulationDataRead =
  | { readonly ok: true; readonly data: SimulationData }
  | { readonly ok: false; readonly problem: string };

/** A sha256 hex digest (content keys, pins): 64 lowercase hex digits. */
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** A WP Rocket version key: dotted digits (`3.24`, `3.23.5.1`). */
const WPR_VERSION = /^\d+(?:\.\d+)+$/;

/** A runtime's own version (`this.v`): non-empty, no whitespace or quotes. */
const RUNTIME_VERSION = /^[^\s"']+$/;

/** Thrown inside the reader only; surfaced as `{ok: false, problem}`. */
class DataProblem extends Error {}

/** Stop the read with a problem. */
function fail(problem: string): never {
  throw new DataProblem(problem);
}

/** An exact-shape record at `where`. */
function record(value: unknown, keys: readonly string[], where: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${where} must be an object`);
  if (!hasOnlyKeys(value, keys)) fail(`${where} has keys other than ${keys.join(', ')}`);
  return value;
}

/** A sha256 field of `entry`. */
function sha256Field(entry: Record<string, unknown>, where: string): string {
  const value = ownValue(entry, 'sha256');
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail(`${where}.sha256 must be 64 lowercase hex digits`);
  }
  return value;
}

/** A record keyed by sha256 whose values pass `check`. */
function contentMap<T>(
  value: unknown,
  where: string,
  check: (entry: unknown, key: string) => T
): Record<string, T> {
  if (!isRecord(value)) return fail(`${where} must be an object`);
  const out: Record<string, T> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!SHA256_PATTERN.test(key)) fail(`${where} key "${key}" is not a sha256`);
    out[key] = check(entry, key);
  }
  return out;
}

/** One version entry, its keys resolved against the texts and row lists. */
function versionEntry(
  value: unknown,
  where: string,
  texts: Readonly<Record<string, string>>,
  rowLists: Readonly<Record<string, readonly string[]>>
): SimulationVersionData {
  const entry = record(value, ['runtime', 'ieFallback', 'delayJsExclusions'], where);
  const runtime = record(ownValue(entry, 'runtime'), ['sha256', 'version'], `${where}.runtime`);
  const version = ownValue(runtime, 'version');
  if (typeof version !== 'string' || !RUNTIME_VERSION.test(version)) {
    fail(`${where}.runtime.version must be a non-empty version string`);
  }
  const fallback = record(ownValue(entry, 'ieFallback'), ['sha256'], `${where}.ieFallback`);
  const list = record(
    ownValue(entry, 'delayJsExclusions'),
    ['sha256', 'count'],
    `${where}.delayJsExclusions`
  );
  const runtimeKey = sha256Field(runtime, `${where}.runtime`);
  const fallbackKey = sha256Field(fallback, `${where}.ieFallback`);
  const listKey = sha256Field(list, `${where}.delayJsExclusions`);
  for (const [key, field] of [
    [runtimeKey, 'runtime'],
    [fallbackKey, 'ieFallback']
  ] as const) {
    if (ownValue(texts, key) === undefined) fail(`${where}.${field}: no text ${key}`);
  }
  const rows = ownValue(rowLists, listKey) as readonly string[] | undefined;
  if (rows === undefined) fail(`${where}.delayJsExclusions: no row list ${listKey}`);
  if (ownValue(list, 'count') !== rows.length) {
    fail(`${where}.delayJsExclusions.count must be ${String(rows.length)} (its row list's length)`);
  }
  return {
    runtime: { sha256: runtimeKey, version },
    ieFallback: { sha256: fallbackKey },
    delayJsExclusions: { sha256: listKey, count: rows.length }
  };
}

/** The read itself; throws {@link DataProblem}. */
function readStrict(value: unknown): SimulationData {
  const file = record(value, ['format', 'versions', 'texts', 'rowLists'], 'the data file');
  if (ownValue(file, 'format') !== SIMULATION_DATA_FORMAT) {
    fail(`format must be ${String(SIMULATION_DATA_FORMAT)}`);
  }
  const texts = contentMap(ownValue(file, 'texts'), 'texts', (text, key) =>
    typeof text === 'string' && text !== '' ? text : fail(`texts.${key} must be a non-empty string`)
  );
  const rowLists = contentMap(ownValue(file, 'rowLists'), 'rowLists', (rows, key) =>
    Array.isArray(rows) && rows.every((row): row is string => typeof row === 'string')
      ? rows
      : fail(`rowLists.${key} must be an array of strings`)
  );
  const rawVersions = ownValue(file, 'versions');
  if (!isRecord(rawVersions) || Object.keys(rawVersions).length === 0) {
    fail('versions must be a non-empty object');
  }
  const versions: Record<string, SimulationVersionData> = {};
  for (const [version, entry] of Object.entries(rawVersions)) {
    if (!WPR_VERSION.test(version)) fail(`versions key "${version}" is not a WP Rocket version`);
    versions[version] = versionEntry(entry, `versions.${version}`, texts, rowLists);
  }
  // Every entry is reachable from a version: an orphan is dead weight in the package.
  const used = new Set(
    Object.values(versions).flatMap((entry) => [
      entry.runtime.sha256,
      entry.ieFallback.sha256,
      entry.delayJsExclusions.sha256
    ])
  );
  for (const key of [...Object.keys(texts), ...Object.keys(rowLists)]) {
    if (!used.has(key)) fail(`entry ${key} is not used by any version`);
  }
  return { format: SIMULATION_DATA_FORMAT, versions, texts, rowLists };
}

/**
 * Read a parsed data file strictly: exact keys, sha256 content keys, every
 * version's keys present in `texts`/`rowLists`, list counts equal to their
 * lists' lengths, no unused entry.
 *
 * @param value The parsed JSON (untrusted: a damaged package reads as a problem).
 * @returns The data, or the first problem found.
 */
export function readSimulationData(value: unknown): SimulationDataRead {
  try {
    return { ok: true, data: readStrict(value) };
  } catch (error) {
    if (error instanceof DataProblem) return { ok: false, problem: error.message };
    throw error;
  }
}
