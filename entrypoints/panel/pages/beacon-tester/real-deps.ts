/**
 * The beacon tester session's production wiring: the shared settings store,
 * the inspected tab (resolved per run, see `../inspected-tab`), the panel
 * document's selector parser, and the page's load identity from the shell's
 * data store.
 */
import { beaconTabStep, runBeaconTest } from '../../../../lib/beacon-test/run-test';
import { createLogger } from '../../../../lib/logger';
import { scheduleWithTimeout } from '../../../../lib/messaging/bounded-ask';
import {
  getBeaconTestSettings,
  setBeaconTestSettings,
  watchBeaconTestSettings
} from '../../../../lib/storage/beacon-test-settings';
import { isValidSelector } from '../../../../utils/css-selector';
import type { DataState } from '../../state/fdt-state-machine';
import { pageIdOf, pageSettledOf } from '../../state/page-identity';
import { askInspectedTab } from '../inspected-tab';
import type { BeaconTesterSessionDeps } from './session';

const log = createLogger('beacon-tester');

/** Quiet time (ms) after an edit before the settings are written. */
export const BEACON_SETTINGS_SAVE_DELAY_MS = 400;

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
    runTest: (draft) =>
      askInspectedTab((asks, tabId) =>
        runBeaconTest(draft, {
          isValidSelector: checkSelector,
          run: beaconTabStep(asks, tabId),
          log
        })
      ),
    isValidSelector: checkSelector,
    pageId: () => pageIdOf(shell.state()),
    pageSettled: () => pageSettledOf(shell.state()),
    schedule: scheduleWithTimeout,
    saveDelayMs: BEACON_SETTINGS_SAVE_DELAY_MS,
    log
  };
}
