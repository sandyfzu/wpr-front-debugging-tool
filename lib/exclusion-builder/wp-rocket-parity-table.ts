/**
 * The WP Rocket parity table's shape and its strict parser — the single
 * declaring site of `wp-rocket-parity.fixtures.json`'s format, shared by the
 * vitest suite that replays the table against the engine and by the dev
 * script that re-derives its expected outputs from the real plugin code.
 * Test/dev tooling only: no product module imports it (or the table).
 *
 * Two row kinds:
 * - **save** — lines typed into a settings field → the rows the settings form
 *   stores, plus each dropped line with its reason;
 * - **match** — stored rows + a page → the page WP Rocket serves without user
 *   rows (`served`, the engine's input), every subject of that page in
 *   document order (`subjects`), the ones it optimizes there (`candidates`)
 *   and the ones the rows leave un-optimized (`excluded`); Defer JS rows also
 *   record the inline scripts WP Rocket wraps under the rows (`inlineWrapped`). A subject's key is
 *   its `id` attribute, else `#n` for the n-th id-less subject tag (0-based,
 *   comments skipped); lazy-render subjects are always keyed by id.
 *
 * A match row may carry an authored `engine` disposition: the engine is not
 * meant to reproduce WP Rocket's outcome there (it reports a row problem, or
 * a documented residual applies); the PHP-derived outputs stay as the record
 * of the live outcome.
 *
 * Inputs are authored by hand; outputs are written by the dev script only.
 * Runtime imports carry their `.ts` extension and reach only leaf modules, so
 * the dev script can load this module under Node's native TypeScript.
 */
import { PROBLEM_IDS, type ProblemId } from './pcre/problems.ts';
import { STORED_ROW_DROP_REASONS, type StoredRowDropReason } from './stored-row-drops.ts';
import type { ExclusionFeatureId } from './set';

/** The work item expected to turn a row's pending fields green (`pending.owner`). */
export type PendingPhase = 'K.3' | 'K.4b' | 'K.4c' | 'K.4d';

/**
 * An outcome field the replay compares: a save row's `stored`/`dropped`; a
 * match row's `candidates`/`excluded` (+ Defer `featureOff`/`inlineWrapped`,
 * lazy rendering `hashed`/`rekeyed`), or `problems` for a row whose
 * disposition is a problem.
 */
export type OutcomeField =
  | 'stored'
  | 'dropped'
  | 'candidates'
  | 'excluded'
  | 'featureOff'
  | 'inlineWrapped'
  | 'hashed'
  | 'rekeyed'
  | 'problems';

/**
 * The fields of a row the engine does not get right yet, and the work item
 * expected to fix them. Every other compared field is asserted now.
 */
export interface PendingMark {
  readonly owner: PendingPhase;
  /** Non-empty, distinct, in the row's {@link comparedFields} order. */
  readonly fields: readonly OutcomeField[];
}

/**
 * Feature → the work item owning its pending match rows. Typed as a full
 * record, so it is also the compiler-checked list of feature ids a row may name.
 */
const MATCH_OWNER: Readonly<Record<ExclusionFeatureId, PendingPhase>> = {
  delay_js: 'K.4b',
  defer_all_js: 'K.4c',
  lazyload: 'K.4d',
  automatic_lazy_rendering: 'K.4d'
};

/** The work item owning every pending save row. */
const SAVE_OWNER: PendingPhase = 'K.3';

/** The feature without a settings field: its rows come only from a PHP filter. */
const FILTER_ONLY_FEATURE = 'automatic_lazy_rendering' satisfies ExclusionFeatureId;

/** Features with a settings field. */
export type SaveFeature = Exclude<ExclusionFeatureId, typeof FILTER_ONLY_FEATURE>;

/** Every feature id a match row may name. */
const FEATURE_IDS = Object.keys(MATCH_OWNER) as ExclusionFeatureId[];

/** Every feature id a save row may name. */
const SAVE_FEATURE_IDS = FEATURE_IDS.filter((id) => id !== FILTER_ONLY_FEATURE);

/**
 * How the engine is meant to answer a match row instead of WP Rocket's
 * outcome: report `problem`, or — for a documented `residual` the engine
 * cannot rebuild — produce exactly the authored `candidates`/`excluded`.
 */
export type EngineDisposition =
  | { readonly problem: ProblemId }
  | {
      readonly residual: string;
      readonly candidates: readonly string[];
      readonly excluded: readonly string[];
    };

/** A typed line: text, or base64 bytes for a line that is not valid UTF-8. */
export type TypedLine = string | { readonly b64: string };

/** The table header: the reference versions the outputs were derived with. */
export interface ParityHeader {
  readonly plugin: string;
  readonly pluginZipSha256: string;
  readonly wp: string;
  readonly wpZipSha1: string;
  readonly php: string;
  readonly pcre2: string;
  readonly libxml: string;
  readonly generatedBy: string;
}

/** A typed line the settings form drops. */
export interface DroppedLine {
  /** The line's index in `typed`. */
  readonly index: number;
  /** The line as typed (a copy of `typed[index]`). */
  readonly row: TypedLine;
  readonly reason: StoredRowDropReason;
}

/** Fields every row shares. */
interface RowBase {
  readonly id: string;
  readonly note?: string;
  /** Fields the engine does not mirror yet (the replay expects each to still differ). */
  readonly pending?: PendingMark;
}

/** The authored part of a save row. */
export interface SaveInput extends RowBase {
  readonly kind: 'save';
  readonly feature: SaveFeature;
  readonly typed: readonly TypedLine[];
  /** Delay JS "Safe Mode for jQuery" checkbox (Delay rows only; default off). */
  readonly safeMode?: boolean;
}

/** A save row: typed lines → stored rows. */
export interface SaveRow extends SaveInput {
  readonly stored: readonly string[];
  readonly dropped: readonly DroppedLine[];
}

/** The authored part of a match row. */
export interface MatchInput extends RowBase {
  readonly kind: 'match';
  readonly feature: ExclusionFeatureId;
  /** Rows given as stored (absent when `from` names the save row they come from). */
  readonly rows?: readonly string[];
  /** A save row of the same feature whose stored rows this row matches with. */
  readonly from?: string;
  /** The rows only reach WP Rocket through a PHP filter — the settings form would change them. */
  readonly filterOnly?: true;
  /** What the engine answers instead of WP Rocket's outcome, when it is not meant to match it. */
  readonly engine?: EngineDisposition;
  /**
   * Defer JS only: why the engine reports the inline pass undetermined here
   * (its outcome depends on live rows the harness does not have), instead
   * of WP Rocket's `inlineWrapped`.
   */
  readonly inlineUndetermined?: string;
  readonly html: string;
}

/** A match row: stored rows + page → excluded subject ids. */
export interface MatchRow extends MatchInput {
  readonly rows: readonly string[];
  readonly served: string;
  /** Every subject key of `served`, in document order (absent for lazy rendering). */
  readonly subjects?: readonly string[];
  readonly candidates: readonly string[];
  readonly excluded: readonly string[];
  /** Defer JS only: the joined-pattern pre-check failed and nothing was deferred. */
  readonly featureOff?: boolean;
  /**
   * Defer JS only: the subjects whose inline body WP Rocket wraps in its
   * `DOMContentLoaded` listener under the rows (its inline-jQuery pass).
   */
  readonly inlineWrapped?: readonly string[];
  /** Lazy rendering only: ids hashed under the rows. */
  readonly hashed?: readonly string[];
  /** Lazy rendering only: ids hashed in both runs whose hash changed. */
  readonly rekeyed?: readonly string[];
}

/** The authored part of any row (what the dev script feeds the harness). */
export type ParityInput = SaveInput | MatchInput;

/** A complete row: authored inputs plus the harness-derived outputs. */
export type ParityRow = SaveRow | MatchRow;

/** The whole table. */
export interface ParityTable {
  readonly header: ParityHeader;
  readonly rows: readonly ParityRow[];
}

/** Header keys, in file order. */
export const HEADER_KEYS: readonly (keyof ParityHeader)[] = [
  'plugin',
  'pluginZipSha256',
  'wp',
  'wpZipSha1',
  'php',
  'pcre2',
  'libxml',
  'generatedBy'
];

/** Save-row keys in file order: inputs, then outputs. */
export const SAVE_INPUT_KEYS = [
  'id',
  'kind',
  'feature',
  'typed',
  'safeMode',
  'note',
  'pending'
] as const;
/** Save-row output keys (harness-derived), in file order. */
export const SAVE_OUTPUT_KEYS = ['stored', 'dropped'] as const;

/** Match-row keys in file order: inputs, then outputs (`rows` is an output when `from` is set). */
export const MATCH_INPUT_KEYS = [
  'id',
  'kind',
  'feature',
  'from',
  'rows',
  'filterOnly',
  'note',
  'pending',
  'engine',
  'inlineUndetermined',
  'html'
] as const;

/** Match-row output keys (harness-derived), in file order. */
export const MATCH_OUTPUT_KEYS = [
  'served',
  'subjects',
  'candidates',
  'excluded',
  'featureOff',
  'inlineWrapped',
  'hashed',
  'rekeyed'
] as const;

/** Row ids: `save-…` / `match-…`, lowercase kebab case. */
const ROW_ID = /^(?:save|match)-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Canonical base64 (padded). */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** A subject key: an `id` value, or `#n` for the n-th id-less subject. */
const ANONYMOUS_SUBJECT = /^#(?:0|[1-9][0-9]*)$/;

/**
 * The work item owning a row's pending flip: one for every save row, one per
 * feature for match rows.
 *
 * @param kind The row kind.
 * @param feature The row's feature.
 */
export function pendingOwner(kind: ParityRow['kind'], feature: ExclusionFeatureId): PendingPhase {
  return kind === 'save' ? SAVE_OWNER : MATCH_OWNER[feature];
}

/**
 * The outcome fields the replay compares for a row, in order: save rows
 * `stored`, `dropped`; a match row with a problem disposition `problems`;
 * other match rows `candidates`, `excluded`, plus Defer `featureOff`,
 * `inlineWrapped` and lazy rendering `hashed`, `rekeyed` (a residual compares
 * `candidates`/`excluded` only).
 *
 * @param row The row's kind, feature and (match rows) disposition.
 */
export function comparedFields(row: {
  readonly kind: ParityRow['kind'];
  readonly feature: ExclusionFeatureId;
  readonly engine?: EngineDisposition;
}): OutcomeField[] {
  if (row.kind === 'save') return ['stored', 'dropped'];
  if (row.engine !== undefined) {
    return 'problem' in row.engine ? ['problems'] : ['candidates', 'excluded'];
  }
  if (row.feature === 'defer_all_js') {
    return ['candidates', 'excluded', 'featureOff', 'inlineWrapped'];
  }
  if (row.feature === FILTER_ONLY_FEATURE) return ['candidates', 'excluded', 'hashed', 'rekeyed'];
  return ['candidates', 'excluded'];
}

/** A parse failure naming the table and, when known, the offending row. */
function fail(id: string | null, problem: string): never {
  const where = id === null ? '' : ` row "${id}":`;
  throw new Error(`wp-rocket-parity fixtures:${where} ${problem}`);
}

/** Narrow to a plain JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reject keys outside the allowed set. */
function checkKeys(
  id: string | null,
  record: Record<string, unknown>,
  allowed: readonly string[]
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) fail(id, `unknown key "${key}"`);
  }
}

/** A required string field. */
function stringField(id: string | null, record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') fail(id, `"${key}" must be a string`);
  return value;
}

/** A required string-array field. */
function stringList(id: string, record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    fail(id, `"${key}" must be an array of strings`);
  }
  return value;
}

/** A list of distinct strings (subject keys), from any value. */
function keyList(id: string, value: unknown, key: string): string[] {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    return fail(id, `"${key}" must be an array of strings`);
  }
  if (new Set(value).size !== value.length) fail(id, `"${key}" repeats an id`);
  return value;
}

/** A required list of distinct strings (subject keys). */
function idList(id: string, record: Record<string, unknown>, key: string): string[] {
  return keyList(id, record[key], key);
}

/** Fail unless every key of `subset` is in `set`, naming the first stray key as "<what> is not <where>". */
function checkSubset(
  id: string,
  subset: readonly string[],
  set: readonly string[],
  what: string,
  where: string
): void {
  for (const key of subset) {
    if (!set.includes(key)) fail(id, `${what} "${key}" is not ${where}`);
  }
}

/**
 * Parse an `engine` disposition: exactly `{problem}` with a known id, or
 * `{residual, candidates, excluded}` with `excluded` ⊆ `candidates`.
 */
function engineDisposition(id: string, value: unknown): EngineDisposition {
  if (!isRecord(value)) return fail(id, '"engine" must be an object');
  if ('problem' in value) {
    checkKeys(id, value, ['problem']);
    const problem = PROBLEM_IDS.find((candidate) => candidate === value.problem);
    if (problem === undefined)
      fail(id, `engine problem ${JSON.stringify(value.problem)} is unknown`);
    return { problem };
  }
  checkKeys(id, value, ['residual', 'candidates', 'excluded']);
  const residual = stringField(id, value, 'residual');
  if (residual === '') fail(id, 'engine residual must say why');
  const candidates = keyList(id, value.candidates, 'engine.candidates');
  const excluded = keyList(id, value.excluded, 'engine.excluded');
  checkSubset(id, excluded, candidates, 'engine excluded', 'an engine candidate');
  return { residual, candidates, excluded };
}

/** An optional boolean field: `undefined` when absent, else it must be a boolean. */
function optionalBoolean(
  id: string,
  record: Record<string, unknown>,
  key: string
): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') fail(id, `"${key}" must be a boolean`);
  return value;
}

/** Parse one typed line. */
function typedLine(id: string, value: unknown): TypedLine {
  if (typeof value === 'string') {
    if (/[\r\n]/.test(value)) fail(id, `typed line ${JSON.stringify(value)} contains a line break`);
    return value;
  }
  if (isRecord(value) && Object.keys(value).length === 1 && typeof value.b64 === 'string') {
    if (!BASE64.test(value.b64)) fail(id, `typed line b64 "${value.b64}" is not base64`);
    return { b64: value.b64 };
  }
  return fail(id, `typed line ${JSON.stringify(value)} must be a string or {"b64": …}`);
}

/**
 * The bytes a typed line submits (UTF-8 for text, the decoded bytes for b64).
 *
 * @param line The typed line.
 * @returns The line's bytes.
 */
export function typedLineBytes(line: TypedLine): Uint8Array {
  if (typeof line === 'string') return new TextEncoder().encode(line);
  return Uint8Array.from(atob(line.b64), (char) => char.charCodeAt(0));
}

/**
 * Parse a `pending` mark: `{owner, fields}` with the row's owner and a
 * non-empty list of its compared fields, in compared order.
 */
function pendingMark(
  id: string,
  value: unknown,
  owner: PendingPhase,
  fields: readonly OutcomeField[]
): PendingMark {
  if (!isRecord(value)) return fail(id, '"pending" must be {"owner": …, "fields": […]}');
  checkKeys(id, value, ['owner', 'fields']);
  if (value.owner !== owner) fail(id, `"pending.owner" must be "${owner}" for this row`);
  const listed = keyList(id, value.fields, 'pending.fields');
  if (listed.length === 0) fail(id, '"pending.fields" must not be empty');
  const known = fields.filter((field) => listed.includes(field));
  if (known.length !== listed.length || known.some((field, index) => field !== listed[index])) {
    fail(id, `"pending.fields" must be a subset of ${fields.join(', ')}, in that order`);
  }
  return { owner, fields: known };
}

/** Shared row fields: id, note, pending (checked against the owner and the compared fields). */
function rowBase(
  record: Record<string, unknown>,
  kind: ParityRow['kind'],
  feature: ExclusionFeatureId,
  engine?: EngineDisposition
): RowBase {
  const id = stringField(null, record, 'id');
  const note = record.note;
  if (note !== undefined && typeof note !== 'string') fail(id, '"note" must be a string');
  const pending =
    record.pending === undefined
      ? undefined
      : pendingMark(
          id,
          record.pending,
          pendingOwner(kind, feature),
          comparedFields({ kind, feature, ...(engine === undefined ? {} : { engine }) })
        );
  return {
    id,
    ...(note === undefined ? {} : { note }),
    ...(pending === undefined ? {} : { pending })
  };
}

/** The row's feature, checked against the allowed set. */
function featureOf(
  id: string,
  record: Record<string, unknown>,
  allowed: readonly ExclusionFeatureId[]
): ExclusionFeatureId {
  const feature = record.feature;
  const match = allowed.find((candidate) => candidate === feature);
  if (match === undefined) fail(id, `"feature" must be one of ${allowed.join(', ')}`);
  return match;
}

/** Parse the authored part of a save row. */
function saveInput(id: string, record: Record<string, unknown>): SaveInput {
  const feature = featureOf(id, record, SAVE_FEATURE_IDS) as SaveFeature;
  const typed = record.typed;
  if (!Array.isArray(typed) || typed.length === 0) fail(id, '"typed" must be a non-empty array');
  const safeMode = optionalBoolean(id, record, 'safeMode');
  if (safeMode !== undefined && feature !== 'delay_js')
    fail(id, '"safeMode" is a Delay JS setting');
  return {
    ...rowBase(record, 'save', feature),
    kind: 'save',
    feature,
    typed: typed.map((line) => typedLine(id, line)),
    ...(safeMode === undefined ? {} : { safeMode })
  };
}

/** Parse the authored part of a match row. */
function matchInput(id: string, record: Record<string, unknown>): MatchInput {
  const feature = featureOf(id, record, FEATURE_IDS);
  const from = record.from;
  if (from !== undefined && typeof from !== 'string') fail(id, '"from" must be a save row id');
  const filterOnly = record.filterOnly;
  if (filterOnly !== undefined && filterOnly !== true)
    fail(id, '"filterOnly" is either true or absent');
  if (filterOnly === true && (from !== undefined || feature === FILTER_ONLY_FEATURE)) {
    fail(id, '"filterOnly" applies to authored rows of a feature with a settings field');
  }
  const rows = from === undefined ? stringList(id, record, 'rows') : undefined;
  const engine = record.engine === undefined ? undefined : engineDisposition(id, record.engine);
  const inlineUndetermined = record.inlineUndetermined;
  if (
    inlineUndetermined !== undefined &&
    (typeof inlineUndetermined !== 'string' ||
      inlineUndetermined === '' ||
      feature !== 'defer_all_js')
  ) {
    fail(id, '"inlineUndetermined" is a non-empty reason on a Defer JS row');
  }
  const html = stringField(id, record, 'html');
  if (html === '') fail(id, '"html" must not be empty');
  return {
    ...rowBase(record, 'match', feature, engine),
    kind: 'match',
    feature,
    ...(from === undefined ? {} : { from }),
    ...(rows === undefined ? {} : { rows }),
    ...(filterOnly === true ? { filterOnly } : {}),
    ...(engine === undefined ? {} : { engine }),
    ...(inlineUndetermined === undefined ? {} : { inlineUndetermined }),
    html
  };
}

/** Parse one row's authored part, rejecting unknown keys (outputs allowed, ignored). */
function parseInput(value: unknown, index: number): ParityInput {
  if (!isRecord(value)) return fail(null, `row #${String(index)} must be an object`);
  const id = stringField(null, value, 'id');
  if (!ROW_ID.test(id)) fail(id, 'ids are save-… / match-… in lowercase kebab case');
  if (value.kind === 'save') {
    if (!id.startsWith('save-')) fail(id, 'save row ids start with "save-"');
    checkKeys(id, value, [...SAVE_INPUT_KEYS, ...SAVE_OUTPUT_KEYS]);
    return saveInput(id, value);
  }
  if (value.kind === 'match') {
    if (!id.startsWith('match-')) fail(id, 'match row ids start with "match-"');
    checkKeys(id, value, [...MATCH_INPUT_KEYS, ...MATCH_OUTPUT_KEYS]);
    return matchInput(id, value);
  }
  return fail(id, '"kind" must be "save" or "match"');
}

/** The rows array of a table-shaped value. */
function rowsOf(value: unknown): unknown[] {
  if (!isRecord(value) || !Array.isArray(value.rows)) return fail(null, 'expected {"rows": […]}');
  return value.rows;
}

/**
 * The authored inputs of a table (outputs ignored), validated strictly:
 * unique ids, known keys and values, and every `from` naming an earlier-or-
 * later save row of the same feature.
 *
 * @param value The parsed JSON.
 * @returns The inputs, in table order.
 * @throws {@link Error} naming the offending row.
 */
export function parseParityInputs(value: unknown): ParityInput[] {
  const inputs = rowsOf(value).map(parseInput);
  const ids = new Set<string>();
  for (const input of inputs) {
    if (ids.has(input.id)) fail(input.id, 'duplicate id');
    ids.add(input.id);
  }
  for (const input of inputs) {
    if (input.kind !== 'match' || input.from === undefined) continue;
    const source = inputs.find((candidate) => candidate.id === input.from);
    if (source?.kind !== 'save' || source.feature !== input.feature) {
      fail(input.id, `"from" must name a save row of ${input.feature}`);
    }
  }
  return inputs;
}

/** Parse the header strictly. */
function parseHeader(value: unknown): ParityHeader {
  if (!isRecord(value)) return fail(null, '"header" must be an object');
  checkKeys(null, value, HEADER_KEYS);
  const header: Partial<Record<keyof ParityHeader, string>> = {};
  for (const key of HEADER_KEYS) {
    const field = stringField(null, value, key);
    if (field === '') fail(null, `header "${key}" must not be empty`);
    header[key] = field;
  }
  return header as ParityHeader;
}

/** Same JSON value (typed lines are strings or {b64}). */
function sameLine(a: TypedLine, b: TypedLine): boolean {
  return typeof a === 'string' || typeof b === 'string' ? a === b : a.b64 === b.b64;
}

/** Complete a save input with its validated outputs. */
function saveRow(input: SaveInput, record: Record<string, unknown>): SaveRow {
  const { id, typed } = input;
  const stored = stringList(id, record, 'stored');
  const dropped = record.dropped;
  if (!Array.isArray(dropped)) fail(id, '"dropped" must be an array');
  let previous = -1;
  const lines = dropped.map((entry): DroppedLine => {
    if (!isRecord(entry)) return fail(id, 'every "dropped" entry must be an object');
    checkKeys(id, entry, ['index', 'row', 'reason']);
    const { index, reason } = entry;
    const typedAt = typeof index === 'number' ? typed[index] : undefined;
    if (!Number.isInteger(index) || typedAt === undefined || (index as number) <= previous) {
      fail(id, `dropped index ${JSON.stringify(index)} is not an ascending index into "typed"`);
    }
    previous = index as number;
    const row = typedLine(id, entry.row);
    if (!sameLine(row, typedAt))
      fail(id, `dropped row at ${String(index)} differs from the typed line`);
    const known = STORED_ROW_DROP_REASONS.find((candidate) => candidate === reason);
    if (known === undefined) fail(id, `drop reason ${JSON.stringify(reason)} is unknown`);
    if (known === 'safe-mode' && input.safeMode !== true)
      fail(id, 'a safe-mode drop needs safeMode');
    return { index: previous, row, reason: known };
  });
  if (stored.length + lines.length !== typed.length) {
    fail(id, 'every typed line must be either stored or dropped');
  }
  return { ...input, stored, dropped: lines };
}

/** Complete a match input with its validated outputs. */
function matchRow(input: MatchInput, record: Record<string, unknown>): MatchRow {
  const { id, feature } = input;
  const rows = stringList(id, record, 'rows');
  const served = stringField(id, record, 'served');
  const isLazyRender = feature === FILTER_ONLY_FEATURE;
  if ((record.subjects !== undefined) === isLazyRender) {
    fail(id, '"subjects" is present exactly on rows other than lazy rendering');
  }
  const subjects = isLazyRender ? undefined : idList(id, record, 'subjects');
  const candidates = idList(id, record, 'candidates');
  const excluded = idList(id, record, 'excluded');
  if (isLazyRender && candidates.some((key) => ANONYMOUS_SUBJECT.test(key))) {
    fail(id, 'lazy rendering subjects are keyed by id');
  }
  if (subjects !== undefined) checkSubset(id, candidates, subjects, 'candidate', 'a subject');
  for (const subject of excluded) {
    if (!candidates.includes(subject)) fail(id, `excluded "${subject}" is not a candidate`);
  }
  const isDefer = feature === 'defer_all_js';
  const featureOff = optionalBoolean(id, record, 'featureOff');
  if ((featureOff !== undefined) !== isDefer) {
    fail(id, '"featureOff" is present exactly on Defer JS rows');
  }
  if ((record.inlineWrapped !== undefined) !== isDefer) {
    fail(id, '"inlineWrapped" is present exactly on Defer JS rows');
  }
  const inlineWrapped = isDefer ? idList(id, record, 'inlineWrapped') : undefined;
  if (subjects !== undefined) {
    checkSubset(id, inlineWrapped ?? [], subjects, 'inlineWrapped', 'a subject');
  }
  const hasHashed = record.hashed !== undefined;
  if (hasHashed !== isLazyRender || (record.rekeyed !== undefined) !== isLazyRender) {
    fail(id, '"hashed"/"rekeyed" are present exactly on lazy rendering rows');
  }
  const hashed = isLazyRender ? idList(id, record, 'hashed') : undefined;
  const rekeyed = isLazyRender ? idList(id, record, 'rekeyed') : undefined;
  for (const subject of rekeyed ?? []) {
    if (!hashed?.includes(subject)) fail(id, `rekeyed "${subject}" is not hashed`);
  }
  return {
    ...input,
    rows,
    served,
    ...(subjects === undefined ? {} : { subjects }),
    candidates,
    excluded,
    ...(featureOff === undefined ? {} : { featureOff }),
    ...(inlineWrapped === undefined ? {} : { inlineWrapped }),
    ...(hashed === undefined ? {} : { hashed }),
    ...(rekeyed === undefined ? {} : { rekeyed })
  };
}

/**
 * The whole table, validated strictly: header, inputs (as
 * {@link parseParityInputs}), every output present and consistent, and each
 * `from` row matching with exactly its save row's stored rows.
 *
 * @param value The parsed JSON.
 * @returns The table.
 * @throws {@link Error} naming the offending row.
 */
export function parseParityTable(value: unknown): ParityTable {
  if (!isRecord(value)) return fail(null, 'expected {"header": …, "rows": […]}');
  checkKeys(null, value, ['header', 'rows']);
  const header = parseHeader(value.header);
  const records = rowsOf(value) as Record<string, unknown>[];
  const rows = parseParityInputs(value).map((input, index): ParityRow => {
    const record = records[index] as Record<string, unknown>;
    return input.kind === 'save' ? saveRow(input, record) : matchRow(input, record);
  });
  for (const row of rows) {
    if (row.kind !== 'match' || row.from === undefined) continue;
    const source = rows.find((candidate) => candidate.id === row.from) as SaveRow;
    if (JSON.stringify(source.stored) !== JSON.stringify(row.rows)) {
      fail(row.id, `"rows" must equal the stored rows of "${row.from}"`);
    }
  }
  return { header, rows };
}
