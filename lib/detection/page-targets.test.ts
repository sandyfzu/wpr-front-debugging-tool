/**
 * Page targets (`targets`) of the six meta-declared targets rows, over the
 * real pass in both engines: set only on a declared row, true only when the
 * page holds what the feature acts on — never the check's option-markup
 * footprint (the iframe options blob, the background container styles).
 */
import { describe, expect, it } from 'vitest';
import type { PageTargetsRow, WprDetections } from '../wp-rocket/types';
import { runReferenceDetection } from './reference/engine';
import { runDetection } from './run-detection';

/** A generator meta declaring the given tokens. */
function meta(tokens: string): string {
  return `<meta name="generator" content="WP Rocket 3.24" data-wpr-features="${tokens}">`;
}

/** A page around the given head/body markup. */
function page(head: string, body = ''): string {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}

/** Run both engines, assert they agree, return the port's detections. */
function detect(html: string): WprDetections {
  const port = runDetection(html).detections;
  expect(port).toEqual(runReferenceDetection(html).wprDetections);
  return port;
}

/** The iframe lazyload footprint WP Rocket writes whenever the option is on. */
const IFRAME_LAZYLOAD =
  '<script>window.lazyLoadOptions=[{elements_selector:"iframe[data-lazy-src]"}]</script>' +
  '<script async src="https://site.example/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js"></script>';
/** A lazy iframe as WP Rocket rewrites it, with its fallback. */
const LAZY_IFRAME =
  '<iframe src="about:blank" data-rocket-lazyload="fitvidscompatible" data-lazy-src="https://video.example/e/1"></iframe>' +
  '<noscript><iframe src="https://video.example/e/1"></iframe></noscript>';
/** The YouTube preview placeholder that replaces a lazy iframe. */
const YOUTUBE_PLAYER =
  '<div class="rll-youtube-player" data-src="https://www.youtube.com/embed/x" data-id="x"></div>';
/** The background container styles, written even with nothing mapped. */
const BG_CONTAINER =
  '<style id="wpr-lazyload-bg-container"></style><style id="wpr-lazyload-bg-exclusion"></style>';

/**
 * The background mapping script as WP Rocket writes it.
 *
 * @param pairs The mapping's JSON.
 */
function bgPairs(pairs: string): string {
  return `<script type="application/javascript">const rocket_pairs = ${pairs}; const rocket_excluded_pairs = [];</script>`;
}

describe('page targets: LazyLoad for iframes/videos', () => {
  it('declared with the options blob and library but no iframe: no targets (the footprint passes)', () => {
    const d = detect(page(meta('wpr_lazyload_iframes') + IFRAME_LAZYLOAD));
    expect(d.lazyload_iframes).toEqual({
      present: true,
      replaceImage: false,
      source: 'meta',
      targets: false
    });
    // The same markup alone is the row's footprint: the target fact is not it.
    expect(detect(page(IFRAME_LAZYLOAD)).lazyload_iframes.present).toBe(true);
  });

  it('a lazy iframe or a YouTube placeholder is a target', () => {
    const tokens = meta('wpr_lazyload_iframes');
    expect(detect(page(tokens, LAZY_IFRAME)).lazyload_iframes.targets).toBe(true);
    expect(detect(page(tokens, YOUTUBE_PLAYER)).lazyload_iframes.targets).toBe(true);
  });

  it('a plain iframe (or one only inside a fallback) is no target', () => {
    const html = page(
      meta('wpr_lazyload_iframes'),
      '<iframe src="https://video.example/e/1"></iframe><noscript><iframe src="x"></iframe></noscript>'
    );
    expect(detect(html).lazyload_iframes.targets).toBe(false);
  });
});

describe('page targets: <noscript> iframes', () => {
  it('a lazy iframe or YouTube placeholder inside <noscript> is none', () => {
    const d = detect(
      page(
        meta('wpr_lazyload_iframes') + IFRAME_LAZYLOAD,
        `<noscript>${LAZY_IFRAME.replace(/<noscript>.*<\/noscript>/, '')}${YOUTUBE_PLAYER}</noscript>`
      )
    );
    expect(d.lazyload_iframes.targets).toBe(false);
  });
});

describe('page targets: LazyLoad CSS backgrounds', () => {
  it('declared with the container styles and an empty mapping: no targets', () => {
    const d = detect(page(meta('wpr_lazyload_css_bg_img') + BG_CONTAINER + bgPairs('[]')));
    expect(d.lazyload_css_bg_img).toEqual({ present: true, source: 'meta', targets: false });
  });

  it('a whitespace-only mapping is still empty', () => {
    const d = detect(page(meta('wpr_lazyload_css_bg_img') + BG_CONTAINER + bgPairs('[ \n ]')));
    expect(d.lazyload_css_bg_img.targets).toBe(false);
  });

  it('a mapped entry is a target', () => {
    const pairs = '[{"selector":".hero","style":".hero{background:url(a.jpg)}","hash":"1"}]';
    const d = detect(page(meta('wpr_lazyload_css_bg_img') + BG_CONTAINER + bgPairs(pairs)));
    expect(d.lazyload_css_bg_img.targets).toBe(true);
  });

  it('only the excluded mapping filled is no target (nothing is lazy-loaded)', () => {
    const script =
      '<script>const rocket_pairs = []; const rocket_excluded_pairs = [{"selector":".a"}];</script>';
    const d = detect(page(meta('wpr_lazyload_css_bg_img') + BG_CONTAINER + script));
    expect(d.lazyload_css_bg_img.targets).toBe(false);
  });
});

describe('page targets: Self-host Google Fonts and the minify rows', () => {
  it('fonts: the attributed link is a target, no link is none', () => {
    const link =
      '<link rel="stylesheet" data-wpr-hosted-gf-parameters="family=Inter" href="/f.css">';
    const tokens = meta('wpr_host_fonts_locally');
    expect(detect(page(tokens + link)).self_hosted_fonts.targets).toBe(true);
    expect(detect(page(tokens)).self_hosted_fonts.targets).toBe(false);
  });

  it('minify: a cache URL or the stamp alone is a target; neither is none', () => {
    const tokens = meta('wpr_minify_css wpr_minify_js');
    const byUrl = detect(
      page(
        tokens +
          '<link rel="stylesheet" href="https://site.example/wp-content/cache/min/1/a.css">' +
          '<script src="https://site.example/wp-content/cache/min/1/a.js"></script>'
      )
    );
    expect([byUrl.minify_css.targets, byUrl.minify_js.targets]).toEqual([true, true]);
    const byStamp = detect(
      page(
        tokens +
          '<link rel="stylesheet" data-minify="1" href="https://moved.example/a.css">' +
          '<script data-minify="1" src="https://moved.example/a.js"></script>'
      )
    );
    expect([byStamp.minify_css.targets, byStamp.minify_js.targets]).toEqual([true, true]);
    const none = detect(
      page(tokens + '<link rel="stylesheet" href="/a.css"><script src="/a.js"></script>')
    );
    expect([none.minify_css.targets, none.minify_js.targets]).toEqual([false, false]);
  });

  it('under Remove Unused CSS, Minify CSS and the fonts row carry no fact (their links are stripped)', () => {
    const d = detect(
      page(meta('wpr_remove_unused_css wpr_minify_css wpr_minify_js wpr_host_fonts_locally'))
    );
    expect(d.remove_unused_css.present).toBe(true);
    expect('targets' in d.minify_css).toBe(false);
    expect('targets' in d.self_hosted_fonts).toBe(false);
    // Scripts are untouched by it: Minify JS still states its fact.
    expect(d.minify_js.targets).toBe(false);
  });
});

describe('page targets: LazyLoad for images', () => {
  const tokens = meta('wpr_lazyload_images');

  it('only eager images: no targets', () => {
    const d = detect(
      page(tokens, '<img src="https://a.example/1.jpg"><picture><source srcset="x"></picture>')
    );
    expect(d.lazyload.targets).toBe(false);
  });

  it.each([
    ['a lazy image', '<img src="data:image/svg+xml,x" data-lazy-src="https://a.example/1.jpg">'],
    ['a srcset-only lazy image', '<img data-lazy-srcset="https://a.example/1.jpg 1x">'],
    [
      'a lazy picture source',
      '<picture><source data-lazy-srcset="https://a.example/1.webp"><img src="x"></picture>'
    ],
    [
      'a data-bg background',
      '<section class="rocket-lazyload" data-bg="https://a.example/bg.jpg"></section>'
    ],
    ['a native-lazy image', '<img src="https://a.example/1.jpg" loading="lazy">']
  ])('%s is a target', (_, body) => {
    expect(detect(page(tokens, body)).lazyload.targets).toBe(true);
  });

  it.each([
    ['upper case', 'LAZY'],
    ['mixed case', 'Lazy'],
    ['padded', ' lazy ']
  ])('a native-lazy keyword in %s is a target (the keyword is case-insensitive)', (_, value) => {
    const body = `<img src="https://a.example/1.jpg" LOADING="${value}">`;
    expect(detect(page(tokens, body)).lazyload.targets).toBe(true);
  });

  it('an eager, auto or empty loading keyword is none', () => {
    const body =
      '<img src="x" loading="eager"><img src="y" loading="auto"><img src="z" loading="">' +
      '<img src="w" loading="lazy-ish">';
    expect(detect(page(tokens, body)).lazyload.targets).toBe(false);
  });

  it('targets inside <noscript> never count (a raw parse exposes the fallback as elements)', () => {
    const body =
      '<noscript><img src="https://a.example/1.jpg" loading="lazy"></noscript>' +
      '<noscript><img data-lazy-src="https://a.example/2.jpg"><div class="rocket-lazyload" data-bg="u"></div>' +
      '<picture><source data-lazy-srcset="v"></picture></noscript>';
    expect(detect(page(tokens, body)).lazyload.targets).toBe(false);
    // The same target outside the fallback counts.
    const both = `${body}<img src="https://a.example/1.jpg" loading="lazy">`;
    expect(detect(page(tokens, both)).lazyload.targets).toBe(true);
  });

  it('a data-bg without the lazy class, or a lazy class without data-bg, is none', () => {
    const d = detect(
      page(
        tokens,
        '<div data-bg="https://a.example/bg.jpg"></div><div class="rocket-lazyload"></div>'
      )
    );
    expect(d.lazyload.targets).toBe(false);
  });
});

describe('page targets: only on a meta-declared targets row', () => {
  const ROWS: readonly PageTargetsRow[] = [
    'lazyload',
    'minify_css',
    'minify_js',
    'self_hosted_fonts',
    'lazyload_iframes',
    'lazyload_css_bg_img'
  ];

  it('a refuted row, an undeclared footprint row and a meta-less page carry no field', () => {
    const markup = IFRAME_LAZYLOAD + BG_CONTAINER + bgPairs('[{"selector":".a"}]');
    for (const html of [page(meta('wpr_cdn') + markup, LAZY_IFRAME), page(markup, LAZY_IFRAME)]) {
      const d = detect(html);
      for (const row of ROWS) expect('targets' in d[row], row).toBe(false);
    }
  });

  it('a degraded declaration decides nothing, so it stamps nothing', () => {
    const d = detect(page(meta('x'.repeat(5000)) + IFRAME_LAZYLOAD, LAZY_IFRAME));
    expect('targets' in d.lazyload_iframes).toBe(false);
  });

  it('no other row ever carries the field, every token declared', () => {
    const all =
      'wpr_delay_js wpr_defer_js wpr_minify_js wpr_minify_css wpr_lazyload_images wpr_lazyload_iframes ' +
      'wpr_lazyload_css_bg_img wpr_oci wpr_preload_links wpr_desktop wpr_async_css ' +
      'wpr_cdn wpr_image_dimensions wpr_host_fonts_locally wpr_automatic_lazy_rendering ' +
      'wpr_auto_preload_fonts wpr_preconnect_external_domains wpr_minify_concatenate_js wpr_dns_prefetch';
    /** The rows carrying the field over one page. */
    const carrying = (tokens: string): string[] => {
      const d = detect(page(meta(tokens)));
      return (Object.keys(d) as Array<keyof WprDetections>).filter((row) => 'targets' in d[row]);
    };
    expect(carrying(all).sort()).toEqual([...ROWS].sort());
    // Remove Unused CSS on top withholds the two rows whose links it strips.
    expect(carrying(`${all} wpr_remove_unused_css`).sort()).toEqual(
      ROWS.filter((row) => row !== 'minify_css' && row !== 'self_hosted_fonts').sort()
    );
  });
});
