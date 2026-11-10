/**
 * Pure presentation rules for the Preloaded Resources page (the page's
 * resource-hint inventory): which of its three honest states a report is
 * in, a row's kind chip and attribution chip, row identity across refreshes,
 * the summary notes and the row's seed height.
 */
import { DNS_PREFETCH_LIMIT } from '../../../../lib/detection/hud';
import { PAYLOAD_LIMITS } from '../../../../lib/messaging/payload-bounds';
import type { HintAttribution } from '../../../../lib/panel/hint-attribution';
import {
  reportHints,
  reportHintsTruncated,
  type PreloadedResource
} from '../../../../lib/panel/resources-view-model';
import { RESOURCE_HINT_MARKS } from '../../../../lib/wp-rocket/constants';
import type {
  PreloadedResources,
  ResourceHintMark,
  WprDetections
} from '../../../../lib/wp-rocket/types';
import { formatCount } from '../../../../utils/format-count';
import { listCapped } from '../resource-list/resource-list-view';
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

/** Seed height of a hint row (name line + URL line), in px. */
export const PRELOADED_ROW_ESTIMATE = 55;

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
