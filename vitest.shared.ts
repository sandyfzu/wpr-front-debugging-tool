/**
 * Shared vitest runtime pieces for the root and bench configs (and the test
 * files that need them) — declared once so the runners and tests cannot drift:
 * happy-dom runs fully offline (parsed URLs are data, not network requests;
 * the fixture corpus is offline), and its expected "disabled load" console
 * noise is filtered from the gate signal instead of failing it.
 */

/** happy-dom environment settings: all resource loading disabled. */
export const HAPPY_DOM_SETTINGS = {
  disableCSSFileLoading: true,
  disableJavaScriptFileLoading: true,
  disableIframePageLoading: true,
  // Disabled (non-iframe) loads report success instead of erroring.
  handleDisabledFileLoadingAsSuccess: true
} as const;

/**
 * Filter happy-dom's own console reports for disabled loads — expected
 * offline noise, never gate signal.
 *
 * @param log The console line.
 * @param type The console stream it came from.
 * @returns `false` to drop the line, `undefined` to keep default handling.
 */
export function filterDisabledLoadNoise(log: string, type: string): boolean | undefined {
  if (
    type === 'stderr' &&
    /Iframe page loading is disabled|CSS file loading is disabled/.test(log)
  ) {
    return false;
  }
  return undefined;
}

/**
 * Wall-clock ceiling (ms) for a 4 MiB hostile input in the linear-scan tests:
 * those scans take 10–200 ms alone; the quadratic/backtracking ones they
 * replaced took seconds to minutes at that size. Generous on purpose —
 * coverage instrumentation and parallel workers slow the same linear run
 * several-fold, and a tight ceiling would flake.
 */
export const HOSTILE_CEILING_MS = 1_000;
