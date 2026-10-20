/**
 * The status bar's pure selectors: the panel's data state → the four
 * segments' view models. Everything the strip renders or claims is decided
 * here — the component is placement and wiring only — and the freshness
 * semantics (the staleness threshold and the marker's states) are owned by
 * these selectors alone, so no second surface can fork that definition: a
 * future consumer (e.g. a nav row's data dot) reads the same named exports.
 *
 * Honesty rules the wording: a segment that has not received data renders
 * its loading placeholder; data that says a thing is absent renders the
 * absent state; a question the current data cannot answer (caching when the
 * plugin is not even present, a platform when no headers were captured)
 * renders honest silence instead of an invented answer.
 */
import { absoluteStampFromMs, isRepresentableCacheStamp } from '../../../lib/detection/describe';
import { cacheCopy, cacheStateFromFdtData } from '../../../lib/detection/cache-context';
import type { CacheCopy } from '../../../lib/detection/cache-context';
import type { FdtData, PageHeader } from '../../../lib/wp-rocket/types';
import type { DataState } from '../state/fdt-state-machine';
import { relativeAge } from '../../../utils/relative-age';

/**
 * Data older than this is flagged stale (ms) — ten minutes, the
 * owner-calibrated drift window.
 *
 * A debugging tool's data describes a live page: every inspected-page
 * navigation refetches the data, so it only ages while the user dwells
 * without navigating — exactly when the page may be changing underneath
 * (route changes inside single-page apps notify nothing). The captured
 * answers (plugin presence, cache state, headers) keep their diagnostic
 * value through such a dwell, so this is a generous drift warning, not a
 * freshness stopwatch: past it the marker asks for re-verification
 * instead of silent trust.
 */
export const DATA_STALE_AFTER_MS = 600_000;

/**
 * {@link DATA_STALE_AFTER_MS} as a whole number of minutes — the figure the
 * stale marker's remedy spells out ("older than 10 min") at both its render
 * sites (the hover title and the sr-only fact line). Derived beside its only
 * input so the prose and the threshold read from one declaration; the
 * whole-minute invariant that keeps this a clean mass instead of float
 * garbage in the prose is pinned in the selectors' threshold test — a
 * recalibration off a whole minute fails the suite rather than rendering it.
 */
export const STALE_WINDOW_MINUTES = DATA_STALE_AFTER_MS / 60_000;

/** One status-bar segment's identity — the strip's four fixed answers. */
export type SegmentId = 'wpr' | 'cache' | 'platform' | 'freshness';

/** The plugin presence/version answer's states. */
export type WprSegmentView =
  /** No data yet (boot or a fetch in flight) — render the placeholder. */
  | { readonly kind: 'loading' }
  /** No usable data is coming (the data request errored; the error view explains). */
  | { readonly kind: 'unavailable' }
  /** The plugin is detected; the version when the page declares one. */
  | { readonly kind: 'detected'; readonly version: string | null }
  /** Real data says the plugin is absent (neutral, like the toolbar badge). */
  | { readonly kind: 'not-detected' };

/** The cached-or-not answer's states. */
export type CacheSegmentView =
  | { readonly kind: 'loading' }
  /** No usable data is coming (see the plugin segment's unavailable state). */
  | { readonly kind: 'unavailable' }
  /**
   * The plugin is absent: caching is not its question here — render honest
   * silence, never a "Not cached" verdict about a plugin that isn't there.
   */
  | { readonly kind: 'not-applicable' }
  /** Cached. `age` when the cache stamp exists (null = cached, unstamped). */
  | {
      readonly kind: 'cached';
      readonly age: string | null;
      readonly copy: CacheCopy;
    }
  /** Signature present, no debug stamp: the plugin handled it, cache unproven. */
  | { readonly kind: 'uncertain-signature'; readonly copy: CacheCopy }
  /** No signature, but a verified hosting cache-layer marker was captured. */
  | { readonly kind: 'possibly-cached'; readonly copy: CacheCopy }
  /** No signature and no known host marker (headers may be unavailable). */
  | { readonly kind: 'not-detected'; readonly copy: CacheCopy }
  /** Counter-evidence: the captured URL attests a WP Rocket cache bypass. */
  | { readonly kind: 'not-cached'; readonly copy: CacheCopy };

/** The platform/server answer's states. */
export type PlatformSegmentView =
  | { readonly kind: 'loading' }
  /** No headers were captured for this tab — nothing was looked at. */
  | { readonly kind: 'unavailable' }
  /** Headers were captured, but neither platform header was among them. */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'captured'; readonly value: string };

/** The data-freshness answer's states (the strip's own segment). */
export type FreshnessSegmentView =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unavailable' }
  /** A refresh flight is in the air — the carried data is about to swap. */
  | { readonly kind: 'refreshing' }
  | {
      readonly kind: 'current';
      readonly age: string;
      readonly capturedAt: string | null;
    }
  | {
      readonly kind: 'stale';
      readonly age: string;
      readonly capturedAt: string | null;
    };

/** The four segments' views, resolved together from one data state. */
export interface StatusBarSegments {
  readonly wpr: WprSegmentView;
  readonly cache: CacheSegmentView;
  readonly platform: PlatformSegmentView;
  readonly freshness: FreshnessSegmentView;
}

/** The header names the platform answer reads, lowercased per HTTP/2 capture. */
const SERVER_HEADER = 'server';
const POWERED_BY_HEADER = 'x-powered-by';

/** The separator between two captured platform values. */
const PLATFORM_SEPARATOR = ' · ';

/**
 * A header row's renderable value: present and non-empty after trimming.
 * Rows can arrive name-only (or with an empty value) when the header carried
 * no value — that is the same as the header not being sent.
 *
 * @param row The captured header row.
 * @returns The trimmed value, or null when the row says nothing.
 */
function headerValue(row: PageHeader): string | null {
  const value = row.value?.trim() ?? '';
  return value === '' ? null : value;
}

/**
 * Resolve the plugin's presence/version answer from loaded data.
 *
 * @param data The loaded page data, or null when nothing has arrived yet.
 */
export function wprSegment(data: FdtData | null): WprSegmentView {
  if (data === null) return { kind: 'loading' };
  const { present, version } = data.wprDetections.wpr;
  return present ? { kind: 'detected', version } : { kind: 'not-detected' };
}

/**
 * Resolve the cached-or-not answer (with the stamp's relative age) from
 * loaded data. The age derives from the cache stamp's epoch seconds; a page
 * cached without the debug suffix — or with one whose digits no platform
 * date can represent (`isRepresentableCacheStamp`, the concept's one home) —
 * renders "Cached" and no invented age. An age is only ever rendered for a
 * cached page — a stamp on a non-cached payload (possible at the type level,
 * produced by nothing real) says nothing about the current visit's cache
 * state.
 *
 * @param data The loaded page data, or null when nothing has arrived yet.
 * @param nowMs The reading's wall clock (milliseconds).
 */
export function cacheSegment(data: FdtData | null, nowMs: number): CacheSegmentView {
  if (data === null) return { kind: 'loading' };
  const state = cacheStateFromFdtData(data);
  if (state === null) return { kind: 'not-applicable' };
  const copy = cacheCopy(state);
  switch (state.kind) {
    case 'cached':
      if (!isRepresentableCacheStamp(state.seconds)) {
        return { kind: 'cached', age: null, copy };
      }
      return {
        kind: 'cached',
        age: relativeAge(nowMs - state.seconds * 1000),
        copy
      };
    case 'uncertain-signature':
      return { kind: 'uncertain-signature', copy };
    case 'possibly-cached':
      return { kind: 'possibly-cached', copy };
    case 'not-detected':
      return { kind: 'not-detected', copy };
    case 'not-cached':
      return { kind: 'not-cached', copy };
  }
}

/**
 * Resolve the platform/server answer from the captured response headers,
 * case-insensitively (HTTP/2 sends lowercase names): the `server` header's
 * value first, then `x-powered-by`, joined when both exist. First occurrence
 * wins per header (multi-hop duplicates carry the same platform). The two
 * silences are honest and distinct: no captured headers = "unavailable"
 * (nothing was looked at); captured headers without either value = "unknown"
 * (looked, found nothing).
 *
 * @param data The loaded page data, or null when nothing has arrived yet.
 */
export function platformSegment(data: FdtData | null): PlatformSegmentView {
  if (data === null) return { kind: 'loading' };
  const headers = data.pageHeaders;
  if (headers === null) return { kind: 'unavailable' };
  let server: string | null = null;
  let poweredBy: string | null = null;
  for (const row of headers) {
    const name = row.name.toLowerCase();
    if (server === null && name === SERVER_HEADER) server = headerValue(row);
    else if (poweredBy === null && name === POWERED_BY_HEADER) poweredBy = headerValue(row);
  }
  const parts = [server, poweredBy].filter((value): value is string => value !== null);
  if (parts.length === 0) return { kind: 'unknown' };
  return { kind: 'captured', value: parts.join(PLATFORM_SEPARATOR) };
}

/**
 * Resolve the data-freshness answer from the machine's state — the single
 * freshness authority: a future consumer that needs the same decision (a
 * nav dot) reads this, never a second threshold.
 *
 * The staleness read compares `fetchedAt` to the reading's clock; a soft
 * refresh in flight renders its own state (the carried data is about to
 * swap, so its age is not the headline).
 *
 * @param state The panel's current data state.
 * @param nowMs The reading's wall clock (milliseconds).
 */
export function freshnessSegment(state: DataState, nowMs: number): FreshnessSegmentView {
  switch (state.status) {
    case 'ready': {
      const age = relativeAge(nowMs - state.fetchedAt);
      const capturedAt = absoluteStampFromMs(state.fetchedAt);
      return isDataStale(state.fetchedAt, nowMs)
        ? { kind: 'stale', age, capturedAt }
        : { kind: 'current', age, capturedAt };
    }
    case 'refreshing':
      return { kind: 'refreshing' };
    case 'idle':
    case 'fetching':
      return { kind: 'loading' };
    case 'error':
      return { kind: 'unavailable' };
  }
}

/**
 * The staleness decision behind the marker: loaded data crosses the
 * threshold.
 *
 * @param fetchedAtMs When the data was loaded/settled (wall-clock ms).
 * @param nowMs The reading's wall clock (ms).
 */
export function isDataStale(fetchedAtMs: number, nowMs: number): boolean {
  return nowMs - fetchedAtMs >= DATA_STALE_AFTER_MS;
}

/** The never-available rowset for an errored data state (the error view explains the cause above the strip). */
const UNAVAILABLE_SEGMENTS: StatusBarSegments = {
  wpr: { kind: 'unavailable' },
  cache: { kind: 'unavailable' },
  platform: { kind: 'unavailable' },
  freshness: { kind: 'unavailable' }
};

/**
 * Resolve all four segments from the data state — the strip's one entry
 * point. An errored state renders every segment's unavailable placeholder
 * (the error view carries the cause); the loaded states resolve each
 * segment from the carried data, with the freshness answering from the
 * machine's own stamps.
 *
 * @param state The panel's current data state.
 * @param nowMs The reading's wall clock (milliseconds).
 */
export function statusBarSegments(state: DataState, nowMs: number): StatusBarSegments {
  if (state.status === 'error') return UNAVAILABLE_SEGMENTS;
  const data = state.status === 'ready' || state.status === 'refreshing' ? state.data : null;
  return {
    wpr: wprSegment(data),
    cache: cacheSegment(data, nowMs),
    platform: platformSegment(data),
    freshness: freshnessSegment(state, nowMs)
  };
}
