/**
 * The tool pages' one way to reach the inspected page: the tab's transport
 * (direct where the panel has `tabs`, relayed through the background
 * elsewhere — Firefox) and the tab DevTools inspects, resolved per ask so an
 * ask always targets the tab inspected now. Without either there is nothing
 * to send to: the page counts as not listening.
 */
import { selectTabAsks, type TabAsks } from '../../../lib/messaging/tab-asks';
import { devtoolsInspectedTabId } from '../state/edges';

/** The outcome of an ask with nothing to send to. */
export const PAGE_NOT_LISTENING = { kind: 'page-unreachable', miss: 'no-receiver' } as const;

/** Where the inspected tab is found (production: the panel's own context; tests inject doubles). */
export interface InspectedTabSource {
  /** The tab transport, or null where this context cannot reach a tab. */
  readonly asks: () => TabAsks | null;
  /** The inspected tab, or null outside a DevTools window. */
  readonly tabId: () => number | null;
}

/** The production source. */
const PANEL_SOURCE: InspectedTabSource = {
  asks: () => selectTabAsks(browser),
  tabId: devtoolsInspectedTabId
};

/**
 * Ask the inspected tab, or answer {@link PAGE_NOT_LISTENING} when there is
 * none to ask.
 *
 * @param ask Runs the ask over the transport for the tab.
 * @param source Where the tab is found (default: the panel's context).
 * @returns The ask's outcome, or {@link PAGE_NOT_LISTENING}.
 */
export function askInspectedTab<O>(
  ask: (asks: TabAsks, tabId: number) => Promise<O>,
  source: InspectedTabSource = PANEL_SOURCE
): Promise<O | typeof PAGE_NOT_LISTENING> {
  const asks = source.asks();
  const tabId = source.tabId();
  if (asks === null || tabId === null) return Promise.resolve(PAGE_NOT_LISTENING);
  return ask(asks, tabId);
}
