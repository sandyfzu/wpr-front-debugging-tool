/**
 * Option-gated admin-bar improvement: when enabled, a "WPR D-bugger" entry is
 * appended to WP Rocket's admin-bar group so support staff reach the plugin
 * debugging tool from any wp-admin page.
 *
 * One-shot by design: the option is read once, the node is appended once
 * (`load`-gated), and nothing listens afterwards. The anchor's link never
 * hardcodes the root-relative admin path blindly — that link 404s on
 * subdirectory WordPress installs — so the admin base is derived from WP
 * Rocket's own admin-bar link whenever that link exposes one, and parity's
 * root-relative shape ships otherwise (recorded limitation, not a silent one:
 * when WP Rocket renders no usable href, a subdirectory install gets the
 * root-relative link exactly like every other install).
 */

import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { DBUGGER_ENTRY_LABEL } from '../../lib/options/dbugger-entry';
import { getOptions } from '../../lib/storage/options';
import { createLogger } from '../../lib/logger';

const log = createLogger('improvements');

/** Id of the admin-bar list item this module owns; presence = already added. */
export const DBUGGER_ITEM_ID = 'wp-admin-bar-d-bugger';

/** WP Rocket's admin-bar group the entry attaches to. */
const WP_ROCKET_BAR_GROUP_SELECTOR = '#wp-admin-bar-wp-rocket-default';

/** The D-bugger page's query, relative to any WordPress admin base. */
const DBUGGER_ADMIN_PATH = 'tools.php?page=wprockettoolset';

/** The admin segment that separates a site's base from everything after it. */
const ADMIN_SEGMENT = '/wp-admin/';

/**
 * Derive the D-bugger link's href from a WP Rocket admin-bar anchor's own
 * href. Anything before the first `/wp-admin/` is the install's web root
 * (including subdirectories); the link starts with a host-relative `/...` —
 * never a foreign scheme or a protocol-relative authority, because a
 * page-controlled attribute value is untrusted and only path-prefixed or
 * validated-HTTP values may become our href.
 *
 * @param rocketLinkHref The `href` attribute of the admin-bar anchor (or
 *   `null` when none exists / is unusable).
 * @returns The derived href, or the root-relative parity link.
 */
export function deriveDbuggerHref(rocketLinkHref: string | null | undefined): string {
  const fallback = `/${ADMIN_SEGMENT.slice(1)}${DBUGGER_ADMIN_PATH}`;
  if (typeof rocketLinkHref !== 'string') return fallback;
  const href = rocketLinkHref.trim();
  const absolute = /^https?:\/\//i.test(href);
  // A second slash makes the value a protocol-relative authority (`//host/…`)
  // — a network path, never a path of this install: a page-controlled host
  // hint must not turn our href into a foreign-origin link.
  const rooted = href.startsWith('/') && !href.startsWith('//');
  if (!absolute && !rooted) return fallback;
  const adminIndex = href.indexOf(ADMIN_SEGMENT);
  if (adminIndex < 0) return fallback;
  if (absolute) {
    // Only well-formed HTTP(S) URLs may ride into our href; a validated
    // absolute base keeps the derived link same-trust as the source anchor.
    try {
      const parsed = new URL(href);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallback;
    } catch {
      return fallback;
    }
  }
  return `${href.slice(0, adminIndex + ADMIN_SEGMENT.length)}${DBUGGER_ADMIN_PATH}`;
}

/**
 * Append the D-bugger entry to WP Rocket's admin bar. Idempotent and
 * read-only everywhere else: an existing entry or a missing bar skips the
 * work; DOM operations are wrapped so a malformed admin bar can never break
 * the host page's own scripts.
 *
 * @param document The live admin-page document.
 */
export function appendDbuggerEntry(doc: Document): void {
  try {
    if (doc.getElementById(DBUGGER_ITEM_ID) !== null) return;
    const rocketGroup = doc.querySelector(WP_ROCKET_BAR_GROUP_SELECTOR);
    if (rocketGroup === null) return;
    const item = doc.createElement('li');
    item.id = DBUGGER_ITEM_ID;
    const link = doc.createElement('a');
    link.className = 'ab-item';
    link.href = deriveDbuggerHref(rocketGroup.querySelector('a')?.getAttribute('href') ?? null);
    link.textContent = DBUGGER_ENTRY_LABEL;
    item.appendChild(link);
    rocketGroup.appendChild(item);
  } catch (error) {
    log.error(
      'Appending the admin-bar entry failed',
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * Wire the improvement into this content script: read the option once and
 * append on `load` (guarded for late injection, where `load` has already
 * fired). No listeners to clean beyond the context-managed one.
 *
 * @param ctx The content script's context.
 */
export function setupImprovements(ctx: ContentScriptContext): void {
  void getOptions()
    .then((options) => {
      if (!options.improvements['wp-dashboard-dbugger-entry']) return;
      if (ctx.isInvalid) return;
      if (document.readyState === 'complete') {
        // Late injection: `load` will never fire again — run immediately.
        appendDbuggerEntry(document);
        return;
      }
      ctx.addEventListener(window, 'load', () => {
        if (ctx.isInvalid) return;
        appendDbuggerEntry(document);
      });
    })
    .catch((error: unknown) => {
      // Options storage unavailable: the improvement degrades silently, at a
      // debug level, and no page work fails because of it.
      log.debug(
        'Reading the improvement options failed — entry skipped',
        error instanceof Error ? error.message : error
      );
    });
}
