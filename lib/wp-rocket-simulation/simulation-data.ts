/**
 * The simulation data file's format and its strict reader — the single
 * declaring site of `public/wp-rocket-simulation/simulation-data.json`'s
 * shape. The file is generated from the pinned WP Rocket zips by the parity
 * dev script (`pnpm parity:wp-rocket --write`), never hand-edited, and ships
 * as a packaged asset (copied as-is from `public/`).
 *
 * Content-keyed: each supported WP Rocket version names its Delay JS runtime,
 * IE fallback, bundled exclusion lists and LazyLoad texts by sha256, and the
 * texts and row lists live once under that key — versions with identical
 * bytes share one entry. Text sha256 = sha256 of the text's UTF-8 bytes; list sha256 = sha256
 * of `JSON.stringify(rows)`.
 *
 * {@link readSimulationData} is structural; {@link simulationDataHashProblem}
 * then checks every entry really hashes to its key (the pin each version
 * names), so a damaged package is never simulated with. Runtime imports
 * carry their `.ts` extension and reach only leaf modules, so the dev script
 * can load this module under Node's native TypeScript.
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
  /** The bundled `delay_js_exclusions` list (plugin-root `dynamic-lists.json`, as every list). */
  readonly delayJsExclusions: SimulationListEntry;
  /** The bundled `defer_js_external_exclusions` list (script URLs Defer JS never defers). */
  readonly deferJsExternalExclusions: SimulationListEntry;
  /** The bundled `defer_js_inline_exclusions` list (inline texts Defer JS never wraps). */
  readonly deferJsInlineExclusions: SimulationListEntry;
  /** LazyLoad for images: its runtime, printed texts and image exclusion literals. */
  readonly lazyload: LazyloadVersionData;
}

/** A text by content key. */
export interface SimulationTextEntry {
  readonly sha256: string;
}

/**
 * One version's LazyLoad inputs (images-only option set). WP Rocket prints
 * `noJsStyle` at the end of `wp_head`, and `optionsScript` then the runtime
 * tag — `runtimeTag.beforeUrl` + the plugin's assets JS URL +
 * `runtime.jsPath` + `runtimeTag.afterUrl` — at the end of `wp_footer`.
 */
export interface LazyloadVersionData {
  /**
   * The runtime file, pinned by sha256 and size but not held here (it ships
   * as its own file): `jsPath` = its path under the plugin's `assets/js/`
   * folder (and URL).
   */
  readonly runtime: { readonly sha256: string; readonly bytes: number; readonly jsPath: string };
  /** The `<noscript><style>` element hiding placeholders without JavaScript. */
  readonly noJsStyle: SimulationTextEntry;
  /** The inline `window.lazyLoadOptions` script element. */
  readonly optionsScript: SimulationTextEntry;
  /** The runtime tag's text before and after its URL. */
  readonly runtimeTag: {
    readonly beforeUrl: SimulationTextEntry;
    readonly afterUrl: SimulationTextEntry;
  };
  /** Attribute substrings that keep an image (or picture, background) as served. */
  readonly excludedAttributes: SimulationListEntry;
  /** Src substrings that keep an image (or picture, background) as served. */
  readonly excludedSrc: SimulationListEntry;
}

/** A bundled list by content key, with its row count. */
export interface SimulationListEntry {
  readonly sha256: string;
  readonly count: number;
}

/** The list fields of a version entry, in file order. */
export const SIMULATION_LIST_FIELDS = [
  'delayJsExclusions',
  'deferJsExternalExclusions',
  'deferJsInlineExclusions'
] as const;

/** A list field of a version entry. */
export type SimulationListField = (typeof SIMULATION_LIST_FIELDS)[number];

/** The whole data file. */
export interface SimulationData {
  readonly format: typeof SIMULATION_DATA_FORMAT;
  /** WP Rocket version (e.g. `3.23.5.1`) → its inputs. */
  readonly versions: Readonly<Record<string, SimulationVersionData>>;
  /** sha256 → runtime, IE fallback or LazyLoad text. */
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

/**
 * The JS folder under the plugin's assets folder (`WP_ROCKET_ASSETS_JS_URL`
 * = assets URL + this), where LazyLoad's `runtime.jsPath` starts.
 */
export const LAZYLOAD_JS_DIR = 'js/';

/**
 * The file name every packaged LazyLoad runtime's `jsPath` ends with (held
 * by the packaged-runtime check): a session tab's requests for it are the
 * only scripts the extension may answer itself — matched by name, so a
 * renamed plugin folder or a CDN host still matches, then answered only for
 * the exact runtime URL its simulated page carries.
 */
export const LAZYLOAD_RUNTIME_FILE = 'lazyload.min.js';

/** A runtime's own version (`this.v`): non-empty, no whitespace or quotes. */
const RUNTIME_VERSION = /^[^\s"']+$/;

/** A path under the plugin's `assets/js/`: relative, `/`-separated plain segments, a `.js` file. */
const JS_PATH = /^(?:[\w.-]+\/)*[\w.-]+\.js$/;

/**
 * Whether `path` names a `.js` file under the plugin's `assets/js/` (the
 * runtime path rule shared by the data file and its producer): relative,
 * plain `/`-separated segments, none of them `..`.
 *
 * @param path The candidate path.
 */
export function isRuntimeJsPath(path: string): boolean {
  return JS_PATH.test(path) && !path.split('/').includes('..');
}

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
  const entry = record(
    value,
    ['runtime', 'ieFallback', ...SIMULATION_LIST_FIELDS, 'lazyload'],
    where
  );
  const runtime = record(ownValue(entry, 'runtime'), ['sha256', 'version'], `${where}.runtime`);
  const version = ownValue(runtime, 'version');
  if (typeof version !== 'string' || !RUNTIME_VERSION.test(version)) {
    fail(`${where}.runtime.version must be a non-empty version string`);
  }
  const fallback = record(ownValue(entry, 'ieFallback'), ['sha256'], `${where}.ieFallback`);
  const runtimeKey = sha256Field(runtime, `${where}.runtime`);
  const fallbackKey = sha256Field(fallback, `${where}.ieFallback`);
  requireText(texts, runtimeKey, `${where}.runtime`);
  requireText(texts, fallbackKey, `${where}.ieFallback`);
  const list = (field: SimulationListField): SimulationListEntry =>
    listEntry(ownValue(entry, field), `${where}.${field}`, rowLists);
  return {
    runtime: { sha256: runtimeKey, version },
    ieFallback: { sha256: fallbackKey },
    delayJsExclusions: list('delayJsExclusions'),
    deferJsExternalExclusions: list('deferJsExternalExclusions'),
    deferJsInlineExclusions: list('deferJsInlineExclusions'),
    lazyload: lazyloadEntry(ownValue(entry, 'lazyload'), `${where}.lazyload`, texts, rowLists)
  };
}

/** Fail unless `texts` holds `key`. */
function requireText(texts: Readonly<Record<string, string>>, key: string, where: string): void {
  if (ownValue(texts, key) === undefined) fail(`${where}: no text ${key}`);
}

/** A `{sha256}` text entry at `where`, resolved against the texts. */
function textEntry(
  value: unknown,
  where: string,
  texts: Readonly<Record<string, string>>
): SimulationTextEntry {
  const key = sha256Field(record(value, ['sha256'], where), where);
  requireText(texts, key, where);
  return { sha256: key };
}

/** A version's LazyLoad entry, its keys resolved against the texts and row lists. */
function lazyloadEntry(
  value: unknown,
  where: string,
  texts: Readonly<Record<string, string>>,
  rowLists: Readonly<Record<string, readonly string[]>>
): LazyloadVersionData {
  const entry = record(
    value,
    ['runtime', 'noJsStyle', 'optionsScript', 'runtimeTag', 'excludedAttributes', 'excludedSrc'],
    where
  );
  const runtime = record(
    ownValue(entry, 'runtime'),
    ['sha256', 'bytes', 'jsPath'],
    `${where}.runtime`
  );
  const jsPath = ownValue(runtime, 'jsPath');
  if (typeof jsPath !== 'string' || !isRuntimeJsPath(jsPath)) {
    fail(`${where}.runtime.jsPath must be a relative path to a .js file`);
  }
  const bytes = ownValue(runtime, 'bytes');
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0) {
    fail(`${where}.runtime.bytes must be a positive integer`);
  }
  const tag = record(
    ownValue(entry, 'runtimeTag'),
    ['beforeUrl', 'afterUrl'],
    `${where}.runtimeTag`
  );
  const text = (field: 'noJsStyle' | 'optionsScript'): SimulationTextEntry =>
    textEntry(ownValue(entry, field), `${where}.${field}`, texts);
  const list = (field: 'excludedAttributes' | 'excludedSrc'): SimulationListEntry =>
    listEntry(ownValue(entry, field), `${where}.${field}`, rowLists);
  return {
    runtime: { sha256: sha256Field(runtime, `${where}.runtime`), bytes, jsPath },
    noJsStyle: text('noJsStyle'),
    optionsScript: text('optionsScript'),
    runtimeTag: {
      beforeUrl: textEntry(ownValue(tag, 'beforeUrl'), `${where}.runtimeTag.beforeUrl`, texts),
      afterUrl: textEntry(ownValue(tag, 'afterUrl'), `${where}.runtimeTag.afterUrl`, texts)
    },
    excludedAttributes: list('excludedAttributes'),
    excludedSrc: list('excludedSrc')
  };
}

/**
 * Every content key a version entry names in `texts`/`rowLists` (LazyLoad's
 * runtime is pinned only: it ships as its own file).
 *
 * @param entry A read version entry.
 */
function versionContentKeys(entry: SimulationVersionData): string[] {
  const lazyload = entry.lazyload;
  return [
    entry.runtime.sha256,
    entry.ieFallback.sha256,
    ...SIMULATION_LIST_FIELDS.map((field) => entry[field].sha256),
    lazyload.noJsStyle.sha256,
    lazyload.optionsScript.sha256,
    lazyload.runtimeTag.beforeUrl.sha256,
    lazyload.runtimeTag.afterUrl.sha256,
    lazyload.excludedAttributes.sha256,
    lazyload.excludedSrc.sha256
  ];
}

/** One list field, resolved against the row lists (its count must be the list's length). */
function listEntry(
  value: unknown,
  where: string,
  rowLists: Readonly<Record<string, readonly string[]>>
): SimulationListEntry {
  const list = record(value, ['sha256', 'count'], where);
  const key = sha256Field(list, where);
  const rows = ownValue(rowLists, key) as readonly string[] | undefined;
  if (rows === undefined) fail(`${where}: no row list ${key}`);
  if (ownValue(list, 'count') !== rows.length) {
    fail(`${where}.count must be ${String(rows.length)} (its row list's length)`);
  }
  return { sha256: key, count: rows.length };
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
  const used = new Set(Object.values(versions).flatMap(versionContentKeys));
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

/** A sha256 of a text's UTF-8 bytes, lowercase hex (the caller's platform digest). */
export type TextSha256 = (text: string) => Promise<string>;

/**
 * The text a row list's content key is the sha256 of: `JSON.stringify(rows)`
 * — the rows' order and exact characters, nothing else. (A text's key is
 * the sha256 of the text itself.)
 *
 * @param rows An exclusion list.
 */
export function rowListKeyText(rows: readonly string[]): string {
  return JSON.stringify(rows);
}

/**
 * Check that every text and row list of a structurally read data file
 * hashes to its content key — each version's pins name those keys, so a
 * changed byte anywhere is caught before it reaches a page.
 *
 * @param data A file {@link readSimulationData} accepted.
 * @param sha256 The digest.
 * @returns The first entry whose content differs from its key, or null when all match.
 */
export async function simulationDataHashProblem(
  data: SimulationData,
  sha256: TextSha256
): Promise<string | null> {
  for (const [key, text] of Object.entries(data.texts)) {
    if ((await sha256(text)) !== key) return `texts.${key} does not hash to its key`;
  }
  for (const [key, rows] of Object.entries(data.rowLists)) {
    if ((await sha256(rowListKeyText(rows))) !== key) {
      return `rowLists.${key} does not hash to its key`;
    }
  }
  return null;
}
