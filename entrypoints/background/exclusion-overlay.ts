/**
 * Opens the exclusion builder overlay in a tab: injects its runtime
 * content script into the tab's top frame. The overlay is not in the
 * manifest, so its code loads only when opened.
 *
 * Every open first claims the overlay's slot in the page
 * (`lib/exclusion-session/overlay-slot`: one synchronous step in the
 * extension's isolated world), so one document never gets two overlays:
 * - an explicit open (context menu, panel) reveals a live overlay (never
 *   replaces it) and injects only when there is none;
 * - a re-open on a session tab's newly loaded page leaves a live or pending
 *   overlay be, and skips a page that moved to another origin or is not
 *   HTML.
 */
import { createLogger } from '../../lib/logger';
import type { ExclusionOverlayOpenOutcome } from '../../lib/messaging/exclusion-panel';
import type { OverlayPresentation } from '../../lib/exclusion-session/overlay-reopen';
import {
  OVERLAY_CLAIM_TTL_MS,
  OVERLAY_SLOT_GLOBAL,
  claimOverlaySlot,
  parseOverlaySlotVerdict,
  type OverlaySlotRequest,
  type OverlaySlotVerdict
} from '../../lib/exclusion-session/overlay-slot';

const log = createLogger('exclusion-overlay');

/** The overlay's built script (WXT emits runtime content scripts here). */
export const EXCLUSION_OVERLAY_SCRIPT = '/content-scripts/exclusion-overlay.js';

/** The two injections the opener performs, both into a tab's top frame. */
export interface ScriptInjector {
  /** Inject script files. */
  injectFiles(tabId: number, files: readonly string[]): Promise<void>;
  /** Claim the overlay's slot in the page; resolves with what the page answered. */
  claim(tabId: number, request: OverlaySlotRequest): Promise<unknown>;
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
    claim: async (tabId, request) => {
      const results = await browser.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: claimOverlaySlot,
        args: [OVERLAY_SLOT_GLOBAL, request]
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

/** An open that did not reach the page. */
type OpenFailure = 'unsupported-page' | 'tab-gone' | 'failed';

/**
 * Classify an injection failure.
 *
 * @param cause What `executeScript` rejected with.
 */
export function classifyInjectionFailure(cause: unknown): OpenFailure {
  // Case-insensitive: the engines word the same failures differently.
  const message = (cause instanceof Error ? cause.message : String(cause)).toLowerCase();
  if (/no tab with id|invalid tab id/.test(message)) return 'tab-gone';
  if (UNSUPPORTED_PAGE_ERRORS.some((words) => message.includes(words))) return 'unsupported-page';
  return 'failed';
}

/**
 * Log a failed open: unexpected ones as errors, the expected (page not
 * scriptable, tab gone) as info.
 *
 * @param what The operation, for the line.
 * @param tabId The tab.
 * @param outcome The classified failure.
 * @param cause The rejection.
 */
function logFailure(what: string, tabId: number, outcome: OpenFailure, cause: unknown): void {
  if (outcome === 'failed') {
    log.error(`${what} failed`, { tabId, cause: cause instanceof Error ? cause.message : cause });
  } else {
    log.info(`${what}: ${outcome}`, { tabId });
  }
}

/**
 * Claim the slot and narrow the answer; an answer that is no verdict (a
 * probe that threw, an engine's error object) is a failure, logged.
 *
 * @param injector The scripting seam.
 * @param tabId The tab.
 * @param request The open.
 * @returns The verdict, or null for an unusable answer.
 */
async function claimSlot(
  injector: ScriptInjector,
  tabId: number,
  request: OverlaySlotRequest
): Promise<OverlaySlotVerdict | null> {
  const answer = await injector.claim(tabId, request);
  const verdict = parseOverlaySlotVerdict(answer);
  if (verdict === null) {
    log.warn('The overlay slot probe gave no usable answer', { tabId, answer });
  }
  return verdict;
}

/**
 * Open the overlay in a tab's top frame: reveal a live one, else inject.
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
    const verdict = await claimSlot(injector, tabId, {
      mode: 'open',
      presentation: null,
      origin: null,
      claimTtlMs: OVERLAY_CLAIM_TTL_MS
    });
    switch (verdict) {
      case 'inject':
        await injector.injectFiles(tabId, [EXCLUSION_OVERLAY_SCRIPT]);
        return 'injected';
      // An explicit open never answers `live` (it reveals); counted as shown.
      case 'revealed':
      case 'pending':
      case 'live':
        return 'revealed';
      case 'not-html':
      case 'other-origin':
        log.info('Exclusion builder not opened: the page is not an HTML page', { tabId });
        return 'unsupported-page';
      case null:
        return 'failed';
    }
  } catch (cause) {
    const outcome = classifyInjectionFailure(cause);
    logFailure('Opening the exclusion builder', tabId, outcome, cause);
    return outcome;
  }
}

/**
 * How a re-open ended: `reopened` (injected), `already-open` (the
 * document has its overlay, or one on its way), `skipped` (the page moved
 * to another origin, or is not HTML), or an open failure.
 */
export type OverlayReopenOutcome = 'reopened' | 'already-open' | 'skipped' | OpenFailure;

/**
 * Re-open the overlay on a session tab's newly loaded page, unless that
 * document already shows it (or will).
 *
 * @param tabId The tab.
 * @param presentation How the overlay starts.
 * @param origin The session's origin (the page must still be of it).
 * @param injector The scripting seam (the real `browser.scripting` by default).
 * @returns How it ended (never rejects).
 */
export async function reopenExclusionOverlay(
  tabId: number,
  presentation: OverlayPresentation,
  origin: string,
  injector: ScriptInjector = browserScriptInjector()
): Promise<OverlayReopenOutcome> {
  try {
    const verdict = await claimSlot(injector, tabId, {
      mode: 'reopen',
      presentation,
      origin,
      claimTtlMs: OVERLAY_CLAIM_TTL_MS
    });
    switch (verdict) {
      case 'inject':
        await injector.injectFiles(tabId, [EXCLUSION_OVERLAY_SCRIPT]);
        return 'reopened';
      case 'live':
      case 'pending':
      case 'revealed':
        return 'already-open';
      case 'other-origin':
      case 'not-html':
        return 'skipped';
      case null:
        return 'failed';
    }
  } catch (cause) {
    const outcome = classifyInjectionFailure(cause);
    logFailure('Re-opening the exclusion builder', tabId, outcome, cause);
    return outcome;
  }
}
