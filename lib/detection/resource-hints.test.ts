/**
 * The resource-hint inventory (`preloadedResources.hints`) in both engines:
 * which links are hints and of which kinds, the per-kind WP Rocket stamp
 * (only on the `rel` its emitter writes), `href`/`as` normalization, the
 * `<noscript>` skip, and the boundary (bound + guard) over the result.
 */
import { describe, expect, it } from 'vitest';
import type { PreloadedResources, ResourceHint } from '../wp-rocket/types';
import { boundPreloadedResources, PAYLOAD_LIMITS } from '../messaging/payload-bounds';
import { parsePreloadedResources } from '../messaging/validate';
import { runReferenceDetection } from './reference/engine';
import { runDetection } from './run-detection';
import { parsePage } from './parse-page';
import { resourceHintMark, resourceHintRels } from './detect-optimizations';

/** A page around the given head markup. */
function page(head: string): string {
  return `<!doctype html><html><head>${head}</head><body></body></html>`;
}

/** Run both engines, assert they agree, return the port's report. */
function detect(head: string): PreloadedResources {
  const html = page(head);
  const port = runDetection(html).preloadedResources;
  expect(port).toEqual(runReferenceDetection(html).preloadedResources);
  return port;
}

/** The hints of a head (both engines agreeing). */
function hints(head: string): ResourceHint[] {
  return detect(head).hints ?? [];
}

/** The first `<link>` of a head. */
function firstLink(head: string): HTMLLinkElement {
  const link = parsePage(page(head)).links[0];
  if (link === undefined) throw new Error('no link');
  return link;
}

describe('resource hint inventory — kinds', () => {
  it('lists the four kinds, in document order, and nothing else', () => {
    expect(
      hints(`
        <link rel="stylesheet" href="https://a.example/s.css">
        <link rel="preconnect" href="https://b.example">
        <link rel="icon" href="/favicon.ico">
        <link rel="preload" href="https://a.example/h.webp" as="image">
        <link rel="prefetch" href="https://a.example/next">
        <link rel="modulepreload" href="https://a.example/m.js">
        <link rel="dns-prefetch" href="//c.example">
        <link rel="prerender" href="https://a.example/p">`)
    ).toEqual([
      { rel: 'preconnect', href: 'https://b.example/', as: '' },
      { rel: 'preload', href: 'https://a.example/h.webp', as: 'image' },
      { rel: 'modulepreload', href: 'https://a.example/m.js', as: '' },
      // The test environment resolves scheme-less hrefs against its own origin.
      { rel: 'dns-prefetch', href: 'http://c.example/', as: '' }
    ]);
  });

  it('reads rel tokens ASCII case-insensitively, one hint per listed kind, each once', () => {
    expect(
      hints(`<link rel=" Preconnect\tDNS-PREFETCH preconnect " href="https://m.example">`)
    ).toEqual([
      { rel: 'preconnect', href: 'https://m.example/', as: '' },
      { rel: 'dns-prefetch', href: 'https://m.example/', as: '' }
    ]);
    expect(resourceHintRels(firstLink('<link rel="preloadx modulepreload2">'))).toEqual([]);
    expect(resourceHintRels(firstLink('<link href="/x">'))).toEqual([]);
  });

  // Every WP Rocket emitter writes `rel="preload"` beside the marker, so the
  // marker alone never makes a hint (it still lists the link in `resources`).
  it('takes the kinds from rel alone: the preload marker adds none', () => {
    const report = detect(`
        <link data-rocket-preload as="image" href="https://a.example/a.webp">
        <link data-rocket-preload rel="preconnect" href="https://b.example">
        <link data-rocket-preload rel="preload" as="font" href="https://c.example/f.woff2">`);
    expect(report.hints).toEqual([
      { rel: 'preconnect', href: 'https://b.example/', as: '' },
      { rel: 'preload', href: 'https://c.example/f.woff2', as: 'font', mark: 'preload' }
    ]);
    expect(report.resources?.map((resource) => resource.href)).toEqual([
      'https://a.example/a.webp',
      'https://b.example/',
      'https://c.example/f.woff2'
    ]);
    expect(resourceHintRels(firstLink('<link data-rocket-preload href="/x">'))).toEqual([]);
  });

  it('keeps one row per hint for the same URL', () => {
    const same = '<link rel="preload" as="font" href="https://a.example/f.woff2">';
    expect(hints(same + same + same)).toHaveLength(3);
  });

  it('skips hints inside <noscript> (a live capture serializes them as text)', () => {
    expect(
      hints(`<noscript><link rel="preload" as="style" href="https://a.example/s.css"></noscript>
        <link rel="preconnect" href="https://b.example">`)
    ).toEqual([{ rel: 'preconnect', href: 'https://b.example/', as: '' }]);
  });
});

describe('resource hint inventory — href and as', () => {
  it('resolves the href (protocol-relative included); a missing or blank one reads empty', () => {
    expect(
      hints(`
        <link rel="preload" as="image" imagesrcset="a.webp 1x">
        <link rel="preload" as="image" href="">
        <link rel="preconnect" href="   ">
        <link rel="preconnect" href="//cdn.example/x">
        <link rel="dns-prefetch" href="javascript:void(0)">`).map((hint) => hint.href)
    ).toEqual(['', '', '', 'http://cdn.example/x', 'javascript:void(0)']);
  });

  it('trims and lower-cases `as`, absent as empty', () => {
    expect(
      hints(`
        <link rel="preload" as=" FONT " href="/a">
        <link rel="preload" href="/b">
        <link rel="modulepreload" as="Script" href="/c">`).map((hint) => hint.as)
    ).toEqual(['font', '', 'script']);
  });
});

describe('resource hint inventory — WP Rocket stamps', () => {
  it('stamps each kind only with its emitter’s attribute', () => {
    expect(
      hints(`
        <link rel="preload" data-rocket-preload as="font" href="/f.woff2" crossorigin>
        <link rel="preload" as="style" data-rocket-async="style" href="/s.css">
        <link rel="preconnect" crossorigin data-rocket-preconnect href="https://p.example">
        <link rel="dns-prefetch" data-rocket-prefetch href="https://d.example">`).map((hint) => [
        hint.rel,
        hint.mark
      ])
    ).toEqual([
      ['preload', 'preload'],
      ['preload', 'async'],
      ['preconnect', 'preconnect'],
      ['dns-prefetch', 'prefetch']
    ]);
  });

  it('reads a stamp on another kind, or with an inexact value, as no stamp', () => {
    const plain = hints(`
      <link rel="preconnect" data-rocket-prefetch href="https://a.example">
      <link rel="dns-prefetch" data-rocket-preconnect href="https://b.example">
      <link rel="modulepreload" data-rocket-async="style" href="/m.js">
      <link rel="preload" as="style" data-rocket-async="Style" href="/s.css">
      <link rel="preload" as="style" data-rocket-async href="/t.css">`);
    expect(plain).toHaveLength(5);
    for (const hint of plain) expect(hint).not.toHaveProperty('mark');
  });

  it('applies the stamp per kind on a multi-kind link, preload stamp first', () => {
    expect(
      hints(
        '<link rel="preload preconnect" data-rocket-preload data-rocket-async="style" data-rocket-preconnect href="https://x.example">'
      ).map((hint) => [hint.rel, hint.mark])
    ).toEqual([
      ['preload', 'preload'],
      ['preconnect', 'preconnect']
    ]);
    const link = firstLink('<link rel="preload" data-rocket-async="style" href="/s.css">');
    expect(resourceHintMark(link, 'preload')).toBe('async');
    expect(resourceHintMark(link, 'preconnect')).toBeUndefined();
  });
});

describe('resource hint inventory — report shape', () => {
  it('always writes the list, beside an absent or present preload marker', () => {
    expect(detect('')).toEqual({ present: false, hints: [] });
    expect(detect('<link rel="preconnect" href="https://a.example">')).toEqual({
      present: false,
      hints: [{ rel: 'preconnect', href: 'https://a.example/', as: '' }]
    });
    const report = detect('<link data-rocket-preload rel="preload" as="image" href="/a.webp">');
    expect(report.present).toBe(true);
    expect(report.resources).toHaveLength(1);
    expect(report.hints).toHaveLength(1);
  });

  it('crosses the boundary: bounded under its own mark, then accepted by the guard', () => {
    const many = Array.from(
      { length: PAYLOAD_LIMITS.preloaded.count + 3 },
      (_, i) => `<link rel="dns-prefetch" href="https://h${String(i)}.example">`
    ).join('');
    const bounded = boundPreloadedResources(runDetection(page(many)).preloadedResources);
    expect(bounded.hints).toHaveLength(PAYLOAD_LIMITS.preloaded.count);
    expect(bounded.hintsTruncated).toBe(true);
    expect(bounded).not.toHaveProperty('truncated');
    expect(parsePreloadedResources(bounded)).toEqual(bounded);
  });
});
