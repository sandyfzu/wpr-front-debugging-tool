/**
 * The Detections summary: the page-level facts (plugin presence + version,
 * cache state + stamp, platform, server, active-optimization count) read
 * off the SAME status items the cards render — so the summary strip, the
 * cards and the support report can never disagree about one page.
 *
 * Pure: no clock (relative ages are the renderer's job), no DOM.
 */

import type { DetectionRow, StatusItem, StatusItemId, StatusKind } from './detections-view-model';
import { buildStatusItems } from './detections-view-model';
import type { CacheState } from '../detection/cache-context';
import { cacheLayerHint, cacheStateFromFdtData } from '../detection/cache-context';
import { formatCacheTimestamp, isRepresentableCacheStamp } from '../detection/cache-time';
import { builderTurnsOff } from '../detection/hud';
import type { FdtData } from '../wp-rocket/types';

/** The status words every Detections surface prints (badges, report) — sentence case. */
export const STATUS_LABELS: Readonly<Record<StatusKind, string>> = {
  active: 'Active',
  collecting: 'Collecting',
  unknown: 'Unknown',
  'not-active': 'Not active'
};

/** The plugin's answer: absent, or present with its version (null = not exposed). */
export type WprSummary =
  { readonly present: false } | { readonly present: true; readonly version: string | null };

/**
 * The page-cache answer: the explicit cache vocabulary (`cached` carries the
 * stamp only when it names a real instant), plus `not-applicable` — the
 * plugin is absent and caching is not its question there.
 */
export type CacheSummary = { readonly kind: 'not-applicable' } | CacheState;

/** Page facts the summary states beside the cards (not detection rows). */
export interface SummaryFacts {
  /** The WordPress core version the page declared, or null/absent when undeclared. */
  readonly wordpressVersion?: string | null;
  /** The hosting cache layer whose captured marker served the response, or null/absent. */
  readonly cacheLayer?: string | null;
}

/** The facts one Detections view states once, above (and inside) everything else. */
export interface DetectionsSummary {
  readonly wpr: WprSummary;
  readonly cache: CacheSummary;
  /** The captured `server` value; null when headers were not captured or carried none. */
  readonly server: string | null;
  /** The known platform and the captured header that identified it, or null. */
  readonly platform: { readonly name: string; readonly header: string } | null;
  /** How many optimization cards are active in this tab ({@link isActiveInTab}), of how many. */
  readonly optimizations: { readonly active: number; readonly total: number };
  /** The WordPress core version the page declared; null when undeclared. */
  readonly wordpressVersion: string | null;
  /**
   * The hosting cache layer (e.g. Cloudflare) whose captured marker says it
   * served this response, when the page-cache state does not already settle
   * or name it (`cacheLayerHint`); null otherwise.
   */
  readonly cacheLayer: string | null;
}

/** The cards derived from headers or the cache stamp — facts about serving, not detection rows. */
const DERIVED_CARD_IDS: ReadonlySet<StatusItemId> = new Set(['server', 'known-platform', 'cached']);

/**
 * Detection rows that are not optimizations a site owner turns on: the
 * plugin's own presence row and the Priority Elements measurement beacon
 * (it collects data for the optimizations; counting it would inflate
 * "N of M active" with a signal, not a feature).
 */
const NON_OPTIMIZATION_ROWS: ReadonlySet<DetectionRow> = new Set([
  'wpr',
  'priority_elements_beacon'
]);

/**
 * Whether a card counts toward "N of M optimizations active".
 *
 * @param id The card's id.
 * @returns True for every detection-row card except the non-optimization rows.
 */
export function isOptimizationCard(id: StatusItemId): boolean {
  if (DERIVED_CARD_IDS.has(id)) return false;
  return !NON_OPTIMIZATION_ROWS.has(id as DetectionRow);
}

/**
 * Whether an optimization card counts as active in this tab: WP Rocket
 * served it (`active`) and the Exclusion Builder did not turn it off here
 * (`off` feature-wide or page-off). Excluded rows leave it active — the
 * feature still runs on the rest of the page. The card itself keeps the
 * served verdict; this is the counting rule the summary (and any status
 * filter) shares.
 *
 * @param item The card.
 */
export function isActiveInTab(item: StatusItem): boolean {
  return item.status === 'active' && !builderTurnsOff(item.builder);
}

/**
 * Summarize one card list (the output of `buildStatusItems`).
 *
 * Every fact is read from a card, never from the raw payload, which is what
 * makes strip ↔ card consistency structural: a fact the cards do not state
 * cannot appear in the summary.
 *
 * @param items The status cards, in render order.
 * @param cacheState The explicit cache answer when the caller has the
 *   headers/bypass capture; omitted, the cards' `cached` card is the only
 *   available fact and absence degrades to "cache not detected" — never a
 *   cache verdict born from absence.
 * @param facts The non-card page facts (WordPress version, host cache layer).
 * @returns The summary facts.
 */
export function summarizeDetections(
  items: readonly StatusItem[],
  cacheState?: CacheState,
  facts: SummaryFacts = {}
): DetectionsSummary {
  const byId = new Map(items.map((item) => [item.id, item]));

  const wprCard = byId.get('wpr');
  const wpr: WprSummary =
    wprCard?.status === 'active'
      ? {
          present: true,
          version: wprCard.detail?.kind === 'version' ? wprCard.detail.version : null
        }
      : { present: false };

  const cachedCard = byId.get('cached');
  let cache: CacheSummary;
  if (cacheState !== undefined) {
    cache = summaryCache(cacheState);
  } else if (cachedCard !== undefined) {
    const detail = cachedCard.detail?.kind === 'cached-at' ? cachedCard.detail : null;
    cache = {
      kind: 'cached',
      seconds: detail?.seconds ?? null,
      formatted: detail?.formatted ?? null
    };
  } else {
    // No explicit answer and no cached card: absence is never "not cached".
    cache = wpr.present
      ? { kind: 'not-detected', headers: 'unavailable' }
      : { kind: 'not-applicable' };
  }

  const serverDetail = byId.get('server')?.detail;
  const platformDetail = byId.get('known-platform')?.detail;

  let active = 0;
  let total = 0;
  for (const item of items) {
    if (!isOptimizationCard(item.id)) continue;
    total += 1;
    if (isActiveInTab(item)) active += 1;
  }

  return {
    wpr,
    cache,
    server: serverDetail?.kind === 'server' ? serverDetail.value : null,
    platform:
      platformDetail?.kind === 'platform'
        ? { name: platformDetail.name, header: platformDetail.header }
        : null,
    optimizations: { active, total },
    wordpressVersion: facts.wordpressVersion ?? null,
    // A host layer is a cache question only on a page WP Rocket handled.
    cacheLayer: wpr.present ? (facts.cacheLayer ?? null) : null
  };
}

/**
 * The cards and the summary for one loaded payload — the single wiring both
 * the Detections page and the support report read, so the two cannot feed
 * the summary different facts.
 *
 * @param data The loaded page data.
 * @returns The status cards and their summary.
 */
export function summarizeFdtData(data: FdtData): {
  readonly items: StatusItem[];
  readonly summary: DetectionsSummary;
} {
  const items = buildStatusItems(data);
  const cacheState = cacheStateFromFdtData(data);
  return {
    items,
    summary: summarizeDetections(items, cacheState ?? undefined, {
      wordpressVersion: data.wordpressVersion ?? null,
      cacheLayer: cacheState === null ? null : cacheLayerHint(cacheState, data.pageHeaders)
    })
  };
}

/**
 * Map the explicit cache state onto the summary's narrow variant. The stamp
 * is normalized here again so a hand-built state cannot violate the summary
 * contract (null `seconds` and null `formatted` travel together).
 *
 * @param state The explicit state.
 * @returns The summary cache fact.
 */
function summaryCache(state: CacheState): CacheSummary {
  switch (state.kind) {
    case 'cached': {
      const seconds = isRepresentableCacheStamp(state.seconds) ? state.seconds : null;
      return {
        kind: 'cached',
        seconds,
        formatted: formatCacheTimestamp(seconds)
      };
    }
    case 'uncertain-signature':
      return { kind: 'uncertain-signature' };
    case 'possibly-cached':
      return {
        kind: 'possibly-cached',
        evidence: state.evidence,
        ...(state.bypassAttested === true ? { bypassAttested: true as const } : {})
      };
    case 'not-detected':
      return { kind: 'not-detected', headers: state.headers };
    case 'bypass-requested':
      return { kind: 'bypass-requested' };
  }
}
