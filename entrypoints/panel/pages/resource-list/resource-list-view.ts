/**
 * Pure presentation rules shared by the resource-list pages (Lazyload,
 * Preloaded Resources): chip states, the filtered-empty chip name, query
 * normalization, counted nouns and the polite result announcement. No Solid,
 * no DOM — the page component composes these inside its memo chain.
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

/**
 * Phrase a count with its noun: `1 image`, `0 images`, `24 images`.
 *
 * @param count A non-negative row count.
 * @param noun The noun's count forms.
 * @returns The counted phrase (digits, never words — UI/UX bar W-1).
 */
export function countLabel(count: number, noun: CountNoun): string {
  return `${count.toString()} ${count === 1 ? noun.one : noun.other}`;
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
 * The polite announcement after a committed filter or query change
 * (UI/UX bar K-4): how many rows the list now shows out of how many exist.
 *
 * @param shown Rows the list renders after chip + query.
 * @param total Rows on the page.
 * @param noun The rows' noun.
 * @returns One short sentence for the page's `role="status"` line.
 */
export function resultsAnnouncement(shown: number, total: number, noun: CountNoun): string {
  if (shown === 0) return `No ${noun.other} match`;
  if (shown === total) return `Showing all ${countLabel(total, noun)}`;
  return `Showing ${shown.toString()} of ${countLabel(total, noun)}`;
}

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
