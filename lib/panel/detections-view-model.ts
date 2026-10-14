/**
 * The Detections page's card view model: `FdtData` → the typed card list the
 * page renders. Pure — presentation decisions (layout, palette, motion)
 * belong to the page; this model owns the card set, the card names, the
 * two-state presence verdicts and the per-card subtitle composition, so the
 * page can stay registry-driven over these rows.
 *
 * Cards are keyed by the detection row's id (plus the three derived cards'
 * ids) — never by an index or a magic number, so a card's identity survives
 * the record's shape evolving and a future detection row joins the set with
 * no card-list edit.
 */

import { formatCacheTimestamp, isRepresentableCacheStamp } from '../detection/describe';
import {
  LABEL_AUTOMATIC_LAZY_RENDERING,
  LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS,
  LABEL_PRIORITY_ELEMENTS_BEACON
} from '../detection/labels';
import { KNOWN_PLATFORMS } from '../wp-rocket/constants';
import type { FdtData, PageHeader, WprDetections } from '../wp-rocket/types';
import { getRealOptionName } from '../options-map/get-real-option-name';

/** A card's presence verdict: the two states the data can actually hold. */
export type StatusKind = 'active' | 'not-active';

/** One detection row of the record, named by its own id (the card key). */
export type DetectionRow = keyof WprDetections;

/** The card list's key vocabulary: three derived cards + every detection row. */
export type StatusItemId = 'server' | 'known-platform' | 'cached' | DetectionRow;

/**
 * The richer subtitle data the redesigned cards render beyond the one-line
 * copy: the server value, the platform + the header that named it, the cache
 * stamp (the stamp only when it is a representable instant — a hostile
 * page-crafted digit run stays out of downstream math), a version string,
 * and a preloaded-image count.
 */
export type StatusItemDetail =
  | { readonly kind: 'server'; readonly value: string }
  | { readonly kind: 'platform'; readonly name: string; readonly header: string }
  | {
      readonly kind: 'cached-at';
      readonly seconds: number | null;
      readonly formatted: string | null;
    }
  | { readonly kind: 'version'; readonly version: string | null }
  | { readonly kind: 'preloaded-images'; readonly count: number };

/** One status card: name, verdict, subtitle copy and its richer detail. */
export interface StatusItem {
  readonly id: StatusItemId;
  readonly name: string;
  readonly status: StatusKind;
  readonly subtitle?: string;
  readonly detail?: StatusItemDetail;
}

/**
 * Registry rows the option-name vocabulary doesn't cover (the Priority
 * Elements family the plugin names by feature id, plus its measurement
 * beacon): their verified plugin-native labels — never a raw row id on the
 * page when a verified label exists.
 */
const FEATURE_ROW_LABELS: ReadonlyMap<DetectionRow, string> = new Map([
  ['automatic_lazy_rendering', LABEL_AUTOMATIC_LAZY_RENDERING],
  ['preconnect_external_domains', LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS],
  ['priority_elements_beacon', LABEL_PRIORITY_ELEMENTS_BEACON]
]);

/**
 * Card name for a detection row: the option map's label, else the verified
 * feature label, else the raw row id. The raw-id fallback is the record-typed
 * keying's futures-tolerance design, not a defect path: a future detection
 * row is carded automatically (named by its own id until the vocabulary learns
 * it). Row VALUES that are not `{ present }`-shaped are a boundary concern —
 * the payload validator rebuilds the exact record, so the fallback only ever
 * reads rows that are, with one extra keyed row being shape-tolerant by
 * design (pinned by the view model's "futures tolerance" test).
 */
function cardName(row: DetectionRow): string {
  const mapped = getRealOptionName(row);
  if (mapped !== row) return mapped;
  return FEATURE_ROW_LABELS.get(row) ?? row;
}

/**
 * The record's rows in the payload's declaring order — enumerated, not
 * hand-held, so a future detection row is carded automatically (the render
 * registry the page's cards are built from stays the record itself). Keys
 * other than the record's own ids are impossible by construction; the cast
 * pins that fact for the compiler once, here.
 */
function detectionRows(detections: WprDetections): DetectionRow[] {
  return Object.keys(detections) as DetectionRow[];
}

/**
 * The capture's header rows, keyed by lowercase header name with later
 * duplicate rows winning — the intake shape both card sources read (the row
 * stays whole so captured-casing header names are available to details).
 */
function lastRowByName(headers: readonly PageHeader[]): Map<string, PageHeader> {
  const map = new Map<string, PageHeader>();
  for (const row of headers) {
    map.set(row.name.toLowerCase(), row);
  }
  return map;
}

/**
 * The capture's header truth rule (shared with the status bar's segments): a
 * row's value is present when present and non-empty once trimmed — a
 * name-only row and a whitespace-only value both say "no value".
 */
function headerValue(row: PageHeader): string {
  return (row.value ?? '').trim();
}

/**
 * A platform match result: the platform's registry name and the captured
 * header that named it.
 */
interface PlatformMatch {
  readonly name: string;
  readonly header: string;
}

/**
 * The first known platform whose declared headers match the capture:
 * value-less declared headers match on the header's presence alone; a
 * value-declared header matches when the captured value contains the
 * expected value (trimmed, case-insensitive — real platform headers carry
 * suffixes, e.g. "WP Engine/…"). The registry order is the scan order; a
 * row whose value carries no match leaves that platform's own later headers
 * the chance to match, then the scan proceeds to the next platform.
 *
 * @returns The match, or null when no known platform's headers matched.
 */
function resolvePlatform(headers: readonly PageHeader[]): PlatformMatch | null {
  const captured = lastRowByName(headers);
  for (const [name, declaredHeaders] of KNOWN_PLATFORMS) {
    for (const declared of declaredHeaders) {
      const row = captured.get(declared.headerName.toLowerCase());
      if (row === undefined) continue;
      if (declared.value === undefined) return { name, header: row.name };
      if (headerValue(row).toLowerCase().includes(declared.value.trim().toLowerCase())) {
        return { name, header: row.name };
      }
    }
  }
  return null;
}

/**
 * Build the status cards for one loaded data state.
 *
 * Structure (in render order):
 * 1. **Headers-derived cards exist only when headers were captured**
 *    (`pageHeaders` null ⇒ both omitted silently) — the `Server` card's
 *    verdict follows the captured value (a value-less row is no value), and
 *    the `Known Platform` card exists only when a known platform's headers
 *    matched.
 * 2. One card per detection row except `async_css`, whose state is carried
 *    by the "Optimize CSS Delivery" card: with RUCSS absent but async-CSS
 *    applied the card is renamed to async CSS's own name and marked active;
 *    with both absent the card reads as the shared "Optimize CSS Delivery"
 *    feature in its natural not-active state (the subtle presentation
 *    rules, ported deliberately).
 * 3. The `wpr` row carries the version subtitle and, on a cached page, the
 *    separate **Cached** card: the subtitle and detail carry the UTC
 *    formatting, the raw page-provided seconds ride the detail only when
 *    they name a real instant.
 *
 * @param data The loaded page data.
 */
export function buildStatusItems(data: FdtData): StatusItem[] {
  const items: StatusItem[] = [];
  const detections = data.wprDetections;
  const statusOf = (present: boolean): StatusKind => (present ? 'active' : 'not-active');

  if (data.pageHeaders !== null) {
    const captured = lastRowByName(data.pageHeaders);
    const serverRow = captured.get('server');
    const server = serverRow === undefined ? '' : headerValue(serverRow);
    items.push(
      server === ''
        ? { id: 'server', name: 'Server', status: 'not-active' }
        : {
            id: 'server',
            name: 'Server',
            status: 'active',
            subtitle: server,
            detail: { kind: 'server', value: server }
          }
    );
    const platform = resolvePlatform(data.pageHeaders);
    if (platform !== null) {
      items.push({
        id: 'known-platform',
        name: 'Known Platform',
        status: 'active',
        subtitle: platform.name,
        detail: { kind: 'platform', name: platform.name, header: platform.header }
      });
    }
  }

  for (const row of detectionRows(detections)) {
    if (row === 'async_css') continue;
    const present = detections[row].present;
    switch (row) {
      case 'wpr': {
        const wpr = detections.wpr;
        items.push(
          wpr.present
            ? {
                id: row,
                name: cardName(row),
                status: statusOf(wpr.present),
                subtitle:
                  wpr.version === null ? 'Version: not available' : `Version: ${wpr.version}`,
                detail: { kind: 'version', version: wpr.version }
              }
            : { id: row, name: cardName(row), status: statusOf(wpr.present) }
        );
        if (wpr.cached) {
          const stamp = isRepresentableCacheStamp(wpr.timeStamp) ? wpr.timeStamp : null;
          const formatted = stamp === null ? null : formatCacheTimestamp(stamp);
          items.push({
            id: 'cached',
            name: 'Cached',
            status: 'active',
            subtitle: formatted ?? undefined,
            detail: { kind: 'cached-at', seconds: stamp, formatted }
          });
        }
        continue;
      }
      case 'remove_unused_css': {
        const rucssPresent = detections.remove_unused_css.present;
        const asyncCssPresent = detections.async_css.present;
        if (!asyncCssPresent && !rucssPresent) {
          // Both absent: the shared feature's own card, without the
          // "which one of the two" subtitle.
          items.push({ id: row, name: 'Optimize CSS Delivery', status: 'not-active' });
          continue;
        }
        items.push({
          id: row,
          // Async CSS applied by itself stands in for the disabled RUCSS
          // card (the merge's standalone-evidence branch) — both render
          // states here are the applied one, hence the fixed active verdict.
          name: rucssPresent ? cardName(row) : cardName('async_css'),
          status: 'active',
          subtitle: 'Optimize CSS Delivery'
        });
        continue;
      }
      case 'delay_js': {
        const version = detections.delay_js.version;
        items.push(
          version === null
            ? { id: row, name: cardName(row), status: statusOf(present) }
            : {
                id: row,
                name: cardName(row),
                status: statusOf(present),
                subtitle: `Version: ${version}`,
                detail: { kind: 'version', version }
              }
        );
        continue;
      }
      case 'lazyload_iframes': {
        const replaceImage = detections.lazyload_iframes.replaceImage;
        items.push(
          replaceImage
            ? {
                id: row,
                name: cardName(row),
                status: statusOf(present),
                subtitle: 'Replace iframe with preview image'
              }
            : { id: row, name: cardName(row), status: statusOf(present) }
        );
        continue;
      }
      case 'rocket_above_the_fold_optimization': {
        const count = detections.rocket_above_the_fold_optimization.preloadedImages?.length ?? 0;
        if (count > 0) {
          // Applied evidence: the presentation's coarse count (past nine it
          // reads "9+", not the exact figure the card would only sit on).
          items.push({
            id: row,
            name: cardName(row),
            status: statusOf(present),
            subtitle: `Preloaded images detected: ${count <= 9 ? count.toString() : '9+'}`,
            detail: { kind: 'preloaded-images', count }
          });
        } else if (detections.priority_elements_beacon.present) {
          // Collecting phase: the beacon row is the family's measuring
          // signal — this feature's card must never borrow it as its own
          // "applied" verdict (that conflation is the P1.1 fix).
          items.push({
            id: row,
            name: cardName(row),
            status: statusOf(present),
            subtitle: 'Beacon present, data being collected'
          });
        } else {
          items.push({ id: row, name: cardName(row), status: statusOf(present) });
        }
        continue;
      }
      default:
        items.push({ id: row, name: cardName(row), status: statusOf(present) });
    }
  }
  return items;
}
