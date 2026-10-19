/**
 * The Headers & Cookies page's pure row model: the shared headers model plus
 * the cookie capture, flattened into the one row list the page's single
 * scroller renders — section headings and item rows interleaved, every row
 * keyed by a stable id so a soft refresh re-uses rows instead of rebuilding
 * them.
 *
 * Also owns the page's two pieces of copy logic that must never drift from
 * the rows: the clipboard payload of a header row and the secret-header
 * redaction (cookie values, credentials and tokens never reach the panel's
 * DOM or clipboard).
 */
import type { HeaderRowVM, HeadersViewModel } from '../../../../lib/panel/headers-view-model';
import type { CountNoun } from '../../../../lib/panel/list-behavior';
import { formatCacheTimestamp, MAX_REPRESENTABLE_MS } from '../../../../lib/detection/describe';
import { shownHeader, type ShownHeader } from '../../../../lib/panel/shown-header';
import type { DataState } from '../../state/fdt-state-machine';
import type { PageCookies } from '../../../../lib/wp-rocket/types';

/** The three sections, in render order. */
export type InventorySectionId = 'caching' | 'other' | 'cookies';

/** The sections' visible headings (also their `aria-level="2"` names). */
export const SECTION_TITLES: Readonly<Record<InventorySectionId, string>> = {
  caching: 'Caching evidence',
  other: 'Other headers',
  cookies: 'Cookies'
};

/** The caching section's line when the response carried no caching-relevant header. */
export const NO_CACHING_HEADERS_NOTE =
  'No caching-relevant headers in this response — nothing here says a cache handled it.';

/** The cookie section's line for a capture that read zero names. */
export const NO_COOKIES_NOTE = 'No cookies are readable by page scripts.';

/** The cookie section's lead: both limits of what the section can show. */
export const COOKIES_LEAD =
  'Names only — values are never captured. HttpOnly cookies are invisible to page scripts, so they never appear here.';

/**
 * The inventory's noun for the shared count line and its announcements: the
 * one list mixes header rows and cookie rows, so neither kind's name can
 * phrase its total.
 */
export const INVENTORY_NOUN: CountNoun = { one: 'entry', other: 'entries' };

/** One row of the flattened inventory. */
export type InventoryRow =
  | {
      readonly kind: 'section';
      readonly id: string;
      readonly section: InventorySectionId;
      /** How many item rows the section holds (its count badge). */
      readonly count: number;
    }
  | {
      readonly kind: 'header';
      readonly id: string;
      readonly section: 'caching' | 'other';
      /** The header row, its value already withheld where it could carry a secret. */
      readonly header: ShownHeader;
      /** 1-based position among the section's rows sharing this name (any casing). */
      readonly occurrence: number;
      /** How many of the section's rows share this name (1 for a unique name). */
      readonly occurrences: number;
    }
  | { readonly kind: 'cookie'; readonly id: string; readonly name: string }
  | { readonly kind: 'note'; readonly id: string; readonly text: string };

/** The page's renderable inventory. */
export interface Inventory {
  /** True when the capture holds at least one header row (else the page's empty state). */
  readonly hasHeaders: boolean;
  /** True when the payload carries the cookie capture at all (older payloads do not). */
  readonly hasCookies: boolean;
  /** The flattened rows for the one scroller (empty when there is nothing to list). */
  readonly rows: readonly InventoryRow[];
}

/**
 * The clipboard payload of one header row: the wire form `name: value`
 * (a valueless row copies as `name:`, which is what it was on the wire).
 *
 * @param header The (already shown/redacted) header row.
 * @returns The `name: value` (or `name:`) text.
 */
export function headerCopyText(header: Omit<HeaderRowVM, 'redacted'>): string {
  return header.value === null ? `${header.name}:` : `${header.name}: ${header.value}`;
}

/**
 * The clipboard payload of the whole capture: every row's wire form in the
 * order the page lists them, one per line.
 *
 * @param rows The inventory's rows.
 * @returns One line per header row; empty when there is none.
 */
export function allHeadersCopyText(rows: readonly InventoryRow[]): string {
  return rows
    .flatMap((row) => (row.kind === 'header' ? [headerCopyText(row.header)] : []))
    .join('\n');
}

/**
 * Flatten one header group into its section rows. An empty group yields no
 * rows, except the caching group beside a non-empty capture: there the
 * absence is itself the evidence, so it says so.
 *
 * Row keys follow the header, not its position: `<section>:<lowercase
 * name>#<occurrence>` — a refresh that reorders headers keeps each row's
 * element, and repeated names (several `link` or `vary` rows) stay unique.
 *
 * @param section Which header group the rows belong to.
 * @param headers The group's rows from the shared model.
 * @param captureHasRows Whether the capture as a whole holds any row.
 * @returns The section's rows (heading first), possibly none.
 */
function headerSection(
  section: 'caching' | 'other',
  headers: readonly HeaderRowVM[],
  captureHasRows: boolean
): InventoryRow[] {
  if (headers.length === 0) {
    if (section !== 'caching' || !captureHasRows) return [];
    return [
      { kind: 'section', id: `section:${section}`, section, count: 0 },
      { kind: 'note', id: `note:${section}`, text: NO_CACHING_HEADERS_NOTE }
    ];
  }
  const totals = new Map<string, number>();
  for (const header of headers) {
    const name = header.name.toLowerCase();
    totals.set(name, (totals.get(name) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return [
    { kind: 'section', id: `section:${section}`, section, count: headers.length },
    ...headers.map((header): InventoryRow => {
      const name = header.name.toLowerCase();
      const occurrence = (seen.get(name) ?? 0) + 1;
      seen.set(name, occurrence);
      return {
        kind: 'header',
        id: `${section}:${name}#${(occurrence - 1).toString()}`,
        section,
        header: shownHeader(header),
        occurrence,
        occurrences: totals.get(name) ?? 1
      };
    })
  ];
}

/**
 * The name of a header row's copy control (also its toast subject): the
 * header's name, disambiguated when the section repeats it — "link header
 * (2 of 3)" — so a screen-reader list of copy controls never repeats a name.
 *
 * @param row The header row.
 * @returns The control's label.
 */
export function headerCopyLabel(row: Extract<InventoryRow, { kind: 'header' }>): string {
  const base = `${row.header.name} header`;
  return row.occurrences > 1
    ? `${base} (${row.occurrence.toString()} of ${row.occurrences.toString()})`
    : base;
}

/**
 * Build the page's inventory: the caching group, the other headers, then the
 * cookie names. A payload without the cookie capture (older content scripts)
 * yields no cookie section at all; a capture that read no names yields the
 * section with its one-line note.
 *
 * @param headers The shared headers model of the payload.
 * @param cookies The payload's cookie capture, or undefined when it lacks one.
 * @returns The inventory: presence flags plus the flattened rows.
 */
export function buildInventory(
  headers: HeadersViewModel,
  cookies: PageCookies | undefined
): Inventory {
  const hasHeaders = headers.caching.length + headers.other.length > 0;
  const rows: InventoryRow[] = [
    ...headerSection('caching', headers.caching, hasHeaders),
    ...headerSection('other', headers.other, hasHeaders)
  ];
  if (cookies !== undefined) {
    rows.push({
      kind: 'section',
      id: 'section:cookies',
      section: 'cookies',
      count: cookies.names.length
    });
    if (cookies.names.length === 0) {
      rows.push({ kind: 'note', id: 'note:cookies', text: NO_COOKIES_NOTE });
    } else {
      // Names are unique by contract, so they key their rows directly.
      for (const name of cookies.names) rows.push({ kind: 'cookie', id: `cookie:${name}`, name });
    }
  }
  return { hasHeaders, hasCookies: cookies !== undefined, rows };
}

/**
 * The row field the page's filter matches: the header's or cookie's name.
 * Values are never searched — the page's contract is name evidence (cookie
 * values are not captured, and a header value must not become a search
 * path). Section headings and notes carry no searched name; the filter
 * never matches their text.
 *
 * @param row The inventory row.
 * @returns The searched name, or null for a row that searches nothing.
 */
export function inventoryItemName(row: InventoryRow): string | null {
  switch (row.kind) {
    case 'header':
      return row.header.name;
    case 'cookie':
      return row.name;
    default:
      return null;
  }
}

/**
 * The rows the page renders under one filter query: a case-insensitive
 * substring match on each row's searched name (the resource pages' search
 * semantics, over the names this page lists). A blank query is the whole
 * inventory unchanged (same array identity, so an unaffected memo chain
 * stays idle). Under a query:
 *
 * - a section heading survives only when its section holds a match, and its
 *   count badge states the matching count (the badge never lies about what
 *   the filtered list shows);
 * - the capture notes (`NO_CACHING_HEADERS_NOTE`, `NO_COOKIES_NOTE`) drop —
 *   they describe the capture, and under a filter they would read as
 *   "nothing matches"; the page's filtered-empty state speaks instead;
 * - rows keep their object identity, so a narrowing pass never rebuilds
 *   matched rows (their keyed DOM, focus included, survives typing).
 *
 * @param rows The full inventory rows.
 * @param rawQuery The field's committed text (trimmed here; whitespace is no filter).
 * @returns The rows to render, in inventory order.
 */
export function filterInventory(
  rows: readonly InventoryRow[],
  rawQuery: string
): readonly InventoryRow[] {
  const needle = rawQuery.trim().toLowerCase();
  if (needle === '') return rows;
  const out: InventoryRow[] = [];
  let pending: {
    section: Extract<InventoryRow, { kind: 'section' }>;
    items: InventoryRow[];
  } | null = null;
  const flushSection = (): void => {
    if (pending === null || pending.items.length === 0) return;
    out.push({ ...pending.section, count: pending.items.length });
    out.push(...pending.items);
  };
  for (const row of rows) {
    if (row.kind === 'section') {
      flushSection();
      pending = { section: row, items: [] };
      continue;
    }
    if (row.kind === 'note') continue;
    const name = inventoryItemName(row);
    if (name === null || !name.toLowerCase().includes(needle)) continue;
    if (pending === null) out.push(row);
    else pending.items.push(row);
  }
  flushSection();
  return out;
}

/**
 * The seed height (px) of a row before measurement corrects it — close to
 * the rendered heights so the first paint barely shifts.
 *
 * @param row The row to estimate.
 * @returns The seed height in px.
 */
export function estimateRowHeight(row: InventoryRow): number {
  switch (row.kind) {
    case 'section':
      return row.section === 'cookies' ? 64 : 40;
    case 'header':
      // A hint adds a second line (a withheld value is one line: its
      // marker never carries a hint).
      return row.header.hint === null ? 44 : 62;
    case 'cookie':
    case 'note':
      return 32;
  }
}

/**
 * The fetch instant the header section shows: the `ready` state's stamp,
 * held across `refreshing` (the data on screen is still that fetch's), and
 * nothing in the states that render no page.
 *
 * @param state The data machine's current state.
 * @param previous The stamp held so far (null before the first `ready`).
 * @returns The stamp to show, or null.
 */
export function heldFetchStamp(state: DataState, previous: number | null): number | null {
  if (state.status === 'ready') return state.fetchedAt;
  if (state.status === 'refreshing') return previous;
  return null;
}

/**
 * Whether a millisecond stamp names an instant `Date` can represent (a
 * hostile or broken stamp must degrade to "no absolute form", never throw).
 *
 * @param ms The stamp.
 * @returns True for a finite stamp within the platform's date range.
 */
function isRepresentableMs(ms: number): boolean {
  return Number.isFinite(ms) && Math.abs(ms) <= MAX_REPRESENTABLE_MS;
}

/**
 * Format a wall-clock millisecond stamp in the panel's absolute form — the
 * same whole-second rounding the status bar's freshness detail uses, so the
 * two surfaces never disagree about one fetch.
 *
 * @param ms The stamp.
 * @returns `YYYY-MM-DD HH:MM:SS UTC`, or null when the stamp names no
 *   representable instant.
 */
export function absoluteStamp(ms: number): string | null {
  if (!isRepresentableMs(ms)) return null;
  return formatCacheTimestamp(Math.round(ms / 1000));
}

/**
 * A stamp the page may show: one that names a representable instant. A
 * garbage stamp shows nothing — a relative age computed from it would be as
 * invented as its absolute form.
 *
 * @param ms The stamp, or nothing.
 * @returns The stamp, or null when there is none worth showing.
 */
export function shownStamp(ms: number | null | undefined): number | null {
  return ms !== null && ms !== undefined && isRepresentableMs(ms) ? ms : null;
}

/**
 * The ISO form of a stamp for a `<time datetime>` attribute.
 *
 * @param ms The stamp.
 * @returns The ISO string, or undefined when the stamp names no representable instant.
 */
export function isoStamp(ms: number): string | undefined {
  return isRepresentableMs(ms) ? new Date(ms).toISOString() : undefined;
}
