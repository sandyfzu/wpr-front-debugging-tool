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
import { formatCacheTimestamp, MAX_REPRESENTABLE_MS } from '../../../../lib/detection/describe';
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

/** What a secret-bearing header value shows (and copies) instead of itself. */
export const REDACTED_VALUE = '(value redacted)';

/** A header row as the page shows and copies it. */
export interface ShownHeader extends HeaderRowVM {
  /** True when the captured value was withheld (see {@link shownHeader}). */
  readonly redacted: boolean;
}

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

/** Header names whose values are always secret (compared trimmed, lowercase). */
const SECRET_HEADER_NAMES: ReadonlySet<string> = new Set([
  'cookie',
  'set-cookie',
  'set-cookie2',
  'authorization',
  'proxy-authorization',
  'x-debug-token',
  'x-debug-token-link'
]);

/**
 * Name fragments that mark a header as secret-bearing. Deliberately
 * over-inclusive: withholding a harmless value costs one question, showing a
 * session token costs an account.
 */
const SECRET_NAME_FRAGMENT =
  /token|secret|session|auth|nonce|signature|api[-_]?key|csrf|xsrf|passw(?:or)?d|credential|jwt|hmac|bearer|private|pwd|(?:^|[-_])pass(?:[-_]|$)|(?:^|[-_])sig(?:[-_]|$)|(?:^|[-_])key$/i;

/**
 * Whether a header's value may carry a secret (credentials, cookies,
 * tokens, nonces, signatures).
 *
 * @param name The header name, any casing.
 */
export function isSecretHeaderName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return SECRET_HEADER_NAMES.has(lower) || SECRET_NAME_FRAGMENT.test(lower);
}

/**
 * The cookie name a `Set-Cookie` value sets — the text before `=` within
 * its first `;`-segment — or null when there is no well-formed name
 * (`Set-Cookie: SECRET`, `tok; Path=/`): then nothing of the value is kept.
 * Only the first cookie of a folded value is named.
 *
 * @param value The raw `Set-Cookie` value.
 */
export function setCookieName(value: string): string | null {
  const first = value.split(/[;\n]/, 1)[0] ?? '';
  const equalsAt = first.indexOf('=');
  const name = equalsAt === -1 ? '' : first.slice(0, equalsAt).trim();
  return name === '' ? null : name;
}

/**
 * The header row as the page may show and copy it. A secret-bearing header
 * keeps its name and loses its whole value — attributes and hint included
 * (a hint can echo the value); a `Set-Cookie` keeps only the cookie's name,
 * which is caching evidence. Everything else passes untouched.
 *
 * @param header A row of the shared headers model.
 */
export function shownHeader(header: HeaderRowVM): ShownHeader {
  if (header.value === null || !isSecretHeaderName(header.name)) {
    return { ...header, redacted: false };
  }
  const lower = header.name.trim().toLowerCase();
  const cookieName =
    lower === 'set-cookie' || lower === 'set-cookie2' ? setCookieName(header.value) : null;
  return {
    name: header.name,
    value: cookieName === null ? REDACTED_VALUE : `${cookieName}=${REDACTED_VALUE}`,
    hint: null,
    redacted: true
  };
}

/**
 * The clipboard payload of one header row: the wire form `name: value`
 * (a valueless row copies as `name:`, which is what it was on the wire).
 *
 * @param header The (already shown/redacted) header row.
 */
export function headerCopyText(header: HeaderRowVM): string {
  return header.value === null ? `${header.name}:` : `${header.name}: ${header.value}`;
}

/**
 * The clipboard payload of the whole capture: every row's wire form in the
 * order the page lists them, one per line.
 *
 * @param rows The inventory's rows.
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
  const occurrences = new Map<string, number>();
  return [
    { kind: 'section', id: `section:${section}`, section, count: headers.length },
    ...headers.map((header): InventoryRow => {
      const name = header.name.toLowerCase();
      const occurrence = occurrences.get(name) ?? 0;
      occurrences.set(name, occurrence + 1);
      return {
        kind: 'header',
        id: `${section}:${name}#${occurrence.toString()}`,
        section,
        header: shownHeader(header)
      };
    })
  ];
}

/**
 * Build the page's inventory: the caching group, the other headers, then the
 * cookie names. A payload without the cookie capture (older content scripts)
 * yields no cookie section at all; a capture that read no names yields the
 * section with its one-line note.
 *
 * @param headers The shared headers model of the payload.
 * @param cookies The payload's cookie capture, or undefined when it lacks one.
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
 * The seed height (px) of a row before measurement corrects it — close to
 * the rendered heights so the first paint barely shifts.
 *
 * @param row The row to estimate.
 */
export function estimateRowHeight(row: InventoryRow): number {
  switch (row.kind) {
    case 'section':
      return row.section === 'cookies' ? 64 : 40;
    case 'header':
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
