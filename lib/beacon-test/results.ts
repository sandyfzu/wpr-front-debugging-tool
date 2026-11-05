/**
 * Validation of what a beacon test run hands back. The beacon runs on the
 * host page, so its output is untrusted: every list is capped, every string
 * clipped, only own properties are read, and nothing but plain readonly
 * data (URLs, descriptors, hashes — never page markup) reaches a surface.
 */

import { capText } from '../../utils/cap-text';
import { isRecord, ownValue } from '../../utils/is-record';

/** Most records kept per feature list. */
export const RESULT_RECORDS_MAX = 500;

/** Most entries kept in a record's nested lists (`<source>` rows, background set). */
export const NESTED_ENTRIES_MAX = 50;

/** Longest kept URL-like value (src, srcset, sizes, media), code points. */
export const URL_TEXT_MAX = 4096;

/** Longest kept short value (type, label, lazy-render hash, extra key/value), code points. */
export const SHORT_TEXT_MAX = 256;

/** Most unrecognized fields kept per record. */
export const EXTRA_FIELDS_MAX = 20;

/**
 * Most own keys inspected per record (known fields included): bounds the
 * per-key work on a key-stuffed record (listing its keys still costs one pass).
 */
const KEYS_SCANNED_MAX = 64;

/** One `<source>` row of a `<picture>` candidate. */
export interface PictureSource {
  readonly srcset: string;
  readonly media: string;
  readonly type: string;
  readonly sizes: string;
}

/** A primitive value of a field this version does not interpret (kept as-is, bounded). */
export type ExtraValue = string | number | boolean;

/** One above-the-fold image candidate the beacon reported. */
export interface AboveTheFoldCandidate {
  /** The beacon's label: `lcp` for the largest candidate, `above-the-fold` for the rest. */
  readonly label: string;
  /** The beacon's element kind (`img`, `img-srcset`, `picture`, `bg-img`, `bg-img-set`, …). */
  readonly kind: string;
  /** The image URL (a background image set's first URL). */
  readonly src: string;
  readonly srcset: string;
  readonly sizes: string;
  /** The URL the browser picked, where the beacon read one. */
  readonly currentSrc: string;
  readonly sources: readonly PictureSource[];
  /** Every URL of a background image (set). */
  readonly backgroundUrls: readonly string[];
  /** Fields this version does not interpret, kept for display only. */
  readonly extra: Readonly<Record<string, ExtraValue>>;
}

/** A feature's list as the run reported it. */
export type FeatureList<T> =
  | { readonly kind: 'malformed' }
  | {
      readonly kind: 'ok';
      readonly items: readonly T[];
      /** Entries dropped because they were not the expected shape. */
      readonly dropped: number;
      /** Whether the list was longer than {@link RESULT_RECORDS_MAX}. */
      readonly truncated: boolean;
    };

/** A run's validated results; `null` for a feature that did not run. */
export interface BeaconTestResults {
  readonly aboveTheFold: FeatureList<AboveTheFoldCandidate> | null;
  /** Lazy-render element hashes (`data-rocket-location-hash` values). */
  readonly lazyRender: FeatureList<string> | null;
}

/** The fields {@link readCandidate} interprets (anything else may land in `extra`). */
const KNOWN_FIELDS = new Set([
  'type',
  'label',
  'src',
  'srcset',
  'sizes',
  'current_src',
  'sources',
  'bg_set'
]);

/**
 * A bounded string field.
 *
 * @param record The record.
 * @param key The field name.
 * @param max The code-point cap.
 * @returns The clipped string; `''` for an absent or non-string value.
 */
function textField(record: Record<string, unknown>, key: string, max: number): string {
  const value = ownValue(record, key);
  return typeof value === 'string' ? capText(value, max) : '';
}

/**
 * A bounded list of records mapped through `read`; non-records are skipped.
 *
 * @param value The untrusted list.
 * @param read Maps one record.
 * @returns At most {@link NESTED_ENTRIES_MAX} mapped entries (`[]` for a non-array).
 */
function nestedList<T>(value: unknown, read: (record: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const entry of value.slice(0, NESTED_ENTRIES_MAX) as unknown[]) {
    if (isRecord(entry)) out.push(read(entry));
  }
  return out;
}

/**
 * The `src` of a candidate: a string, or — for a background image set — the
 * set itself, whose first URL stands for it.
 *
 * @param value The untrusted `src`.
 * @returns The URL, or `''`.
 */
function readSrc(value: unknown): string {
  if (typeof value === 'string') return capText(value, URL_TEXT_MAX);
  const first: unknown = Array.isArray(value) ? value[0] : undefined;
  return isRecord(first) ? textField(first, 'src', URL_TEXT_MAX) : '';
}

/**
 * The record's uninterpreted primitive fields, bounded.
 *
 * @param record The record.
 * @returns A frozen map of at most {@link EXTRA_FIELDS_MAX} entries.
 */
function readExtra(record: Record<string, unknown>): Readonly<Record<string, ExtraValue>> {
  const extra: Record<string, ExtraValue> = {};
  let count = 0;
  for (const key of Object.keys(record).slice(0, KEYS_SCANNED_MAX)) {
    if (count === EXTRA_FIELDS_MAX) break;
    if (KNOWN_FIELDS.has(key)) continue;
    const value = record[key];
    if (typeof value === 'string')
      extra[capText(key, SHORT_TEXT_MAX)] = capText(value, SHORT_TEXT_MAX);
    else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      extra[capText(key, SHORT_TEXT_MAX)] = value;
    } else continue;
    count += 1;
  }
  return Object.freeze(extra);
}

/**
 * Read one above-the-fold record. A record without a string `type` is not a
 * candidate (the beacon only types the elements it describes).
 *
 * @param value The untrusted record.
 * @returns The candidate, or null when it is not one.
 */
export function readCandidate(value: unknown): AboveTheFoldCandidate | null {
  if (!isRecord(value) || typeof ownValue(value, 'type') !== 'string') return null;
  return Object.freeze({
    label: textField(value, 'label', SHORT_TEXT_MAX),
    kind: textField(value, 'type', SHORT_TEXT_MAX),
    src: readSrc(ownValue(value, 'src')),
    srcset: textField(value, 'srcset', URL_TEXT_MAX),
    sizes: textField(value, 'sizes', URL_TEXT_MAX),
    currentSrc: textField(value, 'current_src', URL_TEXT_MAX),
    sources: Object.freeze(
      nestedList(ownValue(value, 'sources'), (row) =>
        Object.freeze({
          srcset: textField(row, 'srcset', URL_TEXT_MAX),
          media: textField(row, 'media', URL_TEXT_MAX),
          type: textField(row, 'type', SHORT_TEXT_MAX),
          sizes: textField(row, 'sizes', URL_TEXT_MAX)
        })
      )
    ),
    backgroundUrls: Object.freeze(
      nestedList(ownValue(value, 'bg_set'), (row) => textField(row, 'src', URL_TEXT_MAX)).filter(
        (url) => url !== ''
      )
    ),
    extra: readExtra(value)
  });
}

/**
 * Read a lazy-render hash.
 *
 * @param value The untrusted entry.
 * @returns The clipped hash, or null for anything but a non-empty string.
 */
export function readLazyRenderHash(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? capText(value, SHORT_TEXT_MAX) : null;
}

/**
 * Read a feature's list: capped at {@link RESULT_RECORDS_MAX}, entries that
 * do not read are counted, never kept.
 *
 * @param value The untrusted list (`null`/absent: the feature did not run).
 * @param read Reads one entry (null drops it).
 * @returns Null when the feature did not run, `malformed` for a non-list.
 */
export function readFeatureList<T>(
  value: unknown,
  read: (entry: unknown) => T | null
): FeatureList<T> | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return { kind: 'malformed' };
  const items: T[] = [];
  let dropped = 0;
  for (const entry of value.slice(0, RESULT_RECORDS_MAX) as unknown[]) {
    const item = read(entry);
    if (item === null) dropped += 1;
    else items.push(item);
  }
  return {
    kind: 'ok',
    items: Object.freeze(items),
    dropped,
    truncated: value.length > RESULT_RECORDS_MAX
  };
}

/**
 * Validate a run's raw results (`{ lcp, lrc }` as the beacon collects them).
 *
 * @param raw The untrusted results.
 * @returns The validated results, or null when `raw` is not a record.
 */
export function readBeaconResults(raw: unknown): BeaconTestResults | null {
  if (!isRecord(raw)) return null;
  return Object.freeze({
    aboveTheFold: readFeatureList(ownValue(raw, 'lcp'), readCandidate),
    lazyRender: readFeatureList(ownValue(raw, 'lrc'), readLazyRenderHash)
  });
}
