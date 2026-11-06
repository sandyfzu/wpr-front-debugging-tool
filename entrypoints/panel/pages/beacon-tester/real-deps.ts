/**
 * The beacon tester session's production wiring: the shared settings store,
 * the inspected tab's transport (direct where the panel has `tabs`, relayed
 * through the background elsewhere — Firefox), the panel document's selector
 * parser, and the page's load identity from the shell's data store. Resolved
 * per run, so a run always targets the tab DevTools inspects now.
 */
import { beaconTabStep, runBeaconTest } from '../../../../lib/beacon-test/run-test';
import type { BeaconTestOutcome } from '../../../../lib/beacon-test/run-test';
import { createLogger } from '../../../../lib/logger';
import { scheduleWithTimeout } from '../../../../lib/messaging/bounded-ask';
import { selectTabAsks } from '../../../../lib/messaging/tab-asks';
import {
  getBeaconTestSettings,
  setBeaconTestSettings,
  watchBeaconTestSettings
} from '../../../../lib/storage/beacon-test-settings';
import { isValidSelector } from '../../../../utils/css-selector';
import { devtoolsInspectedTabId } from '../../state/edges';
import type { DataState } from '../../state/fdt-state-machine';
import { pageIdOf } from '../../state/page-identity';
import type { BeaconTesterSessionDeps } from './session';

const log = createLogger('beacon-tester');

/** Quiet time (ms) after an edit before the settings are written. */
export const BEACON_SETTINGS_SAVE_DELAY_MS = 400;

/** A run with nothing to send to: the page counts as not listening. */
const NO_PAGE: BeaconTestOutcome = { kind: 'page-unreachable', miss: 'no-receiver' };

/**
 * Build the production deps.
 *
 * @param shell The shell's data state.
 * @returns The session deps.
 */
export function realBeaconTesterDeps(shell: {
  readonly state: () => DataState;
}): BeaconTesterSessionDeps {
  /** The panel's own parser judges selectors (the page re-checks with its own). */
  const checkSelector = (selector: string): boolean => isValidSelector(document, selector);
  return {
    readSettings: getBeaconTestSettings,
    writeSettings: setBeaconTestSettings,
    watchSettings: watchBeaconTestSettings,
    runTest: (draft) => {
      const asks = selectTabAsks(browser);
      const tabId = devtoolsInspectedTabId();
      if (asks === null || tabId === null) return Promise.resolve(NO_PAGE);
      return runBeaconTest(draft, {
        isValidSelector: checkSelector,
        run: beaconTabStep(asks, tabId),
        log
      });
    },
    isValidSelector: checkSelector,
    pageId: () => pageIdOf(shell.state()),
    schedule: scheduleWithTimeout,
    saveDelayMs: BEACON_SETTINGS_SAVE_DELAY_MS,
    log
  };
}
