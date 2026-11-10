/**
 * The host-layer vocabulary: every documented value of every marker (its
 * reading pinned per vendor source), undocumented values left unread, the
 * served-layer scan (precedence, last hop, withheld, identity markers never
 * a serve) and the captured-layers list the Host layers card renders.
 *
 * Sources per marker (verified 2026-11-10):
 * - `sg-f-cache`: SiteGround's own Speed Optimizer plugin 7.8.6
 *   (`core/File_Cacher/Cache.php`, `File_Cacher.php`: HIT / MISS / BYPASS),
 *   https://wordpress.org/plugins/sg-cachepress/
 * - `cf-cache-status`: https://developers.cloudflare.com/cache/concepts/cache-responses/
 * - `cf-ray`: https://developers.cloudflare.com/fundamentals/reference/http-headers/
 * - `x-litespeed-cache`: https://docs.litespeedtech.com/lscache/start/ (hit/miss),
 *   https://docs.litespeedtech.com/lscache/litemage/troubleshoot/ (`hit,litemage`)
 * - `x-sucuri-cache`, `x-sucuri-id`:
 *   https://docs.sucuri.net/website-firewall/troubleshooting/investigating-cache-headers/
 * - `x-varnish`: varnish-cache `bin/varnishd/cache/cache_req_fsm.c` (`%ju %ju` when
 *   `req->is_hit`, otherwise `%ju`; `cnt_lookup` sets `is_hit` on deliver and on a
 *   `vcl_hit` pass, which then fetches from the backend — a hit lookup, not a serve),
 *   https://github.com/varnishcache/varnish-cache
 * - `x-proxy-cache`: https://www.siteground.com/kb/siteground-dynamic-caching-configuration/
 *   (HIT / MISS / BYPASS; a generic name other hosts' proxies send too); the value is
 *   conventionally nginx's `$upstream_cache_status`, whose documented set adds
 *   EXPIRED / STALE / UPDATING / REVALIDATED:
 *   https://nginx.org/en/docs/http/ngx_http_upstream_module.html#var_upstream_cache_status
 */
import { describe, expect, it } from 'vitest';
import {
  capturedHostLayers,
  HOST_LAYER_ADD_ON_CAVEAT,
  HOST_LAYERS,
  hostLayerMarker,
  IDENTITY_FORM,
  scanServedLayer,
  type MarkerReading
} from './host-layers';
import type { PageHeaders } from '../wp-rocket/types';

/** header, value, expected reading (null = not a documented form). */
const VALUES: readonly (readonly [string, string, MarkerReading | null])[] = [
  ['sg-f-cache', 'HIT', 'served'],
  ['sg-f-cache', 'MISS', 'not-served'],
  ['sg-f-cache', 'BYPASS', 'not-served'],
  ['sg-f-cache', 'hit', 'served'],
  ['sg-f-cache', 'STALE', null],
  ['cf-cache-status', 'HIT', 'served'],
  ['cf-cache-status', 'STALE', 'served'],
  ['cf-cache-status', 'REVALIDATED', 'served'],
  ['cf-cache-status', 'UPDATING', 'served'],
  ['cf-cache-status', 'EXPIRED', 'not-served'],
  ['cf-cache-status', 'MISS', 'not-served'],
  ['cf-cache-status', 'DYNAMIC', 'not-served'],
  ['cf-cache-status', 'BYPASS', 'not-served'],
  ['cf-cache-status', 'NONE', 'not-served'],
  ['cf-cache-status', 'UNKNOWN', 'not-served'],
  ['cf-cache-status', 'miss', 'not-served'],
  ['cf-cache-status', 'HIT-ish', null],
  ['cf-ray', '230b030023ae2822-SJC', 'present'],
  ['cf-ray', '', 'present'],
  ['x-litespeed-cache', 'hit', 'served'],
  ['x-litespeed-cache', 'hit,litemage', 'served'],
  ['x-litespeed-cache', 'miss', 'not-served'],
  ['x-litespeed-cache', 'HIT', 'served'],
  ['x-litespeed-cache', 'bkd', null],
  ['x-litespeed-cache', 'mishit', null],
  ['x-sucuri-cache', 'HIT', 'served'],
  ['x-sucuri-cache', 'STALE', 'served'],
  ['x-sucuri-cache', 'UPDATING', 'served'],
  ['x-sucuri-cache', 'REVALIDATED', 'served'],
  ['x-sucuri-cache', 'MISS', 'not-served'],
  ['x-sucuri-cache', 'EXPIRED', 'not-served'],
  ['x-sucuri-cache', 'BYPASS', 'not-served'],
  ['x-sucuri-cache', 'DYNAMIC', null],
  ['x-sucuri-id', '14018', 'present'],
  ['x-varnish', '32770 3', 'served'],
  ['x-varnish', '32770', 'not-served'],
  ['x-varnish', '32770 3, 99', null],
  ['x-varnish', 'abc', null],
  ['x-varnish', '1  2', null],
  ['x-proxy-cache', 'HIT', 'served'],
  ['x-proxy-cache', 'MISS', 'not-served'],
  ['x-proxy-cache', 'BYPASS', 'not-served'],
  ['x-proxy-cache', 'STALE', 'served'],
  ['x-proxy-cache', 'UPDATING', 'served'],
  ['x-proxy-cache', 'REVALIDATED', 'served'],
  ['x-proxy-cache', 'EXPIRED', 'not-served'],
  ['x-proxy-cache', 'revalidated', 'served'],
  ['x-proxy-cache', 'DYNAMIC', null]
];

describe('HOST_LAYERS — every documented value', () => {
  it.each(VALUES)('%s: %s → %s', (header, value, expected) => {
    const entry = hostLayerMarker(header);
    if (entry === undefined) throw new Error(`${header} is not in the vocabulary`);
    expect(entry.marker.read(value)?.reading ?? null).toBe(expected);
  });

  it('header names are lowercase and unique across the table', () => {
    const names = HOST_LAYERS.flatMap((layer) => layer.markers.map((marker) => marker.header));
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toBe(name.toLowerCase());
  });

  it('looks a marker up by any casing, and nothing else', () => {
    expect(hostLayerMarker('CF-Cache-Status')?.layer.id).toBe('cloudflare');
    expect(hostLayerMarker('x-cache')).toBeUndefined();
    expect(hostLayerMarker('age')).toBeUndefined();
  });

  it('identity markers never claim a cache status', () => {
    for (const header of ['cf-ray', 'x-sucuri-id']) {
      expect(hostLayerMarker(header)?.marker.cacheStatus).toBe(false);
    }
  });

  it('the generic proxy header is its own layer, never SiteGround', () => {
    const entry = hostLayerMarker('x-proxy-cache');
    expect(entry?.layer.id).toBe('host-proxy');
    expect(JSON.stringify(entry?.layer)).not.toContain('SiteGround');
  });

  it('a read names its form, and a marker serves only when some form does', () => {
    expect(hostLayerMarker('x-varnish')?.marker.read('1 2')).toEqual({
      reading: 'served',
      form: 'HIT'
    });
    expect(hostLayerMarker('cf-ray')?.marker.read('abc')).toEqual({
      reading: 'present',
      form: IDENTITY_FORM
    });
    expect(hostLayerMarker('sg-f-cache')?.marker.cacheStatus).toBe(true);
  });
});

describe('scanServedLayer', () => {
  it.each([
    ['an empty capture', [], { kind: 'none' }],
    ['a not-served status', [{ name: 'cf-cache-status', value: 'DYNAMIC' }], { kind: 'none' }],
    ['an identity marker alone', [{ name: 'cf-ray', value: 'abc-SJC' }], { kind: 'none' }],
    ['an unreadable value', [{ name: 'sg-f-cache', value: 'MAYBE' }], { kind: 'none' }],
    ['a valueless row', [{ name: 'sg-f-cache' }], { kind: 'none' }],
    ['a withheld status', [{ name: 'x-sucuri-cache', redacted: true }], { kind: 'withheld' }],
    ['a withheld identity marker', [{ name: 'cf-ray', redacted: true }], { kind: 'none' }]
  ] as const)('%s → %j', (_name, headers, expected) => {
    expect(scanServedLayer(headers as PageHeaders)).toEqual(expected);
  });

  it.each([
    ['sg-f-cache', 'HIT', 'SiteGround'],
    ['cf-cache-status', 'UPDATING', 'Cloudflare'],
    ['x-litespeed-cache', 'hit', 'LiteSpeed'],
    ['x-sucuri-cache', 'REVALIDATED', 'Sucuri'],
    ['x-varnish', '5 3', 'Varnish'],
    ['x-proxy-cache', ' hit ', 'host proxy']
  ])('%s: %s names %s', (name, value, evidence) => {
    const scan = scanServedLayer([{ name, value }]);
    expect(scan.kind === 'served' ? scan.layer.evidence : null).toBe(evidence);
  });

  // An outer cache's stored copy replays the inner layers' stamped headers,
  // so a stacked serve names the outermost layer, whatever the capture order.
  it.each([
    ['Cloudflare over SiteGround', ['sg-f-cache', 'HIT'], ['cf-cache-status', 'HIT'], 'cloudflare'],
    ['Sucuri over LiteSpeed', ['x-litespeed-cache', 'hit'], ['x-sucuri-cache', 'HIT'], 'sucuri'],
    [
      'Cloudflare over Sucuri',
      ['x-sucuri-cache', 'HIT'],
      ['cf-cache-status', 'STALE'],
      'cloudflare'
    ],
    ['Sucuri over Varnish', ['x-varnish', '7 3'], ['x-sucuri-cache', 'REVALIDATED'], 'sucuri'],
    ['Varnish over the host proxy', ['x-proxy-cache', 'HIT'], ['x-varnish', '7 3'], 'varnish'],
    [
      'the host proxy over LiteSpeed',
      ['x-litespeed-cache', 'hit'],
      ['x-proxy-cache', 'HIT'],
      'host-proxy'
    ],
    ['LiteSpeed over SiteGround', ['sg-f-cache', 'HIT'], ['x-litespeed-cache', 'hit'], 'litespeed']
  ] as const)('stacked serve: %s', (_name, inner, outer, expected) => {
    for (const rows of [
      [inner, outer],
      [outer, inner]
    ]) {
      const scan = scanServedLayer(rows.map(([name, value]) => ({ name, value })));
      expect(scan.kind === 'served' ? scan.layer.id : null).toBe(expected);
    }
  });

  it('an outer layer that did not serve leaves the verdict to the inner one', () => {
    const scan = scanServedLayer([
      { name: 'cf-cache-status', value: 'DYNAMIC' },
      { name: 'sg-f-cache', value: 'HIT' }
    ]);
    expect(scan.kind === 'served' ? scan.layer.id : null).toBe('siteground');
  });

  it('the table runs outermost hop first', () => {
    expect(HOST_LAYERS.map((layer) => layer.id)).toEqual([
      'cloudflare',
      'sucuri',
      'varnish',
      'host-proxy',
      'litespeed',
      'siteground'
    ]);
  });

  it('the last duplicate row wins, in both directions', () => {
    expect(
      scanServedLayer([
        { name: 'sg-f-cache', value: 'HIT' },
        { name: 'SG-F-Cache', value: 'MISS' }
      ])
    ).toEqual({ kind: 'none' });
    expect(
      scanServedLayer([
        { name: 'sg-f-cache', value: 'MISS' },
        { name: 'sg-f-cache', value: 'HIT' }
      ]).kind
    ).toBe('served');
  });

  it('a withheld last row never resurrects an earlier value; another layer still wins', () => {
    const withheld: PageHeaders = [
      { name: 'sg-f-cache', value: 'HIT' },
      { name: 'sg-f-cache', redacted: true }
    ];
    expect(scanServedLayer(withheld)).toEqual({ kind: 'withheld' });
    const scan = scanServedLayer([...withheld, { name: 'x-varnish', value: '1 2' }]);
    expect(scan.kind === 'served' ? scan.layer.id : null).toBe('varnish');
  });
});

describe('HOST_LAYER_ADD_ON_CAVEAT', () => {
  it('states that a host layer does not show an add-on state', () => {
    expect(HOST_LAYER_ADD_ON_CAVEAT).toContain('do not show whether');
  });
});

describe('capturedHostLayers', () => {
  it('nothing captured or no marker → no layer (no card)', () => {
    expect(capturedHostLayers(null)).toEqual([]);
    expect(capturedHostLayers([])).toEqual([]);
    expect(
      capturedHostLayers([
        { name: 'x-cache', value: 'HIT' },
        { name: 'age', value: '9' }
      ])
    ).toEqual([]);
  });

  it('lists each layer once, in table order, with its captured header names', () => {
    expect(
      capturedHostLayers([
        { name: 'X-Proxy-Cache', value: 'MISS' },
        { name: 'CF-RAY', value: 'abc-SJC' },
        { name: 'cf-cache-status', value: 'HIT' },
        { name: 'sg-f-cache', value: 'BYPASS' }
      ])
    ).toEqual([
      {
        id: 'cloudflare',
        label: 'Cloudflare',
        reading: 'served',
        headers: ['cf-cache-status', 'CF-RAY']
      },
      {
        id: 'host-proxy',
        label: 'Host proxy cache',
        reading: 'not-served',
        headers: ['X-Proxy-Cache']
      },
      { id: 'siteground', label: 'SiteGround', reading: 'not-served', headers: ['sg-f-cache'] }
    ]);
  });

  it('a status outranks presence; withheld and unreadable rows only show the layer', () => {
    const reading = (headers: PageHeaders): MarkerReading | undefined =>
      capturedHostLayers(headers)[0]?.reading;
    expect(reading([{ name: 'cf-ray', value: 'x' }])).toBe('present');
    expect(
      reading([
        { name: 'cf-ray', value: 'x' },
        { name: 'cf-cache-status', value: 'DYNAMIC' }
      ])
    ).toBe('not-served');
    expect(reading([{ name: 'x-sucuri-cache', redacted: true }])).toBe('present');
    expect(reading([{ name: 'x-varnish', value: 'junk' }])).toBe('present');
    expect(reading([{ name: 'x-varnish' }])).toBe('present');
  });

  it('keeps the last duplicate row of a header (its casing too)', () => {
    expect(
      capturedHostLayers([
        { name: 'x-litespeed-cache', value: 'hit' },
        { name: 'X-LiteSpeed-Cache', value: 'miss' }
      ])
    ).toEqual([
      { id: 'litespeed', label: 'LiteSpeed', reading: 'not-served', headers: ['X-LiteSpeed-Cache'] }
    ]);
  });
});
