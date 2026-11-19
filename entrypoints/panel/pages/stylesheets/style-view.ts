/**
 * Pure presentation rules for the Stylesheets page: what each state chip
 * looks like and says on hover, the row views (name, preview, size and its
 * bar, chips — built once per row, never in the renderer), the content key
 * a row keeps across refreshes, the detail's facts, the summary and cut
 * lines, and which of its states the page is in.
 */
import type { AskMiss } from '../../../../lib/messaging/bounded-ask';
import type { PageStylesheetsReply } from '../../../../lib/messaging/page-stylesheets';
import { getRealOptionName } from '../../../../lib/options-map/get-real-option-name';
import { liftFacets, type FacetSet } from '../../../../lib/panel/resource-facets';
import {
  CSS_PAGE_FACETS,
  CSS_PAGE_RESOURCES,
  type CssFacetId
} from '../../../../lib/panel/stylesheet-rows';
import { styleIdentity } from '../../../../lib/panel/style-identity';
import {
  CSS_STYLE_STATES,
  type CssStateId,
  type CssStyleResource
} from '../../../../lib/panel/style-states';
import {
  ASYNC_CSS_ATTRIBUTE,
  ASYNC_CSS_ATTRIBUTE_VALUE,
  MINIFY_ATTRIBUTE,
  MINIFY_ATTRIBUTE_VALUE,
  SELF_HOSTED_FONTS_ATTRIBUTE
} from '../../../../lib/wp-rocket/constants';
import { countLabel, formatCompactCount, formatCount } from '../../../../utils/format-count';
import type { AskRunState } from '../ask-run';
import type { DetailFact } from '../resource-list/detail-section';
import { resourceName, urlPreview } from '../resource-list/resource-list-view';
import {
  CALM_VISIBLE_STATE_CHIPS,
  splitStateChips,
  type StateChip,
  type StateChipSplit
} from '../resource-list/state-chips';
import type { StateSource } from '../resource-list/state-sources';

/** The rows' noun. */
export const STYLE_NOUN = { one: 'style', other: 'styles' } as const;

/** The sources a style row's chips can show: WP Rocket only (the page's legend). */
export const CSS_CHIP_SOURCES = ['wp-rocket'] as const satisfies readonly StateSource[];

/** A chip's source and hover text beside its state's label. */
interface ChipDisplay {
  readonly source: (typeof CSS_CHIP_SOURCES)[number];
  readonly title: string;
}

/**
 * Per state: its source and what it says on hover — the feature that did
 * it, by its plugin-settings name. Every state is read off WP Rocket's own
 * footprint (ids, attributes, cache paths), and no FDT simulation or
 * exclusion touches stylesheets, so every source is WP Rocket.
 */
const CSS_CHIP_DISPLAY: Readonly<Record<CssStateId, ChipDisplay>> = {
  critical: {
    source: 'wp-rocket',
    title: `Critical-path CSS printed by WP Rocket (${getRealOptionName('async_css')})`
  },
  rucss: {
    source: 'wp-rocket',
    title: `The used CSS WP Rocket kept (${getRealOptionName('remove_unused_css')})`
  },
  'lazy-bg': {
    source: 'wp-rocket',
    title: `Printed by WP Rocket for ${getRealOptionName('lazyload_css_bg_img')}`
  },
  async: {
    source: 'wp-rocket',
    title: `Loaded without blocking rendering by WP Rocket (${getRealOptionName('async_css')})`
  },
  minified: {
    source: 'wp-rocket',
    title: `Minified by WP Rocket (${getRealOptionName('minify_css')})`
  },
  font: {
    source: 'wp-rocket',
    title: `Google Fonts stylesheet served from the site by WP Rocket (${getRealOptionName('host_fonts_locally')})`
  }
};

/**
 * A row's state chips, most important first.
 *
 * @param row The classified style.
 * @returns One chip per state the row shows.
 */
export function styleStateChips(row: CssStyleResource): StateChip[] {
  const chips: StateChip[] = [];
  for (const state of CSS_STYLE_STATES) {
    if (state.holds(row))
      chips.push({ id: state.id, label: state.label, ...CSS_CHIP_DISPLAY[state.id] });
  }
  return chips;
}

/** One rendered row: the classified style plus what its renderer reads, built once. */
export interface StyleRowView {
  /** The classified style (its `id` is its position in the list it came from). */
  readonly row: CssStyleResource;
  /** The content key: the same style keeps it across refreshes (see {@link styleRowKeys}). */
  readonly key: string;
  /** The row's name: a link's file name, an inline style's `#id.class` or ordinal. */
  readonly name: string;
  /** The name is an identifier (`#id.class`), shown in mono. */
  readonly monoName: boolean;
  /** The preview line: a link's URL without scheme, an inline style's CSS start. */
  readonly preview: string;
  /** The size cell (inline styles: characters, compact), or undefined. */
  readonly size: string | undefined;
  /** The size bar's share (0–1, square-root scale against the largest inline style). */
  readonly sizeShare: number | undefined;
  /** Every state chip (the detail lists them all). */
  readonly chips: readonly StateChip[];
  /** The row's chips: at most two, then "+N". */
  readonly rowChips: StateChipSplit;
}

/** The snapshot-only critical row's key (live keys never start with `snapshot`). */
export const SNAPSHOT_ROW_KEY = 'snapshot:critical';

/** Separates the fields of a content key (never typed into an attribute or id). */
const KEY_FIELD = '\u0001';

/**
 * The content key of every row: the snapshot row's fixed key; for live rows
 * type, `id`, `href`, class, media and preview, plus an occurrence counter
 * for exact duplicates (list positions shift whenever a style is added
 * above, so they cannot identify a row across refreshes).
 *
 * @param rows The classified rows, in list order.
 * @returns One unique key per row, same order.
 */
export function styleRowKeys(rows: readonly CssStyleResource[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    if (row.source === 'snapshot') return SNAPSHOT_ROW_KEY;
    const base = [row.type, row.elementId, row.href, row.className, row.media, row.preview].join(
      KEY_FIELD
    );
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return `live${KEY_FIELD}${base}${KEY_FIELD}${String(occurrence)}`;
  });
}

/** A link without an address (its name). */
export const NO_HREF_NAME = 'No stylesheet address';

/** An inline style's preview when it holds no CSS. */
export const EMPTY_STYLE_PREVIEW = 'Empty';

/**
 * What the snapshot-only critical row says in place of CSS (its preview and
 * its detail). Neutral: WP Rocket's on-load removal is the usual cause, not
 * the only one.
 */
export const CRITICAL_SNAPSHOT_NOTE = 'No longer on the page';

/** The snapshot row's detail: where it comes from and why it has no CSS. */
export const CRITICAL_SNAPSHOT_DETAIL =
  "Captured from the served HTML — its CSS isn't kept. WP Rocket usually removes this style once the stylesheets have loaded; a page script or a RUCSS test can remove it too.";

/**
 * A row's name.
 *
 * @param row The classified style.
 * @param inlineOrdinal Its 1-based position among inline styles.
 * @returns The name and whether it is an identifier (mono).
 */
export function styleName(
  row: CssStyleResource,
  inlineOrdinal: number
): { name: string; mono: boolean } {
  if (row.type === 'external') return { name: resourceName(row.href) || NO_HREF_NAME, mono: false };
  const identity = styleIdentity({ id: row.elementId, className: row.className });
  if (identity !== '') return { name: identity, mono: true };
  return { name: `Inline style #${String(inlineOrdinal)}`, mono: false };
}

/**
 * The media words a row shows: none for no media or `all` (the default
 * every page writes — noise on most rows), the attribute's own words otherwise.
 *
 * @param media The element's media attribute.
 * @returns E.g. `media: print`, or null.
 */
export function mediaDetail(media: string): string | null {
  const value = media.trim();
  return value === '' || value.toLowerCase() === 'all' ? null : `media: ${value}`;
}

/**
 * A row's preview line: the media first when it says anything ("media:
 * print · …"), then a link's URL without scheme or an inline style's CSS.
 *
 * @param row The classified style.
 */
export function stylePreview(row: CssStyleResource): string {
  if (row.source === 'snapshot') return CRITICAL_SNAPSHOT_NOTE;
  const text =
    row.type === 'external'
      ? urlPreview(row.href)
      : row.preview === ''
        ? EMPTY_STYLE_PREVIEW
        : row.preview;
  const media = mediaDetail(row.media);
  return media === null ? text : `${media} · ${text}`;
}

/**
 * The size bar's share: the square root of the style's part of the largest
 * one, so a 20 KB sheet next to 100-character ones still reads as a bar and
 * the small ones stay visible (never below 2 %).
 *
 * @param chars The style's characters.
 * @param max The largest inline style's characters.
 * @returns The share (0–1), or undefined for an empty style or nothing to compare.
 */
export function sizeShare(chars: number, max: number): number | undefined {
  // An empty style draws no bar (its "0" says it all).
  if (max <= 0 || chars <= 0) return undefined;
  return Math.max(0.02, Math.sqrt(Math.min(chars, max) / max));
}

/**
 * Build the row views (chips, names and sizes once per row).
 *
 * @param rows The classified styles, in list order.
 * @returns One view per row, same order.
 */
export function styleRowViews(rows: readonly CssStyleResource[]): StyleRowView[] {
  const keys = styleRowKeys(rows);
  const live = rows.filter((row) => row.type === 'inline' && row.source === 'live');
  const max = live.reduce((largest, row) => Math.max(largest, row.chars), 0);
  let inline = 0;
  return rows.map((row, index) => {
    if (row.type === 'inline') inline += 1;
    const chips = styleStateChips(row);
    const { name, mono } = styleName(row, inline);
    const sized = row.type === 'inline' && row.source === 'live';
    return {
      row,
      key: keys[index] ?? SNAPSHOT_ROW_KEY,
      name,
      monoName: mono,
      preview: stylePreview(row),
      size: sized ? formatCompactCount(row.chars) : undefined,
      sizeShare: sized ? sizeShare(row.chars, max) : undefined,
      chips,
      rowChips: splitStateChips(chips, CALM_VISIBLE_STATE_CHIPS)
    };
  });
}

/**
 * Whether two views of one key show the same thing — every field the view
 * derives from, and the position (the CSS read addresses it).
 *
 * @param a The previous view.
 * @param b The fresh view.
 */
export function sameStyleView(a: StyleRowView, b: StyleRowView): boolean {
  return (
    a.row.id === b.row.id &&
    a.name === b.name &&
    a.size === b.size &&
    a.sizeShare === b.sizeShare &&
    sameStyleRow(a.row, b.row)
  );
}

/**
 * Whether two classified styles carry the same data (position ignored).
 *
 * @param a The previous row.
 * @param b The fresh row.
 */
export function sameStyleRow(a: CssStyleResource, b: CssStyleResource): boolean {
  return (
    a.type === b.type &&
    a.source === b.source &&
    a.elementId === b.elementId &&
    a.className === b.className &&
    a.href === b.href &&
    a.media === b.media &&
    a.preview === b.preview &&
    a.chars === b.chars &&
    a.minified === b.minified &&
    a.minifyAttribute === b.minifyAttribute &&
    a.critical === b.critical &&
    a.rocketAsync === b.rocketAsync &&
    a.hostedFont === b.hostedFont
  );
}

/** The page's facets over row views (the row facets, lifted). */
export const CSS_VIEW_FACETS: FacetSet<StyleRowView, CssFacetId> = liftFacets(
  CSS_PAGE_FACETS,
  (view: StyleRowView) => view.row
);

/**
 * A view's searched field: a link's URL, an inline style's identity and CSS preview.
 *
 * @param view The row view.
 */
export function styleSearchField(view: StyleRowView): string {
  return CSS_PAGE_RESOURCES.searchField(view.row);
}

/**
 * The detail's caps kind label.
 *
 * @param view The row view.
 */
export function styleKind(view: StyleRowView): string {
  if (view.row.source === 'snapshot') return 'Critical-path style';
  return view.row.type === 'inline' ? 'Inline style' : 'Stylesheet link';
}

/** Characters, in their two count forms. */
const CHARACTER_NOUN = { one: 'character', other: 'characters' } as const;

/**
 * The facts a style's element carries — only those that hold.
 *
 * @param view The row view.
 * @returns The facts, in reading order.
 */
export function styleFacts(view: StyleRowView): DetailFact[] {
  const { row } = view;
  const facts: DetailFact[] = [];
  const identity = styleIdentity({ id: row.elementId, className: row.className });
  if (row.type === 'external' && identity !== '')
    facts.push({ label: 'Element', value: identity, mono: true });
  if (row.media.trim() !== '') facts.push({ label: 'Media', value: row.media, mono: true });
  if (row.rocketAsync)
    facts.push({
      label: 'Async stamp',
      value: `${ASYNC_CSS_ATTRIBUTE}="${ASYNC_CSS_ATTRIBUTE_VALUE}"`,
      mono: true
    });
  if (row.minifyAttribute)
    facts.push({
      label: 'Minify stamp',
      value: `${MINIFY_ATTRIBUTE}="${MINIFY_ATTRIBUTE_VALUE}"`,
      mono: true
    });
  if (row.hostedFont)
    facts.push({ label: 'Hosted font', value: SELF_HOSTED_FONTS_ATTRIBUTE, mono: true });
  if (row.type === 'inline' && row.source === 'live')
    facts.push({ label: 'Size', value: countLabel(row.chars, CHARACTER_NOUN), mono: false });
  return facts;
}

/**
 * The muted line under the summary when the page has more styles than one
 * read lists.
 *
 * @param reply The inventory.
 * @returns The note, or `null` while every style is listed.
 */
export function listCutNote(reply: Pick<PageStylesheetsReply, 'styles' | 'total'>): string | null {
  if (reply.total <= reply.styles.length) return null;
  return `Showing the first ${formatCount(reply.styles.length)} of ${formatCount(reply.total)} styles.`;
}

/**
 * The page's states:
 * - `loading` — the first read (or the first read of a new page load) is on its way;
 * - `failed` — no list to show: the read missed the page (named miss, Retry);
 * - `ready` — a list of this page load; `refreshing` while a newer read is on
 *   its way, `refreshMiss` when the latest one missed (the list stays).
 */
export type StylesheetsView =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly miss: AskMiss }
  | {
      readonly status: 'ready';
      readonly reply: PageStylesheetsReply;
      readonly refreshing: boolean;
      readonly refreshMiss: AskMiss | null;
    };

/** A read's outcome: the inventory, or the miss that left the page unanswered. */
export type StylesheetsOutcome =
  | { readonly kind: 'reply'; readonly reply: PageStylesheetsReply }
  | { readonly kind: 'page-unreachable'; readonly miss: AskMiss };

/**
 * Which state the page shows. A list of an earlier page load is never shown
 * beside the current page's facts: it reads as loading while the new read
 * runs (the page re-reads on its own), as failed when that read missed.
 *
 * @param state The read machine's state.
 * @param stale Whether the shown answer measured an earlier page load.
 * @returns The page state.
 */
export function stylesheetsView(
  state: AskRunState<StylesheetsOutcome>,
  stale: boolean
): StylesheetsView {
  const shown = state.shown?.outcome;
  const failure = state.failure?.outcome;
  if (shown === undefined || state.pending) {
    if (shown?.kind === 'reply' && !stale) {
      return { status: 'ready', reply: shown.reply, refreshing: true, refreshMiss: null };
    }
    return { status: 'loading' };
  }
  if (shown.kind === 'page-unreachable') return { status: 'failed', miss: shown.miss };
  if (stale) {
    return failure?.kind === 'page-unreachable'
      ? { status: 'failed', miss: failure.miss }
      : { status: 'loading' };
  }
  return {
    status: 'ready',
    reply: shown.reply,
    refreshing: false,
    refreshMiss: failure?.kind === 'page-unreachable' ? failure.miss : null
  };
}
