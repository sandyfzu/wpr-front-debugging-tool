/**
 * LazyLoad simulated on one page: the identity rules (AMP, already served,
 * preview, search and page-builder URLs), the placement and
 * forward refusals, the caveats a page shows, and the buffer (after its pass) and
 * printed scripts a simulated page hands the later features.
 */
import { describe, expect, it } from 'vitest';
import { LINEAR_SCALING_TIMEOUT_MS, linearScaling } from '../../vitest.shared';
import { alreadyServesLazyload, holdsLazyloadOptions } from './already-served';
import {
  pageLazyloadCaveats,
  simulateLazyload,
  type LazyloadSimulationInput
} from './lazyload-simulation';
import { scanTags } from '../exclusion-builder/html-scan';

const TEXTS = {
  noJsStyle: '<noscript><style id="rocket-lazyload-nojs-css">x</style></noscript>',
  optionsScript: '<script>window.lazyLoadOptions=[{}];</script>',
  runtimeTagBeforeUrl: '<script data-no-minify="1" async src="',
  runtimeTagAfterUrl: '"></script>',
  runtimeJsPath: 'lazyload/17.8.3/lazyload.min.js'
};

const PAGE =
  '<!doctype html><html><head><title>t</title></head><body><img src="/a.png" alt="a"></body></html>';

/** A step input on `html` at `pageUrl`. */
function input(html = PAGE, pageUrl = 'https://example.org/post/'): LazyloadSimulationInput {
  return {
    html,
    pageUrl,
    texts: TEXTS,
    literals: { excludedAttributes: ['data-no-lazy='], excludedSrc: [] },
    rows: []
  };
}

describe('pageLazyloadCaveats', () => {
  const caveats = (html: string) => [...pageLazyloadCaveats(scanTags(html))].sort();

  it('finds core lazy loading, smilies and foreign lazy markup', () => {
    expect(caveats('<img src="a" loading="lazy">')).toEqual(['core-lazy-loading']);
    expect(caveats('<img src="a" sizes="auto, 100vw">')).toEqual(['core-lazy-loading']);
    expect(caveats('<img src="a" sizes=" AUTO">')).toEqual(['core-lazy-loading']);
    expect(caveats('<img src="a" sizes="autonomous">')).toEqual([]);
    expect(caveats('<img src="a" loading="eager">')).toEqual([]);
    expect(caveats('<img class="wp-smiley x" src="a">')).toEqual(['image-smilies']);
    expect(caveats('<img class="wp-smileys" src="a">')).toEqual([]);
    expect(caveats('<div data-lazy-src="a"></div>')).toEqual(['foreign-lazy-markup']);
    expect(caveats('<iframe loading="lazy"></iframe>')).toEqual([]);
    expect(caveats('<p>loading="lazy" wp-smiley data-lazy-src</p>')).toEqual([]);
  });
});

describe('alreadyServesLazyload', () => {
  it.each([
    [
      'generator images token',
      '<meta name="generator" content="WP Rocket 3.24" data-wpr-features="wpr_lazyload_images" />'
    ],
    [
      'generator iframes token',
      '<meta name="generator" content="WP Rocket 3.24" data-wpr-features="wpr_delay_js wpr_lazyload_iframes" />'
    ],
    [
      'runtime tag',
      '<script async src="https://e.org/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js"></script>'
    ],
    ['no-JS style', '<noscript><style id="rocket-lazyload-nojs-css">x</style></noscript>'],
    [
      'image options script',
      '<script>window.lazyLoadOptions=[{elements_selector:"img[data-lazy-src],.rocket-lazyload"}];</script>'
    ],
    [
      'iframe options script, the selector on a later assignment’s line',
      '<script>window.lazyLoadOptions={};\nwindow.lazyLoadOptions={elements_selector:"iframe[data-lazy-src]"};</script>'
    ],
    [
      'the readable (SCRIPT_DEBUG) options script',
      '<script>window.lazyLoadOptions = [{\n                elements_selector: "img[data-lazy-src],.rocket-lazyload",\n                data_src: "lazy-src"}];</script>'
    ],
    [
      'lazy image with the placeholder SVG',
      `<img src="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2010%2010'%3E%3C/svg%3E" data-lazy-src="/a.png">`
    ],
    [
      'the standalone Lazy Load by WP Rocket plugin’s markup',
      '<noscript><style id="rocket-lazyload-nojs-css">.rll-youtube-player, [data-lazy-src]{display:none !important;}</style></noscript>' +
        '<script async src="/wp-content/plugins/rocket-lazy-load/assets/js/16.1/lazyload.min.js"></script>'
    ]
  ])('reads %s as served', (_name, footprint) => {
    expect(alreadyServesLazyload(`<html><head>${footprint}</head><body></body></html>`)).toBe(true);
  });

  it.each([
    ['text', '<p>window.lazyLoadOptions rocket-lazyload-nojs-css</p>'],
    [
      'a comment',
      '<!-- <script>window.lazyLoadOptions=[{elements_selector:"img[data-lazy-src]"}]</script> -->'
    ],
    [
      'an svg region',
      '<svg><script>window.lazyLoadOptions=[{elements_selector:"img[data-lazy-src]"}]</script></svg>'
    ],
    ['another plugin’s lazy markup', '<img data-lazy-src="/a.png" src="data:,">'],
    [
      'a theme’s vanilla-lazyload setup',
      '<script>window.lazyLoadOptions = { elements_selector: ".lazy" };</script>' +
        '<script async src="/wp-content/themes/t/js/lazyload.min.js"></script>'
    ],
    ['the global named in a string', '<script>var docs="see window.lazyLoadOptions";</script>'],
    [
      'a property of the global, spaced',
      "<script>window.lazyLoadOptions.img = [{ elements_selector: 'img[data-lazy-src]' }];</script>"
    ],
    [
      'the assignment and a selector on different lines',
      '<script>window.lazyLoadOptions={}\nvar s="img[data-lazy-src]";</script>'
    ],
    [
      'the placeholder SVG without data-lazy-src',
      `<img src="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%201%201'%3E%3C/svg%3E">`
    ],
    [
      'another token',
      '<meta name="generator" content="WP Rocket 3.24" data-wpr-features="wpr_delay_js" />'
    ]
  ])('does not read %s as served', (_name, html) => {
    expect(alreadyServesLazyload(`<html><body>${html}</body></html>`)).toBe(false);
  });

  it.each([
    [
      'a theme’s init script',
      '<script>window.lazyLoadOptions = { elements_selector: ".lazy" };</script>'
    ],
    ['a docs string', '<script>var docs="see window.lazyLoadOptions";</script>']
  ])('simulates a page with %s', (_name, script) => {
    const html = PAGE.replace('</body>', `${script}</body>`);
    expect(simulateLazyload(input(html)).report.state).toBe('simulated');
  });

  it(
    'reads an options script linearly, however many assignments share a selector-less line',
    () => {
      const body = (bytes: number): string =>
        'window.lazyLoadOptions=1;'.repeat(Math.ceil(bytes / 25));
      const scaling = linearScaling(body, holdsLazyloadOptions);
      expect(scaling.violation).toBeUndefined();
      expect(scaling.output).toBe(false);
    },
    LINEAR_SCALING_TIMEOUT_MS
  );
});

describe('simulateLazyload', () => {
  it('simulates: texts placed, image lazy, the page facts and the buffer after the pass', () => {
    const result = simulateLazyload(input());
    expect(result.report).toMatchObject({
      state: 'simulated',
      images: 1,
      pictures: 0,
      backgrounds: 0,
      page: {
        runtimeUrl:
          'https://example.org/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js',
        assetsUrlSource: 'default',
        delivery: 'external',
        placement: { head: 'before-end-tag', footer: 'before-end-tag', fallbacks: [] },
        caveats: ['hook-text-placement', 'runtime-url', 'above-the-fold-exclusions', 'site-filters']
      }
    });
    expect(result.html).toContain(`${TEXTS.noJsStyle}</head>`);
    expect(result.html).toContain('data-lazy-src="/a.png"');
    // The buffer starts from the placed page; its contents are the pass's (conditionals aside).
    expect(result.buffer?.start).toContain(TEXTS.optionsScript);
    expect(result.buffer?.start).toContain('<img src="/a.png" alt="a">');
    expect(result.buffer?.html).toBe(result.html);
    expect(result.buffer?.conditionals).toEqual([]);
    const [options, runtimeTag] = result.injectedScripts ?? [];
    expect(options).toBe(TEXTS.optionsScript);
    expect(runtimeTag).toBe(
      `${TEXTS.runtimeTagBeforeUrl}${result.report.page?.runtimeUrl ?? ''}${TEXTS.runtimeTagAfterUrl}`
    );
    expect(result.html).toContain(`${options ?? ''}${runtimeTag ?? ''}</body>`);
  });

  it('names the page’s own caveats first, in vocabulary order', () => {
    const html = PAGE.replace(
      'alt="a">',
      'alt="a" loading="lazy"><img class="wp-smiley" src="/s.png">'
    );
    expect(simulateLazyload(input(html)).report.page?.caveats.slice(0, 2)).toEqual([
      'core-lazy-loading',
      'image-smilies'
    ]);
  });

  it.each([
    [
      'AMP',
      input(PAGE.replace('<html>', '<html amp>')),
      { state: 'not-applicable', reason: 'amp' }
    ],
    [
      'already served',
      input(PAGE.replace('</head>', `${TEXTS.noJsStyle}</head>`)),
      { state: 'already-served' }
    ],
    [
      'search',
      input(PAGE, 'https://example.org/?s=x'),
      { state: 'not-applicable', reason: 'search' }
    ],
    [
      'builder',
      input(PAGE, 'https://example.org/?ct_builder=true'),
      { state: 'not-applicable', reason: 'page-builder-editor' }
    ],
    [
      'no </head>',
      input(PAGE.replace('</head>', '')),
      { state: 'not-applicable', reason: 'no-head-end' }
    ],
    [
      'beyond',
      input(PAGE.replace('<img', '<div style="background-image:url(/x&lpar;.png)">x</div><img')),
      {
        state: 'not-applicable',
        reason: 'beyond-exact-reproduction',
        unreproducedRegex: 'lazyload-entities'
      }
    ]
  ])('serves %s as is', (_name, given, report) => {
    const result = simulateLazyload(given);
    expect(result.html).toBe(given.html);
    expect(result.report).toEqual({ ...report, images: 0, pictures: 0, backgrounds: 0 });
    expect(result.buffer).toBeUndefined();
    expect(result.injectedScripts).toBeUndefined();
  });

  it('checks AMP before the footprints, the footprints before the URL', () => {
    const served = PAGE.replace('</head>', `${TEXTS.noJsStyle}</head>`);
    expect(simulateLazyload(input(served.replace('<html>', '<html ⚡>'))).report.reason).toBe(
      'amp'
    );
    expect(simulateLazyload(input(served, 'https://e.org/?s=1')).report.state).toBe(
      'already-served'
    );
  });

  it('throws on a page URL that is not a URL (the input guard refuses one)', () => {
    expect(() => simulateLazyload(input(PAGE, 'not a url'))).toThrow(TypeError);
  });
});
