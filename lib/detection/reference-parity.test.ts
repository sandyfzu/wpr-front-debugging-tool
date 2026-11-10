/**
 * Direct port-vs-reference parity for the crafted edges the fixture corpus
 * cannot express: strict cache timestamps, white-label footers, the Delay
 * row's key order and the beacon config's list shapes. `toEqual` alone ignores property order, so the key-order
 * assertion is explicit.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runDetection } from './run-detection';
import { runReferenceDetection } from './reference/engine';
import { FIXTURE_DIR } from './fixtures/corpus';
import { BUILDER_MARKER_META_NAME } from '../wp-rocket/constants';

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

describe('port ≡ reference: original type on delayed records', () => {
  it('agrees key-for-key on parked, empty, valueless, missing and executed types', () => {
    const html = page(
      '',
      [
        '<script type="rocketlazyloadscript" data-rocket-type="module" data-rocket-src="/m.js"></script>',
        '<script type="text/rocketlazyloadscript" data-rocket-type=" ">a();</script>',
        '<script type="rocketlazyloadscript" data-rocket-type="" data-rocket-src="/e.js"></script>',
        '<script type="rocketlazyloadscript" data-rocket-type data-rocket-src="/v.js"></script>',
        '<script type="rocketlazyloadscript" data-rocket-src="/n.js"></script>',
        '<script type="module" data-rocket-type="module" src="/ran.js"></script>'
      ].join('')
    );
    const port = runDetection(html).detections.delay_js.scripts;
    const reference = runReferenceDetection(html).wprDetections.delay_js.scripts;
    expect(port).toEqual(reference);
    expect(port.map((record) => Object.keys(record))).toEqual(
      reference.map((record) => Object.keys(record))
    );
    expect(port.map((record) => record.originalType)).toEqual([
      'module',
      ' ',
      undefined,
      undefined,
      undefined,
      undefined
    ]);
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

/**
 * The Exclusion Builder's `builder` field is excluded from the comparison:
 * it is this extension's own annotation of its rewrite (read from its own
 * marker), not a WP Rocket footprint, so the reference — an independent
 * reading of what WP Rocket served — has no counterpart and never emits it.
 * Everything else must stay equal on a marked page.
 */
describe('port ≡ reference: the builder field is excluded', () => {
  it('agrees on every other field of a page carrying a builder marker', () => {
    const marker = `<meta name="${BUILDER_MARKER_META_NAME}" content="v1 delay_js=off defer_all_js=page-off automatic_lazy_rendering=excluded:1 lazyload=excluded:2">`;
    const html = page(
      "This website is like a Rocket, isn't it?",
      '<script>class RocketLazyLoadScripts{constructor(){this.v="2.0.5"}}</script>'
    ).replace('</head>', `${marker}</head>`);
    const port = structuredClone(runDetection(html).detections);
    const reference = runReferenceDetection(html).wprDetections;
    expect(port.delay_js.builder).toEqual({ off: 'feature' });
    expect(reference.delay_js).not.toHaveProperty('builder');
    delete port.delay_js.builder;
    delete port.defer_all_js.builder;
    delete port.automatic_lazy_rendering.builder;
    delete port.lazyload.builder;
    expect(port).toEqual(reference);
  });
});

/**
 * The served-URL rule (Delay JS moves `src` to `data-rocket-src`) is a
 * committed deviation both engines implement independently: they must agree
 * on every attribute combination, for every check that recognizes a script
 * by URL.
 */
describe('port ≡ reference: served script URL on delayed tags', () => {
  const delayed = 'type="rocketlazyloadscript"';
  const urls = [
    'https://s.com/wp-content/cache/min/1/app.js',
    '/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js',
    '/wp-content/plugins/wp-rocket/assets/js/wpr-beacon.min.js',
    '//s.com/wp-content/plugins/wp-rocket/assets/js/wpr-beacon.min.js'
  ];
  /** Tag variants that name the URL under test. */
  const urlTags = (url: string): string[] => [
    `${delayed} data-rocket-src="${url}"`,
    `${delayed} src="${url}"`,
    `${delayed} src="/other.js" data-rocket-src="${url}"`,
    `${delayed} src="${url}" data-rocket-src="/other.js"`,
    `${delayed} data-rocket-src="" src="${url}"`,
    `${delayed} data-rocket-src src="${url}"`,
    `${delayed} data-rocket-src="  " src="${url}"`,
    `type="TEXT/RocketLazyLoadScript" data-rocket-src="${url}"`,
    `data-rocket-src="${url}"`,
    `data-rocket-src="${url}" src="/other.js"`,
    `data-rocket-src="/other.js" src="${url}"`
  ];
  /** URL-independent variants, run once. */
  const bareTags = [
    `${delayed} data-rocket-src=""`,
    `${delayed} data-rocket-src="" src=""`,
    `${delayed} data-rocket-src="  "`,
    `${delayed} data-rocket-src="http://[x"`
  ];
  const cases: [title: string, head: string, attrs: string][] = [
    ...urls.flatMap((url) =>
      urlTags(url).map((attrs) => [attrs, '', attrs] as [string, string, string])
    ),
    ...bareTags.map((attrs) => [attrs, '', attrs] as [string, string, string]),
    ...[
      'https://s.com/wp-content/cache/min/1/',
      'https://s.com/wp-content/plugins/wp-rocket/assets/js/'
    ].map(
      (base) =>
        [
          `<base ${base}> + relative delayed URL`,
          `<base href="${base}">`,
          `${delayed} data-rocket-src="${base.includes('/min/') ? 'app.js' : 'wpr-beacon.min.js'}"`
        ] as [string, string, string]
    )
  ];
  const rows = ['minify_js', 'lazyload', 'lazyload_iframes', 'priority_elements_beacon'] as const;

  for (const [title, head, attrs] of cases) {
    it(title, () => {
      const html = `<!doctype html><html><head>${head}</head><body><script ${attrs}></script><script>window.lazyLoadOptions=1 img[data-lazy-src] iframe[data-lazy-src]</script></body></html><!-- no footer -->`;
      const port = runDetection(html).detections;
      const reference = runReferenceDetection(html).wprDetections;
      for (const row of rows) expect(port[row], row).toEqual(reference[row]);
    });
  }
});

describe('port ≡ reference: beacon config lists with holes', () => {
  const lists: [title: string, value: unknown][] = [
    ['an array', ['link', 'script']],
    ['holes', { '0': 'link', '2': 'iframe' }],
    ['numeric order', { '10': 'woff', '2': 'woff2' }],
    ['empty object', {}],
    ['a named key', { '0': 'link', a: 'script' }],
    ['a padded key', { '01': 'link' }],
    ['a non-string item', { '0': 'link', '1': 5 }]
  ];
  for (const [title, value] of lists) {
    it(title, () => {
      const config = JSON.stringify({ status: { atf: true }, processed_extensions: value });
      const html = `<!doctype html><html><head></head><body><script>var rocket_beacon_data = ${config}</script><script data-name="wpr-wpr-beacon" src="/wp-content/plugins/wp-rocket/assets/js/wpr-beacon.min.js" async></script></body></html>`;
      expect(runDetection(html).detections.priority_elements_beacon).toEqual(
        runReferenceDetection(html).wprDetections.priority_elements_beacon
      );
    });
  }
  for (const list of ["{__proto__: {'0': 'x'}}", "{__proto__: {'0': 'x'}, '1': 'a'}"]) {
    it(`literal ${list}`, () => {
      const html = `<!doctype html><html><head></head><body><script>var rocket_beacon_data = {status: {atf: true}, processed_extensions: ${list}};</script><script data-name="wpr-wpr-beacon" src="/wp-content/plugins/wp-rocket/assets/js/wpr-beacon.min.js" async></script></body></html>`;
      const port = runDetection(html).detections.priority_elements_beacon;
      expect(port).toEqual(runReferenceDetection(html).wprDetections.priority_elements_beacon);
      // The beacon tag stays the evidence; the hostile config degrades wholesale.
      expect(port).toMatchObject({ present: true, status: null });
    });
  }
});
