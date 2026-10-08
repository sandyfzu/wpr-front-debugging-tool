/**
 * Shared vitest runtime pieces for the root and bench configs — declared once
 * so the two runners cannot drift: happy-dom runs fully offline (parsed URLs
 * are data, not network requests; the fixture corpus is offline), and its
 * expected "disabled load" console noise is filtered from the gate signal
 * instead of failing it.
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
