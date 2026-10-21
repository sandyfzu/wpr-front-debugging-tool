/**
 * Bringing the builder overlay back on a session tab's pages. The overlay
 * is a runtime content script: a page load (Apply's reload, Reset, a link
 * followed while the session persists) drops it with the old document. The
 * background re-opens it once each top-level page of the session's origin
 * finishes loading in that tab, so the applied state is always on screen,
 * read by the overlay from the persisted session record (never inferred
 * here). It comes back the way the user left it: the open panel, or folded
 * to its pill (closing folds too — while a session rewrites pages, its
 * indicator stays visible until Stop).
 *
 * Pure over injected I/O; the background binds it to `tabs.onUpdated`,
 * the scripting opener and the overlay's presentation push.
 */
import type { Logger } from '../logger';
import type { ExclusionSessionStatus } from '../messaging/exclusion-session';
import { parseUrl } from '../../utils/urls';

/** How a re-opened overlay starts: the open panel, or folded to its pill. */
export type OverlayPresentation = 'open' | 'folded';

/**
 * The isolated-world global a re-open leaves for the overlay script it
 * injects next: content scripts of one extension share a frame's isolated
 * world, so the page never sees it. Read and removed by the overlay at
 * start; absent means an explicit open (the panel shows open).
 */
export const OVERLAY_PRESENTATION_GLOBAL = '__wprFdtOverlayPresentation';

/** Whether a value is a presentation. */
function isOverlayPresentation(value: unknown): value is OverlayPresentation {
  return value === 'open' || value === 'folded';
}

/**
 * Take the presentation a re-open left (read once, then removed, so a
 * later explicit open is never mistaken for a re-open).
 *
 * @param scope The isolated world's global object.
 * @returns The presentation, or null when none (or junk) was left.
 */
export function takeOverlayPresentation(
  scope: Record<string, unknown>
): OverlayPresentation | null {
  const value = scope[OVERLAY_PRESENTATION_GLOBAL];
  Reflect.deleteProperty(scope, OVERLAY_PRESENTATION_GLOBAL);
  return isOverlayPresentation(value) ? value : null;
}

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

/** What the re-opener needs. */
export interface OverlayReopenerDeps {
  /** The tab's session status (the controller's own read); may reject. */
  status(tabId: number): Promise<ExclusionSessionStatus>;
  /** Re-open the overlay in that presentation; never rejects. */
  reopen(tabId: number, presentation: OverlayPresentation): Promise<unknown>;
  readonly log: Pick<Logger, 'warn'>;
}

/** The re-opener: one hook per event it follows. */
export interface OverlayReopener {
  /** A tab's top-level page finished loading. Never rejects. */
  pageLoaded(tabId: number, pageUrl: string | undefined): Promise<void>;
  /** The user left the tab's overlay open or folded (closing = folded). */
  presented(tabId: number, open: boolean): void;
  /** The tab closed: forget it. */
  tabClosed(tabId: number): void;
}

/**
 * Build the re-opener. The presentation per tab is memory only: a
 * background that restarts re-opens with the panel open.
 *
 * @param deps The injected I/O.
 */
export function createOverlayReopener(deps: OverlayReopenerDeps): OverlayReopener {
  const presentations = new Map<number, OverlayPresentation>();
  return {
    async pageLoaded(tabId, pageUrl) {
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
      if (!shouldReopenOverlay(status, pageUrl)) return;
      await deps.reopen(tabId, presentations.get(tabId) ?? 'open');
    },
    presented(tabId, open) {
      presentations.set(tabId, open ? 'open' : 'folded');
    },
    tabClosed(tabId) {
      presentations.delete(tabId);
    }
  };
}
