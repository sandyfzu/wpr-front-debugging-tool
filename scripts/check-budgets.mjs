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
 * @returns {Array<{surface: string, globs: string[], maxKb: {raw?: number, gzip?: number}}>}
 *   Validated rows in file order.
 */
function readBudgets() {
  const raw = JSON.parse(readFileSync(budgetsPath(), 'utf8'));
  if (!Array.isArray(raw)) {
    throw new Error(`scripts/budgets.json must contain an array of rows, got ${typeof raw}`);
  }
  const problems = [];
  for (const [index, row] of raw.entries()) {
    const label =
      row === null || typeof row !== 'object'
        ? `#${index}`
        : `#${index} (${row.surface ?? 'unnamed'})`;
    if (typeof row !== 'object' || row === null) {
      problems.push(`${label} is not an object`);
      continue;
    }
    if (typeof row.surface !== 'string' || row.surface.trim() === '') {
      problems.push(`${label} surface must be a non-empty string`);
    }
    const globs = row.globs;
    if (
      !Array.isArray(globs) ||
      globs.length === 0 ||
      globs.some((globPart) => typeof globPart !== 'string' || globPart.trim() === '')
    ) {
      problems.push(`${label} globs must be a non-empty array of non-empty strings`);
    }
    const maxKb = row.maxKb;
    const positive = (key) =>
      maxKb !== null && typeof maxKb === 'object' && Number.isFinite(maxKb[key]) && maxKb[key] > 0;
    if (!positive('raw') && !positive('gzip')) {
      problems.push(`${label} maxKb needs a positive raw and/or gzip number`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`scripts/budgets.json is invalid:\n${problems.join('\n')}`);
  }
  return raw;
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
  console.log('  SURFACE                                   RAW (KB)    BUDGET   GZIP (KB)  BUDGET');
  for (const { surface, globs, maxKb } of budgets) {
    const { rawBytes, gzipBytes, files: hit } = measureSurface(files, globs);
    if (hit.length === 0) {
      console.log(`  ${surface.padEnd(40)}  absent — surface not built yet, or update row globs`);
      continue;
    }
    const rawOver = maxKb.raw !== undefined && rawBytes > maxKb.raw * 1024;
    const gzipOver = maxKb.gzip !== undefined && gzipBytes > maxKb.gzip * 1024;
    breached ||= rawOver || gzipOver;
    console.log(
      `  ${surface.padEnd(40)}  ${formatKb(rawBytes)} ${rawOver ? '>' : '<'}   ${String(
        maxKb.raw ?? '—'
      ).padStart(5)}   ${formatKb(gzipBytes, maxKb.gzip !== undefined)}  ${String(
        maxKb.gzip ?? '—'
      ).padStart(5)}`
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
