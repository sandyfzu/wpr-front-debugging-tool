/**
 * The Detections overview tiles' view model (pure): one loaded payload and
 * its summary → what each tile states. The plugin, cache and server
 * answers come from the top bar's own selectors, so a tile can never
 * contradict the bar above it; counts, the cache stamp, the hosting layer,
 * the WordPress version and the platform come from the summary the cards
 * and the support report read.
 */
import type { CacheCopy } from '../../../../lib/detection/cache-context';
import type { DetectionsSummary } from '../../../../lib/panel/detections-summary';
import { wprEvidence, wprEvidenceSentence } from '../../../../lib/panel/wpr-evidence';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import type { RouteId } from '../../routes';
import {
  cacheAnswerTone,
  cacheSegment,
  platformSegment,
  wprSegment,
  type CacheAnswerTone,
  type PlatformSegmentView
} from '../../top-bar/selectors';

/** The page that holds the cache answer's evidence (the captured headers). */
export const CACHE_EVIDENCE_ROUTE: RouteId = 'headers-cookies';

/** The plugin tile: version + the footprints that prove it, or the neutral absence. */
export type WprTileView =
  | {
      readonly kind: 'detected';
      /** The declared version; null when the page exposes none. */
      readonly version: string | null;
      /** "Detected by …" — never null for a detected plugin. */
      readonly evidence: string;
    }
  | { readonly kind: 'not-detected' };

/** A cached page's generation stamp, when it names a real instant. */
export interface CacheStamp {
  /** Epoch seconds (for `<time datetime>`). */
  readonly seconds: number;
  /** The absolute UTC form. */
  readonly formatted: string;
}

/** The page-cache tile. */
export type CacheTileView =
  /** WP Rocket is absent: its cache is not the question here. */
  | { readonly kind: 'not-applicable' }
  | {
      readonly kind: 'answered';
      /** The bar's tone for the same state. */
      readonly tone: CacheAnswerTone;
      /** The shared copy (chip = the value, tooltip = the why). */
      readonly copy: CacheCopy;
      /**
       * True for every state but cached: its value carries the tooltip (a
       * cached page's proof is its stamp, stated as text).
       */
      readonly explained: boolean;
      /** The generation stamp (cached pages with a usable one only). */
      readonly stamp: CacheStamp | null;
      /** The hosting cache layer worth naming beside the state, or null. */
      readonly layer: string | null;
    };

/** The stack tile: WordPress, the server answer and the identified platform. */
export interface StackTileView {
  /** The WordPress version the page declared; null when undeclared. */
  readonly wordpressVersion: string | null;
  /** The bar's server/`x-powered-by` answer (never `loading`: data is loaded). */
  readonly server: Exclude<PlatformSegmentView, { readonly kind: 'loading' }>;
  /** The known platform and the header that identified it, or null. */
  readonly platform: DetectionsSummary['platform'];
}

/** Every tile's view, resolved together. */
export interface OverviewView {
  /** The optimization counts (the summary's, unchanged). */
  readonly score: DetectionsSummary['optimizations'];
  readonly wpr: WprTileView;
  readonly cache: CacheTileView;
  readonly stack: StackTileView;
}

/**
 * The broken-invariant error a loaded payload's selector answer raises when
 * it reports "no data yet" (only a caller passing no data can get that).
 *
 * @param tile The tile whose answer was impossible.
 * @param kind The answer's kind.
 */
function impossibleAnswer(tile: string, kind: string): Error {
  return new Error(`Overview ${tile} tile: a loaded payload answered "${kind}".`);
}

/**
 * The plugin tile from the bar's presence answer and the payload's footprints.
 *
 * @param data The loaded payload.
 * @throws {@link Error} When the selector answers a no-data state.
 */
export function wprTile(data: FdtData): WprTileView {
  const view = wprSegment(data);
  switch (view.kind) {
    case 'detected':
      return {
        kind: 'detected',
        version: view.version,
        // A detected plugin always has a footprint, inferred at worst.
        evidence: wprEvidenceSentence(wprEvidence(data)) ?? ''
      };
    case 'not-detected':
      return { kind: 'not-detected' };
    case 'loading':
    case 'unavailable':
      throw impossibleAnswer('WP Rocket', view.kind);
  }
}

/**
 * The page-cache tile from the bar's cache answer plus the summary's stamp
 * and hosting layer.
 *
 * @param data The loaded payload.
 * @param summary The payload's summary.
 * @param nowMs The page clock (the bar's answer reads it for its age).
 * @throws {@link Error} When the selector answers a no-data state.
 */
export function cacheTile(data: FdtData, summary: DetectionsSummary, nowMs: number): CacheTileView {
  const view = cacheSegment(data, nowMs);
  if (view.kind === 'loading' || view.kind === 'unavailable') {
    throw impossibleAnswer('page cache', view.kind);
  }
  const tone = cacheAnswerTone(view);
  if (view.kind === 'not-applicable' || tone === null) return { kind: 'not-applicable' };
  const cache = summary.cache;
  const stamp =
    cache.kind === 'cached' && cache.seconds !== null && cache.formatted !== null
      ? { seconds: cache.seconds, formatted: cache.formatted }
      : null;
  return {
    kind: 'answered',
    tone,
    copy: view.copy,
    explained: view.kind !== 'cached',
    stamp,
    layer: summary.cacheLayer
  };
}

/**
 * The stack tile from the summary's page facts and the bar's server answer.
 *
 * @param data The loaded payload.
 * @param summary The payload's summary.
 * @throws {@link Error} When the selector answers a no-data state.
 */
export function stackTile(data: FdtData, summary: DetectionsSummary): StackTileView {
  const server = platformSegment(data);
  if (server.kind === 'loading') throw impossibleAnswer('stack', server.kind);
  return { wordpressVersion: summary.wordpressVersion, server, platform: summary.platform };
}

/**
 * Resolve every tile.
 *
 * @param data The loaded payload.
 * @param summary Its summary (`summarizeFdtData(data).summary`).
 * @param nowMs The page clock (ms).
 * @returns The tiles' views.
 * @throws {@link Error} When a selector answers a no-data state for loaded data.
 */
export function overviewView(
  data: FdtData,
  summary: DetectionsSummary,
  nowMs: number
): OverviewView {
  return {
    score: summary.optimizations,
    wpr: wprTile(data),
    cache: cacheTile(data, summary, nowMs),
    stack: stackTile(data, summary)
  };
}
