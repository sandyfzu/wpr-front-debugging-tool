/**
 * The mounted list page's side of the panel-wide find: reporting the page's
 * matching-row count to the one search store, and deriving which of those
 * rows the find's cursor names — the active match.
 *
 * The four list pages (JavaScript, Lazyload, Preloaded Resources, Headers &
 * Cookies) compose this once each. The search store carries the query, the
 * cursor over the
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
 *
 * A page whose match set is a *subset* of the rendered list — rows the find
 * names scattered among scaffolding (the Headers & Cookies page's section
 * headings and notes) — passes {@link indexOfMatch}: the match-index →
 * rendered-row-index table. The resource pages' match set is the rendered
 * list itself, so they omit it and the mapping is the identity.
 */
import { createEffect, createMemo, on, onCleanup, untrack, type Accessor } from 'solid-js';
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
 * @param matchingRows The page's rendered-row count — the identity path's
 *   set size: the rendered rows the find names, under the current chip +
 *   query. With a table present the table's length is the match set, so
 *   pages pass both from the same memo and this value is never read.
 * @param indexOfMatch The match-index → rendered-row-index table for a page
 *   whose matches sit scattered among scaffolding rows; the table is the
 *   marker's and scroll's coordinate system, and its length IS the match
 *   set (the count report derives from it, so a count/table mismatch is
 *   impossible). Entries are used as-is — a junk entry would defeat the
 *   range guard, and only a page violating its own memo could produce one;
 *   the shipped pages derive valid rendered indices by construction.
 *   Omitted = the match set is the rendered list in order (the resource
 *   pages).
 * @returns The active match's highlight target and scroll request.
 */
export function createCurrentMatch(
  search: SearchStore,
  matchingRows: Accessor<number>,
  indexOfMatch?: Accessor<readonly number[]>
): CurrentMatch {
  /**
   * The match set's size from its one source: with a table present the
   * table's length IS the match set (the count cannot disagree with the
   * coordinate system it walks); otherwise the page's rendered-row count.
   *
   * @returns The match-set size under the current chip + query.
   */
  const setSize = (): number => indexOfMatch?.().length ?? matchingRows();
  /** The match count the page keeps reported to the store (0: no find active). */
  const reported = createMemo(() => (normalizeQuery(search.query()) === '' ? 0 : setSize()));

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
  /**
   * The cursor's row in the rendered list: through the page's table when it
   * declares one, the cursor itself otherwise (the match set is the list).
   * The marker's re-derivation tracks the table, so reshaping geometry moves
   * the marker exactly when the set it names moves; the scroll's derivation
   * reads the table untracked — the request's contract (geometry never
   * re-fires the scroll).
   *
   * @param cursor The store's match cursor.
   * @returns The rendered-row index the cursor names, or null for none.
   */
  const locate = (cursor: number): number | null => {
    if (!(cursor >= 0 && cursor < reported())) return null;
    const table = indexOfMatch?.();
    if (table === undefined) return cursor;
    return table[cursor] ?? null;
  };
  const current = createMemo(() => locate(search.cursor()));
  const request = createMemo(
    on([() => search.query(), () => search.cursor()], ([rawQuery, cursor]) => {
      if (normalizeQuery(rawQuery) === '') return null;
      // Untracked set size and table: the sources own find events; geometry
      // (a refresh, a chip change) re-derives the highlight through
      // `current` and may not move the list.
      const at = untrack(() => locate(cursor));
      return at === null ? null : { index: at };
    })
  );

  return { current, request };
}
