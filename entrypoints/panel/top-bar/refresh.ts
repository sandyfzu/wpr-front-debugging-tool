/**
 * The top bar's Refresh control, decided from the data state: what a click
 * does, whether the control is busy, and the words that name it. Pure, so
 * every state is tested without a DOM.
 */
import type { DataState } from '../state/fdt-state-machine';
import { STALE_WINDOW_MINUTES } from './selectors';

/** What the Refresh control does now. */
export type RefreshControl =
  /** Loaded data: a click re-reads the page (soft refresh, the palette's Reload). */
  | { readonly kind: 'reload'; readonly title: string }
  /** A fetch is in the air: busy, clicks wait. */
  | { readonly kind: 'busy'; readonly title: string }
  /** The last read failed: a click retries it (the error view's Retry). */
  | { readonly kind: 'retry'; readonly title: string }
  /** No page can be read here: held, the title says why. */
  | { readonly kind: 'held'; readonly title: string };

/** The control's accessible name (stable across states; the title explains). */
export const REFRESH_LABEL = 'Refresh page data';

/**
 * The ready control's title while the shown data is stale: on a folded bar
 * the "Stale" marker lives in the "⋯" menu, so the control that fixes it
 * says so on hover too.
 */
export const STALE_REFRESH_TITLE = `Page data is older than ${STALE_WINDOW_MINUTES.toString()} min — refresh to re-read the page`;

/**
 * Resolve the Refresh control for a data state.
 *
 * @param state The panel's data state.
 * @param stale Whether the shown data is past the stale window (ages come
 *   from the aging clock, not the state, so the caller passes it).
 * @returns The control's action and title.
 */
export function refreshControl(state: DataState, stale = false): RefreshControl {
  switch (state.status) {
    case 'ready':
      return { kind: 'reload', title: stale ? STALE_REFRESH_TITLE : 'Refresh page data' };
    case 'idle':
    case 'fetching':
    case 'refreshing':
      return { kind: 'busy', title: 'Refreshing page data…' };
    case 'error':
      return { kind: 'retry', title: 'Retry reading page data' };
    case 'unavailable':
      return { kind: 'held', title: 'This page cannot be read from the panel.' };
  }
}
