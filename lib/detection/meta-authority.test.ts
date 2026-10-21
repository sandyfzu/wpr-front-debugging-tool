/**
 * The declaration's authority over the footprint pass: a table-driven
 * verdict/source matrix over the real `runDetection` output for every mapped
 * registry row, named cases for the caps/inventory/composition behaviors a
 * table would obscure, and the boundary contract that every resulting shape
 * survives the messaging guard. These are the new-behavior expectations, not
 * a source-parity claim.
 */
import { describe, expect, it } from 'vitest';
import type { FeatureMetaRow } from '../wp-rocket/types';
import { parseWprDetections } from '../messaging/validate';
import { runDetection } from './run-detection';
import { featureMetaVerdict } from './feature-meta';

/** A WP Rocket generator tag with the given exact tokens. */
function meta(tokens: readonly string[], version = '3.23.5.1'): string {
  return `<meta name="generator" content="WP Rocket ${version}" data-wpr-features="${tokens.join(' ')}">`;
}

/** A page around the given head/body markup. */
function page(head: string, body = ''): string {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}

/** The RUCSS footprint (the canonical `style#wpr-usedcss`). */
const RUCSS = '<style id="wpr-usedcss">.c{}</style>';

/** One mapped registry row with its exact token and a detectable footprint. */
interface RegistryRowCase {
  readonly row: FeatureMetaRow;
  readonly token: string;
  /** Absent for declaration-only rows (image dimensions). */
  readonly footprint?: string;
}

/** Every mapped row: the declaration must set it present with a meta source. */
const REGISTRY_ROWS: readonly RegistryRowCase[] = [
  { row: 'remove_unused_css', token: 'wpr_remove_unused_css', footprint: RUCSS },
  {
    row: 'async_css',
    token: 'wpr_async_css',
    footprint: '<script>wprRemoveCPCSS();</script>'
  },
  {
    row: 'delay_js',
    token: 'wpr_delay_js',
    footprint: '<script type="rocketlazyloadscript" src="/delayed.js"></script>'
  },
  {
    row: 'defer_all_js',
    token: 'wpr_defer_js',
    footprint: '<script src="/deferred.js" data-rocket-defer="defer"></script>'
  },
  {
    row: 'lazyload',
    token: 'wpr_lazyload_images',
    footprint:
      '<script src="/wp-content/plugins/wp-rocket/assets/js/lazyload/1/lazyload.min.js"></script>' +
      '<script>window.lazyLoadOptions={}img[data-lazy-src]{}</script>'
  },
  {
    row: 'lazyload_iframes',
    token: 'wpr_lazyload_iframes',
    footprint:
      '<script src="/wp-content/plugins/wp-rocket/assets/js/lazyload/1/lazyload.min.js"></script>' +
      '<script>window.lazyLoadOptions={}iframe[data-lazy-src]{}</script>' +
      '<script>function lazyLoadThumb(a){}function lazyLoadYoutubeIframe(){}</script>'
  },
  {
    row: 'lazyload_css_bg_img',
    token: 'wpr_lazyload_css_bg_img',
    footprint: '<div id="wpr-lazyload-bg-container"></div>'
  },
  {
    row: 'self_hosted_fonts',
    token: 'wpr_host_fonts_locally',
    footprint: '<link rel="stylesheet" href="/wp-content/cache/fonts/1/google-fonts/a.css">'
  },
  { row: 'image_dimensions', token: 'wpr_image_dimensions' },
  {
    row: 'rocket_above_the_fold_optimization',
    token: 'wpr_oci',
    footprint: '<link data-rocket-preload href="/hero.jpg" as="image">'
  },
  {
    row: 'automatic_lazy_rendering',
    token: 'wpr_automatic_lazy_rendering',
    footprint: '<div data-wpr-lazyrender="1"></div>'
  },
  {
    row: 'auto_preload_fonts',
    token: 'wpr_auto_preload_fonts',
    footprint: '<link rel="preload" as="font" data-rocket-preload href="/font.woff2">'
  },
  {
    row: 'preconnect_external_domains',
    token: 'wpr_preconnect_external_domains',
    footprint: '<link rel="preconnect" href="https://fonts.test">'
  },
  {
    row: 'minify_css',
    token: 'wpr_minify_css',
    footprint: '<link rel="stylesheet" href="/wp-content/cache/min/1/theme.css">'
  },
  {
    row: 'minify_js',
    token: 'wpr_minify_js',
    footprint: '<script src="/wp-content/cache/min/1/app.js"></script>'
  },
  {
    row: 'preload_links',
    token: 'wpr_preload_links',
    footprint: '<script id="rocket-preload-links-js-extra"></script>'
  },
  {
    row: 'rocket_cdn',
    token: 'wpr_cdn',
    footprint: '<link rel="dns-prefetch" href="https://cdn.rocketcdn.me">'
  }
];

/** The registry rows whose footprint the table can positively detect. */
const FOOTPRINT_ROWS = REGISTRY_ROWS.filter((row) => row.footprint !== undefined);

describe('meta authority: per-row verdict and source', () => {
  it.each(REGISTRY_ROWS)('$row: $token declares the row', ({ row, token, footprint }) => {
    const detections = runDetection(page(meta([token]), footprint ?? '')).detections;
    expect(detections[row]).toMatchObject({ present: true, source: 'meta' });
  });

  it.each(FOOTPRINT_ROWS)(
    '$row: an undeclared token refutes the row despite its footprint',
    ({ row, footprint }) => {
      const detections = runDetection(page(meta(['wpr_dns_prefetch']), footprint)).detections;
      expect(detections[row]).toMatchObject({ present: false, source: 'meta' });
    }
  );

  it('keeps footprint evidence when the tag is absent', () => {
    expect(runDetection(page('', RUCSS)).detections.remove_unused_css).toEqual({
      present: true,
      source: 'footprint'
    });
  });

  it('omits source when neither evidence class decided the row', () => {
    const row = runDetection(page('', '<div></div>')).detections.remove_unused_css;
    expect(row).toEqual({ present: false });
    expect(Object.hasOwn(row, 'source')).toBe(false);
  });

  it('keeps inventory under a declaration and under a refutation', () => {
    const declared = runDetection(
      page(
        meta(['wpr_delay_js']),
        '<script type="rocketlazyloadscript" src="/delayed.js"></script>'
      )
    ).detections.delay_js;
    expect(declared.present).toBe(true);
    expect(declared.source).toBe('meta');
    expect(declared.delayedScripts).toBe(1);
    expect(declared.scripts).toHaveLength(1);

    const refuted = runDetection(
      page(meta(['wpr_cdn']), '<script type="rocketlazyloadscript" src="/delayed.js"></script>')
    ).detections.delay_js;
    expect(refuted.present).toBe(false);
    expect(refuted.source).toBe('meta');
    // The remnant script stays visible as inventory, never as a verdict.
    expect(refuted.delayedScripts).toBe(1);
  });

  it('degrades a caps-violating declaration back to footprint evidence', () => {
    const hostile = meta([]).replace(
      'data-wpr-features=""',
      `data-wpr-features="${'x'.repeat(8_193)}"`
    );
    const result = runDetection(page(hostile, RUCSS));
    expect(result.detections.remove_unused_css).toEqual({
      present: true,
      source: 'footprint'
    });
  });

  it('an empty declaration proves the plugin and refutes every mapped feature', () => {
    const result = runDetection(page(meta([]), RUCSS));
    expect(result.detections.wpr.present).toBe(true);
    expect(result.detections.remove_unused_css).toEqual({ present: false, source: 'meta' });
  });

  it('the meta tag proves presence even without a version', () => {
    const result = runDetection(page(meta(['wpr_cdn'], ''), ''));
    expect(result.detections.wpr.present).toBe(true);
    expect(result.detections.wpr.version).toBeNull();
  });
});

describe('meta authority: the declared rows whose evidence is inventory', () => {
  it('minify declares the stage even when nothing was rewritten (documented exception)', () => {
    const result = runDetection(page(meta(['wpr_minify_css', 'wpr_minify_js'])));
    expect(result.detections.minify_css).toEqual({ present: true, source: 'meta' });
    expect(result.detections.minify_js).toEqual({ present: true, source: 'meta' });
  });

  it('Priority Elements rows accept a declaration with no observed markup', () => {
    const result = runDetection(
      page(
        meta([
          'wpr_oci',
          'wpr_automatic_lazy_rendering',
          'wpr_auto_preload_fonts',
          'wpr_preconnect_external_domains'
        ])
      )
    );
    expect(result.detections.rocket_above_the_fold_optimization).toEqual({
      present: true,
      source: 'meta',
      lcpComment: false
    });
    expect(result.detections.automatic_lazy_rendering).toMatchObject({
      present: true,
      source: 'meta',
      lazyRenderElements: 0
    });
    expect(result.detections.auto_preload_fonts).toEqual({
      present: true,
      source: 'meta',
      fonts: []
    });
    expect(result.detections.preconnect_external_domains).toEqual({
      present: true,
      source: 'meta',
      domains: [],
      preconnectCount: 0
    });
  });

  it('the shared beacon never asserts any family feature by itself', () => {
    const result = runDetection(
      page(
        '',
        '<script data-name="wpr-wpr-beacon" src="/wp-rocket/assets/js/wpr-beacon.min.js"></script>'
      )
    );
    expect(result.detections.priority_elements_beacon.present).toBe(true);
    expect(result.detections.rocket_above_the_fold_optimization.present).toBe(false);
    expect(result.detections.automatic_lazy_rendering.present).toBe(false);
    expect(result.detections.auto_preload_fonts.present).toBe(false);
    expect(result.detections.preconnect_external_domains.present).toBe(false);
  });

  it('manual font preloads never assert the automatic feature', () => {
    const result = runDetection(
      page('<link rel="preload" as="font" href="https://s.example/f.woff2" crossorigin>')
    );
    expect(result.detections.auto_preload_fonts.present).toBe(false);
  });

  it('image dimensions is declaration-only: ordinary width/height prove nothing', () => {
    const painted = runDetection(page('', '<img src="/a.jpg" width="640" height="480">'));
    expect(painted.detections.image_dimensions).toEqual({ present: false });
    const declared = runDetection(page(meta(['wpr_image_dimensions'])));
    expect(declared.detections.image_dimensions).toEqual({ present: true, source: 'meta' });
  });

  it('self-hosted fonts reads the attributed link or the local cache path only', () => {
    expect(
      runDetection(
        page('<link rel="stylesheet" href="/s.css" data-wpr-hosted-gf-parameters="family=Inter">')
      ).detections.self_hosted_fonts
    ).toEqual({ present: true, source: 'footprint' });
    expect(
      runDetection(
        page('<link rel="stylesheet" href="/wp-content/cache/fonts/1/google-fonts/css/a.css">')
      ).detections.self_hosted_fonts
    ).toEqual({ present: true, source: 'footprint' });
    // A font on the site's own server without the feature's attribution is
    // not the feature.
    expect(
      runDetection(page('<link rel="stylesheet" href="/fonts/site-font.woff2">')).detections
        .self_hosted_fonts
    ).toEqual({ present: false });
  });
});

describe('meta authority: boundary contract', () => {
  const pages: Array<[string, string]> = [
    ['declared without footprint', page(meta(['wpr_oci', 'wpr_host_fonts_locally']))],
    ['refuted with footprint', page(meta([]), RUCSS)],
    [
      'declared inventory',
      page(meta(['wpr_delay_js']), '<script type="rocketlazyloadscript" src="/a.js"></script>')
    ],
    [
      'degraded',
      page(
        meta([]).replace('data-wpr-features=""', `data-wpr-features="${'x'.repeat(8_193)}"`),
        RUCSS
      )
    ]
  ];

  for (const [name, html] of pages) {
    it(`${name}: engine output survives the messaging guard`, () => {
      const { detections } = runDetection(html);
      expect(parseWprDetections(detections)).toEqual(detections);
    });
  }
});

describe('featureMetaVerdict: the authority boundary', () => {
  it('refutes only when the declaration is usable', () => {
    const usable = { attributePresent: true, tokens: ['wpr_cdn'] };
    expect(featureMetaVerdict(usable, 'wpr_cdn')).toBe('declared');
    expect(featureMetaVerdict(usable, 'wpr_preload_links')).toBe('refuted');
    expect(featureMetaVerdict({ attributePresent: true, tokens: [] }, 'wpr_cdn')).toBe('refuted');
    expect(
      featureMetaVerdict({ attributePresent: true, tokens: [], degraded: true }, 'wpr_cdn')
    ).toBe('absent');
    expect(featureMetaVerdict({ attributePresent: false, tokens: [] }, 'wpr_cdn')).toBe('absent');
  });
});
