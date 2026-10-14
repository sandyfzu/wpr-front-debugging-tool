/**
 * Pure presentation rules shared by the resource-list pages (Lazyload,
 * Preloaded Resources): chip states, the filtered-empty chip name, query
 * normalization, counted nouns, the polite result announcement, row reuse
 * across refreshes and resource naming. No Solid, no DOM — the page component
 * composes these inside its memo chain.
 */
import type { FilterChip } from '../../../../components/ui/filter-bar';
import type { ResourcePageDefinition } from '../../../../lib/panel/resources-view-model';

/** A noun in its two English count forms ("image" / "images"). */
export interface CountNoun {
  /** The singular form, used for exactly one. */
  readonly one: string;
  /** The plural form, used for zero and many. */
  readonly other: string;
}

/** Count formatting: digits with thousands separators (`5,000`), one locale everywhere. */
const COUNT_FORMAT = new Intl.NumberFormat('en-US');

/**
 * Format a count as digits with thousands separators (`5,000`).
 *
 * @param count A non-negative count.
 * @returns The formatted digits.
 */
export function formatCount(count: number): string {
  return COUNT_FORMAT.format(count);
}

/**
 * Phrase a count with its noun: `1 image`, `0 images`, `5,000 images` —
 * digits rather than words, so counts scan and compare at a glance.
 *
 * @param count A non-negative row count.
 * @param noun The noun's count forms.
 * @returns The counted phrase.
 */
export function countLabel(count: number, noun: CountNoun): string {
  return `${formatCount(count)} ${count === 1 ? noun.one : noun.other}`;
}

/**
 * The first chip of a definition — by the resource-page contract the
 * identity ("all") chip, the default selection and the `Show all` target.
 *
 * @param definition The page's pattern.
 * @returns The first chip's id.
 * @throws {@link Error} When the definition declares no chips (a wiring bug).
 */
export function defaultChipId<Row, Id extends string>(
  definition: ResourcePageDefinition<Row, Id>
): Id {
  const first = definition.filters[0];
  if (first === undefined) {
    throw new Error('Resource page definition has no filter chips: it needs at least "all".');
  }
  return first.id;
}

/**
 * Build the filter bar's chips from the definition and the one-pass counts.
 *
 * A chip with nothing to select is disabled — a click on it could only lead
 * to an empty list — except the default chip (always the way back) and the
 * selected chip (a refresh that empties it must not strand the selection on
 * a disabled control; the list then offers `Show all`).
 *
 * @param definition The page's pattern (chip order = render order).
 * @param counts The per-chip counts over the full row list.
 * @param selected The selected chip id.
 * @returns The chips in definition order.
 */
export function buildFilterChips<Row, Id extends string>(
  definition: ResourcePageDefinition<Row, Id>,
  counts: Readonly<Record<Id, number>>,
  selected: Id
): FilterChip[] {
  const fallback = defaultChipId(definition);
  return definition.filters.map((filter): FilterChip => {
    const count = counts[filter.id];
    return {
      value: filter.id,
      label: filter.label,
      count,
      disabled: count === 0 && filter.id !== fallback && filter.id !== selected
    };
  });
}

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

/**
 * The query the list filters by: surrounding whitespace dropped, so a stray
 * space neither empties the list nor leaves a filtered-empty view whose
 * `Clear search` cannot render (a blank query names nothing to clear).
 *
 * @param raw The committed search-store query.
 * @returns The trimmed query (`''` = no search).
 */
export function normalizeQuery(raw: string): string {
  return raw.trim();
}

/**
 * The polite announcement after a committed filter or query change: how many
 * rows the list now shows out of how many exist (one line per commit, so a
 * screen reader hears the result without a per-keystroke stream).
 *
 * @param shown Rows the list renders after chip + query.
 * @param total Rows on the page.
 * @param noun The rows' noun.
 * @returns One short sentence for the page's `role="status"` line.
 */
export function resultsAnnouncement(shown: number, total: number, noun: CountNoun): string {
  if (shown === 0) return `No ${noun.other} match`;
  if (shown === total) return `Showing all ${countLabel(total, noun)}`;
  return `Showing ${formatCount(shown)} of ${countLabel(total, noun)}`;
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

/** Longest text a hover `title` carries (a 4,096-char URL tooltip covers the screen). */
export const TITLE_MAX = 300;

/** Longest resource name echoed inside a control's accessible name. */
export const LABEL_NAME_MAX = 60;

/**
 * Cap a text at `max` code points, eliding the rest with `…` (never splitting
 * a surrogate pair).
 *
 * @param text The full text.
 * @param max The longest kept length, in code points.
 * @returns The text, or its first `max` code points plus `…`.
 */
export function capText(text: string, max: number): string {
  const points = Array.from(text);
  return points.length > max ? `${points.slice(0, max).join('')}…` : text;
}

/**
 * Cap a hover-title text (see {@link TITLE_MAX}).
 *
 * @param text The full text.
 * @returns The capped text.
 */
export function capTitle(text: string): string {
  return capText(text, TITLE_MAX);
}

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
  const byId = new Map(previous.map((row) => [row.id, row]));
  let changed = previous.length !== next.length;
  const merged = next.map((row, index) => {
    const prior = byId.get(row.id);
    if (prior !== undefined && same(prior, row)) {
      if (previous[index] !== prior) changed = true;
      return prior;
    }
    changed = true;
    return row;
  });
  return changed ? merged : previous;
}

/**
 * Whether the capture cut a list at its cap: the payload's `truncated` mark
 * alone does not say so (a clipped string sets it too), so the list must also
 * sit at its cap.
 *
 * @param truncated The row's truncation mark.
 * @param length The list's length as received.
 * @param cap The list's count cap.
 * @returns `true` when entries past the cap were dropped.
 */
export function listCapped(truncated: true | undefined, length: number, cap: number): boolean {
  return truncated === true && length >= cap;
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
