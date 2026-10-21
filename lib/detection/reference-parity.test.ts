/**
 * Direct port-vs-reference parity for the crafted edges the fixture corpus
 * cannot express: strict cache timestamps, white-label footers and the Delay
 * row's key order. `toEqual` alone ignores property order, so the key-order
 * assertion is explicit.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runDetection } from './run-detection';
import { runReferenceDetection } from './reference/engine';
import { FIXTURE_DIR } from './fixtures/corpus';

/** A minimal page with the given post-document comment. */
function page(comment: string, body = ''): string {
  return `<!doctype html><html><head><meta name="generator" content="WP Rocket 3.23.5.1"></head><body>${body}</body></html><!-- ${comment} -->`;
}

describe('port ≡ reference: cache timestamps and footers', () => {
  const comments = [
    "This website is like a Rocket, isn't it? - Debug: cached@0x10",
    "This website is like a Rocket, isn't it? - Debug: cached@-5",
    "This website is like a Rocket, isn't it? - Debug: cached@1.5",
    `This website is like a Rocket, isn't it? - Debug: cached@${'9'.repeat(400)}`,
    "This website is like a Rocket, isn't it? - Debug: cached@253402300799",
    "This website is like a Rocket, isn't it? - Debug: cached@253402300800",
    'Cached for great performance - Debug: cached@1791342241',
    'Optimized for great performance',
    'a note: Cached for great performance'
  ];

  for (const comment of comments) {
    it(comment, () => {
      const html = page(comment);
      const port = runDetection(html).detections.wpr;
      const reference = runReferenceDetection(html).wprDetections.wpr;
      expect(port).toEqual(reference);
    });
  }

  it('parses the white-label Debug stamp in both engines', () => {
    const html = page('Cached for great performance - Debug: cached@1791342241');
    expect(runDetection(html).detections.wpr).toMatchObject({
      present: true,
      cacheMarkerFound: true,
      cached: true,
      timeStamp: 1791342241
    });
    expect(runReferenceDetection(html).wprDetections.wpr).toEqual(
      runDetection(html).detections.wpr
    );
  });
});

describe('port ≡ reference: Delay JS row shape', () => {
  it('keeps the same key order and values', () => {
    const html = page(
      "This website is like a Rocket, isn't it?",
      '<script>class RocketLazyLoadScripts{constructor(){this.v="2.0.5"}}</script>'
    );
    const port = runDetection(html).detections.delay_js;
    const reference = runReferenceDetection(html).wprDetections.delay_js;
    expect(port).toEqual(reference);
    expect(Object.keys(port)).toEqual(Object.keys(reference));
  });
});

describe('port ≡ reference: footprint branches fixture', () => {
  it('is equal key-for-key on the combined footprint page', () => {
    const html = readFileSync(join(FIXTURE_DIR, 'footprint-branches.html'), 'utf8');
    const port = runDetection(html);
    const reference = runReferenceDetection(html);
    expect(port.detections).toEqual(reference.wprDetections);
    expect(Object.keys(port.detections.delay_js)).toEqual(
      Object.keys(reference.wprDetections.delay_js)
    );
    expect(port.detections.delay_js).toMatchObject({
      present: true,
      version: null,
      delayedScripts: 0
    });
    expect(port.detections.defer_all_js).toMatchObject({
      present: true,
      scripts: [],
      deferredScripts: 1
    });
    expect(port.detections.self_hosted_fonts).toEqual({ present: true, source: 'footprint' });
    expect(port.detections.preload_links).toEqual({ present: true, source: 'footprint' });
    expect(port.detections.minify_css).toEqual({ present: true, source: 'footprint' });
    expect(port.detections.minify_js).toEqual({ present: true, source: 'footprint' });
    expect(port.detections.wpr).toMatchObject({
      present: true,
      cacheMarkerFound: true,
      cached: true,
      timeStamp: 1791342241
    });
  });
});
