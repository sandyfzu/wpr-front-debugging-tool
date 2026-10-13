#!/usr/bin/env node
/**
 * Size-budget gate for the built extension.
 *
 * Reads `scripts/budgets.json` (one row per surface: its output globs and the hard
 * raw/gzip KB ceilings it must never exceed), measures the current Chromium build
 * under `<packageRoot>/.output/chrome-mv3`, prints a pass/fail table and exits
 * non-zero on any breach. The ceilings are regression guards, not decoration: they
 * encode how this rebuild must compare in size to the tool it replaces, so when a
 * breach is legitimate, raise the row deliberately with the reasoning committed —
 * never nudge by default. Rows whose surface has no output yet (a phase not
 * delivered) are skipped, not failed — a phase that starts building a surface owns
 * measuring it from then on, which is why the owning phase's checklist runs this
 * script. Malformed rows fail the run outright; a silent gate is useless.
 *
 * Note: rows here are bundle-size surfaces, and it's worth spelling out both
 * kinds explicitly:
 * - `kind: "bytes"` (the default — every row may omit the field): a bundle
 *   surface with `globs` + `maxKb`, measured from the build output below;
 * - `kind: "timing"`: a runtime gate this script cannot measure (no globs,
 *   no `maxKb` — carrying either is malformed). Its `maxMs` is asserted by
 *   the runner named in `measuredBy` (a committed spec); this script only
 *   prints the row for visibility.
 *
 * Runs from any working directory (Node, pnpm script, hooks); test environments
 * that hand out non-filesystem module URLs fall back to the process cwd.
 *
 * Run after `pnpm build` (typically `pnpm build && pnpm check:budgets`).
 */

import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The package root: the script lives at `<root>/scripts/`, so `<script dir>/..`
 * names the root for every real invocation. Some runners (vitest) hand modules a
 * non-filesystem URL — those fall back to the process cwd (tests always run at
 * root, matching filesystem layout).
 *
 * @returns {string} Absolute path of the package root.
 */
function packageRoot() {
  try {
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    return dirname(scriptDir);
  } catch {
    return process.cwd();
  }
}

const outputRoot = () => join(packageRoot(), '.output', 'chrome-mv3');
const budgetsPath = () => join(packageRoot(), 'scripts', 'budgets.json');

/**
 * Match a file path against one simple glob segment: "exact/path/prefix*.js".
 * `*` matches within a single path segment only — no directory traversal.
 *
 * @param {string} relativePath Path relative to the output root, POSIX-style.
 * @param {string} glob The row glob to match against.
 * @returns {boolean} Whether the path satisfies the glob.
 */
export function matchesGlob(relativePath, glob) {
  const pattern = glob.split('/');
  const path = relativePath.split('/');
  if (pattern.length !== path.length) return false;
  return pattern.every((segment, index) => {
    if (!segment.includes('*')) return segment === path[index];
    const [prefix, suffix] = segment.split('*', 2);
    return path[index].startsWith(prefix) && path[index].endsWith(suffix);
  });
}

/** All files under `root`, as POSIX-style relative paths, recursively. */
function listFiles(root, base = '', out = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const relative = base ? `${base}${sep}${entry.name}` : entry.name;
    if (entry.isDirectory()) listFiles(join(root, entry.name), relative, out);
    else out.push(relative.split(sep).join('/'));
  }
  return out;
}

/**
 * Sum raw and gzip sizes of every file matching the row's globs.
 *
 * @param {string[]} files Files under the output root (POSIX relative paths).
 * @param {string[]} globs Row globs.
 * @param {(path: string) => Buffer} [readFile] File reader (defaults to reading
 *   under the output root); injectable so tests can measure in-memory samples.
 * @returns {{ rawBytes: number, gzipBytes: number, files: string[] }} Measured totals.
 */
export function measureSurface(files, globs, readFile = defaultReadFile) {
  const matched = files.filter((file) => globs.some((glob) => matchesGlob(file, glob)));
  let rawBytes = 0;
  let gzipBytes = 0;
  for (const file of matched) {
    const content = readFile(file);
    rawBytes += content.length;
    gzipBytes += gzipSync(content).length;
  }
  return { rawBytes, gzipBytes, files: matched };
}

/** Resolve a relative path and read it from the current build output. */
function defaultReadFile(relativePath) {
  return readFileSync(join(outputRoot(), relativePath));
}

/**
 * Reads and validates the committed budget rows; a malformed table is a broken
 * gate, so it fails fast naming the offending row instead of measuring garbage.
 *
 * @param {unknown} raw The parsed JSON of `scripts/budgets.json` (an array of
 *   rows, per the kind taxonomy in the header).
 * @returns {Array<{kind: 'bytes', surface: string, globs: string[], maxKb: {raw?: number, gzip?: number}} | {kind: 'timing', surface: string, maxMs: number, measuredBy: string}>}
 *   Validated rows in file order, normalized to their kind.
 */
export function parseBudgetRows(raw) {
  if (!Array.isArray(raw)) {
    throw new Error(`scripts/budgets.json must contain an array of rows, got ${typeof raw}`);
  }
  const problems = [];
  /** @type {Array<{kind: string, surface?: unknown}>} */
  const rows = raw;
  /** One row's stable complaint label (its surface when informative, else `#index`). */
  const label = (/** @type {{surface?: unknown}} */ row, index) =>
    row === null || typeof row !== 'object'
      ? `#${index}`
      : `#${index} (${typeof row.surface === 'string' && row.surface.trim() !== '' ? row.surface : 'unnamed'})`;
  for (const [index, row] of rows.entries()) {
    const tag = label(row, index);
    if (typeof row !== 'object' || row === null) {
      problems.push(`${tag} is not an object`);
      continue;
    }
    if (typeof row.surface !== 'string' || row.surface.trim() === '') {
      problems.push(`${tag} surface must be a non-empty string`);
    }
    const kind = row.kind === undefined ? 'bytes' : row.kind;
    if (kind === 'bytes') {
      const globs = row.globs;
      if (
        !Array.isArray(globs) ||
        globs.length === 0 ||
        globs.some((globPart) => typeof globPart !== 'string' || globPart.trim() === '')
      ) {
        problems.push(`${tag} globs must be a non-empty array of non-empty strings`);
      }
      const maxKb = row.maxKb;
      const positive = (key) =>
        maxKb !== null &&
        typeof maxKb === 'object' &&
        Number.isFinite(maxKb[key]) &&
        maxKb[key] > 0;
      if (!positive('raw') && !positive('gzip')) {
        problems.push(`${tag} maxKb needs a positive raw and/or gzip number`);
      }
    } else if (kind === 'timing') {
      const maxMs = /** @type {{maxMs?: unknown}} */ (row).maxMs;
      if (typeof maxMs !== 'number' || !Number.isFinite(maxMs) || maxMs <= 0) {
        problems.push(`${tag} maxMs must be a positive finite number of milliseconds`);
      }
      const measuredBy = /** @type {{measuredBy?: unknown}} */ (row).measuredBy;
      if (typeof measuredBy !== 'string' || measuredBy.trim() === '') {
        problems.push(`${tag} measuredBy must be a non-empty string naming its runner`);
      }
      if (row.globs !== undefined) {
        problems.push(
          `${tag} is a timing row — a timing gate is measured outside the bundle, so it cannot carry globs`
        );
      }
      if (row.maxKb !== undefined) {
        problems.push(
          `${tag} is a timing row — a timing gate is measured outside the bundle, so it cannot carry maxKb`
        );
      }
    } else {
      problems.push(`${tag} kind must be "bytes" or "timing", got ${String(kind)}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`scripts/budgets.json is invalid:\n${problems.join('\n')}`);
  }
  return rows.map((row, index) => {
    const normalized = { ...raw[index] };
    if (typeof normalized === 'object' && normalized !== null && normalized.kind === undefined) {
      normalized.kind = 'bytes';
    }
    return normalized;
  });
}

/** Reads, parses and validates the committed budget table. */
function readBudgets() {
  return parseBudgetRows(JSON.parse(readFileSync(budgetsPath(), 'utf8')));
}

/** Format KB with one decimal, or `—` when unset. */
const formatKb = (bytes, budgeted) =>
  budgeted === undefined ? '  —  ' : `${(bytes / 1024).toFixed(1)}`.padStart(5);

async function main() {
  let outputDirectory;
  try {
    outputDirectory = statSync(outputRoot());
  } catch {
    console.error(
      `\n✗ .output/chrome-mv3 not found at ${outputRoot()} — run \`pnpm build\` first.\n`
    );
    process.exitCode = 1;
    return;
  }
  if (!outputDirectory.isDirectory()) {
    console.error(`\n✗ ${outputRoot()} is not a directory — run \`pnpm build\`.\n`);
    process.exitCode = 1;
    return;
  }
  const budgets = readBudgets();
  const files = listFiles(outputRoot());
  console.log(`\nSurface budgets — .output/chrome-mv3 (${files.length} files)\n`);
  let breached = false;
  const timingRows = budgets.filter((budget) => budget.kind === 'timing');
  const byteRows = budgets.filter((budget) => budget.kind !== 'timing');
  for (const { surface, maxMs, measuredBy } of timingRows) {
    // A timing gate has no bundle surface to measure; its ceiling is
    // asserted by the runner named in the row. Printed for visibility.
    console.log(
      `  ${surface.padEnd(40)}  ≤ ${maxMs} ms   (runtime gate — measured by ${measuredBy})`
    );
  }
  console.log('  SURFACE                                   RAW (KB)    BUDGET   GZIP (KB)  BUDGET');
  for (const { surface, globs, maxKb } of byteRows) {
    const { rawBytes, gzipBytes, files: hit } = measureSurface(files, globs);
    if (hit.length === 0) {
      console.log(`  ${surface.padEnd(40)}  absent — surface not built yet, or update row globs`);
      continue;
    }
    const rawOver = maxKb.raw !== undefined && rawBytes > maxKb.raw * 1024;
    const gzipOver = maxKb.gzip !== undefined && gzipBytes > maxKb.gzip * 1024;
    breached ||= rawOver || gzipOver;
    console.log(
      `  ${surface.padEnd(40)}  ${formatKb(rawBytes, maxKb.raw !== undefined)} ${
        rawOver ? '>' : '<'
      }   ${String(maxKb.raw ?? '—').padStart(5)}   ${formatKb(
        gzipBytes,
        maxKb.gzip !== undefined
      )}  ${String(maxKb.gzip ?? '—').padStart(5)}`
    );
  }
  console.log('');
  if (breached) {
    console.error('✗ One or more surfaces exceed their size budget.');
    process.exitCode = 1;
  }
}

// Execute only when run as a script; importing (tests) must stay side-effect-free.
// Node passes an absolute argv[1]; `resolve` keeps that true for edge callers too.
if (
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
