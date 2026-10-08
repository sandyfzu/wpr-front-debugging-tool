/**
 * Per-check unit tests over tiny inline documents — every true/false branch
 * the corpus does not exercise live (RocketCDN, the CSS-background container,
 * the CPCSS fallback, the current Delay JS type, uncached cases), the
 * quirky-but-intended behaviors pinned, and the orchestrator's propagation +
 * timing contract. Runner-visible divisor cases are documented inline where
 * the test runner's DOM behaves differently from Chromium.
 */
import { describe, expect, it } from 'vitest';
import { parsePage } from './parse-page';
import { detectWpr } from './detect-wpr';
import {
  detectAboveTheFold,
  detectAsyncCss,
  detectDeferAllJs,
  detectDelayJs,
  detectLazyload,
  detectLazyloadIframes,
  detectMinifyCss,
  detectMinifyJs,
  detectPreloadLinks,
  detectPreloadedResources,
  detectRemoveUnusedCss,
  detectRocketCdn
} from './detect-optimizations';
import { runDetection } from './run-detection';
import { DELAY_JS_TYPES, isDelayJSType, LAZYLOAD_EXCLUSIONS_LIST } from '../wp-rocket/constants';

function page(html: string) {
  return parsePage(html);
}

describe('isDelayJSType / selector / types', () => {
  it('matches both type variants and nothing else', () => {
    for (const variant of DELAY_JS_TYPES) {
      expect(isDelayJSType(variant)).toBe(true);
    }
    expect(isDelayJSType('text/javascript')).toBe(false);
    expect(isDelayJSType(null)).toBe(false);
    expect(isDelayJSType(undefined)).toBe(false);
    // The old value is a substring of the new one; both flag on includes().
    expect(isDelayJSType('rocketlazyloadscript-evil')).toBe(true);
  });
});

describe('detectWpr', () => {
  it('extracts the version from generator meta and keys presence on it', () => {
    expect(
      detectWpr(page('<meta name="generator" content="WP Rocket 3.20.0.2">').document)
    ).toEqual({
      present: true,
      cached: false,
      version: '3.20.0.2',
      timeStamp: null
    });
    expect(
      detectWpr(page('<meta name="generator" content="WP-Rocket 3.12.1.1">').document).version
    ).toBe('3.12.1.1');
    expect(
      detectWpr(page('<meta name="generator" content="WP Rocket v3.20">').document).version
    ).toBe('3.20');
    // A non-WP-Rocket generator stays absent.
    expect(detectWpr(page('<meta name="generator" content="WPML 4.7.2">').document).present).toBe(
      false
    );
    // A generator mentioning rocket without a version: presence follows the
    // extracted version only, so it stays false here too.
    expect(detectWpr(page('<meta name="generator" content="rocket power">').document)).toEqual({
      present: false,
      cached: false,
      version: null,
      timeStamp: null
    });
  });

  it('reads the cache debug comment after the document element', () => {
    const result = detectWpr(
      page(
        '<html><body>t</body></html><!-- This website is like a Rocket, optimized by WP Rocket - Debug: cached@1699999999 -->'
      ).document
    );
    expect(result).toEqual({ present: true, cached: true, version: null, timeStamp: 1699999999 });
    // Comment present in body-content position is NOT the cache marker
    // (the marker lives as a sibling *after* the document element).
    expect(
      detectWpr(
        page(
          '<html><body><!-- not here --></body></html><!-- This website is like a Rocket, optimized -->'
        ).document
      )
    ).toEqual({ present: true, cached: false, version: null, timeStamp: null });
  });

  it('walks past element/text siblings until the comment', () => {
    const result = detectWpr(
      page('<html><body>a</body></html><span>noise</span><!-- This website is like a Rocket -->')
        .document
    );
    expect(result.present).toBe(true);
  });

  it('parses truncated timestamps by digits (endsWith is not required)', () => {
    expect(
      detectWpr(
        page(
          '<html><body>x</body></html><!-- This website is like a Rocket - Debug: cached@999abc -->'
        ).document
      ).timeStamp
    ).toBe(999);
  });

  it('non-numeric suffixes keep the timestamp null (never NaN)', () => {
    expect(
      detectWpr(
        page(
          '<html><body>x</body></html><!-- This website is like a Rocket - Debug: cached@abc -->'
        ).document
      ).timeStamp
    ).toBeNull();
  });

  it('the documented radix delta: 0x-prefixed suffixes parse as 0 (reference would read 31)', () => {
    expect(
      detectWpr(
        page(
          '<html><body>x</body></html><!-- This website is like a Rocket - Debug: cached@0x1F -->'
        ).document
      ).timeStamp
    ).toBe(0);
  });

  it('a Debug marker without a timestamp keeps the page present but not stamped', () => {
    expect(
      detectWpr(
        page('<html><body>x</body></html><!-- This website is like a Rocket - Debug: cached -->')
          .document
      )
    ).toEqual({ present: true, cached: true, version: null, timeStamp: null });
  });
});

describe('detectRemoveUnusedCss / detectPreloadLinks / ids', () => {
  const html =
    '<style id="wpr-usedcss">.c{}</style><div id="wpr-lazyload-bg-container"></div><script id="rocket-preload-links-js-extra">x</script>';
  const parsed = page(html);
  it('checks the reserved style element', () => {
    expect(detectRemoveUnusedCss(parsed)).toEqual({ present: true });
    // Same id on a non-style element is not RUCSS.
    expect(detectRemoveUnusedCss(page('<div id="wpr-usedcss"></div>'))).toEqual({ present: false });
  });
  it('requires the preload-links blob id regardless of tag', () => {
    expect(detectPreloadLinks(parsed)).toEqual({ present: true });
    expect(detectPreloadLinks(page('<span></span>'))).toEqual({ present: false });
  });
  it('finds either lazyload-css-background container id', () => {
    expect(
      runDetection('<div id="wpr-lazyload-bg-exclusion"></div>').detections.lazyload_css_bg_img
    ).toEqual({
      present: true
    });
  });
});

describe('detectAsyncCss', () => {
  it('marks the inline fallback regardless of surrounding markup', () => {
    expect(detectAsyncCss(page('<script>wprRemoveCPCSS && wprRemoveCPCSS();</script>'))).toEqual({
      present: true
    });
    // On a src script the same text does not count.
    expect(detectAsyncCss(page('<script src="/c.js">wprRemoveCPCSS()</script>'))).toEqual({
      present: false
    });
  });
});

describe('detectDelayJs', () => {
  it('classifies delayed/inline/deferred scripts exactly', () => {
    const parsed = page(
      `<html><body>
        <script>var RocketLazyLoadScripts=function(){this.v="3.20.6"};</script>
        <script type="rocketlazyloadscript" data-rocket-src="/old.js"></script>
        <script src="/plain.js" defer="defer"></script>
        <script>var inline = true;</script>
      </body></html>`
    );
    const result = detectDelayJs(parsed);
    expect(result.present).toBe(true);
    expect(result.version).toBe('3.20.6');
    expect(result.delayedScripts).toBe(1);
    expect(result.scripts).toEqual([
      {
        inline: true,
        delayed: false,
        deferred: false,
        deferredByWPR: false,
        fdtExcluded: null,
        content: 'var RocketLazyLoadScripts=function(){this.v="3.20.6"};'
      },
      {
        inline: false,
        delayed: true,
        deferred: false,
        deferredByWPR: false,
        fdtExcluded: null,
        src: '/old.js'
      },
      {
        inline: false,
        delayed: false,
        deferred: true,
        deferredByWPR: false,
        fdtExcluded: null,
        src: '/plain.js'
      },
      {
        inline: true,
        delayed: false,
        deferred: false,
        deferredByWPR: false,
        fdtExcluded: null,
        content: 'var inline = true;'
      }
    ]);
  });

  it('keeps controllers without version markers present-but-versionless', () => {
    const result = detectDelayJs(page('<script>new RocketLazyLoadScripts({});</script>'));
    expect(result.present).toBe(true);
    expect(result.version).toBeNull();
  });
});

describe('detectDeferAllJs', () => {
  it('falls back to data-rocket-src then src, dropping empties', () => {
    const result = detectDeferAllJs(
      page(
        `<html><body>
          <script src="/real.js" data-rocket-defer="defer"></script>
          <script data-rocket-src="/moved.js" data-rocket-defer="defer"></script>
          <script data-rocket-defer="defer"></script>
        </body></html>`
      )
    );
    expect(result).toEqual({ present: true, scripts: ['/real.js', '/moved.js'] });
    // Deferral markers alone do not count as present.
    expect(detectDeferAllJs(page('<script data-rocket-defer="defer"></script>'))).toEqual({
      present: false,
      scripts: []
    });
  });
});

describe('detectLazyload', () => {
  it('needs both the script file and the options blob', () => {
    expect(
      detectLazyload(
        page('<script src="/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js"></script>')
      ).present
    ).toBe(false);
    expect(
      detectLazyload(page('<script>window.lazyLoadOptions=[];img[data-lazy-src]</script>')).present
    ).toBe(false);
    expect(
      detectLazyload(
        page(
          '<script src="/h/wp-rocket/assets/js/lazyload/16.1/lazyload.min.js"></script><script>window.lazyLoadOptions=[{e:"img[data-lazy-src]"}]</script>'
        )
      ).present
    ).toBe(true);
    // Non-minified URLs match too.
    expect(
      detectLazyload(
        page(
          '<script src="/wp-rocket/assets/js/lazyload/12.0.1/lazyload.js"></script><script>window.lazyLoadOptions=x img[data-lazy-src] q</script>'
        )
      ).present
    ).toBe(true);
  });

  it('stops the reverse scan after both footprints are found (order-independent)', () => {
    // The blob fires before the script in reverse order — both must be found.
    const result = detectLazyload(
      page(
        '<body><script>window.lazyLoadOptions=a img[data-lazy-src] a</script><img><script src="/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js"></script></body>'
      )
    );
    expect(result.present).toBe(true);
  });

  it('the reverse scan breaks before exhausting long tails once both footprints hit', () => {
    // Doc order [blob, blob2, file]: reversed [file, blob2, blob] — both set
    // by index 1, so the top-of-loop break fires before the last walk step.
    const result = detectLazyload(
      page(
        '<body><script>window.lazyLoadOptions=a img[data-lazy-src] a</script><script>window.lazyLoadOptions=b img[data-lazy-src] b</script><script src="/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js"></script><img src="/1.jpg"><img src="/2.jpg"></body>'
      )
    );
    expect(result.present).toBe(true);
    expect(result.images.length).toBe(2);
  });

  it('builds image records: replacement URL, fallback chain, exclusions', () => {
    const result = detectLazyload(
      page(
        `<html><body>
          <img data-lazy-src="/lazy.jpg" src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E">
          <img data-lazy-srcset="/only-srcset.jpg 1x" src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E">
          <img data-src="/data-src.jpg" data-skip-lazy="1" src="https://cdn.example/shown.jpg">
          <img src="https://cdn.example/plain.jpg" loading="eager">
          <img data-lazy-original="/orig.jpg" src="https://cdn.example/fullurl.jpg">
        </body></html>`
      )
    );
    expect(result.images).toEqual([
      { src: '/lazy.jpg', lazyloadDetected: true, excludedReasonsFound: [] },
      { src: '', lazyloadDetected: true, excludedReasonsFound: [] },
      {
        src: '/data-src.jpg',
        lazyloadDetected: false,
        excludedReasonsFound: ['data-src', 'data-skip-lazy', 'skip-lazy']
      },
      {
        src: 'https://cdn.example/plain.jpg',
        lazyloadDetected: false,
        excludedReasonsFound: ['loading="eager"']
      },
      {
        src: 'https://cdn.example/fullurl.jpg',
        lazyloadDetected: false,
        excludedReasonsFound: ['data-lazy-original', 'fullurl']
      }
    ]);
  });

  it('walks the exclusion list in list order', () => {
    expect(LAZYLOAD_EXCLUSIONS_LIST.length).toBe(24);
    expect(LAZYLOAD_EXCLUSIONS_LIST[0]).toBe('data-src');
    expect(LAZYLOAD_EXCLUSIONS_LIST.at(-1)).toBe('data-wpr-fdt-excluded');
  });

  it('the options regexes do not cross line breaks (the served shape is single-line)', () => {
    // The regexes have no `/s` flag: a newline between the blob's start and
    // the `img[data-lazy-src]` tail breaks the match in BOTH engines — the
    // reference implementation behaves exactly the same.
    const multiLineBlob = page(
      '<script>window.lazyLoadOptions=[{e:"a"}],\nimg[data-lazy-src] tail</script><script src="/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js"></script>'
    );
    expect(detectLazyload(multiLineBlob).present).toBe(false);
    expect(detectLazyloadIframes(multiLineBlob).present).toBe(false);
  });

  it('runner variance (documented): happy-dom drops scripts whose text embeds `<` byte runs', () => {
    // Real Chromium parses `<script>for(var k=0;k<3;k++){};</script>` fine
    // (spec: script data treats a lone `<` + non-tag byte as text) and so
    // did the reference tool at runtime. The happy-dom parser swallows the
    // whole element — an offline-test limitation, not target-engine
    // behavior; some fixture pages contain such code (minified controllers,
    // the PSI shell), so their per-check COUNTS reflect the runner's parse.
    // P15's scripted real-browser protocol is the absolute re-verification.
    const swallowed = page(
      '<body><script>for(var k=0;k<3;k++){}</script><img data-lazy-src="/a.jpg"></body>'
    );
    expect(swallowed.document.querySelectorAll('script').length).toBe(0);
  });
});

describe('detectLazyloadIframes', () => {
  it('requires script+blob and detects the youtube replacement script', () => {
    const both = page(
      `<html><body>
        <script src="/x/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js"></script>
        <script>window.lazyLoadOptions=1 iframe[data-lazy-src]</script>
        <script>function lazyLoadThumb(e)(){x}function lazyLoadYoutubeIframe()(){y}</script>
      </body></html>`
    );
    expect(detectLazyloadIframes(both)).toEqual({ present: true, replaceImage: true });
    expect(
      detectLazyloadIframes(page('<script>function lazyLoadThumb(){x}</script>')).present
    ).toBe(false);
  });
});

describe('detectMinifyCss / detectMinifyJs', () => {
  it('matches only stylesheet + script URLs of the minify cache shape', () => {
    const parsed = page(
      `<html><head>
        <link rel="stylesheet" href="https://s.com/wp-content/cache/min/1/wp-content/themes/style-a1.css?ver=2">
        <link rel="stylesheet" href="https://s.com/wp-content/cache/min/1/wp-content/themes/style-b.css">
        <link rel="STYLESHEET" href="https://s.com/wp-content/cache/min/1/style-c.css">
        <link rel="stylesheet" href="https://s.com/cache/min/1/x.css">
      </head></html>`
    );
    expect(detectMinifyCss(parsed)).toEqual({ present: true });
    // Attribute case is preserved, and the check compares it verbatim.
    const upperOnly = page(
      '<link rel="STYLESHEET" href="https://s.com/wp-content/cache/min/1/a.css">'
    );
    expect(detectMinifyCss(upperOnly)).toEqual({ present: false });
    // The b-number position requires an alphanumeric id: a leading dash
    // cannot open the hash segment.
    const dashId = page(
      '<link rel="stylesheet" href="https://s.com/wp-content/cache/min/1/-1.css">'
    );
    expect(detectMinifyCss(dashId)).toEqual({ present: false });
    const singleChar = page(
      '<link rel="stylesheet" href="https://s.com/wp-content/cache/min/1/x.css">'
    );
    expect(detectMinifyCss(singleChar)).toEqual({ present: true });
    const wrongShape = page(
      '<link rel="stylesheet" href="https://s.com/wp-content/cache/max/1/a.css">'
    );
    expect(detectMinifyCss(wrongShape)).toEqual({ present: false });
  });

  it('checks scripts against resolved sources', () => {
    const parsed = page('<script src="https://s.com/wp-content/cache/min/1/app-99.js"></script>');
    expect(detectMinifyJs(parsed)).toEqual({ present: true });
    expect(detectMinifyJs(page('<script>app.min.js</script>'))).toEqual({ present: false });
  });
});

describe('detectRocketCdn', () => {
  it('requires a dns-prefetch hint to the CDN domain', () => {
    expect(
      detectRocketCdn(page('<link rel="dns-prefetch" href="https://cdn.rocketcdn.me">'))
    ).toEqual({
      present: true
    });
    expect(
      detectRocketCdn(page('<link rel="dns-prefetch" href="https://cdn.other-cdn.me">'))
    ).toEqual({
      present: false
    });
    // dns-prefetch hints elsewhere do not count: the URL decides.
    expect(detectRocketCdn(page('<link rel="preload" href="https://rocketcdn.me/x.js">'))).toEqual({
      present: false
    });
  });

  it('links without a rel attribute never match (presence path)', () => {
    expect(detectRocketCdn(page('<link href="https://cdn.rocketcdn.me/x.js">'))).toEqual({
      present: false
    });
  });

  it('chromium semantics: dns-prefetch matches case-insensitively (runner variance documented)', () => {
    // The port classification is case-insensitive whole-value (matches
    // Chromium's CSS attribute rules for rel). Real markup is lowercase;
    // on the test runner without full CSS case-insensitivity the reference
    // engine is stricter — parity fixtures therefore use canonical markup.
    expect(
      detectRocketCdn(page('<link rel="Dns-Prefetch" href="https://cdn.rocketcdn.me">'))
    ).toEqual({
      present: true
    });
  });
});

describe('detectAboveTheFold / detectPreloadedResources', () => {
  const html = `<html><head>
      <link data-rocket-preload href="https://s.com/hero.webp" as="image">
      <link data-rocket-preload href="https://s.com/logo.png" as="image">
      <link data-rocket-preload href="https://s.com/app.js" as="script">
    </head></html>`;
  it('reports preloaded images with the link list when there is no beacon', () => {
    const parsed = page(html);
    expect(detectAboveTheFold(parsed)).toEqual({
      present: true,
      beacon: false,
      preloadedImages: ['https://s.com/hero.webp', 'https://s.com/logo.png']
    });
    expect(detectPreloadedResources(parsed)).toEqual({
      present: true,
      resources: [
        { href: 'https://s.com/hero.webp', type: 'image' },
        { href: 'https://s.com/logo.png', type: 'image' },
        { href: 'https://s.com/app.js', type: 'script' }
      ]
    });
  });

  it('the beacon wins over the image list entirely', () => {
    const parsed = page(
      `<html><head>
        <link data-rocket-preload href="https://s.com/hero.webp" as="image">
        <script data-name="wpr-wpr-beacon" src="/beacon.js"></script>
      </head></html>`
    );
    expect(detectAboveTheFold(parsed)).toEqual({ present: true, beacon: true });
  });

  it('marks case-sensitively: only as="image" counts for critical images', () => {
    const result = detectAboveTheFold(page('<link data-rocket-preload href="/x.jpg" AS="IMAGE">'));
    expect(result).toEqual({ present: false, beacon: false });
  });
});

describe('run-detection — propagation and timing', () => {
  it('propagates presence of any optimization into wpr (except deferrals)', () => {
    const result = runDetection('<style id="wpr-usedcss"></style>');
    expect(result.detections.wpr.present).toBe(true);
    expect(result.detections.wpr.version).toBeNull();

    // defer_all_js alone must NOT imply presence.
    const deferredOnly = runDetection('<script src="/x.js" data-rocket-defer="defer"></script>');
    expect(deferredOnly.detections.defer_all_js.present).toBe(true);
    expect(deferredOnly.detections.wpr.present).toBe(false);
  });

  it('returns every detection key in reference order, with timing', () => {
    const result = runDetection('<body><img></body>');
    expect(Object.keys(result.detections)).toEqual([
      'wpr',
      'remove_unused_css',
      'async_css',
      'delay_js',
      'defer_all_js',
      'lazyload',
      'lazyload_iframes',
      'lazyload_css_bg_img',
      'rocket_above_the_fold_optimization',
      'minify_css',
      'minify_js',
      'preload_links',
      'rocket_cdn'
    ]);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.preloadedResources).toEqual({ present: false });
  });

  it('rejects non-string input loud and early', () => {
    expect(() => parsePage(null as unknown as string)).toThrow(TypeError);
  });
});
