/**
 * The mobile cache row over the real pass, in both engines: the generator
 * meta's device token alone decides it (declared / refuted / undecided), the
 * variant is the one token listed, and the beacon config's device (read
 * off the beacon row) never changes the verdict or the variant.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WprDetections } from '../wp-rocket/types';
import { runReferenceDetection } from './reference/engine';
import { runDetection } from './run-detection';
import { describeDetections } from './describe';
import { mobileCacheVariant } from './detect-optimizations';
import {
  hudFeatureOf,
  hudStateLine,
  MOBILE_CACHE_LIMIT,
  readHudFeature,
  type HudFeature
} from './hud';
import { FIXTURE_DIR } from './fixtures/corpus';

const CACHE_FOOTER = "<!-- This website is like a Rocket, isn't it? -->";

/** A generator meta declaring the given tokens. */
function meta(tokens: string): string {
  return `<meta name="generator" content="WP Rocket 3.24" data-wpr-features="${tokens}">`;
}

/** The beacon tag plus an inline config stating the device. */
function beacon(isMobile: boolean): string {
  return (
    `<script>var rocket_beacon_data = {"status":{"atf":true},"is_mobile":${String(isMobile)}}</script>` +
    '<script data-name="wpr-wpr-beacon" src="/wp-content/plugins/wp-rocket/assets/js/wpr-beacon.min.js" async></script>'
  );
}

/** A page around the given head/body markup, with an optional post-document comment. */
function page(head: string, body = '', after = ''): string {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>${after}`;
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

/** The mobile cache HUD row (fails loudly if the registry lost it). */
function mobileFeature(): HudFeature {
  const feature = hudFeatureOf('mobile_cache');
  if (feature === undefined) throw new Error('mobile_cache has no HUD row');
  return feature;
}

describe('mobile cache: meta only (both engines)', () => {
  it.each([
    ['wpr_mobile', 'mobile'],
    ['wpr_desktop', 'desktop']
  ] as const)('%s declares the row with its variant', (token, variant) => {
    expect(detect(page(meta(`wpr_delay_js ${token}`))).mobile_cache).toEqual({
      present: true,
      variant,
      source: 'meta'
    });
  });

  it('both device tokens (never a genuine render) declare it with no variant', () => {
    expect(detect(page(meta('wpr_mobile wpr_desktop'))).mobile_cache).toEqual({
      present: true,
      variant: null,
      source: 'meta'
    });
  });

  it('a meta without either token refutes it', () => {
    expect(detect(page(meta('wpr_delay_js'))).mobile_cache).toEqual({
      present: false,
      variant: null,
      source: 'meta'
    });
  });

  it('no meta leaves it undecided, even where WP Rocket is proven', () => {
    const d = detect(page('', '', CACHE_FOOTER));
    expect(d.wpr.present).toBe(true);
    expect(d.mobile_cache).toEqual({ present: false, variant: null });
  });

  it('a degraded declaration decides nothing and names no variant', () => {
    const d = detect(page(meta(`wpr_mobile ${'x'.repeat(200)}`)));
    expect(d.mobile_cache).toEqual({ present: false, variant: null });
  });

  it('only the exact tokens declare it', () => {
    for (const token of ['WPR_MOBILE', 'wpr_mobile_cache', 'wpr_tablet', 'wpr_desktops']) {
      expect(detect(page(meta(token))).mobile_cache, token).toEqual({
        present: false,
        variant: null,
        source: 'meta'
      });
    }
  });

  it('a declared row alone proves WP Rocket (a generator tag is already proof)', () => {
    expect(detect(page(meta('wpr_desktop'))).wpr.present).toBe(true);
  });
});

describe('mobile cache: the beacon device stays on the beacon row (both engines)', () => {
  it.each([true, false])('is_mobile %s moves neither the verdict nor the variant', (isMobile) => {
    const d = detect(page(meta('wpr_mobile'), beacon(isMobile)));
    expect(d.mobile_cache).toEqual({ present: true, variant: 'mobile', source: 'meta' });
    expect(d.priority_elements_beacon.isMobile).toBe(isMobile);
  });

  it('a beacon device never declares the row on its own', () => {
    expect(detect(page('', beacon(true))).mobile_cache).toEqual({
      present: false,
      variant: null
    });
  });
});

describe('mobileCacheVariant', () => {
  it.each([
    [['wpr_mobile'], 'mobile'],
    [['wpr_delay_js', 'wpr_desktop'], 'desktop'],
    [['wpr_mobile', 'wpr_desktop'], null],
    [['wpr_delay_js'], null],
    [[], null]
  ] as const)('%j names %s', (tokens, variant) => {
    expect(mobileCacheVariant({ attributePresent: true, tokens })).toBe(variant);
  });

  it('names none for a degraded or absent declaration', () => {
    expect(mobileCacheVariant({ attributePresent: true, tokens: [], degraded: true })).toBeNull();
    expect(mobileCacheVariant({ attributePresent: false, tokens: [] })).toBeNull();
  });
});

describe('mobile cache: the real-plugin captures and their HUD lines', () => {
  it('mobile-cache-mobile.html: rendered for mobile, agreeing with the beacon', () => {
    const d = detect(fixture('mobile-cache-mobile.html'));
    expect(d.mobile_cache).toEqual({
      present: true,
      variant: 'mobile',
      source: 'meta'
    });
    expect(d.priority_elements_beacon.isMobile).toBe(true);
    const feature = mobileFeature();
    const reading = readHudFeature(feature, describeDetections(d), d);
    expect(reading.verdict).toBe('applied');
    expect(hudStateLine(feature, reading)).toBe(
      `applied on this page: rendered for mobile. ${MOBILE_CACHE_LIMIT}`
    );
  });

  it('mobile-cache-desktop.html: rendered for desktop, agreeing with the beacon', () => {
    const d = detect(fixture('mobile-cache-desktop.html'));
    expect(d.mobile_cache).toEqual({
      present: true,
      variant: 'desktop',
      source: 'meta'
    });
    expect(d.priority_elements_beacon.isMobile).toBe(false);
    expect(describeDetections(d)['Separate cache files for mobile devices']).toEqual({
      state: 'applied',
      'rendered for': 'desktop'
    });
  });

  it('the two captures differ only in the device facts', () => {
    const mobile = detect(fixture('mobile-cache-mobile.html'));
    const desktop = detect(fixture('mobile-cache-desktop.html'));
    // The beacon config script's text (its device and thresholds) is the one
    // inventory difference; everything else must read the same.
    const strip = (d: WprDetections): unknown => ({
      ...d,
      mobile_cache: null,
      priority_elements_beacon: { ...d.priority_elements_beacon, isMobile: null },
      delay_js: {
        ...d.delay_js,
        scripts: d.delay_js.scripts.map((script) =>
          script.content?.includes('rocket_beacon_data') === true
            ? { ...script, content: null }
            : script
        )
      }
    });
    expect(strip(mobile)).toEqual(strip(desktop));
  });

  it('a WP Rocket page without the meta reads unknown with the undecided copy', () => {
    const d = detect(page('', '', CACHE_FOOTER));
    const feature = mobileFeature();
    const reading = readHudFeature(feature, describeDetections(d), d);
    expect(reading.verdict).toBe('unknown');
    expect(reading.why).toBe(feature.undecided);
    expect(reading.appliedLine).toBeUndefined();
  });
});
