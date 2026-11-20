/**
 * The data-sharing consent's message contract and its boundary guards
 * (Firefox only — Chromium has no data consent and never sends these):
 *
 * - `askDataConsent` (a tool → background): may the page address be sent?
 *   The background answers `granted`, or shows the consent page and answers
 *   `asking` (`failed` when it could not). Neither the DevTools panel nor a
 *   content script can call `permissions.request` in Firefox, so the
 *   question goes to the one extension page that can.
 * - `dataConsentAnswered` (consent page or background → every extension
 *   page, push): the user's answer — or, from the background, a consent tab
 *   closed unanswered (read as not allowed) — so a tool waiting on it
 *   carries on or shows the decline.
 */
import { hasOnlyKeys, isRecord, ownValue } from '../../utils/is-record';
import { isDataConsentFeature, type DataConsentFeature } from '../data-consent/consent';
import { isPageSpeedNext } from '../data-consent/consent-page-url';
import { numericTabId } from './sender';

/** How long (ms) a tool waits for the background's answer (a grant read and a tab open). */
export const DATA_CONSENT_ASK_DEADLINE_MS = 5_000;

/**
 * What a PageSpeed Insights ask wants:
 *
 * - `open-tab` — a site's top frame opens the analysis next to itself:
 *   once allowed the background opens `next` (a tab it creates is never
 *   popup-blocked); without the grant the consent page opens instead and
 *   goes on to `next` once allowed;
 * - `check` — the analysis page itself, before its comparison frames load:
 *   is it allowed? Nothing is shown either way (`granted` or `missing`);
 * - `ask-here` — the analysis page, on the user's click: this tab shows the
 *   consent page, which comes back to `next` once allowed.
 */
export type PageSpeedConsentMode = 'open-tab' | 'check' | 'ask-here';

/** Every {@link PageSpeedConsentMode} (the guard's table). */
const PAGESPEED_CONSENT_MODES: readonly PageSpeedConsentMode[] = ['open-tab', 'check', 'ask-here'];

/**
 * One tool's ask. The RUCSS Tester asks from the DevTools panel (no runtime
 * tab: it names the inspected tab, which the consent page opens next to);
 * PageSpeed Insights asks from the page's top frame (its tab is the
 * sender's) and names the analysis address to open or come back to.
 */
export type DataConsentAsk =
  | { readonly feature: 'rucss'; readonly tabId: number }
  | {
      readonly feature: 'pagespeed';
      readonly next: string;
      readonly mode: PageSpeedConsentMode;
    };

/** The background's answer to an ask. */
export interface DataConsentReply {
  /**
   * `granted`: go on (an `open-tab` ask: its analysis tab is open);
   * `asking`: the consent page shows; `missing`: not allowed, nothing shown
   * (a `check` ask only); `failed`: it could not be checked or asked (or
   * the analysis tab would not open) — nothing was sent.
   */
  readonly status: 'granted' | 'asking' | 'missing' | 'failed';
}

/** The user's answer on the consent page. */
export interface DataConsentAnswer {
  /** The tool the page was opened for. */
  readonly feature: DataConsentFeature;
  readonly granted: boolean;
}

/**
 * Guard an ask (exact shape: unknown fields are refused).
 *
 * @param data The boundary value.
 * @returns The ask, or null.
 */
export function parseDataConsentAsk(data: unknown): DataConsentAsk | null {
  if (!isRecord(data)) return null;
  const feature = ownValue(data, 'feature');
  if (feature === 'rucss') {
    const tabId = numericTabId(ownValue(data, 'tabId'));
    return hasOnlyKeys(data, ['feature', 'tabId']) && tabId !== null ? { feature, tabId } : null;
  }
  if (feature === 'pagespeed') {
    const next = ownValue(data, 'next');
    const mode = PAGESPEED_CONSENT_MODES.find((known) => known === ownValue(data, 'mode'));
    return hasOnlyKeys(data, ['feature', 'next', 'mode']) &&
      mode !== undefined &&
      typeof next === 'string' &&
      isPageSpeedNext(next)
      ? { feature, next, mode }
      : null;
  }
  return null;
}

/**
 * Guard the background's answer.
 *
 * @param data The boundary value.
 * @returns The reply, or null.
 */
export function parseDataConsentReply(data: unknown): DataConsentReply | null {
  if (!isRecord(data)) return null;
  const status = ownValue(data, 'status');
  return status === 'granted' || status === 'asking' || status === 'missing' || status === 'failed'
    ? { status }
    : null;
}

/**
 * Guard the consent page's answer push.
 *
 * @param data The boundary value.
 * @returns The answer, or null.
 */
export function parseDataConsentAnswer(data: unknown): DataConsentAnswer | null {
  if (!isRecord(data)) return null;
  const feature = ownValue(data, 'feature');
  const granted = ownValue(data, 'granted');
  return isDataConsentFeature(feature) && typeof granted === 'boolean'
    ? { feature, granted }
    : null;
}
