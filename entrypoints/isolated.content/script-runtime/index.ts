/**
 * The live script states' page module (top frame): answers the panel's
 * `getScriptRuntimeStatuses` with a fresh read of the live DOM. No on-page
 * trigger: the panel is the only way in.
 */
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { onMessage } from '../../../lib/messaging';
import { readLiveScripts } from './read';

/**
 * Wire the module (registry row of the isolated world). Top frame only:
 * the read describes the page's own document.
 *
 * @param ctx The content script's context; the handler rides its lifetime.
 */
export function setupScriptRuntime(ctx: ContentScriptContext): void {
  if (window !== window.top) return;
  ctx.onInvalidated(onMessage('getScriptRuntimeStatuses', () => readLiveScripts(document)));
}
