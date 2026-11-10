/**
 * Pure presentation rules for the Stylesheets page: what each state chip
 * looks like and says on hover, the row views (chips built once per row,
 * never in the renderer), row identity across refreshes, the seed heights,
 * the summary and cut lines, and which of its states the page is in.
 */
import type { AskMiss } from '../../../../lib/messaging/bounded-ask';
import type { PageStylesheetsReply } from '../../../../lib/messaging/page-stylesheets';
import { getRealOptionName } from '../../../../lib/options-map/get-real-option-name';
import { styleIdentity } from '../../../../lib/panel/style-identity';
import {
  CSS_STYLE_STATES,
  type CssStateId,
  type CssStyleResource
} from '../../../../lib/panel/style-states';
import { formatCount } from '../../../../utils/format-count';
import type { AskRunState } from '../ask-run';
import { splitStateChips, type StateChip, type StateChipSplit } from '../resource-list/state-chips';
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
export interface StyleRowView extends CssStyleResource {
  /** The state chips, split (at most three, then "+N"). */
  readonly chips: StateChipSplit;
  /** `#id.class`, or `''`. */
  readonly identity: string;
  /** The media detail ("media: print"), or null when it says nothing. */
  readonly mediaDetail: string | null;
}

/**
 * The media detail a row shows: none for no media or `all` (the default
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
 * Build the row views.
 *
 * @param rows The classified styles.
 * @returns One view per row, same order.
 */
export function styleRowViews(rows: readonly CssStyleResource[]): StyleRowView[] {
  return rows.map((row) => ({
    ...row,
    chips: splitStateChips(styleStateChips(row)),
    identity: styleIdentity({ id: row.elementId, className: row.className }),
    mediaDetail: mediaDetail(row.media)
  }));
}

/**
 * Whether two views with the same id show the same thing (the refresh reuse
 * test: chips and identity derive from these fields).
 *
 * @param a The previous view.
 * @param b The fresh view.
 */
export function sameStyleRow(a: StyleRowView, b: StyleRowView): boolean {
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
    a.critical === b.critical &&
    a.rocketAsync === b.rocketAsync &&
    a.hostedFont === b.hostedFont
  );
}

/** Seed heights (px): a link's chips + URL lines, an inline style's chips + preview lines. */
export const STYLE_ROW_ESTIMATE = { external: 52, inline: 50 } as const;

/**
 * A row's seed height (measurement refines it).
 *
 * @param row The view.
 */
export function estimateStyleRow(row: StyleRowView): number {
  return STYLE_ROW_ESTIMATE[row.type];
}

/**
 * What the snapshot-only critical row says in place of CSS. Neutral: WP
 * Rocket's on-load removal is the usual cause, not the only one.
 */
export const CRITICAL_SNAPSHOT_NOTE = 'No longer on the page';

/** Its hover text: where the row comes from and what usually removed it. */
export const CRITICAL_SNAPSHOT_TITLE =
  'Seen when the page finished parsing. WP Rocket usually removes it once the stylesheets have loaded; a page script or a RUCSS test can remove it too.';

/**
 * The muted line under the summary when the page has more styles than one
 * read lists.
 *
 * @param reply The inventory.
 * @returns The note, or `null` while every style is listed.
 */
export function listCutNote(reply: PageStylesheetsReply): string | null {
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
