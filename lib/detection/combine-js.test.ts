/**
 * The Combine JavaScript files row over the real pass, in both engines: the
 * generator meta alone decides it (declared / refuted), and the bundle's
 * digest file name never does — not on an unproven page, not on a page WP
 * Rocket is proven on, and not through the minify attribute it carries.
 * Minify JS keeps its own verdict beside it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WprDetections } from '../wp-rocket/types';
import { isCombinedBundle } from '../wp-rocket/minify-url-recovery';
import { runReferenceDetection } from './reference/engine';
import { runDetection } from './run-detection';
import { describeDetections } from './describe';
import { hudFeatureOf, readHudFeature } from './hud';
import { FIXTURE_DIR } from './fixtures/corpus';

/** The bundle the live Combine arm served (`combine-js.html`). */
const BUNDLE_URL =
  'http://127.0.0.1:8493/wp-content/cache/min/1/5c03bce63bb3260466706a046cb00086.js';
/** The bundle tag exactly as WP Rocket wrote it (minify stamp + deferral). */
const BUNDLE = `<script src="${BUNDLE_URL}" data-minify="1" data-rocket-defer defer></script>`;
const CACHE_FOOTER = "<!-- This website is like a Rocket, isn't it? -->";

/** A generator meta declaring the given tokens. */
function meta(tokens: string): string {
  return `<meta name="generator" content="WP Rocket 3.24" data-wpr-features="${tokens}">`;
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

describe('Combine JavaScript files: meta only (both engines)', () => {
  it('the declaration decides it present; Minify JS stays refuted (no exception)', () => {
    const d = detect(page(meta('wpr_minify_concatenate_js wpr_defer_js'), BUNDLE));
    expect(d.minify_concatenate_js).toEqual({ present: true, source: 'meta' });
    expect(d.minify_js).toEqual({ present: false, source: 'meta' });
  });

  it('a meta without the token refutes it, even beside the bundle', () => {
    const d = detect(page(meta('wpr_minify_js'), BUNDLE));
    expect(d.minify_concatenate_js).toEqual({ present: false, source: 'meta' });
    expect(d.minify_js).toEqual({ present: true, source: 'meta' });
  });

  it('the bundle never decides it, even where WP Rocket is proven', () => {
    const d = detect(page('', BUNDLE, CACHE_FOOTER));
    expect(d.wpr.present).toBe(true);
    expect(d.minify_concatenate_js).toEqual({ present: false });
    // The bundle sits under the minify cache, so the Minify JS URL arm reads it.
    expect(d.minify_js).toEqual({ present: true, source: 'footprint' });
  });

  it('the bundle alone proves neither the row nor WP Rocket', () => {
    const d = detect(page('', BUNDLE));
    expect(d.minify_concatenate_js).toEqual({ present: false });
    expect(d.minify_js).toEqual({ present: true, source: 'footprint' });
  });

  it('a degraded declaration decides nothing (absent, no source)', () => {
    const d = detect(page(meta(`wpr_minify_concatenate_js ${'x'.repeat(200)}`), BUNDLE));
    expect(d.minify_concatenate_js).toEqual({ present: false });
  });

  it('only the exact token declares it', () => {
    for (const token of ['wpr_minify_concatenate', 'WPR_MINIFY_CONCATENATE_JS', 'wpr_combine_js']) {
      const d = detect(page(meta(token), BUNDLE));
      expect(d.minify_concatenate_js, token).toEqual({ present: false, source: 'meta' });
    }
  });

  it('a page declaring Delay JS too keeps both verdicts independent', () => {
    // The plugin forces Combine off under Delay JS, so this page was edited;
    // neither verdict is rewritten from the other.
    const d = detect(page(meta('wpr_delay_js wpr_minify_concatenate_js'), BUNDLE));
    expect(d.minify_concatenate_js).toEqual({ present: true, source: 'meta' });
    expect(d.delay_js).toMatchObject({ present: true, source: 'meta' });
  });
});

describe('Combine JavaScript files: the real-plugin captures', () => {
  it('combine-js.html: declared, Minify JS refuted, one bundle-shaped script', () => {
    const d = detect(fixture('combine-js.html'));
    expect(d.minify_concatenate_js).toEqual({ present: true, source: 'meta' });
    expect(d.minify_js).toEqual({ present: false, source: 'meta' });
    const bundles = d.delay_js.scripts.filter(
      (script) => script.src !== undefined && isCombinedBundle(script.src)
    );
    expect(bundles.map((script) => [script.src, script.minifyAttribute])).toEqual([
      [BUNDLE_URL, true]
    ]);
  });

  it('combine-js-no-meta.html: undecided, read as unknown on the HUD', () => {
    const d = detect(fixture('combine-js-no-meta.html'));
    expect(d.wpr.present).toBe(true);
    expect(d.minify_concatenate_js).toEqual({ present: false });
    expect(
      d.delay_js.scripts.some((script) => script.src !== undefined && isCombinedBundle(script.src))
    ).toBe(true);
    const feature = hudFeatureOf('minify_concatenate_js');
    if (feature === undefined) throw new Error('minify_concatenate_js has no HUD row');
    const reading = readHudFeature(feature, describeDetections(d), d);
    expect(reading.verdict).toBe('unknown');
    expect(reading.why).toBe(feature.undecided);
  });
});
