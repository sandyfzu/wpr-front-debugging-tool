/**
 * The Detections summary: every fact read off the cards (strip ↔ card
 * consistency by construction), the cache tri-state, and the
 * "N of M optimizations active" count's membership rule.
 */
import { describe, expect, it } from 'vitest';
import type { FdtData, WprDetections } from '../wp-rocket/types';
import { buildStatusItems, type StatusItem } from './detections-view-model';
import {
  isOptimizationCard,
  STATUS_LABELS,
  summarizeDetections,
  summarizeFdtData
} from './detections-summary';
import { makeReportData as makeFdtData } from './support-report.fixtures';

/** Fixture data with detection-row overrides merged over the empty rowset. */
function data(rows: Partial<WprDetections>, extra?: Partial<FdtData>): FdtData {
  const base = makeFdtData();
  return makeFdtData({ wprDetections: { ...base.wprDetections, ...rows }, ...extra });
}

describe('summarizeDetections', () => {
  it('reads plugin presence + version, cache stamp, platform and server off the cards', () => {
    const items = buildStatusItems(
      data(
        {
          wpr: {
            present: true,
            cacheMarkerFound: true,
            cached: true,
            version: '3.20.1',
            timeStamp: 1791342253
          }
        },
        {
          pageHeaders: [
            { name: 'Server', value: 'nginx' },
            { name: 'X-Kinsta-Cache', value: 'HIT' }
          ]
        }
      )
    );
    const summary = summarizeDetections(items);
    expect(summary.wpr).toEqual({ present: true, version: '3.20.1' });
    expect(summary.cache).toEqual({
      kind: 'cached',
      seconds: 1791342253,
      formatted: '2026-10-07 03:04:13 UTC'
    });
    expect(summary.server).toBe('nginx');
    expect(summary.platform).toEqual({ name: 'Kinsta', header: 'X-Kinsta-Cache' });
  });

  it('answers a versionless plugin with a null version', () => {
    const summary = summarizeDetections(
      buildStatusItems(
        data({
          wpr: {
            present: true,
            cacheMarkerFound: false,
            cached: false,
            version: null,
            timeStamp: null
          }
        })
      )
    );
    expect(summary.wpr).toEqual({ present: true, version: null });
    expect(summary.cache).toEqual({ kind: 'not-detected', headers: 'unavailable' });
  });

  it('marks the cache not applicable when the plugin is absent and nothing was cached', () => {
    const summary = summarizeDetections(buildStatusItems(makeFdtData()));
    expect(summary.wpr).toEqual({ present: false });
    expect(summary.cache).toEqual({ kind: 'not-applicable' });
  });

  it('keeps a cached card with an unrepresentable stamp as cached without a time', () => {
    const summary = summarizeDetections(
      buildStatusItems(
        data({
          wpr: {
            present: true,
            cacheMarkerFound: true,
            cached: true,
            version: '1',
            timeStamp: 9e20
          }
        })
      )
    );
    expect(summary.cache).toEqual({ kind: 'cached', seconds: null, formatted: null });
  });

  it('maps every explicit cache state, normalizing the stamp again', () => {
    const items = buildStatusItems(
      data({
        wpr: {
          present: true,
          cacheMarkerFound: false,
          cached: false,
          version: null,
          timeStamp: null
        }
      })
    );
    expect(
      summarizeDetections(items, {
        kind: 'cached',
        seconds: 253_402_300_800,
        formatted: 'not trusted'
      }).cache
    ).toEqual({ kind: 'cached', seconds: null, formatted: null });
    expect(summarizeDetections(items, { kind: 'uncertain-signature' }).cache).toEqual({
      kind: 'uncertain-signature'
    });
    expect(
      summarizeDetections(items, {
        kind: 'possibly-cached',
        evidence: 'SiteGround',
        bypassAttested: true
      }).cache
    ).toEqual({ kind: 'possibly-cached', evidence: 'SiteGround', bypassAttested: true });
    expect(
      summarizeDetections(items, { kind: 'not-detected', headers: 'truncated' }).cache
    ).toEqual({ kind: 'not-detected', headers: 'truncated' });
    expect(summarizeDetections(items, { kind: 'bypass-requested' }).cache).toEqual({
      kind: 'bypass-requested'
    });
  });

  it('states no server/platform when headers were not captured or carry neither', () => {
    expect(summarizeDetections(buildStatusItems(makeFdtData()))).toMatchObject({
      server: null,
      platform: null
    });
    expect(
      summarizeDetections(
        buildStatusItems(makeFdtData({ pageHeaders: [{ name: 'Server', value: '  ' }] }))
      )
    ).toMatchObject({ server: null, platform: null });
  });

  it('counts optimization cards only: never derived cards, the plugin row or the beacon', () => {
    const items = buildStatusItems(
      data(
        {
          wpr: { present: true, cacheMarkerFound: true, cached: true, version: '3', timeStamp: 1 },
          minify_css: { present: true },
          priority_elements_beacon: { present: true, status: null, isMobile: null }
        },
        { pageHeaders: [{ name: 'Server', value: 'nginx' }] }
      )
    );
    const optimizationCards = items.filter((item) => isOptimizationCard(item.id));
    expect(optimizationCards.map((item) => item.id)).not.toContain('wpr');
    expect(optimizationCards.map((item) => item.id)).not.toContain('priority_elements_beacon');
    expect(summarizeDetections(items).optimizations).toEqual({
      active: 1,
      total: optimizationCards.length,
      offInTab: 0
    });
    // Every remaining row of the record is an optimization (16 of the 19 rows:
    // async_css rides the CSS card, plus the plugin and beacon rows).
    expect(optimizationCards).toHaveLength(16);
  });

  it('agrees with the cards for every card it states (strip ↔ card consistency)', () => {
    const items = buildStatusItems(
      data(
        {
          wpr: {
            present: true,
            cacheMarkerFound: true,
            cached: true,
            version: '3.1',
            timeStamp: 1700000000
          },
          delay_js: { present: true, scripts: [], version: '2', delayedScripts: 0 },
          lazyload: { present: true, images: [] }
        },
        { pageHeaders: [{ name: 'Server', value: 'Apache' }] }
      )
    );
    const summary = summarizeDetections(items);
    const card = (id: StatusItem['id']): StatusItem | undefined =>
      items.find((item) => item.id === id);
    expect(card('server')?.subtitle).toBe(summary.server);
    expect(card('cached')?.subtitle).toBe(
      summary.cache.kind === 'cached' ? summary.cache.formatted : undefined
    );
    expect(card('wpr')?.status).toBe('active');
    expect(summary.optimizations.active).toBe(
      items.filter((item) => isOptimizationCard(item.id) && item.status === 'active').length
    );
  });

  it('tolerates an empty card list', () => {
    expect(summarizeDetections([])).toEqual({
      wpr: { present: false },
      cache: { kind: 'not-applicable' },
      server: null,
      platform: null,
      optimizations: { active: 0, total: 0, offInTab: 0 },
      wordpressVersion: null,
      cacheLayer: null
    });
  });
});

describe('STATUS_LABELS', () => {
  it('names every verdict in sentence case', () => {
    expect(STATUS_LABELS).toEqual({
      active: 'Active',
      collecting: 'Collecting',
      unknown: 'Unknown',
      'not-active': 'Not active'
    });
  });
});

describe('summarizeFdtData — the non-card page facts', () => {
  const handled = {
    wpr: {
      present: true,
      cacheMarkerFound: true,
      cached: false,
      version: '3.23',
      timeStamp: null
    }
  };

  it('carries the declared WordPress version and the served host layer', () => {
    const payload = data(handled, {
      wordpressVersion: '6.8.1',
      pageHeaders: [{ name: 'cf-cache-status', value: 'HIT' }]
    });
    const { summary, items } = summarizeFdtData(payload);
    expect(summary.wordpressVersion).toBe('6.8.1');
    expect(summary.cacheLayer).toBe('Cloudflare');
    // The signature outranks the host marker for the page-cache state.
    expect(summary.cache).toEqual({ kind: 'uncertain-signature' });
    // The cards are exactly the view model's (one wiring, no second card set).
    expect(items).toEqual(buildStatusItems(payload));
  });

  it('states absence as null: no version declared, no served marker', () => {
    const { summary } = summarizeFdtData(
      data(handled, { pageHeaders: [{ name: 'cf-cache-status', value: 'BYPASS' }] })
    );
    expect(summary.wordpressVersion).toBeNull();
    expect(summary.cacheLayer).toBeNull();
  });

  it('a plugin-absent page names no cache layer (no cache question there)', () => {
    const { summary } = summarizeFdtData(
      data(
        {},
        { pageHeaders: [{ name: 'cf-cache-status', value: 'HIT' }], wordpressVersion: '6.8' }
      )
    );
    expect(summary.cache).toEqual({ kind: 'not-applicable' });
    expect(summary.cacheLayer).toBeNull();
    // The WordPress version is a page fact, not a plugin one.
    expect(summary.wordpressVersion).toBe('6.8');
  });

  it('collecting and unknown cards never count as active', () => {
    const { summary, items } = summarizeFdtData(
      data({
        ...handled,
        priority_elements_beacon: { present: true, status: { lrc: true }, isMobile: null }
      })
    );
    expect(items.some((item) => item.status === 'collecting')).toBe(true);
    expect(items.some((item) => item.status === 'unknown')).toBe(true);
    expect(summary.optimizations.active).toBe(
      items.filter((item) => isOptimizationCard(item.id) && item.status === 'active').length
    );
  });
});
