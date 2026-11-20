/**
 * Types of `./budget-start-set.mjs` (plain JS, documented there), so typed
 * callers — the browser tests — walk a page's start set the way the budget
 * gate does instead of re-deriving it.
 */

/** The JS a page's HTML loads at start (module scripts + modulepreloads; classic scripts apart). */
export function htmlStartScripts(html: string): { modules: string[]; classic: string[] };

/** A chunk's static `import`/`export … from` specifiers, and why they can't be trusted if it did not parse. */
export function staticImports(
  source: string,
  name: string
): { specifiers: string[]; problem?: string };

/** A page `src`/`href` or import specifier resolved to a build path, or why it has none. */
export function resolveBuildPath(
  reference: string,
  from: string
): { path: string } | { problem: string };

/** The page's start set: its HTML's JS plus every static import, transitively; trust `files` only without `problems`. */
export function startSet(
  page: string,
  present: ReadonlySet<string>,
  readText: (path: string) => string
): { files: string[]; problems: string[] };
