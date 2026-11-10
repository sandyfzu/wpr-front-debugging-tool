/**
 * The Stylesheets page's read of the inspected page: the panel's ask
 * machine (`../ask-run`) plus when to ask — once on show, again whenever
 * the shell settles on a page load the last read was not asked on (a
 * reload or a navigation), and on Refresh. One auto read per page load:
 * a read that missed is never retried on its own (Retry is the user's).
 * Lives as long as the page body (a passive read: every visit asks afresh).
 */
import { createEffect, createMemo, onCleanup, type Accessor } from 'solid-js';
import type { Logger } from '../../../../lib/logger';
import { ASK_THREW, createAskRun, isPageUnreachable } from '../ask-run';
import { stylesheetsView, type StylesheetsOutcome, type StylesheetsView } from './style-view';

/** What the read runs against (production binds the inspected tab; tests inject doubles). */
export interface StylesheetsReadDeps {
  /** Ask the page for its stylesheets (expected never to reject). */
  readonly listStylesheets: () => Promise<StylesheetsOutcome>;
  /** The inspected page's load identity: new on every reload or navigation; null without a payload. */
  readonly pageId: Accessor<string | null>;
  /** Whether `pageId` is current (no shell refetch in flight). */
  readonly pageSettled: Accessor<boolean>;
  readonly log: Logger;
}

/** The read. */
export interface StylesheetsRead {
  /** The page's state, derived from the machine. */
  readonly view: Accessor<StylesheetsView>;
  /** Read again now (ignored while a read is on its way). */
  readonly refresh: () => void;
}

/**
 * Create the read (call inside the page body's reactive owner: it asks at
 * once and stops recording when the owner goes).
 *
 * @param deps See {@link StylesheetsReadDeps}.
 */
export function createStylesheetsRead(deps: StylesheetsReadDeps): StylesheetsRead {
  const run = createAskRun<StylesheetsOutcome>({
    ask: deps.listStylesheets,
    threw: ASK_THREW,
    isFailure: isPageUnreachable,
    pageId: deps.pageId,
    pageSettled: deps.pageSettled,
    log: deps.log,
    label: 'Stylesheet inventory read'
  });
  // The settled page load the latest read was asked on (null: unknown, or asked mid-refetch).
  let askedOn: string | null = null;

  /** Ask, remembering which page load the read targets. */
  const ask = (): void => {
    if (run.state().pending) return;
    askedOn = deps.pageSettled() ? deps.pageId() : null;
    void run.start();
  };

  // A new settled page load the latest read was not asked on: read it once.
  createEffect(() => {
    const id = deps.pageId();
    if (!deps.pageSettled() || id === null || id === askedOn || run.state().pending) return;
    ask();
  });
  onCleanup(run.dispose);
  ask();

  const view = createMemo(() => stylesheetsView(run.state(), run.stale()));
  return { view, refresh: ask };
}
