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
 *   rows (`served`, the engine's input), the subject ids it optimizes there
 *   (`candidates`) and the ones the rows leave un-optimized (`excluded`).
 *   Subjects are identified by their `id` attribute (every `<script>` /
 *   `<img>` / processed lazy-render element in a fixture carries one).
 *
 * Inputs are authored by hand; outputs are written by the dev script only.
 */
// `.ts` specifier: the dev script imports this module under Node's native
// TypeScript, which resolves no extensionless relative import.
import { EXCLUSION_FEATURES, type ExclusionFeatureId } from './set.ts';

/** The feature without a settings field: its rows come only from a PHP filter. */
const FILTER_ONLY_FEATURE = 'automatic_lazy_rendering';

/** Features with a settings field. */
export type SaveFeature = Exclude<ExclusionFeatureId, typeof FILTER_ONLY_FEATURE>;

/** Every feature id a match row may name. */
const FEATURE_IDS: readonly ExclusionFeatureId[] = EXCLUSION_FEATURES.map((spec) => spec.id);

/** Every feature id a save row may name. */
const SAVE_FEATURE_IDS = FEATURE_IDS.filter((id) => id !== FILTER_ONLY_FEATURE);

/** Why the settings form does not store a typed line. */
export type DropReason = 'empty' | 'zero' | 'duplicate' | 'invalid-pattern' | 'safe-mode';

/** The sub-phase whose implementation is expected to turn a pending row green. */
export type PendingPhase = 'K.3' | 'K.4b' | 'K.4c' | 'K.4d';

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
  readonly reason: DropReason;
}

/** Fields every row shares. */
interface RowBase {
  readonly id: string;
  readonly note?: string;
  /** Set while the engine does not mirror this row yet (the replay expects a failure). */
  readonly pending?: PendingPhase;
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
  readonly html: string;
}

/** A match row: stored rows + page → excluded subject ids. */
export interface MatchRow extends MatchInput {
  readonly rows: readonly string[];
  readonly served: string;
  readonly candidates: readonly string[];
  readonly excluded: readonly string[];
  /** Defer JS only: the joined-pattern pre-check failed and nothing was deferred. */
  readonly featureOff?: boolean;
  /** Lazy rendering only: ids hashed under the rows. */
  readonly hashed?: readonly string[];
  /** Lazy rendering only: ids hashed in both runs whose hash changed. */
  readonly rekeyed?: readonly string[];
}

export type ParityInput = SaveInput | MatchInput;
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
  'html'
] as const;
export const MATCH_OUTPUT_KEYS = [
  'served',
  'candidates',
  'excluded',
  'featureOff',
  'hashed',
  'rekeyed'
] as const;

const DROP_REASONS: readonly DropReason[] = [
  'empty',
  'zero',
  'duplicate',
  'invalid-pattern',
  'safe-mode'
];

/** Row ids: `save-…` / `match-…`, lowercase kebab case. */
const ROW_ID = /^(?:save|match)-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Canonical base64 (padded). */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * The sub-phase that owns a row's pending flip: save rows → K.3 (save
 * normalization), Delay → K.4b, Defer → K.4c, Lazyload and lazy rendering → K.4d.
 *
 * @param kind The row kind.
 * @param feature The row's feature.
 */
export function pendingOwner(kind: ParityRow['kind'], feature: ExclusionFeatureId): PendingPhase {
  if (kind === 'save') return 'K.3';
  if (feature === 'delay_js') return 'K.4b';
  if (feature === 'defer_all_js') return 'K.4c';
  return 'K.4d';
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

/** A required list of distinct strings (subject ids). */
function idList(id: string, record: Record<string, unknown>, key: string): string[] {
  const list = stringList(id, record, key);
  if (new Set(list).size !== list.length) fail(id, `"${key}" repeats an id`);
  return list;
}

/** An optional field that, when present, must be `true`/a boolean/a string. */
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

/** Shared row fields: id, note, pending (checked against the owner). */
function rowBase(
  record: Record<string, unknown>,
  kind: ParityRow['kind'],
  feature: ExclusionFeatureId
): RowBase {
  const id = stringField(null, record, 'id');
  const note = record.note;
  if (note !== undefined && typeof note !== 'string') fail(id, '"note" must be a string');
  const pending = record.pending;
  if (pending !== undefined && pending !== pendingOwner(kind, feature)) {
    fail(id, `"pending" must be "${pendingOwner(kind, feature)}" for a ${kind} row of ${feature}`);
  }
  return {
    id,
    ...(note === undefined ? {} : { note }),
    ...(pending === undefined ? {} : { pending: pending as PendingPhase })
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
  const html = stringField(id, record, 'html');
  if (html === '') fail(id, '"html" must not be empty');
  return {
    ...rowBase(record, 'match', feature),
    kind: 'match',
    feature,
    ...(from === undefined ? {} : { from }),
    ...(rows === undefined ? {} : { rows }),
    ...(filterOnly === true ? { filterOnly } : {}),
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
    const known = DROP_REASONS.find((candidate) => candidate === reason);
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
  const candidates = idList(id, record, 'candidates');
  const excluded = idList(id, record, 'excluded');
  for (const subject of excluded) {
    if (!candidates.includes(subject)) fail(id, `excluded "${subject}" is not a candidate`);
  }
  const featureOff = optionalBoolean(id, record, 'featureOff');
  if ((featureOff !== undefined) !== (feature === 'defer_all_js')) {
    fail(id, '"featureOff" is present exactly on Defer JS rows');
  }
  const isLazyRender = feature === FILTER_ONLY_FEATURE;
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
    candidates,
    excluded,
    ...(featureOff === undefined ? {} : { featureOff }),
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
