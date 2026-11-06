/**
 * The Runtime states section's panel-lifetime state: the live script read
 * (the panel's ask machine, `../ask-run`) — kept across tab and route
 * changes, so leaving mid-read never loses the answer.
 *
 * The section reads on show when it has no answer yet or its answer is
 * stale (the page reloaded or navigated since): reading is passive (the page
 * only copies its script elements), so opening the section always shows the
 * current page. While shown, "Read again" re-reads on demand — after an
 * interaction it shows what Delay JS has run since.
 */
import type { Accessor } from 'solid-js';
import type { Logger } from '../../../../lib/logger';
import type { LiveScriptsOutcome } from '../../../../lib/script-runtime/read-live';
import { ASK_THREW, createAskRun, type AskRun } from '../ask-run';

/** What the session reads with (production binds the inspected tab; tests inject doubles). */
export interface RuntimeStatesDeps {
  readonly read: () => Promise<LiveScriptsOutcome>;
  /** The inspected page's load identity: new on every reload or navigation; null without a payload. */
  readonly pageId: Accessor<string | null>;
  readonly log: Logger;
}

/** The session. */
export interface RuntimeStatesSession {
  readonly read: AskRun<LiveScriptsOutcome>;
  /** Read unless an answer for the current page is shown or a read is on its way. */
  readonly ensure: () => void;
  readonly dispose: () => void;
}

/**
 * Create the session (call inside a reactive root that outlives the section).
 *
 * @param deps See {@link RuntimeStatesDeps}.
 */
export function createRuntimeStatesSession(deps: RuntimeStatesDeps): RuntimeStatesSession {
  const read = createAskRun<LiveScriptsOutcome>({
    ask: deps.read,
    threw: ASK_THREW,
    pageId: deps.pageId,
    log: deps.log,
    label: 'Live script read'
  });
  return {
    read,
    ensure: () => {
      const current = read.state();
      if (current.pending) return;
      if (current.shown === null || read.stale()) void read.start();
    },
    dispose: read.dispose
  };
}
