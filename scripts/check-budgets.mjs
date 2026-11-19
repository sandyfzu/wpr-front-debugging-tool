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
 *   surface with `maxKb`, measured from the build output below — the
 *   Chromium build, or the build its optional `build` field names
 *   (`firefox-mv2`: skipped, not failed, while that build is absent). Its
 *   files are named one of two ways:
 *   - `globs`: a row matching no file reads "absent" (not built yet) unless
 *     it is marked `required: true` — then each of its globs must match
 *     exactly one file, so a shipped file renamed, moved or doubled fails the
 *     gate; `backstop: true` marks a catch-all row (the whole build) that may
 *     overlap every other row;
 *   - `start`: an entry page (`panel.html`) whose start set — the JS it loads
 *     plus every static import, transitively (`./budget-start-set.mjs`) — is
 *     derived from the build, so no chunk name can rename a start chunk out
 *     of the row. An unresolvable set fails the row, and a start file another
 *     non-backstop row also counts fails the gate (a lazily loaded chunk
 *     pulled onto the start path, or a double count);
 * - `kind: "timing"`: a runtime gate this script cannot measure (no globs,
 *   no `maxKb` — carrying either is malformed). Its `maxMs` is asserted by
 *   the runner named in `measuredBy` (a committed spec); this script only
 *   prints the row for visibility.
 *
 * Runs from any working directory (Node, pnpm script, hooks); test environments
 * that hand out non-filesystem module URLs fall back to the process cwd.
 *
 * Gzip sizes come from the running Node's zlib, and zlib builds differ in
 * output (Node 24's Chromium-derived zlib and Node 26's stock 1.2.12 give
 * the same bytes 0.3 KB apart): the script refuses a Node whose major is
 * not the one `.nvmrc` pins, and prints the zlib it measured with.
 *
 * Run after `pnpm build` (typically `pnpm build && pnpm check:budgets`).
 */

import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startSet } from './budget-start-set.mjs';

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

/**
 * The build directories a bytes row may be measured in (`build` field):
 * the Chromium build (default — CI builds it) and the Firefox build (built
 * by `pnpm build:firefox`; its rows are skipped while it is absent).
 */
export const BUILD_DIRECTORIES = ['chrome-mv3', 'firefox-mv2'];

/** The build directory every row without a `build` field is measured in. */
const DEFAULT_BUILD = 'chrome-mv3';

/**
 * The build directory a bytes row is measured in.
 *
 * @param {{build?: string}} row A validated bytes row.
 * @returns {string} Its build directory name under `.output/`.
 */
export function buildDirectory(row) {
  return row.build ?? DEFAULT_BUILD;
}

const outputRoot = (build = DEFAULT_BUILD) => join(packageRoot(), '.output', build);
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
  return measureFiles(
    files.filter((file) => globs.some((glob) => matchesGlob(file, glob))),
    readFile
  );
}

/**
 * Sum raw and gzip sizes of the given files.
 *
 * @param {string[]} files The files to measure (POSIX relative paths).
 * @param {(path: string) => Buffer} readFile File reader.
 * @returns {{ rawBytes: number, gzipBytes: number, files: string[] }} Measured totals.
 */
export function measureFiles(files, readFile) {
  let rawBytes = 0;
  let gzipBytes = 0;
  for (const file of files) {
    const content = readFile(file);
    rawBytes += content.length;
    gzipBytes += gzipSync(content).length;
  }
  return { rawBytes, gzipBytes, files };
}

/**
 * The files of one row: its start set (`start` rows) or its glob matches.
 *
 * @param {{globs?: string[], start?: string}} row A validated bytes row.
 * @param {string[]} files Files under the row's build root.
 * @param {(path: string) => Buffer} readFile The build's file reader.
 * @returns {{ files: string[], problems: string[] }} The row's files, and why a start set is incomplete.
 */
export function rowFiles(row, files, readFile) {
  if (row.start === undefined) {
    return {
      files: files.filter((file) => row.globs.some((glob) => matchesGlob(file, glob))),
      problems: []
    };
  }
  return startSet(row.start, new Set(files), (path) => readFile(path).toString('utf8'));
}

/**
 * Start files another row counts too (backstop rows excepted): each one is
 * either a lazily loaded chunk pulled onto the start path or a double count,
 * and both make the start row's number lie.
 *
 * @param {string} startSurface The start row's surface.
 * @param {string[]} startFiles The start row's files.
 * @param {Array<{surface: string, globs?: string[], start?: string, backstop?: true}>} others
 *   The other bytes rows measured in the same build.
 * @returns {string[]} One line per doubly counted file.
 */
export function startOverlaps(startSurface, startFiles, others) {
  const lines = [];
  for (const other of others) {
    if (other.backstop === true || other.globs === undefined) continue;
    for (const file of startFiles) {
      if (other.globs.some((glob) => matchesGlob(file, glob))) {
        lines.push(
          `${file} is in the start set of "${startSurface}" and also counted by "${other.surface}"`
        );
      }
    }
  }
  return lines;
}

/**
 * A required row's globs that do not match exactly one file each.
 *
 * @param {string[]} files Files under the build root.
 * @param {string[]} globs The row's globs.
 * @returns {Array<{glob: string, matched: number}>} Each offending glob with its match count.
 */
export function requiredGlobProblems(files, globs) {
  return globs
    .map((glob) => ({ glob, matched: files.filter((file) => matchesGlob(file, glob)).length }))
    .filter(({ matched }) => matched !== 1);
}

/**
 * Measure one bytes row against its own build: skipped while that build is
 * absent (only an optional build can be — the Chromium root is checked
 * first); a required row whose globs do not each match exactly one file is
 * unmatched, and a start row whose start set cannot be fully resolved is
 * broken (both breaches); otherwise absent when no file matches, else its
 * totals, files and breaches.
 *
 * @param {{globs?: string[], start?: string, maxKb: {raw?: number, gzip?: number}, build?: string, required?: boolean}} row A validated bytes row.
 * @param {(build: string) => string[] | null} filesOf A build's file list, or null when it is not built.
 * @param {(build: string) => (path: string) => Buffer} readerFor A build's file reader.
 * @returns {{status: 'skipped', build: string} | {status: 'unmatched', problems: Array<{glob: string, matched: number}>} | {status: 'broken', problems: string[]} | {status: 'absent'} | {status: 'measured', rawBytes: number, gzipBytes: number, files: string[], rawOver: boolean, gzipOver: boolean}}
 *   The row's outcome.
 */
export function measureRow(row, filesOf, readerFor) {
  const build = buildDirectory(row);
  const files = filesOf(build);
  if (files === null) return { status: 'skipped', build };
  if (row.required === true) {
    const problems = requiredGlobProblems(files, row.globs);
    if (problems.length > 0) return { status: 'unmatched', problems };
  }
  const reader = readerFor(build);
  const selected = rowFiles(row, files, reader);
  if (selected.problems.length > 0) return { status: 'broken', problems: selected.problems };
  const { rawBytes, gzipBytes, files: hit } = measureFiles(selected.files, reader);
  if (hit.length === 0) return { status: 'absent' };
  return {
    status: 'measured',
    rawBytes,
    gzipBytes,
    files: hit,
    rawOver: row.maxKb.raw !== undefined && rawBytes > row.maxKb.raw * 1024,
    gzipOver: row.maxKb.gzip !== undefined && gzipBytes > row.maxKb.gzip * 1024
  };
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
 * @returns {Array<{kind: 'bytes', surface: string, globs?: string[], start?: string, maxKb: {raw?: number, gzip?: number}, build?: string, required?: true, backstop?: true} | {kind: 'timing', surface: string, maxMs: number, measuredBy: string}>}
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
      if (row.start !== undefined) {
        // A start row's files are its page's start set: globs would name a second set.
        if (typeof row.start !== 'string' || !/^[^/].*\.html$/.test(row.start)) {
          problems.push(`${tag} start must name a built page by its relative path (panel.html)`);
        }
        if (globs !== undefined)
          problems.push(`${tag} carries start and globs — name its files once`);
        if (row.required !== undefined) {
          problems.push(
            `${tag} is a start row — its page is always required, so it cannot carry required`
          );
        }
        if (row.backstop !== undefined) {
          problems.push(
            `${tag} is a start row — a start set is no catch-all, so it cannot carry backstop`
          );
        }
      } else if (
        !Array.isArray(globs) ||
        globs.length === 0 ||
        globs.some((globPart) => typeof globPart !== 'string' || globPart.trim() === '')
      ) {
        problems.push(`${tag} globs must be a non-empty array of non-empty strings`);
      }
      if (row.backstop !== undefined && row.backstop !== true) {
        problems.push(`${tag} backstop must be true when present`);
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
      // Symmetric with the timing kind's exclusions: a field the bytes kind
      // does not use is dead-lettered (it reads like a maximum while
      // validating nothing), so it is malformed rather than ignored.
      if (row.maxMs !== undefined) {
        problems.push(
          `${tag} is a bytes row — a bundle surface is measured in KB, so it cannot carry maxMs`
        );
      }
      if (row.measuredBy !== undefined) {
        problems.push(
          `${tag} is a bytes row — this script is its runner, so it cannot carry measuredBy`
        );
      }
      if (row.build !== undefined && !BUILD_DIRECTORIES.includes(row.build)) {
        problems.push(`${tag} build must be one of ${BUILD_DIRECTORIES.join(', ')}`);
      }
      // Only `true` means anything; `false` would read like a setting while being the default.
      if (row.required !== undefined && row.required !== true) {
        problems.push(`${tag} required must be true when present`);
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
      if (row.build !== undefined) {
        problems.push(
          `${tag} is a timing row — a timing gate is measured outside the bundle, so it cannot carry build`
        );
      }
      if (row.required !== undefined) {
        problems.push(
          `${tag} is a timing row — a timing gate is measured outside the bundle, so it cannot carry required`
        );
      }
      for (const field of ['start', 'backstop']) {
        if (row[field] !== undefined) {
          problems.push(
            `${tag} is a timing row — a timing gate is measured outside the bundle, so it cannot carry ${field}`
          );
        }
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

/**
 * Why this Node must not measure, or `null`: its major differs from the
 * pinned one (its zlib would measure gzip sizes differently).
 *
 * @param {string} nodeVersion `process.version` (`v24.1.0`).
 * @param {string | null} pinned The `.nvmrc` content (a major, e.g. `24`), or `null` when unreadable.
 * @returns {string | null} The refusal, naming both versions.
 */
export function runtimeProblem(nodeVersion, pinned) {
  if (pinned === null) {
    return '.nvmrc is missing or unreadable at the package root: it pins the Node major gzip sizes are measured with';
  }
  const want = pinned.trim().replace(/^v/, '').split('.')[0];
  const have = nodeVersion.replace(/^v/, '').split('.')[0];
  if (!/^\d+$/.test(want ?? ''))
    return `.nvmrc holds no Node major (got ${JSON.stringify(pinned)})`;
  return have === want
    ? null
    : `Node ${nodeVersion} measures gzip with its own zlib; run with Node ${want} (.nvmrc)`;
}

/**
 * The pinned Node major as `.nvmrc` holds it, or `null` when the file
 * cannot be read (the refusal then says so).
 *
 * @param path The `.nvmrc` path.
 * @returns {string | null} Its content.
 */
export function readPinnedNode(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

async function main() {
  const problem = runtimeProblem(process.version, readPinnedNode(join(packageRoot(), '.nvmrc')));
  if (problem !== null) {
    console.error(`\n✗ ${problem}.\n`);
    process.exitCode = 1;
    return;
  }
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
  /** Each build's file list, or null when that (optional) build is absent. */
  const listings = new Map();
  const filesOf = (build) => {
    if (!listings.has(build)) {
      let present = false;
      try {
        present = statSync(outputRoot(build)).isDirectory();
      } catch {
        present = false;
      }
      listings.set(build, present ? listFiles(outputRoot(build)) : null);
    }
    return listings.get(build);
  };
  console.log(
    `\nSurface budgets — .output/chrome-mv3 (${filesOf(DEFAULT_BUILD).length} files)` +
      ' + rows marked [firefox-mv2] on .output/firefox-mv2' +
      ` (gzip: Node ${process.version}, zlib ${process.versions.zlib})\n`
  );
  let breached = false;
  // The row-label column: the table's minimum (40) widened to the longest
  // label, so the timing-gate lines and every data line share one column
  // set with the header (committed long-known rows exceed 40 today).
  const labelWidth = Math.max(
    40,
    ...budgets.map(
      (budget) => budget.surface.length + (budget.build === undefined ? 0 : budget.build.length + 3)
    )
  );
  const padded = (label) => label.padEnd(labelWidth);
  const timingRows = budgets.filter((budget) => budget.kind === 'timing');
  const byteRows = budgets.filter((budget) => budget.kind !== 'timing');
  for (const { surface, maxMs, measuredBy } of timingRows) {
    // A timing gate has no bundle surface to measure; its ceiling is
    // asserted by the runner named in the row. Printed for visibility.
    console.log(`  ${padded(surface)}  ≤ ${maxMs} ms   (runtime gate — measured by ${measuredBy})`);
  }
  console.log(`  ${padded('SURFACE')}  RAW (KB)    BUDGET   GZIP (KB)  BUDGET`);
  for (const row of byteRows) {
    const { maxKb } = row;
    const build = buildDirectory(row);
    const surface = build === DEFAULT_BUILD ? row.surface : `${row.surface} [${build}]`;
    const result = measureRow(
      row,
      filesOf,
      (rowBuild) => (relativePath) => readFileSync(join(outputRoot(rowBuild), relativePath))
    );
    if (result.status === 'skipped') {
      console.log(
        `  ${padded(surface)}  skipped — .output/${build} not built (pnpm build:firefox)`
      );
      continue;
    }
    if (result.status === 'unmatched') {
      breached = true;
      const detail = result.problems
        .map(({ glob, matched }) => `${glob} matched ${matched} files`)
        .join('; ');
      console.log(`  ${padded(surface)}  ✗ required: ${detail} (each glob must match exactly 1)`);
      continue;
    }
    if (result.status === 'broken') {
      breached = true;
      console.log(`  ${padded(surface)}  ✗ start set of ${row.start} unresolved:`);
      for (const problem of result.problems) console.log(`      ${problem}`);
      continue;
    }
    if (result.status === 'absent') {
      console.log(`  ${padded(surface)}  absent — surface not built yet, or update row globs`);
      continue;
    }
    const { rawBytes, gzipBytes, rawOver, gzipOver } = result;
    breached ||= rawOver || gzipOver;
    console.log(
      `  ${padded(surface)}  ${formatKb(rawBytes, maxKb.raw !== undefined)} ${
        rawOver ? '>' : '<'
      }   ${String(maxKb.raw ?? '—').padStart(5)}   ${formatKb(
        gzipBytes,
        maxKb.gzip !== undefined
      )}  ${String(maxKb.gzip ?? '—').padStart(5)}`
    );
    if (row.start === undefined) continue;
    // A start set is derived, so the table names what it counted.
    console.log(`      ${result.files.length} start files: ${result.files.join(', ')}`);
    const overlaps = startOverlaps(
      surface,
      result.files,
      byteRows.filter((other) => other !== row && buildDirectory(other) === build)
    );
    for (const overlap of overlaps) console.log(`      ✗ ${overlap}`);
    breached ||= overlaps.length > 0;
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
