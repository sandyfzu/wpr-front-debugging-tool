/**
 * The DNS prefetch row over the real pass, in both engines: the generator
 * meta's token alone decides it (declared / refuted / undecided), and the
 * page's plain `dns-prefetch` hints ride along as corroboration only —
 * WordPress core prints the same hint for every external host it enqueues,
 * so no hint, however many, names WP Rocket.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WprDetections } from '../wp-rocket/types';
import { boundWprDetections, PAYLOAD_LIMITS } from '../messaging/payload-bounds';
import { parseWprDetections } from '../messaging/validate';
import { runReferenceDetection } from './reference/engine';
import { runDetection } from './run-detection';
import { describeDetections } from './describe';
import {
  DNS_PREFETCH_LIMIT,
  dnsPrefetchHintText,
  hudFeatureOf,
  hudStateLine,
  readHudFeature,
  type HudFeature
} from './hud';
import { FIXTURE_DIR } from './fixtures/corpus';

const CACHE_FOOTER = "<!-- This website is like a Rocket, isn't it? -->";

/** A generator meta declaring the given tokens. */
function meta(tokens: string): string {
  return `<meta name="generator" content="WP Rocket 3.24" data-wpr-features="${tokens}">`;
}

/** A plain core hint (single-quoted, scheme-less, as `wp_resource_hints` prints it). */
function hint(href: string): string {
  return `<link rel='dns-prefetch' href='${href}' />`;
}

/** A page around the given head markup, with an optional post-document comment. */
function page(head: string, after = ''): string {
  return `<!doctype html><html><head>${head}</head><body></body></html>${after}`;
}

/** Run both engines, assert they agree, return the port's detections. */
function detect(html: string): WprDetections {
  const port = runDetection(html).detections;
  expect(port).toEqual(runReferenceDetection(html).wprDetections);
  return port;
}

/** A corpus fixture's HTML. */
function fixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf8');
}

/** The DNS prefetch HUD row (fails loudly if the registry lost it). */
function dnsFeature(): HudFeature {
  const feature = hudFeatureOf('dns_prefetch');
  if (feature === undefined) throw new Error('dns_prefetch has no HUD row');
  return feature;
}

/** The row's strip/tooltip line over a pass. */
function stateLine(detections: WprDetections): string {
  const feature = dnsFeature();
  return hudStateLine(feature, readHudFeature(feature, describeDetections(detections), detections));
}

// The test environment resolves scheme-less hrefs against its own origin.
const FONTS = 'http://fonts.googleapis.com/';
const CDN = 'http://cdn.fdt.test/';

/** The test window's URL control (every parsed document takes its URL). */
const { happyDOM } = window as unknown as { happyDOM: { setURL(url: string): void } };

/**
 * Run `body` with the parsed documents on the given page URL, restoring the
 * original afterwards.
 */
function onPage<T>(url: string, body: () => T): T {
  const original = location.href;
  happyDOM.setURL(url);
  try {
    return body();
  } finally {
    happyDOM.setURL(original);
  }
}

describe('the DNS prefetch verdict (both engines)', () => {
  it('the token declares the row, with the plain hints as its domains', () => {
    const d = detect(page(meta('wpr_dns_prefetch') + hint('//fonts.googleapis.com')));
    expect(d.dns_prefetch).toEqual({ present: true, domains: [FONTS], source: 'meta' });
  });

  it('a declared row with no hint keeps an empty list', () => {
    expect(detect(page(meta('wpr_dns_prefetch'))).dns_prefetch).toEqual({
      present: true,
      domains: [],
      source: 'meta'
    });
  });

  it('a usable meta without the token refutes it, the hints kept as inventory', () => {
    const d = detect(page(meta('wpr_delay_js') + hint('//cdn.fdt.test')));
    expect(d.dns_prefetch).toEqual({ present: false, domains: [CDN], source: 'meta' });
  });

  it('hints alone, however many, never assert it: no meta ⇒ undecided, no source', () => {
    const d = detect(page(hint('//fonts.googleapis.com') + hint('//cdn.fdt.test'), CACHE_FOOTER));
    expect(d.wpr.present).toBe(true);
    expect(d.dns_prefetch).toEqual({ present: false, domains: [FONTS, CDN] });
  });

  it('a hint never proves WP Rocket on a page without any other evidence', () => {
    const d = detect(page(hint('//fonts.googleapis.com')));
    expect(d.wpr.present).toBe(false);
    expect(d.dns_prefetch.present).toBe(false);
  });

  it('a degraded declaration decides nothing', () => {
    const tokens = Array.from({ length: 65 }, (_, i) => `wpr_t${String(i)}`).join(' ');
    const d = detect(page(meta(`wpr_dns_prefetch ${tokens}`) + hint('//cdn.fdt.test')));
    expect(d.dns_prefetch).toEqual({ present: false, domains: [CDN] });
  });

  it.each(['wpr_dns_prefetch_x', 'wpr_dns', 'WPR_DNS_PREFETCH'])(
    'an inexact token (%s) refutes it',
    (token) => {
      expect(detect(page(meta(token))).dns_prefetch).toEqual({
        present: false,
        domains: [],
        source: 'meta'
      });
    }
  );

  it('with the CDN declared, a missing token decides nothing (the plugin omits it for one domain)', () => {
    const d = detect(page(meta('wpr_cdn wpr_delay_js') + hint('//cdn.fdt.test')));
    expect(d.dns_prefetch).toEqual({ present: false, domains: [CDN] });
    expect(d.rocket_cdn).toMatchObject({ present: true, source: 'meta' });
  });

  it('with the CDN declared, the token still declares the row', () => {
    const d = detect(page(meta('wpr_cdn wpr_dns_prefetch') + hint('//cdn.fdt.test')));
    expect(d.dns_prefetch).toEqual({ present: true, domains: [CDN], source: 'meta' });
  });

  it.each(['wpr_cdn_x', 'WPR_CDN', 'wpr_rocketcdn'])(
    'an inexact CDN token (%s) keeps the refutation',
    (token) => {
      expect(detect(page(meta(token))).dns_prefetch).toEqual({
        present: false,
        domains: [],
        source: 'meta'
      });
    }
  );

  it('the CDN guard never touches the other rows: a missing token there still refutes', () => {
    const d = detect(page(meta('wpr_cdn')));
    expect(d.preload_links).toMatchObject({ present: false, source: 'meta' });
    expect(d.mobile_cache).toMatchObject({ present: false, source: 'meta' });
  });

  it('the Preconnect token does not declare it, nor DNS prefetch declare Preconnect', () => {
    const preconnect = detect(page(meta('wpr_preconnect_external_domains')));
    expect(preconnect.dns_prefetch).toMatchObject({ present: false, source: 'meta' });
    const dns = detect(page(meta('wpr_dns_prefetch')));
    expect(dns.preconnect_external_domains).toMatchObject({ present: false, source: 'meta' });
  });
});

describe('the observed hints (both engines)', () => {
  it('leaves out the hints attributed to Preconnect to External Domains', () => {
    const d = detect(
      page(
        meta('wpr_dns_prefetch') +
          '<link data-rocket-prefetch href="https://gtm.example" rel="dns-prefetch">' +
          '<link data-rocket-preconnect crossorigin href="https://cors.example" rel="dns-prefetch">' +
          hint('//cdn.fdt.test')
      )
    );
    expect(d.dns_prefetch.domains).toEqual([CDN]);
    expect(d.preconnect_external_domains.domains).toEqual([
      'https://gtm.example/',
      'https://cors.example/'
    ]);
  });

  it.each([
    ['a javascript: href', 'javascript:alert(1)'],
    ['a data: href', 'data:text/plain,x'],
    ['an empty href (it would resolve to the page itself)', ''],
    ['a blank href', '   '],
    ['a mailto: href', 'mailto:a@b.example']
  ])('drops %s (it names no host)', (_name, href) => {
    expect(detect(page(`<link rel="dns-prefetch" href="${href}">`)).dns_prefetch.domains).toEqual(
      []
    );
  });

  it.each([
    ['a fragment', '#'],
    ['a path', '/x'],
    ['a relative path', 'x'],
    ['the page origin spelled out', 'http://localhost:3000/'],
    ['the page host scheme-less', '//localhost:3000']
  ])("drops %s (it names the page's own origin)", (_name, href) => {
    expect(detect(page(hint(href) + hint('//cdn.fdt.test'))).dns_prefetch.domains).toEqual([CDN]);
  });

  it('keeps the page host on another scheme or port (a different origin)', () => {
    const d = detect(page(hint('https://localhost:3000') + hint('//localhost:8080')));
    expect(d.dns_prefetch.domains).toEqual(['https://localhost:3000/', 'http://localhost:8080/']);
  });

  it('on an https page, a scheme-less hint reads https and same-origin hints drop', () => {
    const d = onPage('https://site.test/blog/post/', () =>
      detect(page(hint('//fonts.googleapis.com') + hint('//site.test') + hint('/x') + hint('#')))
    );
    expect(d.dns_prefetch.domains).toEqual(['https://fonts.googleapis.com/']);
  });

  it('drops a hint with no href at all', () => {
    expect(detect(page('<link rel="dns-prefetch">')).dns_prefetch.domains).toEqual([]);
  });

  it('matches rel case-insensitively but whole, and only on link elements', () => {
    const d = detect(
      page(
        '<link rel="DNS-Prefetch" href="https://upper.example">' +
          '<link rel="preconnect dns-prefetch" href="https://multi.example">' +
          '<link rel="preconnect" href="https://preconnect.example">' +
          '<a rel="dns-prefetch" href="https://anchor.example">a</a>'
      )
    );
    expect(d.dns_prefetch.domains).toEqual(['https://upper.example/']);
  });

  it('collapses spellings of one host, in first-occurrence order', () => {
    const d = detect(
      page(
        hint('https://b.example') +
          '<link rel="dns-prefetch" href="https://a.example/">' +
          hint('https://a.example') +
          hint('  https://b.example  ')
      )
    );
    expect(d.dns_prefetch.domains).toEqual(['https://b.example/', 'https://a.example/']);
  });

  it('a hostile page of 10,000 hints stays linear and is cut at the boundary', () => {
    const hints = Array.from({ length: 10_000 }, (_, i) => hint(`//h${String(i)}.example`)).join(
      ''
    );
    const html = page(meta('wpr_dns_prefetch') + hints);
    const started = performance.now();
    const port = runDetection(html).detections;
    const elapsed = performance.now() - started;
    expect(port.dns_prefetch.domains).toHaveLength(10_000);
    expect(port.dns_prefetch).toEqual(runReferenceDetection(html).wprDetections.dns_prefetch);
    // A quadratic dedupe would take seconds here; generous for slow runners.
    expect(elapsed).toBeLessThan(2_000);
    const bounded = boundWprDetections(port).dns_prefetch;
    expect(bounded.domains).toHaveLength(PAYLOAD_LIMITS.domains.count);
    expect(bounded.truncated).toBe(true);
    // The bounded row is valid at the boundary and reads as a floor.
    const parsed = parseWprDetections(boundWprDetections(port));
    expect(parsed?.dns_prefetch).toEqual(bounded);
    expect(dnsPrefetchHintText(bounded)).toBe('500+ domains hinted');
  });

  it('10,000 copies of one hint collapse to one domain', () => {
    const html = page(meta('wpr_dns_prefetch') + hint('//one.example').repeat(10_000));
    expect(detect(html).dns_prefetch.domains).toEqual(['http://one.example/']);
  });
});

describe('the DNS prefetch row on every surface', () => {
  it('words the hints, with a cut list as a floor', () => {
    expect(dnsPrefetchHintText({ present: true, domains: [FONTS] })).toBe('1 domain hinted');
    expect(dnsPrefetchHintText({ present: true, domains: [FONTS, CDN] })).toBe('2 domains hinted');
    expect(dnsPrefetchHintText({ present: true, domains: [] })).toBe('0 domains hinted');
    expect(dnsPrefetchHintText({ present: true, domains: [FONTS, CDN], truncated: true })).toBe(
      '2+ domains hinted'
    );
  });

  it('the proof limit says the hosts may include, or be only, core or CDN hosts', () => {
    expect(DNS_PREFETCH_LIMIT).toBe(
      "WP Rocket declared DNS prefetch; the hosts may include, or be only, WordPress core's own hints and CDN hosts."
    );
  });

  it('an applied row: the hint count, then the limit', () => {
    const d = detect(page(meta('wpr_dns_prefetch') + hint('//fonts.googleapis.com')));
    expect(stateLine(d)).toBe(`applied on this page: 1 domain hinted. ${DNS_PREFETCH_LIMIT}`);
  });

  it('an undecided row on a WP Rocket page reads unknown, saying why', () => {
    const d = detect(page(hint('//fonts.googleapis.com'), CACHE_FOOTER));
    const feature = dnsFeature();
    const reading = readHudFeature(feature, describeDetections(d), d);
    expect(reading.verdict).toBe('unknown');
    expect(reading.why).toBe(
      'no generator meta declaration decided it, and a plain dns-prefetch hint does not name WP Rocket, so its state is unknown.'
    );
    // Unattributed hints are no evidence for an undecided row: no count.
    expect(reading.count).toBeNull();
  });

  it('an applied row counts its hints', () => {
    const d = detect(page(meta('wpr_dns_prefetch') + hint('//a.example') + hint('//b.example')));
    expect(readHudFeature(dnsFeature(), describeDetections(d), d).count).toBe(2);
  });

  it('a refuted row carries no count', () => {
    const d = detect(page(meta('wpr_delay_js') + hint('//a.example')));
    expect(readHudFeature(dnsFeature(), describeDetections(d), d).count).toBeNull();
  });

  it('a row the CDN omission left open reads unknown with the omission why', () => {
    const d = detect(page(meta('wpr_cdn') + hint('//cdn.fdt.test')));
    const reading = readHudFeature(dnsFeature(), describeDetections(d), d);
    expect(reading).toMatchObject({ verdict: 'unknown', source: null, count: null });
    const why =
      'with the CDN on, WP Rocket omits the declaration for a single domain, so its state is unknown.';
    expect(reading.why).toBe(why);
    expect(stateLine(d)).toBe(why);
  });

  it('a degraded meta beside a CDN footprint reads the plain undecided why', () => {
    const tokens = Array.from({ length: 65 }, (_, i) => `wpr_t${String(i)}`).join(' ');
    const d = detect(page(meta(`wpr_cdn ${tokens}`), CACHE_FOOTER));
    expect(readHudFeature(dnsFeature(), describeDetections(d), d).why).toBe(
      'no generator meta declaration decided it, and a plain dns-prefetch hint does not name WP Rocket, so its state is unknown.'
    );
  });

  it('a refuted row reads the meta refutation, never the hints', () => {
    const d = detect(page(meta('wpr_delay_js') + hint('//cdn.fdt.test')));
    expect(stateLine(d)).toBe("WP Rocket's generator meta does not declare it on this page.");
  });

  it('the report counts the hints whatever the verdict', () => {
    const d = detect(page(hint('//a.example') + hint('//b.example')));
    expect(describeDetections(d)['Prefetch DNS Requests']).toEqual({
      state: 'not applied',
      'domains hinted': 2
    });
  });
});

describe('the DNS prefetch fixtures', () => {
  it('dns-prefetch-declared.html (real plugin): declared by the meta, its domain as core printed it', () => {
    const d = detect(fixture('dns-prefetch-declared.html'));
    expect(d.dns_prefetch).toEqual({
      present: true,
      domains: ['http://fdt-dns.example/'],
      source: 'meta'
    });
    // The capture's only plain hint is the stored domain: no Preconnect row on it.
    expect(d.preconnect_external_domains.domains).toEqual([]);
    expect(stateLine(d)).toBe(`applied on this page: 1 domain hinted. ${DNS_PREFETCH_LIMIT}`);
  });

  it('dns-prefetch-hint-only.html: core hints, no meta ⇒ undecided, Preconnect keeps its own', () => {
    const d = detect(fixture('dns-prefetch-hint-only.html'));
    expect(d.wpr.present).toBe(true);
    expect(d.dns_prefetch).toEqual({ present: false, domains: [FONTS, CDN] });
    expect(d.preconnect_external_domains).toMatchObject({
      present: true,
      source: 'footprint',
      domains: ['https://www.googletagmanager.com/']
    });
  });

  it('dns-prefetch-hostile.html: only the http(s) plain hints, once each', () => {
    const d = detect(fixture('dns-prefetch-hostile.html'));
    expect(d.dns_prefetch).toEqual({
      present: true,
      domains: ['https://a.example/', 'https://b.example/', 'https://cdn.example.com/'],
      source: 'meta'
    });
    expect(d.preconnect_external_domains.domains).toEqual([
      'https://attributed.example/',
      'https://attributed-cors.example/'
    ]);
  });
});
