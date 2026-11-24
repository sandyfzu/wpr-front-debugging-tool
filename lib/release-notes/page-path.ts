/**
 * The What's new page's address: its path under the extension root (WXT
 * serves the `entrypoints/whats-new/` page there; the background opens it,
 * the options page links it) and its `since` parameter — the version the
 * user already knew, so the page expands every announced release above it.
 * Without the parameter (opened from options) the page leads with the
 * running release.
 */
import { parseExtensionVersion } from '../../utils/extension-version';

/** The page's path under the extension root. */
export const WHATS_NEW_PAGE_PATH = '/whats-new.html';

/** The query parameter carrying the floor. */
const SINCE_PARAM = 'since';

/**
 * The page's address after an update.
 *
 * @param pageUrl The page's full URL (`runtime.getURL(WHATS_NEW_PAGE_PATH)`).
 * @param since The version the user already knew.
 * @returns The URL with the floor as its query.
 */
export function whatsNewPageUrl(pageUrl: string, since: string): string {
  return `${pageUrl}?${new URLSearchParams({ [SINCE_PARAM]: since }).toString()}`;
}

/**
 * Read the floor from the page's query (untrusted: anyone can type the URL).
 *
 * @param search `location.search`.
 * @returns The version, or null when absent or not a valid extension version.
 */
export function readSinceParam(search: string): string | null {
  const since = new URLSearchParams(search).get(SINCE_PARAM);
  return parseExtensionVersion(since) === null ? null : since;
}
