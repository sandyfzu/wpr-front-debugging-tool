/**
 * Playwright global setup for the browser-test harness: refuses a stale
 * extension build before any browser launches.
 *
 * The harness loads `.output/chrome-mv3/` (the `pnpm build` artifact). If the
 * extension sources have changed since that build, a stale bundle would be
 * silently exercised, so the guard fails fast with the changed-file diff —
 * or rebuilds first when it may (see E2E_BUILD_STRICT). The fingerprint and
 * stamp I/O are the shared module `scripts/build-stamp.ts` (the production
 * build appends its own stamp write to `pnpm build`, so the compare here is
 * provenance-grade: an output whose build did not produce or did not finish
 * the stamp cannot ride a stale fingerprint past this gate).
 *
 * Local-only by rule: this runs on the developer's machine, never in CI.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeSourceState,
  listSourceFiles,
  readStamp,
  writeStamp
} from '../../scripts/build-stamp.ts';

/** Repo root (two levels above this file: tests/e2e → root). */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The unpacked bundle the harness loads. */
const extensionDir = join(repoRoot, '.output', 'chrome-mv3');

/**
 * Files whose content changed between the recorded build and current sources.
 * New + deleted files included; without a prior stamp nothing is known and
 * the answer is "everything".
 */
function computeDiff(previous: Record<string, string> | null): string[] {
  const currentState = computeSourceState(repoRoot);
  const current = listSourceFiles(repoRoot);
  const changed: string[] = [];
  for (const file of current) {
    if (previous === null || previous[file] === undefined) changed.push(`+ ${file}`);
    else if (previous[file] !== currentState.perFile[file]) changed.push(`~ ${file}`);
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
  const after = computeSourceState(repoRoot);
  // Immutable between global setup and the run: a mid-run source edit would
  // deserve a rebuild, not a silent live-load mismatch. The child's own hook
  // already wrote this stamp (single writer shape); re-writing through the
  // shared module keeps the parent's post-build state authoritative even if
  // the hook chain did not complete.
  writeStamp(after, repoRoot);
  console.log('[e2e] extension build refreshed and fingerprinted');
}
