/**
 * The toolbar button's click: open the on-page command palette in the
 * clicked tab, through the same tab request the "Open Command Palette" menu
 * row sends — so a click behaves exactly like the row and the chord (a click
 * while the palette is open keeps it open, as it is).
 *
 * Never a dead click: a tab that cannot take the request (no receiver —
 * browser-internal, store and non-http(s) pages, a tab loaded before the
 * extension started, a page whose on-page UI is off — or a click without a
 * usable tab) opens the options page instead: the extension's home, and the
 * place that turns on-page UI back on.
 *
 * The event fires only while the button declares no popup (both browsers);
 * the decision is injected-deps so it is testable without the runtime.
 */

import { createLogger, type Logger } from '../../lib/logger';
import { sendMessage } from '../../lib/messaging';
import { boundedAsk, type AskOutcome, type ScheduleTimer } from '../../lib/messaging/bounded-ask';
import { numericTabId } from '../../lib/messaging/sender';
import { TOOLBAR_NAMESPACE, toolbarClickEvent, type ToolbarClickEvent } from './toolbar-action';

const log = createLogger('toolbar-click');

/**
 * How long a click waits for the tab's answer. The receiver answers at once
 * (it only queues the open), so this bounds a page whose main thread is
 * stuck — the open still runs there once it frees, which is why a late
 * answer never also opens the options page.
 */
export const PALETTE_OPEN_TIMEOUT_MS = 5_000;

/** The browser effects a click performs (injected for tests). */
export interface ToolbarClickDeps {
  /** Send the palette open request to a tab; rejects when nothing receives it. */
  sendOpen(tabId: number): Promise<unknown>;
  /** Open (or focus) the options page; rejects when the browser refuses. */
  openOptions(): Promise<void>;
  /** Where the outcomes are logged. */
  log: Logger;
  /** Timer seam for the answer deadline (defaults to `setTimeout`). */
  schedule?: ScheduleTimer;
}

/**
 * How a click ended:
 * - `palette` — the tab's palette module took the request;
 * - `unanswered` — the tab got it but did not answer in time (the page owns
 *   the open from there);
 * - `options` — the fallback opened the options page;
 * - `options-failed` — the fallback was needed and the browser refused it.
 */
export type ToolbarClickOutcome = 'palette' | 'unanswered' | 'options' | 'options-failed';

/** The click event's tab, as far as the click reads it (never its URL). */
export interface ToolbarClickTab {
  id?: unknown;
}

/**
 * The palette module answers `true`; any other answer still came from a
 * receiver that took the request.
 *
 * @param answer The tab's answer.
 */
function parseOpenAnswer(answer: unknown): true | null {
  return answer === true ? true : null;
}

/** What a send outcome means for the click. */
export type ClickRoute =
  | { readonly kind: 'palette'; readonly unexpectedAnswer: boolean }
  | { readonly kind: 'unanswered' }
  | { readonly kind: 'fallback'; readonly cause: unknown };

/**
 * Route a send outcome: any answer (even a malformed one) came from a
 * receiver that took the request; no answer in time leaves the open to the
 * page; no receiver or a real send failure falls back to the options page.
 *
 * @param outcome The bounded send's outcome.
 */
export function clickRoute(outcome: AskOutcome<true>): ClickRoute {
  switch (outcome.kind) {
    case 'reply':
      return { kind: 'palette', unexpectedAnswer: false };
    case 'invalid-reply':
      return { kind: 'palette', unexpectedAnswer: true };
    case 'timeout':
      return { kind: 'unanswered' };
    case 'no-receiver':
      return { kind: 'fallback', cause: 'no receiver in the tab' };
    case 'failed':
      return { kind: 'fallback', cause: outcome.cause };
  }
}

/**
 * Open the options page instead of the palette; never rejects.
 *
 * @param tabId The clicked tab (null when the event had none), for the logs.
 * @param cause Why the palette could not open.
 * @param deps The injected effects.
 */
async function openOptionsInstead(
  tabId: number | null,
  cause: unknown,
  deps: ToolbarClickDeps
): Promise<ToolbarClickOutcome> {
  // The tab id and the cause only: the page URL can carry secrets.
  deps.log.warn('Toolbar click opens the options page: the tab cannot open the command palette', {
    tabId,
    cause
  });
  try {
    await deps.openOptions();
    return 'options';
  } catch (openCause) {
    deps.log.error('Opening the options page from the toolbar failed', {
      tabId,
      cause: openCause
    });
    return 'options-failed';
  }
}

/**
 * Handle one toolbar click: ask the clicked tab to open its palette, else
 * fall back to the options page. Never rejects.
 *
 * @param tab The click event's tab (possibly absent or junk-shaped).
 * @param deps The injected effects.
 * @returns How the click ended.
 */
export async function handleToolbarClick(
  tab: ToolbarClickTab | undefined,
  deps: ToolbarClickDeps
): Promise<ToolbarClickOutcome> {
  const tabId = numericTabId(tab?.id);
  if (tabId === null) return openOptionsInstead(null, 'no usable tab id', deps);
  const outcome = await boundedAsk({
    send: () => deps.sendOpen(tabId),
    parse: parseOpenAnswer,
    timeoutMs: PALETTE_OPEN_TIMEOUT_MS,
    ...(deps.schedule === undefined ? {} : { schedule: deps.schedule })
  });
  const route = clickRoute(outcome);
  if (route.kind === 'fallback') return openOptionsInstead(tabId, route.cause, deps);
  if (route.kind === 'unanswered') {
    deps.log.warn('Toolbar click: the tab did not answer the palette request in time', { tabId });
    return 'unanswered';
  }
  if (route.unexpectedAnswer) {
    deps.log.warn('Toolbar click: the tab answered the palette request unexpectedly', { tabId });
  }
  return 'palette';
}

/**
 * Listen to the toolbar button's click (once per background start). The
 * listener body is guarded: a failing click never reaches the worker's
 * global handlers or sibling listeners.
 *
 * @param event This build's click event (`action` / `browserAction`).
 * @param deps The click's effects (the real send and options page by default).
 * @throws {@link Error} When `event` is null: the browser exposes no toolbar
 *   button API for this build, so no click can ever arrive.
 */
export function registerToolbarClick(
  event: ToolbarClickEvent | null = toolbarClickEvent(),
  deps: ToolbarClickDeps = {
    // The menu row's own payload-less tab request (same protocol row).
    sendOpen: (tabId) => sendMessage('openCommandPalette', undefined, { tabId }),
    openOptions: () => browser.runtime.openOptionsPage(),
    log
  }
): void {
  if (event === null) {
    throw new Error(`No toolbar click event (browser.${TOOLBAR_NAMESPACE}) in this browser`);
  }
  event.addListener((tab) => {
    void handleToolbarClick(tab, deps).catch((cause: unknown) => {
      deps.log.error('Toolbar click handling failed', cause);
    });
  });
}
