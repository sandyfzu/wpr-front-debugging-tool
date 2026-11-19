/**
 * The overview tiles' view model: each tile's answer from one payload, read
 * through the top bar's selectors (no contradiction with the bar) and the
 * summary (counts, stamp, layer, WordPress, platform).
 */
import { describe, expect, it } from 'vitest';
import { cacheCopy } from '../../../../lib/detection/cache-context';
import { summarizeFdtData } from '../../../../lib/panel/detections-summary';
import type { FdtData, WprDetections } from '../../../../lib/wp-rocket/types';
import { makeFdtData } from '../../state/fixtures';
import { cacheAnswerTone, cacheSegment, platformSegment } from '../../top-bar/selectors';
import { CACHE_EVIDENCE_ROUTE, cacheTile, overviewView, stackTile, wprTile } from './overview';

/** The page clock the tiles read (ms). */
const NOW = 1_700_010_000_000;

/** A representable cache stamp (epoch seconds). */
const STAMP = 1_700_000_000;

/**
 * A payload with plugin-row and payload overrides.
 *
 * @param wpr The plugin row's overrides.
 * @param extra Payload overrides.
 */
function data(wpr: Partial<WprDetections['wpr']>, extra?: Partial<FdtData>): FdtData {
  const base = makeFdtData();
  return makeFdtData({
    wprDetections: { ...base.wprDetections, wpr: { ...base.wprDetections.wpr, ...wpr } },
    ...extra
  });
}

/** A plugin-present payload's row (version, no cache marker). */
const PRESENT = { present: true, version: '3.20.1' } as const;

/**
 * The summary of a payload (the page's one pass).
 *
 * @param payload The payload.
 */
function summaryOf(payload: FdtData): ReturnType<typeof summarizeFdtData>['summary'] {
  return summarizeFdtData(payload).summary;
}

describe('wprTile', () => {
  it('states the version and the footprints that prove it', () => {
    expect(wprTile(data({ ...PRESENT, cacheMarkerFound: true }))).toEqual({
      kind: 'detected',
      version: '3.20.1',
      evidence: 'Detected by the generator tag and the cache signature'
    });
  });

  it('keeps a version-less plugin detected, with a null version', () => {
    expect(wprTile(data({ present: true, cacheMarkerFound: true }))).toEqual({
      kind: 'detected',
      version: null,
      evidence: 'Detected by the cache signature'
    });
  });

  it('names inferred presence when no tag or signature was found', () => {
    expect(wprTile(data({ present: true }))).toMatchObject({
      evidence: 'Detected by its optimizations on this page'
    });
  });

  it('answers absence neutrally, like the bar', () => {
    expect(wprTile(data({}))).toEqual({ kind: 'not-detected' });
  });
});

describe('cacheTile', () => {
  it('is not applicable when WP Rocket is absent (the bar is silent there too)', () => {
    const payload = data({});
    expect(cacheTile(payload, summaryOf(payload), NOW)).toEqual({ kind: 'not-applicable' });
  });

  it('states a cached page with its stamp, unexplained (the stamp is the proof)', () => {
    const payload = data({ ...PRESENT, cacheMarkerFound: true, cached: true, timeStamp: STAMP });
    const tile = cacheTile(payload, summaryOf(payload), NOW);
    expect(tile).toEqual({
      kind: 'answered',
      tone: 'ok',
      copy: cacheCopy({ kind: 'cached', seconds: STAMP, formatted: '2023-11-14 22:13:20 UTC' }),
      explained: false,
      stamp: { seconds: STAMP, formatted: '2023-11-14 22:13:20 UTC' },
      layer: null
    });
  });

  it('states a cached page without a usable stamp as cached, no stamp', () => {
    const payload = data({ ...PRESENT, cacheMarkerFound: true, cached: true, timeStamp: null });
    expect(cacheTile(payload, summaryOf(payload), NOW)).toMatchObject({
      tone: 'ok',
      explained: false,
      stamp: null
    });
  });

  it.each<[string, Partial<WprDetections['wpr']>, Partial<FdtData>]>([
    ['signature without its stamp', { cacheMarkerFound: true }, {}],
    [
      'a host marker without a signature',
      {},
      { pageHeaders: [{ name: 'cf-cache-status', value: 'HIT' }] }
    ],
    ['nothing captured (unknown cache)', {}, {}],
    [
      'a complete capture without a marker',
      {},
      { pageHeaders: [{ name: 'server', value: 'nginx' }] }
    ],
    ['a bypass request', {}, { bypassAttested: true }]
  ])('explains %s with the bar’s copy and tone', (_name, wpr, extra) => {
    const payload = data({ ...PRESENT, ...wpr }, extra);
    const bar = cacheSegment(payload, NOW);
    const tile = cacheTile(payload, summaryOf(payload), NOW);
    if (bar.kind === 'loading' || bar.kind === 'unavailable' || bar.kind === 'not-applicable') {
      throw new Error(`unexpected bar answer ${bar.kind}`);
    }
    expect(tile).toMatchObject({
      kind: 'answered',
      tone: cacheAnswerTone(bar),
      copy: bar.copy,
      explained: true,
      stamp: null
    });
  });

  it('names the hosting layer beside a signature without its stamp', () => {
    const payload = data(
      { ...PRESENT, cacheMarkerFound: true },
      { pageHeaders: [{ name: 'cf-cache-status', value: 'HIT' }] }
    );
    expect(cacheTile(payload, summaryOf(payload), NOW)).toMatchObject({
      tone: 'warn',
      layer: 'Cloudflare'
    });
  });

  it('points at the captured headers for the evidence', () => {
    expect(CACHE_EVIDENCE_ROUTE).toBe('headers-cookies');
  });
});

describe('stackTile', () => {
  it('states the declared WordPress version, the bar’s server answer and the platform', () => {
    const payload = data(PRESENT, {
      wordpressVersion: '6.8.1',
      pageHeaders: [
        { name: 'Server', value: 'nginx' },
        { name: 'X-Powered-By', value: 'PHP/8.3.1' },
        { name: 'X-Kinsta-Cache', value: 'HIT' }
      ]
    });
    expect(stackTile(payload, summaryOf(payload))).toEqual({
      wordpressVersion: '6.8.1',
      server: platformSegment(payload),
      platform: { name: 'Kinsta', header: 'X-Kinsta-Cache' }
    });
    expect(platformSegment(payload)).toEqual({ kind: 'captured', value: 'nginx · PHP/8.3.1' });
  });

  it.each<[string, Partial<FdtData>, string]>([
    ['no headers captured', {}, 'unavailable'],
    [
      'headers without a server name',
      { pageHeaders: [{ name: 'vary', value: 'Accept' }] },
      'unknown'
    ]
  ])('keeps the bar’s honest silence: %s', (_name, extra, kind) => {
    const payload = data(PRESENT, extra);
    const tile = stackTile(payload, summaryOf(payload));
    expect(tile.server).toEqual({ kind });
    expect(tile.wordpressVersion).toBeNull();
    expect(tile.platform).toBeNull();
  });
});

describe('overviewView', () => {
  it('passes the summary counts through unchanged and resolves every tile', () => {
    const payload = data(PRESENT);
    const summary = summaryOf(payload);
    const view = overviewView(payload, summary, NOW);
    expect(view.score).toBe(summary.optimizations);
    expect(view.wpr).toEqual(wprTile(payload));
    expect(view.cache).toEqual(cacheTile(payload, summary, NOW));
    expect(view.stack).toEqual(stackTile(payload, summary));
  });
});
