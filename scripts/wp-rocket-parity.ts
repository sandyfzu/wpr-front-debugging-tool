/**
 * WP Rocket parity table generator/checker (`pnpm parity:wp-rocket`).
 *
 * Re-derives every expected output of two tables by running the REAL plugin
 * and WordPress core code under `php -n` (`scripts/wp-rocket-parity.php`),
 * once per supported WP Rocket version (`lib/wp-rocket/versions.ts`, each
 * with its own pinned zip — every build must derive the same rows):
 * `lib/exclusion-builder/wp-rocket-parity.fixtures.json` (settings-form saves
 * and exclusion matches) and
 * `lib/wp-rocket-simulation/simulation-parity.fixtures.json` (pages served
 * with Delay JS on, plus the pins of the real runtime, IE fallback and list),
 * and the simulation data file `public/wp-rocket-simulation/simulation-data.json`
 * (every supported version's real texts and rows, content-keyed). Each
 * plugin zip and seven `wp-includes` files of the pinned WordPress release
 * are unzipped into a temporary directory, the tables' authored inputs are
 * fed to the harness, and the outputs are merged back and formatted with the
 * repo's Prettier config — so every file is byte-for-byte what `--write`
 * produces. The headers name the reference build (the latest-stable version)
 * and list every pinned build (`plugins`).
 *
 * - default (check): fails with the differences when a committed file is
 *   stale (headers included: the exact local zip bytes and PHP build);
 * - `--write`: rewrites the three files;
 * - `--ci`: checks fresh builds of the pinned tags — zip bytes are never
 *   reproducible across builds (skipped) and another PHP build is a notice;
 *   fails as "table stale" on any other difference (the data file included)
 *   and as "reference drift" when a build vendored other package versions
 *   than its header entry;
 * - `--compare`: reports how another plugin version (e.g. a newer release)
 *   differs from the tables, as warnings only — never fails;
 * - `--release-check`: reads release tags (one per line) on stdin and warns,
 *   never fails, when one is newer than every supported version or is a
 *   newer patch of a supported minor — release flags ignored (a stable
 *   release may still be flagged pre-release); the newest such tag goes to
 *   `GITHUB_OUTPUT` as `newest=` for the workflow to build and `--compare`.
 *
 * Check, `--write` and `--ci` read one zip per supported version,
 * `docker/wpr/wpr-rocket-<version>.zip` (git-ignored; built with apvm, or
 * copied from apvm's cache — check and `--write` require the registry's
 * sha256); `--compare --zip <path>` names the other build. Network is used
 * only to download the pinned
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
  overridableKeys,
  parseParityInputs,
  parseParityTable,
  typedLineBytes,
  type MatchInput,
  type ParityHeader,
  type ParityInput,
  type PinnedPlugin,
  type SaveInput,
  type TypedLine
} from '../lib/exclusion-builder/wp-rocket-parity-table.ts';
import {
  expectationsFor,
  withVersionExpectations,
  type VersionedRow
} from '../lib/exclusion-builder/parity-version-expectations.ts';
import { DELAY_JS_VERSION_PATTERN } from '../lib/wp-rocket/constants.ts';
import {
  SUPPORTED_WPR_VERSIONS,
  latestStableWprVersion,
  supportedWprVersion,
  type SupportedWprVersion
} from '../lib/wp-rocket/versions.ts';
import {
  LIST_PIN_KEYS,
  SIMULATE_INPUT_KEYS,
  SIMULATE_OUTPUT_KEYS,
  SIMULATION_HEADER_KEYS,
  parseSimulationInputs,
  parseSimulationTable,
  type DeferSimulateInput,
  type SimulateInput,
  type SimulationPins,
  type SimulationSentinels
} from '../lib/wp-rocket-simulation/simulation-parity-table.ts';
import {
  SIMULATION_DATA_FORMAT,
  SIMULATION_DATA_PATH,
  SIMULATION_LIST_FIELDS,
  readSimulationData,
  rowListKeyText,
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

/**
 * A supported version's plugin zip, relative to the repo root (git-ignored;
 * see docs/local-site-runbook.md).
 *
 * @param version The supported version.
 */
export function pluginZipPath(version: string): string {
  return `docker/wpr/wpr-rocket-${version}.zip`;
}

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
export type Mode = 'check' | 'write' | 'ci' | 'compare' | 'release-check';

/** The parsed command line. */
export interface Options {
  readonly mode: Mode;
  /** The `--compare` plugin zip as given (resolved against the working directory). */
  readonly zip?: string;
}

/** The mode flags. */
const MODE_FLAGS: Readonly<Partial<Record<string, Mode>>> = {
  '--write': 'write',
  '--ci': 'ci',
  '--compare': 'compare',
  '--release-check': 'release-check'
};

/** The command line, for error messages. */
const USAGE =
  'pnpm parity:wp-rocket [--write | --ci | --compare --zip <plugin.zip> | --release-check < tags]';

/**
 * The `--compare` zip, after checking the options pair it with the right mode.
 *
 * @param options The parsed options.
 * @returns The zip path (`--compare`), or `undefined` (every other mode).
 * @throws {@link Error} when `--compare` lacks `--zip`, or another mode has one
 *   (they read the supported versions' zips, {@link pluginZipPath}).
 */
export function compareZip(options: Options): string | undefined {
  if (options.mode === 'compare') {
    if (options.zip === undefined)
      throw new Error(`--compare needs --zip <path> (usage: ${USAGE})`);
    return options.zip;
  }
  if (options.zip !== undefined) {
    throw new Error(
      `--zip is for --compare only: the other modes read ${pluginZipPath('<version>')} for each supported version (usage: ${USAGE})`
    );
  }
  return undefined;
}

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
 * A fresh header's `plugins` with each build the committed header also pins
 * taking the committed zip sha256 and packages (never reproducible / judged
 * as drift); a build added, removed or reordered still differs.
 *
 * @param before The committed builds.
 * @param fresh The fresh header's `plugins` (absent = none).
 */
export function alignedPlugins(
  before: readonly PinnedPlugin[],
  fresh: unknown
): readonly unknown[] | undefined {
  if (!Array.isArray(fresh)) return undefined;
  return fresh.map((entry: unknown) => {
    const version = (entry as { version?: unknown } | null)?.version;
    return before.find((plugin) => plugin.version === version) ?? entry;
  });
}

/**
 * Package drift of the non-reference builds: one `WP Rocket <version>: <line>`
 * per package difference of a build both headers pin (the reference build's
 * drift is `pluginPackages`').
 *
 * @param before The committed header.
 * @param fresh The fresh header's `plugins`.
 * @returns The lines, and the versions that drifted.
 */
export function pinnedBuildDrift(
  before: ParityHeader,
  fresh: unknown
): { lines: string[]; versions: string[] } {
  const lines: string[] = [];
  const versions: string[] = [];
  for (const entry of Array.isArray(fresh) ? (fresh as Partial<PinnedPlugin>[]) : []) {
    const pinned = before.plugins.find((plugin) => plugin.version === entry.version);
    if (pinned === undefined || pinned.version === before.plugin) continue;
    const differences = packageDifferences(pinned.packages, entry.packages ?? {});
    if (differences.length === 0) continue;
    versions.push(pinned.version);
    lines.push(...differences.map((line) => `WP Rocket ${pinned.version}: ${line}`));
  }
  return { lines, versions };
}

/**
 * The `--ci` verdict for fresh builds of the pinned tags.
 *
 * @param committed The committed table text.
 * @param fresh The derived table.
 * @param spec Which table (default: the exclusion parity table).
 * @returns "<label> stale" (rows, or any header field other than the zip bytes,
 *   PHP build and packages — compared byte-for-byte after aligning those),
 *   "reference drift" (packages of any pinned build), and a PHP-build notice;
 *   a single "reproduces" notice when nothing differs.
 * @throws {@link Error} when the committed table does not parse.
 */
export async function ciFindings(
  committed: string,
  fresh: TableObject,
  spec: TableSpec = PARITY_TABLE
): Promise<Finding[]> {
  const before = spec.parse(JSON.parse(committed)).header;
  const tolerated = [...CI_SKIPPED_KEYS, 'pluginPackages', ...ENVIRONMENT_KEYS];
  const plugins = alignedPlugins(before.plugins, fresh.header.plugins);
  const aligned = await formatTable(
    {
      ...fresh,
      header: {
        ...fresh.header,
        ...pick(before as unknown as Record<string, unknown>, tolerated),
        ...(plugins === undefined ? {} : { plugins })
      }
    },
    spec.path
  );
  const stale = describeStaleness(committed, aligned, spec.headerKeys);
  const reference = packageDifferences(
    before.pluginPackages,
    fresh.header.pluginPackages as Record<string, string>
  );
  const others = pinnedBuildDrift(before, fresh.header.plugins);
  const drift = [...reference, ...others.lines];
  const drifted = [...(reference.length > 0 ? [before.plugin] : []), ...others.versions];
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
        `This build of WP Rocket ${drifted.join(' / ')} vendors other package versions than the table's. Rebuild the zip (${drifted.map((version) => `\`apvm build wp-rocket tag:v${version}\``).join(', ')}), run \`pnpm parity:wp-rocket --write\`, and review the header and row changes.`
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
      title: `the ${spec.label} reproduces with a fresh build of WP Rocket ${before.plugins.map((plugin) => plugin.version).join(' and ')}`,
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
 * The `--compare` verdict when the build is a supported version other than
 * the reference: `--ci` already derives every row under it.
 *
 * @param version The build's plugin version.
 */
export function pinnedVersionFindings(version: string): Finding[] {
  return [
    {
      level: 'notice',
      title: `WP Rocket ${version} is a supported version the tables are derived under; comparison skipped`,
      details: []
    }
  ];
}

/** A release tag's version: numeric parts, then the pre-release suffix (`''` = none). */
export interface ReleaseVersion {
  readonly parts: readonly number[];
  readonly suffix: string;
}

/** `v`, dotted digits, an optional `-suffix` (`v3.24`, `v3.23.5.1`, `v3.24-beta5`). */
const RELEASE_TAG = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?$/;

/**
 * Parse a WP Rocket release tag or version.
 *
 * @param tag `v3.24-beta5`, `3.23.5.1`…
 * @returns The version, or `null` for any other tag shape.
 */
export function parseReleaseVersion(tag: string): ReleaseVersion | null {
  const match = RELEASE_TAG.exec(tag.trim());
  if (match?.[1] === undefined) return null;
  return { parts: match[1].split('.').map(Number), suffix: match[2] ?? '' };
}

/** Pre-release stages, oldest first; a release (no suffix) ranks after all of them. */
const PRE_RELEASE_STAGES = ['prealpha', 'alpha', 'beta', 'rc'] as const;

/** A known stage then an optional number (`alpha`, `beta12`, `RC1`); case-insensitive. */
const PRE_RELEASE_SUFFIX = /^(prealpha|alpha|beta|rc)(\d*)$/i;

/**
 * Rank a pre-release suffix for ordering: its stage index (`prealpha` 0 …
 * `rc` 3; a release `''` = the stage count, after every pre-release; an
 * unknown suffix = -1, a pre-release below every known stage), then its
 * number (none = 0, so `beta` < `beta1`).
 *
 * @param suffix The suffix without its `-` (`''` = a release).
 * @returns `[stage, number]`.
 */
function preReleaseRank(suffix: string): readonly [number, number] {
  if (suffix === '') return [PRE_RELEASE_STAGES.length, 0];
  const match = PRE_RELEASE_SUFFIX.exec(suffix);
  if (match?.[1] === undefined) return [-1, 0];
  const stage = PRE_RELEASE_STAGES.indexOf(
    match[1].toLowerCase() as (typeof PRE_RELEASE_STAGES)[number]
  );
  return [stage, match[2] === undefined || match[2] === '' ? 0 : Number(match[2])];
}

/**
 * Order two release versions: numeric parts (missing = 0, so `3.24` =
 * `3.24.0`), then the suffix — `prealpha` < `alpha` < `beta` < `rc` < the
 * release, each stage by its number (`beta2` < `beta10`); unknown suffixes
 * rank below every known stage, in natural order among themselves.
 *
 * @param a One version.
 * @param b The other.
 * @returns Negative, zero or positive as `a` is older, equal or newer.
 */
export function compareReleaseVersions(a: ReleaseVersion, b: ReleaseVersion): number {
  for (let index = 0; index < Math.max(a.parts.length, b.parts.length); index++) {
    const difference = (a.parts[index] ?? 0) - (b.parts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (a.suffix === b.suffix) return 0;
  const [aStage, aNumber] = preReleaseRank(a.suffix);
  const [bStage, bNumber] = preReleaseRank(b.suffix);
  if (aStage !== bStage) return aStage - bStage;
  if (aStage === -1) return a.suffix.localeCompare(b.suffix, 'en', { numeric: true });
  return aNumber - bNumber;
}

/**
 * Whether two versions share their minor (`major.minor`, missing = 0):
 * `3.23.6` and `3.23.5.1` do, `3.24` and `3.23.5.1` do not.
 *
 * @param a One version.
 * @param b The other.
 */
function sameMinor(a: ReleaseVersion, b: ReleaseVersion): boolean {
  return (a.parts[0] ?? 0) === (b.parts[0] ?? 0) && (a.parts[1] ?? 0) === (b.parts[1] ?? 0);
}

/** A release tag the owner should review, and why. */
export interface NewerRelease {
  readonly tag: string;
  /**
   * The supported version of the same minor it is newer than (a newer
   * patch or pre-release of a supported minor), else `undefined` — newer
   * than every supported version (a new minor or major).
   */
  readonly supersedes?: string;
}

/**
 * Classify one tag against the supported versions.
 *
 * @param version The tag's version.
 * @param pinned The supported versions, parsed, with their source strings.
 * @returns The reason it is newer, or `null` when it is not.
 */
function newerReason(
  version: ReleaseVersion,
  pinned: readonly { readonly raw: string; readonly version: ReleaseVersion }[]
): { supersedes?: string } | null {
  const sibling = pinned.find((pin) => sameMinor(version, pin.version));
  if (sibling !== undefined) {
    return compareReleaseVersions(version, sibling.version) > 0
      ? { supersedes: sibling.raw }
      : null;
  }
  return pinned.every((pin) => compareReleaseVersions(version, pin.version) > 0) ? {} : null;
}

/**
 * The release tags to review, newest first: every tag newer than all
 * supported versions, and every newer patch (or pre-release) of a supported
 * minor — the supported list pins each minor's latest patch. Pre-releases
 * count (release flags are not trusted); other tag shapes are ignored.
 *
 * @param tags Release tag names.
 * @param supported The supported versions.
 */
export function newerReleases(
  tags: readonly string[],
  supported: readonly string[]
): NewerRelease[] {
  const pinned = supported.flatMap((raw) => {
    const version = parseReleaseVersion(raw);
    return version === null ? [] : [{ raw, version }];
  });
  const newer: { release: NewerRelease; version: ReleaseVersion }[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    const version = parseReleaseVersion(tag);
    const reason = version === null ? null : newerReason(version, pinned);
    if (version !== null && reason !== null) newer.push({ release: { tag, ...reason }, version });
  }
  return newer
    .sort((a, b) => compareReleaseVersions(b.version, a.version))
    .map((entry) => entry.release);
}

/**
 * The tags of {@link newerReleases}, newest first — the first is the one the
 * workflow builds and compares (the newest overall, so a new minor wins over
 * a supported minor's newer patch).
 *
 * @param tags Release tag names.
 * @param supported The supported versions.
 */
export function newerReleaseTags(tags: readonly string[], supported: readonly string[]): string[] {
  return newerReleases(tags, supported).map((release) => release.tag);
}

/** The owner-review note every newer-release warning carries. */
const RELEASE_REVIEW_NOTE =
  'Release flags are not trusted: pre-releases count too. For owner review — supporting a version is a reviewed change (registry row in lib/wp-rocket/versions.ts, its pinned zip, `pnpm parity:wp-rocket --write`).';

/**
 * The `--release-check` verdict: one warning naming the releases newer than
 * every supported version (a new minor or major), one naming each newer
 * patch of a supported minor (`v3.23.6` over pinned `3.23.5.1`) — for the
 * owner to decide on a version bump — else a notice. Never an error.
 *
 * @param tags Release tag names.
 * @param supported The supported versions (registry order).
 */
export function releaseCheckFindings(
  tags: readonly string[],
  supported: readonly string[]
): Finding[] {
  const newer = newerReleases(tags, supported);
  const pinned = supported.join(', ');
  if (newer.length === 0) {
    return [
      {
        level: 'notice',
        title: `no WP Rocket release newer than the supported versions (${pinned})`,
        details: []
      }
    ];
  }
  const findings: Finding[] = [];
  const beyond = newer.filter((release) => release.supersedes === undefined);
  if (beyond.length > 0) {
    findings.push({
      level: 'warning',
      title: `WP Rocket ${beyond.map((release) => release.tag).join(', ')} newer than the supported versions (${pinned})`,
      details: [RELEASE_REVIEW_NOTE]
    });
  }
  for (const version of supported) {
    const patches = newer.filter((release) => release.supersedes === version);
    if (patches.length === 0) continue;
    findings.push({
      level: 'warning',
      title: `WP Rocket ${patches.map((release) => release.tag).join(', ')} newer than the supported ${version} of the same minor`,
      details: [RELEASE_REVIEW_NOTE]
    });
  }
  return findings;
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
  readonly rows?: readonly string[];
  readonly listRows?: readonly string[];
  readonly list?: 'bundled';
  readonly defer?: {
    readonly rows: readonly string[];
    readonly lists: 'bundled' | { readonly external: string[]; readonly inline: string[] };
  };
  readonly html: string;
}

/** The survival-case id suffix of a row's Defer JS rows (its Delay JS rows take the bare id). */
const DEFER_SURVIVAL_SUFFIX = '#defer';

/**
 * Every authored row set of the simulation inputs that the settings form must
 * store unchanged (unless `filterOnly`): a row's Delay JS rows under its id,
 * its Defer JS rows under the id + {@link DEFER_SURVIVAL_SUFFIX}.
 *
 * @param inputs The table's inputs.
 */
export function simulationSurvivalSources(
  inputs: readonly SimulateInput[]
): (SurvivalSource & { readonly feature: 'delay_js' | 'defer_all_js' })[] {
  return inputs.flatMap((input) => [
    ...(input.rows === undefined
      ? []
      : [
          {
            id: input.id,
            feature: 'delay_js' as const,
            rows: input.rows,
            ...(input.filterOnly === true ? { filterOnly: true as const } : {})
          }
        ]),
    ...(input.defer === undefined
      ? []
      : [
          {
            id: `${input.id}${DEFER_SURVIVAL_SUFFIX}`,
            feature: 'defer_all_js' as const,
            rows: input.defer.rows,
            ...(input.defer.filterOnly === true ? { filterOnly: true as const } : {})
          }
        ])
  ]);
}

/**
 * A row's `defer` as a harness case field (rows and given lists base64-encoded).
 *
 * @param defer The authored Defer JS inputs.
 */
function deferCase(defer: DeferSimulateInput): NonNullable<SimulateCase['defer']> {
  return {
    rows: defer.rows.map(lineBase64),
    lists:
      defer.lists === 'bundled'
        ? 'bundled'
        : {
            external: defer.lists.external.map(lineBase64),
            inline: defer.lists.inline.map(lineBase64)
          }
  };
}

/** The harness's simulate result. */
interface SimulateResult {
  readonly id: string;
  readonly served: string;
}

/**
 * The harness cases for the simulation table: every row as a simulate case
 * (rows and list rows base64-encoded), plus one survival save case per
 * authored row set ({@link simulationSurvivalSources}) — rows the case stores
 * directly must be what the settings form stores (else the set is
 * `filterOnly`, and then must NOT survive the form).
 *
 * @param inputs The table's inputs.
 * @returns The save (survival) cases and the simulate cases.
 */
export function simulationCases(inputs: readonly SimulateInput[]): {
  saves: SaveCase[];
  simulates: SimulateCase[];
} {
  return {
    saves: simulationSurvivalSources(inputs).map((source) => ({
      id: `${SURVIVAL_PREFIX}${source.id}`,
      kind: 'save',
      feature: source.feature,
      typed: (source.rows ?? []).map(lineBase64),
      safeMode: false
    })),
    simulates: inputs.map((input) => ({
      id: input.id,
      kind: 'simulate',
      feature: input.feature,
      ...(input.rows === undefined ? {} : { rows: input.rows.map(lineBase64) }),
      ...(input.rows === undefined
        ? {}
        : input.listRows === undefined
          ? { list: 'bundled' as const }
          : { listRows: input.listRows.map(lineBase64) }),
      ...(input.defer === undefined ? {} : { defer: deferCase(input.defer) }),
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

/** The `dynamic-lists.json` list behind each data-file list field. */
const DYNAMIC_LIST_NAMES: Readonly<Record<(typeof SIMULATION_LIST_FIELDS)[number], string>> = {
  delayJsExclusions: 'delay_js_exclusions',
  deferJsExternalExclusions: 'defer_js_external_exclusions',
  deferJsInlineExclusions: 'defer_js_inline_exclusions'
};

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
  const listed = SIMULATION_LIST_FIELDS.map((field) => {
    const name = DYNAMIC_LIST_NAMES[field];
    const rows = (lists as Record<string, unknown> | null)?.[name];
    if (!Array.isArray(rows) || !rows.every((row): row is string => typeof row === 'string')) {
      throw new Error(`the plugin's ${DYNAMIC_LISTS_PATH} has no ${name} string list`);
    }
    return { field, rows, entry: { count: rows.length, sha256: textSha256(rowListKeyText(rows)) } };
  });
  const listPins = Object.fromEntries(listed.map(({ field, entry }) => [field, entry])) as Record<
    (typeof SIMULATION_LIST_FIELDS)[number],
    { count: number; sha256: string }
  >;
  const runtimeSha = digest('sha256', sources.runtime);
  const fallbackSha = textSha256(sources.ieFallback);
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
    ...listPins,
    sentinels
  };
  const data: SimulationData = {
    format: SIMULATION_DATA_FORMAT,
    versions: {
      [sources.version]: {
        runtime: { sha256: runtimeSha, version: runtimeVersion },
        ieFallback: { sha256: fallbackSha },
        ...(Object.fromEntries(
          listed.map(({ field, entry }) => [field, { sha256: entry.sha256, count: entry.count }])
        ) as typeof listPins)
      }
    },
    texts: { [runtimeSha]: runtime, [fallbackSha]: sources.ieFallback },
    rowLists: Object.fromEntries(listed.map(({ rows, entry }) => [entry.sha256, rows]))
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
    ...LIST_PIN_KEYS
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

/**
 * The supported version whose expectations an unpinned build is compared
 * against: the newest pinned version of its own minor (a newer patch of a
 * supported minor), else the reference.
 *
 * @param version The other build's version.
 * @param supported The supported versions.
 * @param reference The tables' reference version.
 */
export function expectationBasis(
  version: string,
  supported: readonly string[],
  reference: string
): string {
  const parsed = parseReleaseVersion(version);
  if (parsed === null) return reference;
  const sameMinorPins = supported
    .map((pin) => ({ pin, release: parseReleaseVersion(pin) }))
    .filter(
      (entry): entry is { pin: string; release: ReleaseVersion } =>
        entry.release !== null && sameMinor(entry.release, parsed)
    )
    .sort((a, b) => compareReleaseVersions(b.release, a.release));
  return sameMinorPins[0]?.pin ?? reference;
}

/**
 * A committed table as one supported version expects it: rows resolved with
 * that version's overrides (no `byVersion`), header `plugin` and
 * `pluginPackages` that version's (from `plugins`).
 *
 * @param table The committed table.
 * @param version A supported version the table pins.
 */
export function tableForVersion(table: TableObject, version: string): TableObject {
  const plugins = (table.header.plugins ?? []) as readonly PinnedPlugin[];
  const pinned = plugins.find((plugin) => plugin.version === version);
  return {
    header: {
      ...table.header,
      plugin: version,
      ...(pinned === undefined ? {} : { pluginPackages: pinned.packages })
    },
    rows: table.rows.map((row) => expectationsFor(row as VersionedRow, version))
  };
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
// Merging the supported versions' builds.
// ---------------------------------------------------------------------------

/** A table header's per-build fields: every {@link ParityHeader} key but `plugins`. */
export type BuildHeader = Omit<ParityHeader, 'plugins'>;

/** What one plugin build derives (rows unassembled into tables yet). */
export interface BuildResult {
  readonly header: BuildHeader;
  readonly parityRows: readonly Readonly<Record<string, unknown>>[];
  readonly simulationRows: readonly Readonly<Record<string, unknown>>[];
  /** The simulation pins (`header.simulation`) of this build. */
  readonly pins: SimulationPins;
  /** The data file holding this build's version only. */
  readonly data: SimulationData;
}

/**
 * One header `plugins` entry from a build's header.
 *
 * @param header The build's header fields.
 */
export function pinnedPluginOf(header: BuildHeader): PinnedPlugin {
  return {
    version: header.plugin,
    zipSha256: header.pluginZipSha256,
    packages: header.pluginPackages
  };
}

/**
 * Several builds' data files as one: each version's entry, in build order,
 * and the union of the content-keyed texts and row lists (a shared key is
 * the same content — keys are sha256 digests — so identical runtimes,
 * fallbacks and lists are stored once).
 *
 * @param files The per-build data files.
 * @throws {@link Error} when the merged file fails its own reader.
 */
export function mergeSimulationData(files: readonly SimulationData[]): SimulationData {
  const data: SimulationData = {
    format: SIMULATION_DATA_FORMAT,
    versions: Object.assign(
      {},
      ...files.map((file) => file.versions)
    ) as SimulationData['versions'],
    texts: Object.assign({}, ...files.map((file) => file.texts)) as SimulationData['texts'],
    rowLists: Object.assign({}, ...files.map((file) => file.rowLists)) as SimulationData['rowLists']
  };
  const read = readSimulationData(data);
  if (!read.ok) throw new Error(`merged ${SIMULATION_DATA_FILE}: ${read.problem}`);
  return data;
}

/**
 * Both tables and the data file from every supported version's build: the
 * reference build's rows with each other build's differing outputs as
 * version-keyed expectations (`byVersion`), the reference build's header
 * fields and simulation pins, `plugins` listing every build in the given
 * order, and every version's data-file entry.
 *
 * @param builds One result per supported version, in registry order.
 * @param reference The reference version (the latest stable).
 * @throws {@link Error} when no build is the reference, or another build
 *   derives another row set or differs on an authored field.
 */
export function mergeBuilds(
  builds: readonly BuildResult[],
  reference: string
): { parity: TableObject; simulation: TableObject; data: SimulationData } {
  const base = builds.find((build) => build.header.plugin === reference);
  if (base === undefined) throw new Error(`no build of the reference WP Rocket ${reference}`);
  const others = builds.filter((build) => build !== base);
  const header = pick(
    { ...base.header, plugins: builds.map((build) => pinnedPluginOf(build.header)) },
    HEADER_KEYS
  );
  const parityRows = withVersionExpectations(
    base.parityRows,
    others.map((build) => ({ version: build.header.plugin, rows: build.parityRows })),
    (row) => overridableKeys(row as { kind: string; from?: string })
  );
  const simulationRows = withVersionExpectations(
    base.simulationRows,
    others.map((build) => ({ version: build.header.plugin, rows: build.simulationRows })),
    () => SIMULATE_OUTPUT_KEYS
  );
  return {
    parity: { header, rows: parityRows },
    simulation: { header: { ...header, simulation: base.pins }, rows: simulationRows },
    data: mergeSimulationData(builds.map((build) => build.data))
  };
}

/**
 * Where a supported version's zip fails its pin: another plugin version
 * inside (every mode), or other bytes than the registry's (check and
 * `--write` only — `--ci` builds are never byte-reproducible).
 *
 * @param row The supported version.
 * @param found The zip's `Version:` header and sha256.
 * @param mode The run mode.
 * @returns The problem, or `null` when the zip is the pinned one.
 */
export function zipPinProblem(
  row: SupportedWprVersion,
  found: { readonly version: string; readonly sha256: string },
  mode: Mode
): string | null {
  const path = pluginZipPath(row.version);
  if (found.version !== row.version) {
    return `${path} is WP Rocket ${found.version}, expected ${row.version}`;
  }
  if (mode !== 'ci' && found.sha256 !== row.zipSha256) {
    return `${path} has sha256 ${found.sha256}, pinned ${row.zipSha256} (lib/wp-rocket/versions.ts): copy the pinned build (docs/local-site-runbook.md) and check it with \`shasum -a 256\``;
  }
  return null;
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
 * A build's header fields, from the tree and the harness runs that derived
 * its rows.
 *
 * @param tree The plugin tree.
 * @param envs The `env` of every harness run behind the rows.
 */
function buildHeader(
  tree: PluginTree,
  envs: readonly HarnessOutput<unknown>['env'][]
): BuildHeader {
  const [env] = envs;
  if (env === undefined) throw new Error('buildHeader: no harness run');
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

/** One build's exclusion parity rows and the harness runs behind them. */
interface ParityDerivation {
  readonly rows: Record<string, unknown>[];
  readonly envs: readonly HarnessOutput<unknown>['env'][];
}

/**
 * Derive the exclusion parity rows from their inputs on one build.
 *
 * @param inputs The authored inputs.
 * @param tree The plugin tree.
 */
function deriveParityRows(inputs: readonly ParityInput[], tree: PluginTree): ParityDerivation {
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
  const rows = inputs.map((input) => {
    const result = results.get(input.id);
    if (result === undefined) throw new Error(`${input.id}: the harness returned no result`);
    return assembleRow(input, result);
  });
  return { rows, envs: [saves.env, matches.env] };
}

/** One build's simulation rows, pins and data file. */
interface SimulationDerivation {
  readonly rows: Record<string, unknown>[];
  readonly pins: SimulationPins;
  readonly data: SimulationData;
  readonly envs: readonly HarnessOutput<unknown>['env'][];
}

/**
 * Derive the simulation rows, pins and data file from the table's inputs and
 * authored sentinels on one build.
 *
 * @param inputs The authored inputs.
 * @param sentinels The authored sentinels.
 * @param tree The plugin tree.
 */
function deriveSimulationRows(
  inputs: readonly SimulateInput[],
  sentinels: SimulationSentinels,
  tree: PluginTree
): SimulationDerivation {
  const { php, pluginRoot, wpRoot } = tree;
  const cases = simulationCases(inputs);
  const saves = runHarness<SaveResult>(php, pluginRoot, wpRoot, cases.saves);
  checkSurvival(simulationSurvivalSources(inputs), saves.results);
  const run = runHarness<SimulateResult>(php, pluginRoot, wpRoot, cases.simulates, { sentinels });
  if (typeof run.ieFallback !== 'string') throw new Error('the harness returned no ieFallback');
  const served = new Map(run.results.map((result) => [result.id, result.served]));
  const { pins, data } = simulationArtifacts(
    {
      version: readPluginVersion(readFileSync(join(pluginRoot, 'wp-rocket.php'), 'utf8')),
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
  return { rows, pins, data, envs: [saves.env, run.env] };
}

/** The committed files' texts (the data file may not exist yet). */
interface Committed {
  readonly parity: string;
  readonly simulation: string;
  readonly data: string | null;
}

/** The committed tables' authored inputs. */
interface Inputs {
  readonly parity: readonly ParityInput[];
  readonly simulation: readonly SimulateInput[];
  readonly sentinels: SimulationSentinels;
}

/**
 * The authored inputs of the committed tables.
 *
 * @param committed The committed texts.
 */
function committedInputs(committed: Committed): Inputs {
  const simulation: unknown = JSON.parse(committed.simulation);
  return {
    parity: parseParityInputs(JSON.parse(committed.parity)),
    simulation: parseSimulationInputs(simulation),
    sentinels: committedSentinels(simulation)
  };
}

/**
 * Derive everything one build contributes.
 *
 * @param inputs The authored inputs.
 * @param tree The build's plugin tree.
 */
function deriveBuild(inputs: Inputs, tree: PluginTree): BuildResult {
  const parity = deriveParityRows(inputs.parity, tree);
  const simulation = deriveSimulationRows(inputs.simulation, inputs.sentinels, tree);
  return {
    header: buildHeader(tree, [...parity.envs, ...simulation.envs]),
    parityRows: parity.rows,
    simulationRows: simulation.rows,
    pins: simulation.pins,
    data: simulation.data
  };
}

/** Everything derived from the supported versions' zips, formatted. */
interface Derived {
  readonly parity: { readonly table: TableObject; readonly text: string };
  readonly simulation: { readonly table: TableObject; readonly text: string };
  readonly data: string;
}

/**
 * Parse (each derived file must satisfy the suite's own parsers) and format
 * merged tables and data file.
 *
 * @param merged The merged builds (see {@link mergeBuilds}).
 */
async function formatDerived(merged: ReturnType<typeof mergeBuilds>): Promise<Derived> {
  parseParityTable(merged.parity);
  parseSimulationTable(merged.simulation);
  return {
    parity: { table: merged.parity, text: await formatTable(merged.parity) },
    simulation: {
      table: merged.simulation,
      text: await formatTable(merged.simulation, SIMULATION_TABLE_PATH)
    },
    data: await formatTable(merged.data, SIMULATION_DATA_FILE)
  };
}

/**
 * Check a supported version's zip against its pin.
 *
 * @param row The supported version.
 * @param mode The run mode.
 * @returns The zip's absolute path.
 * @throws {@link Error} when it is missing or not the pinned build.
 */
function pinnedZip(row: SupportedWprVersion, mode: Mode): string {
  const zip = join(REPO_ROOT, pluginZipPath(row.version));
  requirePluginZip(zip);
  const version = readPluginVersion(
    requireCommand('unzip', ['-p', zip, 'wp-rocket/wp-rocket.php'], 'Is it a WP Rocket plugin zip?')
  );
  const problem = zipPinProblem(
    row,
    { version, sha256: digest('sha256', readFileSync(zip)) },
    mode
  );
  if (problem !== null) throw new Error(problem);
  return zip;
}

/**
 * Derive both tables and the data file from the committed inputs under every
 * supported version.
 *
 * @param committed The committed texts.
 * @param mode The run mode (decides whether zip bytes must match their pins).
 * @param php Extra `php -n` arguments (see {@link phpArgs}).
 */
async function deriveAll(
  committed: Committed,
  mode: Mode,
  php: readonly string[]
): Promise<Derived> {
  const inputs = committedInputs(committed);
  const builds: BuildResult[] = [];
  for (const row of SUPPORTED_WPR_VERSIONS) {
    const zip = pinnedZip(row, mode);
    console.log(`[parity] deriving under WP Rocket ${row.version} (${pluginZipPath(row.version)})`);
    builds.push(
      await withPluginTree(zip, php, (tree) => Promise.resolve(deriveBuild(inputs, tree)))
    );
  }
  return formatDerived(mergeBuilds(builds, latestStableWprVersion().version));
}

/**
 * The simulation half of `--compare` on an unzipped tree: the committed table
 * parsed and re-derived. Every failure (malformed committed table, a build
 * whose files or passes the derivation cannot handle) becomes the problem.
 *
 * @param committedText The committed simulation table text.
 * @param tree The other build's tree.
 * @param header The other build's header fields.
 */
function compareSimulation(
  committedText: string,
  tree: PluginTree,
  header: BuildHeader,
  basis: string
): SimulationComparison {
  try {
    const committed = JSON.parse(committedText) as TableObject;
    parseSimulationTable(committed);
    const before = tableForVersion(committed, basis);
    const fresh = deriveSimulationRows(
      parseSimulationInputs(before),
      committedSentinels(before),
      tree
    );
    return {
      ok: true,
      before,
      fresh: { header: { ...header, simulation: fresh.pins }, rows: fresh.rows }
    };
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
    } else if (supportedWprVersion(version) !== undefined) {
      findings = pinnedVersionFindings(version);
    } else {
      const basis = expectationBasis(
        version,
        SUPPORTED_WPR_VERSIONS.map((row) => row.version),
        String(parity.header.plugin)
      );
      findings = await withPluginTree(pluginZip, phpArgs(), (tree) => {
        const rows = deriveParityRows(parityInputs, tree);
        const header = buildHeader(tree, rows.envs);
        return Promise.resolve(
          otherVersionFindings(
            tableForVersion(parity, basis),
            { header, rows: rows.rows },
            compareSimulation(committed.simulation, tree, header, basis)
          )
        );
      });
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

/** `--release-check`: tags on stdin; findings reported, the newest newer tag to the step output. */
function releaseCheck(): void {
  const tags = readFileSync(0, 'utf8').split('\n');
  const supported = SUPPORTED_WPR_VERSIONS.map((row) => row.version);
  report('WP Rocket parity: newer releases', releaseCheckFindings(tags, supported));
  const [newest] = newerReleaseTags(tags, supported);
  const output = process.env.GITHUB_OUTPUT;
  if (newest !== undefined && output !== undefined && output !== '') {
    appendFileSync(output, `newest=${newest}\n`);
  }
}

/** Read a repo file, or `null` when it does not exist. */
function readOptional(path: string): string | null {
  const file = join(REPO_ROOT, path);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** Entry point. */
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const zip = compareZip(options);
  if (options.mode === 'release-check') {
    releaseCheck();
    return;
  }
  requireCommand('unzip', ['-v'], 'Install unzip.');
  const committed: Committed = {
    parity: readFileSync(join(REPO_ROOT, TABLE_PATH), 'utf8'),
    simulation: readFileSync(join(REPO_ROOT, SIMULATION_TABLE_PATH), 'utf8'),
    data: readOptional(SIMULATION_DATA_FILE)
  };
  if (zip !== undefined) {
    await compare(committed, resolve(zip));
    return;
  }
  const fresh = await deriveAll(committed, options.mode, phpArgs());
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
    if (report('WP Rocket parity: pinned builds', findings)) process.exitCode = 1;
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
