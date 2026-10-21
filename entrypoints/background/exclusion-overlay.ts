/**
 * Opens the exclusion builder overlay in a tab: injects its runtime
 * content script into the tab's top frame. The overlay is not in the
 * manifest, so its code loads only when opened.
 *
 * Two ways in:
 * - an explicit open (context menu, panel) — a second injection replaces
 *   the running instance (the newer context invalidates the older), so
 *   opening twice is safe;
 * - a re-open on a session tab's newly loaded page — idempotent: a probe in
 *   the tab's isolated world first checks for a live overlay in that
 *   document (none is replaced), then leaves the presentation for the
 *   script injected next.
 */
import { OVERLAY_HOST_NAME } from '../../components/injected-ui/key-guard';
import { createLogger } from '../../lib/logger';
import type { ExclusionOverlayOpenOutcome } from '../../lib/messaging/exclusion-panel';
import {
  OVERLAY_PRESENTATION_GLOBAL,
  type OverlayPresentation
} from '../../lib/exclusion-session/overlay-reopen';

const log = createLogger('exclusion-overlay');

/** The overlay's built script (WXT emits runtime content scripts here). */
export const EXCLUSION_OVERLAY_SCRIPT = '/content-scripts/exclusion-overlay.js';

/** The two injections the opener performs, both into a tab's top frame. */
export interface ScriptInjector {
  /** Inject script files. */
  injectFiles(tabId: number, files: readonly string[]): Promise<void>;
  /**
   * Run a self-contained function with JSON arguments in the isolated
   * world; resolves with its result.
   */
  run(tabId: number, func: (...args: string[]) => boolean, args: string[]): Promise<unknown>;
}

/**
 * The injector over `browser.scripting` (both builds carry the `scripting`
 * permission; it acts only within the host permissions).
 */
export function browserScriptInjector(): ScriptInjector {
  return {
    injectFiles: async (tabId, files) => {
      await browser.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: [...files]
      });
    },
    run: async (tabId, func, args) => {
      const results = await browser.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func,
        args
      });
      return results[0]?.result;
    }
  };
}

/** Error words of a page the browser refuses to script (Chromium and Firefox wording). */
const UNSUPPORTED_PAGE_ERRORS = [
  'cannot access',
  'missing host permission',
  'cannot be scripted',
  'chrome://',
  'about:'
] as const;

/**
 * Classify an injection failure.
 *
 * @param cause What `executeScript` rejected with.
 */
export function classifyInjectionFailure(
  cause: unknown
): Exclude<ExclusionOverlayOpenOutcome, 'injected'> {
  // Case-insensitive: the engines word the same failures differently.
  const message = (cause instanceof Error ? cause.message : String(cause)).toLowerCase();
  if (/no tab with id|invalid tab id/.test(message)) return 'tab-gone';
  if (UNSUPPORTED_PAGE_ERRORS.some((words) => message.includes(words))) return 'unsupported-page';
  return 'failed';
}

/**
 * Log a failed injection: unexpected ones as errors, the expected (page
 * not scriptable, tab gone) as info.
 *
 * @param what The operation, for the line.
 * @param tabId The tab.
 * @param outcome The classified failure.
 * @param cause The rejection.
 */
function logFailure(
  what: string,
  tabId: number,
  outcome: Exclude<ExclusionOverlayOpenOutcome, 'injected'>,
  cause: unknown
): void {
  if (outcome === 'failed') {
    log.error(`${what} failed`, { tabId, cause: cause instanceof Error ? cause.message : cause });
  } else {
    log.info(`${what}: ${outcome}`, { tabId });
  }
}

/**
 * Open the overlay in a tab's top frame (replacing a running one).
 *
 * @param tabId The tab.
 * @param injector The scripting seam (the real `browser.scripting` by default).
 * @returns How it ended (never rejects).
 */
export async function openExclusionOverlay(
  tabId: number,
  injector: ScriptInjector = browserScriptInjector()
): Promise<ExclusionOverlayOpenOutcome> {
  try {
    await injector.injectFiles(tabId, [EXCLUSION_OVERLAY_SCRIPT]);
    return 'injected';
  } catch (cause) {
    const outcome = classifyInjectionFailure(cause);
    logFailure('Opening the exclusion builder', tabId, outcome, cause);
    return outcome;
  }
}

/**
 * The re-open probe, run in the tab's isolated world (serialized by the
 * browser: it must stay self-contained). A live overlay of this document
 * keeps its place; otherwise the presentation is left for the overlay
 * script injected next.
 *
 * @param hostName The overlay's shadow host tag name.
 * @param key The presentation global's name.
 * @param presentation The presentation to leave.
 * @returns Whether the document needs the overlay injected.
 */
export function prepareOverlayReopen(hostName: string, key: string, presentation: string): boolean {
  if (document.documentElement.querySelector(`:scope > ${hostName}`) !== null) return false;
  (globalThis as unknown as Record<string, unknown>)[key] = presentation;
  return true;
}

/**
 * How a re-open ended: `reopened` (injected), `already-open` (this
 * document still has its overlay), or an open failure.
 */
export type OverlayReopenOutcome =
  'reopened' | 'already-open' | Exclude<ExclusionOverlayOpenOutcome, 'injected'>;

/**
 * Re-open the overlay on a session tab's newly loaded page, unless that
 * document already shows it.
 *
 * @param tabId The tab.
 * @param presentation How the overlay starts.
 * @param injector The scripting seam (the real `browser.scripting` by default).
 * @returns How it ended (never rejects).
 */
export async function reopenExclusionOverlay(
  tabId: number,
  presentation: OverlayPresentation,
  injector: ScriptInjector = browserScriptInjector()
): Promise<OverlayReopenOutcome> {
  try {
    const needed = await injector.run(tabId, prepareOverlayReopen, [
      OVERLAY_HOST_NAME,
      OVERLAY_PRESENTATION_GLOBAL,
      presentation
    ]);
    if (needed !== true) return 'already-open';
    await injector.injectFiles(tabId, [EXCLUSION_OVERLAY_SCRIPT]);
    return 'reopened';
  } catch (cause) {
    const outcome = classifyInjectionFailure(cause);
    logFailure('Re-opening the exclusion builder', tabId, outcome, cause);
    return outcome;
  }
}
