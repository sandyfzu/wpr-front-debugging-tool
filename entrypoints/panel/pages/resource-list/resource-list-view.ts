/**
 * Pure presentation rules shared by the resource-list pages (Lazyload,
 * Preloaded Resources): the filtered-empty chip name, query normalization,
 * row reuse across refreshes and resource naming. No Solid, no DOM — the
 * page component composes these inside its memo chain. Count phrasing and
 * the results announcement are shared rules of `lib/panel/list-behavior`.
 */
import { defaultChipId, reconcileList } from '../../../../lib/panel/list-behavior';
export {
  defaultChipId,
  buildFilterChips,
  normalizeQuery,
  listCapped
} from '../../../../lib/panel/list-behavior';
import type { ResourcePageDefinition } from '../../../../lib/panel/resources-view-model';

/**
 * The selected chip's label for the filtered-empty sentence, or `undefined`
 * while the default chip is selected (it narrows nothing, so naming it would
 * lie about what is filtering).
 *
 * @param definition The page's pattern.
 * @param selected The selected chip id.
 * @returns The narrowing chip's label, if any.
 */
export function narrowingChipLabel<Row, Id extends string>(
  definition: ResourcePageDefinition<Row, Id>,
  selected: Id
): string | undefined {
  if (selected === defaultChipId(definition)) return undefined;
  return definition.filters.find((filter) => filter.id === selected)?.label;
}

/** Schemes whose path names a resource (relative URLs resolve to `https:`). */
const WEB_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:', 'blob:']);

/** Base for resolving relative URLs when naming them (never fetched or shown). */
const NAMING_BASE = 'https://resource.invalid/';

/**
 * A resource's display name — what the DevTools Network panel calls a
 * request's "Name": the URL's last path segment (percent-decoded when valid),
 * the host for a bare origin, `data:<mime>` for a data URL. In a narrow panel
 * the full URL truncates long before the part that tells two images apart, so
 * rows lead with this name and keep the full URL beneath it.
 *
 * Pure text: the result is rendered as text only, never used as a link.
 *
 * @param url The captured URL (absolute, relative or protocol-relative; `''` allowed).
 * @returns The name, `''` for an empty URL, or the URL itself when nothing shorter names it.
 */
export function resourceName(url: string): string {
  const raw = url.trim();
  if (raw === '') return '';
  const data = /^data:([^;,]*)/i.exec(raw);
  if (data !== null) return data[1] === undefined || data[1] === '' ? 'data:' : `data:${data[1]}`;
  let parsed: URL;
  try {
    parsed = new URL(raw, NAMING_BASE);
  } catch {
    return raw;
  }
  // A scheme with no path hierarchy (`javascript:`, `mailto:`…) is named by
  // its scheme: its "last segment" would read as a file name it is not.
  if (!WEB_SCHEMES.has(parsed.protocol)) return `${parsed.protocol} URL`;
  const last = parsed.pathname
    .split('/')
    .filter((segment) => segment !== '')
    .at(-1);
  if (last !== undefined) return decodeSegment(last);
  return parsed.origin === new URL(NAMING_BASE).origin ? raw : parsed.host || raw;
}

/**
 * Percent-decode one path segment, keeping the raw text when it is not
 * valid percent-encoding (`%E0%A4%A` would throw).
 *
 * @param segment The raw path segment.
 * @returns The decoded segment, or the raw one.
 */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Longest resource name echoed inside a control's accessible name. */
export const LABEL_NAME_MAX = 60;

/**
 * Reuse the previous refresh's row objects where a row is unchanged, so the
 * list's keyed rows keep their DOM (and the focus inside it) across a soft
 * refresh; changed and new rows take the fresh object.
 *
 * @param previous The rows the list rendered last (`[]` on the first pass).
 * @param next The freshly built rows.
 * @param same Whether two rows with the same id carry the same content.
 * @returns `previous` itself when nothing changed, else `next` with every
 *   unchanged row swapped for its previous object.
 */
export function reconcileRows<Row extends { readonly id: number }>(
  previous: readonly Row[],
  next: readonly Row[],
  same: (a: Row, b: Row) => boolean
): readonly Row[] {
  return reconcileList(
    previous,
    next,
    (row) => row.id,
    (row) => row.id,
    same,
    (row) => row
  );
}

/**
 * Whether the capture clipped one URL at its length cap. The clip may stop one
 * unit short (it never splits a surrogate pair), so a marked payload's URL at
 * `cap − 1` or longer counts as clipped — a natural URL of exactly that length
 * on a marked payload is flagged too, the safe side (the warning only asks to
 * check the copy).
 *
 * @param truncated The row's truncation mark.
 * @param url The received URL.
 * @param cap The URL length cap.
 * @returns `true` when the URL may be cut.
 */
export function urlClipped(truncated: true | undefined, url: string, cap: number): boolean {
  return truncated === true && url.length >= cap - 1;
}
