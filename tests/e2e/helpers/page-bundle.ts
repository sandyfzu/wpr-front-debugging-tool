/**
 * Ship a repo module into a test page exactly as written: bundle it (with
 * every module-level helper and import it reaches) into one classic script
 * that publishes its exports under a window global. A suite then exercises
 * the real module in a real DOM, never a `Function#toString()` copy that
 * silently breaks the moment the function calls a sibling helper.
 *
 * Harness-only: no shipped module imports this file.
 */

import path from 'node:path';

import { build, type Rolldown } from 'vite';

/** The repo root (this file lives in `tests/e2e/helpers`). */
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

/**
 * Bundle one module into a page-injectable IIFE script.
 *
 * Uses Vite's library build in memory (`write: false`, no config file, so the
 * extension's WXT config never applies) — the same toolchain that builds the
 * shipped code. Unminified, so a page-side failure reads with real names.
 *
 * @param entry The module's path, relative to the repo root.
 * @param globalName The window global the module's exports land on.
 * @returns The script source, for `page.addScriptTag({ content })`.
 * @throws {@link Error} When the build yields no single entry chunk (names the entry).
 */
export async function bundleModuleForPage(entry: string, globalName: string): Promise<string> {
  const result = await build({
    configFile: false,
    root: REPO_ROOT,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      emptyOutDir: false,
      lib: { entry: path.resolve(REPO_ROOT, entry), name: globalName, formats: ['iife'] }
    }
  });
  const outputs: readonly Rolldown.RolldownOutput[] = Array.isArray(result)
    ? result
    : 'output' in result
      ? [result]
      : [];
  const chunks = outputs
    .flatMap((output) => output.output)
    .filter((item): item is Rolldown.OutputChunk => item.type === 'chunk' && item.isEntry);
  const [chunk] = chunks;
  if (chunk === undefined || chunks.length !== 1)
    throw new Error(
      `Bundling ${entry} for the page produced ${String(chunks.length)} entry chunks`
    );
  return chunk.code;
}
