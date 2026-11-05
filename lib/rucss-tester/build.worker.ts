/**
 * The RUCSS build worker: runs the user's patterns (`./build`) off every
 * page and panel thread, so a catastrophic pattern costs only this worker —
 * the client terminates it past its budget. One build per worker: the
 * client spawns a fresh one per run.
 */
import { buildRucssResult, parseRucssBuildInput, type RucssBuildResult } from './build';

/** The worker global, typed by what this entry uses. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (
    message: RucssBuildResult | { readonly ok: false; readonly problem: 'failed' }
  ) => void;
};

scope.onmessage = (event: MessageEvent): void => {
  const input = parseRucssBuildInput(event.data);
  if (input === null) {
    scope.postMessage({ ok: false, problem: 'failed' });
    return;
  }
  try {
    // Pattern-engine failures come back typed (naming the line or pair).
    scope.postMessage(buildRucssResult(input));
  } catch {
    // Anything else (e.g. out of memory): the build failed — the page stays untouched.
    scope.postMessage({ ok: false, problem: 'failed' });
  }
};
