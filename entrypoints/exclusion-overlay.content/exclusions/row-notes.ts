/**
 * What the editor tells about committed rows — WP Rocket's settings save
 * applied at commit, never silently: per kept row, how WP Rocket stores it
 * (the note under the row); per lane, the rows the save removed (the
 * lane's outcome slot) and a batch's summary; and the latest commit batch
 * (what to announce). Every note that changed a row offers an undo until
 * the next edit in its lane. Pure and immutable, keyed by row id (notes
 * outlive virtual rows); the controller owns the one instance.
 *
 * Lifetimes: a row's note lasts until that row is edited or removed (a
 * commit that leaves the row as it is — leaving it again, an arrow pass,
 * an apply — keeps it); removed-row notes and the summary last until the
 * next edit in the lane; undo ends with the next edit in the lane (a
 * commit or an undo is not an edit).
 *
 * Row numbers a note shows ("a copy of row N", "Restore removed row N")
 * are read from the lane as it is now, never kept from the commit.
 */
import {
  storedRowKey,
  storedText,
  type StoredRowDiff
} from '../../../lib/exclusion-builder/field-text';
import {
  LANE_ORDER,
  laneFeature,
  type Draft,
  type DraftRow,
  type LaneKey,
  type RowCommit
} from './draft';

/** What made a commit (the announcement's wording). */
export type CommitSource = 'row' | 'insert' | 'paste' | 'candidate' | 'restore' | 'apply';

/** A kept row's diff. */
export type KeptRowDiff = Exclude<StoredRowDiff, { readonly state: 'dropped' }>;

/** A removed row's diff. */
export type DroppedRowDiff = Extract<StoredRowDiff, { readonly state: 'dropped' }>;

/** The note under a kept row. */
export interface RowNote {
  readonly diff: KeptRowDiff;
  /** Undo restores the typed text (only when the commit changed it). */
  readonly undoable: boolean;
}

/**
 * A row the save removed, and where it goes back: right after its anchor
 * (the row that preceded it and stayed), past the rows removed before it
 * under the same anchor that are back already — so restores land in place
 * whatever their order, across batches too.
 */
export interface RemovedNote {
  /** The row's former id (an undo puts it back under it). */
  readonly id: string;
  /** The nearest row before it that the commit kept; `null` = the lane's start. */
  readonly anchor: string | null;
  /** Rows removed before it under the same anchor (they go back ahead of it). */
  readonly before: readonly string[];
  /** Its index before the commit (the fallback place when its anchor is gone). */
  readonly index: number;
  readonly diff: DroppedRowDiff;
}

/** A batch's count, shown when it changed more than one row of a lane. */
export interface BatchSummary {
  readonly source: CommitSource;
  /** Rows kept in another form than typed. */
  readonly changed: number;
  readonly removed: number;
}

/** One lane's notes. */
export interface LaneNotes {
  readonly rows: ReadonlyMap<string, RowNote>;
  /** Undoable removals, oldest first (cleared by the next lane edit). */
  readonly removed: readonly RemovedNote[];
  readonly summary: BatchSummary | null;
}

/** One committed row worth telling about. */
export interface CommitNews {
  readonly lane: LaneKey;
  /** 1-based: a kept row's position now, a removed row's former one. */
  readonly position: number;
  readonly diff: StoredRowDiff;
  /** For a duplicate: the 1-based row it copies. */
  readonly copyOf: number | null;
}

/** The latest batch with news (a fresh object per batch: the announcement trigger). */
export interface LatestCommits {
  readonly source: CommitSource;
  readonly news: readonly CommitNews[];
}

/** Every lane's notes, and the latest batch. */
export interface DraftNotes {
  readonly lanes: Readonly<Record<LaneKey, LaneNotes>>;
  readonly latest: LatestCommits | null;
}

/** A lane without notes. */
const EMPTY_LANE: LaneNotes = { rows: new Map(), removed: [], summary: null };

/** No notes. */
export const EMPTY_DRAFT_NOTES: DraftNotes = {
  lanes: Object.fromEntries(LANE_ORDER.map((lane) => [lane, EMPTY_LANE])) as Record<
    LaneKey,
    LaneNotes
  >,
  latest: null
};

/**
 * Whether a commit is worth a note: the row changed, left, or carries a
 * condition (unverified, safe mode). A row stored exactly as typed is not.
 *
 * @param diff The committed row's diff.
 */
export function isNews(diff: StoredRowDiff): boolean {
  return diff.state !== 'unchanged' || diff.dropsInSafeMode === true;
}

/**
 * Whether a commit changed the row (its text, or its presence) — what is
 * announced and what can be undone.
 *
 * @param diff The committed row's diff.
 */
export function isConversion(diff: StoredRowDiff): boolean {
  const stored = storedText(diff);
  return stored === null || stored !== diff.typed;
}

/**
 * The 0-based index of the first row holding each stored form in a lane —
 * one pass, so naming the copied row of every duplicate costs O(rows).
 *
 * @param lane The lane's feature lane.
 * @param rows The lane's rows.
 */
export function laneKeyIndex(
  lane: LaneKey,
  rows: readonly DraftRow[]
): ReadonlyMap<string, number> {
  const feature = laneFeature(lane).id;
  const index = new Map<string, number>();
  rows.forEach((row, at) => {
    const key = storedRowKey(feature, row.text);
    if (key !== null && !index.has(key)) index.set(key, at);
  });
  return index;
}

/**
 * The 1-based row a removed duplicate copies, in the lane as it is.
 *
 * @param lane The lane.
 * @param keys The lane's {@link laneKeyIndex}.
 * @param diff The removed row's diff.
 * @returns `null` for another reason, or when no row holds its form any more.
 */
export function copiedRow(
  lane: LaneKey,
  keys: ReadonlyMap<string, number>,
  diff: DroppedRowDiff
): number | null {
  if (diff.reason !== 'duplicate') return null;
  const key = storedRowKey(laneFeature(lane).id, diff.typed);
  const at = key === null ? undefined : keys.get(key);
  return at === undefined ? null : at + 1;
}

/**
 * Where a removed row goes back in the lane as it is now (0-based): after
 * its anchor — or where its anchor would go back, when that was removed
 * too — past the rows removed before it under that anchor that are back.
 * Falls back to its former index (clamped) when its anchor is gone for
 * another reason.
 *
 * @param note The removed row.
 * @param removed The lane's removal notes (to follow a removed anchor).
 * @param rows The lane's rows now.
 */
export function restoreIndex(
  note: RemovedNote,
  removed: readonly RemovedNote[],
  rows: readonly DraftRow[]
): number {
  let at: number;
  if (note.anchor === null) at = 0;
  else {
    const anchor = note.anchor;
    const present = rows.findIndex((row) => row.id === anchor);
    const anchorNote = removed.find((other) => other.id === anchor);
    if (present !== -1) at = present + 1;
    else if (anchorNote !== undefined) at = restoreIndex(anchorNote, removed, rows);
    else at = Math.min(note.index, rows.length);
  }
  const back = new Set(note.before);
  while (at < rows.length && back.has(rows[at]?.id ?? '')) at += 1;
  return at;
}

/** Replace one lane's notes. */
function withLane(notes: DraftNotes, lane: LaneKey, next: LaneNotes): DraftNotes {
  return { ...notes, lanes: { ...notes.lanes, [lane]: next } };
}

/**
 * The removal notes of one lane's batch: each dropped row's anchor (the
 * nearest row before it that stayed — its index less the drops before it
 * gives its place among the kept rows) and the rows removed before it under
 * that anchor, this batch's and earlier ones'.
 *
 * @param drops The lane's dropped commits, in lane order.
 * @param rows The lane's rows after the commit.
 * @param earlier The lane's removal notes so far.
 */
function removalNotes(
  drops: readonly (RowCommit & { readonly diff: DroppedRowDiff })[],
  rows: readonly DraftRow[],
  earlier: readonly RemovedNote[]
): RemovedNote[] {
  const notes: RemovedNote[] = [];
  drops.forEach((commit, dropsBefore) => {
    const kept = commit.index - dropsBefore;
    const anchor = kept > 0 ? (rows[kept - 1]?.id ?? null) : null;
    const before = [...earlier, ...notes]
      .filter((other) => other.anchor === anchor && other.id !== commit.id)
      .map((other) => other.id);
    notes.push({ id: commit.id, anchor, before, index: commit.index, diff: commit.diff });
  });
  return notes;
}

/**
 * Record a commit batch: notes for its rows, removals, the lane summaries
 * and the batch to announce. A row the batch left as it was keeps its note
 * (a commit is not an edit); a batch without news changes nothing.
 *
 * @param notes The current notes.
 * @param commits The batch (every row committed, in lane order).
 * @param source What made it.
 * @param draft The draft after the commit.
 */
export function recordCommits(
  notes: DraftNotes,
  commits: readonly RowCommit[],
  source: CommitSource,
  draft: Draft
): DraftNotes {
  const newsful = commits.filter((commit) => isNews(commit.diff));
  if (newsful.length === 0) return notes;
  const lanes = { ...notes.lanes };
  const news: CommitNews[] = [];
  for (const lane of LANE_ORDER) {
    const laneCommits = newsful.filter((commit) => commit.lane === lane);
    if (laneCommits.length === 0) continue;
    const rows = draft.rows[lane];
    const current = lanes[lane];
    const notedRows = new Map(current.rows);
    const drops = laneCommits.filter(
      (commit): commit is RowCommit & { readonly diff: DroppedRowDiff } =>
        commit.diff.state === 'dropped'
    );
    // Built once per lane and batch, only when a duplicate needs its row.
    const keys = drops.some((commit) => commit.diff.reason === 'duplicate')
      ? laneKeyIndex(lane, rows)
      : new Map<string, number>();
    const removed = removalNotes(drops, rows, current.removed);
    const removedIds = new Set(removed.map((note) => note.id));
    const positions = new Map(rows.map((row, at) => [row.id, at + 1]));
    for (const commit of laneCommits) {
      const { diff } = commit;
      if (diff.state === 'dropped') {
        notedRows.delete(commit.id);
        const copyOf = copiedRow(lane, keys, diff);
        news.push({ lane, position: commit.index + 1, diff, copyOf });
      } else {
        notedRows.set(commit.id, { diff, undoable: isConversion(diff) });
        news.push({ lane, position: positions.get(commit.id) ?? 0, diff, copyOf: null });
      }
    }
    // A batch of one change keeps the lane's summary (a paste's last row
    // commits on its own, after the paste's batch).
    const summary = summaryOf(news, lane, source) ?? current.summary;
    lanes[lane] = {
      rows: notedRows,
      removed: [...current.removed.filter((note) => !removedIds.has(note.id)), ...removed],
      summary
    };
  }
  return { lanes, latest: { source, news } };
}

/**
 * A lane's batch summary, when the batch changed more than one of its rows.
 *
 * @param news The batch's news.
 * @param lane The lane.
 * @param source What made the batch.
 */
function summaryOf(
  news: readonly CommitNews[],
  lane: LaneKey,
  source: CommitSource
): BatchSummary | null {
  let changed = 0;
  let removed = 0;
  for (const item of news) {
    if (item.lane !== lane || !isConversion(item.diff)) continue;
    if (item.diff.state === 'dropped') removed += 1;
    else changed += 1;
  }
  return changed + removed > 1 ? { source, changed, removed } : null;
}

/**
 * An edit in a lane: its undos end, its removal notes and summary leave
 * (the row notes stay, without undo). Identity when there is nothing to retire.
 *
 * @param notes The notes.
 * @param lane The edited lane.
 */
export function retireLane(notes: DraftNotes, lane: LaneKey): DraftNotes {
  const current = notes.lanes[lane];
  const undoable = [...current.rows.values()].some((note) => note.undoable);
  if (!undoable && current.removed.length === 0 && current.summary === null) return notes;
  const rows = new Map<string, RowNote>();
  for (const [id, note] of current.rows)
    rows.set(id, note.undoable ? { ...note, undoable: false } : note);
  return withLane(notes, lane, { rows, removed: [], summary: null });
}

/**
 * A row was edited or removed: its note leaves (the "you typed" part lives
 * only until the row's next edit), and the lane's undos end.
 *
 * @param notes The notes.
 * @param lane The row's lane.
 * @param id The row.
 */
export function forgetRow(notes: DraftNotes, lane: LaneKey, id: string): DraftNotes {
  const retired = retireLane(notes, lane);
  const current = retired.lanes[lane];
  if (!current.rows.has(id)) return retired;
  const rows = new Map(current.rows);
  rows.delete(id);
  return withLane(retired, lane, { ...current, rows });
}

/** What an undo puts back. */
export type UndoTarget =
  /** The row's typed text, back in the row. */
  | { readonly kind: 'row'; readonly id: string; readonly typed: string }
  /** A removed row, back at `at` (an index into the lane as it is now). */
  | { readonly kind: 'removed'; readonly id: string; readonly typed: string; readonly at: number };

/**
 * Take a note's undo: the note leaves (leaving the row again commits it,
 * with the same note) and the target says what to put back — a removed
 * row at {@link restoreIndex}.
 *
 * @param notes The notes.
 * @param lane The lane.
 * @param id The row (or the removed row's former id).
 * @param rows The lane's rows now.
 * @returns The notes without that note and the target, or `null` when it has no undo.
 */
export function takeUndo(
  notes: DraftNotes,
  lane: LaneKey,
  id: string,
  rows: readonly DraftRow[]
): { readonly notes: DraftNotes; readonly target: UndoTarget } | null {
  const current = notes.lanes[lane];
  const note = current.rows.get(id);
  if (note !== undefined) {
    if (!note.undoable) return null;
    const kept = new Map(current.rows);
    kept.delete(id);
    return {
      notes: withLane(notes, lane, { ...current, rows: kept }),
      target: { kind: 'row', id, typed: note.diff.typed }
    };
  }
  const removed = current.removed.find((candidate) => candidate.id === id);
  if (removed === undefined) return null;
  return {
    notes: withLane(notes, lane, {
      ...current,
      removed: current.removed.filter((candidate) => candidate !== removed),
      summary: null
    }),
    target: {
      kind: 'removed',
      id,
      typed: removed.diff.typed,
      at: restoreIndex(removed, current.removed, rows)
    }
  };
}
