/**
 * The wall-clock time a top document's navigation started, taken at
 * `document_start` by the always-on isolated content script and kept in
 * the extension's isolated world (never visible to the page), so the
 * builder overlay — injected into the same world later, maybe after a
 * system sleep — compares session records with an anchor no sleep shifted
 * (the monotonic `performance.now()` may not tick while the system sleeps,
 * so `Date.now() − performance.now()` read later moves by the sleep).
 */

/** The anchor's global name in the isolated world. */
export const NAVIGATION_ANCHOR_GLOBAL = '__wprFdtNavigationStart';

/**
 * Record the anchor (once per document: a later call keeps the first).
 *
 * @param scope The isolated world's global object.
 * @param wallNow Wall-clock epoch ms.
 * @param sinceStart ms since the navigation started (`performance.now()`).
 */
export function recordNavigationAnchor(
  scope: Record<string, unknown>,
  wallNow: () => number,
  sinceStart: () => number
): void {
  if (typeof scope[NAVIGATION_ANCHOR_GLOBAL] === 'number') return;
  // Read in one instant: their difference is the navigation's wall start.
  scope[NAVIGATION_ANCHOR_GLOBAL] = wallNow() - sinceStart();
}

/**
 * The recorded anchor.
 *
 * @param scope The isolated world's global object.
 * @returns It, or null when none was recorded (a page loaded before the
 *   extension was installed or reloaded).
 */
export function readNavigationAnchor(scope: Record<string, unknown>): number | null {
  const anchor = scope[NAVIGATION_ANCHOR_GLOBAL];
  return typeof anchor === 'number' && Number.isFinite(anchor) ? anchor : null;
}
