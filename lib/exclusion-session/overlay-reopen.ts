/**
 * Bringing the builder overlay back on a session tab's pages. The overlay
 * is a runtime content script: a page load (Apply's reload, Reset, a link
 * followed while the session persists) drops it with the old document. The
 * background re-opens it once each top-level page of the session's origin
 * finishes loading in that tab, so the applied state is always on screen,
 * read by the overlay from the persisted session record (never inferred
 * here). It comes back the way the user left it: the open panel, or folded
 * to its pill (closing folds too — while a session rewrites pages, its
 * indicator stays visible until Stop), remembered per tab in `session:`
 * so a restarted background keeps it. The page side (one overlay per
 * document, origin and HTML checks) is the slot's (`./overlay-slot`).
 *
 * Pure over injected I/O; the background binds it to `tabs.onUpdated`,
 * the scripting opener, the presentation store and the overlay's
 * presentation push.
 */
import type { Logger } from '../logger';
import type { ExclusionSessionStatus } from '../messaging/exclusion-session';
import { parseUrl } from '../../utils/urls';

/** How a re-opened overlay starts: the open panel, or folded to its pill. */
export type OverlayPresentation = 'open' | 'folded';

/**
 * Whether a loaded page gets the overlay back: the tab's session is active
 * and the page is of the session's origin (other origins in the tab are
 * never rewritten, so nothing there is the session's to show).
 *
 * @param status The tab's session status.
 * @param pageUrl The tab's committed URL (absent when the browser withholds it).
 */
export function shouldReopenOverlay(
  status: ExclusionSessionStatus,
  pageUrl: string | undefined
): boolean {
  if (status.state !== 'active' || pageUrl === undefined) return false;
  return parseUrl(pageUrl)?.origin === status.origin;
}

/** Where the per-tab presentation is remembered (the `session:` store in production). */
export interface PresentationMemory {
  get(tabId: number): Promise<OverlayPresentation | null>;
  set(tabId: number, presentation: OverlayPresentation): Promise<void>;
  remove(tabId: number): Promise<void>;
}

/** What the re-opener needs. */
export interface OverlayReopenerDeps {
  /** The tab's session status (the controller's own read); may reject. */
  status(tabId: number): Promise<ExclusionSessionStatus>;
  /**
   * Re-open the overlay in that presentation on a page of `origin` (the
   * page checks its own origin again: the tab may have moved on); never
   * rejects.
   */
  reopen(tabId: number, presentation: OverlayPresentation, origin: string): Promise<unknown>;
  readonly presentations: PresentationMemory;
  readonly log: Pick<Logger, 'warn'>;
}

/** The re-opener: one hook per event it follows; none rejects. */
export interface OverlayReopener {
  /**
   * A tab's top-level page finished loading. Calls for a tab already being
   * handled coalesce: they share the run in flight, which runs once more
   * after it (the page may have changed meanwhile).
   */
  pageLoaded(tabId: number, pageUrl: string | undefined): Promise<void>;
  /** The user left the tab's overlay open or folded (closing = folded). */
  presented(tabId: number, open: boolean): Promise<void>;
  /** The tab closed: forget it. */
  tabClosed(tabId: number): Promise<void>;
}

/**
 * Build the re-opener.
 *
 * @param deps The injected I/O.
 */
export function createOverlayReopener(deps: OverlayReopenerDeps): OverlayReopener {
  /** The run in flight per tab. */
  const inFlight = new Map<number, Promise<void>>();
  /** The latest URL a coalesced call asked about, per tab (a run follows). */
  const rerun = new Map<number, string | undefined>();
  /**
   * Tabs that closed: a presentation push still in flight when its tab
   * closed must not bring the tab's entry back (browsers do not reuse a
   * session's tab ids, so this only grows by one id per closed tab).
   */
  const closed = new Set<number>();

  /** The remembered presentation; a store failure falls back to the open panel. */
  const presentationOf = async (tabId: number): Promise<OverlayPresentation> => {
    try {
      return (await deps.presentations.get(tabId)) ?? 'open';
    } catch (cause) {
      deps.log.warn('Overlay presentation unreadable — re-opening open', { tabId, cause });
      return 'open';
    }
  };

  /** One re-open decision for a loaded page. */
  const handle = async (tabId: number, pageUrl: string | undefined): Promise<void> => {
    let status: ExclusionSessionStatus;
    try {
      status = await deps.status(tabId);
    } catch (cause) {
      // Unknown session ⇒ no overlay: never open on a guess.
      deps.log.warn('Overlay re-open skipped: the tab’s session could not be read', {
        tabId,
        cause
      });
      return;
    }
    if (status.state !== 'active' || !shouldReopenOverlay(status, pageUrl)) return;
    await deps.reopen(tabId, await presentationOf(tabId), status.origin);
  };

  /** Run for the tab, then once more per coalesced call. */
  const drain = async (tabId: number, pageUrl: string | undefined): Promise<void> => {
    let next: string | undefined = pageUrl;
    for (;;) {
      await handle(tabId, next);
      if (!rerun.has(tabId)) return;
      next = rerun.get(tabId);
      rerun.delete(tabId);
    }
  };

  return {
    pageLoaded(tabId, pageUrl) {
      const running = inFlight.get(tabId);
      if (running !== undefined) {
        rerun.set(tabId, pageUrl);
        return running;
      }
      const run = drain(tabId, pageUrl).finally(() => {
        inFlight.delete(tabId);
      });
      inFlight.set(tabId, run);
      return run;
    },
    async presented(tabId, open) {
      if (closed.has(tabId)) return;
      try {
        await deps.presentations.set(tabId, open ? 'open' : 'folded');
      } catch (cause) {
        deps.log.warn('Overlay presentation not remembered', { tabId, cause });
      }
    },
    async tabClosed(tabId) {
      closed.add(tabId);
      rerun.delete(tabId);
      try {
        await deps.presentations.remove(tabId);
      } catch (cause) {
        deps.log.warn('Closed tab’s overlay presentation not forgotten', { tabId, cause });
      }
    }
  };
}

/** What bringing every session tab's overlay back needs. */
export interface SessionOverlayRestoreDeps {
  /** The stored session records, keyed by decimal tab id (may reject). */
  records(): Promise<Readonly<Record<string, { readonly state: string }>>>;
  /** A tab's committed URL (rejects for a closed tab). */
  tabUrl(tabId: number): Promise<string | undefined>;
  readonly reopener: Pick<OverlayReopener, 'pageLoaded'>;
  readonly log: Pick<Logger, 'warn'>;
}

/**
 * Bring the overlay back on every tab with an active session — the
 * on-page UI gate turned on again, and the overlays it removed come back
 * the way their pages would have shown them (the re-opener's own checks:
 * session state, origin, the remembered presentation). Never rejects.
 *
 * @param deps The records, the tabs and the re-opener.
 */
export async function restoreSessionOverlays(deps: SessionOverlayRestoreDeps): Promise<void> {
  let records: Readonly<Record<string, { readonly state: string }>>;
  try {
    records = await deps.records();
  } catch (cause) {
    deps.log.warn('Session overlays not restored: the sessions could not be read', { cause });
    return;
  }
  const tabIds = Object.entries(records)
    .filter(([, record]) => record.state === 'active')
    .map(([key]) => Number(key))
    .filter((tabId) => Number.isSafeInteger(tabId) && tabId >= 0);
  await Promise.all(
    tabIds.map(async (tabId) => {
      let url: string | undefined;
      try {
        url = await deps.tabUrl(tabId);
      } catch (cause) {
        // The tab closed meanwhile: its own cleanup forgets the session.
        deps.log.warn('Session overlay not restored: the tab is gone', { tabId, cause });
        return;
      }
      await deps.reopener.pageLoaded(tabId, url);
    })
  );
}
