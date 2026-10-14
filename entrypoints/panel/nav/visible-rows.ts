/**
 * The rail's overflow computation — the pure half of the small-heights
 * affordance: which nav rows stay in the rail and which move to the
 * "More pages" trigger's menu.
 *
 * The decision is made over *measured* geometry, never hardcoded pitches:
 * the measure seam reports every registry row's box in the rail's full
 * layout (its heights already carry the group separators and the spacing
 * the DOM put above it), so a rail whose row pitch or separators ever
 * change re-slices correctly with no arithmetic edited here. The render
 * slice re-renders the rail as the registry-order prefix — the first
 * rendered group is always the registry's first group, so the separators
 * the seam measured for later groups are exactly the ones the prefix
 * render will draw.
 */
import type { RouteId } from '../routes';

/** One measured rail row, in the rail's full layout (registry order). */
export interface RailRowBox {
  /** The registry route id the measured row belongs to. */
  readonly route: RouteId;
  /** Top offset in px from the rail's content top (separators/gaps included). */
  readonly top: number;
  /** The row's own measured height in px. */
  readonly height: number;
}

/** The registry rows partitioned into the rail and the affordance. */
export interface RailOverflow {
  /** Rows that stay in the rail — the registry-order visible prefix. */
  readonly visible: readonly RailRowBox[];
  /** Rows that move to the "More pages" trigger's menu (order preserved). */
  readonly hidden: readonly RailRowBox[];
}

/**
 * Partition the rail's rows into the ones that fit the available height
 * and the ones that overflow into the affordance.
 *
 * A row fits when its own measured box lies entirely inside the available
 * height (`top + height <= availableHeight`); because tops are monotonic
 * in registry order, the visible set is always the registry-order prefix
 * and the hidden set its suffix — the rail and the menu together always
 * cover every registry row exactly once.
 *
 * Group separators are not separate inputs: the measured `top` of a row
 * already includes whatever the layout put above it, so a separator that
 * does not fit hides its whole group (its first row cannot fit under the
 * rail's top edge either), and one that fits never double-counts.
 *
 * @param rows Every registry row measured in the rail's full layout,
 *   registry-ordered (the measure seam's contract; unsorted input is
 *   tolerated — the partitions preserve the input order and the fit rule
 *   is per-row independent).
 * @param availableHeight The rail's content-box height in px (the rail's
 *   own box with the affordance trigger's space already excluded, so the
 *   computation never needs to subtract chrome it cannot see).
 * @returns The visible prefix and the hidden suffix.
 * @throws {@link Error} when `availableHeight` is not a finite
 *   non-negative number, or any measured box is not finite and
 *   non-negative — a broken measurement is a caller bug, never silently
 *   sliced.
 */
export function visibleRowsInRail(
  rows: readonly RailRowBox[],
  availableHeight: number
): RailOverflow {
  if (!Number.isFinite(availableHeight) || availableHeight < 0) {
    throw new Error(
      `visibleRowsInRail: availableHeight must be a finite non-negative number, received ${String(availableHeight)}`
    );
  }
  for (const row of rows) {
    if (!Number.isFinite(row.top) || row.top < 0) {
      throw new Error(
        `visibleRowsInRail: measured top for ${row.route} must be a finite non-negative number, received ${String(row.top)}`
      );
    }
    if (!Number.isFinite(row.height) || row.height < 0) {
      throw new Error(
        `visibleRowsInRail: measured height for ${row.route} must be a finite non-negative number, received ${String(row.height)}`
      );
    }
  }
  const visible = rows.filter((row) => row.top + row.height <= availableHeight);
  const hidden = rows.filter((row) => row.top + row.height > availableHeight);
  return { visible, hidden };
}
