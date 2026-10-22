/**
 * The editor's draft: the exclusion set as the user edits it — per-lane
 * rows with stable ids (row UI state and virtual-list keys follow the id,
 * never the index) plus the feature-wide disables. Pure and immutable: every
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
import { featureRowProblems } from '../../../lib/exclusion-builder/validate';
import {
  saveExclusionRow,
  saveExclusionRows,
  splitFieldText,
  storedRowKey,
  storedText,
  trimExclusionRow,
  type StoredRowDiff
} from '../../../lib/exclusion-builder/field-text';
import { EXCLUSION_SET_LIMITS, isWireRowText } from '../../../lib/messaging/exclusion-session';

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
 */
export function commitRows(draft: Draft, lane: LaneKey, ids: readonly string[]): Committed {
  const feature = laneFeature(lane).id;
  const targets = new Set(ids);
  const rows = draft.rows[lane];
  const ahead = new Set<string>();
  for (const row of rows) {
    if (targets.has(row.id) || isBlankRow(row.text)) continue;
    const key = storedRowKey(feature, row.text);
    if (key !== null) ahead.add(key);
  }
  const commits: RowCommit[] = [];
  const kept = rows.flatMap((row, index): DraftRow[] => {
    if (!targets.has(row.id) || isBlankRow(row.text)) return [row];
    const diff = saveExclusionRow(feature, row.text, ahead);
    commits.push({ lane, id: row.id, index, diff });
    const stored = storedText(diff);
    if (stored === null) return [];
    ahead.add(stored);
    return [stored === row.text ? row : { id: row.id, text: stored }];
  });
  const changed = kept.length !== rows.length || kept.some((row, index) => row !== rows[index]);
  return { draft: changed ? withLane(draft, lane, kept) : draft, commits };
}

/**
 * Commit every row of every lane (before an apply: the set must be stored).
 *
 * @param draft The draft.
 */
export function commitAll(draft: Draft): Committed {
  let current = draft;
  const commits: RowCommit[] = [];
  for (const lane of LANE_ORDER) {
    const committed = commitRows(
      current,
      lane,
      current.rows[lane].map((row) => row.id)
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
 */
export function restoreDraft(set: ExclusionSet, nextId: IdSource): Committed {
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
  return { draft: { rows, disable: { ...set.disable } }, commits };
}

/**
 * A draft holding a set's rows in their stored form, and its disables
 * (see {@link restoreDraft}).
 *
 * @param set The set to edit.
 * @param nextId The id issuer.
 */
export function draftFromSet(set: ExclusionSet, nextId: IdSource): Draft {
  return restoreDraft(set, nextId).draft;
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
  return draft.disable[key] === value
    ? draft
    : { ...draft, disable: { ...draft.disable, [key]: value } };
}

/** The result of adding a picked candidate. */
export interface CandidateAdded {
  readonly draft: Draft;
  /** The row holding the candidate (new, or the one already holding it); null when none. */
  readonly id: string | null;
  /** `false` when the row already existed, the save drops it, or the lane is full. */
  readonly added: boolean;
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
 * holds it once stored (picking twice never duplicates) or the save drops it.
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
  const keys = laneKeys(draft, lane);
  const diff = saveExclusionRow(laneFeature(lane).id, text, new Set(keys.keys()));
  const stored = storedText(diff);
  if (stored === null) {
    const key =
      diff.state === 'dropped' && diff.reason === 'duplicate'
        ? storedRowKey(laneFeature(lane).id, text)
        : null;
    return { draft, id: key === null ? null : (keys.get(key) ?? null), added: false, diff };
  }
  const inserted = insertRows(draft, lane, [stored], null, nextId);
  const id = inserted.ids[0] ?? null;
  return { draft: inserted.draft, id, added: id !== null, diff };
}

/**
 * Characters the set would carry over the wire (non-blank rows, as stored
 * once committed) — checked against the whole-set cap before an apply.
 *
 * @param draft The draft.
 */
export function draftChars(draft: Draft): number {
  let chars = 0;
  const set = draftToSet(draft);
  for (const lane of LANE_ORDER) for (const row of set.rows[lane]) chars += row.length;
  return chars;
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
 * A memoizing row validator over the row's stored form (its text before
 * WP Rocket's pattern check — what a commit makes of it): the wire contract
 * (row cap included) on that form, then the engine's own prevalidation,
 * which names a pattern PCRE rejects ("WP Rocket drops this row when
 * saving") and never blocks an unverified one. Cached by lane + stored form,
 * so an edit re-validates only the row that changed (the PCRE reading is the
 * costly part). Blank rows, and rows the save empties, have no problem
 * (unfinished; a commit removes the latter).
 *
 * @param capacity Cached verdicts kept before the cache restarts.
 * @returns `(lane, text) → reason | null`.
 */
export function createRowValidator(
  capacity = 4_096
): (lane: LaneKey, text: string) => string | null {
  const cache = new Map<string, string | null>();
  return (lane, typed) => {
    if (isBlankRow(typed)) return null;
    // A broken (half) character is the typed text's own problem: the save would replace it.
    if (!typed.isWellFormed()) return wireRowProblem(typed);
    const feature = laneFeature(lane);
    const stored = storedRowKey(feature.id, typed);
    if (stored === null) return null;
    const wire = wireRowProblem(stored);
    if (wire !== null) return wire;
    const key = `${lane}\u0000${stored}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const reason = featureRowProblems(feature.id, feature.rowKind, [stored])[0]?.reason ?? null;
    if (cache.size >= capacity) cache.clear();
    cache.set(key, reason);
    return reason;
  };
}
