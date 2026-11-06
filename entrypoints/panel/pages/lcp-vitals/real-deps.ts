/**
 * The LCP & Vitals session's production wiring: the inspected tab's
 * transport (direct where the panel has `tabs`, relayed through the
 * background elsewhere — Firefox) and the page's load identity from the
 * shell's data store. Resolved per ask, so an ask always targets the tab
 * DevTools inspects now.
 */
import { lcpTabStep, runLcpAnalysis } from '../../../../lib/lcp-analysis/run-analysis';
import { createLogger } from '../../../../lib/logger';
import { selectTabAsks } from '../../../../lib/messaging/tab-asks';
import {
  currentVisitTabStep,
  readCurrentVisitVitals
} from '../../../../lib/web-vitals/read-current-visit';
import { devtoolsInspectedTabId } from '../../state/edges';
import type { DataState } from '../../state/fdt-state-machine';
import { pageIdOf } from '../../state/page-identity';
import type { LcpVitalsSessionDeps } from './session';

const log = createLogger('lcp-vitals');

/** An ask with nothing to send to: the page counts as not listening. */
const NO_PAGE = { kind: 'page-unreachable', miss: 'no-receiver' } as const;

/**
 * The inspected tab's transport and id, or null where there is none.
 *
 * @returns Both, or null.
 */
function inspectedTab(): {
  asks: NonNullable<ReturnType<typeof selectTabAsks>>;
  tabId: number;
} | null {
  const asks = selectTabAsks(browser);
  const tabId = devtoolsInspectedTabId();
  return asks === null || tabId === null ? null : { asks, tabId };
}

/**
 * Build the production deps.
 *
 * @param shell The shell's data state.
 * @returns The session deps.
 */
export function realLcpVitalsDeps(shell: {
  readonly state: () => DataState;
}): LcpVitalsSessionDeps {
  return {
    analyse: (request) => {
      const tab = inspectedTab();
      if (tab === null) return Promise.resolve(NO_PAGE);
      return runLcpAnalysis(request, { analyse: lcpTabStep(tab.asks, tab.tabId), log });
    },
    readVitals: () => {
      const tab = inspectedTab();
      if (tab === null) return Promise.resolve(NO_PAGE);
      return readCurrentVisitVitals({ read: currentVisitTabStep(tab.asks, tab.tabId), log });
    },
    pageId: () => pageIdOf(shell.state()),
    log
  };
}
