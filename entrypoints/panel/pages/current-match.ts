/**
 * The mounted list page's side of the panel-wide find: reporting the page's
 * matching-row count to the one search store, and deriving which of those
 * rows the find's cursor names — the active match.
 *
 * The three list pages (JavaScript, Lazyload, Preloaded Resources) compose
 * this once each. The search store carries the query, the cursor over the
 * reported count, and the wrap math; this seam ties the page's rendered list
 * (the match set) to both through two accessors with deliberately different
 * reactive sources:
 *
 * - {@link CurrentMatch.current} tracks the whole set (count too), so a
 *   refresh or chip change that shrinks or removes rows re-derives it — a
 *   cursor outside the current set names no row (the next step recovers the
 *   position, per the store's wrap math);
 * - {@link CurrentMatch.request} tracks only the store's find events (a
 *   committed query, a next/previous step), so list geometry changes reuse
 *   the same request identity and never scroll: a refresh or user scroll
 *   must not snap the view, while a fresh commit re-fires even when it lands
 *   on the same row index (a new query's first match is a new selection).
 *
 * The row marker renders on the page's own row root and the request drives
 * the list's `scrollTo` (the primitive's instant, nearest-edge geometry) —
 * the store and the list never learn about page markup, either.
 */
import { createEffect, createMemo, on, onCleanup, type Accessor } from 'solid-js';
import type { VirtualScrollRequest } from '../../../components/ui/virtual-list';
import { normalizeQuery } from '../../../lib/panel/list-behavior';
import type { SearchStore } from '../state/search';

/** What {@link createCurrentMatch} hands the page. */
export interface CurrentMatch {
  /**
   * The active match's row index in the page's list, or `null` when no row
   * is the match: no committed query, a match set of zero, or a cursor the
   * current set doesn't reach. Tracks the match set itself — markers hide
   * and re-show as refreshes and chip changes reshape the set.
   */
  readonly current: Accessor<number | null>;
  /**
   * The find's scroll request — a fresh object per store event, so the list
   * re-fires a scroll for every committed query and next/previous step even
   * when it lands on the same row index, and never for an unchanged value.
   * The memo's first run also produces a request at mount, which the list
   * deliberately does not scroll: the wrapper's `scrollTo` prop owns that
   * mount/remount contract.
   */
  readonly request: Accessor<VirtualScrollRequest | null>;
}

/**
 * The current match row's marker: a calm raised wash plus a 2 px leading rail
 * in the accent token — the leading rail is a shape-at-start-edge cue, not a
 * color-only one, and the page pairs it with `aria-current="true"` on the row.
 * Tokens only; no transition (row state never animates per row).
 */
export const CURRENT_MATCH_ROW =
  "relative bg-surface-3 before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-accent before:content-['']";

/**
 * Tie the page's match set to the search store: report the count while a
 * query is committed (never for a blank one — a page without an active find
 * acknowledges zero, and clearing already zeroes the store), and derive the
 * cursor's row as the active match. Must run inside a Solid owner (a
 * component); one per page.
 *
 * Unmount clears what the page reported — but only what it was the last to
 * report, so a disposed page can never clear another page's newer count. On
 * a route change the outgoing page's cleanup runs before the shell's reset
 * effect (verified on the installed Solid 1.9.17: the branch merge runs
 * cleanups during the pure update, user effects queue after), and the reset
 * zeroes the store right behind it; the reset-less lifecycles are what the
 * guard carries — a refresh/retry remount re-reports at mount and renders
 * the marker, but never re-anchors the list (the wrapper's `scrollTo`
 * contract), and the next find event scrolls.
 *
 * @param search The panel's search store.
 * @param matchingRows The page's rendered rows under the current chip + query
 *   — the match set while the query is non-blank (the raw visible length).
 * @returns The active match's highlight target and scroll request.
 */
export function createCurrentMatch(
  search: SearchStore,
  matchingRows: Accessor<number>
): CurrentMatch {
  /** The match count the page keeps reported to the store (0: no find active). */
  const reported = createMemo(() => (normalizeQuery(search.query()) === '' ? 0 : matchingRows()));

  let lastReported = 0;
  createEffect(
    on(
      reported,
      (count) => {
        lastReported = count;
        search.setMatchCount(count);
      }
      // No `defer`: first run at mount, so a page remounted under an active
      // query (retry/refresh lifecycle, where no store reset runs) re-reports
      // its fresh set at once.
    )
  );
  onCleanup(() => {
    // Clear only the count this page still owns (it always is its last
    // report unless another page reported since). Rewriting 0 over 0 would
    // be a harmless no-op; skipping it keeps the store's write history clean.
    // Standing assumption, verified with the flush order: a successor's
    // first report effect always queues behind this cleanup, so the equality
    // read can never see an equal-count successor's claim — by the time a
    // future flow could reverse that, an ownership token is the honest fix.
    if (lastReported !== 0 && search.matchCount() === lastReported) search.setMatchCount(0);
  });

  // The active-match highlight and the find's scroll request are derived
  // before the render tree, as the pages' other memos are.
  const current = createMemo(() => {
    const cursor = search.cursor();
    const count = reported();
    return cursor >= 0 && cursor < count ? cursor : null;
  });
  const request = createMemo(
    on([() => search.query(), () => search.cursor()], ([rawQuery, cursor]) => {
      // Untracked set size: the sources own find events; geometry (a
      // refresh, a chip change) re-derives the highlight through
      // `current` and may not move the list.
      const count = matchingRows();
      if (normalizeQuery(rawQuery) === '' || count === 0 || cursor < 0 || cursor >= count) {
        return null;
      }
      return { index: cursor };
    })
  );

  return { current, request };
}
