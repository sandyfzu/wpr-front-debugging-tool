/**
 * The on-page command palette's always-loaded half (top frame only): the
 * gate follower, the open triggers (the `openCommandPalette` receiver and
 * the keyboard chord), the executors and the page notices. The palette's view — the combobox and its dialog — is a
 * runtime content script the background injects on the first open
 * (`entrypoints/command-palette.content`), so a page that never opens the
 * palette pays only this module: one storage read, one watch and one
 * message listener — plus, while the gate is on, the chord's read, watch,
 * one platform ask and one window keydown listener (the content script's
 * key guard covers the view's host).
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
import { navigatorChordPlatform } from '../../../lib/palette-chord/follow';
import { readPageUiEnabled, watchPageUiGate } from '../../../lib/storage/page-ui-gate';
import { readPaletteChord, watchPaletteChord } from '../../../lib/storage/palette-chord';
import {
  STORAGE_MECHANISMS,
  createPageCommandExecutors
} from '../../../lib/page-commands/executors';
import { WINDOW_TIMERS, contextScheduler } from '../../../utils/context-timers';
import { startChordTrigger } from './chord';
import { startPaletteModule } from './module';
import { pageNoticeHost } from './notice';
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
  const chord = startChordTrigger({
    target: window,
    readChord: readPaletteChord,
    watchChord: watchPaletteChord,
    isLive: () => !ctx.isInvalid,
    askPlatform: () => sendMessage('getChordPlatform'),
    fallbackPlatform: () => navigatorChordPlatform(navigator),
    schedule: contextScheduler(ctx, WINDOW_TIMERS),
    onInvalidated: (cleanup) => {
      ctx.onInvalidated(cleanup);
    },
    log
  });
  startPaletteModule({
    watchGate: watchPageUiGate,
    readGate: readPageUiEnabled,
    listenForOpen: (onOpen) => {
      const disarmChord = chord.arm(onOpen);
      let removeReceiver: () => void;
      try {
        removeReceiver = onMessage('openCommandPalette', (): true => {
          onOpen();
          return true;
        });
      } catch (cause) {
        // Both triggers or neither: the module logs the failed arm.
        disarmChord();
        throw cause;
      }
      return () => {
        disarmChord();
        removeReceiver();
      };
    },
    loadView: () => sendMessage('loadCommandPaletteView'),
    executors,
    page: () => ({ origin: window.location.origin }),
    notices: pageNoticeHost(ctx, log),
    // The extension's isolated world: the injected view finds the bridge here.
    world: globalThis,
    chordHint: () => chord.hint(),
    isInvalid: () => ctx.isInvalid,
    onInvalidated: (cleanup) => {
      ctx.onInvalidated(cleanup);
    },
    log
  });
}
