/**
 * The on-page command palette's background asks: inject the palette's view
 * (a runtime content script, never in the manifest — pages carry none of
 * its code until the first open) and open the exclusion builder overlay on
 * the asking page's own tab. Both answer only a top-frame http(s) sender
 * (the palette lives in the top frame only) and act on that sender's tab:
 * a content script can never aim either at another tab. Where the browser
 * names the sending document, the view goes into that document only — a
 * page that navigated meanwhile gets nothing (the injection rejects).
 */
import { createLogger } from '../../lib/logger';
import { onMessage } from '../../lib/messaging';
import type { ExclusionOverlayOpenOutcome } from '../../lib/messaging/exclusion-panel';
import {
  resolveSenderDocumentId,
  resolveTopFrameSender,
  type LooseMessageSender
} from '../../lib/messaging/sender';
import { openExclusionOverlay } from './exclusion-overlay';

const log = createLogger('command-palette');

/** The view's built script (WXT emits runtime content scripts here). */
export const COMMAND_PALETTE_VIEW_SCRIPT = '/content-scripts/command-palette.js';

/** Where the view goes: the sender's own document when known, else its tab's top frame. */
export interface PaletteViewTarget {
  readonly tabId: number;
  /** The sending document (null: the browser names none — the top frame then). */
  readonly documentId: string | null;
}

/**
 * Inject script files at a view target through `browser.scripting`.
 *
 * @param target The tab, and the document when known.
 * @param files The built scripts.
 */
async function injectAtTarget(target: PaletteViewTarget, files: readonly string[]): Promise<void> {
  await browser.scripting.executeScript({
    target:
      target.documentId === null
        ? { tabId: target.tabId, frameIds: [0] }
        : { tabId: target.tabId, documentIds: [target.documentId] },
    files: [...files]
  });
}

/**
 * Answer a view load: inject the view into the sending document (or, where
 * the browser names none, the sender tab's top frame).
 *
 * @param sender The runtime sender.
 * @param inject Injects script files at a target.
 * @returns `true` once the script ran.
 * @throws {@link Error} for a sender that is not a top-frame http(s) page;
 *   an injection failure rejects as the scripting API does (logged here).
 */
export async function answerPaletteViewLoad(
  sender: LooseMessageSender | undefined,
  inject: (target: PaletteViewTarget, files: readonly string[]) => Promise<void>
): Promise<true> {
  const page = resolveTopFrameSender(sender);
  if (page === null) {
    throw new Error('loadCommandPaletteView: only a top-frame page may load the view');
  }
  const target: PaletteViewTarget = {
    tabId: page.tabId,
    documentId: resolveSenderDocumentId(sender)
  };
  try {
    await inject(target, [COMMAND_PALETTE_VIEW_SCRIPT]);
  } catch (cause) {
    log.error('Injecting the command palette view failed', {
      tabId: page.tabId,
      cause: cause instanceof Error ? cause.message : cause
    });
    throw cause;
  }
  return true;
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
