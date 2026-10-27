/**
 * The on-page command palette's always-loaded half (top frame only): the
 * gate follower, the `openCommandPalette` receiver, the executors and the
 * page notices. The palette's view — the combobox and its dialog — is a
 * runtime content script the background injects on the first open
 * (`entrypoints/command-palette.content`), so a page that never opens the
 * palette pays only this module: one storage read, one watch, one message
 * listener and a key guard.
 *
 * The palette dies with the on-page UI gate: a gate-off write (from the
 * palette's own row, the menu or the options page) disposes the view,
 * removes the receiver and leaves one notice naming the way back; a
 * gate-on write re-arms the receiver.
 */
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createLogger } from '../../../lib/logger';
import { onMessage, sendMessage } from '../../../lib/messaging';
import { parseExclusionOverlayOpenOutcome } from '../../../lib/messaging/exclusion-panel';
import { readPageUiEnabled, watchPageUiGate } from '../../../lib/storage/page-ui-gate';
import {
  STORAGE_MECHANISMS,
  createPageCommandExecutors
} from '../../../lib/page-commands/executors';
import { isPsiHost } from '../../../lib/side-by-side/analysis-host';
import {
  COMMAND_PALETTE_HOST_NAME,
  installKeyGuard
} from '../../../components/injected-ui/key-guard';
import { startPaletteModule } from './module';
import { createNoticeHost } from './notice';
import { sideBySideTriggers } from './side-by-side-triggers';

const log = createLogger('command-palette');

/**
 * Wire the palette module into this content script (top frame only — the
 * palette acts on the page as a whole).
 *
 * @param ctx The content script's context; everything registers through it.
 */
export function setupCommandPalette(ctx: ContentScriptContext): void {
  if (window.top !== window) return;
  // At document_start, before the page's own listeners: keys typed into the
  // palette's field never reach the page's window-capture shortcuts.
  installKeyGuard(window, COMMAND_PALETTE_HOST_NAME, ctx.signal);
  const executors = createPageCommandExecutors({
    ...STORAGE_MECHANISMS,
    openSideBySide: () => sideBySideTriggers().open(),
    openSideBySidePerformance: () => {
      sideBySideTriggers().openPerformance();
    },
    openExclusionBuilder: async () => {
      try {
        const reply = await sendMessage('openExclusionOverlayOnSenderTab');
        return parseExclusionOverlayOpenOutcome(reply) ?? 'failed';
      } catch (cause) {
        log.error('Asking for the exclusion builder failed', cause);
        return 'failed';
      }
    }
  });
  startPaletteModule({
    watchGate: watchPageUiGate,
    readGate: readPageUiEnabled,
    listenForOpen: (onOpen) =>
      onMessage('openCommandPalette', (): true => {
        onOpen();
        return true;
      }),
    loadView: () => sendMessage('loadCommandPaletteView'),
    executors,
    facts: () => ({ analysisHost: isPsiHost(new URL(window.location.href)) }),
    page: () => ({ origin: window.location.origin }),
    notices: createNoticeHost(ctx, log),
    // The extension's isolated world: the injected view finds the bridge here.
    world: globalThis,
    isInvalid: () => ctx.isInvalid,
    onInvalidated: (cleanup) => {
      ctx.onInvalidated(cleanup);
    },
    log
  });
}
