/**
 * The minify attribute's proof guard over the real pass, in both engines:
 * `data-minify="1"` decides a minify row (as footprint) only where the
 * generator meta decided nothing and WP Rocket was proven by other evidence
 * first — never by the attribute itself.
 */
import { describe, expect, it } from 'vitest';
import type { WprDetections } from '../wp-rocket/types';
import { runReferenceDetection } from './reference/engine';
import {
  applyMinifyAttributeGuard,
  applyPresencePropagation,
  rowProvesWpr,
  runChecks,
  runDetection,
  wprProven
} from './run-detection';
import { parsePage } from './parse-page';
import { simulatedPage } from './simulated-pages.fixtures';

/** Stylesheet + script under a site-moved cache root (the URL arm misses both). */
const MOVED_ASSETS =
  '<link data-minify="1" rel="stylesheet" href="https://moved.example/wp-content/wpr-files/min/1/wp-content/themes/t/style.css">' +
  '<script data-minify="1" src="https://moved.example/wp-content/wpr-files/min/1/wp-content/themes/t/app.js"></script>';
const MOVED_CSS_ONLY =
  '<link data-minify="1" rel="stylesheet" href="https://moved.example/wp-content/wpr-files/min/1/style.css">';
const MOVED_JS_ONLY =
  '<script data-minify="1" src="https://moved.example/wp-content/wpr-files/min/1/app.js"></script>';
/** The lazyload footprint (library URL + options blob). */
const LAZYLOAD =
  '<script>window.lazyLoadOptions=[{elements_selector:"img[data-lazy-src],.rocket-lazyload"}]</script>' +
  '<script data-no-minify="1" async src="https://moved.example/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js"></script>';
const DEFER_ONLY = '<script src="/d.js" data-rocket-defer defer></script>';
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

describe('the minify attribute guard (both engines)', () => {
  it('never lets the attribute prove WP Rocket by itself', () => {
    const d = detect(page(MOVED_ASSETS));
    expect(d.wpr.present).toBe(false);
    expect(d.minify_css).toEqual({ present: false });
    expect(d.minify_js).toEqual({ present: false });
  });

  it('never lets one minify row’s attribute prove the other’s', () => {
    const d = detect(page(MOVED_CSS_ONLY, MOVED_JS_ONLY));
    expect(d.wpr.present).toBe(false);
    expect(d.minify_css.present).toBe(false);
    expect(d.minify_js.present).toBe(false);
  });

  it('counts the attribute on a cache-signature page (footprint source)', () => {
    const d = detect(page(MOVED_ASSETS, '', CACHE_FOOTER));
    expect(d.minify_css).toEqual({ present: true, source: 'footprint' });
    expect(d.minify_js).toEqual({ present: true, source: 'footprint' });
    expect(d.wpr.present).toBe(true);
  });

  it('counts the attribute on a version-only generator meta (no declaration)', () => {
    const d = detect(page(`<meta name="generator" content="WP Rocket 3.24">${MOVED_ASSETS}`));
    expect(d.minify_css).toEqual({ present: true, source: 'footprint' });
    expect(d.minify_js).toEqual({ present: true, source: 'footprint' });
  });

  it('counts the attribute beside a lazyload footprint', () => {
    const d = detect(page(MOVED_ASSETS, LAZYLOAD));
    expect(d.lazyload.present).toBe(true);
    expect(d.minify_css).toEqual({ present: true, source: 'footprint' });
    expect(d.minify_js).toEqual({ present: true, source: 'footprint' });
    expect(d.wpr.present).toBe(true);
  });

  it('does not count it beside deferral alone (other tools defer too)', () => {
    const d = detect(page(MOVED_ASSETS, DEFER_ONLY));
    expect(d.defer_all_js.present).toBe(true);
    expect(d.wpr.present).toBe(false);
    expect(d.minify_css.present).toBe(false);
    expect(d.minify_js.present).toBe(false);
  });

  it('lets one row’s URL arm prove the other row’s attribute', () => {
    const cacheCss =
      '<link rel="stylesheet" href="https://s.example/wp-content/cache/min/1/style.css">';
    const d = detect(page(cacheCss, MOVED_JS_ONLY));
    expect(d.minify_css).toEqual({ present: true, source: 'footprint' });
    expect(d.minify_js).toEqual({ present: true, source: 'footprint' });
  });

  it('reads a delayed script’s served URL (Delay JS proves the page)', () => {
    const d = detect(
      page(
        '',
        '<script type="rocketlazyloadscript" data-minify="1" data-rocket-src="https://moved.example/wp-content/wpr-files/min/1/app.js"></script>'
      )
    );
    expect(d.delay_js.present).toBe(true);
    expect(d.minify_js).toEqual({ present: true, source: 'footprint' });
    expect(d.delay_js.scripts[0]?.minifyAttribute).toBe(true);
  });

  it('ignores non-exact values and non-stylesheet links, even on a proven page', () => {
    const d = detect(
      page(
        '<link rel="preload" as="style" data-minify="1" href="https://moved.example/a.css">' +
          '<link rel="stylesheet" data-minify="true" href="https://moved.example/b.css">' +
          // No URL named: WP Rocket stamps only a link it rewrote.
          '<link rel="stylesheet" data-minify="1">' +
          '<link rel="stylesheet" data-minify="1" href="">',
        '<script data-minify="0" src="https://moved.example/a.js"></script>' +
          '<script data-minify="1">var inline = 1;</script>' +
          '<script data-no-minify="1" src="https://moved.example/b.js"></script>',
        CACHE_FOOTER
      )
    );
    expect(d.wpr.present).toBe(true);
    expect(d.minify_css).toEqual({ present: false });
    expect(d.minify_js).toEqual({ present: false });
  });
});

describe('the minify attribute guard under the generator meta (both engines)', () => {
  it('declared: the meta decides (meta source)', () => {
    const d = detect(page(meta('wpr_minify_css wpr_minify_js') + MOVED_ASSETS));
    // The stamp alone names a minified tag once the meta declared the row.
    expect(d.minify_css).toEqual({ present: true, source: 'meta', targets: true });
    expect(d.minify_js).toEqual({ present: true, source: 'meta', targets: true });
  });

  it('refuted: the meta wins over the attribute, proof notwithstanding', () => {
    const d = detect(page(meta('wpr_lazyload_images') + MOVED_ASSETS, LAZYLOAD, CACHE_FOOTER));
    expect(d.wpr.present).toBe(true);
    expect(d.minify_css).toEqual({ present: false, source: 'meta' });
    expect(d.minify_js).toEqual({ present: false, source: 'meta' });
  });

  it('refuted Minify JS on a Combine render: a moved-root bundle’s stamp never overturns the meta', () => {
    // Moved root: the URL arm misses, so only the guard's meta check keeps it refuted.
    const bundle =
      '<script src="https://moved.example/wp-content/wpr-files/min/1/e90a1f4c0d2b3a4c5d6e7f8091a2b3c4.js" data-minify="1"></script>';
    const d = detect(page(meta('wpr_minify_concatenate_js'), bundle));
    expect(d.minify_js).toEqual({ present: false, source: 'meta' });
  });

  it('degraded: the declaration decides nothing, its tag proves WP Rocket, the guard applies', () => {
    const d = detect(page(meta('x'.repeat(5000)) + MOVED_ASSETS));
    expect(d.wpr.present).toBe(true);
    expect(d.minify_css).toEqual({ present: true, source: 'footprint' });
    expect(d.minify_js).toEqual({ present: true, source: 'footprint' });
  });
});

describe('the guard and the simulation', () => {
  const served = page(MOVED_JS_ONLY, '<script src="/app.js"></script>');

  it('a verified simulated Delay JS row is no proof', () => {
    const d = runChecks(parsePage(simulatedPage(served)), ['delay_js']);
    applyPresencePropagation(d);
    expect(d.delay_js.simulation).toBe('simulated');
    expect(d.wpr.present).toBe(false);
    expect(d.minify_js.present).toBe(false);
  });

  it('an unverified marker keeps the served verdict, so the row proves the page', () => {
    const d = runChecks(parsePage(simulatedPage(served)), []);
    expect(d.delay_js.simulation).toBe('unverified');
    expect(d.minify_js).toEqual({ present: true, source: 'footprint' });
  });
});

describe('the presence rule (one declaring site)', () => {
  it('rowProvesWpr: every row but wpr and deferral', () => {
    expect(rowProvesWpr('wpr')).toBe(false);
    expect(rowProvesWpr('defer_all_js')).toBe(false);
    for (const row of [
      'minify_css',
      'minify_js',
      'lazyload',
      'priority_elements_beacon'
    ] as const) {
      expect(rowProvesWpr(row), row).toBe(true);
    }
  });

  it('wprProven: the identity row, or any proving row', () => {
    const base = runDetection(page('')).detections;
    expect(wprProven(base)).toBe(false);
    expect(wprProven({ ...base, defer_all_js: { ...base.defer_all_js, present: true } })).toBe(
      false
    );
    expect(wprProven({ ...base, lazyload: { ...base.lazyload, present: true } })).toBe(true);
    expect(wprProven({ ...base, wpr: { ...base.wpr, present: true } })).toBe(true);
  });

  it('the guard leaves a URL-decided row untouched', () => {
    const parsed = parsePage(
      page('<link rel="stylesheet" href="https://s.example/wp-content/cache/min/1/a.css">')
    );
    const d = runChecks(parsed);
    applyMinifyAttributeGuard(d, parsed);
    expect(d.minify_css).toEqual({ present: true, source: 'footprint' });
    expect(d.minify_js).toEqual({ present: false });
  });
});
