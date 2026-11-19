/**
 * Pure presentation rules for the Preloaded Resources page (the page's
 * resource-hint inventory): which of its three honest states a report is
 * in, the row views (icon, name, kind + URL preview, attribution chip —
 * built once per row) and the content key a row keeps across refreshes, the
 * detail's facts, and the summary notes.
 */
import { DNS_PREFETCH_LIMIT } from '../../../../lib/detection/hud';
import { PAYLOAD_LIMITS } from '../../../../lib/messaging/payload-bounds';
import type { HintAttribution } from '../../../../lib/panel/hint-attribution';
import { liftFacets, type FacetSet } from '../../../../lib/panel/resource-facets';
import {
  PRELOADED_PAGE_FACETS,
  preloadedHintSearchField,
  RESOURCE_HINT_KIND_LABELS,
  reportHints,
  reportHintsTruncated,
  type PreloadedFacetId,
  type PreloadedResource
} from '../../../../lib/panel/resources-view-model';
import { RESOURCE_HINT_MARKS } from '../../../../lib/wp-rocket/constants';
import type {
  PreloadedResources,
  ResourceHintMark,
  WprDetections
} from '../../../../lib/wp-rocket/types';
import { formatCount } from '../../../../utils/format-count';
import type { DetailFact } from '../resource-list/detail-section';
import { listCapped, resourceName, urlPreview } from '../resource-list/resource-list-view';
import type { StatusKind } from '../../../../components/ui/status-badge';

/**
 * What the page can say about the report:
 * - `none` — the capture's hint list is empty: the page has no resource hint;
 * - `not-collected` — no hint list in the capture (one taken before the
 *   inventory existed) and no WP Rocket preload to show instead: an empty
 *   page cannot be claimed, the hints were simply never read;
 * - `rows` — at least one hint (or, on such an older capture, one WP Rocket
 *   preload).
 */
export type PreloadedInventory = 'none' | 'not-collected' | 'rows';

/**
 * Classify a report.
 *
 * @param report The payload's preloaded-resources report.
 * @returns The page state.
 */
export function preloadedInventory(report: PreloadedResources): PreloadedInventory {
  if (reportHints(report).length > 0) return 'rows';
  return report.hints === undefined ? 'not-collected' : 'none';
}

/** A row's kind chip: the `rel` token, and a preload's `as` type (`null` when it has none). */
export interface HintKindChip {
  readonly rel: string;
  readonly as: string | null;
}

/**
 * The kind chip's words. Only a preload's type is shown: it is what that
 * kind fetches; on the other kinds `as` means nothing to the browser.
 *
 * @param row The hint row.
 */
export function hintKindChip(row: PreloadedResource): HintKindChip {
  return { rel: row.rel, as: row.rel === 'preload' && row.as !== '' ? row.as : null };
}

/**
 * The summary badge's label: the page lists every hint, and the badge says
 * whether any of them is WP Rocket's.
 */
export const WP_ROCKET_HINTS_LABEL = 'WP Rocket hints';

/**
 * Whether any row is WP Rocket's (the summary badge's state).
 *
 * @param rows The page's rows.
 */
export function wpRocketHintsPresent(rows: readonly PreloadedResource[]): boolean {
  return rows.some((row) => row.attribution.by === 'wp-rocket');
}

/** What an image preload without a URL says: such hints carry only `imagesrcset`. */
export const SRCSET_ONLY_LABEL = 'No URL (srcset only)';

/** What any other hint without a URL says. */
export const NO_URL_LABEL = 'No URL';

/**
 * The missing-URL wording for a row.
 *
 * @param row The hint row.
 */
export function missingUrlLabel(row: PreloadedResource): string {
  return row.rel === 'preload' && row.as === 'image' ? SRCSET_ONLY_LABEL : NO_URL_LABEL;
}

/**
 * Whether two rows with the same id show the same thing (the refresh reuse
 * test).
 *
 * @param a The previous row.
 * @param b The fresh row.
 * @returns `true` when kind, type, URL and attribution match.
 */
export function samePreloadedRow(a: PreloadedResource, b: PreloadedResource): boolean {
  return (
    a.rel === b.rel &&
    a.as === b.as &&
    a.href === b.href &&
    sameAttribution(a.attribution, b.attribution)
  );
}

/**
 * Whether two attributions read the same.
 *
 * @param a One attribution.
 * @param b The other.
 */
function sameAttribution(a: HintAttribution, b: HintAttribution): boolean {
  if (a.by === 'page' || b.by === 'page') return a.by === b.by;
  return a.mark === b.mark && a.feature === b.feature;
}

/**
 * A stamp's attribute name, as the chip titles show it.
 *
 * @param mark The stamp.
 */
function stampAttribute(mark: ResourceHintMark): string {
  return RESOURCE_HINT_MARKS.find((entry) => entry.mark === mark)?.attribute ?? mark;
}

/**
 * A stamp as the tag carries it: the attribute, with its value when the
 * plugin writes one (`data-rocket-async="style"`).
 *
 * @param mark The stamp.
 */
export function stampMarkup(mark: ResourceHintMark): string {
  const entry = RESOURCE_HINT_MARKS.find((candidate) => candidate.mark === mark);
  if (entry === undefined) return mark;
  return entry.value === undefined ? entry.attribute : `${entry.attribute}="${entry.value}"`;
}

/**
 * Why a WP Rocket hint names no feature: a shared stamp the page does not
 * single out (Preconnect to External Domains' stamps always name theirs).
 */
const UNNAMED_WHY: Readonly<Partial<Record<ResourceHintMark, string>>> = {
  preload:
    'several WP Rocket features write it (critical images, fonts, Google Fonts), and this page does not prove which.',
  async: 'Load CSS asynchronously writes it, but that feature is not detected on this page.'
};

/**
 * A row's attribution chip — its whole meaning is who wrote the hint, so it
 * is a label in the status vocabulary, not a state chip with a source.
 */
export interface AttributionChip {
  /** Stable id (test hook). */
  readonly id: 'wp-rocket' | 'unattributed';
  /** The visible label. */
  readonly label: string;
  /** The vocabulary kind. */
  readonly kind: StatusKind;
  /** The proven feature, drawn after the label in parentheses, when one is proven. */
  readonly mark?: string;
  /** Hover text: the stamp and why. */
  readonly title: string;
}

/** The unattributed chip (shared: no allocation per plain row). */
const UNATTRIBUTED_CHIP: AttributionChip = {
  id: 'unattributed',
  label: 'Unattributed',
  kind: 'neutral',
  title:
    'No WP Rocket stamp, so its author is unproven: WordPress core, the theme, a plugin, or WP Rocket itself (its DNS prefetch, Google Fonts and CDN hints carry no stamp).'
};

/**
 * A row's attribution chip: "WP Rocket" (its proven feature as the mark; the
 * title names the stamp and why), or "Unattributed".
 *
 * @param attribution The row's attribution.
 */
export function attributionChip(attribution: HintAttribution): AttributionChip {
  if (attribution.by === 'page') return UNATTRIBUTED_CHIP;
  const attribute = stampAttribute(attribution.mark);
  return attribution.feature === null
    ? {
        id: 'wp-rocket',
        label: 'WP Rocket',
        kind: 'info',
        title: `${attribute}: ${UNNAMED_WHY[attribution.mark] ?? 'written by WP Rocket.'}`
      }
    : {
        id: 'wp-rocket',
        label: 'WP Rocket',
        kind: 'info',
        mark: attribution.feature,
        title: `${attribute}: written by ${attribution.feature}, detected on this page.`
      };
}

/**
 * The summary strip's caveats: a capped list (counts then cover the kept rows
 * only), a capture from before the hint inventory (WP Rocket's preloads
 * only), and — with DNS prefetch declared and plain DNS hints listed — that those
 * hints cannot be told apart from WordPress core's and the CDN's.
 *
 * @param report The payload's preloaded-resources report.
 * @param rows The page's rows.
 * @param detections The page's detection rows.
 * @returns The notes (often none).
 */
export function preloadedNotes(
  report: PreloadedResources,
  rows: readonly PreloadedResource[],
  detections: WprDetections
): string[] {
  const notes: string[] = [];
  const cap = PAYLOAD_LIMITS.preloaded.count;
  // A capture from before the hint inventory carries the preload list only.
  const preloadsOnly = report.hints === undefined;
  const capped = listCapped(reportHintsTruncated(report), reportHints(report).length, cap);
  if (capped) {
    notes.push(
      `The list was capped at the first ${formatCount(cap)} hints; counts cover these rows.`
    );
  }
  if (preloadsOnly && rows.length > 0) {
    notes.push(
      "This capture lists WP Rocket's preloads only. Reload the inspected page to list every resource hint."
    );
  }
  if (
    detections.dns_prefetch.present &&
    rows.some((row) => row.rel === 'dns-prefetch' && row.attribution.by === 'page')
  ) {
    notes.push(DNS_PREFETCH_LIMIT);
  }
  return notes;
}

/** The icon a hint row leads with: by what it fetches (a preload's `as`), or the origin it warms up. */
export type HintIconId = 'image' | 'font' | 'style' | 'script' | 'origin' | 'file';

/** A preload's `as` type → its icon (any other type reads as a plain file). */
const PRELOAD_AS_ICONS: Readonly<Record<string, HintIconId>> = {
  image: 'image',
  font: 'font',
  style: 'style',
  script: 'script'
};

/**
 * A row's icon: preconnects and DNS prefetches warm up an origin; a module
 * preload fetches a script; a preload by its `as` type.
 *
 * @param row The hint row.
 */
export function hintIcon(row: PreloadedResource): HintIconId {
  if (row.rel === 'preconnect' || row.rel === 'dns-prefetch') return 'origin';
  if (row.rel === 'modulepreload') return 'script';
  return PRELOAD_AS_ICONS[row.as] ?? 'file';
}

/** One rendered row: the hint plus what its renderer reads, built once. */
export interface PreloadedRowView {
  /** The hint (its `id` is its capture position at build time only). */
  readonly row: PreloadedResource;
  /** The content key: the same hint keeps it across refreshes (see {@link preloadedRowKeys}). */
  readonly key: string;
  /** The row's name: the URL's file name (or host), else the missing-URL words. */
  readonly name: string;
  /** The kind (`rel`, a preload's `as`) then the URL without its scheme. */
  readonly preview: string;
  /** The capture cut the URL at its length cap. */
  readonly clipped: boolean;
  /** The leading icon. */
  readonly icon: HintIconId;
  /** Who wrote the hint. */
  readonly attribution: AttributionChip;
}

/** Separates a key's fields (never part of a captured `rel`, `as` or URL). */
const KEY_FIELD = '\u0001';

/**
 * The content key of every row: kind, type and URL plus the occurrence
 * among identical hints (a page may print one twice) — never the position,
 * so a hint added above shifts nothing.
 *
 * @param rows The hint rows, in list order.
 * @returns One unique key per row, same order.
 */
export function preloadedRowKeys(rows: readonly PreloadedResource[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = [row.rel, row.as, row.href].join(KEY_FIELD);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return `${base}${KEY_FIELD}${String(occurrence)}`;
  });
}

/**
 * A row's preview line: the kind chip's words, then the URL without its
 * scheme ("preload · image · cdn.test/hero.webp").
 *
 * @param row The hint row.
 */
export function hintPreview(row: PreloadedResource): string {
  const kind = hintKindChip(row);
  const parts = [kind.rel];
  if (kind.as !== null) parts.push(kind.as);
  if (row.href !== '') parts.push(urlPreview(row.href));
  return parts.join(' · ');
}

/**
 * Build the row views (keys, names, previews and chips once per row).
 *
 * @param rows The hint rows, in list order.
 * @param clipped Whether the capture cut a given URL at its length cap.
 * @returns One view per row, same order.
 */
export function preloadedRowViews(
  rows: readonly PreloadedResource[],
  clipped: (href: string) => boolean
): PreloadedRowView[] {
  const keys = preloadedRowKeys(rows);
  return rows.map((row, index) => ({
    row,
    key: keys[index] ?? '',
    name: resourceName(row.href) || missingUrlLabel(row),
    preview: hintPreview(row),
    clipped: clipped(row.href),
    icon: hintIcon(row),
    attribution: attributionChip(row.attribution)
  }));
}

/**
 * Whether two views of one key show the same thing (the attribution and the
 * clip mark can change under one key; everything else derives from it).
 *
 * @param a The previous view.
 * @param b The fresh view.
 */
export function samePreloadedView(a: PreloadedRowView, b: PreloadedRowView): boolean {
  return samePreloadedRow(a.row, b.row) && a.clipped === b.clipped;
}

/** The page's facets over row views (the row facets, lifted). */
export const PRELOADED_VIEW_FACETS: FacetSet<PreloadedRowView, PreloadedFacetId> = liftFacets(
  PRELOADED_PAGE_FACETS,
  (view: PreloadedRowView) => view.row
);

/**
 * A view's searched field: the hinted URL.
 *
 * @param view The row view.
 */
export function preloadedSearchField(view: PreloadedRowView): string {
  return preloadedHintSearchField(view.row);
}

/**
 * The detail's caps kind label: the hint kind's own words.
 *
 * @param view The row view.
 */
export function hintKind(view: PreloadedRowView): string {
  return RESOURCE_HINT_KIND_LABELS[view.row.rel];
}

/**
 * Whether the hint's URL is a file DevTools' Sources panel can list (a
 * preload or module preload fetches it); a preconnect or DNS prefetch names
 * an origin it only warms up, so its tile opens a new tab instead.
 *
 * @param row The hint row.
 */
export function hintFetchesFile(row: PreloadedResource): boolean {
  return row.rel === 'preload' || row.rel === 'modulepreload';
}

/** What a hint without a URL says in its detail: an image preload carries only `imagesrcset`. */
export const SRCSET_ONLY_NOTE =
  'This image preload carries only imagesrcset: there is no single URL to open.';

/** What any other hint without a URL says in its detail. */
export const NO_URL_NOTE = 'This hint carries no URL.';

/**
 * The detail's missing-URL sentence.
 *
 * @param row The hint row (its `href` is empty).
 */
export function missingUrlNote(row: PreloadedResource): string {
  return missingUrlLabel(row) === SRCSET_ONLY_LABEL ? SRCSET_ONLY_NOTE : NO_URL_NOTE;
}

/**
 * The facts the capture records for a hint — only those that hold.
 *
 * @param row The hint row.
 * @returns The facts, in reading order.
 */
export function hintFacts(row: PreloadedResource): DetailFact[] {
  const facts: DetailFact[] = [{ label: 'Rel', value: row.rel, mono: true }];
  if (row.as !== '') facts.push({ label: 'As', value: row.as, mono: true });
  if (row.attribution.by === 'wp-rocket') {
    facts.push({ label: 'WP Rocket stamp', value: stampMarkup(row.attribution.mark), mono: true });
    if (row.attribution.feature !== null)
      facts.push({ label: 'Feature', value: row.attribution.feature, mono: false });
  }
  return facts;
}
