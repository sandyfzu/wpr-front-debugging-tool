/**
 * Clean-checkout guard for the Firefox sources zip.
 *
 * WXT packs every non-dot file of the project into the sources zip AMO
 * reviewers rebuild from, minus the configured excludes. Those excludes
 * mirror `.gitignore`, so a stray file that is neither tracked nor ignored
 * (scratch notes, a dropped zip, a local log under another name) would
 * reach the store. The zip therefore refuses to run while git reports any
 * such file — but only when the sources root is itself a checkout's top
 * level. Anywhere else (a reviewer's unpacked sources, even inside some
 * other repository such as a git-managed home folder) there is nothing to
 * compare against and the guard steps aside.
 */

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

/**
 * Runs `git` with arguments in a folder and returns its stdout.
 * Injected so the guard's decisions stay unit-testable.
 */
export type GitRunner = (args: readonly string[], cwd: string) => string;

/** Resolves a path to its canonical form (symlinks, `/var` → `/private/var`). */
export type RealPath = (target: string) => string;

/**
 * Stdout ceiling for a git call: `execFileSync`'s 1 MiB default overflows
 * (`ENOBUFS`) on a large untracked listing; 64 MiB holds about a million paths.
 */
export const GIT_MAX_BUFFER = 64 * 1024 * 1024;

/** How many untracked paths the refusal names before summarizing the rest. */
export const LISTED_FILES_MAX = 50;

/**
 * Untracked, non-ignored paths, NUL-separated. Not `--directory`: it would
 * report a folder whose files its own `.gitignore` ignores (husky's `_/`).
 */
export const UNTRACKED_ARGS = ['ls-files', '--others', '--exclude-standard', '-z'] as const;

/** Names the working tree's top-level folder. */
export const TOP_LEVEL_ARGS = ['rev-parse', '--show-toplevel'] as const;

/**
 * Runs a command synchronously and returns its stdout as UTF-8.
 *
 * @param command - The executable.
 * @param args - Its arguments.
 * @param cwd - The working folder.
 * @param maxBuffer - Stdout ceiling in bytes; beyond it the call throws `ENOBUFS`.
 * @returns The command's stdout.
 * @throws The `execFileSync` error (non-zero exit with `stderr`, spawn failure, overflow).
 */
export function execText(
  command: string,
  args: readonly string[],
  cwd: string,
  maxBuffer: number
): string {
  return execFileSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

/** The real `git`, with {@link GIT_MAX_BUFFER}. */
export const runGit: GitRunner = (args, cwd) => execText('git', args, cwd, GIT_MAX_BUFFER);

/** What git prints when the folder is not inside a working tree. */
const NOT_A_REPO = /not a git repository/i;

/**
 * Describes a failed git call: its stderr plus the error itself (code, message).
 *
 * @param error - What the runner threw.
 * @returns One trimmed line of text.
 */
function gitFailureText(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  return `${typeof stderr === 'string' ? stderr : ''} ${String(error)}`.trim();
}

/**
 * The guard's error for a failed git call, naming the folder.
 *
 * @param root - The sources root.
 * @param text - {@link gitFailureText} of the failure.
 * @returns The error to throw.
 */
function gitError(root: string, text: string): Error {
  return new Error(`[WPR FDT] sources zip: cannot list untracked files in ${root}: ${text}`);
}

/**
 * Split NUL-separated git output into paths (sorted, empties dropped).
 *
 * @param output - `git ls-files -z` output.
 * @returns The paths.
 */
export function parseNulList(output: string): string[] {
  return output
    .split('\0')
    .filter((entry) => entry !== '')
    .sort();
}

/**
 * The top-level folder of the git working tree holding `root`.
 *
 * @param root - The sources root.
 * @param git - The git runner.
 * @returns The top level as git prints it, or `null` outside a working tree.
 * @throws {@link Error} naming the folder on any other git failure.
 */
export function gitTopLevel(root: string, git: GitRunner = runGit): string | null {
  try {
    return git(TOP_LEVEL_ARGS, root).trim();
  } catch (error) {
    const text = gitFailureText(error);
    if (NOT_A_REPO.test(text)) return null;
    throw gitError(root, text);
  }
}

/**
 * The untracked files git does not ignore under the sources root, when that
 * root is its own checkout's top level.
 *
 * @param root - The sources root.
 * @param git - The git runner.
 * @param realpath - Canonicalizes both sides of the top-level comparison.
 * @returns Paths relative to `root`, or `null` when `root` is not a working tree's top level —
 *   outside git, or nested inside another repository (nothing to check).
 * @throws {@link Error} naming the folder when git fails for any other reason
 *   (missing binary, broken repository, output overflow) — the zip must not
 *   skip the check.
 */
export function untrackedSources(
  root: string,
  git: GitRunner = runGit,
  realpath: RealPath = realpathSync.native
): string[] | null {
  const topLevel = gitTopLevel(root, git);
  if (topLevel === null || realpath(topLevel) !== realpath(root)) return null;
  try {
    return parseNulList(git(UNTRACKED_ARGS, root));
  } catch (error) {
    throw gitError(root, gitFailureText(error));
  }
}

/**
 * The refusal message for untracked files, or `null` when there are none.
 * Names at most {@link LISTED_FILES_MAX} paths so a huge listing stays readable.
 *
 * @param files - Untracked, non-ignored paths.
 * @returns The message naming the files.
 */
export function untrackedSourcesError(files: readonly string[]): string | null {
  if (files.length === 0) return null;
  const listed = files.slice(0, LISTED_FILES_MAX).map((file) => `  ${file}`);
  if (files.length > LISTED_FILES_MAX) {
    listed.push(`  … and ${String(files.length - LISTED_FILES_MAX)} more`);
  }
  return (
    `[WPR FDT] sources zip refused: untracked files that are not git-ignored (the sources zip packs the checkout as it is on disk):\n` +
    listed.join('\n') +
    '\nZip from a clean checkout: commit, delete or git-ignore them.'
  );
}

/**
 * Refuse the sources zip when the checkout holds untracked, non-ignored files.
 *
 * @param root - The sources root (`zip.sourcesRoot`).
 * @param git - The git runner.
 * @param realpath - See {@link untrackedSources}.
 * @throws {@link Error} listing the files ({@link untrackedSourcesError}).
 */
export function assertCleanSources(
  root: string,
  git: GitRunner = runGit,
  realpath: RealPath = realpathSync.native
): void {
  const message = untrackedSourcesError(untrackedSources(root, git, realpath) ?? []);
  if (message !== null) throw new Error(message);
}
