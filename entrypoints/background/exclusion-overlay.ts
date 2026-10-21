/**
 * Opens the exclusion builder overlay in a tab: injects its runtime
 * content script into the tab's top frame. The overlay is not in the
 * manifest, so its code loads only when opened; a second injection
 * replaces the running instance (the newer context invalidates the older),
 * so opening twice is safe.
 */
import { createLogger } from '../../lib/logger';

const log = createLogger('exclusion-overlay');

/** The overlay's built script (WXT emits runtime content scripts here). */
export const EXCLUSION_OVERLAY_SCRIPT = '/content-scripts/exclusion-overlay.js';

/** The injection call the opener needs (`browser.scripting` satisfies it). */
export interface ScriptInjector {
  executeScript(injection: {
    target: { tabId: number; frameIds: number[] };
    files: string[];
  }): Promise<unknown>;
}

/**
 * How an open ended.
 *
 * - `opened` — the overlay script was injected.
 * - `unsupported-page` — the browser does not let extensions script this
 *   page (browser pages, the web store, a page outside the host
 *   permissions).
 * - `tab-gone` — the tab closed first.
 * - `failed` — anything else (logged).
 */
export type OverlayOpenOutcome = 'opened' | 'unsupported-page' | 'tab-gone' | 'failed';

/** Error words of a page the browser refuses to script (Chromium and Firefox wording). */
const UNSUPPORTED_PAGE_ERRORS = [
  'Cannot access',
  'Missing host permission',
  'cannot be scripted',
  'chrome://',
  'about:'
] as const;

/**
 * Classify an injection failure.
 *
 * @param cause What `executeScript` rejected with.
 */
export function classifyInjectionFailure(cause: unknown): Exclude<OverlayOpenOutcome, 'opened'> {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/No tab with id|Invalid tab ID/i.test(message)) return 'tab-gone';
  if (UNSUPPORTED_PAGE_ERRORS.some((words) => message.includes(words))) return 'unsupported-page';
  return 'failed';
}

/**
 * Open the overlay in a tab's top frame.
 *
 * @param tabId The tab.
 * @param injector The scripting API (the real `browser.scripting` by default).
 * @returns How it ended (never rejects).
 */
export async function openExclusionOverlay(
  tabId: number,
  injector: ScriptInjector = browser.scripting
): Promise<OverlayOpenOutcome> {
  try {
    await injector.executeScript({
      target: { tabId, frameIds: [0] },
      files: [EXCLUSION_OVERLAY_SCRIPT]
    });
    return 'opened';
  } catch (cause) {
    const outcome = classifyInjectionFailure(cause);
    if (outcome === 'failed') {
      log.error('Opening the exclusion builder failed', {
        tabId,
        cause: cause instanceof Error ? cause.message : cause
      });
    } else {
      log.info(`Exclusion builder not opened: ${outcome}`, { tabId });
    }
    return outcome;
  }
}
