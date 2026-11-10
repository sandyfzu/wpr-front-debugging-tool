/**
 * The stylesheet inventory's page module (top frame): answers the panel's
 * `listPageStylesheets` with the page's styles as they are now. Read-only;
 * nothing is logged about the page.
 */
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { onMessage } from '../../../lib/messaging';
import { collectPageStylesheets } from './style-inventory';

/**
 * Wire the module (registry row of the isolated world). Top frame only: the
 * Stylesheets page lists the page as a whole, as the RUCSS test does.
 *
 * @param ctx The content script's context; the handler rides its lifetime.
 */
export function setupStylesheetInventory(ctx: ContentScriptContext): void {
  if (window !== window.top) return;
  ctx.onInvalidated(onMessage('listPageStylesheets', () => collectPageStylesheets(document)));
}
