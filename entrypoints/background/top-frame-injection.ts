/**
 * Script injection asked by a page's own top frame: the one answer behind
 * every "load my lazily injected script" ask (the command palette's view,
 * the beacon test runner). Only a top-frame http(s) sender is answered, and
 * only its own tab is targeted — a content script can never aim an
 * injection at another tab. Where the browser names the sending document,
 * the script goes into that document only, so a page that navigated
 * meanwhile gets nothing (the injection rejects).
 */
import type { Logger } from '../../lib/logger';
import {
  resolveSenderDocumentId,
  resolveTopFrameSender,
  type LooseMessageSender
} from '../../lib/messaging/sender';

/** Where a script goes: the sender's own document when known, else its tab's top frame. */
export interface InjectionTarget {
  readonly tabId: number;
  /** The sending document (null: the browser names none — the top frame then). */
  readonly documentId: string | null;
}

/** Injects script files at a target (production: {@link injectAtTarget}). */
export type InjectScripts = (target: InjectionTarget, files: readonly string[]) => Promise<void>;

/**
 * Inject script files at a target through `browser.scripting` (default
 * world: the extension's isolated world of that frame).
 *
 * @param target The tab, and the document when known.
 * @param files The built scripts.
 */
export async function injectAtTarget(
  target: InjectionTarget,
  files: readonly string[]
): Promise<void> {
  await browser.scripting.executeScript({
    target:
      target.documentId === null
        ? { tabId: target.tabId, frameIds: [0] }
        : { tabId: target.tabId, documentIds: [target.documentId] },
    files: [...files]
  });
}

/** One ask's identity, for its refusal and its failure log. */
export interface TopFrameInjectionAsk {
  /** The protocol row (names the refusal). */
  readonly row: string;
  /** The refusal's reason (e.g. "only a top-frame page may load the view"). */
  readonly refusal: string;
  /** What is injected, for the failure log (e.g. "the command palette view"). */
  readonly what: string;
  /** The built scripts. */
  readonly files: readonly string[];
  readonly log: Logger;
}

/**
 * Answer a top-frame injection ask.
 *
 * @param sender The runtime sender.
 * @param ask The ask's row, scripts and logger.
 * @param inject Injects script files at a target.
 * @returns `true` once the scripts ran.
 * @throws {@link Error} for a sender that is not a top-frame http(s) page;
 *   an injection failure rejects as the scripting API does (logged here).
 */
export async function answerTopFrameInjection(
  sender: LooseMessageSender | undefined,
  ask: TopFrameInjectionAsk,
  inject: InjectScripts
): Promise<true> {
  const page = resolveTopFrameSender(sender);
  if (page === null) throw new Error(`${ask.row}: ${ask.refusal}`);
  const target: InjectionTarget = {
    tabId: page.tabId,
    documentId: resolveSenderDocumentId(sender)
  };
  try {
    await inject(target, ask.files);
  } catch (cause) {
    ask.log.error(`Injecting ${ask.what} failed`, {
      tabId: page.tabId,
      cause: cause instanceof Error ? cause.message : cause
    });
    throw cause;
  }
  return true;
}
