/**
 * A lane's rows read as one set, the way WP Rocket runs them on the page —
 * for lanes whose rows act together (Defer JS joins them into one pattern,
 * with a pre-check that can turn the feature off for the whole page).
 *
 * The rows are read as the lane will hold them once its uncommitted rows
 * are committed — the same commit the editor runs (a typed copy of a row
 * leaves, the rows already there win; rows the save drops leave) — so the
 * rows named are the rows that stay. After an apply's commit the set read
 * here is exactly the one the session validates: the editor and the
 * session agree on every row problem, every warning and on the page state.
 */
import { deferRowSet } from '../../../lib/exclusion-builder/defer-js-rows';
import { isBlockingProblem, type InvalidExclusionRow } from '../../../lib/exclusion-builder/errors';
import { storedRowKey } from '../../../lib/exclusion-builder/field-text';
import type { PageState } from '../../../lib/exclusion-builder/pcre/rows';
import {
  commitLaneRows,
  isBlankRow,
  laneFeature,
  type DraftRow,
  type LaneKey,
  type RowCheck
} from './draft';

/** A row behind a page-wide failure, named the way the lane message shows it. */
export interface PageOffRow {
  /** The draft row. */
  readonly id: string;
  /** Its 1-based position in the lane (what the row's own label says). */
  readonly position: number;
  /** Its stored form (the text the set reading saw). */
  readonly stored: string;
}

/** What a lane's rows do together on the page. */
export interface LanePage {
  /** The feature's page state under the rows (`off`: WP Rocket would not run it on the page). */
  readonly page: PageState;
  /** The rows behind an `off` page, in lane order (empty otherwise). */
  readonly offRows: readonly PageOffRow[];
  /** Every row problem the set reading names that blocks an apply, by draft row id. */
  readonly problems: ReadonlyMap<string, string>;
  /**
   * Every row the set reading names that only warns (applied as WP Rocket
   * applies it: the page-off rows, rows matching every script), by draft row id.
   */
  readonly warnings: ReadonlyMap<string, string>;
}

/** A set reading of stored rows: named rows by stored index, page state, page-off rows. */
interface StoredSetReading {
  readonly problems: readonly Pick<InvalidExclusionRow, 'index' | 'reason' | 'problem'>[];
  readonly page: PageState;
  readonly pageOffRows: readonly number[];
}

/** A lane's reading of its stored rows as one set. */
type SetReading = (stored: readonly string[]) => StoredSetReading;

/** The lanes whose rows WP Rocket reads as one set (add a lane = add a row). */
const SET_READINGS: Partial<Readonly<Record<LaneKey, SetReading>>> = {
  deferJs: deferRowSet
};

/**
 * Whether a lane's rows are read as one set (see {@link lanePage}).
 *
 * @param lane The lane.
 */
export function readsAsSet(lane: LaneKey): boolean {
  return SET_READINGS[lane] !== undefined;
}

/**
 * The lane's rows still to commit: those the editor holds uncommitted
 * (edited since their last commit), plus any non-blank row that is not its
 * own stored form (a commit would change it) — per-row stages memoized, so
 * a keystroke re-saves only the row it changed.
 *
 * @param lane The lane.
 * @param rows Its rows.
 * @param uncommitted Rows the editor holds uncommitted, by id.
 */
function commitTargets(
  lane: LaneKey,
  rows: readonly DraftRow[],
  uncommitted: ReadonlySet<string>
): ReadonlySet<string> {
  const feature = laneFeature(lane).id;
  const targets = new Set<string>();
  for (const row of rows) {
    if (isBlankRow(row.text)) continue;
    if (uncommitted.has(row.id) || storedRowKey(feature, row.text) !== row.text)
      targets.add(row.id);
  }
  return targets;
}

/**
 * A lane's rows read as one set, or `null` for a lane whose rows act alone.
 *
 * @param lane The lane.
 * @param rows Its rows.
 * @param uncommitted Rows the editor holds uncommitted (edited since their
 *   last commit), by id: their commit runs against the rows already there.
 */
export function lanePage(
  lane: LaneKey,
  rows: readonly DraftRow[],
  uncommitted: ReadonlySet<string> = new Set()
): LanePage | null {
  const read = SET_READINGS[lane];
  if (read === undefined) return null;
  const { kept } = commitLaneRows(lane, rows, commitTargets(lane, rows, uncommitted));
  // Committed rows never repeat one another; should two still match, the
  // first stays (as the apply's commit of every row decides).
  const seen = new Set<string>();
  const stored = kept.filter((row) => {
    if (isBlankRow(row.text) || seen.has(row.text)) return false;
    seen.add(row.text);
    return true;
  });
  const positions = new Map(rows.map((row, index) => [row.id, index + 1]));
  const set = read(stored.map((row) => row.text));
  const problems = new Map<string, string>();
  const warnings = new Map<string, string>();
  for (const entry of set.problems) {
    const owner = stored[entry.index];
    if (owner !== undefined) {
      (isBlockingProblem(entry) ? problems : warnings).set(owner.id, entry.reason);
    }
  }
  const offRows = set.pageOffRows.flatMap((index): PageOffRow[] => {
    const owner = stored[index];
    const position = owner === undefined ? undefined : positions.get(owner.id);
    return owner === undefined || position === undefined
      ? []
      : [{ id: owner.id, position, stored: owner.text }];
  });
  return { page: set.page, offRows, problems, warnings };
}

/** What the editor says of one row: its blocking problem, else its warning (never both). */
export interface RowVerdict {
  readonly problem: string | null;
  readonly warning: string | null;
}

/**
 * One row's verdict from its lane's set reading and its own check: the set
 * reading's verdict on a row it read wins (problems and warnings that exist
 * only joined, and rows it reads as warnings); else the row alone decides.
 * The editor's one composition — and the one the session's prevalidation
 * agrees with.
 *
 * @param page The lane's set reading (`null`: its rows act alone, or not read yet).
 * @param id The row's id.
 * @param check The row's own check (see `createRowValidator`).
 */
export function rowVerdict(page: LanePage | null, id: string, check: RowCheck | null): RowVerdict {
  const problem = page?.problems.get(id);
  if (problem !== undefined) return { problem, warning: null };
  const warning = page?.warnings.get(id);
  if (warning !== undefined) return { problem: null, warning };
  if (check === null) return { problem: null, warning: null };
  return check.blocking
    ? { problem: check.reason, warning: null }
    : { problem: null, warning: check.reason };
}
