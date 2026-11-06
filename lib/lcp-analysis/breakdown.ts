/**
 * Largest Contentful Paint breakdown: the LCP time split into its four
 * consecutive parts — time to first byte, resource load delay, resource
 * load duration, element render delay — from plain timing values the
 * executor copies out of the navigation, resource and LCP entries.
 *
 * The parts form a max chain, so each boundary is at least the previous one
 * and every part is non-negative even when the browser hides a timing
 * (cross-origin `requestStart` reads 0 without `Timing-Allow-Origin`):
 *
 *   ttfb     = navigation.responseStart
 *   request  = max(ttfb, resource.requestStart || resource.startTime || 0)
 *   response = max(request, resource.responseEnd || 0)
 *   render   = max(response, lcp.startTime || 0)   // the total
 *
 * On a prerendered page every boundary is first moved to the activation
 * (`t − activationStart`, floored at 0), as the current-visit LCP is: the
 * visitor's wait starts when the page is shown, so the total of an analysis
 * and the visit's LCP agree (a page not prerendered activates at 0).
 */
import { domTiming } from '../../utils/dom-timing';

/** The navigation timing the breakdown reads. */
export interface NavigationTiming {
  readonly responseStart: number;
  /**
   * The prerender activation offset (ms; 0 when not prerendered): every
   * boundary is measured from it. Absent = unknown, read as 0.
   */
  readonly activationStart?: number;
}

/** The resource timing the breakdown reads (one entry of the LCP's URL). */
export interface ResourceTiming {
  readonly name: string;
  readonly startTime: number;
  readonly requestStart: number;
  readonly responseEnd: number;
}

/** The LCP entry fields the breakdown reads. */
export interface LcpTiming {
  /** Render time, else load time (what `startTime` reports). */
  readonly startTime: number;
  /** The image URL; `''` for a text element. */
  readonly url: string;
}

/** The four parts, in order. */
export const LCP_PARTS = [
  'timeToFirstByte',
  'resourceLoadDelay',
  'resourceLoadDuration',
  'elementRenderDelay'
] as const;

/** One part's key. */
export type LcpPartKey = (typeof LCP_PARTS)[number];

/** One part's measure. */
export interface LcpPart {
  readonly key: LcpPartKey;
  /** Milliseconds. */
  readonly duration: number;
  /** Share of the total, one decimal (`null` when the total is 0). */
  readonly percent: number | null;
}

/** What the LCP element loaded from. */
export type LcpResourceState =
  /** A text element: nothing to load, both resource parts are 0. */
  | 'text'
  /** An image whose resource entry was found. */
  | 'found'
  /** An image URL with no resource entry (data URL, cache, cleared buffer, …): resource parts are 0. */
  | 'missing';

/** A computed breakdown. */
export interface LcpBreakdown {
  readonly kind: 'breakdown';
  /** The render boundary, milliseconds — the sum of the parts. */
  readonly total: number;
  readonly parts: readonly LcpPart[];
  readonly resource: LcpResourceState;
}

/** Why no breakdown was computed. */
export type LcpBreakdownGap = { readonly kind: 'no-navigation' } | { readonly kind: 'no-lcp' };

/**
 * A part's share of the total, rounded to one decimal: the ratio is scaled
 * by 1000 before rounding, so 1/3 reads 33.3 (never a pre-rounded 33).
 *
 * @param duration The part, ms.
 * @param total The total, ms.
 * @returns The percentage, or null for a zero (or non-finite) total.
 */
export function partPercent(duration: number, total: number): number | null {
  if (!(total > 0) || !Number.isFinite(total)) return null;
  return Math.round((1000 * duration) / total) / 10;
}

/**
 * The first resource entry fetched for the URL (the order the browser
 * buffered them in). Text LCPs have no URL and match nothing.
 *
 * @param url The LCP's URL.
 * @param resources The page's resource entries.
 * @returns The entry, or null.
 */
export function findLcpResource(
  url: string,
  resources: readonly ResourceTiming[]
): ResourceTiming | null {
  if (url === '') return null;
  return resources.find((entry) => entry.name === url) ?? null;
}

/**
 * A timeline value measured from the page's activation (the prerender
 * activation offset; 0 when not prerendered), floored at 0 — a moment before
 * the page was shown counts as its first.
 *
 * @param time The performance-timeline time, ms (non-finite/negative read as 0).
 * @param activationStart The activation offset, ms (absent/invalid read as 0).
 * @returns The time since activation, ms.
 */
export function sinceActivation(time: number, activationStart: number | undefined): number {
  return Math.max(0, domTiming(time) - domTiming(activationStart));
}

/**
 * Compute the LCP breakdown, every boundary measured from the activation.
 *
 * @param navigation The navigation entry, or null where none exists.
 * @param lcp The last LCP entry, or null when none was reported.
 * @param resources The page's resource entries.
 * @returns The breakdown, or why it could not be computed.
 */
export function computeLcpBreakdown(
  navigation: NavigationTiming | null,
  lcp: LcpTiming | null,
  resources: readonly ResourceTiming[]
): LcpBreakdown | LcpBreakdownGap {
  if (navigation === null) return { kind: 'no-navigation' };
  if (lcp === null) return { kind: 'no-lcp' };
  const resource = findLcpResource(lcp.url, resources);
  /** A boundary measured from the activation. */
  const since = (time: number): number => sinceActivation(time, navigation.activationStart);
  const ttfb = since(navigation.responseStart);
  // A withheld `requestStart` reads 0: fall back to the entry's start before aligning.
  const request =
    resource === null
      ? ttfb
      : Math.max(ttfb, since(domTiming(resource.requestStart) || domTiming(resource.startTime)));
  const response = resource === null ? request : Math.max(request, since(resource.responseEnd));
  const render = Math.max(response, since(lcp.startTime));
  const durations: Record<LcpPartKey, number> = {
    timeToFirstByte: ttfb,
    resourceLoadDelay: request - ttfb,
    resourceLoadDuration: response - request,
    elementRenderDelay: render - response
  };
  return {
    kind: 'breakdown',
    total: render,
    parts: LCP_PARTS.map((key) => ({
      key,
      duration: durations[key],
      percent: partPercent(durations[key], render)
    })),
    resource: lcp.url === '' ? 'text' : resource === null ? 'missing' : 'found'
  };
}

/**
 * The LCP candidates in report order, one per distinct `startTime` (the
 * browser can report several entries for one paint; the last wins, in the
 * place of the first).
 *
 * @param entries The reported LCP entries, in order.
 * @returns The deduplicated candidates; the last is the LCP.
 */
export function dedupeCandidates<T extends { readonly startTime: number }>(
  entries: readonly T[]
): T[] {
  const byStart = new Map<number, T>();
  for (const entry of entries) byStart.set(entry.startTime, entry);
  return [...byStart.values()];
}
