/**
 * The stylesheet inventory's page module (top frame): answers the panel's
 * `listPageStylesheets` with the page's styles as they are now, keeping
 * that answer's elements as its snapshot, and `getStyleSourceChunk` with an
 * inline style's CSS from the latest snapshot. Read-only; nothing is logged
 * about the page.
 */
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { onMessage } from '../../../lib/messaging';
import type { PageStylesheetsReply } from '../../../lib/messaging/page-stylesheets';
import { collectPageStylesheets } from './style-inventory';
import { createStyleSnapshots, type StyleSnapshots } from './style-snapshot';

/**
 * List the stylesheets and keep the answer as the latest snapshot.
 *
 * @param doc The page's document.
 * @param snapshots The snapshot store.
 * @returns The inventory, stamped with its snapshot id.
 */
export function listStylesheetSnapshot(
  doc: Document,
  snapshots: StyleSnapshots
): PageStylesheetsReply {
  const { reply, elements } = collectPageStylesheets(doc);
  return { ...reply, snapshotId: snapshots.take(elements) };
}

/**
 * Wire the module (registry row of the isolated world). Top frame only: the
 * Stylesheets page lists the page as a whole, as the RUCSS test does.
 *
 * @param ctx The content script's context; the handlers and the snapshot ride its lifetime.
 * @param snapshots The snapshot store (tests inject one to observe it).
 */
export function setupStylesheetInventory(
  ctx: ContentScriptContext,
  snapshots: StyleSnapshots = createStyleSnapshots()
): void {
  if (window !== window.top) return;
  ctx.onInvalidated(
    onMessage('listPageStylesheets', () => listStylesheetSnapshot(document, snapshots))
  );
  ctx.onInvalidated(onMessage('getStyleSourceChunk', ({ data }) => snapshots.read(data)));
  // A page going away (or into the back/forward cache) frees its elements.
  ctx.addEventListener(window, 'pagehide', snapshots.release);
  ctx.onInvalidated(snapshots.release);
}
