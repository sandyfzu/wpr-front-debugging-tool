/**
 * The Stylesheets read's production wiring: the inspected tab (resolved per
 * ask, see `../inspected-tab`), a bounded and guarded ask, and the page's
 * load identity from the shell's data store.
 */
import { createLogger } from '../../../../lib/logger';
import { boundedAsk, logAskMiss } from '../../../../lib/messaging/bounded-ask';
import { parsePageStylesheetsReply } from '../../../../lib/messaging/page-stylesheets';
import type { TabAsks } from '../../../../lib/messaging/tab-asks';
import type { DataState } from '../../state/fdt-state-machine';
import { pageIdOf, pageSettledOf } from '../../state/page-identity';
import { askInspectedTab } from '../inspected-tab';
import type { StylesheetsReadDeps } from './session';
import type { StylesheetsOutcome } from './style-view';

const log = createLogger('stylesheets');

/** How long (ms) the panel waits for the page's stylesheet list (synchronous DOM reads). */
export const PAGE_STYLESHEETS_DEADLINE_MS = 5_000;

/**
 * Ask one tab for its stylesheets, bounded and guarded.
 *
 * @param asks The tab transport.
 * @param tabId The inspected tab.
 * @param timeoutMs How long to wait (default {@link PAGE_STYLESHEETS_DEADLINE_MS}).
 * @returns The inventory, or the miss.
 */
export async function askPageStylesheets(
  asks: TabAsks,
  tabId: number,
  timeoutMs: number = PAGE_STYLESHEETS_DEADLINE_MS
): Promise<StylesheetsOutcome> {
  const outcome = await boundedAsk({
    send: () => asks.listPageStylesheets(tabId),
    parse: parsePageStylesheetsReply,
    timeoutMs
  });
  if (outcome.kind === 'reply') return outcome;
  logAskMiss(log, 'Reading the page stylesheets', outcome);
  return { kind: 'page-unreachable', miss: outcome.kind };
}

/**
 * Build the production deps.
 *
 * @param shell The shell's data state.
 * @returns The read deps.
 */
export function realStylesheetsDeps(shell: {
  readonly state: () => DataState;
}): StylesheetsReadDeps {
  return {
    listStylesheets: () => askInspectedTab((asks, tabId) => askPageStylesheets(asks, tabId)),
    pageId: () => pageIdOf(shell.state()),
    pageSettled: () => pageSettledOf(shell.state()),
    log
  };
}
