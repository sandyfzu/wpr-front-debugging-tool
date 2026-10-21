/**
 * The editor's draft: the exclusion set as the user edits it — per-lane
 * rows with stable ids (row UI state and virtual-list keys follow the id,
 * never the index) plus the feature-wide disables. Pure and immutable: every
 * edit returns a new draft; the view stores it. Blank rows are unfinished
 * edits, not exclusions: they never reach the set and never show an error.
 */
import {
  EXCLUSION_FEATURES,
  type ExclusionFeatureSpec,
  type ExclusionSet,
  type ExclusionSetRows,
  type ExclusionSetToggles
} from '../../../lib/exclusion-builder/set';
import { featureRowProblems } from '../../../lib/exclusion-builder/validate';
import { EXCLUSION_SET_LIMITS } from '../../../lib/messaging/exclusion-session';

/** One editor lane = one feature's row list. */
export type LaneKey = keyof ExclusionSetRows;

/** One feature-wide disable. */
export type ToggleKey = keyof ExclusionSetToggles;

/** One editable row. */
export interface DraftRow {
  /** Stable identity for the row's lifetime (list key, focus target). */
  readonly id: string;
  /** The row as typed. */
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

/**
 * A draft holding a set's rows and disables.
 *
 * @param set The set to edit.
 * @param nextId The id issuer.
 */
export function draftFromSet(set: ExclusionSet, nextId: IdSource): Draft {
  const rows = {} as Record<LaneKey, DraftRow[]>;
  for (const lane of LANE_ORDER)
    rows[lane] = set.rows[lane].map((text) => ({ id: nextId(), text }));
  return { rows, disable: { ...set.disable } };
}

/** Whether a row is an unfinished (blank) edit. */
export function isBlankRow(text: string): boolean {
  return text.trim() === '';
}

/**
 * The set a draft stands for: blank rows dropped, every other row exactly
 * as typed.
 *
 * @param draft The draft.
 */
export function draftToSet(draft: Draft): ExclusionSet {
  const rows = {} as Record<LaneKey, string[]>;
  for (const lane of LANE_ORDER) {
    rows[lane] = draft.rows[lane].map((row) => row.text).filter((text) => !isBlankRow(text));
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
 * Split pasted text into rows: one per line (`\n` or `\r\n`), blank lines
 * dropped, each line kept as written.
 *
 * @param text The pasted text.
 */
export function splitLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => !isBlankRow(line));
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
  /** The row holding the candidate (new, or the one already holding it). */
  readonly id: string | null;
  /** `false` when the row already existed or the lane is full (`id` null then). */
  readonly added: boolean;
}

/**
 * Add a candidate row to a lane unless the lane already holds that exact
 * row (picking twice never duplicates).
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
  const existing = draft.rows[lane].find((row) => row.text === text);
  if (existing !== undefined) return { draft, id: existing.id, added: false };
  const inserted = insertRows(draft, lane, [text], null, nextId);
  const id = inserted.ids[0] ?? null;
  return { draft: inserted.draft, id, added: id !== null };
}

/**
 * Characters the set would carry over the wire (non-blank rows) — checked
 * against the whole-set cap before an apply.
 *
 * @param draft The draft.
 */
export function draftChars(draft: Draft): number {
  let chars = 0;
  for (const lane of LANE_ORDER) {
    for (const row of draft.rows[lane]) if (!isBlankRow(row.text)) chars += row.text.length;
  }
  return chars;
}

/**
 * A memoizing row validator: the engine's own prevalidation per row, cached
 * by lane + text, so an edit re-validates only the row that changed (the
 * regex guard is the costly part). Blank rows have no problem (unfinished).
 *
 * @param capacity Cached verdicts kept before the cache restarts.
 * @returns `(lane, text) → reason | null`.
 */
export function createRowValidator(
  capacity = 4_096
): (lane: LaneKey, text: string) => string | null {
  const cache = new Map<string, string | null>();
  return (lane, text) => {
    if (isBlankRow(text)) return null;
    const key = `${lane}\u0000${text}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const feature = laneFeature(lane);
    const reason = featureRowProblems(feature.id, feature.rowKind, [text])[0]?.reason ?? null;
    if (cache.size >= capacity) cache.clear();
    cache.set(key, reason);
    return reason;
  };
}
