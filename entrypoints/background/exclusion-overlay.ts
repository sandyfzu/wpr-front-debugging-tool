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
 *
 * Both first consult the on-page UI gate: while it is off nothing is
 * injected (an explicit open answers `page-ui-off`; the overlay checks the
 * gate again itself before mounting, for a write racing the injection).
 */
import { createLogger } from '../../lib/logger';
import type { ExclusionOverlayOpenOutcome } from '../../lib/messaging/exclusion-panel';
import type { OverlayPresentation } from '../../lib/exclusion-session/overlay-reopen';
import { readPageUiEnabled } from '../../lib/storage/page-ui-gate';
import {
  OVERLAY_CLAIM_TTL_MS,
  OVERLAY_SLOT_GLOBAL,
  claimOverlaySlot,
  parseOverlaySlotVerdict,
  releaseOverlayClaim,
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
  /** Release this open's claim in the page (its injection failed). */
  release(tabId: number, token: string): Promise<unknown>;
  /** A fresh token per open. */
  newToken(): string;
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
    },
    release: async (tabId, token) => {
      const results = await browser.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: releaseOverlayClaim,
        args: [OVERLAY_SLOT_GLOBAL, token]
      });
      return results[0]?.result;
    },
    newToken: () => crypto.randomUUID()
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

/** Reads the on-page UI gate (validated; rejects as storage does). */
export type PageUiGateRead = () => Promise<boolean>;

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
 * Inject the overlay for a claimed slot; when the injection fails, release
 * the claim (best effort — the page may be gone) so the next open is not
 * held up for the claim's time-to-live, then rethrow.
 *
 * @param injector The scripting seam.
 * @param tabId The tab.
 * @param token The claim's token.
 */
async function injectClaimed(
  injector: ScriptInjector,
  tabId: number,
  token: string
): Promise<void> {
  try {
    await injector.injectFiles(tabId, [EXCLUSION_OVERLAY_SCRIPT]);
  } catch (cause) {
    await injector.release(tabId, token).catch((releaseCause: unknown) => {
      log.debug('Overlay claim not released (the page is gone)', { tabId, releaseCause });
    });
    throw cause;
  }
}

/**
 * Open the overlay in a tab's top frame: reveal a live one, else inject.
 *
 * @param tabId The tab.
 * @param injector The scripting seam (the real `browser.scripting` by default).
 * @param pageUiEnabled The on-page UI gate's read (the stored gate by default).
 * @returns How it ended (never rejects).
 */
export async function openExclusionOverlay(
  tabId: number,
  injector: ScriptInjector = browserScriptInjector(),
  pageUiEnabled: PageUiGateRead = readPageUiEnabled
): Promise<ExclusionOverlayOpenOutcome> {
  try {
    if (!(await pageUiEnabled())) {
      log.info('Exclusion builder not opened: on-page UI is off', { tabId });
      return 'page-ui-off';
    }
    const token = injector.newToken();
    const verdict = await claimSlot(injector, tabId, {
      mode: 'open',
      presentation: null,
      origin: null,
      claimTtlMs: OVERLAY_CLAIM_TTL_MS,
      token
    });
    switch (verdict) {
      case 'inject':
        await injectClaimed(injector, tabId, token);
        return 'injected';
      // Only a live instance that unfolded counts as shown.
      case 'revealed':
        return 'revealed';
      // An injection is on its way (now starting open and focused).
      case 'pending':
        return 'injected';
      // An explicit open never gets `live` (it reveals) nor `other-origin`
      // (it names no origin): a page answering so is not trusted.
      case 'live':
      case 'other-origin':
        log.warn('The overlay slot probe answered out of turn', { tabId, verdict });
        return 'failed';
      case 'not-html':
        log.info('Exclusion builder not opened: the page is not an HTML page', { tabId });
        return 'not-html';
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
 * to another origin, or is not HTML), `page-ui-off` (the on-page UI gate
 * is off: the session goes on, its overlay comes back on a gate-on), or an
 * open failure.
 */
export type OverlayReopenOutcome =
  'reopened' | 'already-open' | 'skipped' | 'page-ui-off' | OpenFailure;

/**
 * Re-open the overlay on a session tab's newly loaded page, unless that
 * document already shows it (or will).
 *
 * @param tabId The tab.
 * @param presentation How the overlay starts.
 * @param origin The session's origin (the page must still be of it).
 * @param injector The scripting seam (the real `browser.scripting` by default).
 * @param pageUiEnabled The on-page UI gate's read (the stored gate by default).
 * @returns How it ended (never rejects).
 */
export async function reopenExclusionOverlay(
  tabId: number,
  presentation: OverlayPresentation,
  origin: string,
  injector: ScriptInjector = browserScriptInjector(),
  pageUiEnabled: PageUiGateRead = readPageUiEnabled
): Promise<OverlayReopenOutcome> {
  try {
    if (!(await pageUiEnabled())) return 'page-ui-off';
    const token = injector.newToken();
    const verdict = await claimSlot(injector, tabId, {
      mode: 'reopen',
      presentation,
      origin,
      claimTtlMs: OVERLAY_CLAIM_TTL_MS,
      token
    });
    switch (verdict) {
      case 'inject':
        await injectClaimed(injector, tabId, token);
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
