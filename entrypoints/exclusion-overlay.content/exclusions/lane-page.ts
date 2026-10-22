/**
 * A lane's rows read as one set, the way WP Rocket runs them on the page —
 * for lanes whose rows act together (Defer JS joins them into one pattern,
 * with a pre-check that can turn the feature off for the whole page). The
 * draft holds typed rows while they are edited, so each row is read in the
 * form WP Rocket's save gives it (rows the save drops are left out, as they
 * would be once committed): after an apply's commit the set read here is
 * exactly the one the session validates, so the editor and the session
 * agree on every row problem and on the page state.
 */
import { deferRowSet } from '../../../lib/exclusion-builder/defer-js-rows';
import { saveExclusionRows, storedText } from '../../../lib/exclusion-builder/field-text';
import type { PageState } from '../../../lib/exclusion-builder/pcre/rows';
import type { ExclusionFeatureId } from '../../../lib/exclusion-builder/set';
import { isBlankRow, laneFeature, type DraftRow, type LaneKey } from './draft';

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
  /** Every row problem the set reading names, by draft row id. */
  readonly problems: ReadonlyMap<string, string>;
}

/** A set reading of stored rows: problems by stored index, page state, page-off rows. */
interface StoredSetReading {
  readonly problems: readonly { readonly index: number; readonly reason: string }[];
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
 * Read a lane's rows as one set.
 *
 * @param feature The lane's feature (whose save gives the stored form).
 * @param rows The lane's rows (typed or committed; blank rows are unfinished edits).
 * @param read The lane's set reading.
 */
function readRows(
  feature: ExclusionFeatureId,
  rows: readonly DraftRow[],
  read: SetReading
): LanePage {
  const filled = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !isBlankRow(row.text));
  const { diffs } = saveExclusionRows(
    feature,
    filled.map(({ row }) => row.text)
  );
  // The stored rows, each with the lane position it came from.
  const stored: { readonly text: string; readonly row: DraftRow; readonly index: number }[] = [];
  diffs.forEach((diff, at) => {
    const text = storedText(diff);
    const owner = filled[at];
    if (text !== null && owner !== undefined) stored.push({ text, ...owner });
  });
  const set = read(stored.map(({ text }) => text));
  const problems = new Map<string, string>();
  for (const { index, reason } of set.problems) {
    const owner = stored[index];
    if (owner !== undefined) problems.set(owner.row.id, reason);
  }
  const offRows = set.pageOffRows.flatMap((index): PageOffRow[] => {
    const owner = stored[index];
    return owner === undefined
      ? []
      : [{ id: owner.row.id, position: owner.index + 1, stored: owner.text }];
  });
  return { page: set.page, offRows, problems };
}

/**
 * A lane's rows read as one set, or `null` for a lane whose rows act alone.
 *
 * @param lane The lane.
 * @param rows Its rows.
 */
export function lanePage(lane: LaneKey, rows: readonly DraftRow[]): LanePage | null {
  const read = SET_READINGS[lane];
  return read === undefined ? null : readRows(laneFeature(lane).id, rows, read);
}
