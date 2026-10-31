/**
 * The editor's draft: the exclusion set as the user edits it — per-lane
 * rows with stable ids (row UI state and virtual-list keys follow the id,
 * never the index) plus the feature-wide disables and what is simulated
 * beside them (the mode lanes' modes). Pure and immutable: every
 * edit returns a new draft; the view stores it. Blank rows are unfinished
 * edits, not exclusions: they never reach the set and never show an error.
 * Rows are held in the form WP Rocket's settings save stores them: a row
 * being typed keeps its text (typing is never fought) until it is
 * committed ({@link commitRows} — on leaving the row, on paste/insert, on a
 * candidate pick, on load), when it becomes its stored form or, when the
 * save would drop it, leaves the lane. Each commit returns the per-row diff
 * (with the typed text) so the change can be shown and undone.
 */
import {
  EXCLUSION_FEATURES,
  type ExclusionFeatureSpec,
  type ExclusionSet,
  type ExclusionSetRows,
  type ExclusionSetToggles
} from '../../../lib/exclusion-builder/set';
import { JOINED_ONLY_PROBLEMS } from '../../../lib/exclusion-builder/defer-js-rows';
import type { ProblemId } from '../../../lib/exclusion-builder/pcre/problems';
import { featureRowReading, featureRowWarnings } from '../../../lib/exclusion-builder/validate';
import {
  readRowSave,
  saveExclusionRow,
  saveExclusionRows,
  splitFieldText,
  storedRowKey,
  storedText,
  trimExclusionRow,
  withRowsAhead,
  type RowSaveReading,
  type StoredRowDiff
} from '../../../lib/exclusion-builder/field-text';
import { EXCLUSION_SET_LIMITS, isWireRowText } from '../../../lib/messaging/exclusion-session';
import type { SimulateSpec } from '../../../lib/wp-rocket-simulation/spec';
import {
  SIMULATION_LANE_KEYS,
  laneDisabled,
  laneModeFields,
  laneModeOf,
  laneToggleKey,
  type SimulationLane,
  type SimulationMode
} from './simulation-mode';
import {
  createBoundedMemo,
  detachedString,
  stringBytes,
  type BoundedMemoLimits
} from '../../../utils/bounded-memo';

/** One editor lane = one feature's row list. */
export type LaneKey = keyof ExclusionSetRows;

/** One feature-wide disable. */
export type ToggleKey = keyof ExclusionSetToggles;

/** One editable row. */
export interface DraftRow {
  /** Stable identity for the row's lifetime (list key, focus target). */
  readonly id: string;
  /** The row: as typed while being edited, WP Rocket's stored form once committed. */
  readonly text: string;
}

/** The whole draft. */
export interface Draft {
  readonly rows: Readonly<Record<LaneKey, readonly DraftRow[]>>;
  readonly disable: ExclusionSetToggles;
  /**
   * What to simulate with the set (absent: nothing) — never a feature the
   * draft disables ({@link setLaneMode} and {@link setDisable} keep it so).
   */
  readonly simulate?: SimulateSpec;
}

/** Issues row ids. */
export type IdSource = () => string;

/**
 * A fresh id issuer (one per overlay mount: ids are unique within it).
 *
 * @param prefix Distinguishes issuers in tests and DOM ids.
 */
export function createIdSource(prefix = 'row'): IdSource {
  let next = 0;
  return () => {
    next += 1;
    return `${prefix}-${String(next)}`;
  };
}

/** The lanes in pipeline order (the registry's order). */
export const LANE_ORDER: readonly LaneKey[] = EXCLUSION_FEATURES.map((feature) => feature.rowsKey);

/**
 * The registry row of a lane.
 *
 * @param lane The lane key.
 * @throws {@link Error} for a key outside the registry (a broken caller).
 */
export function laneFeature(lane: LaneKey): ExclusionFeatureSpec {
  const feature = EXCLUSION_FEATURES.find((spec) => spec.rowsKey === lane);
  if (feature === undefined) throw new Error(`Unknown exclusion lane: ${lane}`);
  return feature;
}

/** What a commit did to one row (for the row's note, and to undo it). */
export interface RowCommit {
  readonly lane: LaneKey;
  /** The row's id (a dropped row's former id). */
  readonly id: string;
  /** The row's position in the lane before the commit (where an undo puts a dropped row back). */
  readonly index: number;
  readonly diff: StoredRowDiff;
}

/** A draft after a commit, and what the commit did. */
export interface Committed {
  readonly draft: Draft;
  /** One entry per non-blank row committed, in lane order. */
  readonly commits: readonly RowCommit[];
}

/**
 * Commit rows: each non-blank row of `ids` becomes WP Rocket's stored form,
 * or leaves the lane when the save drops it (empty, `"0"`, a duplicate of
 * another row of the lane — the rows already there win —, a pattern PCRE
 * rejects). Safe-mode and unverified rows stay (their diff says so). Pure;
 * idempotent: committing a stored row changes nothing, and the draft is
 * returned as is when nothing changed.
 *
 * @param draft The draft.
 * @param lane The rows' lane.
 * @param ids The rows to commit (unknown ids are ignored).
 * @param carry Per-row readings to reuse (see {@link RowCarry}).
 */
export function commitRows(
  draft: Draft,
  lane: LaneKey,
  ids: readonly string[],
  carry?: RowCarry
): Committed {
  const commit = startCommit(draft, lane, ids, { carry });
  commit.step(Infinity);
  return commit.result();
}

/**
 * {@link commitRows} run a slice at a time: the same rows, the same order,
 * the same result — for a commit too large for one task (a long paste).
 */
export interface SlicedCommit {
  /**
   * Commit up to `rows` more of the lane's rows (untouched rows pass free).
   *
   * @returns Whether every row is done.
   */
  step(rows: number): boolean;
  /** The commit's result (call once every row is done). */
  result(): Committed;
}

/**
 * Start {@link commitRows} as a {@link SlicedCommit}.
 *
 * @param draft The draft.
 * @param lane The rows' lane.
 * @param ids The rows to commit (unknown ids are ignored).
 * @param hooks `onKept`: told each committed row as it is kept (e.g. to
 *   read it ahead of the draft update, a slice at a time); `carry`: per-row
 *   readings to reuse (see {@link RowCarry}).
 */
export function startCommit(
  draft: Draft,
  lane: LaneKey,
  ids: readonly string[],
  hooks: CommitHooks = {}
): SlicedCommit {
  const rows = draft.rows[lane];
  const lanes = laneCommit(lane, rows, new Set(ids), hooks);
  let at = 0;
  return {
    step(count) {
      for (let done = 0; at < rows.length && done < count; at++) {
        const row = rows[at];
        if (row !== undefined && lanes.commitAt(row, at)) done++;
      }
      return at >= rows.length;
    },
    result() {
      if (at < rows.length) throw new Error(`Commit of ${lane} read before its row ${String(at)}`);
      const { kept, commits } = lanes;
      const changed = kept.length !== rows.length || kept.some((row, index) => row !== rows[index]);
      return { draft: changed ? withLane(draft, lane, kept) : draft, commits };
    }
  };
}

/**
 * One lane's rows after committing `targets` (see {@link commitRows}):
 * untouched rows keep their identity.
 *
 * @param lane The rows' lane.
 * @param rows The lane's rows.
 * @param targets The rows to commit, by id.
 * @param carry Per-row readings to reuse (see {@link RowCarry}).
 */
export function commitLaneRows(
  lane: LaneKey,
  rows: readonly DraftRow[],
  targets: ReadonlySet<string>,
  carry?: RowCarry
): { readonly kept: readonly DraftRow[]; readonly commits: readonly RowCommit[] } {
  const commit = laneCommit(lane, rows, targets, { carry });
  rows.forEach((row, index) => commit.commitAt(row, index));
  return commit;
}

/** What a commit may be given besides its rows (see {@link startCommit}). */
export interface CommitHooks {
  readonly onKept?: (row: DraftRow) => void;
  readonly carry?: RowCarry | undefined;
}

/**
 * The lane commit's running state: the stored forms already ahead (rows
 * not committed now, then each committed row in order), the rows kept and
 * the commits so far.
 *
 * @param lane The rows' lane.
 * @param rows The lane's rows.
 * @param targets The rows to commit, by id.
 * @param hooks See {@link startCommit}.
 */
function laneCommit(
  lane: LaneKey,
  rows: readonly DraftRow[],
  targets: ReadonlySet<string>,
  hooks: CommitHooks = {}
): {
  readonly kept: DraftRow[];
  readonly commits: RowCommit[];
  /** Take the row at `index`; true when it was committed (not passed through). */
  commitAt(row: DraftRow, index: number): boolean;
} {
  const feature = laneFeature(lane).id;
  const { onKept, carry } = hooks;
  // The row's own save: reused from the carry, else read now (a pure reading of its text).
  const reading = (row: DraftRow): RowSaveReading =>
    carry?.save(lane, row) ?? readRowSave(feature, row.text);
  const ahead = new Set<string>();
  for (const row of rows) {
    if (targets.has(row.id) || isBlankRow(row.text)) continue;
    const key = reading(row).form;
    if (key !== null) ahead.add(key);
  }
  const kept: DraftRow[] = [];
  const commits: RowCommit[] = [];
  return {
    kept,
    commits,
    commitAt(row, index) {
      if (!targets.has(row.id) || isBlankRow(row.text)) {
        kept.push(row);
        return false;
      }
      const own = reading(row);
      const diff = withRowsAhead(feature, own, ahead);
      commits.push({ lane, id: row.id, index, diff });
      const stored = storedText(diff);
      // WP Rocket dedupes before its pattern check: a row that check drops
      // still makes a later copy of it a duplicate.
      const key = stored ?? (isDuplicateKeyDrop(diff) ? own.form : null);
      if (key !== null) ahead.add(key);
      if (stored !== null) {
        const keptRow = stored === row.text ? row : { id: row.id, text: stored };
        kept.push(keptRow);
        onKept?.(keptRow);
      }
      return true;
    }
  };
}

/**
 * Whether a dropped row still had a form the dedupe saw (its later copies
 * are duplicates): dropped after the dedupe step, by the pattern check or
 * safe mode — not emptied before it.
 *
 * @param diff A committed row's diff.
 */
function isDuplicateKeyDrop(diff: StoredRowDiff): boolean {
  return (
    diff.state === 'dropped' && (diff.reason === 'invalid-pattern' || diff.reason === 'safe-mode')
  );
}

/**
 * Commit every row of every lane (before an apply: the set must be stored).
 *
 * @param draft The draft.
 * @param carry Per-row readings to reuse (see {@link RowCarry}).
 */
export function commitAll(draft: Draft, carry?: RowCarry): Committed {
  let current = draft;
  const commits: RowCommit[] = [];
  for (const lane of LANE_ORDER) {
    const committed = commitRows(
      current,
      lane,
      current.rows[lane].map((row) => row.id),
      carry
    );
    current = committed.draft;
    commits.push(...committed.commits);
  }
  return { draft: current, commits };
}

/**
 * A draft restored from a set (a saved draft or the active session's set):
 * every lane run through WP Rocket's save, first occurrences kept — so a
 * set saved before rows were stored this way opens in the stored form, and
 * the commits say what changed.
 *
 * @param set The set to edit.
 * @param nextId The id issuer.
 * @param simulate What was simulated with the set (a contradictory one is
 *   dropped: the disable wins, as a stored set reads).
 */
export function restoreDraft(
  set: ExclusionSet,
  nextId: IdSource,
  simulate?: SimulateSpec
): Committed {
  const rows = {} as Record<LaneKey, DraftRow[]>;
  const commits: RowCommit[] = [];
  for (const lane of LANE_ORDER) {
    const typed = nonBlankRows(set.rows[lane]);
    const saved = saveExclusionRows(laneFeature(lane).id, typed);
    const laneRows: DraftRow[] = [];
    saved.diffs.forEach((diff, index) => {
      const id = nextId();
      commits.push({ lane, id, index, diff });
      const stored = storedText(diff);
      if (stored !== null) laneRows.push({ id, text: stored });
    });
    rows[lane] = laneRows;
  }
  const draft: Draft = { rows, disable: { ...set.disable } };
  return { draft: withSimulate(draft, simulate), commits };
}

/**
 * A draft with a simulate spec, each mode lane's part reconciled with the
 * draft's disable (Disabled wins over a contradictory Simulated).
 *
 * @param draft The draft (its own spec replaced).
 * @param simulate The spec (absent: nothing simulated).
 */
function withSimulate(draft: Draft, simulate: SimulateSpec | undefined): Draft {
  let spec = simulate;
  const disable = { ...draft.disable };
  for (const lane of SIMULATION_LANE_KEYS) {
    const fields = laneModeFields(lane, laneModeOf(lane, laneDisabled(disable, lane), spec), spec);
    const key = laneToggleKey(lane);
    if (key !== null) disable[key] = fields.disable;
    spec = fields.simulate;
  }
  return {
    rows: draft.rows,
    disable,
    ...(spec === undefined ? {} : { simulate: spec })
  };
}

/**
 * A draft holding a set's rows in their stored form, and its disables
 * (see {@link restoreDraft}).
 *
 * @param set The set to edit.
 * @param nextId The id issuer.
 * @param simulate What is simulated with the set.
 */
export function draftFromSet(set: ExclusionSet, nextId: IdSource, simulate?: SimulateSpec): Draft {
  return restoreDraft(set, nextId, simulate).draft;
}

/** Whether a row is an unfinished (blank) edit: empty once trimmed. */
export function isBlankRow(text: string): boolean {
  return trimExclusionRow(text) === '';
}

/**
 * A lane's rows without its blank (unfinished) ones, as they are.
 *
 * @param texts The lane's row texts.
 */
export function nonBlankRows(texts: readonly string[]): string[] {
  return texts.filter((text) => !isBlankRow(text));
}

/**
 * The set a draft stands for: its rows as they are (stored form once
 * committed), blank ones left out.
 *
 * @param draft The draft.
 */
export function draftToSet(draft: Draft): ExclusionSet {
  const rows = {} as Record<LaneKey, string[]>;
  for (const lane of LANE_ORDER) {
    rows[lane] = nonBlankRows(draft.rows[lane].map((row) => row.text));
  }
  return { rows, disable: { ...draft.disable } };
}

/**
 * A mode lane's mode a draft stands for.
 *
 * @param draft The draft.
 * @param lane The mode lane.
 */
export function draftLaneMode(draft: Draft, lane: SimulationLane): SimulationMode {
  return laneModeOf(lane, laneDisabled(draft.disable, lane), draft.simulate);
}

/**
 * Set a mode lane's mode: its disable and its simulation together, so the
 * pair never contradicts (the other lanes' modes are kept).
 *
 * @param draft The draft.
 * @param lane The mode lane.
 * @param mode The mode.
 * @throws {@link Error} when the lane does not offer the mode (see `laneModes`).
 */
export function setLaneMode(draft: Draft, lane: SimulationLane, mode: SimulationMode): Draft {
  if (draftLaneMode(draft, lane) === mode) return draft;
  const fields = laneModeFields(lane, mode, draft.simulate);
  const key = laneToggleKey(lane);
  return withSimulate(
    key === null ? draft : { ...draft, disable: { ...draft.disable, [key]: fields.disable } },
    fields.simulate
  );
}

/**
 * Whether two sets hold the same rows (in order) and disables.
 *
 * @param a One set.
 * @param b The other.
 */
export function sameSet(a: ExclusionSet, b: ExclusionSet): boolean {
  return (
    LANE_ORDER.every((lane) => {
      const left = a.rows[lane];
      const right = b.rows[lane];
      return left.length === right.length && left.every((text, index) => text === right[index]);
    }) &&
    a.disable.delayJs === b.disable.delayJs &&
    a.disable.deferJs === b.disable.deferJs &&
    a.disable.lazyRender === b.disable.lazyRender
  );
}

/**
 * Split pasted text into rows the way WP Rocket's field reads it: line
 * breaks normalized as a textarea does (CRLF and a lone CR are LF), split on
 * LF, each line trimmed, lines left empty dropped (committing them stores
 * the rest).
 *
 * @param text The pasted text.
 */
export function splitLines(text: string): string[] {
  return nonBlankRows(splitFieldText(text).map(trimExclusionRow));
}

/** The result of an insertion. */
export interface Inserted {
  readonly draft: Draft;
  /** Ids of the rows actually inserted (fewer than asked at the lane cap). */
  readonly ids: readonly string[];
}

/** Replace one lane's rows. */
function withLane(draft: Draft, lane: LaneKey, rows: readonly DraftRow[]): Draft {
  return { ...draft, rows: { ...draft.rows, [lane]: rows } };
}

/**
 * Insert rows into a lane, after a given row or at the end; the per-lane
 * cap is honored (rows past it are not inserted).
 *
 * @param draft The draft.
 * @param lane The lane.
 * @param texts The rows' texts, in order.
 * @param afterId Insert after this row; `null` appends.
 * @param nextId The id issuer.
 */
export function insertRows(
  draft: Draft,
  lane: LaneKey,
  texts: readonly string[],
  afterId: string | null,
  nextId: IdSource
): Inserted {
  const current = draft.rows[lane];
  const room = Math.max(0, EXCLUSION_SET_LIMITS.rowsPerFeature - current.length);
  const fresh = texts.slice(0, room).map((text) => ({ id: nextId(), text }));
  if (fresh.length === 0) return { draft, ids: [] };
  const at = afterId === null ? -1 : current.findIndex((row) => row.id === afterId);
  const index = at === -1 ? current.length : at + 1;
  return {
    draft: withLane(draft, lane, [...current.slice(0, index), ...fresh, ...current.slice(index)]),
    ids: fresh.map((row) => row.id)
  };
}

/**
 * Put a row back into a lane at `at` (clamped to the lane), keeping its id —
 * an undo of a commit that removed it. Refused (`null`) when the lane is
 * full or already holds the id.
 *
 * @param draft The draft.
 * @param lane The lane.
 * @param row The row to put back (its former id, its typed text).
 * @param at Where it goes (an index into the lane as it is now).
 */
export function reinsertRow(draft: Draft, lane: LaneKey, row: DraftRow, at: number): Draft | null {
  const current = draft.rows[lane];
  if (current.length >= EXCLUSION_SET_LIMITS.rowsPerFeature) return null;
  if (current.some((candidate) => candidate.id === row.id)) return null;
  const index = Math.min(Math.max(0, at), current.length);
  return withLane(draft, lane, [...current.slice(0, index), row, ...current.slice(index)]);
}

/** The part of a row's text a paste replaces (a caret is an empty one). */
export interface RowSelection {
  readonly start: number;
  readonly end: number;
}

/** The result of a paste. */
export interface Pasted extends Inserted {
  /** Pasted lines the lane cap left out (all of them for a full lane). */
  readonly dropped: number;
  /**
   * Where the caret belongs in the last filled row (`ids` last): right after
   * the pasted text, before the row's own text that followed the selection;
   * null when nothing was filled.
   */
  readonly caret: number | null;
}

/**
 * Paste text into a row the way WP Rocket's field would read the result:
 * the row's text before the selection, the pasted text and the row's text
 * after it are joined, then split into lines as the field does
 * ({@link splitFieldText}: any CR/CRLF/LF breaks a line) — whole lines,
 * never fragments, so surrounding spaces are trimmed per line only. The
 * edited row keeps the first line as is (it trims when left, like any typed
 * row), and every further line becomes a row after it, trimmed, blank ones
 * dropped. At the lane cap, pasted lines are dropped — never the line
 * holding the row's text after the selection; a full lane takes none of a
 * multi-line paste (the edited row cannot hold line breaks). `dropped`
 * counts what was left out, so the caller can say so.
 *
 * @param draft The draft.
 * @param lane The row's lane.
 * @param id The row pasted into.
 * @param pasted The pasted text.
 * @param selection Where in the row's text the paste lands.
 * @param nextId Mints the new rows' ids.
 * @returns The draft, the rows the paste filled (the edited one first; none
 *   for an unknown row or a full lane), the lines dropped and the caret.
 */
export function pasteIntoRow(
  draft: Draft,
  lane: LaneKey,
  id: string,
  pasted: string,
  selection: RowSelection,
  nextId: IdSource
): Pasted {
  const row = draft.rows[lane].find((candidate) => candidate.id === id);
  if (row === undefined) return { draft, ids: [], dropped: 0, caret: null };
  const before = row.text.slice(0, selection.start);
  const suffix = row.text.slice(selection.end);
  const [first = '', ...tail] = splitFieldText(before + pasted + suffix);
  if (tail.length === 0) {
    // No line break: the text simply lands in the row.
    return {
      draft: updateRow(draft, lane, id, first),
      ids: [id],
      dropped: 0,
      caret: before.length + pasted.length
    };
  }
  const room = EXCLUSION_SET_LIMITS.rowsPerFeature - draft.rows[lane].length;
  const lines = splitLines(tail.join('\n'));
  if (lines.length > 0 && room <= 0) {
    return { draft, ids: [], dropped: lines.length, caret: null };
  }
  const lastRaw = tail.at(-1) ?? '';
  // The last line holds the row's own text after the selection: kept at the cap.
  const keepsSuffix = suffix !== '' && !isBlankRow(lastRaw);
  const following =
    lines.length <= room
      ? lines
      : keepsSuffix
        ? [...lines.slice(0, room - 1), ...lines.slice(-1)]
        : lines.slice(0, room);
  const inserted = insertRows(updateRow(draft, lane, id, first), lane, following, id, nextId);
  return {
    draft: inserted.draft,
    ids: [id, ...inserted.ids],
    dropped: lines.length - following.length,
    caret: pastedCaret(first, following, lastRaw, suffix, lines.length <= room || keepsSuffix)
  };
}

/**
 * The caret after a multi-line paste: in the last created row, right after
 * the pasted text (before the kept text that followed the selection); at the
 * end of the edited row when no row was created.
 *
 * @param head The edited row's new text.
 * @param following The rows created, trimmed.
 * @param lastRaw The joined text's last line, untrimmed.
 * @param suffix The row's text that followed the selection.
 * @param lastKept Whether the last created row is that last line.
 */
function pastedCaret(
  head: string,
  following: readonly string[],
  lastRaw: string,
  suffix: string,
  lastKept: boolean
): number {
  const last = following.at(-1);
  if (last === undefined) return head.length;
  if (!lastKept || isBlankRow(lastRaw)) return last.length;
  // The trimmed row ends with the suffix trimmed at its end only (the '.'
  // shields its start from the trim).
  const suffixKept = trimExclusionRow(`.${suffix}`).length - 1;
  return Math.max(0, last.length - suffixKept);
}

/**
 * Change one row's text (an unknown id changes nothing).
 *
 * @param draft The draft.
 * @param lane The row's lane.
 * @param id The row.
 * @param text The new text.
 */
export function updateRow(draft: Draft, lane: LaneKey, id: string, text: string): Draft {
  const rows = draft.rows[lane];
  const index = rows.findIndex((row) => row.id === id);
  if (index === -1 || rows[index]?.text === text) return draft;
  return withLane(
    draft,
    lane,
    rows.map((row) => (row.id === id ? { id, text } : row))
  );
}

/** The result of a removal. */
export interface Removed {
  readonly draft: Draft;
  /** The row focus should move to (the previous one, else the next), `null` when the lane is empty. */
  readonly focusId: string | null;
}

/**
 * Remove one row.
 *
 * @param draft The draft.
 * @param lane The row's lane.
 * @param id The row.
 */
export function removeRow(draft: Draft, lane: LaneKey, id: string): Removed {
  const rows = draft.rows[lane];
  const index = rows.findIndex((row) => row.id === id);
  if (index === -1) return { draft, focusId: null };
  const neighbor = rows[index - 1] ?? rows[index + 1] ?? null;
  return {
    draft: withLane(
      draft,
      lane,
      rows.filter((row) => row.id !== id)
    ),
    focusId: neighbor?.id ?? null
  };
}

/**
 * Set one feature-wide disable.
 *
 * @param draft The draft.
 * @param key The toggle.
 * @param value On (feature disabled for the page) or off.
 */
export function setDisable(draft: Draft, key: ToggleKey, value: boolean): Draft {
  if (draft.disable[key] === value) return draft;
  // Disabling a simulated feature ends its simulation (a disabled feature is never simulated).
  return withSimulate({ ...draft, disable: { ...draft.disable, [key]: value } }, draft.simulate);
}

/**
 * What adding a candidate did: `added` (a new row), `present` (a row
 * already holds its stored form), `dropped` (WP Rocket's save drops it),
 * `full` (the lane is at its row cap).
 */
export type CandidateOutcome = 'added' | 'present' | 'dropped' | 'full';

/** The result of adding a picked candidate. */
export interface CandidateAdded {
  readonly draft: Draft;
  /** The row holding the candidate (new, or the one already holding it); null when none. */
  readonly id: string | null;
  readonly outcome: CandidateOutcome;
  /** What WP Rocket's save does with the candidate (its row note). */
  readonly diff: StoredRowDiff;
}

/**
 * The stored rows of a lane, for repeated "does it already hold this
 * candidate" checks ({@link holdsCandidate}).
 *
 * @param draft The draft.
 * @param lane The lane.
 */
export function laneRowSet(draft: Draft, lane: LaneKey): ReadonlySet<string> {
  return new Set(draft.rows[lane].map((row) => row.text));
}

/**
 * Whether a lane already holds a candidate once WP Rocket stores it.
 *
 * @param rows The lane's rows ({@link laneRowSet}).
 * @param lane The lane.
 * @param text The candidate row.
 */
export function holdsCandidate(rows: ReadonlySet<string>, lane: LaneKey, text: string): boolean {
  const key = storedRowKey(laneFeature(lane).id, text);
  return key !== null && rows.has(key);
}

/**
 * The stored forms the lane's non-blank rows stand for.
 *
 * @param draft The draft.
 * @param lane The lane.
 */
function laneKeys(draft: Draft, lane: LaneKey): Map<string, string> {
  const feature = laneFeature(lane).id;
  const keys = new Map<string, string>();
  for (const row of draft.rows[lane]) {
    const key = isBlankRow(row.text) ? null : storedRowKey(feature, row.text);
    if (key !== null && !keys.has(key)) keys.set(key, row.id);
  }
  return keys;
}

/**
 * Add a candidate row to a lane in its stored form, unless the lane already
 * holds it once stored (picking twice never duplicates), the save drops it,
 * or the lane is full.
 *
 * @param draft The draft.
 * @param lane The lane the candidate belongs to.
 * @param text The candidate row.
 * @param nextId The id issuer.
 */
export function addCandidate(
  draft: Draft,
  lane: LaneKey,
  text: string,
  nextId: IdSource
): CandidateAdded {
  const feature = laneFeature(lane).id;
  const keys = laneKeys(draft, lane);
  const diff = saveExclusionRow(feature, text, new Set(keys.keys()));
  // The lane's own check, not the save's dedupe: some saves keep duplicates
  // (Automatic Lazy Rendering), yet a candidate is never added twice.
  const key = storedRowKey(feature, text);
  const holder = key === null ? undefined : keys.get(key);
  if (holder !== undefined) return { draft, id: holder, outcome: 'present', diff };
  const stored = storedText(diff);
  if (stored === null) return { draft, id: null, outcome: 'dropped', diff };
  const inserted = insertRows(draft, lane, [stored], null, nextId);
  const id = inserted.ids[0] ?? null;
  return { draft: inserted.draft, id, outcome: id === null ? 'full' : 'added', diff };
}

/**
 * Characters the set would carry over the wire (non-blank rows, as stored
 * once committed) — checked against the whole-set cap before an apply.
 *
 * @param draft The draft.
 */
export function draftChars(draft: Draft): number {
  return setChars(draftToSet(draft));
}

/**
 * Characters a set carries over the wire (see {@link draftChars}).
 *
 * @param set The set.
 */
export function setChars(set: ExclusionSet): number {
  let chars = 0;
  for (const lane of LANE_ORDER) for (const row of set.rows[lane]) chars += row.length;
  return chars;
}

/**
 * A blank row's warning, or null: a blank row WP Rocket would accept as
 * written that is almost surely a mistake (an Automatic Lazy Rendering row
 * of only whitespace — the editor leaves such a blank row out). Read alone,
 * as typed: only the literal lanes have such rows.
 *
 * @param lane The row's lane.
 * @param text The row as it is.
 */
export function blankRowWarning(lane: LaneKey, text: string): string | null {
  const feature = laneFeature(lane);
  if (feature.rowKind !== 'literal' || !isBlankRow(text)) return null;
  return featureRowWarnings(feature.id, feature.rowKind, [text])[0]?.reason ?? null;
}

/**
 * Why the session would refuse to carry a row at all (the wire contract,
 * checked before the engine), or null.
 *
 * @param text The row as typed (non-blank).
 */
export function wireRowProblem(text: string): string | null {
  const tooLong = text.length > EXCLUSION_SET_LIMITS.rowChars;
  if (isWireRowText(text)) return null;
  return tooLong
    ? `Row is longer than ${String(EXCLUSION_SET_LIMITS.rowChars)} characters — shorten it`
    : 'Row contains a control character or a broken (half) character — retype it';
}

/**
 * What a row check found: a problem that blocks an apply, or a warning that
 * never does (WP Rocket applies the row as stored and so does the preview —
 * e.g. a row matching every script).
 */
export interface RowCheck {
  readonly reason: string;
  readonly blocking: boolean;
}

/**
 * A row's check from its feature's reading of it alone: its blocking
 * problem, else its warning — minus what a row has only joined with the
 * others (`a\Qb` fails Defer JS's check alone, passes next to `zz\E`): the
 * lane's set reading alone reports those.
 *
 * @param lane The row's lane.
 * @param stored The row's stored form.
 */
function storedRowCheck(lane: LaneKey, stored: string): RowCheck | null {
  const feature = laneFeature(lane);
  const reading = featureRowReading(feature.id, feature.rowKind, [stored]);
  const alone = (entry: { readonly problem?: ProblemId }): boolean =>
    entry.problem === undefined || !JOINED_ONLY_PROBLEMS.has(entry.problem);
  const problem = reading.problems.find(alone);
  if (problem !== undefined) return { reason: problem.reason, blocking: true };
  const warning = reading.warnings.find(alone);
  return warning === undefined ? null : { reason: warning.reason, blocking: false };
}

/**
 * A memoizing row validator over the row's stored form (its text before
 * WP Rocket's pattern check — what a commit makes of it): the wire contract
 * (row cap included) on that form, then the engine's own prevalidation of
 * the row alone (see {@link storedRowCheck}), which names a pattern PCRE
 * rejects ("WP Rocket drops this row when saving"), warns on a row matching
 * everything, and never blocks an unverified one. Cached by lane + stored
 * form, so an edit re-validates only the row that changed (the PCRE reading
 * is the costly part). Blank rows, and rows the save empties, have no check
 * (unfinished; a commit removes the latter).
 *
 * @param limits The cache's bounds (default {@link ROW_CHECK_CACHE_LIMITS}).
 * @returns `(lane, text) → check | null`.
 */
export function createRowValidator(
  limits: { readonly entries: number; readonly bytes: number } = ROW_CHECK_CACHE_LIMITS
): RowValidator {
  const cache = createBoundedMemo<RowCheck | null>(rowCheckMemoLimits(limits));
  const blocking = (reason: string | null): RowCheck | null =>
    reason === null ? null : { reason, blocking: true };
  const validate = (lane: LaneKey, typed: string): RowCheck | null => {
    if (isBlankRow(typed)) return null;
    // A broken (half) character is the typed text's own problem: the save would replace it.
    if (!typed.isWellFormed()) return blocking(wireRowProblem(typed));
    const stored = storedRowKey(laneFeature(lane).id, typed);
    if (stored === null) return null;
    const wire = wireRowProblem(stored);
    if (wire !== null) return blocking(wire);
    // The memo keeps a detached key; the check's reason may quote the row, so it is detached too.
    return cache.get(`${lane}\u0000${stored}`, () => detachedCheck(storedRowCheck(lane, stored)));
  };
  return Object.assign(validate, { cached: cache });
}

/** A memoizing row validator (see {@link createRowValidator}). */
export interface RowValidator {
  /**
   * The row's check.
   *
   * @param lane The row's lane.
   * @param text The row as typed.
   * @returns Its check, or null (no problem, or blank/unfinished).
   */
  (lane: LaneKey, text: string): RowCheck | null;
  /** Checks kept now, and their weight in bytes. */
  readonly cached: { readonly size: number; readonly weight: number };
}

/**
 * Per-row readings kept on the draft's row objects. A row object never
 * changes (an edit makes a new one), so its own save and its check are
 * read once per object and reused by every later read — a commit of an
 * unchanged lane, a re-read of every row's problem after a long paste
 * lands — however the bounded memos behind them evicted meanwhile. Kept
 * in a `WeakMap`: a reading lives exactly as long as its row, so the
 * memory is the draft's own, a few small records per row.
 */
export interface RowCarry {
  /**
   * The row's own save in its lane (see `readRowSave`).
   *
   * @param lane The row's lane.
   * @param row The row.
   */
  save(lane: LaneKey, row: DraftRow): RowSaveReading;
  /**
   * The row's check in its lane (see {@link createRowValidator}).
   *
   * @param lane The row's lane.
   * @param row The row.
   */
  check(lane: LaneKey, row: DraftRow): RowCheck | null;
}

/**
 * A save reading whose copies of the row's text are the row's own string:
 * the reading's stages keep detached copies (the typed text, the form, the
 * stored text — all equal to a stored row's text), which a carry would
 * otherwise keep beside the row, tripling its bytes.
 *
 * @param reading The fresh reading.
 * @param text The row's text.
 */
function sharingText(reading: RowSaveReading, text: string): RowSaveReading {
  const own = (value: string): string => (value === text ? text : value);
  const { diff, form } = reading;
  const shared: StoredRowDiff =
    'stored' in diff
      ? { ...diff, typed: own(diff.typed), stored: own(diff.stored) }
      : { ...diff, typed: own(diff.typed) };
  return { diff: shared, form: form === null ? null : own(form) };
}

/** One row object's readings, by lane (a row belongs to one lane; the lane is checked anyway). */
interface CarriedReadings {
  readonly lane: LaneKey;
  save?: RowSaveReading;
  check?: RowCheck | null;
}

/**
 * Build a carry over a row validator.
 *
 * @param validate The validator a row's check is read with on its first read.
 */
export function createRowCarry(
  validate: (lane: LaneKey, text: string) => RowCheck | null
): RowCarry {
  const carried = new WeakMap<DraftRow, CarriedReadings>();
  const entry = (lane: LaneKey, row: DraftRow): CarriedReadings => {
    const known = carried.get(row);
    if (known?.lane === lane) return known;
    const fresh: CarriedReadings = { lane };
    carried.set(row, fresh);
    return fresh;
  };
  return {
    save(lane, row) {
      const readings = entry(lane, row);
      return (readings.save ??= sharingText(readRowSave(laneFeature(lane).id, row.text), row.text));
    },
    check(lane, row) {
      const readings = entry(lane, row);
      if (readings.check === undefined) readings.check = validate(lane, row.text);
      return readings.check;
    }
  };
}

/**
 * The row validator's cache bounds: every validated row of every lane is
 * kept up to these (in the host page's realm), each row up to the wire's
 * row cap — two-byte rows at that cap weigh 4 KiB each, so the bytes bind
 * long before the entries do.
 */
export const ROW_CHECK_CACHE_LIMITS = { entries: 4096, bytes: 1024 * 1024 } as const;

/**
 * Fixed bytes of one kept check (its entries, record and string headers):
 * Chromium retains ≈ 60 B for a short row's; the rest is headroom for a
 * check's record (a long two-byte row with a reason retains within 2 % of
 * its weight).
 */
const ROW_CHECK_ENTRY_BYTES = 192;

/**
 * The bounded-memo limits for the row validator: each entry weighs its
 * fixed cost, its key and its check's reason as Chromium keeps them.
 *
 * @param limits Most entries, most bytes.
 */
function rowCheckMemoLimits(limits: {
  readonly entries: number;
  readonly bytes: number;
}): BoundedMemoLimits<RowCheck | null> {
  return {
    maxEntries: limits.entries,
    maxWeight: limits.bytes,
    weigh: (key, check) =>
      ROW_CHECK_ENTRY_BYTES + stringBytes(key) + (check === null ? 0 : stringBytes(check.reason))
  };
}

/**
 * A check that shares no storage with the row it was read from.
 *
 * @param check The fresh check.
 */
function detachedCheck(check: RowCheck | null): RowCheck | null {
  return check === null ? null : { reason: detachedString(check.reason), blocking: check.blocking };
}
