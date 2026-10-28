/**
 * WP Rocket parity table generator/checker (`pnpm parity:wp-rocket`).
 *
 * Re-derives every expected output of two tables by running the REAL plugin
 * and WordPress core code under `php -n` (`scripts/wp-rocket-parity.php`):
 * `lib/exclusion-builder/wp-rocket-parity.fixtures.json` (settings-form saves
 * and exclusion matches) and
 * `lib/wp-rocket-simulation/simulation-parity.fixtures.json` (pages served
 * with Delay JS on, plus the pins of the real runtime, IE fallback and list),
 * and the simulation data file `public/wp-rocket-simulation/simulation-data.json`
 * (those real texts and rows, content-keyed). The plugin zip and seven
 * `wp-includes` files of the pinned WordPress release are unzipped into a
 * temporary directory, the tables' authored inputs are fed to the harness, and
 * the outputs are merged back and formatted with the repo's Prettier config —
 * so every file is byte-for-byte what `--write` produces.
 *
 * - default (check): fails with the differences when a committed file is
 *   stale (headers included: the exact local zip bytes and PHP build);
 * - `--write`: rewrites the three files;
 * - `--ci`: checks a fresh build of the reference tag — zip bytes are never
 *   reproducible across builds (skipped) and another PHP build is a notice;
 *   fails as "table stale" on any other difference (the data file included)
 *   and as "reference drift" when the build vendored other package versions
 *   than `pluginPackages`;
 * - `--compare`: reports how another plugin version (e.g. the latest release)
 *   differs from the tables, as warnings only — never fails.
 *
 * `--zip <path>` selects the plugin zip (default `docker/wpr/wpr-rocket.zip`,
 * built locally with apvm). Network is used only to download the pinned
 * WordPress zip once; it is sha1-verified and cached in `.cache/wp-rocket-parity/`.
 * Needs `unzip` and PHP ≥ 8.1 with ext-dom + ext-mbstring, compiled in or as
 * shared modules (the harness runs without php.ini, so the script loads
 * missing ones with `-d extension=…`) and forces `-d pcre.jit=1` (PHP's
 * default; the JIT moves where `pcre.backtrack_limit` stops a long match, and
 * the headers record it as `pcreJit`). Inside GitHub Actions, findings are
 * also emitted as annotations and appended to the job summary.
 *
 * Runs under Node's native TypeScript (type-stripping — erasable syntax only).
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as Prettier from 'prettier';
import {
  HEADER_KEYS,
  MATCH_INPUT_KEYS,
  MATCH_OUTPUT_KEYS,
  SAVE_INPUT_KEYS,
  SAVE_OUTPUT_KEYS,
  parseParityInputs,
  parseParityTable,
  typedLineBytes,
  type MatchInput,
  type ParityHeader,
  type ParityInput,
  type SaveInput,
  type TypedLine
} from '../lib/exclusion-builder/wp-rocket-parity-table.ts';
import { DELAY_JS_VERSION_PATTERN } from '../lib/wp-rocket/constants.ts';
import {
  SIMULATE_INPUT_KEYS,
  SIMULATION_HEADER_KEYS,
  parseSimulationInputs,
  parseSimulationTable,
  type SimulateInput,
  type SimulationPins,
  type SimulationSentinels
} from '../lib/wp-rocket-simulation/simulation-parity-table.ts';
import {
  SIMULATION_DATA_FORMAT,
  SIMULATION_DATA_PATH,
  readSimulationData,
  type SimulationData
} from '../lib/wp-rocket-simulation/simulation-data.ts';

/**
 * Prettier's Node API, loaded through Node's own resolver (its CommonJS entry):
 * a DOM-flavoured test runner would otherwise resolve the browser build, which
 * has no config resolution.
 */
const prettier = createRequire(import.meta.url)('prettier') as typeof Prettier;

/** Repo root (one level above this module). */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The table, relative to the repo root. */
export const TABLE_PATH = 'lib/exclusion-builder/wp-rocket-parity.fixtures.json';

/** The simulation table, relative to the repo root. */
export const SIMULATION_TABLE_PATH = 'lib/wp-rocket-simulation/simulation-parity.fixtures.json';

/** The simulation data file, relative to the repo root (shipped from `public/`). */
export const SIMULATION_DATA_FILE = `public/${SIMULATION_DATA_PATH}`;

/** The Delay JS runtime inside the plugin root. */
const RUNTIME_PATH = 'assets/js/lazyload-scripts.min.js';

/** The plugin-root dynamic lists file (the copy a fresh install reads). */
const DYNAMIC_LISTS_PATH = 'dynamic-lists.json';

/** The default plugin zip, relative to the repo root (see docs/local-site-runbook.md). */
const PLUGIN_ZIP = 'docker/wpr/wpr-rocket.zip';

/** The PHP harness, next to this script. */
const HARNESS = 'scripts/wp-rocket-parity.php';

/** The pinned WordPress core release: version + the wordpress.org zip's sha1. */
export const WP_CORE = {
  version: '7.1.3',
  sha1: '13eb1d042b1ca39224e44906cd84fe203112210c'
} as const;

/** How long the one-time WordPress zip download (~30 MB) may take before it fails. */
const DOWNLOAD_TIMEOUT_MS = 300_000;

/** Where the WordPress zip is cached. */
const CACHE_DIR = '.cache/wp-rocket-parity';

/** The only WordPress core files the harness loads (hooks + formatting + kses + UTF-8). */
const WP_FILES = [
  'plugin.php',
  'class-wp-hook.php',
  'class-wp-filter-sentinel.php',
  'formatting.php',
  'kses.php',
  'utf8.php',
  'compat-utf8.php'
] as const;

/** Oldest PHP the harness supports (the plugin's own floor is lower; `readonly`-free code). */
const MIN_PHP: readonly [number, number] = [8, 1];

/**
 * Extensions the harness needs: dom (the lazy-render processor) and mbstring
 * (WordPress' UTF-8 helpers take another code path without it, so outputs
 * would not be comparable with the table's).
 */
export const PHP_EXTENSIONS = ['dom', 'mbstring'] as const;

/** PHP code printing `<PHP_VERSION>\n<the loaded PHP_EXTENSIONS, comma-separated>`. */
const PHP_PROBE = `echo PHP_VERSION, "\\n", implode(",", array_filter(${JSON.stringify(PHP_EXTENSIONS)}, "extension_loaded"));`;

/** Header keys `--ci` never compares: zip bytes differ on every build (entry mtimes, generated lock). */
const CI_SKIPPED_KEYS = ['pluginZipSha256'] as const;

/** Header keys naming the PHP build: `--ci` reports a difference as a notice (rows still decide). */
const ENVIRONMENT_KEYS = ['php', 'pcre2', 'pcreJit', 'libxml'] as const;

/**
 * Ini settings every PHP call gets: `-n` drops php.ini, so PHP's own default
 * `pcre.jit=1` (what real hosts run) is forced explicitly — with the JIT off,
 * a long `.*?` match hits `pcre.backtrack_limit` at about twice the length,
 * and the backtrack-limit rows would derive other outputs.
 */
const PHP_INI_ARGS = ['-d', 'pcre.jit=1'] as const;

/**
 * The full `php` argument list: no php.ini, the forced {@link PHP_INI_ARGS},
 * then the machine's extension arguments and the call's own.
 *
 * @param extensions Extension-loading arguments (see {@link extensionArgs}).
 * @param rest The call's arguments (script or `-r` code, its arguments).
 */
export function phpCommand(extensions: readonly string[], rest: readonly string[]): string[] {
  return ['-n', ...PHP_INI_ARGS, ...extensions, ...rest];
}

/** What the run does with the derived table. */
export type Mode = 'check' | 'write' | 'ci' | 'compare';

/** The parsed command line. */
export interface Options {
  readonly mode: Mode;
  /** The plugin zip as given (resolved against the working directory); absent = the default zip. */
  readonly zip?: string;
}

/** The mode flags. */
const MODE_FLAGS: Readonly<Partial<Record<string, Mode>>> = {
  '--write': 'write',
  '--ci': 'ci',
  '--compare': 'compare'
};

/** The command line, for error messages. */
const USAGE = 'pnpm parity:wp-rocket [--write | --ci | --compare] [--zip <plugin.zip>]';

/**
 * The run options from the CLI arguments.
 *
 * @param args Arguments after the script path.
 * @throws {@link Error} on an unknown argument, two modes, or a missing/repeated `--zip` path.
 */
export function parseArgs(args: readonly string[]): Options {
  let mode: Mode | undefined;
  let zip: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? '';
    const flagMode = MODE_FLAGS[arg];
    if (flagMode !== undefined) {
      if (mode !== undefined) throw new Error(`one mode only: ${args.join(' ')} (usage: ${USAGE})`);
      mode = flagMode;
    } else if (arg === '--zip') {
      index++;
      const path = args[index];
      if (zip !== undefined || path === undefined || path === '' || path.startsWith('--')) {
        throw new Error(`--zip needs exactly one path (usage: ${USAGE})`);
      }
      zip = path;
    } else {
      throw new Error(`unknown arguments: ${args.join(' ')} (usage: ${USAGE})`);
    }
  }
  return { mode: mode ?? 'check', ...(zip === undefined ? {} : { zip }) };
}

/** What the PHP probe found. */
export interface PhpProbe {
  readonly version: string;
  /** The {@link PHP_EXTENSIONS} that are loaded. */
  readonly loaded: readonly string[];
}

/**
 * Parse the PHP probe's output (`<version>\n<ext,ext>`).
 *
 * @param output The probe's stdout.
 */
export function parsePhpProbe(output: string): PhpProbe {
  const [version = '', loaded = ''] = output.trim().split('\n');
  return { version, loaded: loaded === '' ? [] : loaded.split(',') };
}

/**
 * The `php` arguments loading each required extension the probe lacks as a
 * shared module (`php -n` reads no php.ini, so a distro PHP loads none).
 *
 * @param probe The probe of plain `php -n`.
 */
export function extensionArgs(probe: PhpProbe): string[] {
  return PHP_EXTENSIONS.filter((name) => !probe.loaded.includes(name)).flatMap((name) => [
    '-d',
    `extension=${name}`
  ]);
}

/**
 * Validate a PHP probe.
 *
 * @param probe The probe, taken with the extension arguments applied.
 * @returns The PHP version.
 * @throws {@link Error} when PHP is too old or a required extension is not loaded.
 */
export function checkPhpProbe(probe: PhpProbe): string {
  const { version } = probe;
  const [major = 0, minor = 0] = version.split('.').map(Number);
  if (major < MIN_PHP[0] || (major === MIN_PHP[0] && minor < MIN_PHP[1])) {
    throw new Error(`PHP ${version || '?'} found; the harness needs PHP >= ${MIN_PHP.join('.')}.`);
  }
  const missing = PHP_EXTENSIONS.filter((name) => !probe.loaded.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `PHP ${version} has no ${missing.join(', ')} under \`php -n\`, not even with \`-d extension=…\`: install a PHP build with them compiled in or as shared modules (\`php -n -m\` lists the compiled-in ones).`
    );
  }
  return version;
}

/**
 * The versions of composer packages a plugin build vendored, from its root
 * `composer.lock` (`packages` + `packages-dev`).
 *
 * @param lock The lock file text.
 * @param names The packages to report.
 * @returns `{name: version}`, keys sorted.
 * @throws {@link Error} when the lock is not JSON or lacks a package.
 */
export function readPackageVersions(
  lock: string,
  names: readonly string[]
): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(lock);
  } catch {
    throw new Error("the plugin zip's composer.lock is not valid JSON");
  }
  const lists =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  const versions = new Map<string, string>();
  for (const list of [lists.packages, lists['packages-dev']]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list as unknown[]) {
      const { name, version } = (entry ?? {}) as { name?: unknown; version?: unknown };
      if (typeof name === 'string' && typeof version === 'string') versions.set(name, version);
    }
  }
  const out: Record<string, string> = {};
  for (const name of [...names].sort()) {
    const version = versions.get(name);
    if (version === undefined) {
      throw new Error(
        `the plugin zip's composer.lock lists no "${name}", yet its vendor/ code ran`
      );
    }
    out[name] = version;
  }
  return out;
}

/**
 * The plugin version from its main file's header.
 *
 * @param mainFile The text of `wp-rocket/wp-rocket.php`.
 * @throws {@link Error} when the header has no `Version:` line.
 */
export function readPluginVersion(mainFile: string): string {
  const version = /^[ \t/*#@]*Version:\s*(\S+)/m.exec(mainFile)?.[1];
  if (version === undefined) throw new Error('wp-rocket.php has no "Version:" header line.');
  return version;
}

/** Hex digest of a buffer. */
function digest(algorithm: 'sha1' | 'sha256', data: Uint8Array): string {
  return createHash(algorithm).update(data).digest('hex');
}

/** Base64 of a typed line's bytes (the harness transport for possibly invalid UTF-8). */
function lineBase64(line: TypedLine): string {
  return Buffer.from(typedLineBytes(line)).toString('base64');
}

/** A harness save case. */
interface SaveCase {
  readonly id: string;
  readonly kind: 'save';
  readonly feature: SaveInput['feature'];
  readonly typed: readonly string[];
  readonly safeMode: boolean;
}

/** A harness match case. */
interface MatchCase {
  readonly id: string;
  readonly kind: 'match';
  readonly feature: MatchInput['feature'];
  readonly rows: readonly string[];
  /** Run Delay JS (no rows) after Defer JS (see `MatchInput.throughDelayJs`). */
  readonly throughDelayJs?: true;
  /** Defer JS rows run before Delay JS, base64 (see `MatchInput.deferRows`). */
  readonly deferRows?: readonly string[];
  readonly html: string;
}

/** The harness's save result. */
interface SaveResult {
  readonly id: string;
  readonly stored: string[];
  readonly dropped: { index: number; reason: string }[];
}

/** The harness's match result (outputs as the table stores them). */
type MatchResult = { readonly id: string } & Record<string, unknown>;

/** The harness's whole output. */
interface HarnessOutput<R> {
  readonly env: {
    readonly php: string;
    readonly pcre2: string;
    /** `on`/`off`: whether PCRE's JIT ran (forced on; `off` = this PCRE build has none). */
    readonly pcreJit: string;
    readonly libxml: string;
    /** Composer packages whose `vendor/` files the run loaded. */
    readonly vendorPackages: readonly string[];
  };
  readonly results: readonly R[];
  /** The plugin's own IE fallback text (runs given sentinels only). */
  readonly ieFallback?: string;
}

/** A derived table as an object, in file key order. */
export interface TableObject {
  readonly header: Readonly<Record<string, unknown>>;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

/** Prefix of the implicit save cases that prove a match row's rows survive the form. */
const SURVIVAL_PREFIX = 'survival:';

/**
 * The save cases for a table: every save row, plus one implicit case per
 * authored Delay/Defer/Lazyload match row set — rows a match row feeds the
 * runtime directly must be what the settings form stores (else the row is
 * `filterOnly`, and then must NOT survive the form).
 *
 * @param inputs The table's inputs.
 */
export function saveCases(inputs: readonly ParityInput[]): SaveCase[] {
  const cases: SaveCase[] = [];
  for (const input of inputs) {
    if (input.kind === 'save') {
      cases.push({
        id: input.id,
        kind: 'save',
        feature: input.feature,
        typed: input.typed.map(lineBase64),
        safeMode: input.safeMode ?? false
      });
    } else if (input.rows !== undefined && input.feature !== 'automatic_lazy_rendering') {
      cases.push({
        id: `${SURVIVAL_PREFIX}${input.id}`,
        kind: 'save',
        feature: input.feature,
        typed: input.rows.map(lineBase64),
        safeMode: false
      });
    }
  }
  return cases;
}

/** A row whose authored rows the settings form must store unchanged (unless `filterOnly`). */
export interface SurvivalSource {
  readonly id: string;
  readonly rows?: readonly string[];
  readonly filterOnly?: true;
}

/**
 * Check every survival case: a `filterOnly` row set must change on save, any
 * other authored row set must be stored exactly as written.
 *
 * @param inputs The table's inputs.
 * @param results The save results, survival cases included.
 * @throws {@link Error} naming every mismatching row.
 */
export function checkSurvival(
  inputs: readonly SurvivalSource[],
  results: readonly SaveResult[]
): void {
  const problems: string[] = [];
  for (const result of results) {
    if (!result.id.startsWith(SURVIVAL_PREFIX)) continue;
    const id = result.id.slice(SURVIVAL_PREFIX.length);
    const input = inputs.find((candidate) => candidate.id === id) as SurvivalSource;
    const survives = JSON.stringify(result.stored) === JSON.stringify(input.rows);
    if (survives && input.filterOnly === true) {
      problems.push(`${id}: marked filterOnly, but the settings form stores these rows unchanged`);
    } else if (!survives && input.filterOnly !== true) {
      problems.push(
        `${id}: the settings form stores ${JSON.stringify(result.stored)} — write the stored form or mark the row filterOnly`
      );
    }
  }
  if (problems.length > 0)
    throw new Error(`match rows vs the settings form:\n  ${problems.join('\n  ')}`);
}

/**
 * The match cases, `from` rows resolved to their save row's stored rows.
 *
 * @param inputs The table's inputs.
 * @param saved Stored rows per save row id.
 */
export function matchCases(
  inputs: readonly ParityInput[],
  saved: ReadonlyMap<string, readonly string[]>
): MatchCase[] {
  return inputs
    .filter((input): input is MatchInput => input.kind === 'match')
    .map((input) => {
      const rows = input.from === undefined ? input.rows : saved.get(input.from);
      if (rows === undefined)
        throw new Error(`${input.id}: no stored rows for "${String(input.from)}"`);
      return {
        id: input.id,
        kind: 'match',
        feature: input.feature,
        rows: rows.map((row) => lineBase64(row)),
        ...(input.throughDelayJs === true ? { throughDelayJs: true as const } : {}),
        ...(input.deferRows === undefined
          ? {}
          : { deferRows: input.deferRows.map((row) => lineBase64(row)) }),
        html: input.html
      };
    });
}

/**
 * Copy the listed keys that are present, in list order (the file's key order).
 *
 * @param source The object to read.
 * @param keys The keys, in output order.
 */
function pick(
  source: Readonly<Record<string, unknown>>,
  keys: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

/**
 * One table row: the input's authored fields, then the harness outputs, in
 * the declared key order.
 *
 * @param input The authored input.
 * @param result The harness result for it.
 */
export function assembleRow(
  input: ParityInput,
  result: SaveResult | MatchResult
): Record<string, unknown> {
  if (input.kind === 'save') {
    const save = result as SaveResult;
    const outputs = {
      stored: save.stored,
      dropped: save.dropped.map(({ index, reason }) => ({ index, row: input.typed[index], reason }))
    };
    return {
      ...pick(input as unknown as Record<string, unknown>, SAVE_INPUT_KEYS),
      ...pick(outputs, SAVE_OUTPUT_KEYS)
    };
  }
  const outputs = result as MatchResult;
  const authored = pick(input as unknown as Record<string, unknown>, MATCH_INPUT_KEYS);
  // `rows` sits in its input slot even when `from` derived it.
  const rows = input.rows ?? (outputs.rows as readonly string[]);
  const ordered = pick({ ...authored, rows }, MATCH_INPUT_KEYS);
  return { ...ordered, ...pick(outputs, MATCH_OUTPUT_KEYS) };
}

/** `JSON.stringify`, with an absent value spelled `absent`. */
function show(value: unknown): string {
  // `undefined` (an absent key) stringifies to undefined, not text.
  return value === undefined ? 'absent' : JSON.stringify(value);
}

/**
 * Longest rendered value a difference line prints whole. Longer ones (a whole
 * served page) are summarized, so a stale large row never floods the log or
 * the job summary (1 MiB per step).
 */
export const SHOWN_VALUE_MAX = 200;

/** Characters a summarized value shows before / after its first differing offset. */
const DIFF_CONTEXT = { before: 20, after: 60 } as const;

/**
 * Length of the common prefix of two texts (the first differing offset; the
 * shorter length when one is a prefix of the other).
 *
 * @param a One text.
 * @param b The other.
 */
export function firstDifference(a: string, b: string): number {
  const end = Math.min(a.length, b.length);
  let index = 0;
  while (index < end && a.charCodeAt(index) === b.charCodeAt(index)) index++;
  return index;
}

/**
 * A rendered value as a difference line prints it: whole up to
 * {@link SHOWN_VALUE_MAX} characters, else its length, sha256 and a bounded
 * window around `offset` (`…` marks cut ends).
 *
 * @param rendered The rendered value (see `show`).
 * @param offset The first offset where it differs from the other side.
 */
export function shownValue(rendered: string, offset: number): string {
  if (rendered.length <= SHOWN_VALUE_MAX) return rendered;
  const start = Math.max(0, offset - DIFF_CONTEXT.before);
  const end = Math.min(rendered.length, offset + DIFF_CONTEXT.after);
  const window = `${start > 0 ? '…' : ''}${rendered.slice(start, end)}${end < rendered.length ? '…' : ''}`;
  const sha = digest('sha256', new TextEncoder().encode(rendered));
  return `<${String(rendered.length)} chars, sha256 ${sha}, at ${String(offset)}: ${window}>`;
}

/**
 * One `label: was → now` difference line, each side bounded by {@link shownValue}.
 *
 * @param label What differs (`header.<key>`, `<id>.<key>`).
 * @param was The rendered committed value.
 * @param now The rendered fresh value.
 */
export function differenceLine(label: string, was: string, now: string): string {
  const offset = firstDifference(was, now);
  return `${label}: ${shownValue(was, offset)} → ${shownValue(now, offset)}`;
}

/**
 * The listed header fields that differ, one `header.<key>: was → now` line each.
 *
 * @param before The committed header (absent = every key absent).
 * @param after The fresh header.
 * @param keys The keys to compare, in report order.
 */
export function headerDifferences(
  before: Readonly<Record<string, unknown>> | undefined,
  after: Readonly<Record<string, unknown>>,
  keys: readonly string[]
): string[] {
  const lines: string[] = [];
  for (const key of keys) {
    const was = show(before?.[key]);
    const now = show(after[key]);
    if (was !== now) lines.push(differenceLine(`header.${key}`, was, now));
  }
  return lines;
}

/** One field-level row difference. */
export interface RowDifference {
  readonly id: string;
  readonly line: string;
}

/**
 * Row differences by id: changed fields, rows missing from the committed
 * table, committed rows the inputs no longer derive.
 *
 * @param before The committed rows.
 * @param after The fresh rows.
 */
export function rowDifferences(
  before: readonly Readonly<Record<string, unknown>>[],
  after: readonly Readonly<Record<string, unknown>>[]
): RowDifference[] {
  const differences: RowDifference[] = [];
  const byId = new Map(before.map((row) => [String(row.id), row]));
  for (const row of after) {
    const id = String(row.id);
    const old = byId.get(id);
    byId.delete(id);
    if (old === undefined) {
      differences.push({ id, line: `${id}: missing from the committed table` });
      continue;
    }
    for (const key of new Set([...Object.keys(old), ...Object.keys(row)])) {
      const was = show(old[key]);
      const now = show(row[key]);
      if (was !== now) differences.push({ id, line: differenceLine(`${id}.${key}`, was, now) });
    }
  }
  for (const id of byId.keys())
    differences.push({ id, line: `${id}: not derivable from the inputs` });
  return differences;
}

/**
 * The ids in a difference list, first-seen order, each once.
 *
 * @param differences Row differences.
 */
export function differingRowIds(differences: readonly RowDifference[]): string[] {
  return [...new Set(differences.map((difference) => difference.id))];
}

/**
 * Human-readable staleness: header fields and rows that differ by id.
 *
 * @param committed The committed table text.
 * @param fresh The freshly derived table text.
 * @param headerKeys The table's header keys (default: the exclusion parity table's).
 * @returns One line per difference; empty when the texts are equal.
 */
export function describeStaleness(
  committed: string,
  fresh: string,
  headerKeys: readonly string[] = HEADER_KEYS
): string[] {
  if (committed === fresh) return [];
  let before: { header?: Record<string, unknown>; rows?: Record<string, unknown>[] };
  try {
    before = JSON.parse(committed) as typeof before;
  } catch {
    return ['the committed table is not valid JSON'];
  }
  const after = JSON.parse(fresh) as TableObject;
  const lines = [
    ...headerDifferences(before.header, after.header, headerKeys),
    ...rowDifferences(before.rows ?? [], after.rows).map((difference) => difference.line)
  ];
  if (lines.length === 0) lines.push('formatting differs (run with --write)');
  return lines;
}

/**
 * Package-level differences between two `pluginPackages` maps.
 *
 * @param before The committed versions.
 * @param after The fresh build's versions.
 * @returns One `<name>: was → now` line per added, removed or changed package.
 */
export function packageDifferences(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>
): string[] {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return names
    .filter((name) => before[name] !== after[name])
    .map((name) => `${name}: ${before[name] ?? 'absent'} → ${after[name] ?? 'absent'}`);
}

/** A report item; `error` fails the run. */
export interface Finding {
  readonly level: 'error' | 'warning' | 'notice';
  readonly title: string;
  readonly details: readonly string[];
}

/** What the verdicts need to know about one table. */
export interface TableSpec {
  /** Its name in finding titles ("table stale", "the table reproduces …"). */
  readonly label: string;
  /** Repo-relative path (also selects the Prettier config). */
  readonly path: string;
  readonly headerKeys: readonly string[];
  /** The strict parser of the whole table; throws on a malformed one. */
  readonly parse: (value: unknown) => { readonly header: ParityHeader };
}

/** The exclusion parity table (saves + matches). */
export const PARITY_TABLE: TableSpec = {
  label: 'table',
  path: TABLE_PATH,
  headerKeys: HEADER_KEYS,
  parse: parseParityTable
};

/** The simulation parity table (served pages + simulation pins). */
export const SIMULATION_TABLE: TableSpec = {
  label: 'simulation table',
  path: SIMULATION_TABLE_PATH,
  headerKeys: SIMULATION_HEADER_KEYS,
  parse: parseSimulationTable
};

/**
 * The `--ci` verdict for a fresh build of the reference tag.
 *
 * @param committed The committed table text.
 * @param fresh The derived table.
 * @param spec Which table (default: the exclusion parity table).
 * @returns "<label> stale" (rows, or any header field other than the zip bytes,
 *   PHP build and packages — compared byte-for-byte after aligning those),
 *   "reference drift" (packages), and a PHP-build notice; a single "reproduces"
 *   notice when nothing differs.
 * @throws {@link Error} when the committed table does not parse.
 */
export async function ciFindings(
  committed: string,
  fresh: TableObject,
  spec: TableSpec = PARITY_TABLE
): Promise<Finding[]> {
  const before = spec.parse(JSON.parse(committed)).header;
  const tolerated = [...CI_SKIPPED_KEYS, 'pluginPackages', ...ENVIRONMENT_KEYS];
  const aligned = await formatTable(
    {
      ...fresh,
      header: { ...fresh.header, ...pick(before as unknown as Record<string, unknown>, tolerated) }
    },
    spec.path
  );
  const stale = describeStaleness(committed, aligned, spec.headerKeys);
  const drift = packageDifferences(
    before.pluginPackages,
    fresh.header.pluginPackages as Record<string, string>
  );
  const environment = headerDifferences(
    before as unknown as Record<string, unknown>,
    fresh.header,
    ENVIRONMENT_KEYS
  );
  const findings: Finding[] = [];
  if (stale.length > 0) {
    findings.push({
      level: 'error',
      title: `${spec.label} stale`,
      details: [
        ...stale,
        'Re-derive locally (`pnpm parity:wp-rocket --write`) and review the row changes.'
      ]
    });
  }
  if (drift.length > 0) {
    findings.push({
      level: 'error',
      title: 'reference drift: rebuild locally and review',
      details: [
        ...drift,
        `This build of WP Rocket ${before.plugin} vendors other package versions than the table's. Rebuild the zip (\`apvm build wp-rocket tag:v${before.plugin}\`), run \`pnpm parity:wp-rocket --write\`, and review the header and row changes.`
      ]
    });
  }
  if (environment.length > 0) {
    findings.push({
      level: 'notice',
      title: 'another PHP build than the table header',
      details: [...environment, 'Rows are still compared; this alone never fails.']
    });
  }
  if (stale.length === 0 && drift.length === 0) {
    findings.push({
      level: 'notice',
      title: `the ${spec.label} reproduces with a fresh build of WP Rocket ${before.plugin}`,
      details: []
    });
  }
  return findings;
}

/** Ids a warning annotation lists before it shortens (the job summary lists all). */
const ANNOTATION_IDS = 20;

/**
 * The `--compare` verdict when the build is the table's own reference version
 * (the latest release has not moved past it): nothing to compare.
 *
 * @param version The build's plugin version.
 */
export function sameVersionFindings(version: string): Finding[] {
  return [
    {
      level: 'notice',
      title: `WP Rocket ${version} is the table's reference version; comparison skipped`,
      details: []
    }
  ];
}

/**
 * The `--compare` verdict: how a build of another plugin version differs from
 * the table. Never an error.
 *
 * @param before The committed table's header and rows.
 * @param fresh The table derived from the other build.
 * @param label The table's name in titles (default `table`).
 */
export function compareFindings(
  before: TableObject,
  fresh: TableObject,
  label = 'table'
): Finding[] {
  const reference = String(before.header.plugin);
  const version = String(fresh.header.plugin);
  const differences = rowDifferences(before.rows, fresh.rows);
  const ids = differingRowIds(differences);
  const packages = packageDifferences(
    before.header.pluginPackages as Record<string, string>,
    fresh.header.pluginPackages as Record<string, string>
  ).map((line) => `package ${line}`);
  if (ids.length === 0) {
    return [
      {
        level: 'notice',
        title: `WP Rocket ${version} matches the ${label} (WP Rocket ${reference}) on all ${String(fresh.rows.length)} rows`,
        details: packages
      }
    ];
  }
  const shown = ids.slice(0, ANNOTATION_IDS).join(', ');
  const more =
    ids.length > ANNOTATION_IDS ? ` and ${String(ids.length - ANNOTATION_IDS)} more` : '';
  return [
    {
      level: 'warning',
      title: `WP Rocket ${version} differs from the ${label} (WP Rocket ${reference}) on ${String(ids.length)} rows: ${shown}${more}`,
      details: [
        ...packages,
        ...differences.map((difference) => difference.line),
        'Informational: the table stays on its reference version until it is re-pinned (docs/local-site-runbook.md).'
      ]
    }
  ];
}

/**
 * Escape a GitHub Actions workflow-command value (`%`, CR, LF; in a property
 * also `:` and `,`).
 *
 * @param value The text.
 * @param property Whether it is a property value (e.g. `title=`).
 */
function escapeCommand(value: string, property: boolean): string {
  const escaped = value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  return property ? escaped.replaceAll(':', '%3A').replaceAll(',', '%2C') : escaped;
}

/**
 * A finding as a GitHub Actions annotation command.
 *
 * @param finding The finding.
 */
export function annotation(finding: Finding): string {
  const message = finding.details.length > 0 ? finding.details.join('\n') : finding.title;
  return `::${finding.level} title=${escapeCommand(finding.title, true)}::${escapeCommand(message, false)}`;
}

/**
 * Length of the longest run of consecutive backticks in a text (0 when none).
 *
 * @param text The text.
 */
export function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  return longest;
}

/**
 * Findings as a job-summary Markdown section (details in a fenced block).
 *
 * @param heading The section heading.
 * @param findings The findings.
 */
export function summaryMarkdown(heading: string, findings: readonly Finding[]): string {
  const icon = { error: '❌', warning: '⚠️', notice: 'ℹ️' } as const;
  const parts = [`### ${heading}`, ''];
  for (const finding of findings) {
    parts.push(`${icon[finding.level]} **${finding.title}**`, '');
    if (finding.details.length > 0) {
      // A fence longer than every backtick run in the details keeps them verbatim.
      const longest = Math.max(2, ...finding.details.map(longestBacktickRun));
      const fence = '`'.repeat(longest + 1);
      parts.push(fence, ...finding.details, fence, '');
    }
  }
  return `${parts.join('\n')}\n`;
}

/**
 * Print findings; inside GitHub Actions also emit annotations and append to
 * the job summary.
 *
 * @param heading The summary heading.
 * @param findings The findings.
 * @returns Whether any finding is an error.
 */
function report(heading: string, findings: readonly Finding[]): boolean {
  const inActions = process.env.GITHUB_ACTIONS === 'true';
  for (const finding of findings) {
    const print = finding.level === 'notice' ? console.log : console.error;
    print(`[parity] ${finding.level}: ${finding.title}`);
    for (const line of finding.details) print(`  ${line}`);
    if (inActions) console.log(annotation(finding));
  }
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (inActions && summary !== undefined && summary !== '') {
    appendFileSync(summary, summaryMarkdown(heading, findings));
  }
  return findings.some((finding) => finding.level === 'error');
}

/**
 * Format a JSON file's content with the repo's Prettier config (as `pnpm
 * format` would).
 *
 * @param table The object.
 * @param path Its repo-relative path (default: the exclusion parity table).
 */
export async function formatTable(table: unknown, path: string = TABLE_PATH): Promise<string> {
  const file = join(REPO_ROOT, path);
  const options = (await prettier.resolveConfig(file)) ?? {};
  return prettier.format(JSON.stringify(table), { ...options, filepath: file });
}

/** Fail fast unless a command runs. */
function requireCommand(command: string, args: readonly string[], hint: string): string {
  const run = spawnSync(command, args, { encoding: 'utf8' });
  if (run.error !== undefined || run.status !== 0) {
    throw new Error(
      `\`${command} ${args.join(' ')}\` failed: ${run.error?.message ?? run.stderr}. ${hint}`
    );
  }
  return run.stdout;
}

/** Run the PHP probe under `php -n` plus `args`. */
function probePhp(args: readonly string[]): PhpProbe {
  return parsePhpProbe(
    requireCommand(
      'php',
      phpCommand(args, ['-r', PHP_PROBE]),
      'Install PHP >= 8.1 (CLI) and put it on PATH.'
    )
  );
}

/**
 * The extra `php -n` arguments the harness needs on this machine (shared
 * extensions to load), after proving the result has every required one.
 */
function phpArgs(): string[] {
  const args = extensionArgs(probePhp([]));
  const version = checkPhpProbe(args.length === 0 ? probePhp([]) : probePhp(args));
  if (args.length > 0) console.log(`[parity] PHP ${version}: loading ${args.join(' ')}`);
  return args;
}

/**
 * The pinned WordPress zip: the cached copy when its sha1 matches, else a
 * fresh download (verified before it is cached).
 */
async function wordpressZip(): Promise<string> {
  const cached = join(REPO_ROOT, CACHE_DIR, `wordpress-${WP_CORE.version}.zip`);
  if (existsSync(cached) && digest('sha1', readFileSync(cached)) === WP_CORE.sha1) return cached;
  const url = `https://wordpress.org/wordpress-${WP_CORE.version}.zip`;
  console.log(`[parity] downloading ${url}`);
  let data: Uint8Array;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
    data = new Uint8Array(await response.arrayBuffer());
  } catch (cause) {
    throw new Error(
      `cannot download ${url} (${String(cause)}); it is needed once, then cached in ${CACHE_DIR}/.`
    );
  }
  const sha1 = digest('sha1', data);
  if (sha1 !== WP_CORE.sha1) throw new Error(`${url}: sha1 ${sha1}, expected ${WP_CORE.sha1}.`);
  mkdirSync(dirname(cached), { recursive: true });
  writeFileSync(cached, data);
  return cached;
}

// ---------------------------------------------------------------------------
// Simulation table + data file.
// ---------------------------------------------------------------------------

/** A harness simulate case. */
interface SimulateCase {
  readonly id: string;
  readonly kind: 'simulate';
  readonly feature: SimulateInput['feature'];
  readonly rows: readonly string[];
  readonly listRows?: readonly string[];
  readonly list?: 'bundled';
  readonly html: string;
}

/** The harness's simulate result. */
interface SimulateResult {
  readonly id: string;
  readonly served: string;
}

/**
 * The harness cases for the simulation table: every row as a simulate case
 * (rows and list rows base64-encoded), plus one survival save case per row —
 * rows the case stores directly must be what the settings form stores (else
 * the row is `filterOnly`, and then must NOT survive the form).
 *
 * @param inputs The table's inputs.
 * @returns The save (survival) cases and the simulate cases.
 */
export function simulationCases(inputs: readonly SimulateInput[]): {
  saves: SaveCase[];
  simulates: SimulateCase[];
} {
  return {
    saves: inputs.map((input) => ({
      id: `${SURVIVAL_PREFIX}${input.id}`,
      kind: 'save',
      feature: input.feature,
      typed: input.rows.map(lineBase64),
      safeMode: false
    })),
    simulates: inputs.map((input) => ({
      id: input.id,
      kind: 'simulate',
      feature: input.feature,
      rows: input.rows.map(lineBase64),
      ...(input.listRows === undefined
        ? { list: 'bundled' as const }
        : { listRows: input.listRows.map(lineBase64) }),
      html: input.html
    }))
  };
}

/**
 * One simulation table row: the input's authored fields in file order, then `served`.
 *
 * @param input The authored input.
 * @param served The harness's served page for it.
 */
export function assembleSimulateRow(input: SimulateInput, served: string): Record<string, unknown> {
  return { ...pick(input as unknown as Record<string, unknown>, SIMULATE_INPUT_KEYS), served };
}

/**
 * The authored sentinels of a committed simulation table (the one part of
 * its header that is not derived).
 *
 * @param value The parsed table.
 * @throws {@link Error} when they are missing or malformed.
 */
export function committedSentinels(value: unknown): SimulationSentinels {
  const header = (value as { header?: { simulation?: Record<string, unknown> } } | null)?.header;
  const sentinels = header?.simulation?.sentinels as Partial<SimulationSentinels> | undefined;
  const { runtime, ieFallback } = sentinels ?? {};
  if (typeof runtime !== 'string' || typeof ieFallback !== 'string') {
    throw new Error(
      `${SIMULATION_TABLE_PATH}: header.simulation.sentinels must hold the runtime and ieFallback texts`
    );
  }
  // The full rules (no `$`/`\`, …) are the table parser's; the derived table is parsed before use.
  return { runtime, ieFallback };
}

/** The plugin files the simulation pins and data file are derived from. */
export interface SimulationSources {
  /** WP Rocket version (the main file's header). */
  readonly version: string;
  /** `assets/js/lazyload-scripts.min.js` bytes. */
  readonly runtime: Uint8Array;
  /** Plugin-root `dynamic-lists.json` bytes. */
  readonly dynamicLists: Uint8Array;
  /** `get_ie_fallback()`'s text, read through the harness. */
  readonly ieFallback: string;
}

/** sha256 of a text's UTF-8 bytes. */
function textSha256(text: string): string {
  return digest('sha256', new TextEncoder().encode(text));
}

/** Strict UTF-8 (no BOM stripping), so the text re-encodes to exactly the file's bytes. */
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * The simulation pins and the data file, from the plugin's own files.
 *
 * @param sources The plugin files.
 * @param sentinels The authored sentinels (kept in the pins).
 * @returns `pins` (`header.simulation`) and `data` (the data file object).
 * @throws {@link Error} when the runtime is not UTF-8 or names no `this.v`
 *   version, or the lists file has no `delay_js_exclusions` string list.
 */
export function simulationArtifacts(
  sources: SimulationSources,
  sentinels: SimulationSentinels
): { pins: SimulationPins; data: SimulationData } {
  let runtime: string;
  try {
    runtime = UTF8.decode(sources.runtime);
  } catch {
    throw new Error(`the plugin's ${RUNTIME_PATH} is not UTF-8`);
  }
  const runtimeVersion = DELAY_JS_VERSION_PATTERN.exec(runtime)?.[1];
  if (runtimeVersion === undefined) {
    throw new Error(`the plugin's ${RUNTIME_PATH} names no version (this.v="…")`);
  }
  let lists: unknown;
  try {
    lists = JSON.parse(UTF8.decode(sources.dynamicLists));
  } catch {
    throw new Error(`the plugin's ${DYNAMIC_LISTS_PATH} is not UTF-8 JSON`);
  }
  const rows = (lists as { delay_js_exclusions?: unknown } | null)?.delay_js_exclusions;
  if (!Array.isArray(rows) || !rows.every((row): row is string => typeof row === 'string')) {
    throw new Error(`the plugin's ${DYNAMIC_LISTS_PATH} has no delay_js_exclusions string list`);
  }
  const runtimeSha = digest('sha256', sources.runtime);
  const fallbackSha = textSha256(sources.ieFallback);
  const listSha = textSha256(JSON.stringify(rows));
  const pins: SimulationPins = {
    runtime: {
      path: RUNTIME_PATH,
      version: runtimeVersion,
      bytes: sources.runtime.byteLength,
      sha256: runtimeSha
    },
    ieFallback: {
      bytes: new TextEncoder().encode(sources.ieFallback).byteLength,
      sha256: fallbackSha
    },
    dynamicLists: { sha256: digest('sha256', sources.dynamicLists) },
    delayJsExclusions: { count: rows.length, sha256: listSha },
    sentinels
  };
  const data: SimulationData = {
    format: SIMULATION_DATA_FORMAT,
    versions: {
      [sources.version]: {
        runtime: { sha256: runtimeSha, version: runtimeVersion },
        ieFallback: { sha256: fallbackSha },
        delayJsExclusions: { sha256: listSha, count: rows.length }
      }
    },
    texts: { [runtimeSha]: runtime, [fallbackSha]: sources.ieFallback },
    rowLists: { [listSha]: rows }
  };
  const read = readSimulationData(data); // The derived file must satisfy its own reader.
  if (!read.ok) throw new Error(`derived ${SIMULATION_DATA_FILE}: ${read.problem}`);
  return { pins, data };
}

/**
 * The verdict on the data file (exact: it holds no build-dependent field).
 *
 * @param committed The committed text (`null` when the file is missing).
 * @param fresh The derived, formatted text.
 * @returns A "stale" error, or nothing.
 */
export function dataFindings(committed: string | null, fresh: string): Finding[] {
  if (committed === fresh) return [];
  return [
    {
      level: 'error',
      title: 'simulation data file stale',
      details: [
        committed === null
          ? `${SIMULATION_DATA_FILE} is missing`
          : `${SIMULATION_DATA_FILE} differs from the one derived from the plugin zip`,
        'Re-derive locally (`pnpm parity:wp-rocket --write`) and review the change; never hand-edit it.'
      ]
    }
  ];
}

/**
 * The `--compare` finding for the simulation pins: the other version ships
 * another runtime, IE fallback or list. Never an error.
 *
 * @param before The committed simulation table's header.
 * @param fresh The header derived from the other build.
 * @returns One warning naming each differing pin, or nothing.
 */
export function pinFindings(
  before: Readonly<Record<string, unknown>>,
  fresh: Readonly<Record<string, unknown>>
): Finding[] {
  const was = (before.simulation ?? {}) as Record<string, unknown>;
  const now = (fresh.simulation ?? {}) as Record<string, unknown>;
  const lines = headerDifferences(was, now, [
    'runtime',
    'ieFallback',
    'dynamicLists',
    'delayJsExclusions'
  ]).map((line) => line.replace(/^header\./, 'header.simulation.'));
  if (lines.length === 0) return [];
  return [
    {
      level: 'warning',
      title: `WP Rocket ${String(fresh.plugin)} ships other simulation inputs than the simulation table (WP Rocket ${String(before.plugin)})`,
      details: [
        ...lines,
        "Informational: the table keeps its own version's pins; supporting this version means adding it as another supported version (its own pins and data-file entry), in a reviewed change."
      ]
    }
  ];
}

/** The simulation half of a `--compare` run: both tables, or why it could not be derived. */
export type SimulationComparison =
  | { readonly ok: true; readonly before: TableObject; readonly fresh: TableObject }
  | { readonly ok: false; readonly problem: string };

/**
 * The `--compare` verdict for another plugin version: the exclusion parity
 * table always, then the simulation table and its pins — or, when the
 * simulation could not be derived from that build, a warning naming the
 * cause (the parity comparison still stands). Never an error.
 *
 * @param parity The committed exclusion parity table.
 * @param freshParity The parity table derived from the other build.
 * @param simulation The simulation half (see {@link SimulationComparison}).
 */
export function otherVersionFindings(
  parity: TableObject,
  freshParity: TableObject,
  simulation: SimulationComparison
): Finding[] {
  const findings = compareFindings(parity, freshParity);
  if (!simulation.ok) {
    return [
      ...findings,
      {
        level: 'warning',
        title: `could not derive the simulation table from WP Rocket ${String(freshParity.header.plugin)}`,
        details: [
          simulation.problem,
          'Informational: the exclusion parity comparison above is unaffected.'
        ]
      }
    ];
  }
  return [
    ...findings,
    ...compareFindings(simulation.before, simulation.fresh, SIMULATION_TABLE.label),
    ...pinFindings(simulation.before.header, simulation.fresh.header)
  ];
}

// ---------------------------------------------------------------------------
// Running the harness.
// ---------------------------------------------------------------------------

/**
 * Run the harness on cases.
 *
 * @param extra Other top-level input fields (e.g. `sentinels`).
 */
function runHarness<R>(
  php: readonly string[],
  pluginRoot: string,
  wpRoot: string,
  cases: readonly unknown[],
  extra: Readonly<Record<string, unknown>> = {}
): HarnessOutput<R> {
  const run = spawnSync('php', phpCommand(php, [join(REPO_ROOT, HARNESS), pluginRoot, wpRoot]), {
    input: JSON.stringify({ ...extra, cases }),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024
  });
  if (run.status !== 0) {
    throw new Error(
      `the PHP harness failed (exit ${String(run.status)}):\n${run.stderr}${run.stdout}`
    );
  }
  return JSON.parse(run.stdout) as HarnessOutput<R>;
}

/** Fail fast, with the way to get one, when the plugin zip is missing. */
function requirePluginZip(pluginZip: string): void {
  if (!existsSync(pluginZip)) {
    throw new Error(
      `${pluginZip} is missing: build it with apvm (docs/local-site-runbook.md) or copy it from the main checkout.`
    );
  }
}

/** An unzipped plugin + WordPress tree the harness runs on. */
interface PluginTree {
  readonly pluginZip: string;
  readonly pluginRoot: string;
  readonly wpRoot: string;
  readonly php: readonly string[];
}

/**
 * Unzip the plugin and the WordPress files into a temporary directory, run
 * `work` on them, and remove the directory.
 *
 * @param pluginZip Absolute path of the plugin zip.
 * @param php Extra `php -n` arguments (see {@link phpArgs}).
 * @param work What to do with the tree.
 */
async function withPluginTree<T>(
  pluginZip: string,
  php: readonly string[],
  work: (tree: PluginTree) => Promise<T>
): Promise<T> {
  requirePluginZip(pluginZip);
  const wpZip = await wordpressZip();
  const scratch = mkdtempSync(join(tmpdir(), 'wpr-parity-'));
  try {
    requireCommand('unzip', ['-q', pluginZip, 'wp-rocket/*', '-d', scratch], 'Install unzip.');
    const members = WP_FILES.map((file) => `wordpress/wp-includes/${file}`);
    requireCommand('unzip', ['-q', wpZip, ...members, '-d', scratch], 'Install unzip.');
    const pluginRoot = join(scratch, 'wp-rocket');
    if (!existsSync(join(pluginRoot, 'composer.lock'))) {
      throw new Error(
        `${pluginZip} has no wp-rocket/composer.lock: its package versions are unknown.`
      );
    }
    return await work({ pluginZip, pluginRoot, wpRoot: join(scratch, 'wordpress'), php });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * A table's reference header fields, from the tree and the harness runs that
 * derived it.
 *
 * @param tree The plugin tree.
 * @param envs The `env` of every harness run behind the table.
 */
function referenceHeader(
  tree: PluginTree,
  envs: readonly HarnessOutput<unknown>['env'][]
): ParityHeader {
  const [env] = envs;
  if (env === undefined) throw new Error('referenceHeader: no harness run');
  const vendorPackages = new Set(envs.flatMap((run) => run.vendorPackages));
  return {
    plugin: readPluginVersion(readFileSync(join(tree.pluginRoot, 'wp-rocket.php'), 'utf8')),
    pluginZipSha256: digest('sha256', readFileSync(tree.pluginZip)),
    pluginPackages: readPackageVersions(
      readFileSync(join(tree.pluginRoot, 'composer.lock'), 'utf8'),
      [...vendorPackages]
    ),
    wp: WP_CORE.version,
    wpZipSha1: WP_CORE.sha1,
    php: env.php,
    pcre2: env.pcre2,
    pcreJit: env.pcreJit,
    libxml: env.libxml,
    generatedBy: 'pnpm parity:wp-rocket --write'
  };
}

/** A derived table: object + formatted text. */
interface DerivedTable {
  readonly table: TableObject;
  readonly text: string;
}

/**
 * Derive the exclusion parity table from its inputs.
 *
 * @param inputs The authored inputs.
 * @param tree The plugin tree.
 */
async function deriveParityTable(
  inputs: readonly ParityInput[],
  tree: PluginTree
): Promise<DerivedTable> {
  const { php, pluginRoot, wpRoot } = tree;
  const saves = runHarness<SaveResult>(php, pluginRoot, wpRoot, saveCases(inputs));
  checkSurvival(inputs, saves.results);
  const stored = new Map(saves.results.map((result) => [result.id, result.stored]));
  const matches = runHarness<MatchResult>(php, pluginRoot, wpRoot, matchCases(inputs, stored));
  const results = new Map<string, SaveResult | MatchResult>();
  for (const result of [...saves.results, ...matches.results]) results.set(result.id, result);
  for (const match of matches.results) {
    const input = inputs.find((candidate) => candidate.id === match.id) as MatchInput;
    if (input.from !== undefined) results.set(match.id, { ...match, rows: stored.get(input.from) });
  }
  const header = referenceHeader(tree, [saves.env, matches.env]);
  const rows = inputs.map((input) => {
    const result = results.get(input.id);
    if (result === undefined) throw new Error(`${input.id}: the harness returned no result`);
    return assembleRow(input, result);
  });
  const table = { header: pick(header as unknown as Record<string, unknown>, HEADER_KEYS), rows };
  parseParityTable(table); // The derived table must satisfy the suite's own parser.
  return { table, text: await formatTable(table) };
}

/**
 * Derive the simulation table and the data file from the table's inputs and
 * authored sentinels.
 *
 * @param inputs The authored inputs.
 * @param sentinels The authored sentinels.
 * @param tree The plugin tree.
 */
async function deriveSimulation(
  inputs: readonly SimulateInput[],
  sentinels: SimulationSentinels,
  tree: PluginTree
): Promise<DerivedTable & { readonly data: string }> {
  const { php, pluginRoot, wpRoot } = tree;
  const cases = simulationCases(inputs);
  const saves = runHarness<SaveResult>(php, pluginRoot, wpRoot, cases.saves);
  checkSurvival(inputs, saves.results);
  const run = runHarness<SimulateResult>(php, pluginRoot, wpRoot, cases.simulates, { sentinels });
  if (typeof run.ieFallback !== 'string') throw new Error('the harness returned no ieFallback');
  const served = new Map(run.results.map((result) => [result.id, result.served]));
  const header = referenceHeader(tree, [saves.env, run.env]);
  const { pins, data } = simulationArtifacts(
    {
      version: header.plugin,
      runtime: readFileSync(join(pluginRoot, RUNTIME_PATH)),
      dynamicLists: readFileSync(join(pluginRoot, DYNAMIC_LISTS_PATH)),
      ieFallback: run.ieFallback
    },
    sentinels
  );
  const rows = inputs.map((input) => {
    const page = served.get(input.id);
    if (page === undefined) throw new Error(`${input.id}: the harness returned no result`);
    return assembleSimulateRow(input, page);
  });
  const table = {
    header: {
      ...pick(header as unknown as Record<string, unknown>, HEADER_KEYS),
      simulation: pins
    },
    rows
  };
  parseSimulationTable(table); // The derived table must satisfy the suite's own parser.
  return {
    table,
    text: await formatTable(table, SIMULATION_TABLE_PATH),
    data: await formatTable(data, SIMULATION_DATA_FILE)
  };
}

/** The committed files' texts (the data file may not exist yet). */
interface Committed {
  readonly parity: string;
  readonly simulation: string;
  readonly data: string | null;
}

/** Everything derived from one plugin zip. */
interface Derived {
  readonly parity: DerivedTable;
  readonly simulation: DerivedTable;
  readonly data: string;
}

/**
 * Derive both tables and the data file from the committed inputs and a plugin zip.
 *
 * @param committed The committed texts.
 * @param pluginZip Absolute path of the plugin zip.
 * @param php Extra `php -n` arguments (see {@link phpArgs}).
 */
async function deriveAll(
  committed: Committed,
  pluginZip: string,
  php: readonly string[]
): Promise<Derived> {
  const parityInputs = parseParityInputs(JSON.parse(committed.parity));
  const simulationValue: unknown = JSON.parse(committed.simulation);
  const simulationInputs = parseSimulationInputs(simulationValue);
  const sentinels = committedSentinels(simulationValue);
  return withPluginTree(pluginZip, php, async (tree) => {
    const parity = await deriveParityTable(parityInputs, tree);
    const simulation = await deriveSimulation(simulationInputs, sentinels, tree);
    return {
      parity,
      simulation: { table: simulation.table, text: simulation.text },
      data: simulation.data
    };
  });
}

/**
 * The simulation half of `--compare` on an unzipped tree: the committed table
 * parsed and re-derived. Every failure (malformed committed table, a build
 * whose files or passes the derivation cannot handle) becomes the problem.
 *
 * @param committedText The committed simulation table text.
 * @param tree The other build's tree.
 */
async function compareSimulation(
  committedText: string,
  tree: PluginTree
): Promise<SimulationComparison> {
  try {
    const before = JSON.parse(committedText) as TableObject;
    parseSimulationTable(before);
    const fresh = await deriveSimulation(
      parseSimulationInputs(before),
      committedSentinels(before),
      tree
    );
    return { ok: true, before, fresh: fresh.table };
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : String(error) };
  }
}

/** `--compare`: report differences as warnings; any failure to compare is a warning too. */
async function compare(committed: Committed, pluginZip: string): Promise<void> {
  const heading = `WP Rocket parity: ${basename(pluginZip)} vs the tables`;
  let findings: Finding[];
  try {
    const parity = JSON.parse(committed.parity) as TableObject;
    const parityInputs = parseParityInputs(parity);
    parseParityTable(parity);
    requirePluginZip(pluginZip);
    const mainFile = requireCommand(
      'unzip',
      ['-p', pluginZip, 'wp-rocket/wp-rocket.php'],
      'Is it a WP Rocket plugin zip?'
    );
    const version = readPluginVersion(mainFile);
    if (version === parity.header.plugin) {
      findings = sameVersionFindings(version);
    } else {
      findings = await withPluginTree(pluginZip, phpArgs(), async (tree) =>
        otherVersionFindings(
          parity,
          (await deriveParityTable(parityInputs, tree)).table,
          await compareSimulation(committed.simulation, tree)
        )
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    findings = [
      {
        level: 'warning',
        title: 'could not compare this WP Rocket build with the tables',
        details: [message]
      }
    ];
  }
  report(heading, findings);
}

/** Read a repo file, or `null` when it does not exist. */
function readOptional(path: string): string | null {
  const file = join(REPO_ROOT, path);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** Entry point. */
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  requireCommand('unzip', ['-v'], 'Install unzip.');
  const pluginZip = options.zip === undefined ? join(REPO_ROOT, PLUGIN_ZIP) : resolve(options.zip);
  const committed: Committed = {
    parity: readFileSync(join(REPO_ROOT, TABLE_PATH), 'utf8'),
    simulation: readFileSync(join(REPO_ROOT, SIMULATION_TABLE_PATH), 'utf8'),
    data: readOptional(SIMULATION_DATA_FILE)
  };
  if (options.mode === 'compare') {
    await compare(committed, pluginZip);
    return;
  }
  const fresh = await deriveAll(committed, pluginZip, phpArgs());
  if (options.mode === 'write') {
    writeFileSync(join(REPO_ROOT, TABLE_PATH), fresh.parity.text);
    writeFileSync(join(REPO_ROOT, SIMULATION_TABLE_PATH), fresh.simulation.text);
    mkdirSync(dirname(join(REPO_ROOT, SIMULATION_DATA_FILE)), { recursive: true });
    writeFileSync(join(REPO_ROOT, SIMULATION_DATA_FILE), fresh.data);
    console.log(`[parity] wrote ${TABLE_PATH}, ${SIMULATION_TABLE_PATH}, ${SIMULATION_DATA_FILE}`);
    return;
  }
  if (options.mode === 'ci') {
    const findings = [
      ...(await ciFindings(committed.parity, fresh.parity.table)),
      ...(await ciFindings(committed.simulation, fresh.simulation.table, SIMULATION_TABLE)),
      ...dataFindings(committed.data, fresh.data)
    ];
    if (report('WP Rocket parity: reference build', findings)) process.exitCode = 1;
    return;
  }
  const stale = [
    { path: TABLE_PATH, lines: describeStaleness(committed.parity, fresh.parity.text) },
    {
      path: SIMULATION_TABLE_PATH,
      lines: describeStaleness(committed.simulation, fresh.simulation.text, SIMULATION_HEADER_KEYS)
    },
    {
      path: SIMULATION_DATA_FILE,
      lines: dataFindings(committed.data, fresh.data).flatMap((finding) => finding.details)
    }
  ];
  for (const { path, lines } of stale) {
    if (lines.length === 0) {
      console.log(`[parity] ${path} reproduces byte-for-byte`);
      continue;
    }
    console.error(`[parity] ${path} is stale (re-derive with \`pnpm parity:wp-rocket --write\`):`);
    for (const line of lines) console.error(`  ${line}`);
    process.exitCode = 1;
  }
}

// Execute only as the script's main; the unit tests import the pure helpers.
if (
  typeof process.argv[1] === 'string' &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  main().catch((error: unknown) => {
    console.error(`[parity] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
