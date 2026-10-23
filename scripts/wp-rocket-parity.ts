/**
 * WP Rocket parity table generator/checker (`pnpm parity:wp-rocket`).
 *
 * Re-derives every expected output of
 * `lib/exclusion-builder/wp-rocket-parity.fixtures.json` by running the REAL
 * plugin and WordPress core code under `php -n` (`scripts/wp-rocket-parity.php`):
 * the plugin zip and seven `wp-includes` files of the pinned WordPress release
 * are unzipped into a temporary directory, the table's authored inputs are fed
 * to the harness, and the outputs are merged back and formatted with the
 * repo's Prettier config — so the file is byte-for-byte what `--write` produces.
 *
 * - default (check): fails with the differences when the committed table is
 *   stale (header included: the exact local zip bytes and PHP build);
 * - `--write`: rewrites the table;
 * - `--ci`: checks a fresh build of the reference tag — zip bytes are never
 *   reproducible across builds (skipped) and another PHP build is a notice;
 *   fails as "table stale" on any other difference and as "reference drift"
 *   when the build vendored other package versions than `pluginPackages`;
 * - `--compare`: reports how another plugin version (e.g. the latest release)
 *   differs from the table, as warnings only — never fails.
 *
 * `--zip <path>` selects the plugin zip (default `docker/wpr/wpr-rocket.zip`,
 * built locally with apvm). Network is used only to download the pinned
 * WordPress zip once; it is sha1-verified and cached in `.cache/wp-rocket-parity/`.
 * Needs `unzip` and PHP ≥ 8.1 with ext-dom + ext-mbstring, compiled in or as
 * shared modules (the harness runs without php.ini, so the script loads
 * missing ones with `-d extension=…`). Inside GitHub Actions, findings are
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
const ENVIRONMENT_KEYS = ['php', 'pcre2', 'libxml'] as const;

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
    readonly libxml: string;
    /** Composer packages whose `vendor/` files the run loaded. */
    readonly vendorPackages: readonly string[];
  };
  readonly results: readonly R[];
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

/**
 * Check every survival case: a `filterOnly` row set must change on save, any
 * other authored row set must be stored exactly as written.
 *
 * @param inputs The table's inputs.
 * @param results The save results, survival cases included.
 * @throws {@link Error} naming every mismatching row.
 */
export function checkSurvival(
  inputs: readonly ParityInput[],
  results: readonly SaveResult[]
): void {
  const problems: string[] = [];
  for (const result of results) {
    if (!result.id.startsWith(SURVIVAL_PREFIX)) continue;
    const id = result.id.slice(SURVIVAL_PREFIX.length);
    const input = inputs.find((candidate) => candidate.id === id) as MatchInput;
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
    if (was !== now) lines.push(`header.${key}: ${was} → ${now}`);
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
      if (was !== now) differences.push({ id, line: `${id}.${key}: ${was} → ${now}` });
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
 * @returns One line per difference; empty when the texts are equal.
 */
export function describeStaleness(committed: string, fresh: string): string[] {
  if (committed === fresh) return [];
  let before: { header?: Record<string, unknown>; rows?: Record<string, unknown>[] };
  try {
    before = JSON.parse(committed) as typeof before;
  } catch {
    return ['the committed table is not valid JSON'];
  }
  const after = JSON.parse(fresh) as TableObject;
  const lines = [
    ...headerDifferences(before.header, after.header, HEADER_KEYS),
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

/**
 * The `--ci` verdict for a fresh build of the reference tag.
 *
 * @param committed The committed table text.
 * @param fresh The derived table.
 * @returns "table stale" (rows, or any header field other than the zip bytes,
 *   PHP build and packages — compared byte-for-byte after aligning those),
 *   "reference drift" (packages), and a PHP-build notice; a single "reproduces"
 *   notice when nothing differs.
 * @throws {@link Error} when the committed table does not parse.
 */
export async function ciFindings(committed: string, fresh: TableObject): Promise<Finding[]> {
  const before = parseParityTable(JSON.parse(committed)).header;
  const tolerated = [...CI_SKIPPED_KEYS, 'pluginPackages', ...ENVIRONMENT_KEYS];
  const aligned = await formatTable({
    ...fresh,
    header: { ...fresh.header, ...pick(before as unknown as Record<string, unknown>, tolerated) }
  });
  const stale = describeStaleness(committed, aligned);
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
      title: 'table stale',
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
      title: `the table reproduces with a fresh build of WP Rocket ${before.plugin}`,
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
 */
export function compareFindings(before: TableObject, fresh: TableObject): Finding[] {
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
        title: `WP Rocket ${version} matches the table (WP Rocket ${reference}) on all ${String(fresh.rows.length)} rows`,
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
      title: `WP Rocket ${version} differs from the table (WP Rocket ${reference}) on ${String(ids.length)} rows: ${shown}${more}`,
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
      // A fence longer than any backtick run in the details keeps them verbatim.
      const longest = Math.max(2, ...finding.details.map((d) => /`+/.exec(d)?.[0].length ?? 0));
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
 * Format the table with the repo's Prettier config (as `pnpm format` would).
 *
 * @param table The table object.
 */
export async function formatTable(table: unknown): Promise<string> {
  const file = join(REPO_ROOT, TABLE_PATH);
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
      ['-n', ...args, '-r', PHP_PROBE],
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

/** Run the harness on cases. */
function runHarness<R>(
  php: readonly string[],
  pluginRoot: string,
  wpRoot: string,
  cases: readonly unknown[]
): HarnessOutput<R> {
  const run = spawnSync('php', ['-n', ...php, join(REPO_ROOT, HARNESS), pluginRoot, wpRoot], {
    input: JSON.stringify({ cases }),
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

/**
 * Derive the full table from the committed table's inputs and a plugin zip.
 *
 * @param inputs The authored inputs.
 * @param pluginZip Absolute path of the plugin zip.
 * @param php Extra `php -n` arguments (see {@link phpArgs}).
 * @returns The table object and its formatted text.
 */
async function deriveTable(
  inputs: readonly ParityInput[],
  pluginZip: string,
  php: readonly string[]
): Promise<{ table: TableObject; text: string }> {
  requirePluginZip(pluginZip);
  const wpZip = await wordpressZip();
  const scratch = mkdtempSync(join(tmpdir(), 'wpr-parity-'));
  try {
    requireCommand('unzip', ['-q', pluginZip, 'wp-rocket/*', '-d', scratch], 'Install unzip.');
    const members = WP_FILES.map((file) => `wordpress/wp-includes/${file}`);
    requireCommand('unzip', ['-q', wpZip, ...members, '-d', scratch], 'Install unzip.');
    const pluginRoot = join(scratch, 'wp-rocket');
    const wpRoot = join(scratch, 'wordpress');
    const lockPath = join(pluginRoot, 'composer.lock');
    if (!existsSync(lockPath)) {
      throw new Error(
        `${pluginZip} has no wp-rocket/composer.lock: its package versions are unknown.`
      );
    }

    const saves = runHarness<SaveResult>(php, pluginRoot, wpRoot, saveCases(inputs));
    checkSurvival(inputs, saves.results);
    const stored = new Map(saves.results.map((result) => [result.id, result.stored]));
    const matches = runHarness<MatchResult>(php, pluginRoot, wpRoot, matchCases(inputs, stored));
    const results = new Map<string, SaveResult | MatchResult>();
    for (const result of [...saves.results, ...matches.results]) results.set(result.id, result);
    for (const match of matches.results) {
      const input = inputs.find((candidate) => candidate.id === match.id) as MatchInput;
      if (input.from !== undefined)
        results.set(match.id, { ...match, rows: stored.get(input.from) });
    }

    const vendorPackages = new Set([...saves.env.vendorPackages, ...matches.env.vendorPackages]);
    const header: ParityHeader = {
      plugin: readPluginVersion(readFileSync(join(pluginRoot, 'wp-rocket.php'), 'utf8')),
      pluginZipSha256: digest('sha256', readFileSync(pluginZip)),
      pluginPackages: readPackageVersions(readFileSync(lockPath, 'utf8'), [...vendorPackages]),
      wp: WP_CORE.version,
      wpZipSha1: WP_CORE.sha1,
      php: saves.env.php,
      pcre2: saves.env.pcre2,
      libxml: saves.env.libxml,
      generatedBy: 'pnpm parity:wp-rocket --write'
    };
    const rows = inputs.map((input) => {
      const result = results.get(input.id);
      if (result === undefined) throw new Error(`${input.id}: the harness returned no result`);
      return assembleRow(input, result);
    });
    const table = { header: pick(header as unknown as Record<string, unknown>, HEADER_KEYS), rows };
    parseParityTable(table); // The derived table must satisfy the suite's own parser.
    return { table, text: await formatTable(table) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** `--compare`: report differences as warnings; any failure to compare is a warning too. */
async function compare(committed: string, pluginZip: string): Promise<void> {
  const heading = `WP Rocket parity: ${basename(pluginZip)} vs the table`;
  let findings: Finding[];
  try {
    const before = JSON.parse(committed) as TableObject;
    parseParityTable(before);
    requirePluginZip(pluginZip);
    const mainFile = requireCommand(
      'unzip',
      ['-p', pluginZip, 'wp-rocket/wp-rocket.php'],
      'Is it a WP Rocket plugin zip?'
    );
    const version = readPluginVersion(mainFile);
    if (version === before.header.plugin) {
      findings = sameVersionFindings(version);
    } else {
      const { table } = await deriveTable(parseParityInputs(before), pluginZip, phpArgs());
      findings = compareFindings(before, table);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    findings = [
      {
        level: 'warning',
        title: 'could not compare this WP Rocket build with the table',
        details: [message]
      }
    ];
  }
  report(heading, findings);
}

/** Entry point. */
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  requireCommand('unzip', ['-v'], 'Install unzip.');
  const pluginZip = options.zip === undefined ? join(REPO_ROOT, PLUGIN_ZIP) : resolve(options.zip);
  const tablePath = join(REPO_ROOT, TABLE_PATH);
  const committed = readFileSync(tablePath, 'utf8');
  if (options.mode === 'compare') {
    await compare(committed, pluginZip);
    return;
  }
  const php = phpArgs();
  const fresh = await deriveTable(parseParityInputs(JSON.parse(committed)), pluginZip, php);
  if (options.mode === 'write') {
    writeFileSync(tablePath, fresh.text);
    console.log(`[parity] wrote ${TABLE_PATH}`);
    return;
  }
  if (options.mode === 'ci') {
    if (report('WP Rocket parity: reference build', await ciFindings(committed, fresh.table))) {
      process.exitCode = 1;
    }
    return;
  }
  const differences = describeStaleness(committed, fresh.text);
  if (differences.length > 0) {
    console.error(
      `[parity] ${TABLE_PATH} is stale (re-derive with \`pnpm parity:wp-rocket --write\`):`
    );
    for (const line of differences) console.error(`  ${line}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[parity] ${TABLE_PATH} reproduces byte-for-byte`);
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
