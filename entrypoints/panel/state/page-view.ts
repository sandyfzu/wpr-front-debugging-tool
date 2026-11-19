/**
 * The page-level view the content region shows for a data state — the
 * granularity at which the region's scroll restarts. A soft refresh keeps
 * the page view (`ready` ↔ `refreshing`), so scroll survives it; every
 * other swap (loading → page, error → loading on Retry, …) replaces the
 * whole body, and the new view must start at its top with its heading in
 * view, never mid-scroll at the offset the previous view left behind.
 */
import type { DataState } from './fdt-state-machine';

/** What fills the content region: a loading page, a data error, "unavailable" or the route. */
export type PageView = 'loading' | 'error' | 'unavailable' | 'page';

/**
 * Map a data state to the view it renders.
 *
 * @param status The data state's status.
 * @returns The page view (`idle` and `fetching` share the loading page).
 */
export function pageViewOf(status: DataState['status']): PageView {
  switch (status) {
    case 'idle':
    case 'fetching':
      return 'loading';
    case 'error':
      return 'error';
    case 'unavailable':
      return 'unavailable';
    case 'ready':
    case 'refreshing':
      return 'page';
  }
}
