/**
 * What the editor tells about committed rows — WP Rocket's settings save
 * applied at commit, never silently: per kept row, how WP Rocket stores it
 * (the note under the row); per lane, the rows the save removed (the
 * lane's outcome slot) and a batch's summary; and the latest commit batch
 * (what to announce). Every note that changed a row offers an undo until
 * the next edit in its lane. Pure and immutable, keyed by row id (notes
 * outlive virtual rows); the controller owns the one instance.
 *
 * Lifetimes: a row's note lasts until that row is edited, removed, or
 * committed again unchanged; removed-row notes and the summary last until
 * the next edit in the lane; undo ends with the next edit in the lane
 * (another commit or an undo is not an edit — a paste's batch stays
 * undoable while its last row is committed).
 */
import {
  storedRowKey,
  storedText,
  type StoredRowDiff
} from '../../../lib/exclusion-builder/field-text';
import { LANE_ORDER, laneFeature, type Draft, type LaneKey, type RowCommit } from './draft';

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

/** A row the save removed. */
export interface RemovedNote {
  /** The row's former id (an undo puts it back under it). */
  readonly id: string;
  /** Its position in the lane before the commit (0-based). */
  readonly index: number;
  /** The commit batch that removed it. */
  readonly batch: number;
  readonly diff: DroppedRowDiff;
  /** For a duplicate: the 1-based row it copies, when still found. */
  readonly copyOf: number | null;
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
  /** The last batch number issued. */
  readonly batch: number;
}

/** A lane without notes. */
const EMPTY_LANE: LaneNotes = { rows: new Map(), removed: [], summary: null };

/** No notes. */
export const EMPTY_DRAFT_NOTES: DraftNotes = {
  lanes: Object.fromEntries(LANE_ORDER.map((lane) => [lane, EMPTY_LANE])) as Record<
    LaneKey,
    LaneNotes
  >,
  latest: null,
  batch: 0
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
 * The 1-based row a dropped duplicate copies, in the lane as committed.
 *
 * @param draft The committed draft.
 * @param lane The lane.
 * @param typed The duplicate as typed.
 */
function copiedRow(draft: Draft, lane: LaneKey, typed: string): number | null {
  const feature = laneFeature(lane).id;
  const key = storedRowKey(feature, typed);
  if (key === null) return null;
  const index = draft.rows[lane].findIndex((row) => storedRowKey(feature, row.text) === key);
  return index === -1 ? null : index + 1;
}

/** Replace one lane's notes. */
function withLane(notes: DraftNotes, lane: LaneKey, next: LaneNotes): DraftNotes {
  return { ...notes, lanes: { ...notes.lanes, [lane]: next } };
}

/**
 * Record a commit batch: notes for its rows, removals, the lane summaries
 * and the batch to announce. A batch without news changes nothing but the
 * notes of rows recommitted unchanged (they lose a stale note).
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
  const batch = notes.batch + 1;
  const lanes = { ...notes.lanes };
  const news: CommitNews[] = [];
  const touched = new Set<LaneKey>();
  for (const commit of commits) {
    const lane = lanes[commit.lane];
    const rows = new Map(lane.rows);
    const { diff } = commit;
    if (!isNews(diff)) {
      if (!rows.delete(commit.id)) continue;
      lanes[commit.lane] = { ...lane, rows };
      continue;
    }
    touched.add(commit.lane);
    if (diff.state === 'dropped') {
      rows.delete(commit.id);
      const copyOf = diff.reason === 'duplicate' ? copiedRow(draft, commit.lane, diff.typed) : null;
      const removed = { id: commit.id, index: commit.index, batch, diff, copyOf };
      lanes[commit.lane] = { ...lane, rows, removed: [...lane.removed, removed] };
      news.push({ lane: commit.lane, position: commit.index + 1, diff, copyOf });
      continue;
    }
    rows.set(commit.id, { diff, undoable: isConversion(diff) });
    lanes[commit.lane] = { ...lane, rows };
    const position = draft.rows[commit.lane].findIndex((row) => row.id === commit.id) + 1;
    news.push({ lane: commit.lane, position, diff, copyOf: null });
  }
  // A batch of one change keeps the lane's summary (a paste's last row
  // commits on its own, after the paste's batch).
  for (const lane of touched) {
    const summary = summaryOf(news, lane, source);
    if (summary !== null) lanes[lane] = { ...lanes[lane], summary };
  }
  return news.length === 0 ? { ...notes, lanes } : { lanes, latest: { source, news }, batch };
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
 * with the same note) and the target says what to put back. A removed row
 * goes back where it was: its former index, less the rows its batch removed
 * before it that are still out.
 *
 * @param notes The notes.
 * @param lane The lane.
 * @param id The row (or the removed row's former id).
 * @returns The notes without that note and the target, or `null` when it has no undo.
 */
export function takeUndo(
  notes: DraftNotes,
  lane: LaneKey,
  id: string
): { readonly notes: DraftNotes; readonly target: UndoTarget } | null {
  const current = notes.lanes[lane];
  const note = current.rows.get(id);
  if (note !== undefined) {
    if (!note.undoable) return null;
    const rows = new Map(current.rows);
    rows.delete(id);
    return {
      notes: withLane(notes, lane, { ...current, rows }),
      target: { kind: 'row', id, typed: note.diff.typed }
    };
  }
  const removed = current.removed.find((candidate) => candidate.id === id);
  if (removed === undefined) return null;
  const before = current.removed.filter(
    (other) => other.batch === removed.batch && other.index < removed.index
  ).length;
  return {
    notes: withLane(notes, lane, {
      ...current,
      removed: current.removed.filter((candidate) => candidate !== removed),
      summary: null
    }),
    target: { kind: 'removed', id, typed: removed.diff.typed, at: removed.index - before }
  };
}
