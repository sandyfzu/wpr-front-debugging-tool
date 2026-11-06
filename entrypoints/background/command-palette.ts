/**
 * The on-page command palette's background asks: inject the palette's view
 * (a runtime content script, never in the manifest — pages carry none of
 * its code until the first open) and open the exclusion builder overlay on
 * the asking page's own tab. Both answer only a top-frame http(s) sender
 * (the palette lives in the top frame only) and act on that sender's tab:
 * a content script can never aim either at another tab. The view load is
 * the shared top-frame injection answer (`./top-frame-injection`).
 */
import { createLogger } from '../../lib/logger';
import { onMessage } from '../../lib/messaging';
import type { ExclusionOverlayOpenOutcome } from '../../lib/messaging/exclusion-panel';
import { resolveTopFrameSender, type LooseMessageSender } from '../../lib/messaging/sender';
import { openExclusionOverlay } from './exclusion-overlay';
import {
  answerTopFrameInjection,
  injectAtTarget,
  type InjectScripts,
  type TopFrameInjectionAsk
} from './top-frame-injection';

const log = createLogger('command-palette');

/** The view's built script (WXT emits runtime content scripts here). */
export const COMMAND_PALETTE_VIEW_SCRIPT = '/content-scripts/command-palette.js';

/** The view load's identity for the shared top-frame injection answer. */
const VIEW_LOAD: TopFrameInjectionAsk = {
  row: 'loadCommandPaletteView',
  refusal: 'only a top-frame page may load the view',
  what: 'the command palette view',
  files: [COMMAND_PALETTE_VIEW_SCRIPT],
  log
};

/**
 * Answer a view load: inject the view into the sending document (or, where
 * the browser names none, the sender tab's top frame).
 *
 * @param sender The runtime sender.
 * @param inject Injects script files at a target.
 * @returns `true` once the script ran.
 * @throws {@link Error} for a sender that is not a top-frame http(s) page;
 *   an injection failure rejects as the scripting API does (logged).
 */
export function answerPaletteViewLoad(
  sender: LooseMessageSender | undefined,
  inject: InjectScripts
): Promise<true> {
  return answerTopFrameInjection(sender, VIEW_LOAD, inject);
}

/**
 * Answer a builder open for the sender's own tab.
 *
 * @param sender The runtime sender.
 * @param open The overlay opener (never rejects).
 * @returns How the open ended.
 * @throws {@link Error} for a sender that is not a top-frame http(s) page.
 */
export function answerBuilderOpenOnSenderTab(
  sender: LooseMessageSender | undefined,
  open: (tabId: number) => Promise<ExclusionOverlayOpenOutcome>
): Promise<ExclusionOverlayOpenOutcome> {
  const page = resolveTopFrameSender(sender);
  if (page === null) {
    return Promise.reject(
      new Error('openExclusionOverlayOnSenderTab: only a top-frame page may open the builder')
    );
  }
  return open(page.tabId);
}

/** Register the two channels (once per background start). */
export function registerCommandPalette(): void {
  onMessage('loadCommandPaletteView', ({ sender }) =>
    answerPaletteViewLoad(sender, injectAtTarget)
  );
  onMessage('openExclusionOverlayOnSenderTab', ({ sender }) =>
    answerBuilderOpenOnSenderTab(sender, (tabId) => openExclusionOverlay(tabId))
  );
}
