/**
 * The toolbar button's API namespace for this build. Manifest V3 names it
 * `action`; Manifest V2 names it `browserAction` (Firefox's MV2 build has no
 * `action` at all). The choice is a build-time constant equal to the shipped
 * manifest's version, so each bundle references only its own namespace.
 */

import type { Browser } from 'wxt/browser';

/**
 * This build's toolbar button namespace name — the one declaring site of the
 * manifest-version rule. A build-time constant, so each bundle folds it to its
 * own literal and never carries the other name.
 */
export const TOOLBAR_NAMESPACE: 'browserAction' | 'action' =
  import.meta.env.MANIFEST_VERSION === 2 ? 'browserAction' : 'action';

/**
 * The badge writes the toolbar badge makes, in their promise forms. Both
 * namespaces expose these per tab (`tabId`) on every supported platform:
 * Firefox declares `browserAction` as an import of `action`'s schema.
 */
export type ToolbarBadgeApi = Pick<
  typeof Browser.action,
  'setBadgeText' | 'setBadgeBackgroundColor' | 'setBadgeTextColor'
>;

/** The methods {@link asToolbarBadgeApi} requires, in one place. */
const BADGE_METHODS = ['setBadgeText', 'setBadgeBackgroundColor', 'setBadgeTextColor'] as const;

/**
 * Accept a candidate namespace only when it carries every badge write.
 *
 * @param candidate The namespace the build selected (possibly undefined).
 * @returns The namespace as the badge API, or null when it is missing or
 *   lacks a write — callers report that instead of throwing per update.
 */
export function asToolbarBadgeApi(candidate: unknown): ToolbarBadgeApi | null {
  if (typeof candidate !== 'object' || candidate === null) return null;
  const record = candidate as Record<string, unknown>;
  return BADGE_METHODS.every((name) => typeof record[name] === 'function')
    ? (candidate as ToolbarBadgeApi)
    : null;
}

/**
 * This build's toolbar badge API.
 *
 * @returns `browser.action` on Manifest V3 builds, `browser.browserAction`
 *   on Manifest V2 builds; null when the running browser lacks it.
 */
export function toolbarBadgeApi(): ToolbarBadgeApi | null {
  // Build-time constant: the dead namespace is eliminated from each bundle.
  // Read through `unknown` — the typings mark both namespaces as always present.
  const candidate: unknown = browser[TOOLBAR_NAMESPACE];
  return asToolbarBadgeApi(candidate);
}
