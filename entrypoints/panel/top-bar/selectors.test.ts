/**
 * The top-bar selectors against contract-genuine data: each segment's
 * every state (boot → loading, absent → honest non-answer), the platform
 * precedence over the real captured-header shapes, the staleness threshold
 * and its exact flip, and the composed entry point's state mapping.
 */
import { describe, expect, it } from 'vitest';
import { makeFdtData } from '../state/fixtures';
import type { FdtData, WprDetections } from '../../../lib/wp-rocket/types';
import type { DataState } from '../state/fdt-state-machine';
import { formatCacheTimestamp } from '../../../lib/detection/describe';
import {
  DATA_STALE_AFTER_MS,
  STALE_WINDOW_MINUTES,
  cacheSegment,
  freshnessSegment,
  isDataStale,
  platformSegment,
  topBarSegments,
  wprSegment
} from './selectors';

/** The wall clock the tests read at (ms). */
const NOW_MS = 1_727_000_000_000;

/** Loaded data whose `wpr` row is replaced wholesale (the fixtures keep the rest empty). */
function withWpr(wpr: Partial<WprDetections['wpr']>, extra: Partial<FdtData> = {}): FdtData {
  return makeFdtData({
    wprDetections: {
      ...makeFdtData().wprDetections,
      wpr: {
        present: false,
        cacheMarkerFound: false,
        cached: false,
        version: null,
        timeStamp: null,
        ...wpr
      }
    },
    ...extra
  });
}

/** Loaded data whose captured headers are replaced (optionally with a wpr row). */
function withHeaders(
  pageHeaders: FdtData['pageHeaders'],
  wpr: Partial<WprDetections['wpr']> = {}
): FdtData {
  return withWpr(wpr, { pageHeaders });
}

describe('wprSegment', () => {
  it('renders the loading placeholder before any data arrives', () => {
    expect(wprSegment(null)).toEqual({ kind: 'loading' });
  });

  it('renders the version beside presence when the page declares one', () => {
    expect(wprSegment(withWpr({ present: true, version: '3.20.0.2' }))).toEqual({
      kind: 'detected',
      version: '3.20.0.2'
    });
  });

  it('renders presence without an invented version', () => {
    expect(wprSegment(withWpr({ present: true }))).toEqual({
      kind: 'detected',
      version: null
    });
  });

  it('renders real data saying the plugin is absent as not-detected', () => {
    expect(wprSegment(withWpr({}))).toEqual({ kind: 'not-detected' });
  });
});

describe('cacheSegment', () => {
  it('renders the loading placeholder before any data arrives', () => {
    expect(cacheSegment(null, NOW_MS)).toEqual({ kind: 'loading' });
  });

  it('renders honest silence when the plugin is absent (caching is not its question)', () => {
    expect(cacheSegment(withWpr({}), NOW_MS)).toEqual({ kind: 'not-applicable' });
  });

  it('reads a cache stamp seconds-based into the relative age and an absolute hover stamp', () => {
    // Three minutes old, exactly: NOW_MS − 180 s.
    const view = cacheSegment(
      withWpr({
        present: true,
        cacheMarkerFound: true,
        cached: true,
        timeStamp: (NOW_MS - 180_000) / 1000
      }),
      NOW_MS
    );
    expect(view).toMatchObject({
      kind: 'cached',
      age: '3 min ago',
      copy: { chip: '✓ Cached' }
    });
  });

  it('renders "Cached" without an invented age when the stamp is absent', () => {
    expect(
      cacheSegment(withWpr({ present: true, cacheMarkerFound: true, cached: true }), NOW_MS)
    ).toMatchObject({
      kind: 'cached',
      age: null,
      copy: { chip: '✓ Cached' }
    });
  });

  it('degrades a page-crafted stamp outside the display domain to "Cached", unstamped', () => {
    // A validator-genuine payload may carry a hand-crafted `cached@<huge>`
    // stamp; the timestamp leaf renders it as its absence — this selector
    // never crashes on hostile digits.
    const view = cacheSegment(
      withWpr({
        present: true,
        cacheMarkerFound: true,
        cached: true,
        timeStamp: 9_999_999_999_999
      }),
      NOW_MS
    );
    expect(view).toMatchObject({ kind: 'cached', age: null });
  });

  it('renders cache not detected when the plugin is present without a signature or headers', () => {
    // A stray stamp on an uncached payload (reachable only through a broken
    // producer — the validator shapes allow it) says nothing about this
    // visit's cache state: no age may render, and absence is not "not cached".
    expect(
      cacheSegment(
        withWpr({
          present: true,
          cacheMarkerFound: false,
          cached: false,
          timeStamp: Math.floor(NOW_MS / 1000)
        }),
        NOW_MS
      )
    ).toMatchObject({ kind: 'not-detected', copy: { chip: 'Cache not detected' } });
  });

  it('renders the signature without a stamp as "Cache not proven"', () => {
    expect(
      cacheSegment(
        withWpr({ present: true, cacheMarkerFound: true, cached: false, timeStamp: null }),
        NOW_MS
      )
    ).toMatchObject({ kind: 'uncertain-signature', copy: { chip: 'Cache not proven' } });
  });

  it('renders a verified hosting marker as "Possibly cached"', () => {
    expect(
      cacheSegment(
        withHeaders([{ name: 'sg-f-cache', value: 'HIT' }], {
          present: true,
          cacheMarkerFound: false,
          cached: false,
          timeStamp: null
        }),
        NOW_MS
      )
    ).toMatchObject({ kind: 'possibly-cached', copy: { chip: 'Possibly cached' } });
  });

  it('keeps a captured host serve beside the bypass and qualifies it', () => {
    expect(
      cacheSegment(
        withWpr(
          { present: true, cacheMarkerFound: false, cached: false, timeStamp: null },
          {
            pageHeaders: [{ name: 'cf-cache-status', value: 'HIT' }],
            bypassAttested: true
          }
        ),
        NOW_MS
      )
    ).toMatchObject({ kind: 'possibly-cached' });
  });

  it('distinguishes unavailable, truncated and redacted header captures', () => {
    const base = { present: true, cacheMarkerFound: false, cached: false, timeStamp: null };
    expect(cacheSegment(withHeaders(null, base), NOW_MS)).toMatchObject({
      kind: 'not-detected',
      copy: { report: 'Cache not detected (response headers unavailable)' }
    });
    expect(
      cacheSegment(
        {
          ...withHeaders([{ name: 'server', value: 'nginx' }], base),
          pageHeadersTruncated: true
        },
        NOW_MS
      )
    ).toMatchObject({
      kind: 'not-detected',
      copy: { report: 'Cache not detected (header capture truncated)' }
    });
    expect(
      cacheSegment(withHeaders([{ name: 'cf-cache-status', redacted: true }], base), NOW_MS)
    ).toMatchObject({
      kind: 'not-detected',
      copy: { report: 'Cache not detected (cache header value withheld)' }
    });
  });

  it('renders "Bypass requested" only when the URL requests the bypass', () => {
    expect(
      cacheSegment(
        withWpr(
          { present: true, cacheMarkerFound: false, cached: false, timeStamp: null },
          { bypassAttested: true }
        ),
        NOW_MS
      )
    ).toMatchObject({ kind: 'bypass-requested', copy: { chip: 'Bypass requested' } });
  });
});

describe('platformSegment', () => {
  it('renders the loading placeholder before any data arrives', () => {
    expect(platformSegment(null)).toEqual({ kind: 'loading' });
  });

  it('renders unavailable when no headers were captured for the tab', () => {
    expect(platformSegment(withHeaders(null))).toEqual({ kind: 'unavailable' });
  });

  it('reads the server header alone', () => {
    expect(platformSegment(withHeaders([{ name: 'Server', value: 'nginx' }]))).toEqual({
      kind: 'captured',
      value: 'nginx'
    });
  });

  it('reads x-powered-by alone', () => {
    expect(platformSegment(withHeaders([{ name: 'X-Powered-By', value: 'PHP/8.2' }]))).toEqual({
      kind: 'captured',
      value: 'PHP/8.2'
    });
  });

  it('joins both, server first', () => {
    expect(
      platformSegment(
        withHeaders([
          { name: 'X-Powered-By', value: 'PHP/8.2' },
          { name: 'Server', value: 'nginx' }
        ])
      )
    ).toEqual({ kind: 'captured', value: 'nginx · PHP/8.2' });
  });

  it('matches lowercased HTTP/2 header names case-insensitively', () => {
    expect(
      platformSegment(
        withHeaders([
          { name: 'server', value: 'cloudflare' },
          { name: 'x-powered-by', value: 'PHP/7.4' }
        ])
      )
    ).toEqual({ kind: 'captured', value: 'cloudflare · PHP/7.4' });
  });

  it('takes the first occurrence of each header', () => {
    expect(
      platformSegment(
        withHeaders([
          { name: 'Server', value: 'nginx/1.25' },
          { name: 'server', value: 'proxy' }
        ])
      )
    ).toEqual({ kind: 'captured', value: 'nginx/1.25' });
  });

  it('treats name-only rows (or empty values) as the header not being sent', () => {
    // The real captured-header shape: rows without a value key.
    expect(
      platformSegment(withHeaders([{ name: 'Server' }, { name: 'X-Cache', value: 'MISS' }]))
    ).toEqual({ kind: 'unknown' });
  });

  it('renders unknown when headers were captured but neither platform header exists', () => {
    expect(platformSegment(withHeaders([{ name: 'Content-Type', value: 'text/html' }]))).toEqual({
      kind: 'unknown'
    });
  });
});

describe('freshnessSegment', () => {
  it('renders the loading placeholder before and during the first fetch', () => {
    expect(freshnessSegment({ status: 'idle' }, NOW_MS)).toEqual({ kind: 'loading' });
    expect(freshnessSegment({ status: 'fetching' }, NOW_MS)).toEqual({ kind: 'loading' });
  });

  it('renders unavailable while the error view holds the cause', () => {
    expect(freshnessSegment({ status: 'error', cause: 'x', hardReload: false }, NOW_MS)).toEqual({
      kind: 'unavailable'
    });
  });

  it('renders unavailable when the panel cannot reach the page at all', () => {
    expect(freshnessSegment({ status: 'unavailable', reason: 'x' }, NOW_MS)).toEqual({
      kind: 'unavailable'
    });
  });

  it('renders its own state while a soft refresh is in the air', () => {
    const state: DataState = {
      status: 'refreshing',
      data: makeFdtData(),
      requestedAt: NOW_MS - 4_000
    };
    expect(freshnessSegment(state, NOW_MS)).toEqual({ kind: 'refreshing' });
  });

  it('renders the age and the absolute capture stamp while current', () => {
    const state: DataState = { status: 'ready', data: makeFdtData(), fetchedAt: NOW_MS - 45_000 };
    expect(freshnessSegment(state, NOW_MS)).toEqual({
      kind: 'current',
      age: '45 s ago',
      capturedAt: formatCacheTimestamp(Math.round((NOW_MS - 45_000) / 1000))
    });
  });

  it('flags stale once the data crosses the staleness threshold', () => {
    const state: DataState = {
      status: 'ready',
      data: makeFdtData(),
      fetchedAt: NOW_MS - (DATA_STALE_AFTER_MS + 1)
    };
    expect(freshnessSegment(state, NOW_MS)).toMatchObject({ kind: 'stale' });
  });
});

describe('isDataStale', () => {
  it('takes the threshold exactly and flips past it', () => {
    expect(DATA_STALE_AFTER_MS).toBe(600_000);
    expect(isDataStale(NOW_MS, NOW_MS)).toBe(false);
    expect(isDataStale(NOW_MS - DATA_STALE_AFTER_MS, NOW_MS)).toBe(true);
    expect(isDataStale(NOW_MS - (DATA_STALE_AFTER_MS - 1), NOW_MS)).toBe(false);
  });

  it("calibrates to whole minutes, so the marker's prose form stays a clean figure", () => {
    // The stale marker's remedy prose ("older than 10 min") reads
    // STALE_WINDOW_MINUTES — the threshold divided once beside itself — at
    // both its render sites. A recalibration that is not a whole-minute
    // multiple would print float garbage in that prose (e.g.
    // 654_321 ms → "1.0905333333333334"): this invariant fails the
    // recalibration loudly instead, forcing the figure to re-derive.
    expect(DATA_STALE_AFTER_MS % 60_000).toBe(0);
    expect(STALE_WINDOW_MINUTES).toBe(10);
  });
});

describe('topBarSegments', () => {
  it('maps an errored state to unavailable placeholders across the bar', () => {
    expect(topBarSegments({ status: 'error', cause: 'x', hardReload: false }, NOW_MS)).toEqual({
      wpr: { kind: 'unavailable' },
      cache: { kind: 'unavailable' },
      platform: { kind: 'unavailable' },
      freshness: { kind: 'unavailable' }
    });
  });

  it('maps the unavailable state to unavailable placeholders across the bar', () => {
    expect(topBarSegments({ status: 'unavailable', reason: 'x' }, NOW_MS)).toEqual({
      wpr: { kind: 'unavailable' },
      cache: { kind: 'unavailable' },
      platform: { kind: 'unavailable' },
      freshness: { kind: 'unavailable' }
    });
  });

  it('maps the boot states to loading placeholders across the bar', () => {
    expect(topBarSegments({ status: 'idle' }, NOW_MS)).toEqual({
      wpr: { kind: 'loading' },
      cache: { kind: 'loading' },
      platform: { kind: 'loading' },
      freshness: { kind: 'loading' }
    });
  });

  it('resolves every segment from the carried data while loaded', () => {
    const data = withHeaders([{ name: 'Server', value: 'nginx' }]);
    const view = topBarSegments({ status: 'ready', data, fetchedAt: NOW_MS - 10_000 }, NOW_MS);
    expect(view.wpr).toEqual({ kind: 'not-detected' });
    expect(view.cache).toEqual({ kind: 'not-applicable' });
    expect(view.platform).toEqual({ kind: 'captured', value: 'nginx' });
    expect(view.freshness).toEqual({
      kind: 'current',
      age: '10 s ago',
      capturedAt: formatCacheTimestamp(Math.round((NOW_MS - 10_000) / 1000))
    });
  });
});
