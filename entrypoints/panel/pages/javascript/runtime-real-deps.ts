/**
 * The Runtime states session's production wiring: the inspected tab
 * (resolved per read, see `../inspected-tab`) and the page's load identity
 * from the shell's data store.
 */
import { createLogger } from '../../../../lib/logger';
import { liveScriptsTabStep, readLiveScripts } from '../../../../lib/script-runtime/read-live';
import type { DataState } from '../../state/fdt-state-machine';
import { pageIdOf } from '../../state/page-identity';
import { askInspectedTab } from '../inspected-tab';
import type { RuntimeStatesDeps } from './runtime-session';

const log = createLogger('runtime-states');

/**
 * Build the production deps.
 *
 * @param shell The shell's data state.
 * @returns The session deps.
 */
export function realRuntimeStatesDeps(shell: {
  readonly state: () => DataState;
}): RuntimeStatesDeps {
  return {
    read: () =>
      askInspectedTab((asks, tabId) =>
        readLiveScripts({ read: liveScriptsTabStep(asks, tabId), log })
      ),
    pageId: () => pageIdOf(shell.state()),
    log
  };
}
