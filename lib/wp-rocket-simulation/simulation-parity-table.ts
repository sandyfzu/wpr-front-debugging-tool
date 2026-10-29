/**
 * The simulation parity table's shape and its strict parser — the single
 * declaring site of `simulation-parity.fixtures.json`'s format, shared by the
 * vitest suites that replay it and by the dev script that re-derives its
 * outputs from the real plugin (`pnpm parity:wp-rocket`). Test/dev tooling
 * only: no product module imports it (or the table).
 *
 * One row kind, **simulate**: a page served without the feature (`html`) →
 * the page WP Rocket serves with it on (`served`), no `wpr_*` comment (the
 * extension never writes one):
 *
 * - `feature: "delay_js"`: the stored Delay JS rows (`rows`) and the dynamic
 *   list's `delay_js_exclusions` (`listRows`, or `list: "bundled"` = the
 *   pinned zip's own list); its real Delay JS passes, runtime and IE fallback
 *   injection, meta charset move — the header's sentinel texts standing in
 *   for the runtime and the IE fallback. An optional `defer` also turns
 *   Defer JS on, in the same buffer before Delay JS (as WP Rocket orders them).
 * - `feature: "defer_all_js"`: Defer JS alone, from `defer`.
 * - `feature: "lazyload"`: LazyLoad for images alone, from `lazyload`.
 *
 * `defer` = the stored Defer JS rows and the dynamic lists'
 * `defer_js_external_exclusions` + `defer_js_inline_exclusions` (`lists`, or
 * `"bundled"` = the pinned zip's own). `lazyload` = the plugin's assets URL
 * and the stored `exclude_lazyload` rows, under the fixed images-only option
 * set; any row may carry it (LazyLoad runs first in the buffer). Its page
 * must hold exactly one `</head>`, then exactly one `</body>` (else the
 * harness rejects it); its `served` then holds the plugin's own head and
 * footer texts where a theme's template prints them: right before `</head>`
 * — before WP Rocket's generator meta when the page ends its head with it —
 * and right before `</body>` — before WP Rocket's beacon block when the page
 * ends its body with it (both blocks are written later, by the buffer).
 * Outputs are the reference
 * build's; `byVersion` holds another supported version's differing `served`.
 *
 * The header carries the plugin reference fields shared with the exclusion
 * parity table plus `simulation`: the pins of the real runtime, IE fallback,
 * lists and LazyLoad texts (derived from the zip) and the two authored
 * sentinels.
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
import {
  VERSION_EXPECTATIONS_KEY,
  parseVersionExpectations,
  type VersionedRow
} from '../exclusion-builder/parity-version-expectations.ts';
import { SHA256_PATTERN } from './simulation-data.ts';

/** This table's name in parse errors. */
const TABLE_LABEL = 'simulation-parity fixtures';

/** The features a simulate row may name (its last pass in the buffer). */
export const SIMULATE_FEATURES = ['delay_js', 'defer_all_js', 'lazyload'] as const;

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

/** A dynamic list's pin: its row count and the sha256 of `JSON.stringify(rows)`. */
export interface ListPin {
  readonly count: number;
  readonly sha256: string;
}

/** A text's pin: its UTF-8 size and sha256. */
export interface TextPin {
  readonly bytes: number;
  readonly sha256: string;
}

/** LazyLoad's pins (images-only option set): its runtime file and the texts it prints or tests. */
export interface LazyloadPins {
  /** The runtime file the footer's tag loads: path in the zip, size, sha256. */
  readonly runtime: { readonly path: string; readonly bytes: number; readonly sha256: string };
  /** What `wp_head` prints: the no-JavaScript style. */
  readonly noJsStyle: TextPin;
  /** The footer's first element: the inline `window.lazyLoadOptions` script. */
  readonly optionsScript: TextPin;
  /** The footer's runtime tag around its URL (the plugin's assets JS URL + the runtime's path there). */
  readonly runtimeTag: { readonly beforeUrl: TextPin; readonly afterUrl: TextPin };
  /** The image exclusion literals: attribute substrings. */
  readonly excludedAttributes: ListPin;
  /** The image exclusion literals: src substrings. */
  readonly excludedSrc: ListPin;
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
  readonly ieFallback: TextPin;
  /** The plugin-root `dynamic-lists.json` file. */
  readonly dynamicLists: { readonly sha256: string };
  /** Its `delay_js_exclusions` rows (sha256 of `JSON.stringify(rows)`, as every list pin). */
  readonly delayJsExclusions: ListPin;
  /** Its `defer_js_external_exclusions` rows. */
  readonly deferJsExternalExclusions: ListPin;
  /** Its `defer_js_inline_exclusions` rows. */
  readonly deferJsInlineExclusions: ListPin;
  readonly lazyload: LazyloadPins;
  readonly sentinels: SimulationSentinels;
}

/** The table header: the plugin reference fields plus the simulation pins. */
export interface SimulationHeader extends ParityHeader {
  readonly simulation: SimulationPins;
}

/** The dynamic lists Defer JS reads. */
export interface DeferLists {
  /** `defer_js_external_exclusions`: joined with the stored rows into the script-URL pattern. */
  readonly external: readonly string[];
  /** `defer_js_inline_exclusions`: inline-script texts the jQuery wrapping skips. */
  readonly inline: readonly string[];
}

/** A row's Defer JS inputs. */
export interface DeferSimulateInput {
  /** Stored Defer JS rows (`exclude_defer_js`). */
  readonly rows: readonly string[];
  /** The rows only reach WP Rocket through a PHP filter — the settings form would change them. */
  readonly filterOnly?: true;
  /** The dynamic lists, or `"bundled"` = the pinned zip's own. */
  readonly lists: DeferLists | 'bundled';
}

/** A row's LazyLoad inputs (option set fixed: images only). */
export interface LazyloadSimulateInput {
  /** The plugin's assets URL (`…/wp-rocket/assets/`): the footer's runtime tag loads from under it. */
  readonly assetsUrl: string;
  /** Stored LazyLoad exclusion rows (`exclude_lazyload`). */
  readonly rows: readonly string[];
  /** The rows only reach WP Rocket through a PHP filter — the settings form would change them. */
  readonly filterOnly?: true;
}

/** The authored part of a simulate row. */
export interface SimulateInput {
  readonly id: string;
  readonly kind: 'simulate';
  readonly feature: SimulateFeature;
  readonly note?: string;
  /** Stored Delay JS rows (the settings field); Delay JS rows only. */
  readonly rows?: readonly string[];
  /** The rows only reach WP Rocket through a PHP filter — the settings form would change them. */
  readonly filterOnly?: true;
  /** The dynamic list's `delay_js_exclusions` rows (exclusive with `list`). */
  readonly listRows?: readonly string[];
  /** `"bundled"` = the pinned zip's own `delay_js_exclusions` (exclusive with `listRows`). */
  readonly list?: 'bundled';
  /** Defer JS also on (Delay JS rows), or the feature itself (Defer JS rows). */
  readonly defer?: DeferSimulateInput;
  /** LazyLoad also on (Delay/Defer JS rows), or the feature itself (LazyLoad rows). */
  readonly lazyload?: LazyloadSimulateInput;
  readonly html: string;
}

/** A complete simulate row (reference outputs; `byVersion` where another version differs). */
export interface SimulateRow extends SimulateInput, VersionedRow {
  /** The page WP Rocket serves with the row's features on (sentinels for the Delay JS runtime + fallback). */
  readonly served: string;
}

/** A Delay JS row without Defer JS or LazyLoad (its stored rows always present). */
export type DelayOnlyRow = SimulateRow & {
  readonly feature: 'delay_js';
  readonly rows: readonly string[];
  readonly defer?: undefined;
  readonly lazyload?: undefined;
};

/**
 * Whether a row simulates Delay JS alone.
 *
 * @param row A table row.
 */
export function isDelayOnlyRow(row: SimulateRow): row is DelayOnlyRow {
  return (
    row.feature === 'delay_js' &&
    row.defer === undefined &&
    row.lazyload === undefined &&
    row.rows !== undefined
  );
}

/** The whole table. */
export interface SimulationTable {
  readonly header: SimulationHeader;
  readonly rows: readonly SimulateRow[];
}

/** Header keys, in file order. */
export const SIMULATION_HEADER_KEYS: readonly string[] = [...HEADER_KEYS, 'simulation'];

/** `header.simulation` keys, in file order. */
const PIN_KEYS = [
  'runtime',
  'ieFallback',
  'dynamicLists',
  'delayJsExclusions',
  'deferJsExternalExclusions',
  'deferJsInlineExclusions',
  'lazyload',
  'sentinels'
];

/** `header.simulation.lazyload` keys, in file order. */
const LAZYLOAD_PIN_KEYS = [
  'runtime',
  'noJsStyle',
  'optionsScript',
  'runtimeTag',
  'excludedAttributes',
  'excludedSrc'
];

/** The list pins of `header.simulation`, in file order. */
export const LIST_PIN_KEYS = [
  'delayJsExclusions',
  'deferJsExternalExclusions',
  'deferJsInlineExclusions'
] as const;

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
  'defer',
  'lazyload',
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

/** A `{count, sha256}` list pin at `where`. */
function listPinAt(value: unknown, where: string): ListPin {
  const list = record(null, value, ['count', 'sha256'], where);
  return { count: countField(list, 'count', where), sha256: sha256Field(list, where) };
}

/** A `{bytes, sha256}` text pin at `where`. */
function textPin(value: unknown, where: string): TextPin {
  const text = record(null, value, ['bytes', 'sha256'], where);
  return { bytes: countField(text, 'bytes', where), sha256: sha256Field(text, where) };
}

/** Parse `header.simulation.lazyload` strictly. */
function parseLazyloadPins(value: unknown): LazyloadPins {
  const where = (key: string): string => `header.simulation.lazyload.${key}`;
  const pins = record(null, value, LAZYLOAD_PIN_KEYS, 'header.simulation.lazyload');
  const runtime = record(null, pins.runtime, ['path', 'bytes', 'sha256'], where('runtime'));
  const path = stringField(null, runtime, 'path');
  if (path === '') fail(null, `${where('runtime')}.path must not be empty`);
  const tag = record(null, pins.runtimeTag, ['beforeUrl', 'afterUrl'], where('runtimeTag'));
  return {
    runtime: {
      path,
      bytes: countField(runtime, 'bytes', where('runtime')),
      sha256: sha256Field(runtime, where('runtime'))
    },
    noJsStyle: textPin(pins.noJsStyle, where('noJsStyle')),
    optionsScript: textPin(pins.optionsScript, where('optionsScript')),
    runtimeTag: {
      beforeUrl: textPin(tag.beforeUrl, `${where('runtimeTag')}.beforeUrl`),
      afterUrl: textPin(tag.afterUrl, `${where('runtimeTag')}.afterUrl`)
    },
    excludedAttributes: listPinAt(pins.excludedAttributes, where('excludedAttributes')),
    excludedSrc: listPinAt(pins.excludedSrc, where('excludedSrc'))
  };
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
  const lists = record(null, pins.dynamicLists, ['sha256'], where('dynamicLists'));
  const listPin = (key: (typeof LIST_PIN_KEYS)[number]): ListPin =>
    listPinAt(pins[key], where(key));
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
    ieFallback: textPin(pins.ieFallback, where('ieFallback')),
    dynamicLists: { sha256: sha256Field(lists, where('dynamicLists')) },
    delayJsExclusions: listPin('delayJsExclusions'),
    deferJsExternalExclusions: listPin('deferJsExternalExclusions'),
    deferJsInlineExclusions: listPin('deferJsInlineExclusions'),
    lazyload: parseLazyloadPins(pins.lazyload),
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
  record(
    id,
    value,
    [...SIMULATE_INPUT_KEYS, ...SIMULATE_OUTPUT_KEYS, VERSION_EXPECTATIONS_KEY],
    'the row'
  );
  if (value.kind !== 'simulate') fail(id, '"kind" must be "simulate"');
  const feature = SIMULATE_FEATURES.find((candidate) => candidate === value.feature);
  if (feature === undefined) fail(id, `"feature" must be one of ${SIMULATE_FEATURES.join(', ')}`);
  const note = value.note;
  if (note !== undefined && (typeof note !== 'string' || note === '')) {
    fail(id, '"note" must be a non-empty string');
  }
  const defer = value.defer === undefined ? undefined : deferInput(id, value.defer);
  const lazyload = value.lazyload === undefined ? undefined : lazyloadInput(id, value.lazyload);
  const html = stringField(id, value, 'html');
  if (html === '') fail(id, '"html" must not be empty');
  const head = {
    id,
    kind: 'simulate' as const,
    feature,
    ...(note === undefined ? {} : { note })
  };
  const tail = {
    ...(defer === undefined ? {} : { defer }),
    ...(lazyload === undefined ? {} : { lazyload }),
    html
  };
  if (feature === 'lazyload') {
    const stray = [...DELAY_INPUT_KEYS, 'defer'].find((key) => key in value);
    if (stray !== undefined)
      fail(id, `a LazyLoad row has no Delay JS or Defer JS input ("${stray}")`);
    if (lazyload === undefined) fail(id, 'a LazyLoad row needs "lazyload"');
    return { ...head, ...tail };
  }
  if (feature === 'defer_all_js') {
    const stray = DELAY_INPUT_KEYS.find((key) => key in value);
    if (stray !== undefined) fail(id, `a Defer JS row has no Delay JS input ("${stray}")`);
    if (defer === undefined) fail(id, 'a Defer JS row needs "defer"');
    return { ...head, ...tail };
  }
  const rows = stringList(id, value, 'rows');
  const filterOnly = filterOnlyField(id, value);
  const listRows = value.listRows === undefined ? undefined : stringList(id, value, 'listRows');
  if (value.list !== undefined && value.list !== 'bundled') {
    fail(id, '"list" is either "bundled" or absent');
  }
  if ((listRows === undefined) === (value.list === undefined)) {
    fail(id, 'exactly one of "listRows" and "list" is required');
  }
  return {
    ...head,
    rows,
    ...(filterOnly ? { filterOnly: true as const } : {}),
    ...(listRows === undefined ? { list: 'bundled' as const } : { listRows }),
    ...tail
  };
}

/** The Delay JS input keys (a Defer JS row carries none). */
const DELAY_INPUT_KEYS = ['rows', 'filterOnly', 'listRows', 'list'] as const;

/** An optional `filterOnly` flag: `true` or absent. */
function filterOnlyField(id: string, value: Record<string, unknown>): boolean {
  if (value.filterOnly !== undefined && value.filterOnly !== true) {
    fail(id, '"filterOnly" is either true or absent');
  }
  return value.filterOnly === true;
}

/** Parse a row's `defer` strictly. */
function deferInput(id: string, value: unknown): DeferSimulateInput {
  const defer = record(id, value, ['rows', 'filterOnly', 'lists'], '"defer"');
  const rows = stringList(id, defer, 'rows');
  const filterOnly = filterOnlyField(id, defer);
  let lists: DeferSimulateInput['lists'];
  if (defer.lists === 'bundled') {
    lists = 'bundled';
  } else {
    const fields = record(id, defer.lists, ['external', 'inline'], '"defer.lists"');
    lists = {
      external: stringList(id, fields, 'external'),
      inline: stringList(id, fields, 'inline')
    };
  }
  return { rows, ...(filterOnly ? { filterOnly: true as const } : {}), lists };
}

/**
 * A plugin assets URL as WordPress builds it (`plugin_dir_url()` + `assets/`):
 * absolute http(s), ending in `/assets/`, no character that would end the
 * runtime tag's quoted `src` or the tag itself.
 */
const ASSETS_URL = /^https?:\/\/[^\s"'<>]+\/assets\/$/;

/** Parse a row's `lazyload` strictly (no option-set key: the set is fixed to images). */
function lazyloadInput(id: string, value: unknown): LazyloadSimulateInput {
  const lazyload = record(id, value, ['assetsUrl', 'rows', 'filterOnly'], '"lazyload"');
  const assetsUrl = stringField(id, lazyload, 'assetsUrl');
  if (!ASSETS_URL.test(assetsUrl)) {
    fail(id, '"lazyload.assetsUrl" must be an absolute http(s) URL ending in /assets/');
  }
  const rows = stringList(id, lazyload, 'rows');
  const filterOnly = filterOnlyField(id, lazyload);
  return { assetsUrl, rows, ...(filterOnly ? { filterOnly: true as const } : {}) };
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
    const fields = records[index] as Record<string, unknown>;
    const served = stringField(input.id, fields, 'served');
    if (served === '') fail(input.id, '"served" must not be empty');
    const byVersion = parseVersionExpectations(
      fields,
      SIMULATE_OUTPUT_KEYS,
      header.plugin,
      (problem) => fail(input.id, problem)
    );
    for (const override of Object.values(byVersion ?? {})) {
      if (override.served === '' || typeof override.served !== 'string') {
        fail(input.id, `"${VERSION_EXPECTATIONS_KEY}" served must be a non-empty string`);
      }
    }
    return { ...input, served, ...(byVersion === undefined ? {} : { byVersion }) };
  });
  return { header, rows };
}
