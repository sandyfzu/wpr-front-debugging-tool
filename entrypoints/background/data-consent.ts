/**
 * Firefox only — the background's side of the data-sharing consent:
 *
 * - `askDataConsent`: may a tool send the inspected page's address now? It
 *   reads the grant (every ask: a grant revoked in the Add-ons Manager is
 *   asked for at the next use). Granted: the tool goes on — for a PageSpeed
 *   Insights `open-tab` ask the background opens the analysis tab itself.
 *   Missing: a `check` ask hears `missing`; any other shows the consent
 *   page (the only kind of page Firefox lets call `permissions.request`:
 *   neither the DevTools panel nor a content script has the `permissions`
 *   API) and hears `asking` — in the asking tab (`ask-here`; never reused
 *   by another ask), in the tool's consent tab already open (focused, never
 *   a second one — even for two asks close together), or in a new tab next
 *   to the asking tab.
 * - The consent tabs it showed (`lib/data-consent/consent-tabs`): one that
 *   is closed or navigated away unanswered tells the waiting tool "not
 *   allowed" (a `dataConsentAnswered` push), so no tool waits on a tab
 *   that is gone.
 * - {@link backgroundConsentCheck}: the RUCSS request's own grant check
 *   (`./rucss-fetch`) — nothing is sent without the grant, whatever asked.
 *
 * Sender gates: the RUCSS Tester asks from one of this extension's tab-less
 * pages (the DevTools panel) and names its inspected tab; PageSpeed
 * Insights asks from a top frame, whose tab is the sender's own — a site's
 * page (`open-tab`), or the analysis page itself over https (`check`,
 * `ask-here`).
 */
import {
  DATA_CONSENT_PAGE_PATH,
  buildDataConsentPageUrl
} from '../../lib/data-consent/consent-page-url';
import {
  hasDataConsent,
  type DataConsentApi,
  type DataConsentFeature
} from '../../lib/data-consent/consent';
import { createConsentTabs, type ConsentTabs } from '../../lib/data-consent/consent-tabs';
import { createLogger, type Logger } from '../../lib/logger';
import { onMessage, sendMessage } from '../../lib/messaging';
import {
  DATA_CONSENT_ASK_DEADLINE_MS,
  parseDataConsentAnswer,
  parseDataConsentAsk,
  type DataConsentAnswer,
  type DataConsentAsk,
  type DataConsentReply
} from '../../lib/messaging/data-consent';
import { scheduleWithTimeout, type ScheduleTimer } from '../../lib/messaging/bounded-ask';
import { isNoReceiverError } from '../../lib/messaging/no-receiver';
import {
  isOwnExtensionPageSender,
  resolveSenderTabId,
  resolveSenderUrl,
  resolveTopFrameSender,
  type LooseMessageSender
} from '../../lib/messaging/sender';
import { PSI_HOST } from '../../lib/side-by-side/analysis-host';
import { parseUrl } from '../../utils/urls';

/**
 * How long (ms) an ask waits for the same tool's show in flight before it
 * shows its own: half the tool's own wait, so the tool still hears its
 * answer when a show never settles (a tab call that hangs).
 */
export const CONSENT_SHOW_WAIT_MS = DATA_CONSENT_ASK_DEADLINE_MS / 2;

/** The tab facts the consent needs (Firefox exposes `url` for this extension's own pages). */
export interface ConsentTabInfo {
  readonly index: number;
  readonly windowId?: number;
  readonly url?: string;
}

/** The slice of the tab and window APIs the consent uses (tests pass doubles). */
export interface ConsentTabApi {
  get(tabId: number): Promise<ConsentTabInfo>;
  create(properties: {
    url: string;
    openerTabId: number;
    active: true;
    index?: number;
    windowId?: number;
  }): Promise<{ readonly id?: number }>;
  update(tabId: number, properties: { url?: string; active: true }): Promise<unknown>;
  /** Bring a window to the front. */
  focusWindow(windowId: number): Promise<unknown>;
}

/** What the background side runs against (tests inject doubles). */
export interface DataConsentDeps {
  readonly api: Pick<DataConsentApi, 'getAll'>;
  /** This extension's id (`runtime.id`). */
  readonly extensionId: string;
  /** This extension's root URL (`runtime.getURL('/')`). */
  readonly extensionRootUrl: string;
  /** The consent page's absolute URL (no query). */
  readonly consentPageUrl: string;
  readonly tabs: ConsentTabApi;
  /** The consent tabs shown so far. */
  readonly shownTabs: ConsentTabs;
  /**
   * Per tool, the consent-tab show in flight: a second ask waits for it
   * (at most {@link CONSENT_SHOW_WAIT_MS}) and then reuses its tab (two
   * quick asks never open two tabs).
   */
  readonly pendingShows: Map<DataConsentFeature, Promise<void>>;
  /** The bounded wait's timer (tests pass doubles). */
  readonly schedule: ScheduleTimer;
  /** Push an answer to every extension page (never rejects). */
  readonly tell: (answer: DataConsentAnswer) => Promise<void>;
  readonly log: Logger;
}

/**
 * The asking tab, or null when the sender may not ask for this tool
 * ({@link DataConsentDeps} sender gates).
 *
 * @param ask The validated ask.
 * @param sender The runtime sender, untrusted.
 * @param deps See {@link DataConsentDeps}.
 */
export function consentOpenerTab(
  ask: DataConsentAsk,
  sender: LooseMessageSender | undefined,
  deps: Pick<DataConsentDeps, 'extensionId' | 'extensionRootUrl'>
): number | null {
  if (ask.feature === 'rucss') {
    return isOwnExtensionPageSender(sender, deps.extensionId, deps.extensionRootUrl)
      ? ask.tabId
      : null;
  }
  const page = resolveTopFrameSender(sender);
  if (page === null) return null;
  if (ask.mode === 'open-tab') return page.tabId;
  return page.origin === `https://${PSI_HOST}` ? page.tabId : null;
}

/**
 * Whether an address is the consent page (any query).
 *
 * @param url The address (absent: the browser did not expose it).
 * @param consentPageUrl The consent page's absolute URL.
 */
export function isConsentPageUrl(url: string | undefined, consentPageUrl: string): boolean {
  if (url === undefined) return false;
  const parsed = parseUrl(url);
  // Not `URL.origin`: extension schemes are non-special (opaque "null" origin).
  return (
    parsed !== null && `${parsed.protocol}//${parsed.host}${parsed.pathname}` === consentPageUrl
  );
}

/**
 * Summarize a cause for the log.
 *
 * @param cause The caught value.
 */
function causeOf(cause: unknown): unknown {
  return cause instanceof Error ? cause.message : cause;
}

/**
 * Open a tab right after its opener, in the opener's window (where the
 * opener cannot be read, wherever the browser puts it).
 *
 * @param url What the tab loads.
 * @param openerTabId The tab it belongs to (focus returns there on close).
 * @param deps See {@link DataConsentDeps}.
 * @returns The new tab's id (null when the browser gave none); rejects when it cannot open.
 */
export async function openTabNextTo(
  url: string,
  openerTabId: number,
  deps: Pick<DataConsentDeps, 'tabs' | 'log'>
): Promise<number | null> {
  let placement: { index?: number; windowId?: number } = {};
  try {
    const opener = await deps.tabs.get(openerTabId);
    placement = { index: opener.index + 1, windowId: opener.windowId };
  } catch (cause) {
    deps.log.warn('Reading the asking tab failed; the new tab opens where the browser puts it', {
      cause: causeOf(cause)
    });
  }
  const tab = await deps.tabs.create({ url, openerTabId, active: true, ...placement });
  return tab.id ?? null;
}

/**
 * A tab stopped showing the consent page (closed or navigated away): when
 * it left unanswered, tell the waiting tool it was not allowed.
 *
 * @param tabId The tab.
 * @param deps See {@link DataConsentDeps}.
 */
export async function tellLeft(tabId: number, deps: DataConsentDeps): Promise<void> {
  const feature = deps.shownTabs.left(tabId);
  if (feature !== null) await deps.tell({ feature, granted: false });
}

/**
 * Bring the tool's consent tab already showing to the front — reloaded on
 * `url` when it shows another ask or was answered (a fresh Allow), as is
 * otherwise (its prompt may be up).
 *
 * @param feature The asking tool.
 * @param url The consent page address for this ask.
 * @param deps See {@link DataConsentDeps}.
 * @returns Whether a tab was there to reuse (false: open a new one); rejects when the update does.
 */
export async function reuseConsentTab(
  feature: DataConsentFeature,
  url: string,
  deps: DataConsentDeps
): Promise<boolean> {
  const entry = deps.shownTabs.entryFor(feature);
  if (entry === null) return false;
  let tab: ConsentTabInfo;
  try {
    tab = await deps.tabs.get(entry.tabId);
  } catch {
    // Closed meanwhile (its removal event tells the tool).
    return false;
  }
  if (!isConsentPageUrl(tab.url, deps.consentPageUrl)) {
    // The tab went elsewhere: never take over a page the user moved on to.
    await tellLeft(entry.tabId, deps);
    return false;
  }
  const reload = entry.answered || tab.url !== url;
  await deps.tabs.update(entry.tabId, reload ? { url, active: true } : { active: true });
  if (reload) deps.shownTabs.shown(feature, entry.tabId, 'own-tab');
  if (tab.windowId !== undefined) {
    try {
      await deps.tabs.focusWindow(tab.windowId);
    } catch (cause) {
      // The tab is in front of its window; only the window stays behind.
      deps.log.warn('Focusing the consent tab window failed', { cause: causeOf(cause) });
    }
  }
  return true;
}

/**
 * Wait for an earlier show to settle, at most {@link CONSENT_SHOW_WAIT_MS}
 * (never rejects: its failure is its own ask's answer).
 *
 * @param earlier The show in flight.
 * @param deps See {@link DataConsentDeps}.
 * @returns Whether it settled in time (false: given up on, logged).
 */
export async function waitForEarlierShow(
  earlier: Promise<void>,
  deps: Pick<DataConsentDeps, 'schedule' | 'log'>
): Promise<boolean> {
  let cancel: () => void = () => undefined;
  const timedOut = new Promise<false>((resolve) => {
    cancel = deps.schedule(() => {
      resolve(false);
    }, CONSENT_SHOW_WAIT_MS);
  });
  const settled = earlier.then(
    () => true,
    () => true
  );
  const inTime = await Promise.race([settled, timedOut]);
  cancel();
  if (!inTime) deps.log.warn('An earlier consent tab show never settled; showing this ask anyway');
  return inTime;
}

/**
 * Show a tool's consent page in its own tab: the one already open
 * (focused), else a new one next to the asking tab. Serialized per tool: an
 * ask arriving while an earlier show is in flight waits for it (bounded:
 * {@link waitForEarlierShow}), then reuses the tab it opened.
 *
 * @param feature The asking tool.
 * @param url The consent page address for this ask.
 * @param opener The asking tab.
 * @param deps See {@link DataConsentDeps}.
 * @throws When the tab cannot be shown.
 */
export async function showInConsentTab(
  feature: DataConsentFeature,
  url: string,
  opener: number,
  deps: DataConsentDeps
): Promise<void> {
  const earlier = deps.pendingShows.get(feature);
  const show = (async (): Promise<void> => {
    if (earlier !== undefined) await waitForEarlierShow(earlier, deps);
    if (await reuseConsentTab(feature, url, deps)) return;
    const tabId = await openTabNextTo(url, opener, deps);
    if (tabId !== null) deps.shownTabs.shown(feature, tabId, 'own-tab');
  })();
  deps.pendingShows.set(feature, show);
  try {
    await show;
  } finally {
    // A later ask may have queued behind this one: only the newest entry goes (a
    // hung show stays the entry until the next ask replaces it — bounded by the wait).
    if (deps.pendingShows.get(feature) === show) deps.pendingShows.delete(feature);
  }
}

/**
 * Show the consent page for an ask whose grant is missing: in the asking
 * tab (`ask-here`; never reused for another ask), else in the tool's own
 * consent tab ({@link showInConsentTab}).
 *
 * @param ask The validated ask.
 * @param opener The asking tab.
 * @param deps See {@link DataConsentDeps}.
 * @throws When the tab cannot be shown (the caller answers `failed`).
 */
export async function showConsentPage(
  ask: DataConsentAsk,
  opener: number,
  deps: DataConsentDeps
): Promise<void> {
  const next = ask.feature === 'pagespeed' ? ask.next : null;
  const url = buildDataConsentPageUrl(deps.consentPageUrl, { feature: ask.feature, next });
  if (ask.feature === 'pagespeed' && ask.mode === 'ask-here') {
    await deps.tabs.update(opener, { url, active: true });
    deps.shownTabs.shown(ask.feature, opener, 'asking-tab');
    return;
  }
  await showInConsentTab(ask.feature, url, opener, deps);
}

/**
 * The granted answer: an `open-tab` PageSpeed Insights ask gets its
 * analysis tab opened here (a tab the background creates is never
 * popup-blocked, whatever triggered the ask); every other ask just goes on.
 *
 * @param ask The validated ask.
 * @param opener The asking tab.
 * @param deps See {@link DataConsentDeps}.
 */
async function answerGranted(
  ask: DataConsentAsk,
  opener: number,
  deps: DataConsentDeps
): Promise<DataConsentReply> {
  if (ask.feature !== 'pagespeed' || ask.mode !== 'open-tab') return { status: 'granted' };
  try {
    await openTabNextTo(ask.next, opener, deps);
    return { status: 'granted' };
  } catch (cause) {
    deps.log.error('Opening the PageSpeed Insights tab failed', causeOf(cause));
    return { status: 'failed' };
  }
}

/**
 * Answer one ask. Never rejects: a refused sender or ask, a failed read or
 * a tab that would not open answers `failed` (logged) — the tool sends
 * nothing on anything but `granted`.
 *
 * @param sender The runtime sender, untrusted.
 * @param data The ask, untrusted.
 * @param deps See {@link DataConsentDeps}.
 */
export async function answerDataConsentAsk(
  sender: LooseMessageSender | undefined,
  data: unknown,
  deps: DataConsentDeps
): Promise<DataConsentReply> {
  const ask = parseDataConsentAsk(data);
  const opener = ask === null ? null : consentOpenerTab(ask, sender, deps);
  if (ask === null || opener === null) {
    deps.log.warn('Data-sharing ask refused — not a valid ask from a tool that sends addresses');
    return { status: 'failed' };
  }
  let granted: boolean;
  try {
    granted = await hasDataConsent(deps.api);
  } catch (cause) {
    deps.log.error('Reading the data-sharing consent failed', causeOf(cause));
    return { status: 'failed' };
  }
  if (granted) return answerGranted(ask, opener, deps);
  if (ask.feature === 'pagespeed' && ask.mode === 'check') return { status: 'missing' };
  try {
    await showConsentPage(ask, opener, deps);
    return { status: 'asking' };
  } catch (cause) {
    deps.log.error('Showing the data-sharing consent page failed', causeOf(cause));
    return { status: 'failed' };
  }
}

/**
 * The consent tab a sender is: this extension's consent page in a tab.
 *
 * @param sender The runtime sender, untrusted.
 * @param deps See {@link DataConsentDeps}.
 * @returns Its tab id, or null for any other sender.
 */
export function consentPageSenderTab(
  sender: LooseMessageSender | undefined,
  deps: Pick<DataConsentDeps, 'extensionId' | 'consentPageUrl'>
): number | null {
  if (sender?.id !== deps.extensionId) return null;
  const url = resolveSenderUrl(sender);
  return url !== null && isConsentPageUrl(url.href, deps.consentPageUrl)
    ? resolveSenderTabId(sender)
    : null;
}

/**
 * Record an answer given on a consent tab (a grant: the tab leaves; a
 * decline: its later close tells nobody — the tool already knows).
 *
 * @param sender The runtime sender, untrusted.
 * @param data The answer, untrusted.
 * @param deps See {@link DataConsentDeps}.
 */
export function recordConsentAnswer(
  sender: LooseMessageSender | undefined,
  data: unknown,
  deps: Pick<DataConsentDeps, 'extensionId' | 'consentPageUrl' | 'shownTabs'>
): void {
  const tabId = consentPageSenderTab(sender, deps);
  const answer = parseDataConsentAnswer(data);
  if (tabId !== null && answer !== null) deps.shownTabs.answered(tabId, answer.granted);
}

/**
 * The background's own grant check (the RUCSS request's last gate):
 * Firefox's permissions API behind {@link hasDataConsent}.
 */
export function backgroundConsentCheck(): () => Promise<boolean> {
  // Firefox's `data_collection` key is missing from the shared API typings.
  const api = browser.permissions as unknown as Pick<DataConsentApi, 'getAll'>;
  return () => hasDataConsent(api);
}

/**
 * The production deps.
 *
 * @param log The module's logger.
 */
function realDeps(log: Logger): DataConsentDeps {
  return {
    // Firefox's `data_collection` key is missing from the shared API typings.
    api: browser.permissions as unknown as Pick<DataConsentApi, 'getAll'>,
    extensionId: browser.runtime.id,
    extensionRootUrl: browser.runtime.getURL('/'),
    consentPageUrl: browser.runtime.getURL(DATA_CONSENT_PAGE_PATH),
    tabs: {
      get: (tabId) => browser.tabs.get(tabId),
      create: (properties) => browser.tabs.create(properties),
      update: (tabId, properties) => browser.tabs.update(tabId, properties),
      focusWindow: (windowId) => browser.windows.update(windowId, { focused: true })
    },
    shownTabs: createConsentTabs(),
    pendingShows: new Map(),
    schedule: scheduleWithTimeout,
    tell: async (answer) => {
      try {
        await sendMessage('dataConsentAnswered', answer);
      } catch (cause) {
        // No tool open to hear it is expected (the tool asks again at its next use).
        if (isNoReceiverError(cause)) log.debug('No tool is waiting for the consent answer');
        else log.warn('Telling the tool the consent tab left failed', causeOf(cause));
      }
    },
    log
  };
}

/** Register the channels and the tab watch (once per background start; Firefox build only). */
export function registerDataConsent(): void {
  // Created here, not at import: the Chromium bundle never registers it.
  const log = createLogger('data-consent');
  const deps = realDeps(log);
  onMessage('askDataConsent', ({ sender, data }) => answerDataConsentAsk(sender, data, deps));
  onMessage('dataConsentAnswered', ({ sender, data }): true => {
    recordConsentAnswer(sender, data, deps);
    return true;
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    void tellLeft(tabId, deps);
  });
  browser.tabs.onUpdated.addListener((tabId, change) => {
    // `url` is exposed for the sites this extension may read and for its own pages.
    if (change.url !== undefined && !isConsentPageUrl(change.url, deps.consentPageUrl)) {
      void tellLeft(tabId, deps);
    }
  });
}
