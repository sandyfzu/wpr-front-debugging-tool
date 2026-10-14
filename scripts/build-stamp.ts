/**
 * The build-stamp machinery shared by the production build and the e2e
 * harness: the source fingerprint and the derived-data stamp file the two
 * paths must agree on.
 *
 * `pnpm build` runs this module (its main) after WXT produced
 * `.output/chrome-mv3`, so the harness's staleness gate reads a stamp whose
 * provenance is the build's own — a manual build can no longer leave an
 * output the harness silently reuses against sources that no longer produced
 * it (the audit round's stale-output hole). The e2e global setup imports the
 * same functions for its compare/rebuild flow; this one module is the single
 * declaring site for the fingerprint format, the stamp path and both writers.
 *
 * Runs under Node's native TypeScript (type-stripping — plain erasable
 * syntax only); local-only by rule: the stamp file is derived data, gitignored.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root (two levels above this module: scripts → root). */
const moduleRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Source trees + files the build reads — everything that can change its output. */
const SOURCE_TREES = ['entrypoints', 'components', 'lib', 'utils', 'assets', 'public'] as const;
const SOURCE_FILES = ['wxt.config.ts', 'package.json'] as const;

/**
 * Source files, as POSIX-relative paths from the given root, in stable order.
 *
 * @param root The repo root whose sources are fingerprinted.
 */
export function listSourceFiles(root: string = moduleRepoRoot): string[] {
  const collected: string[] = [];
  const addTree = (relativeDir: string): void => {
    const dir = join(root, relativeDir);
    if (!existsSync(dir)) return;
    const walk = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (entry.name === '.DS_Store') continue;
        const full = join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          collected.push(relative(root, full).split('\\').join('/'));
        }
      }
    };
    walk(dir);
  };
  for (const tree of SOURCE_TREES) addTree(tree);
  for (const file of SOURCE_FILES) {
    if (existsSync(join(root, file))) collected.push(file);
  }
  return collected.sort();
}

/**
 * SHA-256 of a file's bytes (fingerprinting the build's inputs).
 *
 * @param root The repo root.
 * @param relativePath Repo-relative path.
 */
function hashFile(root: string, relativePath: string): string {
  const buffer = readFileSync(join(root, relativePath));
  return createHash('sha256').update(buffer).digest('hex');
}

/** The source-fingerprint + per-file record the stamp stores. */
export interface SourceState {
  /** Whole-tree fingerprint (path\0digest listing, combined + hashed). */
  fingerprint: string;
  /** Per-file digests (the caller's diff input). */
  perFile: Record<string, string>;
}

/**
 * Full source fingerprint: path + per-file digest over the given root.
 *
 * @param root The repo root whose sources are fingerprinted.
 */
export function computeSourceState(root: string = moduleRepoRoot): SourceState {
  const files = listSourceFiles(root);
  const perFile: Record<string, string> = {};
  for (const file of files) perFile[file] = hashFile(root, file);
  const combined = files.map((file) => `${file}\0${perFile[file] ?? ''}`).join('\n');
  return { fingerprint: createHash('sha256').update(combined).digest('hex'), perFile };
}

/** The stamp file for a given root (derived data; gitignored). */
export function stampPathFor(root: string = moduleRepoRoot): string {
  return join(root, 'tests', 'e2e', '.build-stamp.json');
}

/**
 * The last build's recorded source state for a root, or null (never built /
 * not recorded / malformed — a broken stamp re-derives, it never fails the
 * gate on its own).
 *
 * @param root The repo root the stamp belongs to.
 */
export function readStamp(root: string = moduleRepoRoot): SourceState | null {
  const stampPath = stampPathFor(root);
  if (!existsSync(stampPath)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(stampPath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const stamp = parsed as { fingerprint: unknown; perFile: unknown };
    if (
      typeof stamp.fingerprint !== 'string' ||
      typeof stamp.perFile !== 'object' ||
      stamp.perFile === null
    ) {
      return null;
    }
    return { fingerprint: stamp.fingerprint, perFile: stamp.perFile as Record<string, string> };
  } catch {
    return null;
  }
}

/**
 * Record the given source state as the just-built provenance (the one stamp
 * writer both paths share).
 *
 * @param state The state to record.
 * @param root The repo root the stamp belongs to.
 */
export function writeStamp(state: SourceState, root: string = moduleRepoRoot): void {
  const stampPath = stampPathFor(root);
  mkdirSync(dirname(stampPath), { recursive: true });
  writeFileSync(
    stampPath,
    JSON.stringify({ fingerprint: state.fingerprint, perFile: state.perFile }, null, 2)
  );
}

/**
 * The stamp the finished production build answers for, written in record
 * order: compute AFTER the bundler's exit so the sources the Just-finished
 * build read are exactly what gets fingerprinted. This module's main —
 * `pnpm build` invokes it (the `&&` after `wxt build`).
 */
function main(): void {
  writeStamp(computeSourceState());
  console.log('[build] source fingerprint recorded for the e2e staleness gate');
}

// Execute only as the build hook's main; imports (the e2e setup, tests) stay side-effect-free.
if (
  typeof process.argv[1] === 'string' &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  main();
}
