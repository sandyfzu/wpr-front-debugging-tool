/**
 * The Detections summary: the page-level facts (plugin presence + version,
 * cache state + stamp, platform, server, active-optimization count) read
 * off the SAME status items the cards render — so the summary strip, the
 * cards and the support report can never disagree about one page.
 *
 * Pure: no clock (relative ages are the renderer's job), no DOM.
 */

import type { DetectionRow, StatusItem, StatusItemId, StatusKind } from './detections-view-model';

/** The status words every Detections surface prints (badges, report) — sentence case. */
export const STATUS_LABELS: Readonly<Record<StatusKind, string>> = {
  active: 'Active',
  'not-active': 'Not active'
};

/** The plugin's answer: absent, or present with its version (null = not exposed). */
export type WprSummary =
  { readonly present: false } | { readonly present: true; readonly version: string | null };

/**
 * The page-cache answer. `not-applicable` = the plugin is absent and no
 * cache card exists (caching is not its question there); `cached` carries
 * the stamp only when it names a real instant.
 */
export type CacheSummary =
  | { readonly kind: 'not-applicable' }
  | { readonly kind: 'not-cached' }
  | {
      readonly kind: 'cached';
      /** The stamp in epoch seconds, or null when the page carried no representable one. */
      readonly seconds: number | null;
      /** The stamp's absolute UTC form, or null alongside a null `seconds`. */
      readonly formatted: string | null;
    };

/** The facts one Detections view states once, above (and inside) everything else. */
export interface DetectionsSummary {
  readonly wpr: WprSummary;
  readonly cache: CacheSummary;
  /** The captured `server` value; null when headers were not captured or carried none. */
  readonly server: string | null;
  /** The known platform and the captured header that identified it, or null. */
  readonly platform: { readonly name: string; readonly header: string } | null;
  /** How many optimization cards are active, of how many. */
  readonly optimizations: { readonly active: number; readonly total: number };
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
 * Summarize one card list (the output of `buildStatusItems`).
 *
 * Every fact is read from a card, never from the raw payload, which is what
 * makes strip ↔ card consistency structural: a fact the cards do not state
 * cannot appear in the summary.
 *
 * @param items The status cards, in render order.
 * @returns The summary facts.
 */
export function summarizeDetections(items: readonly StatusItem[]): DetectionsSummary {
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
  if (cachedCard !== undefined) {
    const detail = cachedCard.detail?.kind === 'cached-at' ? cachedCard.detail : null;
    cache = {
      kind: 'cached',
      seconds: detail?.seconds ?? null,
      formatted: detail?.formatted ?? null
    };
  } else {
    cache = wpr.present ? { kind: 'not-cached' } : { kind: 'not-applicable' };
  }

  const serverDetail = byId.get('server')?.detail;
  const platformDetail = byId.get('known-platform')?.detail;

  let active = 0;
  let total = 0;
  for (const item of items) {
    if (!isOptimizationCard(item.id)) continue;
    total += 1;
    if (item.status === 'active') active += 1;
  }

  return {
    wpr,
    cache,
    server: serverDetail?.kind === 'server' ? serverDetail.value : null,
    platform:
      platformDetail?.kind === 'platform'
        ? { name: platformDetail.name, header: platformDetail.header }
        : null,
    optimizations: { active, total }
  };
}
