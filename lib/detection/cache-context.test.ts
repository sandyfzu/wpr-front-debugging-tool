/**
 * The cache vocabulary's evidence matrix: every arm explicit, absence never
 * rendering a verdict, the hosting markers read only from their own headers,
 * and the chip/tooltip/report copy coming from one source.
 */
import { describe, expect, it } from 'vitest';
import type { FdtData, PageHeader, WprDetections } from '../wp-rocket/types';
import {
  CACHE_NOT_APPLICABLE_REPORT,
  cacheCopy,
  cacheStateForPage,
  cacheStateFromCapture,
  cacheStateFromFdtData,
  cacheLayerCopy,
  cacheLayerHint,
  servedCacheLayer
} from './cache-context';
import type { CacheState } from './cache-context';
import type { CacheStateInput } from './cache-context';

/** A `wpr` row with the given overrides (all-absent by default). */
function wpr(overrides: Partial<WprDetections['wpr']> = {}): WprDetections['wpr'] {
  return {
    present: true,
    cacheMarkerFound: false,
    cached: false,
    version: null,
    timeStamp: null,
    ...overrides
  };
}

/** The cache answer for one input, with sensible defaults. */
function state(overrides: Partial<CacheStateInput> = {}) {
  return cacheStateForPage({
    wpr: wpr(),
    headers: null,
    bypassAttested: false,
    ...overrides
  });
}

/** A single-row captured header set. */
function headers(name: string, value?: string): PageHeader[] {
  return [value === undefined ? { name } : { name, value }];
}

describe('cacheStateForPage — the plugin evidence', () => {
  it('the served debug stamp is cached, with its representable UTC form', () => {
    expect(
      state({ wpr: wpr({ cacheMarkerFound: true, cached: true, timeStamp: 1_730_000_000 }) })
    ).toEqual({
      kind: 'cached',
      seconds: 1_730_000_000,
      formatted: '2024-10-27 03:33:20 UTC'
    });
    expect(state({ wpr: wpr({ cacheMarkerFound: true, cached: true, timeStamp: null }) })).toEqual({
      kind: 'cached',
      seconds: null,
      formatted: null
    });
  });

  it('normalizes an unrepresentable stamp to an unstamped cache', () => {
    for (const timeStamp of [9_999_999_999_999, 1e26, -5, 1.5, 253_402_300_800]) {
      expect(
        state({ wpr: wpr({ cacheMarkerFound: true, cached: true, timeStamp }) }),
        String(timeStamp)
      ).toEqual({ kind: 'cached', seconds: null, formatted: null });
    }
    // The display domain's last instant is exact.
    expect(
      state({
        wpr: wpr({ cacheMarkerFound: true, cached: true, timeStamp: 253_402_300_799 })
      })
    ).toEqual({
      kind: 'cached',
      seconds: 253_402_300_799,
      formatted: '9999-12-31 23:59:59 UTC'
    });
  });

  it('a signature without the debug stamp is never folded into "not cached"', () => {
    expect(state({ wpr: wpr({ cacheMarkerFound: true }) })).toEqual({
      kind: 'uncertain-signature'
    });
  });
});

describe('cacheStateForPage — header capture arms', () => {
  it('no capture proves nothing (unavailable), including an empty list', () => {
    expect(state({ headers: null })).toEqual({ kind: 'not-detected', headers: 'unavailable' });
    expect(state({ headers: [] })).toEqual({ kind: 'not-detected', headers: 'unavailable' });
  });

  it('a complete capture without a served marker is a real negative', () => {
    expect(state({ headers: headers('server', 'nginx') })).toEqual({
      kind: 'not-detected',
      headers: 'captured'
    });
  });

  it('a truncated capture may hide a marker', () => {
    expect(state({ headers: headers('server', 'nginx'), truncated: true })).toEqual({
      kind: 'not-detected',
      headers: 'truncated'
    });
    // A served marker is still evidence even beside truncation.
    expect(state({ headers: headers('sg-f-cache', 'HIT'), truncated: true })).toEqual({
      kind: 'possibly-cached',
      evidence: 'SiteGround'
    });
  });

  it('a withheld known marker is redacted; another served marker still wins', () => {
    expect(state({ headers: [{ name: 'cf-cache-status', redacted: true }] })).toEqual({
      kind: 'not-detected',
      headers: 'redacted'
    });
    expect(
      state({
        headers: [
          { name: 'cf-cache-status', redacted: true },
          { name: 'sg-f-cache', value: 'HIT' }
        ]
      })
    ).toEqual({ kind: 'possibly-cached', evidence: 'SiteGround' });
    // A redacted row outranks mere truncation (the value existed and was withheld).
    expect(state({ headers: [{ name: 'sg-f-cache', redacted: true }], truncated: true })).toEqual({
      kind: 'not-detected',
      headers: 'redacted'
    });
    // The last duplicate row is the capture's answer: a withheld last hop is
    // not resurrected by an earlier value of the same marker.
    expect(
      state({
        headers: [
          { name: 'sg-f-cache', value: 'HIT' },
          { name: 'sg-f-cache', redacted: true }
        ]
      })
    ).toEqual({ kind: 'not-detected', headers: 'redacted' });
  });
});

describe('cacheStateForPage — verified hosting markers', () => {
  it('SiteGround serves only on sg-f-cache: HIT (case-insensitive, trimmed)', () => {
    for (const value of ['HIT', 'hit', ' HIT ']) {
      expect(state({ headers: headers('sg-f-cache', value) }), value).toEqual({
        kind: 'possibly-cached',
        evidence: 'SiteGround'
      });
    }
    for (const value of ['MISS', 'BYPASS', 'EXPIRED', 'UPDATING', '']) {
      expect(state({ headers: headers('sg-f-cache', value) }), value).toEqual({
        kind: 'not-detected',
        headers: 'captured'
      });
    }
    // The old generic optimizer header is not a cache marker at all.
    expect(state({ headers: headers('x-sg-optimizer', 'on') })).toEqual({
      kind: 'not-detected',
      headers: 'captured'
    });
  });

  it('Cloudflare serves on HIT/STALE/REVALIDATED/UPDATING only', () => {
    for (const value of ['HIT', 'hit', 'STALE', 'REVALIDATED', 'UPDATING', ' hit ']) {
      expect(state({ headers: headers('cf-cache-status', value) }), value).toEqual({
        kind: 'possibly-cached',
        evidence: 'Cloudflare'
      });
    }
    for (const value of [
      'EXPIRED',
      'MISS',
      'DYNAMIC',
      'BYPASS',
      'NONE',
      'UNKNOWN',
      'revalidated-from-origin',
      ''
    ]) {
      expect(state({ headers: headers('cf-cache-status', value) }), value).toEqual({
        kind: 'not-detected',
        headers: 'captured'
      });
    }
  });

  it('every vocabulary layer with a served status names itself; identity markers never serve', () => {
    for (const [name, value, evidence] of [
      ['x-litespeed-cache', 'hit', 'LiteSpeed'],
      ['x-sucuri-cache', 'HIT', 'Sucuri'],
      ['x-varnish', '32770 3', 'Varnish'],
      ['x-proxy-cache', 'HIT', 'host proxy']
    ] as const) {
      expect(state({ headers: headers(name, value) }), name).toEqual({
        kind: 'possibly-cached',
        evidence
      });
    }
    for (const [name, value] of [
      ['x-litespeed-cache', 'miss'],
      ['x-sucuri-cache', 'MISS'],
      ['x-varnish', '32770'],
      ['x-proxy-cache', 'BYPASS'],
      ['cf-ray', '230b030023ae2822-SJC'],
      ['x-sucuri-id', '14018'],
      // Generic caching evidence names no layer: never a host-layer verdict.
      ['x-cache', 'HIT'],
      ['age', '120']
    ] as const) {
      expect(state({ headers: headers(name, value) }), name).toEqual({
        kind: 'not-detected',
        headers: 'captured'
      });
    }
  });

  it('a withheld status of any vocabulary layer reads redacted', () => {
    expect(state({ headers: [{ name: 'x-varnish', redacted: true }] })).toEqual({
      kind: 'not-detected',
      headers: 'redacted'
    });
  });

  it('reads header names case-insensitively and the last duplicate row', () => {
    expect(
      state({
        headers: [
          { name: 'CF-Cache-Status', value: 'HIT' },
          { name: 'cf-cache-status', value: 'MISS' }
        ]
      })
    ).toEqual({ kind: 'not-detected', headers: 'captured' });
    expect(
      state({
        headers: [
          { name: 'sg-f-cache', value: 'MISS' },
          { name: 'SG-F-Cache', value: 'HIT' }
        ]
      })
    ).toEqual({ kind: 'possibly-cached', evidence: 'SiteGround' });
  });
});

describe('cacheStateForPage — bypass precedence', () => {
  it('a captured host serve outranks the bypass, which rides along', () => {
    for (const [name, value, evidence] of [
      ['sg-f-cache', 'HIT', 'SiteGround'],
      ['cf-cache-status', 'HIT', 'Cloudflare']
    ] as const) {
      expect(state({ headers: headers(name, value), bypassAttested: true })).toEqual({
        kind: 'possibly-cached',
        evidence,
        bypassAttested: true
      });
    }
    // An explicit non-serve does not outrank the bypass.
    expect(state({ headers: headers('cf-cache-status', 'EXPIRED'), bypassAttested: true })).toEqual(
      { kind: 'bypass-requested' }
    );
  });

  it('the bypass is named as a request, never a cache verdict', () => {
    expect(state({ bypassAttested: true })).toEqual({ kind: 'bypass-requested' });
    expect(state({ headers: [], bypassAttested: true })).toEqual({ kind: 'bypass-requested' });
    expect(state({ headers: headers('server', 'nginx'), bypassAttested: true })).toEqual({
      kind: 'bypass-requested'
    });
    // A signature still outranks it: a bypassed URL cannot carry a served stamp.
    expect(
      state({ wpr: wpr({ cacheMarkerFound: true, cached: true }), bypassAttested: true })
    ).toMatchObject({ kind: 'cached' });
    expect(state({ wpr: wpr({ cacheMarkerFound: true }), bypassAttested: true })).toEqual({
      kind: 'uncertain-signature'
    });
  });
});

describe('cacheStateFromCapture', () => {
  it('carries null/empty/truncated captures and the bypass into the answer', () => {
    expect(cacheStateFromCapture(wpr(), null, false)).toEqual({
      kind: 'not-detected',
      headers: 'unavailable'
    });
    expect(cacheStateFromCapture(wpr(), { headers: [] }, false)).toEqual({
      kind: 'not-detected',
      headers: 'unavailable'
    });
    expect(
      cacheStateFromCapture(
        wpr(),
        { headers: [{ name: 'server', value: 'nginx' }], truncated: true },
        false
      )
    ).toEqual({ kind: 'not-detected', headers: 'truncated' });
    expect(cacheStateFromCapture(wpr(), null, true)).toEqual({ kind: 'bypass-requested' });
    expect(
      cacheStateFromCapture(wpr(), { headers: [{ name: 'cf-cache-status', value: 'HIT' }] }, true)
    ).toEqual({ kind: 'possibly-cached', evidence: 'Cloudflare', bypassAttested: true });
  });
});

describe('cacheStateFromFdtData', () => {
  it('answers nothing when the plugin is absent', () => {
    const data = {
      wprDetections: { wpr: wpr({ present: false }) }
    } as unknown as FdtData;
    expect(cacheStateFromFdtData(data)).toBeNull();
  });

  it('carries the capture truncation and bypass into the answer', () => {
    const data = {
      pageHeaders: [{ name: 'server', value: 'nginx' }],
      pageHeadersTruncated: true,
      bypassAttested: true,
      wprDetections: { wpr: wpr() }
    } as unknown as FdtData;
    expect(cacheStateFromFdtData(data)).toEqual({ kind: 'bypass-requested' });
    const noBypass = { ...data, bypassAttested: undefined } as unknown as FdtData;
    expect(cacheStateFromFdtData(noBypass)).toEqual({
      kind: 'not-detected',
      headers: 'truncated'
    });
  });
});

describe('cacheCopy — one copy source', () => {
  const cases: Array<[string, Parameters<typeof cacheCopy>[0], string, string, string]> = [
    [
      'cached, stamped',
      { kind: 'cached', seconds: 1_730_000_000, formatted: '2024-10-27 03:33:20 UTC' },
      '✓ Cached',
      "The page is served from WP Rocket's cache generated 2024-10-27 03:33:20 UTC.",
      'Cached, generated 2024-10-27 03:33:20 UTC'
    ],
    [
      'cached, unstamped',
      { kind: 'cached', seconds: null, formatted: null },
      '✓ Cached',
      "The page is served from WP Rocket's cache (no usable generation stamp was carried).",
      'Cached (generation time not available)'
    ],
    [
      'uncertain',
      { kind: 'uncertain-signature' },
      'Cache not proven',
      "WP Rocket's cache signature is on the served HTML, but the debug stamp is absent — the plugin handled the page; this visit's cache state is not proven.",
      'Plugin fingerprint found, cache not proven for this visit'
    ],
    [
      'possibly',
      { kind: 'possibly-cached', evidence: 'Cloudflare' },
      'Possibly cached',
      "A Cloudflare cache-layer marker was captured, but WP Rocket's cache signature was not found on the served HTML. The page may be served from that cache.",
      'Possibly cached (Cloudflare cache-layer marker; no WP Rocket signature)'
    ],
    [
      'possibly + bypass',
      { kind: 'possibly-cached', evidence: 'SiteGround', bypassAttested: true },
      'Possibly cached',
      "A SiteGround cache-layer marker was captured, but WP Rocket's cache signature was not found on the served HTML. The page may be served from that cache. A WP Rocket cache bypass was requested for this visit.",
      'Possibly cached (SiteGround cache-layer marker; no WP Rocket signature; cache bypass requested)'
    ],
    [
      'possibly cached (generic host proxy)',
      { kind: 'possibly-cached', evidence: 'host proxy' },
      'Possibly cached',
      "A host proxy cache-layer marker was captured, but WP Rocket's cache signature was not found on the served HTML. The page may be served from that cache.",
      'Possibly cached (host proxy cache-layer marker; no WP Rocket signature)'
    ],
    [
      'not detected (unavailable)',
      { kind: 'not-detected', headers: 'unavailable' },
      'Cache not detected',
      'No WP Rocket cache signature was found. Response headers were not captured, so hosting cache markers could not be checked.',
      'Cache not detected (response headers unavailable)'
    ],
    [
      'not detected (captured)',
      { kind: 'not-detected', headers: 'captured' },
      'Cache not detected',
      'No WP Rocket cache signature was found, and no captured hosting cache marker showed that a cache served this response.',
      'Cache not detected'
    ],
    [
      'not detected (truncated)',
      { kind: 'not-detected', headers: 'truncated' },
      'Cache not detected',
      'No WP Rocket cache signature was found. The header capture was incomplete (truncated), so a hosting cache marker may not have been seen.',
      'Cache not detected (header capture truncated)'
    ],
    [
      'not detected (redacted)',
      { kind: 'not-detected', headers: 'redacted' },
      'Cache not detected',
      'No WP Rocket cache signature was found. A hosting cache header was captured with its value withheld, so cache use is not proven.',
      'Cache not detected (cache header value withheld)'
    ],
    [
      'bypass requested',
      { kind: 'bypass-requested' },
      'Bypass requested',
      "The URL carries WP Rocket's cache-bypass parameter (nowprocket) and no WP Rocket signature was found, so this visit's cache state is not proven: WP Rocket still serves a stored copy when the URL also carries a query string the site caches. Host and CDN caches are separate layers.",
      'Cache bypass requested (nowprocket; no WP Rocket signature; cache state not proven)'
    ]
  ];

  for (const [name, value, chip, tooltip, report] of cases) {
    it(`${name}: exact chip, tooltip and report`, () => {
      expect(cacheCopy(value)).toEqual({ chip, tooltip, report });
    });
  }

  it('exposes the not-applicable report for a page the plugin did not handle', () => {
    expect(CACHE_NOT_APPLICABLE_REPORT).toBe('Not applicable (WP Rocket not detected)');
  });
});

describe('servedCacheLayer — the hosting layer that served the response', () => {
  it.each([
    ['nothing captured', null, null],
    ['an empty capture', [], null],
    ['a Cloudflare HIT', [{ name: 'CF-Cache-Status', value: 'HIT' }], 'Cloudflare'],
    ['a Cloudflare MISS (not a serve)', [{ name: 'cf-cache-status', value: 'MISS' }], null],
    ['a SiteGround HIT', [{ name: 'sg-f-cache', value: 'HIT' }], 'SiteGround'],
    ['a withheld marker value', [{ name: 'sg-f-cache', redacted: true as const }], null],
    ['the generic proxy header', [{ name: 'x-proxy-cache', value: 'HIT' }], 'host proxy']
  ] as const)('%s → %s', (_name, headers, expected) => {
    expect(servedCacheLayer(headers as readonly PageHeader[] | null)).toBe(expected);
  });

  it('is independent of the WP Rocket state (a cached page still names its layer)', () => {
    const headers: PageHeader[] = [{ name: 'cf-cache-status', value: 'STALE' }];
    expect(
      cacheStateForPage({ wpr: wpr({ cached: true }), headers, bypassAttested: false }).kind
    ).toBe('cached');
    expect(servedCacheLayer(headers)).toBe('Cloudflare');
  });

  it('names the layer in both renderings', () => {
    const copy = cacheLayerCopy('SiteGround');
    expect(copy.fact).toBe('SiteGround cache-layer marker captured');
    expect(copy.report.startsWith(`${copy.fact} (`)).toBe(true);
    expect(copy.report).toContain("may not have reached WP Rocket's cache");
  });

  it('starts a lowercase layer name with a capital in both renderings', () => {
    const copy = cacheLayerCopy('host proxy');
    expect(copy.fact).toBe('Host proxy cache-layer marker captured');
    expect(copy.report.startsWith('Host proxy cache-layer marker captured (')).toBe(true);
  });
});

describe('cacheLayerHint — every cache state', () => {
  const served: PageHeader[] = [{ name: 'cf-cache-status', value: 'HIT' }];
  it.each([
    [{ kind: 'cached', seconds: 1, formatted: 'x' }, null],
    [{ kind: 'possibly-cached', evidence: 'Cloudflare' }, null],
    [{ kind: 'possibly-cached', evidence: 'Cloudflare', bypassAttested: true }, null],
    [{ kind: 'uncertain-signature' }, 'Cloudflare'],
    [{ kind: 'not-detected', headers: 'captured' }, 'Cloudflare'],
    [{ kind: 'bypass-requested' }, 'Cloudflare']
  ] as [CacheState, string | null][])('%o with a served marker → %s', (state, expected) => {
    expect(cacheLayerHint(state, served)).toBe(expected);
  });

  it('names nothing when no served marker was captured, in any state', () => {
    expect(cacheLayerHint({ kind: 'uncertain-signature' }, null)).toBeNull();
    expect(
      cacheLayerHint({ kind: 'uncertain-signature' }, [{ name: 'cf-cache-status', value: 'MISS' }])
    ).toBeNull();
  });
});
