/**
 * The detection widget's state mind: the mood mapping (pending/failure/
 * ready/absent), the D-2 chip matrix, the identity, the cache chip's four
 * shapes, the tooltip honesty bounds, and the card model's grouping — over
 * real engine output where it matters and crafted snapshots for the edges.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runDetection } from '../../../lib/detection/run-detection';
import { type FIXTURES, FIXTURE_DIR } from '../../../lib/detection/fixtures/corpus';
import type { WprDetections } from '../../../lib/wp-rocket/types';
import { cacheStateForPage } from '../../../lib/detection/cache-context';
import type { CacheState } from '../../../lib/detection/cache-context';
import {
  buildStripCardModel,
  CACHE_CHIP_IDLE_TEXT,
  CACHE_CHIP_PENDING_TEXT,
  CARD_ERROR_HINT,
  CARD_ERROR_TITLE,
  CARD_LOADING_TITLE,
  chipStateForFeature,
  insMood,
  identityText,
  footerStamp,
  type StripDataSnapshot
} from './strip-state';
import { HUD_FEATURES, hudFeatureOf } from '../../../lib/detection/hud';

/** The engine's zero page: every feature absent, beacon absent, no config. */
function zeroDetections(): WprDetections {
  return {
    wpr: { present: false, cacheMarkerFound: false, cached: false, version: null, timeStamp: null },
    remove_unused_css: { present: false },
    delay_js: { present: false, scripts: [], version: null, delayedScripts: 0 },
    defer_all_js: { present: false, scripts: [], deferredScripts: 0 },
    async_css: { present: false, criticalStyle: false },
    lazyload: { present: false, images: [] },
    lazyload_iframes: { present: false, replaceImage: false },
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

const fixture = (name: (typeof FIXTURES)[number]): string =>
  readFileSync(join(FIXTURE_DIR, name), 'utf8');

const running = (): StripDataSnapshot => ({
  phase: 'running',
  detections: null,
  cacheState: null
});
const failed = (): StripDataSnapshot => ({
  phase: 'failed',
  detections: null,
  cacheState: null
});
const ready = (
  detections: StripDataSnapshot['detections'],
  cacheState: CacheState | null = detections === null
    ? null
    : cacheStateForPage({ wpr: detections.wpr, headers: null, bypassAttested: false })
): StripDataSnapshot => ({
  phase: 'ready',
  detections,
  cacheState
});

describe('insMood', () => {
  it('the pass running pulses; the pass failing is red', () => {
    expect(insMood(running())).toBe('pulse');
    expect(insMood(failed())).toBe('red');
  });

  it('present + cached is green, present + uncached amber, absent gray', () => {
    const cached = zeroDetections();
    cached.wpr = {
      present: true,
      cacheMarkerFound: true,
      cached: true,
      version: '3.20.0.2',
      timeStamp: 1_730_000_000
    };
    expect(insMood(ready(cached))).toBe('green');

    const uncached = zeroDetections();
    uncached.wpr = {
      present: true,
      cacheMarkerFound: false,
      cached: false,
      version: null,
      timeStamp: null
    };
    expect(insMood(ready(uncached))).toBe('amber');

    const absent = zeroDetections();
    expect(insMood(ready(absent))).toBe('gray');
  });
});

describe('chipStateForFeature (the D-2 matrix)', () => {
  it('applied → ok, collecting → attention, both neutrals → neutral', () => {
    expect(chipStateForFeature('applied')).toBe('ok');
    expect(chipStateForFeature('collecting')).toBe('attention');
    expect(chipStateForFeature('unknown')).toBe('attention');
    expect(chipStateForFeature('not applied')).toBe('neutral');
    expect(chipStateForFeature('not enabled')).toBe('neutral');
  });
});

describe('identityText', () => {
  it('the version form when present, honest absence otherwise', () => {
    const withVersion = zeroDetections();
    withVersion.wpr = {
      present: true,
      cacheMarkerFound: true,
      cached: true,
      version: '3.23.5.1',
      timeStamp: null
    };
    expect(identityText(ready(withVersion))).toBe('WPR 3.23.5.1');
    const noVersion = zeroDetections();
    noVersion.wpr = {
      present: true,
      cacheMarkerFound: false,
      cached: false,
      version: null,
      timeStamp: null
    };
    expect(identityText(ready(noVersion))).toBe('WPR (unknown version)');
    expect(identityText(ready(zeroDetections()))).toBe('WPR not found');
    expect(identityText(running())).toBe('WPR');
    expect(identityText(failed())).toBe('WPR');
  });
});

describe('the cache chip (the explicit cache vocabulary)', () => {
  it('cached → ok chip with the stamp; signature/no-stamp → warn; absent → dash', () => {
    const cached = zeroDetections();
    cached.wpr = {
      present: true,
      cacheMarkerFound: true,
      cached: true,
      version: '3.20.0.2',
      // A stamp outside the platform range formats to null (no dishonest stamp).
      timeStamp: 9_999_999_999_999
    };
    const model = buildStripCardModel({
      snapshot: ready(cached),
      wordpressVersion: null,
      fdtVersion: '0.0.0'
    });
    expect(model.cacheChip).toEqual({
      state: 'ok',
      text: '✓ Cached',
      stamp: null
    });

    const stampCached = zeroDetections();
    stampCached.wpr = {
      present: true,
      cacheMarkerFound: true,
      cached: true,
      version: '3.20.0.2',
      timeStamp: 1_730_000_000
    };
    const stamped = buildStripCardModel({
      snapshot: ready(stampCached),
      wordpressVersion: null,
      fdtVersion: '0.0.0'
    });
    expect(stamped.cacheChip?.stamp).toBe('2024-10-27 03:33:20 UTC');
    expect(stamped.cacheTooltip).toBe(
      "The page is served from WP Rocket's cache generated 2024-10-27 03:33:20 UTC."
    );

    // Signature present, no debug stamp: the plugin handled the page, but the
    // cache is not proven — never folded into "not cached".
    const signature = zeroDetections();
    signature.wpr = {
      present: true,
      cacheMarkerFound: true,
      cached: false,
      version: null,
      timeStamp: null
    };
    const signatureModel = buildStripCardModel({
      snapshot: ready(signature),
      wordpressVersion: null,
      fdtVersion: '0.0.0'
    });
    expect(signatureModel.cacheChip).toEqual({
      state: 'warn',
      text: 'Cache not proven',
      stamp: null
    });
    expect(signatureModel.cacheTooltip).toContain("this visit's cache state is not proven");

    // No signature, no headers: absence proves nothing.
    const unknown = zeroDetections();
    unknown.wpr = {
      present: true,
      cacheMarkerFound: false,
      cached: false,
      version: null,
      timeStamp: null
    };
    const unknownModel = buildStripCardModel({
      snapshot: ready(unknown),
      wordpressVersion: null,
      fdtVersion: '0.0.0'
    });
    expect(unknownModel.cacheChip).toEqual({
      state: 'neutral',
      text: 'Cache not detected',
      stamp: null
    });
    expect(unknownModel.cacheTooltip).toContain('Response headers were not captured');

    // A verified hosting marker is evidence, not proof.
    const possibly = buildStripCardModel({
      snapshot: ready(unknown, {
        kind: 'possibly-cached',
        evidence: 'SiteGround'
      }),
      wordpressVersion: null,
      fdtVersion: '0.0.0'
    });
    expect(possibly.cacheChip).toEqual({
      state: 'warn',
      text: 'Possibly cached',
      stamp: null
    });
    expect(possibly.cacheTooltip).toContain('SiteGround');

    // The bypass is named as a request (intent, neutral), never a verdict.
    const bypassed = buildStripCardModel({
      snapshot: ready(unknown, { kind: 'bypass-requested' }),
      wordpressVersion: null,
      fdtVersion: '0.0.0'
    });
    expect(bypassed.cacheChip).toEqual({
      state: 'neutral',
      text: 'Bypass requested',
      stamp: null
    });

    const absentModel = buildStripCardModel({
      snapshot: ready(zeroDetections()),
      wordpressVersion: null,
      fdtVersion: '0.0.0'
    });
    expect(absentModel.cacheChip).toEqual({
      state: 'neutral',
      text: CACHE_CHIP_IDLE_TEXT,
      stamp: null
    });
    expect(absentModel.cacheTooltip).toBe('WP Rocket did not handle this page.');
  });

  it('running → the pending mark; failed → the idle dash', () => {
    expect(
      buildStripCardModel({ snapshot: running(), wordpressVersion: null, fdtVersion: 'v' })
        .cacheChip
    ).toEqual({
      state: 'neutral',
      text: CACHE_CHIP_PENDING_TEXT,
      stamp: null
    });
    expect(
      buildStripCardModel({ snapshot: failed(), wordpressVersion: null, fdtVersion: 'v' }).cacheChip
    ).toEqual({
      state: 'neutral',
      text: CACHE_CHIP_IDLE_TEXT,
      stamp: null
    });
  });
});

describe('buildStripCardModel over the real engine (the docker-site shape)', () => {
  it('the cached home page reads grouped rows, counts and the footer stamp', () => {
    const { detections } = runDetection(fixture('me-home-cached.html'));
    const model = buildStripCardModel({
      snapshot: ready(detections),
      wordpressVersion: '6.8.1',
      fdtVersion: '0.0.0'
    });
    expect(model.identity).toBe(detections.wpr.version ? `WPR ${detections.wpr.version}` : 'WPR');
    expect(model.phase).toBe('ready');
    expect(model.stateCopy).toBeNull();
    expect(model.footer).toBe(`WPR ${detections.wpr.version ?? '—'} · WP 6.8.1 · FDT 0.0.0`);

    // Groups render in the registry's order, rows within groups in engine order.
    expect(model.groups.map((group) => group.id)).toEqual([
      'file-optimization',
      'media',
      'preload',
      'cdn',
      'features'
    ]);

    const allRows = model.groups.flatMap((group) => group.rows);
    expect(allRows).toHaveLength(HUD_FEATURES.length);
    // Every chip shows the registry's compact wording, its tooltip leads with
    // the full name, and the chip state pair is always one of the five.
    for (const row of allRows) {
      const feature = hudFeatureOf(row.id);
      expect(row.chipState).toEqual(expect.stringMatching(/^(ok|warn|attention|error|neutral)$/));
      expect(row.label).toBe(feature?.shortLabel);
      expect(row.tooltip.startsWith(`${feature?.label ?? ''} — `)).toBe(true);
    }
  });

  it('counts follow the engine: the delayed and lazy-loaded counts render', () => {
    const { detections } = runDetection(fixture('me-home-cached.html'));
    const model = buildStripCardModel({
      snapshot: ready(detections),
      wordpressVersion: null,
      fdtVersion: '0.0.0'
    });
    const delayRow = model.groups
      .flatMap((group) => group.rows)
      .find((row) => row.id === 'delay_js');
    expect(delayRow?.count).toBe(detections.delay_js.delayedScripts);
    expect(delayRow?.unit).toBe('scripts');
    expect(delayRow?.chipState).toBe('ok');
    const lazyRow = model.groups
      .flatMap((group) => group.rows)
      .find((row) => row.id === 'lazyload');
    // Only the images actually lazy-loaded count (owner decision O-N6).
    const lazyLoaded = detections.lazyload.images.filter((image) => image.lazyloadDetected);
    expect(lazyRow?.count).toBe(lazyLoaded.length);
  });

  it('a versionless present page renders the unknown-version identity in every slot', () => {
    // A versionless present page: no generator version, footprints + the
    // cache comment proving presence (the engine seam's own crafted shape).
    // Real-world materialization: a served copy whose generator meta carries
    // no version stamp (the docker site's `?fdt-wpr-versionless=1` arm).
    const { detections } = runDetection(
      '<html><head><title>t</title></head><body>fixture page</body></html>' +
        "<!-- This website is like a Rocket, isn't it? Performance optimized by WP Rocket. Learn more: https://wp-rocket.me - Debug: cached@1699999999 -->"
    );
    expect(detections.wpr.present).toBe(true);
    expect(detections.wpr.cached).toBe(true);
    expect(detections.wpr.version).toBeNull();
    const model = buildStripCardModel({
      snapshot: ready(detections),
      wordpressVersion: null,
      fdtVersion: '0.0.0'
    });
    // Identity and title agree on the honest form; the footer dashes the
    // version slot. Nothing in the model fabricates a version string.
    expect(model.identity).toBe('WPR (unknown version)');
    expect(model.footer).toBe('WPR — · WP — · FDT 0.0.0');
    expect(model.phase).toBe('ready');
  });

  it('an all-zero WPR-absent page renders every row neutral with honest tooltips', () => {
    const model = buildStripCardModel({
      snapshot: ready(zeroDetections()),
      wordpressVersion: null,
      fdtVersion: '0.0.0'
    });
    const rows = model.groups.flatMap((group) => group.rows);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.chipState).toBe('neutral');
      // The tooltip names what was looked for — never an error claim.
      expect(row.tooltip.startsWith(hudFeatureOf(row.id)?.label ?? '')).toBe(true);
    }
  });

  it('failed and running phases render the honest body copy and no rows', () => {
    const failedModel = buildStripCardModel({
      snapshot: failed(),
      wordpressVersion: null,
      fdtVersion: '0.0.0'
    });
    expect(failedModel.stateCopy?.title).toBe(CARD_ERROR_TITLE);
    expect(failedModel.stateCopy?.hint).toBe(CARD_ERROR_HINT);
    expect(failedModel.groups).toEqual([]);

    const loadingModel = buildStripCardModel({
      snapshot: running(),
      wordpressVersion: null,
      fdtVersion: '0.0.0'
    });
    expect(loadingModel.stateCopy?.title).toBe(CARD_LOADING_TITLE);
    expect(loadingModel.groups).toEqual([]);
  });
});

describe('footerStamp', () => {
  it('stamps the three versions, dashing the unknowns', () => {
    expect(footerStamp('3.23', '6.8.1', '0.0.0')).toBe('WPR 3.23 · WP 6.8.1 · FDT 0.0.0');
    expect(footerStamp(null, null, '0.0.0')).toBe('WPR — · WP — · FDT 0.0.0');
  });
});

describe('the strip reads the HUD registry (one feature list)', () => {
  /** A WP Rocket page with a meta-declared Delay JS and an enabled, unapplied ALR. */
  function handled(): WprDetections {
    return {
      ...zeroDetections(),
      wpr: {
        present: true,
        cacheMarkerFound: true,
        cached: false,
        version: '3.23',
        timeStamp: null
      },
      delay_js: { present: true, scripts: [], version: null, delayedScripts: 2, source: 'meta' },
      priority_elements_beacon: { present: true, status: { lrc: true }, isMobile: null }
    };
  }

  /** The ready model's rows, flat. */
  function rows(detections: WprDetections) {
    return buildStripCardModel({
      snapshot: ready(detections),
      wordpressVersion: null,
      fdtVersion: '0'
    }).groups.flatMap((group) => group.rows);
  }

  it('renders every HUD feature once, in registry order within its group, with the compact wording', () => {
    const model = buildStripCardModel({
      snapshot: ready(handled()),
      wordpressVersion: null,
      fdtVersion: '0'
    });
    for (const group of model.groups) {
      expect(group.rows.map((row) => row.id)).toEqual(
        HUD_FEATURES.filter((feature) => feature.group === group.id).map((feature) => feature.row)
      );
    }
    expect(model.groups.flatMap((group) => group.rows.map((row) => row.label))).toEqual(
      HUD_FEATURES.map((feature) => feature.shortLabel)
    );
  });

  it('the tooltip carries the full name, the state line and the deciding source', () => {
    const delay = rows(handled()).find((row) => row.id === 'delay_js');
    expect(delay?.label).toBe('Delay JS');
    expect(delay?.tooltip).toBe(
      "Delay JavaScript execution — applied on this page: 2 scripts. Decided by WP Rocket's generator meta tag on this page."
    );
  });

  it('a declared mobile cache row: an ok chip whose tooltip names the render device and the limit', () => {
    const row = rows({
      ...handled(),
      mobile_cache: { present: true, variant: 'mobile', source: 'meta' }
    }).find((entry) => entry.id === 'mobile_cache');
    expect(row?.label).toBe('Mobile cache');
    expect(row?.chipState).toBe('ok');
    expect(row?.tooltip).toBe(
      "Separate cache files for mobile devices — applied on this page: rendered for mobile. Declared on this render; separate mobile files also need WP Rocket's mobile cache option, which the page doesn't show. Tablets count as mobile here but get the desktop file under WP Rocket's default tablet setting. Decided by WP Rocket's generator meta tag on this page."
    );
  });

  it('a declared DNS prefetch row: an ok chip whose tooltip counts the hints and states the limit', () => {
    const row = rows({
      ...handled(),
      dns_prefetch: { present: true, domains: ['https://a.example/'], source: 'meta' }
    }).find((entry) => entry.id === 'dns_prefetch');
    expect(row?.label).toBe('DNS prefetch');
    expect(row?.chipState).toBe('ok');
    expect(row?.count).toBe(1);
    expect(row?.unit).toBe('domain');
    expect(row?.tooltip).toBe(
      "Prefetch DNS Requests — applied on this page: 1 domain hinted. WP Rocket declared DNS prefetch; the hosts may include, or be only, WordPress core's own hints and CDN hosts. Decided by WP Rocket's generator meta tag on this page."
    );
  });

  it('an undecided DNS prefetch row: plain hints alone read the amber unknown chip', () => {
    const row = rows({
      ...handled(),
      dns_prefetch: { present: false, domains: ['https://a.example/'] }
    }).find((entry) => entry.id === 'dns_prefetch');
    expect(row?.chipState).toBe('attention');
    // Unattributed hints are no evidence for an unsure chip: no count beside it.
    expect(row?.count).toBeNull();
    expect(row?.unit).toBeNull();
    expect(row?.tooltip).toBe(
      'Prefetch DNS Requests — no generator meta declaration decided it, and a plain dns-prefetch hint does not name WP Rocket, so its state is unknown.'
    );
  });

  it('a refuted DNS prefetch row shows no hint count beside its chip', () => {
    const row = rows({
      ...handled(),
      dns_prefetch: { present: false, domains: ['https://a.example/'], source: 'meta' }
    }).find((entry) => entry.id === 'dns_prefetch');
    expect(row?.chipState).toBe('neutral');
    expect(row?.count).toBeNull();
    expect(row?.unit).toBeNull();
  });

  it('a DNS prefetch row the CDN omission left open reads unknown, naming the omission', () => {
    const row = rows({
      ...handled(),
      rocket_cdn: { present: true, source: 'meta' },
      dns_prefetch: { present: false, domains: ['https://cdn.example/'] }
    }).find((entry) => entry.id === 'dns_prefetch');
    expect(row?.chipState).toBe('attention');
    expect(row?.count).toBeNull();
    expect(row?.tooltip).toBe(
      'Prefetch DNS Requests — with the CDN on, WP Rocket omits the declaration for a single domain, so its state is unknown.'
    );
  });

  it('a declared row with nothing on the page: an ok chip whose tooltip says so', () => {
    const at = rows({
      ...handled(),
      delay_js: { present: true, scripts: [], version: null, delayedScripts: 0, source: 'meta' },
      lazyload_iframes: { present: true, replaceImage: false, source: 'meta', targets: false },
      dns_prefetch: { present: true, domains: [], source: 'meta' }
    });
    const delay = at.find((entry) => entry.id === 'delay_js');
    expect(delay?.chipState).toBe('ok');
    expect(delay?.count).toBe(0);
    expect(delay?.tooltip).toBe(
      "Delay JavaScript execution — declared on this render, but no script on this page is delayed. Decided by WP Rocket's generator meta tag on this page."
    );
    const iframes = at.find((entry) => entry.id === 'lazyload_iframes');
    expect(iframes?.chipState).toBe('ok');
    // A unit-less row shows no figure beside the chip.
    expect([iframes?.count, iframes?.unit]).toEqual([null, null]);
    expect(iframes?.tooltip).toBe(
      "LazyLoad for iframes/videos — declared on this render, but no iframe or video on this page is lazy-loaded. Decided by WP Rocket's generator meta tag on this page."
    );
    expect(at.find((entry) => entry.id === 'dns_prefetch')?.tooltip).toBe(
      "Prefetch DNS Requests — declared on this render, but no dns-prefetch hint on this page names another host. Decided by WP Rocket's generator meta tag on this page."
    );
  });

  it('a declared row with targets keeps the applied line', () => {
    const row = rows({
      ...handled(),
      lazyload_iframes: { present: true, replaceImage: false, source: 'meta', targets: true }
    }).find((entry) => entry.id === 'lazyload_iframes');
    expect(row?.tooltip).toBe(
      "LazyLoad for iframes/videos — applied on this page. Decided by WP Rocket's generator meta tag on this page."
    );
  });

  it('collecting and undecided-unknown rows read the amber attention chip with their why', () => {
    const all = rows(handled());
    const alr = all.find((row) => row.id === 'automatic_lazy_rendering');
    expect(alr?.chipState).toBe('attention');
    expect(alr?.tooltip).toBe('Automatic Lazy Rendering — enabled, not yet applied on this page.');
    const dims = all.find((row) => row.id === 'image_dimensions');
    expect(dims?.chipState).toBe('attention');
    expect(dims?.label).toBe('Image Dimensions');
    expect(dims?.tooltip).toMatch(/^Add missing image dimensions — no generator meta declaration/);
    const fonts = all.find((row) => row.id === 'self_hosted_fonts');
    expect(fonts?.chipState).toBe('attention');
  });

  it('a meta-refuted undecided-capable row reads neutral not applied, never unknown', () => {
    const detections = {
      ...handled(),
      image_dimensions: { present: false, source: 'meta' as const }
    };
    const dims = rows(detections).find((row) => row.id === 'image_dimensions');
    expect(dims?.chipState).toBe('neutral');
    expect(dims?.tooltip).toContain("WP Rocket's generator meta does not declare it");
    expect(dims?.tooltip).not.toContain('predate');
  });
});

describe('buildStripCardModel — count nouns', () => {
  it('renders one counted element with the singular noun, more with the plural', () => {
    /** The delay row of a page with `scripts` delayed scripts. */
    const delayRow = (scripts: number) => {
      const delayed = '<script type="rocketlazyloadscript" data-rocket-src="a.js"></script>'.repeat(
        scripts
      );
      const { detections } = runDetection(
        `<html><head><meta name="generator" content="WP Rocket 3.23.5.1" data-wpr-features="wpr_delay_js"></head><body>${delayed}</body></html>`
      );
      const model = buildStripCardModel({
        snapshot: ready(detections),
        wordpressVersion: null,
        fdtVersion: '0.0.0'
      });
      return model.groups.flatMap((group) => group.rows).find((row) => row.id === 'delay_js');
    };
    expect(delayRow(1)).toMatchObject({ count: 1, unit: 'script' });
    expect(delayRow(2)).toMatchObject({ count: 2, unit: 'scripts' });
    expect(delayRow(1)?.tooltip).toContain('applied on this page: 1 script.');
  });
});
