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
  detectAsyncCss,
  delayedOriginalType,
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
import { detectOptimizeCriticalImages } from './priority-elements';
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
      cacheMarkerFound: false,
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
      cacheMarkerFound: false,
      cached: false,
      version: null,
      timeStamp: null
    });
  });

  it('reads the cache debug comment after the document element', () => {
    const result = detectWpr(
      page(
        "<html><body>t</body></html><!-- This website is like a Rocket, isn't it? Performance optimized by WP Rocket - Debug: cached@1699999999 -->"
      ).document
    );
    expect(result).toEqual({
      present: true,
      cacheMarkerFound: true,
      cached: true,
      version: null,
      timeStamp: 1699999999
    });
  });

  it('the marker must be a comment after the document element', () => {
    // A marker inside <body> is page content, not the plugin's footer.
    expect(
      detectWpr(
        page(
          "<html><body><!-- This website is like a Rocket, isn't it? - Debug: cached@1 --></body></html>"
        ).document
      )
    ).toEqual({
      present: false,
      cacheMarkerFound: false,
      cached: false,
      version: null,
      timeStamp: null
    });
  });

  it('a prefixed comment or the bare slogan is not the marker', () => {
    for (const comment of [
      'a note: This website is like a Rocket',
      'This website is like a Rocket',
      'Copied: Cached for great performance'
    ]) {
      const result = detectWpr(page(`<html><body>x</body></html><!-- ${comment} -->`).document);
      expect(result.cacheMarkerFound, comment).toBe(false);
      expect(result.present, comment).toBe(false);
    }
  });

  it('tolerates leading whitespace in the footer comment', () => {
    const result = detectWpr(
      page(
        "<html><body>x</body></html><!--   This website is like a Rocket, isn't it? - Debug: cached@7 -->"
      ).document
    );
    expect(result.cacheMarkerFound).toBe(true);
    expect(result.timeStamp).toBe(7);
  });

  it('recognises the white-label footers', () => {
    const cached = detectWpr(
      page(
        '<html><body>x</body></html><!-- Cached for great performance - Debug: cached@1791342241 -->'
      ).document
    );
    expect(cached).toMatchObject({
      present: true,
      cacheMarkerFound: true,
      cached: true,
      timeStamp: 1791342241
    });
    const optimized = detectWpr(
      page('<html><body>x</body></html><!-- Optimized for great performance -->').document
    );
    expect(optimized).toMatchObject({
      present: true,
      cacheMarkerFound: true,
      cached: false,
      timeStamp: null
    });
  });

  it('walks past element/text siblings until the comment', () => {
    const result = detectWpr(
      page(
        "<html><body>a</body></html><span>noise</span><!-- This website is like a Rocket, isn't it? -->"
      ).document
    );
    expect(result.present).toBe(true);
  });

  it('parses only a strict decimal timestamp token', () => {
    for (const suffix of ['999abc', '0x1F', '-5', '1.5', 'abc', '']) {
      expect(
        detectWpr(
          page(
            `<html><body>x</body></html><!-- This website is like a Rocket, isn't it? - Debug: cached@${suffix} -->`
          ).document
        ).timeStamp,
        suffix
      ).toBeNull();
    }
    expect(
      detectWpr(
        page(
          `<html><body>x</body></html><!-- This website is like a Rocket, isn't it? - Debug: cached@${'9'.repeat(400)} -->`
        ).document
      ).timeStamp
    ).toBeNull();
  });

  it('a Debug marker without a timestamp keeps the page present but not stamped', () => {
    expect(
      detectWpr(
        page(
          "<html><body>x</body></html><!-- This website is like a Rocket, isn't it? - Debug: cached -->"
        ).document
      )
    ).toEqual({
      present: true,
      cacheMarkerFound: true,
      cached: true,
      version: null,
      timeStamp: null
    });
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

  it('the inline config identifier is a second signal only when it repeats', () => {
    expect(
      detectPreloadLinks(
        page('<script>var RocketPreloadLinksConfig={a:1};x(RocketPreloadLinksConfig)</script>')
      )
    ).toEqual({ present: true });
    // One incidental mention is not the feature.
    expect(
      detectPreloadLinks(page('<script>var note="RocketPreloadLinksConfig"</script>'))
    ).toEqual({ present: false });
  });
  it('finds either lazyload-css-background container id', () => {
    expect(
      runDetection('<div id="wpr-lazyload-bg-exclusion"></div>').detections.lazyload_css_bg_img
    ).toEqual({
      present: true,
      source: 'footprint'
    });
  });
});

describe('detectAsyncCss', () => {
  // WP Rocket's swapped link, attribute order as the plugin writes it.
  const swapped = (attrs = 'data-rocket-async="style"', rel = 'preload') =>
    `<link rel='${rel}' href='https://s.example/a.css' ${attrs} as="style" onload="this.onload=null;this.rel='stylesheet'" media='all' />`;

  it('marks the inline fallback regardless of surrounding markup', () => {
    expect(detectAsyncCss(page('<script>wprRemoveCPCSS && wprRemoveCPCSS();</script>'))).toEqual({
      present: true,
      criticalStyle: false
    });
    // On a src script the same text does not count.
    expect(detectAsyncCss(page('<script src="/c.js">wprRemoveCPCSS()</script>'))).toEqual({
      present: false,
      criticalStyle: false
    });
    // Arbitrary page text is not the fallback script.
    expect(detectAsyncCss(page('<p>wprRemoveCPCSS</p>'))).toEqual({
      present: false,
      criticalStyle: false
    });
  });

  it('marks the async-swapped link alone, before and after its load flips rel', () => {
    expect(detectAsyncCss(page(swapped())).present).toBe(true);
    expect(detectAsyncCss(page(swapped(undefined, 'stylesheet'))).present).toBe(true);
    // Read by the attribute, never by rel: any rel carrying the stamp counts.
    expect(detectAsyncCss(page(swapped(undefined, 'alternate'))).present).toBe(true);
  });

  it('counts only the exact stamp value', () => {
    for (const attrs of [
      'data-rocket-async="script"',
      'data-rocket-async=""',
      'data-rocket-async',
      'data-rocket-async="Style"',
      'data-rocket-async=" style"',
      'data-async="style"'
    ]) {
      expect(detectAsyncCss(page(swapped(attrs))).present, attrs).toBe(false);
    }
    // A plain preload (no stamp) is any page's resource hint.
    expect(detectAsyncCss(page(swapped(''))).present).toBe(false);
  });

  it('never counts a stamped link inside <noscript>', () => {
    expect(detectAsyncCss(page(`<body><noscript>${swapped()}</noscript></body>`)).present).toBe(
      false
    );
  });

  it('records the critical-path style as a fact, never as the verdict', () => {
    const critical = '<style id="rocket-critical-css">body{margin:0}</style>';
    expect(detectAsyncCss(page(critical))).toEqual({ present: false, criticalStyle: true });
    expect(detectAsyncCss(page(critical + swapped()))).toEqual({
      present: true,
      criticalStyle: true
    });
    // Another element with the id, or a fallback copy, is not the style.
    expect(detectAsyncCss(page('<div id="rocket-critical-css"></div>')).criticalStyle).toBe(false);
    expect(
      detectAsyncCss(page(`<body><noscript>${critical}</noscript></body>`)).criticalStyle
    ).toBe(false);
  });

  it('sees no <noscript> link in a live capture (scripting-on serialization)', () => {
    // A scripting-on document holds <noscript> content as one text node
    // (built here directly); the capture serializes it escaped, so the
    // re-parse holds no element — while a raw-HTML parse does.
    const live = document.implementation.createHTMLDocument('');
    live.body.innerHTML = '<noscript></noscript>';
    live.querySelector('noscript')?.append(swapped());
    const captured = page(new XMLSerializer().serializeToString(live));
    expect(captured.links).toHaveLength(0);
    expect(page(`<body><noscript>${swapped()}</noscript></body>`).links).toHaveLength(1);
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
        minifyAttribute: false,
        content: 'var RocketLazyLoadScripts=function(){this.v="3.20.6"};'
      },
      {
        inline: false,
        delayed: true,
        deferred: false,
        deferredByWPR: false,
        fdtExcluded: null,
        minifyAttribute: false,
        src: '/old.js'
      },
      {
        inline: false,
        delayed: false,
        deferred: true,
        deferredByWPR: false,
        fdtExcluded: null,
        minifyAttribute: false,
        src: '/plain.js'
      },
      {
        inline: true,
        delayed: false,
        deferred: false,
        deferredByWPR: false,
        fdtExcluded: null,
        minifyAttribute: false,
        content: 'var inline = true;'
      }
    ]);
  });

  it('stamps the minify attribute per script, exact "1" only, delayed tags included', () => {
    const result = detectDelayJs(
      page(
        `<script data-minify="1" src="/a.js"></script>
        <script type="rocketlazyloadscript" data-minify="1" data-rocket-src="/b.js"></script>
        <script data-minify="1">var inline = 1;</script>
        <script data-minify="" src="/c.js"></script>
        <script data-minify="0" src="/d.js"></script>
        <script data-minify="true" src="/e.js"></script>
        <script data-minify src="/f.js"></script>
        <script data-no-minify="1" src="/g.js"></script>
        <script src="/h.js"></script>`
      )
    );
    expect(result.scripts.map((script) => script.minifyAttribute)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false
    ]);
  });

  it('carries the parked original type on still-delayed scripts only, non-empty values only', () => {
    const result = detectDelayJs(
      page(
        `<script type="rocketlazyloadscript" data-rocket-type="module" data-rocket-src="/m.js"></script>
        <script type="text/rocketlazyloadscript" data-rocket-type="text/javascript">a();</script>
        <script type="rocketlazyloadscript" data-rocket-type=" ">b();</script>
        <script type="rocketlazyloadscript" data-rocket-type="" data-rocket-src="/e.js"></script>
        <script type="rocketlazyloadscript" data-rocket-type data-rocket-src="/v.js"></script>
        <script type="rocketlazyloadscript" data-rocket-src="/n.js"></script>
        <script type="module" data-rocket-type="module" src="/ran.js"></script>
        <script data-rocket-type="text/javascript">c();</script>`
      )
    );
    expect(result.scripts.map((script) => script.originalType)).toEqual([
      'module',
      'text/javascript',
      ' ',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    ]);
    // Absent means no key at all: the record stays key-for-key with the reference.
    expect(result.scripts.filter((script) => 'originalType' in script)).toHaveLength(3);
  });

  it('reads an original type exactly as parked, else null', () => {
    const script = (attrs: string): Element => {
      const found = page(`<script ${attrs}></script>`).scripts[0];
      if (found === undefined) throw new Error(`no script parsed from ${attrs}`);
      return found;
    };
    expect(delayedOriginalType(script('data-rocket-type="module"'))).toBe('module');
    expect(delayedOriginalType(script('data-rocket-type="Text/JavaScript "'))).toBe(
      'Text/JavaScript '
    );
    expect(delayedOriginalType(script('data-rocket-type=""'))).toBeNull();
    expect(delayedOriginalType(script('data-rocket-type'))).toBeNull();
    expect(delayedOriginalType(script('type="module"'))).toBeNull();
  });

  it('keeps controllers without version markers present-but-versionless', () => {
    const result = detectDelayJs(page('<script>new RocketLazyLoadScripts({});</script>'));
    expect(result.present).toBe(true);
    expect(result.version).toBeNull();
  });

  it('reads the version from the minified class shape too (one this.v pattern)', () => {
    const result = detectDelayJs(
      page('<script>class RocketLazyLoadScripts{constructor(){this.v="2.0.5"}}</script>')
    );
    expect(result.present).toBe(true);
    expect(result.version).toBe('2.0.5');
  });

  it('a runtime status attribute proves presence without a controller', () => {
    const result = detectDelayJs(
      page('<script src="/app.js" data-rocket-status="executed"></script>')
    );
    expect(result.present).toBe(true);
    // The inventory still carries the script.
    expect(result.scripts).toHaveLength(1);
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
    expect(result).toEqual({
      present: true,
      scripts: ['/real.js', '/moved.js'],
      deferredScripts: 3
    });
    // Inline attributed scripts prove presence without a URL.
    expect(detectDeferAllJs(page('<script data-rocket-defer="defer"></script>'))).toEqual({
      present: true,
      scripts: [],
      deferredScripts: 1
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

  it('reads async-swapped stylesheet links, never a fallback or a plain preload', () => {
    const url = 'https://s.com/wp-content/cache/min/1/wp-content/themes/t/style.css?ver=1';
    const link = (rel: string, attrs: string) => `<link rel='${rel}' href='${url}' ${attrs} />`;
    const stamp = 'data-rocket-async="style"';
    // Still preloading (rel="preload" as="style") or flipped by its onload.
    expect(detectMinifyCss(page(link('preload', `${stamp} as="style"`)))).toEqual({
      present: true
    });
    expect(detectMinifyCss(page(link('stylesheet', `${stamp} as="style"`)))).toEqual({
      present: true
    });
    for (const attrs of [
      'as="style"',
      `${stamp} as="script"`,
      stamp,
      'data-rocket-async="script" as="style"'
    ]) {
      expect(detectMinifyCss(page(link('preload', attrs))), attrs).toEqual({ present: false });
    }
    // The no-JavaScript fallback copy of a minified stylesheet.
    expect(
      detectMinifyCss(page(`<body><noscript>${link('stylesheet', '')}</noscript></body>`))
    ).toEqual({ present: false });
  });

  it('checks scripts against resolved sources', () => {
    const parsed = page('<script src="https://s.com/wp-content/cache/min/1/app-99.js"></script>');
    expect(detectMinifyJs(parsed)).toEqual({ present: true });
    expect(detectMinifyJs(page('<script>app.min.js</script>'))).toEqual({ present: false });
  });

  it('accepts any numeric cache site folder (not a hard-coded 1)', () => {
    expect(
      detectMinifyCss(
        page('<link rel="stylesheet" href="https://s.com/wp-content/cache/min/7/a.css">')
      )
    ).toEqual({ present: true });
    expect(
      detectMinifyJs(page('<script src="https://s.com/wp-content/cache/min/42/a.js"></script>'))
    ).toEqual({ present: true });
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

  it('arbitrary page text is not the CDN footprint', () => {
    expect(detectRocketCdn(page('<p>rocketcdn.me</p>'))).toEqual({ present: false });
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

describe('detectOptimizeCriticalImages / detectPreloadedResources', () => {
  const html = `<html><head>
      <link data-rocket-preload href="https://s.com/hero.webp" as="image">
      <link data-rocket-preload href="https://s.com/logo.png" as="image">
      <link data-rocket-preload href="https://s.com/app.js" as="script">
    </head></html>`;
  it('reports preloaded images with the link list; the comment stays false', () => {
    const parsed = page(html);
    expect(detectOptimizeCriticalImages(parsed)).toEqual({
      present: true,
      lcpComment: false,
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

  it('collects the image list regardless of the beacon (partial pages stay truthful)', () => {
    const parsed = page(
      `<html><head>
        <link data-rocket-preload href="https://s.com/hero.webp" as="image">
        <script data-name="wpr-wpr-beacon" src="/beacon.js"></script>
      </head></html>`
    );
    expect(detectOptimizeCriticalImages(parsed)).toEqual({
      present: true,
      lcpComment: false,
      preloadedImages: ['https://s.com/hero.webp']
    });
  });

  it('marks case-sensitively: only as="image" counts for critical images', () => {
    const result = detectOptimizeCriticalImages(
      page('<link data-rocket-preload href="/x.jpg" AS="IMAGE">')
    );
    expect(result).toEqual({ present: false, lcpComment: false });
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
      'self_hosted_fonts',
      'image_dimensions',
      'rocket_above_the_fold_optimization',
      'automatic_lazy_rendering',
      'auto_preload_fonts',
      'preconnect_external_domains',
      'priority_elements_beacon',
      'minify_css',
      'minify_js',
      'minify_concatenate_js',
      'preload_links',
      'rocket_cdn',
      'mobile_cache'
    ]);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.preloadedResources).toEqual({ present: false });
  });

  it('rejects non-string input loud and early', () => {
    expect(() => parsePage(null as unknown as string)).toThrow(TypeError);
  });
});

/**
 * The served-URL cases every URL-recognizing script check shares: Delay JS
 * moves `src` to `data-rocket-src`, so a delayed WP Rocket script must still
 * be recognized by the URL the page serves. `script(attrs)` renders the tag
 * under test; `matches` is whether that tag names the check's URL.
 */
function servedUrlCases(path: string): [string, string, boolean][] {
  return [
    ['delayed', `data-rocket-src="https://s.com${path}"`, true],
    ['plain', `src="https://s.com${path}"`, true],
    ['both attributes: the delayed URL wins', `src="/other.js" data-rocket-src="${path}"`, true],
    ['both attributes: a foreign delayed URL', `src="${path}" data-rocket-src="/other.js"`, false],
    ['empty data-rocket-src falls back to src', `data-rocket-src="" src="${path}"`, true],
    ['valueless data-rocket-src falls back to src', `data-rocket-src src="${path}"`, true],
    ['empty data-rocket-src alone', 'data-rocket-src=""', false],
    ['relative delayed URL', `data-rocket-src="${path}"`, true]
  ];
}

describe('served script URL — Delay JS-rewritten tags', () => {
  const delayType = 'type="rocketlazyloadscript"';

  it.each(servedUrlCases('/wp-content/cache/min/1/app.js'))(
    'detectMinifyJs: %s',
    (_case, attrs, matches) => {
      const parsed = page(`<script ${delayType} ${attrs}></script>`);
      expect(detectMinifyJs(parsed)).toEqual({ present: matches });
    }
  );

  it.each(
    servedUrlCases('/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js')
  )('detectLazyload: %s', (_case, attrs, matches) => {
    const parsed = page(
      `<script ${delayType} ${attrs}></script><script>window.lazyLoadOptions=[{e:"img[data-lazy-src]"}]</script>`
    );
    expect(detectLazyload(parsed).present).toBe(matches);
  });

  it.each(
    servedUrlCases('/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js')
  )('detectLazyloadIframes: %s', (_case, attrs, matches) => {
    const parsed = page(
      `<script ${delayType} ${attrs}></script><script>window.lazyLoadOptions=1 iframe[data-lazy-src]</script>`
    );
    expect(detectLazyloadIframes(parsed).present).toBe(matches);
  });

  it('keeps the empty-src gate: an empty URL never resolves to the document', () => {
    // An empty URL resolves to the document's own URL; on a minified-cache
    // URL only the gate keeps it from counting as a minified script.
    const { happyDOM } = window as unknown as { happyDOM: { setURL(url: string): void } };
    const original = location.href;
    happyDOM.setURL('https://s.com/wp-content/cache/min/1/x.js');
    try {
      const plain = page('<script src=""></script>');
      // Precondition: without the gate the empty URL would match.
      expect(plain.scripts[0]?.src).toBe('https://s.com/wp-content/cache/min/1/x.js');
      expect(detectMinifyJs(plain)).toEqual({ present: false });
      expect(
        detectMinifyJs(page(`<script ${delayType} data-rocket-src="" src=""></script>`))
      ).toEqual({ present: false });
    } finally {
      happyDOM.setURL(original);
    }
  });
});
