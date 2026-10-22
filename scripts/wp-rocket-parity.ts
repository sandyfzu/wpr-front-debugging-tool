/**
 * WP Rocket parity table generator/checker (`pnpm parity:wp-rocket`).
 *
 * Re-derives every expected output of
 * `lib/exclusion-builder/wp-rocket-parity.fixtures.json` by running the REAL
 * plugin and WordPress core code under `php -n` (`scripts/wp-rocket-parity.php`):
 * the plugin zip (`docker/wpr/wpr-rocket.zip`, git-ignored) and seven
 * `wp-includes` files of the pinned WordPress release are unzipped into a
 * temporary directory, the table's authored inputs are fed to the harness,
 * and the outputs are merged back and formatted with the repo's Prettier
 * config — so the file is byte-for-byte what `--write` produces.
 *
 * - default (check): fails with the changed rows when the committed table is stale;
 * - `--write`: rewrites the table.
 *
 * Network is used only to download the pinned WordPress zip once; it is
 * sha1-verified and cached in `.cache/wp-rocket-parity/` (git-ignored).
 * Dev-time only (needs PHP ≥ 8.1 with ext-dom and `unzip`); never run in CI.
 *
 * Runs under Node's native TypeScript (type-stripping — erasable syntax only).
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

/** The plugin build the table is derived from (git-ignored; see docs/local-site-runbook.md). */
const PLUGIN_ZIP = 'docker/wpr/wpr-rocket.zip';

/** The PHP harness, next to this script. */
const HARNESS = 'scripts/wp-rocket-parity.php';

/** The pinned WordPress core release: version + the wordpress.org zip's sha1. */
export const WP_CORE = {
  version: '7.1.3',
  sha1: '13eb1d042b1ca39224e44906cd84fe203112210c'
} as const;

/** Where the WordPress zip is cached (git-ignored). */
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

/** What the run does with the derived table. */
export type Mode = 'check' | 'write';

/**
 * The run mode from the CLI arguments.
 *
 * @param args Arguments after the script path.
 * @throws {@link Error} on any unknown argument.
 */
export function parseMode(args: readonly string[]): Mode {
  if (args.length === 0) return 'check';
  if (args.length === 1 && args[0] === '--write') return 'write';
  throw new Error(`unknown arguments: ${args.join(' ')} (usage: pnpm parity:wp-rocket [--write])`);
}

/**
 * Validate the PHP probe's output (`<version>\n<dom|nodom>`).
 *
 * @param probe The probe's stdout.
 * @returns The PHP version.
 * @throws {@link Error} when PHP is too old or ext-dom is not loaded under `php -n`.
 */
export function checkPhpProbe(probe: string): string {
  const [version = '', dom = ''] = probe.trim().split('\n');
  const [major = 0, minor = 0] = version.split('.').map(Number);
  if (major < MIN_PHP[0] || (major === MIN_PHP[0] && minor < MIN_PHP[1])) {
    throw new Error(`PHP ${version || '?'} found; the harness needs PHP >= ${MIN_PHP.join('.')}.`);
  }
  if (dom !== 'dom') {
    throw new Error(
      `PHP ${version} has no ext-dom under \`php -n\` (no php.ini). Install a PHP build with ext-dom compiled in (\`php -n -m\` must list "dom").`
    );
  }
  return version;
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
  readonly env: { readonly php: string; readonly pcre2: string; readonly libxml: string };
  readonly results: readonly R[];
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
  const after = JSON.parse(fresh) as {
    header: Record<string, unknown>;
    rows: Record<string, unknown>[];
  };
  const lines: string[] = [];
  for (const key of HEADER_KEYS) {
    const was = before.header?.[key];
    const now = after.header[key];
    if (was !== now) lines.push(`header.${key}: ${JSON.stringify(was)} → ${JSON.stringify(now)}`);
  }
  const byId = new Map((before.rows ?? []).map((row) => [row.id, row]));
  for (const row of after.rows) {
    const old = byId.get(row.id);
    byId.delete(row.id);
    if (old === undefined) {
      lines.push(`${String(row.id)}: missing from the committed table`);
      continue;
    }
    const keys = new Set([...Object.keys(old), ...Object.keys(row)]);
    for (const key of keys) {
      // `undefined` (an absent key) stringifies to undefined, not text.
      const was = JSON.stringify(old[key]) as string | undefined;
      const now = JSON.stringify(row[key]) as string | undefined;
      if (was !== now) {
        lines.push(`${String(row.id)}.${key}: ${was ?? 'absent'} → ${now ?? 'absent'}`);
      }
    }
  }
  for (const id of byId.keys()) lines.push(`${String(id)}: not derivable from the inputs`);
  if (lines.length === 0) lines.push('formatting differs (run with --write)');
  return lines;
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
    const response = await fetch(url);
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
  pluginRoot: string,
  wpRoot: string,
  cases: readonly unknown[]
): HarnessOutput<R> {
  const run = spawnSync('php', ['-n', join(REPO_ROOT, HARNESS), pluginRoot, wpRoot], {
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

/** Derive the full table text from the committed table's inputs. */
async function deriveTable(inputs: readonly ParityInput[]): Promise<string> {
  const pluginZip = join(REPO_ROOT, PLUGIN_ZIP);
  if (!existsSync(pluginZip)) {
    throw new Error(
      `${PLUGIN_ZIP} is missing: build it with apvm (docs/local-site-runbook.md) or copy it from the main checkout.`
    );
  }
  const wpZip = await wordpressZip();
  const scratch = mkdtempSync(join(tmpdir(), 'wpr-parity-'));
  try {
    requireCommand('unzip', ['-q', pluginZip, 'wp-rocket/*', '-d', scratch], 'Install unzip.');
    const members = WP_FILES.map((file) => `wordpress/wp-includes/${file}`);
    requireCommand('unzip', ['-q', wpZip, ...members, '-d', scratch], 'Install unzip.');
    const pluginRoot = join(scratch, 'wp-rocket');
    const wpRoot = join(scratch, 'wordpress');

    const saves = runHarness<SaveResult>(pluginRoot, wpRoot, saveCases(inputs));
    checkSurvival(inputs, saves.results);
    const stored = new Map(saves.results.map((result) => [result.id, result.stored]));
    const matches = runHarness<MatchResult>(pluginRoot, wpRoot, matchCases(inputs, stored));
    const results = new Map<string, SaveResult | MatchResult>();
    for (const result of [...saves.results, ...matches.results]) results.set(result.id, result);
    for (const match of matches.results) {
      const input = inputs.find((candidate) => candidate.id === match.id) as MatchInput;
      if (input.from !== undefined)
        results.set(match.id, { ...match, rows: stored.get(input.from) });
    }

    const header: ParityHeader = {
      plugin: readPluginVersion(readFileSync(join(pluginRoot, 'wp-rocket.php'), 'utf8')),
      pluginZipSha256: digest('sha256', readFileSync(pluginZip)),
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
    return await formatTable(table);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Entry point. */
async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  checkPhpProbe(
    requireCommand(
      'php',
      ['-n', '-r', 'echo PHP_VERSION, "\\n", extension_loaded("dom") ? "dom" : "nodom";'],
      'Install PHP >= 8.1 (CLI) and put it on PATH.'
    )
  );
  requireCommand('unzip', ['-v'], 'Install unzip.');
  const tablePath = join(REPO_ROOT, TABLE_PATH);
  const committed = readFileSync(tablePath, 'utf8');
  const fresh = await deriveTable(parseParityInputs(JSON.parse(committed)));
  if (mode === 'write') {
    writeFileSync(tablePath, fresh);
    console.log(`[parity] wrote ${TABLE_PATH}`);
    return;
  }
  const differences = describeStaleness(committed, fresh);
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
