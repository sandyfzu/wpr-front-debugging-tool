/**
 * Firefox only — the PageSpeed Insights flows' data consent (the analyses
 * carry the page's address to pagespeed.web.dev). Content scripts have no
 * `permissions` API in Firefox, so every step asks the background:
 *
 * - {@link openPerformanceWithConsent} (a site's menu or palette command):
 *   the background opens the analysis tab once allowed, or the consent page
 *   that goes on to it;
 * - {@link checkAnalysisConsent} (the analysis page, before its comparison
 *   frames load): nothing loads until allowed; without the grant a notice
 *   asks, and its Allow shows the consent page in this tab
 *   ({@link askConsentHere}), which comes back here once allowed;
 * - {@link reloadAfterConsent} (a frame reload on the open analysis page):
 *   checked again, so a grant revoked since the open reloads nothing;
 * - {@link restoredPageNeedsCheck}: Back to the analysis page (restored from
 *   the back/forward cache, e.g. from an unanswered consent page) asks again.
 *
 * Every miss (no answer, a failed ask) shows a notice naming the cause,
 * with Try again — a click never ends in nothing. Chromium has no data
 * consent: its build never imports this module.
 */
import { DATA_CONSENT_FEATURES } from '../../../lib/data-consent/consent';
import type { Logger } from '../../../lib/logger';
import { boundedAsk, logAskMiss, type AskOutcome } from '../../../lib/messaging/bounded-ask';
import {
  DATA_CONSENT_ASK_DEADLINE_MS,
  parseDataConsentReply,
  type DataConsentReply,
  type PageSpeedConsentMode
} from '../../../lib/messaging/data-consent';
import type { PageNotice } from '../palette/notice';

/** The notices' words, verbatim (sentence case). */
export const PERFORMANCE_CONSENT_WORDS = {
  openFailedTitle: "PageSpeed Insights didn't open",
  framesFailedTitle: "The PageSpeed Insights comparison didn't load",
  askTitle: 'Allow sending the page address?',
  askBody: `${DATA_CONSENT_FEATURES.pagespeed.sends} The two analyses load once you allow it.`,
  allow: 'Allow…',
  retry: 'Try again',
  /** The background answered: it could not check or ask (or open the tab). */
  failedBody:
    "Firefox couldn't be asked for permission to send the page address, or the tab didn't open. Nothing was sent.",
  /** The background did not answer usably. */
  unreachableBody:
    "The extension didn't answer (it may have just been updated). Reload the page if this keeps happening. Nothing was sent."
} as const;

/** What the steps run against (production: the messenger and the page notice). */
export interface PerformanceConsentDeps {
  /** Ask the background with the analysis address and the mode. */
  readonly ask: (next: string, mode: PageSpeedConsentMode) => Promise<unknown>;
  /** Show the page notice (replacing the shown one). */
  readonly notify: (notice: PageNotice) => void;
  readonly log: Logger;
}

/**
 * The notice for an ask that ended in nothing.
 *
 * @param title What did not happen.
 * @param outcome The ask's outcome (a miss, or a `failed`/`missing` reply).
 * @param retry Try again.
 */
export function missNotice(
  title: string,
  outcome: AskOutcome<DataConsentReply>,
  retry: () => void
): PageNotice {
  const body =
    outcome.kind === 'reply'
      ? PERFORMANCE_CONSENT_WORDS.failedBody
      : PERFORMANCE_CONSENT_WORDS.unreachableBody;
  return { title, body, action: { label: PERFORMANCE_CONSENT_WORDS.retry, run: retry } };
}

/**
 * Ask the background once.
 *
 * @param next The analysis address.
 * @param mode What the ask wants.
 * @param deps See {@link PerformanceConsentDeps}.
 */
async function ask(
  next: string,
  mode: PageSpeedConsentMode,
  deps: PerformanceConsentDeps
): Promise<AskOutcome<DataConsentReply>> {
  const outcome = await boundedAsk({
    send: () => deps.ask(next, mode),
    parse: parseDataConsentReply,
    timeoutMs: DATA_CONSENT_ASK_DEADLINE_MS
  });
  if (outcome.kind !== 'reply')
    logAskMiss(deps.log, `PageSpeed Insights consent ask (${mode})`, outcome);
  else if (outcome.reply.status === 'failed') {
    deps.log.warn(`PageSpeed Insights consent ask (${mode}): the background could not answer it`);
  }
  return outcome;
}

/**
 * Open the analysis tab for a site (the background opens it once allowed,
 * or shows the consent page that goes on to it). Never rejects.
 *
 * @param entryUrl The PageSpeed Insights entry address for this page.
 * @param retry Try again (the flow's own entry).
 * @param deps See {@link PerformanceConsentDeps}.
 */
export async function openPerformanceWithConsent(
  entryUrl: string,
  retry: () => void,
  deps: PerformanceConsentDeps
): Promise<void> {
  const outcome = await ask(entryUrl, 'open-tab', deps);
  if (outcome.kind === 'reply') {
    const { status } = outcome.reply;
    // The analysis tab, or the consent page, is open.
    if (status === 'granted' || status === 'asking') return;
  }
  deps.notify(missNotice(PERFORMANCE_CONSENT_WORDS.openFailedTitle, outcome, retry));
}

/**
 * Show the consent page in this tab (the notice's Allow). Never rejects.
 *
 * @param pageUrl This analysis page's address (the consent page comes back to it).
 * @param retry Try again (the comparison's open).
 * @param deps See {@link PerformanceConsentDeps}.
 */
export async function askConsentHere(
  pageUrl: string,
  retry: () => void,
  deps: PerformanceConsentDeps
): Promise<void> {
  const outcome = await ask(pageUrl, 'ask-here', deps);
  if (outcome.kind === 'reply') {
    const { status } = outcome.reply;
    // The tab is on its way to the consent page.
    if (status === 'asking') return;
    // Allowed meanwhile (elsewhere): the comparison opens now.
    if (status === 'granted') {
      retry();
      return;
    }
  }
  deps.notify(missNotice(PERFORMANCE_CONSENT_WORDS.framesFailedTitle, outcome, retry));
}

/**
 * Whether the comparison's analysis frames may load. Never rejects. Without
 * the grant (or an answer) nothing loads and a notice says why: Allow…
 * ({@link askConsentHere}) or Try again.
 *
 * @param pageUrl This analysis page's address.
 * @param retry Try again (the comparison's open).
 * @param deps See {@link PerformanceConsentDeps}.
 * @returns Whether to load the frames now.
 */
export async function checkAnalysisConsent(
  pageUrl: string,
  retry: () => void,
  deps: PerformanceConsentDeps
): Promise<boolean> {
  const outcome = await ask(pageUrl, 'check', deps);
  if (outcome.kind === 'reply' && outcome.reply.status === 'granted') return true;
  if (outcome.kind === 'reply' && outcome.reply.status === 'missing') {
    deps.notify({
      title: PERFORMANCE_CONSENT_WORDS.askTitle,
      body: PERFORMANCE_CONSENT_WORDS.askBody,
      action: {
        label: PERFORMANCE_CONSENT_WORDS.allow,
        run: () => void askConsentHere(pageUrl, retry, deps)
      }
    });
    return false;
  }
  deps.notify(missNotice(PERFORMANCE_CONSENT_WORDS.framesFailedTitle, outcome, retry));
  return false;
}

/**
 * Reload analysis frames once the consent still holds (checked again: it
 * may have been revoked since the open). Never rejects: without the grant
 * nothing reloads and {@link checkAnalysisConsent}'s notice says why — its
 * Try again repeats this reload; a throwing reload is logged.
 *
 * @param pageUrl This analysis page's address.
 * @param reload Reload the frames.
 * @param deps See {@link PerformanceConsentDeps}.
 * @returns Whether the frames reloaded.
 */
export async function reloadAfterConsent(
  pageUrl: string,
  reload: () => void,
  deps: PerformanceConsentDeps
): Promise<boolean> {
  const again = (): void => void reloadAfterConsent(pageUrl, reload, deps);
  if (!(await checkAnalysisConsent(pageUrl, again, deps))) return false;
  try {
    reload();
    return true;
  } catch (cause) {
    deps.log.error(
      'Reloading the analysis frames failed',
      cause instanceof Error ? cause.message : cause
    );
    return false;
  }
}

/** The analysis page's state when it is shown again (a `pageshow`). */
export interface ShownAgainState {
  /** The page came back from the back/forward cache (`PageTransitionEvent.persisted`). */
  readonly persisted: boolean;
  /** The page is the analysis auto-flow page. */
  readonly autoFlow: boolean;
  /** The comparison is open (its frames loaded under a grant). */
  readonly open: boolean;
  /** An open is in flight (it checks the consent itself). */
  readonly opening: boolean;
}

/**
 * Whether an analysis page shown again must ask its consent again: it came
 * back from the back/forward cache (whose restore runs no boot, so the
 * frames would never load and no notice would say why — e.g. Back from an
 * unanswered consent page) with no comparison open or opening.
 *
 * @param state See {@link ShownAgainState}.
 */
export function restoredPageNeedsCheck(state: ShownAgainState): boolean {
  return state.persisted && state.autoFlow && !state.open && !state.opening;
}
