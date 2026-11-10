/**
 * The detections view model's card-matrix tests: the ported presentation
 * rules pinned as a table — the headers-derived cards, the RUCSS/async-CSS
 * merge (all three branches), the cached-card stamp composition, the
 * lifecycle-aware Optimize-critical-images subtitle, and the id keying (no
 * magic ids — every card answers with its detection row or a derived id).
 */
import { describe, expect, it } from 'vitest';
import { buildStatusItems, hostLayersTooltip, type StatusItem } from './detections-view-model';
import { HOST_LAYER_ADD_ON_CAVEAT } from '../detection/host-layers';
import type { FdtData, WprDetections } from '../wp-rocket/types';
import { DNS_PREFETCH_LIMIT, HUD_FEATURES, MOBILE_CACHE_LIMIT } from '../detection/hud';

/**
 * The record exactly as the payload validator rebuilds it (its literal
 * order), so the card order reflects the payload's real key order — not a
 * hand-guess. Call per test.
 */
function fullDetections(overrides?: Partial<WprDetections>): WprDetections {
  return {
    wpr: { present: false, cacheMarkerFound: false, cached: false, version: null, timeStamp: null },
    remove_unused_css: { present: false },
    async_css: { present: false, criticalStyle: false },
    lazyload_css_bg_img: { present: false },
    self_hosted_fonts: { present: false },
    image_dimensions: { present: false },
    minify_css: { present: false },
    minify_js: { present: false },
    minify_concatenate_js: { present: false },
    preload_links: { present: false },
    rocket_cdn: { present: false },
    mobile_cache: { present: false, variant: null },
    dns_prefetch: { present: false, domains: [] },
    delay_js: { present: false, scripts: [], version: null, delayedScripts: 0 },
    defer_all_js: { present: false, scripts: [], deferredScripts: 0 },
    lazyload: { present: false, images: [] },
    lazyload_iframes: { present: false, replaceImage: false },
    rocket_above_the_fold_optimization: { present: false, lcpComment: false },
    automatic_lazy_rendering: {
      present: false,
      lazyRenderElements: 0,
      inlineCssPresent: false,
      locationHashes: 0
    },
    auto_preload_fonts: { present: false, fonts: [] },
    preconnect_external_domains: { present: false, domains: [], preconnectCount: 0 },
    priority_elements_beacon: { present: false, status: null, isMobile: null },
    ...overrides
  };
}

function makeData(overrides?: Partial<Pick<FdtData, 'pageHeaders' | 'wprDetections'>>): FdtData {
  return {
    allScriptsLoaded: true,
    pageHeaders: null,
    undefinedReferencesOnPage: [],
    wprDetections: fullDetections(),
    preloadedResources: { present: false },
    diagnoserData: null,
    ...overrides
  };
}

/**
 * Assert the k-th card answers exactly the record asserted here — the rest
 * of the card's shape is reproduced from the item itself, so only the
 * assertions carried in `expected` are judgeable (overrides of nested
 * shapes replace the whole field).
 */
function expectCard(items: StatusItem[], at: number, expected: Partial<StatusItem>): void {
  const item = items.at(at);
  if (item === undefined) throw new Error(`no card at index ${String(at)}`);
  expect(item).toEqual({ ...item, ...expected });
}

describe('buildStatusItems — the headers-derived cards', () => {
  it('emits the Server card from the captured value, then the platform card', () => {
    const items = buildStatusItems(
      makeData({
        pageHeaders: [
          { name: 'X-Powered-By', value: 'WP Engine/7.3.1' },
          { name: 'Server', value: 'nginx' }
        ]
      })
    );
    expect(items[0]).toEqual({
      id: 'server',
      name: 'Server',
      status: 'active',
      subtitle: 'nginx',
      detail: { kind: 'server', value: 'nginx' }
    });
    expect(items[1]).toEqual({
      id: 'known-platform',
      name: 'Known Platform',
      status: 'active',
      subtitle: 'WP Engine',
      detail: { kind: 'platform', name: 'WP Engine', header: 'X-Powered-By' }
    });
  });

  it('an uncaptured server value yields the silent not-active card (no subtitle)', () => {
    // Headers captured but no server header (and a value-less row): presence
    // still produces the card, honestly not-active. No platform matched.
    const items = buildStatusItems(
      makeData({ pageHeaders: [{ name: 'Server' }, { name: 'Cache-Control', value: 'max-age=0' }] })
    );
    expect(items[0]).toEqual({ id: 'server', name: 'Server', status: 'not-active' });
    expect(items.some((item) => item.id === 'known-platform')).toBe(false);
  });

  it('a captured server value that is whitespace-only reads as no value', () => {
    const items = buildStatusItems(makeData({ pageHeaders: [{ name: 'Server', value: '   ' }] }));
    expectCard(items, 0, { id: 'server', status: 'not-active', subtitle: undefined });
  });

  it('omits both headers-derived cards silently when pageHeaders is null', () => {
    const items = buildStatusItems(makeData());
    expect(items.some((item) => item.id === 'server')).toBe(false);
    expect(items.some((item) => item.id === 'known-platform')).toBe(false);
  });
});

describe('buildStatusItems — the Host layers card', () => {
  it('lists every captured layer with its state, after the platform card', () => {
    const items = buildStatusItems(
      makeData({
        pageHeaders: [
          { name: 'X-Powered-By', value: 'WP Engine/8.0' },
          { name: 'cf-ray', value: 'abc-SJC' },
          { name: 'cf-cache-status', value: 'HIT' },
          { name: 'x-proxy-cache', value: 'MISS' },
          { name: 'x-sucuri-id', value: '14018' }
        ]
      })
    );
    expect(items.map((item) => item.id).slice(0, 3)).toEqual([
      'server',
      'known-platform',
      'host-layers'
    ]);
    expect(items[2]).toEqual({
      id: 'host-layers',
      name: 'Host layers',
      status: 'active',
      subtitle: 'Cloudflare: cache hit · Sucuri: present · Host proxy cache: no cache hit',
      detail: {
        kind: 'host-layers',
        layers: [
          {
            id: 'cloudflare',
            label: 'Cloudflare',
            reading: 'served',
            headers: ['cf-cache-status', 'cf-ray']
          },
          { id: 'sucuri', label: 'Sucuri', reading: 'present', headers: ['x-sucuri-id'] },
          {
            id: 'host-proxy',
            label: 'Host proxy cache',
            reading: 'not-served',
            headers: ['x-proxy-cache']
          }
        ]
      }
    });
  });

  it('follows the Server card when no platform matched', () => {
    const items = buildStatusItems(
      makeData({ pageHeaders: [{ name: 'X-Varnish', value: '7 3' }] })
    );
    expectCard(items, 1, { id: 'host-layers', subtitle: 'Varnish: cache hit' });
  });

  it('absence is no card: no marker captured, or nothing captured', () => {
    for (const pageHeaders of [null, [], [{ name: 'x-cache', value: 'HIT' }]]) {
      expect(
        buildStatusItems(makeData({ pageHeaders })).some((item) => item.id === 'host-layers'),
        JSON.stringify(pageHeaders)
      ).toBe(false);
    }
  });
});

describe('hostLayersTooltip', () => {
  it('names one header in the singular', () => {
    expect(
      hostLayersTooltip([
        { id: 'varnish', label: 'Varnish', reading: 'served', headers: ['X-Varnish'] }
      ])
    ).toBe(`Identified by the X-Varnish response header. ${HOST_LAYER_ADD_ON_CAVEAT}`);
  });

  it('names several headers, across layers, in the plural', () => {
    expect(
      hostLayersTooltip([
        {
          id: 'cloudflare',
          label: 'Cloudflare',
          reading: 'served',
          headers: ['cf-cache-status', 'cf-ray']
        },
        { id: 'siteground', label: 'SiteGround', reading: 'served', headers: ['sg-f-cache'] }
      ])
    ).toBe(
      `Identified by the cf-cache-status, cf-ray, sg-f-cache response headers. ${HOST_LAYER_ADD_ON_CAVEAT}`
    );
  });
});

describe('buildStatusItems — the platform registry match', () => {
  it('matches WP Engine on a suffix-bearing value (contains rule)', () => {
    const items = buildStatusItems(
      makeData({ pageHeaders: [{ name: 'X-Powered-By', value: 'WP Engine/8.0' }] })
    );
    expectCard(items, 1, {
      id: 'known-platform',
      subtitle: 'WP Engine',
      detail: { kind: 'platform', name: 'WP Engine', header: 'X-Powered-By' }
    });
  });

  it('matches Kinsta on header presence alone', () => {
    const items = buildStatusItems(
      makeData({ pageHeaders: [{ name: 'X-kinsta-Cache', value: 'MISS' }] })
    );
    expectCard(items, 1, {
      id: 'known-platform',
      subtitle: 'Kinsta',
      detail: { kind: 'platform', name: 'Kinsta', header: 'X-kinsta-Cache' }
    });
  });

  it('matches Hostinger only when the Platform row carries its value', () => {
    const items = buildStatusItems(
      makeData({ pageHeaders: [{ name: 'platform', value: 'hostinger' }] })
    );
    expectCard(items, 1, {
      id: 'known-platform',
      subtitle: 'Hostinger',
      detail: { kind: 'platform', name: 'Hostinger', header: 'platform' }
    });
  });

  it('a declared value that does not contain the expected value matches nothing', () => {
    const items = buildStatusItems(
      makeData({ pageHeaders: [{ name: 'X-Powered-By', value: 'PHP/8.2' }] })
    );
    expect(items.some((item) => item.id === 'known-platform')).toBe(false);
  });

  it('the registry order is the scan order (WP Engine before Kinsta)', () => {
    const items = buildStatusItems(
      makeData({
        pageHeaders: [
          { name: 'X-Kinsta-Cache', value: 'HIT' },
          { name: 'X-Powered-By', value: 'WP Engine' }
        ]
      })
    );
    expectCard(items, 1, { subtitle: 'WP Engine' });
  });

  it('an empty value on a value-declared header does not stub later platforms', () => {
    // A value-declared header with no value skips its own platform only —
    // the next registry entry still gets its shot.
    const items = buildStatusItems(
      makeData({
        pageHeaders: [{ name: 'X-Powered-By' }, { name: 'Platform', value: 'hostinger' }]
      })
    );
    expectCard(items, 1, { subtitle: 'Hostinger' });
  });

  it('later duplicate rows cannot undo an earlier match (first match wins)', () => {
    const items = buildStatusItems(
      makeData({
        pageHeaders: [
          { name: 'X-Powered-By', value: 'WP Engine' },
          { name: 'X-Kinsta-Cache', value: 'HIT' }
        ]
      })
    );
    expectCard(items, 1, { subtitle: 'WP Engine' });
  });
});

describe('buildStatusItems — the wpr row and the cached card', () => {
  it('the wpr card carries the version subtitle (present)', () => {
    const items = buildStatusItems(
      makeData({
        wprDetections: fullDetections({
          wpr: {
            present: true,
            cacheMarkerFound: false,
            cached: false,
            version: '3.20.0.2',
            timeStamp: null
          }
        })
      })
    );
    expectCard(items, 0, {
      id: 'wpr',
      name: 'WP Rocket',
      status: 'active',
      subtitle: 'Version: 3.20.0.2',
      detail: { kind: 'version', version: '3.20.0.2' }
    });
  });

  it('a present wpr without a version says "Version: not available"', () => {
    const items = buildStatusItems(
      makeData({
        wprDetections: fullDetections({
          wpr: {
            present: true,
            cacheMarkerFound: false,
            cached: false,
            version: null,
            timeStamp: null
          }
        })
      })
    );
    expectCard(items, 0, { subtitle: 'Version: not available' });
  });

  it('an unpresent wpr card carries no version subtitle at all', () => {
    const items = buildStatusItems(makeData());
    expectCard(items, 0, { id: 'wpr', status: 'not-active', subtitle: undefined });
  });

  it('a cached page gets the separate Cached card with the formatted stamp', () => {
    const items = buildStatusItems(
      makeData({
        wprDetections: fullDetections({
          wpr: {
            present: true,
            cacheMarkerFound: true,
            cached: true,
            version: '3.20.0.2',
            timeStamp: 1_767_225_600
          }
        })
      })
    );
    expect(items[0]).toMatchObject({ id: 'wpr', subtitle: 'Version: 3.20.0.2' });
    expect(items[1]).toEqual({
      id: 'cached',
      name: 'Cached',
      status: 'active',
      subtitle: '2026-01-01 00:00:00 UTC',
      detail: { kind: 'cached-at', seconds: 1_767_225_600, formatted: '2026-01-01 00:00:00 UTC' }
    });
  });

  it('an unrepresentable stamp renders the Cached card unstamped (never garbage)', () => {
    const items = buildStatusItems(
      makeData({
        wprDetections: fullDetections({
          wpr: {
            present: true,
            cacheMarkerFound: true,
            cached: true,
            version: null,
            timeStamp: 9.99e99
          }
        })
      })
    );
    expect(items[1]).toEqual({
      id: 'cached',
      name: 'Cached',
      status: 'active',
      detail: { kind: 'cached-at', seconds: null, formatted: null }
    });
  });

  it('a cached page without a stamp yields the Cached card without a subtitle', () => {
    const items = buildStatusItems(
      makeData({
        wprDetections: fullDetections({
          wpr: {
            present: true,
            cacheMarkerFound: true,
            cached: true,
            version: null,
            timeStamp: null
          }
        })
      })
    );
    expectCard(items, 1, { id: 'cached', status: 'active', subtitle: undefined });
  });

  it('an uncached page gets no Cached card', () => {
    const items = buildStatusItems(
      makeData({
        wprDetections: fullDetections({
          wpr: {
            present: true,
            cacheMarkerFound: false,
            cached: false,
            version: null,
            timeStamp: 1_767_225_600
          }
        })
      })
    );
    expect(items.some((item) => item.id === 'cached')).toBe(false);
  });
});

describe('buildStatusItems — the RUCSS/async-CSS merge (three branches)', () => {
  it('RUCSS applied: its own card, active, with the merge subtitle', () => {
    const items = buildStatusItems(
      makeData({
        wprDetections: fullDetections({
          remove_unused_css: { present: true },
          async_css: { present: false, criticalStyle: false }
        })
      })
    );
    expect(items.find((item) => item.id === 'remove_unused_css')).toEqual({
      id: 'remove_unused_css',
      name: 'Remove Unused CSS',
      status: 'active',
      subtitle: 'Optimize CSS delivery'
    });
  });

  it('async CSS applied while RUCSS is not: the card is renamed and active', () => {
    const items = buildStatusItems(
      makeData({
        wprDetections: fullDetections({
          remove_unused_css: { present: false },
          async_css: { present: true, criticalStyle: false }
        })
      })
    );
    expect(items.find((item) => item.id === 'remove_unused_css')).toEqual({
      id: 'remove_unused_css',
      name: 'Load CSS asynchronously',
      status: 'active',
      subtitle: 'Optimize CSS delivery'
    });
  });

  it('both absent: the shared feature card in its natural not-active state', () => {
    const items = buildStatusItems(makeData());
    const card = items.find((item) => item.id === 'remove_unused_css');
    expect(card).toEqual({
      id: 'remove_unused_css',
      name: 'Optimize CSS delivery',
      status: 'not-active'
    });
    expect(card?.subtitle).toBeUndefined();
  });

  it('the async_css row itself never emits a card (it is merged)', () => {
    const items = buildStatusItems(
      makeData({
        wprDetections: fullDetections({
          async_css: { present: true, criticalStyle: false },
          remove_unused_css: { present: true }
        })
      })
    );
    expect(items.some((item) => item.id === 'async_css')).toBe(false);
  });
});

describe('buildStatusItems — per-feature subtitles', () => {
  it('delay JS carries its version subtitle only when a version exists', () => {
    const withVersion = buildStatusItems(
      makeData({
        wprDetections: fullDetections({
          delay_js: { present: true, scripts: [], version: '2.0.4', delayedScripts: 0 }
        })
      })
    );
    expectCard(
      withVersion,
      withVersion.findIndex((item) => item.id === 'delay_js'),
      {
        subtitle: 'Version: 2.0.4',
        detail: { kind: 'version', version: '2.0.4' }
      }
    );
    const withoutVersion = buildStatusItems(
      makeData({
        wprDetections: fullDetections({
          delay_js: { present: true, scripts: [], version: null, delayedScripts: 0 }
        })
      })
    );
    expectCard(
      withoutVersion,
      withoutVersion.findIndex((item) => item.id === 'delay_js'),
      {
        status: 'active',
        subtitle: undefined
      }
    );
  });

  it('lazyload_iframes carries the replace-preview subtitle only when the script is present', () => {
    const withScript = buildStatusItems(
      makeData({
        wprDetections: fullDetections({ lazyload_iframes: { present: true, replaceImage: true } })
      })
    );
    const scriptCard = withScript.find((item) => item.id === 'lazyload_iframes');
    expect(scriptCard).toMatchObject({ subtitle: 'Replace iframe with preview image' });
    const withoutScript = buildStatusItems(
      makeData({
        wprDetections: fullDetections({ lazyload_iframes: { present: true, replaceImage: false } })
      })
    );
    expect(withoutScript.find((item) => item.id === 'lazyload_iframes')?.subtitle).toBeUndefined();
  });

  it('a declared-only iframes card drops the replace-preview subtitle (the script ships with the option)', () => {
    /** The iframes card of a meta-declared row with the given page targets. */
    const card = (targets: boolean) =>
      buildStatusItems(
        makeData({
          wprDetections: fullDetections({
            lazyload_iframes: { present: true, replaceImage: true, source: 'meta', targets }
          })
        })
      ).find((item) => item.id === 'lazyload_iframes');
    const declaredOnly = card(false);
    expect(declaredOnly).toMatchObject({
      status: 'active',
      declaredOnly: 'Declared on this render, but no iframe or video on this page is lazy-loaded.'
    });
    expect(declaredOnly?.subtitle).toBeUndefined();
    const withTargets = card(true);
    expect(withTargets?.subtitle).toBe('Replace iframe with preview image');
    expect(withTargets?.declaredOnly).toBeUndefined();
  });
});

describe('buildStatusItems — the mobile cache card', () => {
  /** The mobile cache card over a page carrying the given row and beacon device. */
  const mobileCard = (row: WprDetections['mobile_cache'], isMobile: boolean | null) =>
    buildStatusItems(
      makeData({
        wprDetections: fullDetections({
          mobile_cache: row,
          priority_elements_beacon: { present: true, status: null, isMobile }
        })
      })
    ).find((item) => item.id === 'mobile_cache');

  it('a declared row: the render device as subtitle (beacon read off its row), the limit as its detail', () => {
    expect(mobileCard({ present: true, variant: 'mobile', source: 'meta' }, false)).toEqual({
      id: 'mobile_cache',
      name: 'Separate cache files for mobile devices',
      status: 'active',
      source: 'meta',
      subtitle: 'Rendered for mobile · beacon config: not mobile',
      detail: {
        kind: 'proof-limit',
        text: 'Rendered for mobile · beacon config: not mobile',
        limit: MOBILE_CACHE_LIMIT
      }
    });
  });

  it('a refuted row invents no subtitle, even with a beacon device', () => {
    expect(mobileCard({ present: false, variant: null, source: 'meta' }, true)).toEqual({
      id: 'mobile_cache',
      name: 'Separate cache files for mobile devices',
      status: 'not-active',
      source: 'meta'
    });
  });
});

describe('buildStatusItems — the DNS prefetch card', () => {
  /** The DNS prefetch card over a page carrying the given row. */
  const dnsCard = (row: WprDetections['dns_prefetch']) =>
    buildStatusItems(makeData({ wprDetections: fullDetections({ dns_prefetch: row }) })).find(
      (item) => item.id === 'dns_prefetch'
    );

  it('a declared row: the hints seen as subtitle, the limit as its detail', () => {
    expect(
      dnsCard({
        present: true,
        domains: ['https://a.example/', 'https://b.example/'],
        source: 'meta'
      })
    ).toEqual({
      id: 'dns_prefetch',
      name: 'Prefetch DNS Requests',
      status: 'active',
      source: 'meta',
      subtitle: '2 domains hinted',
      detail: { kind: 'proof-limit', text: '2 domains hinted', limit: DNS_PREFETCH_LIMIT }
    });
  });

  it('a refuted row lends its remnant hints no subtitle', () => {
    expect(dnsCard({ present: false, domains: ['https://a.example/'], source: 'meta' })).toEqual({
      id: 'dns_prefetch',
      name: 'Prefetch DNS Requests',
      status: 'not-active',
      source: 'meta'
    });
  });

  it('an undecided row on a WP Rocket page reads unknown with its why, hints alone asserting nothing', () => {
    const item = buildStatusItems(
      makeData({
        wprDetections: fullDetections({
          wpr: {
            present: true,
            cacheMarkerFound: true,
            cached: false,
            version: null,
            timeStamp: null
          },
          dns_prefetch: { present: false, domains: ['https://a.example/'] }
        })
      })
    ).find((entry) => entry.id === 'dns_prefetch');
    expect(item?.status).toBe('unknown');
    expect(item?.subtitle).toBeUndefined();
  });
});

describe('buildStatusItems — the declared-only sentence', () => {
  /** One card over a page carrying the given rows. */
  const card = (id: string, overrides: Partial<WprDetections>) =>
    buildStatusItems(makeData({ wprDetections: fullDetections(overrides) })).find(
      (item) => item.id === id
    );

  it('a declared row with nothing on the page: active, meta, the capitalized sentence', () => {
    expect(
      card('lazyload_iframes', {
        lazyload_iframes: { present: true, replaceImage: false, source: 'meta', targets: false }
      })
    ).toEqual({
      id: 'lazyload_iframes',
      name: 'LazyLoad for iframes/videos',
      status: 'active',
      source: 'meta',
      declaredOnly: 'Declared on this render, but no iframe or video on this page is lazy-loaded.'
    });
  });

  it('a declared row with targets, and a footprint row, carry no sentence', () => {
    expect(
      card('minify_js', { minify_js: { present: true, source: 'meta', targets: true } })
    ).not.toHaveProperty('declaredOnly');
    expect(
      card('delay_js', {
        delay_js: {
          present: true,
          scripts: [],
          version: null,
          delayedScripts: 0,
          source: 'footprint'
        }
      })
    ).not.toHaveProperty('declaredOnly');
  });

  it('DNS prefetch declared with no hint: the sentence replaces the hints subtitle and limit', () => {
    expect(
      card('dns_prefetch', { dns_prefetch: { present: true, domains: [], source: 'meta' } })
    ).toEqual({
      id: 'dns_prefetch',
      name: 'Prefetch DNS Requests',
      status: 'active',
      source: 'meta',
      declaredOnly:
        'Declared on this render, but no dns-prefetch hint on this page names another host.'
    });
  });
});

describe('buildStatusItems — the Optimize Critical Images lifecycle subtitle', () => {
  it('applied features count their evidence coarsely (9+ past nine)', () => {
    const twelve = buildStatusItems(
      makeData({
        wprDetections: fullDetections({
          rocket_above_the_fold_optimization: {
            present: true,
            lcpComment: false,
            preloadedImages: Array.from({ length: 12 }, (_, i) => `/img-${String(i)}.webp`)
          }
        })
      })
    );
    expect(twelve.find((item) => item.id === 'rocket_above_the_fold_optimization')).toEqual({
      id: 'rocket_above_the_fold_optimization',
      name: 'Optimize Critical Images',
      status: 'active',
      subtitle: 'Preloaded images detected: 9+',
      detail: { kind: 'preloaded-images', count: 12 }
    });
    const three = buildStatusItems(
      makeData({
        wprDetections: fullDetections({
          rocket_above_the_fold_optimization: {
            present: true,
            lcpComment: false,
            preloadedImages: ['/a.webp', '/b.webp', '/c.webp']
          }
        })
      })
    );
    expect(three.find((item) => item.id === 'rocket_above_the_fold_optimization')?.subtitle).toBe(
      'Preloaded images detected: 3'
    );
  });

  /** The critical-images card for one beacon row. */
  const ociCard = (beacon: WprDetections['priority_elements_beacon']) =>
    buildStatusItems(
      makeData({ wprDetections: fullDetections({ priority_elements_beacon: beacon }) })
    ).find((item) => item.id === 'rocket_above_the_fold_optimization');

  it('collecting phase: the verdict + why speak, the beacon lends no subtitle', () => {
    // The config allows the feature, nothing is applied yet: the report's
    // family composition says "collecting"; the why is the one explanation.
    const card = ociCard({ present: true, status: { atf: true }, isMobile: null });
    expect(card).toEqual({
      id: 'rocket_above_the_fold_optimization',
      name: 'Optimize Critical Images',
      status: 'collecting',
      why: 'Enabled, not yet applied on this page.'
    });
  });

  it('a beacon config without the feature reads not active with nothing contradicting it', () => {
    // Another family feature is collecting; this one's context was withheld.
    const card = ociCard({ present: true, status: { lrc: true }, isMobile: null });
    expect(card).toEqual({
      id: 'rocket_above_the_fold_optimization',
      name: 'Optimize Critical Images',
      status: 'not-active'
    });
  });

  it('beacon present without a readable config: not active, no collecting claim', () => {
    const card = ociCard({ present: true, status: null, isMobile: null });
    expect(card).toEqual({
      id: 'rocket_above_the_fold_optimization',
      name: 'Optimize Critical Images',
      status: 'not-active'
    });
  });

  it('a meta-refuted render with remnant preloads states no count (nothing asserted)', () => {
    const items = buildStatusItems(
      makeData({
        wprDetections: fullDetections({
          rocket_above_the_fold_optimization: {
            present: false,
            source: 'meta',
            lcpComment: false,
            preloadedImages: ['/a.webp']
          }
        })
      })
    );
    expect(items.find((item) => item.id === 'rocket_above_the_fold_optimization')).toEqual({
      id: 'rocket_above_the_fold_optimization',
      name: 'Optimize Critical Images',
      status: 'not-active',
      source: 'meta'
    });
  });

  it('neither applied nor collecting: no subtitle is invented', () => {
    const items = buildStatusItems(makeData());
    const card = items.find((item) => item.id === 'rocket_above_the_fold_optimization');
    expect(card?.subtitle).toBeUndefined();
    expect(card?.status).toBe('not-active');
  });
});

describe('buildStatusItems — keying and coverage', () => {
  it('cards are keyed by detection id / derived ids — no indexes, no magic numbers', () => {
    const items = buildStatusItems(makeData({ pageHeaders: [{ name: 'Server', value: 'nginx' }] }));
    // HUD order after the identity row; the beacon (not a feature) last.
    expect(items.map((item) => item.id)).toEqual([
      'server',
      'wpr',
      'remove_unused_css',
      'delay_js',
      'defer_all_js',
      'minify_css',
      'minify_js',
      'minify_concatenate_js',
      'lazyload',
      'lazyload_iframes',
      'lazyload_css_bg_img',
      'image_dimensions',
      'self_hosted_fonts',
      'preload_links',
      'dns_prefetch',
      'rocket_cdn',
      'rocket_above_the_fold_optimization',
      'automatic_lazy_rendering',
      'auto_preload_fonts',
      'preconnect_external_domains',
      'mobile_cache',
      'priority_elements_beacon'
    ]);
  });

  it('feature cards are named by the HUD registry, one name per feature everywhere', () => {
    const items = buildStatusItems(makeData());
    for (const feature of HUD_FEATURES) {
      if (feature.row === 'async_css' || feature.row === 'remove_unused_css') continue;
      expect(items.find((item) => item.id === feature.row)?.name).toBe(feature.label);
    }
  });

  it('the plugin-native label fall-back covers the family rows (never a raw id)', () => {
    const items = buildStatusItems(makeData());
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get('automatic_lazy_rendering')?.name).toBe('Automatic Lazy Rendering');
    expect(byId.get('preconnect_external_domains')?.name).toBe('Preconnect to External Domains');
    expect(byId.get('priority_elements_beacon')?.name).toBe('Priority Elements beacon');
  });

  it('an out-of-contract extra row is carded via the raw-id fallback (futures tolerance)', () => {
    // A payload the boundary validator would reject (it rebuilds the exact
    // 22-row record) is still admitted by the view model's own contract: the
    // card set enumerates the record's OWN keys, so a row the name vocabulary
    // does not know yet joins the set — named by its raw id, at its declaring
    // position — instead of being dropped. Pinned here so the fallback reads
    // as the deliberate futures-tolerance design it is, never as a bug.
    const withUnknown = {
      ...fullDetections(),
      future_feature: { present: true }
    } as unknown as WprDetections;
    const items = buildStatusItems(makeData({ wprDetections: withUnknown }));
    expect(items.at(-1)).toEqual({
      id: 'future_feature',
      name: 'future_feature',
      status: 'active'
    });
  });
});

describe('buildStatusItems — evidence source and unsure-state why (HUD readings)', () => {
  const present = (source?: 'meta' | 'footprint') =>
    makeData({
      wprDetections: fullDetections({
        wpr: {
          present: true,
          cacheMarkerFound: true,
          cached: false,
          version: '3.23',
          timeStamp: null
        },
        minify_css: { present: true, ...(source === undefined ? {} : { source }) }
      })
    });

  it.each([
    ['meta', 'meta'],
    ['footprint', 'footprint']
  ] as const)('a %s-decided row carries source %s', (source, expected) => {
    expect(buildStatusItems(present(source)).find((item) => item.id === 'minify_css')).toEqual({
      id: 'minify_css',
      name: 'Minify CSS files',
      status: 'active',
      source: expected
    });
  });

  it('an undecided row carries no source field (never an own undefined)', () => {
    const card = buildStatusItems(present()).find((item) => item.id === 'minify_css');
    expect(card).toBeDefined();
    expect(Object.hasOwn(card ?? {}, 'source')).toBe(false);
    expect(Object.hasOwn(card ?? {}, 'why')).toBe(false);
  });

  it.each(['image_dimensions', 'self_hosted_fonts'] as const)(
    'undecided %s on a WP Rocket page reads unknown with its why',
    (row) => {
      const card = buildStatusItems(present()).find((item) => item.id === row);
      expect(card?.status).toBe('unknown');
      expect(card?.why).toMatch(/^No generator meta declaration decided it/);
      expect(card?.why).toMatch(/so its state is unknown\.$/);
    }
  );

  it.each(['image_dimensions', 'self_hosted_fonts'] as const)(
    'meta-refuted %s reads not active (a declaration decided it)',
    (row) => {
      const data = present();
      const detections = { ...data.wprDetections, [row]: { present: false, source: 'meta' } };
      const card = buildStatusItems({ ...data, wprDetections: detections }).find(
        (item) => item.id === row
      );
      expect(card).toMatchObject({ status: 'not-active', source: 'meta' });
      expect(card?.why).toBeUndefined();
    }
  );

  it('undecided rows on a plugin-absent page stay not active (no unknown claim)', () => {
    const items = buildStatusItems(makeData());
    expect(items.find((item) => item.id === 'image_dimensions')?.status).toBe('not-active');
    expect(items.find((item) => item.id === 'self_hosted_fonts')?.status).toBe('not-active');
  });

  it('the merged card carries the Meta chip when the meta refuted both rows', () => {
    const items = buildStatusItems(
      makeData({
        wprDetections: fullDetections({
          remove_unused_css: { present: false, source: 'meta' },
          async_css: { present: false, criticalStyle: false, source: 'meta' }
        })
      })
    );
    expect(items.find((item) => item.id === 'remove_unused_css')).toEqual({
      id: 'remove_unused_css',
      name: 'Optimize CSS delivery',
      status: 'not-active',
      source: 'meta'
    });
  });

  it("the RUCSS/async merge card carries the shown row's source", () => {
    const items = buildStatusItems(
      makeData({
        wprDetections: fullDetections({
          remove_unused_css: { present: false, source: 'meta' },
          async_css: { present: true, criticalStyle: false, source: 'footprint' }
        })
      })
    );
    expect(items.find((item) => item.id === 'remove_unused_css')).toMatchObject({
      name: 'Load CSS asynchronously',
      source: 'footprint'
    });
  });

  it('a collecting family card stays out of the active count (status is not active)', () => {
    const items = buildStatusItems(
      makeData({
        wprDetections: fullDetections({
          automatic_lazy_rendering: {
            present: false,
            lazyRenderElements: 0,
            inlineCssPresent: false,
            locationHashes: 3
          }
        })
      })
    );
    expect(items.find((item) => item.id === 'automatic_lazy_rendering')?.status).toBe('collecting');
  });
});
