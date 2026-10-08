/**
 * Text extraction for the Known Conflicts scans: what the two supported
 * screens (a HelpScout conversation and the WordPress plugins list) expose,
 * read from the live DOM. Pure over a `ParentNode` root so the same code
 * serves the live page and the parsed fixture document the tests use.
 *
 * The HelpScout screen has two inbox layouts: message tables render under
 * `.threads-container` (current) or `.ThreadListItem` (previous).

 * The plugins-list selector covers both WordPress markups (table cells as
 * `td` up to 6.x, as `th` from 7.x) — the selector is the fix for the
 * plugin rows being invisible on newer WordPress.
 */

import type { KnownConflictsMode } from '../../../lib/known-conflicts/match';

/**
 * The HelpScout URL mode: only conversation pages trigger the scanning UI.
 * The prefix is compared against the full `href` (scheme + host + path), the
 * exact scoping the surface uses — query-string tricks on other hosts cannot
 * enter the mode.
 *
 * @param url The page's URL.
 */
export function isHelpScoutConversation(url: URL): boolean {
  return url.href.startsWith('https://secure.helpscout.net/conversation/');
}

/**
 * The WordPress-admin URL mode: the manage-plugins screen.
 *
 * @param url The page's URL.
 */
export function isWordPressPluginsPage(url: URL): boolean {
  return url.href.includes('/wp-admin/plugins.php');
}

/**
 * Which scan a page belongs to, from its URL. 'none' pages never create UI.
 *
 * @param url The page's URL.
 */
export function scanModeForUrl(url: URL): KnownConflictsMode | 'none' {
  if (isHelpScoutConversation(url)) return 'helpscout';
  if (isWordPressPluginsPage(url)) return 'wp-admin';
  return 'none';
}

/** HelpScout message tables, current inbox layout. */
const HS_MESSAGE_TABLE_SELECTOR = '.threads-container .messageBody table';
/** HelpScout message tables, previous inbox layout (different container id). */
const HS_PREVIOUS_INBOX_TABLE_SELECTOR = '.ThreadListItem table';

/**
 * Concatenate the text of every HelpScout message table on the page.
 *
 * Selects from the live root — no serialization and no reparse — per
 * extraction; the ticket page's own tables are read as rendered. An empty
 * result (no tables, or tables without text) is the caller's "nothing to
 * scan" signal, not an error.
 *
 * @param root The live `document.body` or a fixture equivalent.
 * @returns The combined table text ('' when nothing matched).
 */
export function extractHelpScoutText(root: ParentNode): string {
  let allText = '';
  const tables = root.querySelectorAll<HTMLTableElement>(HS_MESSAGE_TABLE_SELECTOR);
  if (tables.length === 0) {
    for (const table of root.querySelectorAll<HTMLTableElement>(HS_PREVIOUS_INBOX_TABLE_SELECTOR)) {
      allText += table.textContent;
    }
    return allText;
  }
  for (const table of tables) allText += table.textContent;
  return allText;
}

/**
 * Concatenate the text of every plugin-title cell on the plugins screen —
 * both markups, the `th` variant being the newer WordPress shape.
 *
 * @param root The live `document.body` or a fixture equivalent.
 * @returns The combined plugin-title text ('' when nothing matched).
 */
export function extractWordPressPluginsText(root: ParentNode): string {
  let allText = '';
  for (const title of root.querySelectorAll<HTMLElement>(
    'th.plugin-title.column-primary, td.plugin-title.column-primary'
  )) {
    allText += title.textContent;
  }
  return allText;
}

/**
 * Extract the scan text for a mode, from whatever the caller provides.
 *
 * @param mode The scan's URL mode.
 * @param root The live `document.body` or a fixture equivalent.
 * @returns The scan text ('' for 'none' — no scan happens there).
 */
export function extractScanText(mode: KnownConflictsMode, root: ParentNode): string {
  if (mode === 'helpscout') return extractHelpScoutText(root);
  return extractWordPressPluginsText(root);
}
