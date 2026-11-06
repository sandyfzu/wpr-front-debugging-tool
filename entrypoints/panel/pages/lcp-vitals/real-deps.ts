/**
 * The LCP & Vitals session's production wiring: the inspected tab (resolved
 * per ask, see `../inspected-tab`) and the page's load identity from the
 * shell's data store.
 */
import { lcpTabStep, runLcpAnalysis } from '../../../../lib/lcp-analysis/run-analysis';
import { createLogger } from '../../../../lib/logger';
import {
  currentVisitTabStep,
  readCurrentVisitVitals
} from '../../../../lib/web-vitals/read-current-visit';
import type { DataState } from '../../state/fdt-state-machine';
import { pageIdOf, pageSettledOf } from '../../state/page-identity';
import { askInspectedTab } from '../inspected-tab';
import type { LcpVitalsSessionDeps } from './session';

const log = createLogger('lcp-vitals');

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
    analyse: (request) =>
      askInspectedTab((asks, tabId) =>
        runLcpAnalysis(request, { analyse: lcpTabStep(asks, tabId), log })
      ),
    readVitals: () =>
      askInspectedTab((asks, tabId) =>
        readCurrentVisitVitals({ read: currentVisitTabStep(asks, tabId), log })
      ),
    pageId: () => pageIdOf(shell.state()),
    pageSettled: () => pageSettledOf(shell.state()),
    log
  };
}
