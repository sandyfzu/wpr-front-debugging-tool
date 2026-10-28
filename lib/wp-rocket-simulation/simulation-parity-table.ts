/**
 * The simulation parity table's shape and its strict parser — the single
 * declaring site of `simulation-parity.fixtures.json`'s format, shared by the
 * vitest suites that replay it and by the dev script that re-derives its
 * outputs from the real plugin (`pnpm parity:wp-rocket`). Test/dev tooling
 * only: no product module imports it (or the table).
 *
 * One row kind, **simulate**: a page served without Delay JS (`html`), the
 * stored Delay JS rows (`rows`) and the dynamic list's `delay_js_exclusions`
 * (`listRows`, or `list: "bundled"` = the pinned zip's own list) → the page
 * WP Rocket serves with Delay JS on (`served`): its real Delay JS passes,
 * runtime and IE fallback injection, meta charset move — with the header's
 * sentinel texts standing in for the runtime and the IE fallback, and no
 * `wpr_*` comment (the extension never writes one).
 *
 * The header carries the plugin reference fields shared with the exclusion
 * parity table plus `simulation`: the pins of the real runtime, IE fallback
 * and list (derived from the zip) and the two authored sentinels.
 *
 * Inputs are authored by hand; outputs and pins are written by the dev script
 * only. Runtime imports carry their `.ts` extension and reach only leaf
 * modules, so the dev script can load this module under Node's native
 * TypeScript.
 */
import { hasOnlyKeys, isRecord } from '../../utils/is-record.ts';
import {
  HEADER_KEYS,
  parseHeaderFields,
  type ParityHeader
} from '../exclusion-builder/wp-rocket-parity-table.ts';
import { SHA256_PATTERN } from './simulation-data.ts';

/** This table's name in parse errors. */
const TABLE_LABEL = 'simulation-parity fixtures';

/** The features a simulate row may name (Delay JS only, until another feature is simulated). */
export const SIMULATE_FEATURES = ['delay_js'] as const;

/** A feature a simulate row may name. */
export type SimulateFeature = (typeof SIMULATE_FEATURES)[number];

/**
 * The two sentinel texts the oracle injects instead of the real runtime and
 * IE fallback (keeps the table small and its diffs readable; the real bytes
 * are pinned by sha256). Authored; the Delay JS disable step must recognize
 * them as it recognizes the real scripts.
 */
export interface SimulationSentinels {
  readonly runtime: string;
  readonly ieFallback: string;
}

/** The derived pins and the authored sentinels (`header.simulation`). */
export interface SimulationPins {
  /** The real runtime file in the plugin zip: path, its own version (`this.v`), size, sha256. */
  readonly runtime: {
    readonly path: string;
    readonly version: string;
    readonly bytes: number;
    readonly sha256: string;
  };
  /** The plugin's IE fallback text (`get_ie_fallback()`, read through the harness). */
  readonly ieFallback: { readonly bytes: number; readonly sha256: string };
  /** The plugin-root `dynamic-lists.json` file. */
  readonly dynamicLists: { readonly sha256: string };
  /** Its `delay_js_exclusions` rows (sha256 of `JSON.stringify(rows)`). */
  readonly delayJsExclusions: { readonly count: number; readonly sha256: string };
  readonly sentinels: SimulationSentinels;
}

/** The table header: the plugin reference fields plus the simulation pins. */
export interface SimulationHeader extends ParityHeader {
  readonly simulation: SimulationPins;
}

/** The authored part of a simulate row. */
export interface SimulateInput {
  readonly id: string;
  readonly kind: 'simulate';
  readonly feature: SimulateFeature;
  readonly note?: string;
  /** Stored Delay JS rows (the settings field). */
  readonly rows: readonly string[];
  /** The rows only reach WP Rocket through a PHP filter — the settings form would change them. */
  readonly filterOnly?: true;
  /** The dynamic list's `delay_js_exclusions` rows (exclusive with `list`). */
  readonly listRows?: readonly string[];
  /** `"bundled"` = the pinned zip's own `delay_js_exclusions` (exclusive with `listRows`). */
  readonly list?: 'bundled';
  readonly html: string;
}

/** A complete simulate row. */
export interface SimulateRow extends SimulateInput {
  /** The page WP Rocket serves with Delay JS on (sentinels for the runtime + fallback). */
  readonly served: string;
}

/** The whole table. */
export interface SimulationTable {
  readonly header: SimulationHeader;
  readonly rows: readonly SimulateRow[];
}

/** Header keys, in file order. */
export const SIMULATION_HEADER_KEYS: readonly string[] = [...HEADER_KEYS, 'simulation'];

/** `header.simulation` keys, in file order. */
const PIN_KEYS = ['runtime', 'ieFallback', 'dynamicLists', 'delayJsExclusions', 'sentinels'];

/** Simulate-row input keys, in file order. */
export const SIMULATE_INPUT_KEYS = [
  'id',
  'kind',
  'feature',
  'note',
  'rows',
  'filterOnly',
  'listRows',
  'list',
  'html'
] as const;

/** Simulate-row output keys (harness-derived), in file order. */
export const SIMULATE_OUTPUT_KEYS = ['served'] as const;

/** Row ids: `simulate-…`, lowercase kebab case. */
const ROW_ID = /^simulate-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Characters a sentinel must not hold: the plugin inserts both texts as a
 * `preg_replace` replacement, where `$` and `\` start back-references and
 * would rewrite them.
 */
const REPLACEMENT_SPECIALS = /[$\\]/;

/** A parse failure naming the table and, when known, the offending row. */
function fail(id: string | null, problem: string): never {
  const where = id === null ? '' : ` row "${id}":`;
  throw new Error(`${TABLE_LABEL}:${where} ${problem}`);
}

/** An exact-shape record. */
function record(
  id: string | null,
  value: unknown,
  keys: readonly string[],
  where: string
): Record<string, unknown> {
  if (!isRecord(value)) return fail(id, `${where} must be an object`);
  if (!hasOnlyKeys(value, keys)) {
    const stray = Object.keys(value).find((key) => !keys.includes(key)) ?? '';
    fail(id, `${where} has an unknown key "${stray}"`);
  }
  return value;
}

/** A required string field. */
function stringField(id: string | null, value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== 'string') fail(id, `"${key}" must be a string`);
  return field;
}

/** A required string-array field. */
function stringList(id: string, value: Record<string, unknown>, key: string): string[] {
  const field = value[key];
  if (!Array.isArray(field) || !field.every((item): item is string => typeof item === 'string')) {
    fail(id, `"${key}" must be an array of strings`);
  }
  return field;
}

/** A required non-negative integer field. */
function countField(value: Record<string, unknown>, key: string, where: string): number {
  const field = value[key];
  if (typeof field !== 'number' || !Number.isInteger(field) || field < 0) {
    fail(null, `${where}.${key} must be a non-negative integer`);
  }
  return field;
}

/** A required sha256 field. */
function sha256Field(value: Record<string, unknown>, where: string): string {
  const field = value.sha256;
  if (typeof field !== 'string' || !SHA256_PATTERN.test(field)) {
    fail(null, `${where}.sha256 must be 64 lowercase hex digits`);
  }
  return field;
}

/** One sentinel: non-empty, no replacement specials, never ends its script early. */
function sentinel(value: Record<string, unknown>, key: string): string {
  const text = stringField(null, value, key);
  const where = `header.simulation.sentinels.${key}`;
  if (text === '') fail(null, `${where} must not be empty`);
  if (REPLACEMENT_SPECIALS.test(text)) fail(null, `${where} must not contain "$" or "\\"`);
  if (/<\/script/i.test(text)) fail(null, `${where} must not contain "</script"`);
  return text;
}

/** Parse `header.simulation` strictly. */
function parsePins(value: unknown): SimulationPins {
  const pins = record(null, value, PIN_KEYS, 'header.simulation');
  const where = (key: string): string => `header.simulation.${key}`;
  const runtime = record(
    null,
    pins.runtime,
    ['path', 'version', 'bytes', 'sha256'],
    where('runtime')
  );
  const fallback = record(null, pins.ieFallback, ['bytes', 'sha256'], where('ieFallback'));
  const lists = record(null, pins.dynamicLists, ['sha256'], where('dynamicLists'));
  const list = record(
    null,
    pins.delayJsExclusions,
    ['count', 'sha256'],
    where('delayJsExclusions')
  );
  const sentinels = record(null, pins.sentinels, ['runtime', 'ieFallback'], where('sentinels'));
  const path = stringField(null, runtime, 'path');
  const version = stringField(null, runtime, 'version');
  if (path === '' || version === '')
    fail(null, `${where('runtime')} path and version must not be empty`);
  return {
    runtime: {
      path,
      version,
      bytes: countField(runtime, 'bytes', where('runtime')),
      sha256: sha256Field(runtime, where('runtime'))
    },
    ieFallback: {
      bytes: countField(fallback, 'bytes', where('ieFallback')),
      sha256: sha256Field(fallback, where('ieFallback'))
    },
    dynamicLists: { sha256: sha256Field(lists, where('dynamicLists')) },
    delayJsExclusions: {
      count: countField(list, 'count', where('delayJsExclusions')),
      sha256: sha256Field(list, where('delayJsExclusions'))
    },
    sentinels: {
      runtime: sentinel(sentinels, 'runtime'),
      ieFallback: sentinel(sentinels, 'ieFallback')
    }
  };
}

/**
 * The table header, validated strictly: the plugin reference fields and the
 * simulation pins, no other key.
 *
 * @param value The parsed `header`.
 * @throws {@link Error} naming the offending field.
 */
export function parseSimulationHeader(value: unknown): SimulationHeader {
  const header = record(null, value, SIMULATION_HEADER_KEYS, '"header"');
  return { ...parseHeaderFields(header, TABLE_LABEL), simulation: parsePins(header.simulation) };
}

/** Parse one row's authored part, rejecting unknown keys (outputs allowed, ignored). */
function parseInput(value: unknown, index: number): SimulateInput {
  if (!isRecord(value)) return fail(null, `row #${String(index)} must be an object`);
  const id = stringField(null, value, 'id');
  if (!ROW_ID.test(id)) fail(id, 'ids are simulate-… in lowercase kebab case');
  if ('defer' in value) {
    // Named apart from the generic unknown-key error: the key looks plausible but is unsupported.
    fail(
      id,
      '"defer" is not supported: a Defer JS pre-pass needs the plugin\'s real Defer JS lists in the same buffer as Delay JS, which simulate rows do not model yet — remove the key'
    );
  }
  record(id, value, [...SIMULATE_INPUT_KEYS, ...SIMULATE_OUTPUT_KEYS], 'the row');
  if (value.kind !== 'simulate') fail(id, '"kind" must be "simulate"');
  const feature = SIMULATE_FEATURES.find((candidate) => candidate === value.feature);
  if (feature === undefined) fail(id, `"feature" must be one of ${SIMULATE_FEATURES.join(', ')}`);
  const note = value.note;
  if (note !== undefined && (typeof note !== 'string' || note === '')) {
    fail(id, '"note" must be a non-empty string');
  }
  const rows = stringList(id, value, 'rows');
  if (value.filterOnly !== undefined && value.filterOnly !== true) {
    fail(id, '"filterOnly" is either true or absent');
  }
  const listRows = value.listRows === undefined ? undefined : stringList(id, value, 'listRows');
  if (value.list !== undefined && value.list !== 'bundled') {
    fail(id, '"list" is either "bundled" or absent');
  }
  if ((listRows === undefined) === (value.list === undefined)) {
    fail(id, 'exactly one of "listRows" and "list" is required');
  }
  const html = stringField(id, value, 'html');
  if (html === '') fail(id, '"html" must not be empty');
  return {
    id,
    kind: 'simulate',
    feature,
    ...(note === undefined ? {} : { note }),
    rows,
    ...(value.filterOnly === true ? { filterOnly: true as const } : {}),
    ...(listRows === undefined ? { list: 'bundled' as const } : { listRows }),
    html
  };
}

/** The rows array of a table-shaped value. */
function rowsOf(value: unknown): unknown[] {
  if (!isRecord(value) || !Array.isArray(value.rows)) return fail(null, 'expected {"rows": […]}');
  return value.rows;
}

/**
 * The authored inputs of a table (outputs ignored), validated strictly:
 * unique ids, known keys and values.
 *
 * @param value The parsed JSON.
 * @returns The inputs, in table order.
 * @throws {@link Error} naming the offending row.
 */
export function parseSimulationInputs(value: unknown): SimulateInput[] {
  const inputs = rowsOf(value).map(parseInput);
  const ids = new Set<string>();
  for (const input of inputs) {
    if (ids.has(input.id)) fail(input.id, 'duplicate id');
    ids.add(input.id);
  }
  return inputs;
}

/**
 * The whole table, validated strictly: header, inputs (as
 * {@link parseSimulationInputs}) and a non-empty `served` on every row.
 *
 * @param value The parsed JSON.
 * @returns The table.
 * @throws {@link Error} naming the offending row.
 */
export function parseSimulationTable(value: unknown): SimulationTable {
  const table = record(null, value, ['header', 'rows'], 'the table');
  const header = parseSimulationHeader(table.header);
  const records = rowsOf(value) as Record<string, unknown>[];
  const rows = parseSimulationInputs(value).map((input, index): SimulateRow => {
    const served = stringField(input.id, records[index] as Record<string, unknown>, 'served');
    if (served === '') fail(input.id, '"served" must not be empty');
    return { ...input, served };
  });
  return { header, rows };
}
