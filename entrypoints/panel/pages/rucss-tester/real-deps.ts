/**
 * The tester session's production wiring: the shared settings store, the
 * inspected tab's transport (direct where the panel has `tabs`, relayed
 * through the background elsewhere — Firefox), the build worker, and the
 * page's TEST MODE fact from the shell's data store. Resolved per call, so
 * a run always targets the tab DevTools inspects now.
 */
import { createLogger } from '../../../../lib/logger';
import {
  boundedAsk,
  scheduleWithTimeout,
  type AskOutcome
} from '../../../../lib/messaging/bounded-ask';
import { parsePageStylesReply, type PageStylesReply } from '../../../../lib/messaging/page-styles';
import { selectTabAsks, type TabAsks } from '../../../../lib/messaging/tab-asks';
import { buildRucssInWorker } from '../../../../lib/rucss-tester/build-client';
import {
  runRucssTest,
  rucssTabSteps,
  type RucssTestOutcome
} from '../../../../lib/rucss-tester/run-test';
import {
  getRucssTesterConfig,
  setRucssTesterConfig,
  watchRucssTesterConfig
} from '../../../../lib/storage/rucss-tester-config';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { devtoolsInspectedTabId } from '../../state/edges';
import type { DataState } from '../../state/fdt-state-machine';
import type { RucssTesterSessionDeps } from './session';

const log = createLogger('rucss-tester');

/** How long (ms) the panel waits for the page's style inventory (synchronous DOM reads). */
export const PAGE_STYLES_DEADLINE_MS = 5_000;

/** Quiet time (ms) after an edit before the settings are written. */
export const SETTINGS_SAVE_DELAY_MS = 400;

/**
 * The page's applied-test count from the shell's data state.
 *
 * @param state The shell's data state.
 * @returns Tests applied on the page (0 without loaded data or a test).
 */
export function pageRunsOf(state: DataState): number {
  if (state.status !== 'ready' && state.status !== 'refreshing') return 0;
  const data: FdtData = state.data;
  return data.rucssTestMode?.runs ?? 0;
}

/**
 * The page's load identity from the shell's data state: the payload's
 * capture id, generated once per page load (a reload or navigation brings
 * a new one).
 *
 * @param state The shell's data state.
 * @returns The identity, or `null` without loaded data (or a payload without one).
 */
export function pageIdOf(state: DataState): string | null {
  if (state.status !== 'ready' && state.status !== 'refreshing') return null;
  return state.data.scriptSnapshotId ?? null;
}

/** The inspected tab and its transport, or null when the panel cannot reach it. */
function inspectedTarget(): { readonly asks: TabAsks; readonly tabId: number } | null {
  const asks = selectTabAsks(browser);
  const tabId = devtoolsInspectedTabId();
  return asks === null || tabId === null ? null : { asks, tabId };
}

/** A start with nothing to send to: the page counts as not listening. */
const NO_PAGE: RucssTestOutcome = { kind: 'page-unreachable', step: 'start', miss: 'no-receiver' };

/**
 * Build the production deps.
 *
 * @param shell The shell's data state and its refresh.
 * @returns The session deps.
 */
export function realRucssTesterDeps(shell: {
  readonly state: () => DataState;
  readonly reload: () => void;
}): RucssTesterSessionDeps {
  return {
    readConfig: getRucssTesterConfig,
    writeConfig: setRucssTesterConfig,
    watchConfig: watchRucssTesterConfig,
    runTest: () => {
      const target = inspectedTarget();
      if (target === null) return Promise.resolve(NO_PAGE);
      return runRucssTest({
        readConfig: getRucssTesterConfig,
        ...rucssTabSteps(target.asks, target.tabId),
        build: (input) => buildRucssInWorker(input),
        log
      });
    },
    listStyles: (): Promise<AskOutcome<PageStylesReply>> => {
      const target = inspectedTarget();
      if (target === null) return Promise.resolve({ kind: 'no-receiver' });
      return boundedAsk({
        send: () => target.asks.listPageStyles(target.tabId),
        parse: parsePageStylesReply,
        timeoutMs: PAGE_STYLES_DEADLINE_MS
      });
    },
    pageRuns: () => pageRunsOf(shell.state()),
    pageId: () => pageIdOf(shell.state()),
    onApplied: shell.reload,
    schedule: scheduleWithTimeout,
    saveDelayMs: SETTINGS_SAVE_DELAY_MS,
    log
  };
}
