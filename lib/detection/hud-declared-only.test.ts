/**
 * The declared-only line: a row WP Rocket's generator meta declares while
 * the page holds nothing the feature acted on reads "declared on this
 * render, but …" instead of "applied on this page" — only on the rows whose
 * token the plugin writes without a rewrite (the verified emitter list),
 * never on a rewrite-only row, a footprint-decided row or one whose count
 * the Exclusion Builder emptied. The verdict stays applied throughout.
 */
import { describe, expect, it } from 'vitest';
import type { FeatureEvidenceSource, FeatureMetaRow, WprDetections } from '../wp-rocket/types';
import { describeDetections } from './describe';
import { featureRowForMetaToken } from './feature-meta';
import { HUD_FEATURES, hudFeatureOf, hudStateLine, readHudFeature, type HudFeature } from './hud';
import { runDetection } from './run-detection';

/** WP Rocket 3.24's tokens it can write with nothing rewritten on the page. */
const DECLARED_WITHOUT_REWRITE_TOKENS = [
  'wpr_minify_css',
  'wpr_minify_js',
  'wpr_defer_js',
  'wpr_delay_js',
  'wpr_lazyload_images',
  'wpr_lazyload_iframes',
  'wpr_lazyload_css_bg_img',
  'wpr_oci',
  'wpr_auto_preload_fonts',
  'wpr_preconnect_external_domains',
  'wpr_preload_links',
  'wpr_host_fonts_locally',
  'wpr_dns_prefetch',
  'wpr_mobile',
  'wpr_desktop'
];
/** …and the tokens it writes only after a rewrite (`wpr_cache_webp` has no row). */
const REWRITE_ONLY_TOKENS = [
  'wpr_cdn',
  'wpr_image_dimensions',
  'wpr_remove_unused_css',
  'wpr_async_css',
  'wpr_minify_concatenate_js',
  'wpr_automatic_lazy_rendering',
  'wpr_cache_webp'
];

/** The engine's zero page on a WP Rocket render, fresh per call. */
function handled(): WprDetections {
  return {
    wpr: { present: true, cacheMarkerFound: true, cached: false, version: '3.24', timeStamp: null },
    remove_unused_css: { present: false },
    async_css: { present: false, criticalStyle: false },
    lazyload_css_bg_img: { present: false },
    self_hosted_fonts: { present: false },
    image_dimensions: { present: false },
    minify_css: { present: false },
    minify_js: { present: false },
    minify_concatenate_js: { present: false },
    preload_links: { present: false },
    rocket_cdn: { present: false },
    mobile_cache: { present: false, variant: null },
    dns_prefetch: { present: false, domains: [] },
    delay_js: { present: false, scripts: [], version: null, delayedScripts: 0 },
    defer_all_js: { present: false, scripts: [], deferredScripts: 0 },
    lazyload: { present: false, images: [] },
    lazyload_iframes: { present: false, replaceImage: false },
    rocket_above_the_fold_optimization: { present: false, lcpComment: false },
    automatic_lazy_rendering: {
      present: false,
      lazyRenderElements: 0,
      inlineCssPresent: false,
      locationHashes: 0
    },
    auto_preload_fonts: { present: false, fonts: [] },
    preconnect_external_domains: { present: false, domains: [], preconnectCount: 0 },
    priority_elements_beacon: { present: false, status: null, isMobile: null }
  };
}

/** The rows carrying page targets (a meta-declared row gains `targets`). */
const TARGET_ROWS: ReadonlySet<FeatureMetaRow> = new Set([
  'lazyload',
  'minify_css',
  'minify_js',
  'self_hosted_fonts',
  'lazyload_iframes',
  'lazyload_css_bg_img'
]);

/**
 * A page with one row meta-declared and nothing on the page for it.
 *
 * @param row The declared row.
 */
function declaredEmpty(row: FeatureMetaRow): WprDetections {
  const detections = handled();
  const entry: { present: boolean; source?: FeatureEvidenceSource; targets?: boolean } =
    detections[row];
  entry.present = true;
  entry.source = 'meta';
  if (TARGET_ROWS.has(row)) entry.targets = false;
  return detections;
}

/** The HUD row of a detection row (throws when absent). */
function feature(row: FeatureMetaRow): HudFeature {
  const found = hudFeatureOf(row);
  if (found === undefined) throw new Error(`no HUD row for ${row}`);
  return found;
}

/** Read one row's state line over a detections set. */
function line(row: FeatureMetaRow, detections: WprDetections): string {
  const reading = readHudFeature(feature(row), describeDetections(detections), detections);
  expect(reading.verdict, row).toBe('applied');
  return hudStateLine(feature(row), reading);
}

/** The rows that carry declared-only copy (the "but …" clause or the neutral note). */
const DECLARED_ONLY_ROWS = HUD_FEATURES.filter(
  (entry) => entry.declaredWithout !== undefined || entry.declaredNote !== undefined
).map((entry) => entry.row);

/**
 * A row's expected declared-only line, from its own copy.
 *
 * @param entry The HUD row.
 */
function expectedLine(entry: HudFeature): string {
  return entry.declaredWithout === undefined
    ? `declared on this render; ${entry.declaredNote ?? ''}.`
    : `declared on this render, but ${entry.declaredWithout}.`;
}

describe('the declared-only rows', () => {
  it('are exactly the rows of the tokens written without a rewrite (mobile cache keeps its own line)', () => {
    const rows = new Set(DECLARED_WITHOUT_REWRITE_TOKENS.map(featureRowForMetaToken));
    rows.delete('mobile_cache');
    expect(new Set(DECLARED_ONLY_ROWS)).toEqual(rows);
    expect(feature('mobile_cache').appliedLine).toBeDefined();
  });

  it('no rewrite-only row carries the copy', () => {
    const rows = REWRITE_ONLY_TOKENS.map(featureRowForMetaToken);
    // `wpr_cache_webp` maps to no row; the six others to their rows.
    expect(rows.filter((row) => row === null)).toHaveLength(1);
    for (const row of rows) {
      if (row !== null) {
        expect(feature(row).declaredWithout, row).toBeUndefined();
        expect(feature(row).declaredNote, row).toBeUndefined();
      }
    }
  });

  it('no row carries both copies, and only Preload Links the neutral note', () => {
    for (const entry of HUD_FEATURES) {
      expect(
        entry.declaredWithout !== undefined && entry.declaredNote !== undefined,
        entry.row
      ).toBe(false);
    }
    expect(
      HUD_FEATURES.filter((entry) => entry.declaredNote !== undefined).map((entry) => entry.row)
    ).toEqual(['preload_links']);
    // A neutral line: no "but …" exception framing.
    expect(line('preload_links', declaredEmpty('preload_links'))).not.toMatch(/\bbut\b/);
  });

  it('every one reads its line when declared with nothing on the page', () => {
    for (const row of DECLARED_ONLY_ROWS) {
      expect(line(row, declaredEmpty(row)), row).toBe(expectedLine(feature(row)));
    }
  });

  it('pins the per-row wording', () => {
    expect(
      Object.fromEntries(DECLARED_ONLY_ROWS.map((row) => [row, line(row, declaredEmpty(row))]))
    ).toEqual({
      delay_js: 'declared on this render, but no script on this page is delayed.',
      defer_all_js:
        'declared on this render, but no external script on this page is deferred by WP Rocket.',
      minify_css: 'declared on this render, but no stylesheet on this page is minified.',
      minify_js: 'declared on this render, but no script on this page is minified.',
      lazyload: 'declared on this render, but no image on this page is lazy-loaded.',
      lazyload_iframes:
        'declared on this render, but no iframe or video on this page is lazy-loaded.',
      lazyload_css_bg_img:
        'declared on this render, but no CSS background image on this page is lazy-loaded.',
      self_hosted_fonts:
        'declared on this render, but no self-hosted font link was found on this page.',
      preload_links:
        'declared on this render; it prefetches links on hover or touch, so the page holds no per-link proof.',
      dns_prefetch:
        'declared on this render, but no dns-prefetch hint on this page names another host.',
      rocket_above_the_fold_optimization:
        'declared on this render, but no critical image on this page is preloaded.',
      auto_preload_fonts: 'declared on this render, but no font on this page is preloaded.',
      preconnect_external_domains:
        'declared on this render, but no external domain on this page is preconnected.'
    });
  });
});

describe('the standard line stays', () => {
  it('with a footprint on the page', () => {
    const page = handled();
    page.delay_js = {
      present: true,
      scripts: [],
      version: null,
      delayedScripts: 2,
      source: 'meta'
    };
    page.minify_css = { present: true, source: 'meta', targets: true };
    page.dns_prefetch = { present: true, domains: ['https://a.example/'], source: 'meta' };
    page.auto_preload_fonts = {
      present: true,
      fonts: ['https://a.example/f.woff2'],
      source: 'meta'
    };
    expect(line('delay_js', page)).toBe('applied on this page: 2 scripts.');
    expect(line('minify_css', page)).toBe('applied on this page.');
    expect(line('dns_prefetch', page)).toMatch(/^applied on this page: 1 domain hinted\. /);
    expect(line('auto_preload_fonts', page)).toBe('applied on this page: 1 font.');
  });

  it('on a footprint-decided row at zero (the footprint is its own proof)', () => {
    const page = handled();
    page.delay_js = {
      present: true,
      scripts: [],
      version: '2.0',
      delayedScripts: 0,
      source: 'footprint'
    };
    page.preload_links = { present: true, source: 'footprint' };
    expect(line('delay_js', page)).toBe('applied on this page: 0 scripts.');
    expect(line('preload_links', page)).toBe('applied on this page.');
  });

  it('on a rewrite-only row declared at zero', () => {
    const page = handled();
    page.automatic_lazy_rendering = {
      present: true,
      lazyRenderElements: 0,
      inlineCssPresent: false,
      locationHashes: 0,
      source: 'meta'
    };
    expect(line('automatic_lazy_rendering', page)).toBe('applied on this page: 0 elements.');
  });

  it('on a declared targets row without the fact (a payload predating the field)', () => {
    const page = handled();
    page.lazyload_iframes = { present: true, replaceImage: false, source: 'meta' };
    expect(line('lazyload_iframes', page)).toBe('applied on this page.');
    page.lazyload = { present: true, images: [], source: 'meta' };
    expect(line('lazyload', page)).toBe('applied on this page: 0 images.');
  });

  it('on image lazyload whose page targets hold something its image count misses', () => {
    const page = handled();
    page.lazyload = { present: true, images: [], source: 'meta', targets: true };
    expect(line('lazyload', page)).toBe('applied on this page: 0 images.');
  });

  it('when the Exclusion Builder emptied the count (its modifier explains it)', () => {
    const page = declaredEmpty('delay_js');
    page.delay_js.builder = { excluded: 3 };
    const reading = readHudFeature(feature('delay_js'), describeDetections(page), page);
    expect(reading.declaredOnly).toBeUndefined();
    expect(hudStateLine(feature('delay_js'), reading)).toBe(
      'applied on this page: 0 scripts. 3 scripts excluded by the Exclusion Builder.'
    );
  });

  it('mobile cache keeps its own declared line', () => {
    const page = handled();
    page.mobile_cache = { present: true, variant: 'desktop', source: 'meta' };
    expect(line('mobile_cache', page)).toMatch(/^applied on this page: rendered for desktop\. /);
  });
});

describe('the declared-only line over the real pass', () => {
  /** A generator meta declaring the given tokens. */
  const meta = (tokens: string): string =>
    `<meta name="generator" content="WP Rocket 3.24" data-wpr-features="${tokens}">`;
  /** One row's state line over a page's HTML. */
  const lineOf = (row: FeatureMetaRow, html: string): string => {
    const { detections } = runDetection(html);
    return line(row, detections);
  };

  it('LazyLoad iframes declared beside its library and options blob, no iframe', () => {
    const html =
      `<html><head>${meta('wpr_lazyload_iframes')}` +
      '<script>window.lazyLoadOptions=[{elements_selector:"iframe[data-lazy-src]"}]</script>' +
      '<script src="https://site.example/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js"></script>' +
      '</head><body></body></html>';
    expect(lineOf('lazyload_iframes', html)).toBe(
      'declared on this render, but no iframe or video on this page is lazy-loaded.'
    );
  });

  it('LazyLoad CSS backgrounds: an empty mapping reads declared-only, a mapped one applied', () => {
    const head = (pairs: string): string =>
      `<html><head>${meta('wpr_lazyload_css_bg_img')}` +
      '<style id="wpr-lazyload-bg-container"></style><style id="wpr-lazyload-bg-exclusion"></style>' +
      `<script>const rocket_pairs = ${pairs}; const rocket_excluded_pairs = [];</script></head><body></body></html>`;
    expect(lineOf('lazyload_css_bg_img', head('[]'))).toBe(
      'declared on this render, but no CSS background image on this page is lazy-loaded.'
    );
    expect(lineOf('lazyload_css_bg_img', head('[{"selector":".a","style":"","hash":"1"}]'))).toBe(
      'applied on this page.'
    );
  });

  describe('LazyLoad for images', () => {
    /** The image lazyload footprint around the given body. */
    const imagesPage = (body: string, tokens = 'wpr_lazyload_images'): string =>
      `<html><head>${meta(tokens)}</head><body>${body}</body></html>`;
    const EMPTY = 'declared on this render, but no image on this page is lazy-loaded.';

    it('reads declared-only with only eager images on the page', () => {
      expect(lineOf('lazyload', imagesPage('<img src="https://a.example/1.jpg">'))).toBe(EMPTY);
    });

    it.each([
      [
        'an inline-style background moved to data-bg',
        '<div class="hero rocket-lazyload" data-bg="https://a.example/bg.jpg" style=""></div>'
      ],
      [
        'a lazy picture source',
        '<picture><source data-lazy-srcset="https://a.example/1.webp" type="image/webp">' +
          '<img src="https://a.example/1.jpg"></picture>'
      ],
      [
        "a native-lazy image (WP Rocket's native filter, or the page's own)",
        '<img src="https://a.example/1.jpg" loading="lazy">'
      ]
    ])('keeps the standard line beside %s, its image count unchanged', (_, body) => {
      const { detections } = runDetection(imagesPage(body));
      const reading = readHudFeature(
        feature('lazyload'),
        describeDetections(detections),
        detections
      );
      expect(reading.count).toBe(0);
      expect(reading.declaredOnly).toBeUndefined();
      expect(hudStateLine(feature('lazyload'), reading)).toBe('applied on this page: 0 images.');
    });

    it("reads declared-only beside a theme's own <noscript> native-lazy image", () => {
      const html = imagesPage(
        '<img src="https://a.example/1.jpg"><noscript><img src="https://a.example/1.jpg" loading="lazy"></noscript>'
      );
      expect(lineOf('lazyload', html)).toBe(EMPTY);
    });

    it('keeps the standard line beside an upper-case native-lazy keyword', () => {
      const html = imagesPage('<img src="https://a.example/1.jpg" LOADING="Lazy">');
      expect(lineOf('lazyload', html)).toBe('applied on this page: 0 images.');
    });

    it('a lazy image keeps its count', () => {
      const html = imagesPage(
        '<img src="data:image/svg+xml,x" data-lazy-src="https://a.example/1.jpg">'
      );
      expect(lineOf('lazyload', html)).toBe('applied on this page: 1 image.');
    });
  });

  describe('under Remove Unused CSS (it strips the stylesheet and font links)', () => {
    /** A page declaring the given tokens with nothing else. */
    const declared = (tokens: string): string =>
      `<html><head>${meta(tokens)}</head><body></body></html>`;

    it('Minify CSS and Self-host Google Fonts keep the standard line', () => {
      const html = declared('wpr_remove_unused_css wpr_minify_css wpr_host_fonts_locally');
      expect(lineOf('minify_css', html)).toBe('applied on this page.');
      expect(lineOf('self_hosted_fonts', html)).toBe('applied on this page.');
    });

    it('without it, both read declared-only; Minify JS reads it either way', () => {
      expect(lineOf('minify_css', declared('wpr_minify_css'))).toBe(
        'declared on this render, but no stylesheet on this page is minified.'
      );
      expect(lineOf('self_hosted_fonts', declared('wpr_host_fonts_locally'))).toBe(
        'declared on this render, but no self-hosted font link was found on this page.'
      );
      expect(lineOf('minify_js', declared('wpr_remove_unused_css wpr_minify_js'))).toBe(
        'declared on this render, but no script on this page is minified.'
      );
    });
  });

  it('Minify JS under Combine reads a plain "not applied" (no declared-only line)', () => {
    const html = `<html><head>${meta('wpr_minify_concatenate_js')}</head><body></body></html>`;
    const { detections } = runDetection(html);
    const reading = readHudFeature(
      feature('minify_js'),
      describeDetections(detections),
      detections
    );
    expect(reading.verdict).toBe('not applied');
    expect(reading.declaredOnly).toBeUndefined();
    expect(hudStateLine(feature('minify_js'), reading)).toBe(
      "WP Rocket's generator meta does not declare it on this page."
    );
  });
});
