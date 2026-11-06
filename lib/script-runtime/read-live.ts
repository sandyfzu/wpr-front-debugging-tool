/**
 * One live script read, driven from the DevTools panel: ask the inspected
 * tab's top frame for its live `<script>` elements (bounded, validated on
 * arrival) and classify each. Every call reads the page afresh, so a read
 * after an interaction shows what Delay JS has run since.
 */
import type { Logger } from '../logger';
import { boundedAsk, logAskMiss, type AskMiss, type AskOutcome } from '../messaging/bounded-ask';
import { parseScriptRuntimeReply, type ScriptRuntimeReply } from '../messaging/script-runtime';
import type { TabAsks } from '../messaging/tab-asks';
import { classifyScript, type ScriptRuntimeRecord } from './classify';

/** The panel's wait (ms) on a read: synchronous DOM reads plus the hops. */
export const SCRIPT_RUNTIME_ASK_DEADLINE_MS = 10_000;

/** One classified live script. */
export interface LiveScriptRecord extends ScriptRuntimeRecord {
  /** Whether the read's text budget cut the full text short (only the preview arrived). */
  readonly fullTextCut: boolean;
}

/** How a read ended. */
export type LiveScriptsOutcome =
  /** The page did not answer usably. */
  | { readonly kind: 'page-unreachable'; readonly miss: AskMiss }
  | {
      readonly kind: 'read';
      /** In document order. */
      readonly scripts: readonly LiveScriptRecord[];
      /** All scripts on the page at the read. */
      readonly total: number;
      /** Whether the page had more scripts than the read lists. */
      readonly truncated: boolean;
    };

/** What a read needs (the caller binds the tab; tests inject doubles). */
export interface LiveScriptsDeps {
  readonly read: () => Promise<AskOutcome<ScriptRuntimeReply>>;
  readonly log: Logger;
}

/**
 * Bind the read ask to one tab: bounded, answer guarded.
 *
 * @param asks The tab transport (direct or relayed; only this ask is used).
 * @param tabId The inspected tab.
 */
export function liveScriptsTabStep(
  asks: Pick<TabAsks, 'getScriptRuntimeStatuses'>,
  tabId: number
): LiveScriptsDeps['read'] {
  return () =>
    boundedAsk({
      send: () => asks.getScriptRuntimeStatuses(tabId),
      parse: parseScriptRuntimeReply,
      timeoutMs: SCRIPT_RUNTIME_ASK_DEADLINE_MS
    });
}

/**
 * Read and classify the live scripts.
 *
 * @param deps See {@link LiveScriptsDeps}.
 * @returns How the read ended (never rejects).
 */
export async function readLiveScripts(deps: LiveScriptsDeps): Promise<LiveScriptsOutcome> {
  const outcome = await deps.read();
  if (outcome.kind !== 'reply') {
    logAskMiss(deps.log, 'Live script read', outcome);
    return { kind: 'page-unreachable', miss: outcome.kind };
  }
  const { scripts, total } = outcome.reply;
  return {
    kind: 'read',
    scripts: Object.freeze(
      scripts.map(({ textCut, ...script }) =>
        Object.freeze({ ...classifyScript(script), fullTextCut: textCut })
      )
    ),
    total,
    truncated: total > scripts.length
  };
}
