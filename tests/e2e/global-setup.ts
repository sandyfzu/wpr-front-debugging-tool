/**
 * Playwright global setup for the browser-test harness: refuses a stale
 * extension build before any browser launches.
 *
 * The harness loads `.output/chrome-mv3/` (the `pnpm build` artifact). If the
 * extension sources have changed since that build, a stale bundle would be
 * silently exercised, so the guard fails fast with the changed-file diff —
 * or rebuilds first when it may (see E2E_BUILD_STRICT).
 *
 * Local-only by rule: this runs on the developer's machine, never in CI.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root (two levels above this file: tests/e2e → root). */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The unpacked bundle the harness loads. */
const extensionDir = join(repoRoot, '.output', 'chrome-mv3');

/** Fingerprint bookkeeping; gitignored (derived data). */
const stampPath = join(repoRoot, 'tests', 'e2e', '.build-stamp.json');

/** Source trees + files the build reads — everything that can change its output. */
const SOURCE_TREES = ['entrypoints', 'components', 'lib', 'utils', 'assets', 'public'] as const;
const SOURCE_FILES = ['wxt.config.ts', 'package.json'] as const;

/** Source files, as POSIX-relative paths from the repo root, in stable order. */
function listSourceFiles(): string[] {
  const collected: string[] = [];
  const addTree = (relativeDir: string): void => {
    const dir = join(repoRoot, relativeDir);
    if (!existsSync(dir)) return;
    const walk = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (entry.name === '.DS_Store') continue;
        const full = join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          collected.push(relative(repoRoot, full).split('\\').join('/'));
        }
      }
    };
    walk(dir);
  };
  for (const tree of SOURCE_TREES) addTree(tree);
  for (const file of SOURCE_FILES) {
    if (existsSync(join(repoRoot, file))) collected.push(file);
  }
  return collected.sort();
}

/**
 * SHA-256 of a file's bytes (fingerprinting the build's inputs).
 *
 * @param relativePath Repo-relative path.
 */
function hashFile(relativePath: string): string {
  const buffer = readFileSync(join(repoRoot, relativePath));
  return createHash('sha256').update(buffer).digest('hex');
}

/** Full source fingerprint: path + per-file digest mapping, hash-combined. */
function computeSourceState(): { fingerprint: string; perFile: Record<string, string> } {
  const files = listSourceFiles();
  const perFile: Record<string, string> = {};
  for (const file of files) perFile[file] = hashFile(file);
  const combined = files.map((file) => `${file}\0${perFile[file] ?? ''}`).join('\n');
  return { fingerprint: createHash('sha256').update(combined).digest('hex'), perFile };
}

/** The last build's recorded source state, or null (never built / not recorded). */
function readStamp(): { fingerprint: string; perFile: Record<string, string> } | null {
  if (!existsSync(stampPath)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(stampPath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const stamp = parsed as { fingerprint: unknown; perFile: unknown };
    if (
      typeof stamp.fingerprint !== 'string' ||
      typeof stamp.perFile !== 'object' ||
      stamp.perFile === null
    )
      return null;
    return { fingerprint: stamp.fingerprint, perFile: stamp.perFile as Record<string, string> };
  } catch {
    return null;
  }
}

/**
 * Files whose content changed between the recorded build and current sources.
 * New + deleted files included; without a prior stamp nothing is known and
 * the answer is "everything".
 */
function computeDiff(previous: Record<string, string> | null): string[] {
  const current = listSourceFiles();
  const changed: string[] = [];
  for (const file of current) {
    if (previous === null || previous[file] === undefined) changed.push(`+ ${file}`);
    else if (previous[file] !== hashFile(file)) changed.push(`~ ${file}`);
  }
  for (const previousFile of Object.keys(previous ?? {})) {
    if (!current.includes(previousFile)) changed.push(`- ${previousFile}`);
  }
  return changed;
}

/** Whether a usable Chromium bundle exists on disk. */
function bundleExists(): boolean {
  return existsSync(join(extensionDir, 'manifest.json'));
}

/**
 * Global setup entry: verify the build is current, else rebuild (or fail).
 * Throws with a precise, actionable message on any refusal path. Sync on
 * purpose: every branch is a completed file/spawn operation, and Playwright
 * awaits its global setup regardless.
 */
export default function globalSetup(): void {
  const source = computeSourceState();
  const stamp = readStamp();
  const stampMatches = stamp !== null && stamp.fingerprint === source.fingerprint;

  if (stampMatches && bundleExists()) {
    console.log('[e2e] extension build is current — skipping rebuild');
    return;
  }

  const changed = stampMatches || bundleExists() ? computeDiff(stamp?.perFile ?? null) : null;
  const description = !bundleExists()
    ? 'no extension bundle at .output/chrome-mv3 — run `pnpm build` first'
    : stampMatches
      ? 'bundle directory is incomplete (manifest missing)'
      : 'extension sources changed since the last build';

  if (process.env.E2E_BUILD_STRICT === '1') {
    const diffList = changed === null ? ['(no previous fingerprint recorded)'] : changed;
    throw new Error(
      [
        `[e2e] stale extension build — refusing to run against it (${description}).`,
        changed !== null && diffList.length === 0
          ? ''
          : `[e2e] changed source files:\n  ${diffList.join('\n  ')}`,
        '[e2e] rebuild with `pnpm build`, or unset E2E_BUILD_STRICT to let the harness rebuild.'
      ].join('\n')
    );
  }

  console.log(`[e2e] ${description} — rebuilding now (pnpm build)...`);
  if (changed !== null && changed.length > 0) {
    console.log(`[e2e] changed source files:\n  ${changed.join('\n  ')}`);
  }
  const built = spawnSync('pnpm', ['build'], { cwd: repoRoot, stdio: 'inherit' });
  if (built.status !== 0) {
    throw new Error(
      `[e2e] pnpm build failed with status ${String(built.status)} — cannot start the harness`
    );
  }
  if (!bundleExists()) {
    throw new Error(
      '[e2e] pnpm build completed but .output/chrome-mv3/manifest.json is still missing'
    );
  }
  const after = computeSourceState();
  // Immutable between global setup and the run: a mid-run source edit would
  // deserve a rebuild, not a silent live-load mismatch.
  mkdirSync(dirname(stampPath), { recursive: true });
  writeFileSync(
    stampPath,
    JSON.stringify({ fingerprint: after.fingerprint, perFile: after.perFile }, null, 2)
  );
  console.log('[e2e] extension build refreshed and fingerprinted');
}
