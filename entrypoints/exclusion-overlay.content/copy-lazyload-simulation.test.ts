/**
 * The LazyLoad simulation's words (pinned so every change is deliberate):
 * its mode control, its lane lines (counts, script address, end-tag
 * fallbacks, every-page caveats), the banner's warnings (CSP, the caveats
 * this page shows), its outcome banners, and the banners of three
 * features at once.
 */
import { describe, expect, it } from 'vitest';
import type { LazyloadSimulationReport } from '../../lib/messaging/exclusion-simulation';
import {
  deferSimulatedReport,
  lazyloadSimulatedReport,
  simulatedReport
} from '../../lib/messaging/exclusion-simulation.fixtures';
import { stateBanner } from './banner-model';
import {
  DELAY_MODE_COPY,
  LAZYLOAD_MODE_COPY,
  SIMULATION_LANE_COPY,
  lazyloadLaneLines,
  noteToText,
  simulationLimitLines,
  simulationOutcomeCopy,
  siteExclusionsNote,
  viewCopy
} from './copy';
import type { OverlayState } from './session/machine';
import type { SessionView } from './session/session-view';

/** A LazyLoad report in a non-simulated state. */
function lazyload(
  state: Exclude<LazyloadSimulationReport['state'], 'simulated'>,
  reason?: LazyloadSimulationReport['reason'],
  unreproducedRegex?: LazyloadSimulationReport['unreproducedRegex']
): LazyloadSimulationReport {
  return {
    feature: 'lazyload',
    state,
    ...(reason === undefined ? {} : { reason }),
    ...(unreproducedRegex === undefined ? {} : { unreproducedRegex }),
    images: 0,
    pictures: 0,
    backgrounds: 0,
    wpRocketVersion: '3.24'
  };
}

/** A simulated LazyLoad report with no page-found caveat and no CSP facts. */
function cleanLazyload(): LazyloadSimulationReport {
  return {
    ...lazyloadSimulatedReport(),
    caveats: ['hook-text-placement', 'runtime-url', 'above-the-fold-exclusions', 'site-filters']
  };
}

/** An applied view carrying the given simulations. */
function applied(
  views: Partial<
    Pick<
      Extract<SessionView, { kind: 'applied' }>,
      'lazyloadSimulation' | 'deferSimulation' | 'simulation'
    >
  > = {}
): Extract<SessionView, { kind: 'applied' }> {
  return { kind: 'applied', reports: [], unmatched: 0, warnings: [], served: undefined, ...views };
}

const READY: OverlayState = {
  phase: 'ready',
  status: { state: 'inactive' },
  pending: null,
  notice: null
};

const REMEDY =
  'Test on another page of the site, or choose As served to apply your exclusions without the simulation.';
const AS_SERVED = 'the page was rendered as served, with your exclusions.';
const STOP_ASKING = 'Choose As served to stop asking for the simulation.';
/** The site-exclusions note without LazyLoad simulated… */
const SITE_NOTE =
  'The site’s own WP Rocket exclusions aren’t included (the extension can’t read them). Add them as rows to test them.';
/** …and with it (its rows restore images only). */
const SITE_NOTE_LAZYLOAD =
  'The site’s own WP Rocket exclusions aren’t included (the extension can’t read them). Add them as rows to test them (LazyLoad: images only).';

/**
 * How many times a text holds a phrase.
 *
 * @param text The text searched.
 * @param phrase The phrase counted.
 */
function occurrences(text: string, phrase: string): number {
  return text.split(phrase).length - 1;
}

describe('LazyLoad mode words', () => {
  it('pins its own words and shares the rest; no Disabled words', () => {
    expect(LAZYLOAD_MODE_COPY.groupName).toBe('LazyLoad for images on this page');
    expect(LAZYLOAD_MODE_COPY.blocks).toEqual({
      'already-served':
        'WP Rocket already lazy loads images on this page — exclusions apply to its output.',
      amp: 'WP Rocket never lazy loads images on AMP pages.',
      checking: 'Checking whether WP Rocket lazy loads images on this page…',
      preview:
        'WP Rocket never lazy loads images on a preview, so LazyLoad can’t be simulated here.',
      search:
        'WP Rocket never lazy loads images on search results, so LazyLoad can’t be simulated here.',
      'page-builder-editor':
        'WP Rocket never lazy loads images in a page builder’s editor, so LazyLoad can’t be simulated here.'
    });
    expect(LAZYLOAD_MODE_COPY).not.toHaveProperty('disabledChangesNothing');
    expect(LAZYLOAD_MODE_COPY.labels).toBe(DELAY_MODE_COPY.labels);
    expect(LAZYLOAD_MODE_COPY.replaced('simulated')).toBe(
      'Simulated doesn’t apply here, so this page runs as served (Simulated stays set for other pages).'
    );
  });
});

describe('LazyLoad lane lines', () => {
  it('counts images, pictures and background images, each agreeing with its count', () => {
    expect(SIMULATION_LANE_COPY.lazyloadLine(lazyloadSimulatedReport(), 3)).toBe(
      '5 images, 1 picture and 2 background images lazy loaded by the simulation · 3 excluded by your rows'
    );
    expect(SIMULATION_LANE_COPY.lazyloadLine({ images: 1, pictures: 0, backgrounds: 1 }, 0)).toBe(
      '1 image, 0 pictures and 1 background image lazy loaded by the simulation · 0 excluded by your rows'
    );
  });

  it('names the script address as code, and where it came from', () => {
    const lines = lazyloadLaneLines(lazyloadSimulatedReport(), 0);
    expect(lines.runtime).toEqual([
      'LazyLoad script: ',
      {
        code: 'https://example.com/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js'
      },
      ' (address WordPress’s default folders (nothing on this page shows the real one))'
    ]);
    const source = (assetsUrlSource: LazyloadSimulationReport['assetsUrlSource']): string =>
      noteToText(
        lazyloadLaneLines({ ...lazyloadSimulatedReport(), assetsUrlSource }, 0).runtime ?? []
      );
    expect(source('beacon')).toMatch(
      /\(address from WP Rocket’s own beacon script on this page\)$/
    );
    expect(source('plugin-asset')).toMatch(
      /\(address worked out from another plugin’s files on this page\)$/
    );
    expect(source('theme-asset')).toMatch(
      /\(address worked out from the theme’s files on this page\)$/
    );
  });

  it('cuts a long script address (it comes from the page)', () => {
    const runtimeUrl = `https://example.com/${'a'.repeat(400)}/lazyload.min.js`;
    const runtime = lazyloadLaneLines({ ...lazyloadSimulatedReport(), runtimeUrl }, 0).runtime;
    const code = runtime?.[1];
    expect(typeof code === 'object' && code.code.length).toBe(161);
    expect(typeof code === 'object' && code.code.endsWith('…')).toBe(true);
  });

  it('says no address when the report names none', () => {
    const withoutUrl: LazyloadSimulationReport = { ...lazyloadSimulatedReport() };
    delete (withoutUrl as { runtimeUrl?: string }).runtimeUrl;
    expect(lazyloadLaneLines(withoutUrl, 0).runtime).toBeNull();
  });

  it('words each end tag chosen among several, as a caveat of this page', () => {
    const report: LazyloadSimulationReport = {
      ...lazyloadSimulatedReport(),
      placement: {
        head: 'before-end-tag',
        footer: 'before-beacon-block',
        fallbacks: ['first-of-several-head-ends', 'last-of-several-body-ends']
      }
    };
    expect(lazyloadLaneLines(report, 0).caveats).toEqual([
      'This page has several </head> tags: LazyLoad’s style went before the first one.',
      'This page has several </body> tags: LazyLoad’s scripts went before the last one.'
    ]);
    expect(lazyloadLaneLines(lazyloadSimulatedReport(), 0).caveats).toEqual([]);
  });

  it('says the restored images keep their noscript copy, only when rows restored some', () => {
    const NOTE = 'Images your rows restore keep their noscript copy, unlike on the site.';
    expect(lazyloadLaneLines(lazyloadSimulatedReport(), 2).caveats).toEqual([NOTE]);
    expect(lazyloadLaneLines(lazyloadSimulatedReport(), 0).caveats).not.toContain(NOTE);
    const report: LazyloadSimulationReport = {
      ...lazyloadSimulatedReport(),
      placement: {
        head: 'before-end-tag',
        footer: 'before-beacon-block',
        fallbacks: ['first-of-several-head-ends']
      }
    };
    // After the page's own placement caveat.
    expect(lazyloadLaneLines(report, 1).caveats).toEqual([
      'This page has several </head> tags: LazyLoad’s style went before the first one.',
      NOTE
    ]);
  });

  it('says the every-page caveats in the lane, in vocabulary order', () => {
    expect(lazyloadLaneLines(lazyloadSimulatedReport(), 0).hints).toEqual([
      'LazyLoad’s style and scripts were placed where most themes print them; your theme may place them elsewhere.',
      'LazyLoad’s script address was worked out from this page; your site’s plugin folder or CDN may give another.',
      'WP Rocket skips lazy loading above-the-fold and LCP images from its own site data, which the simulation can’t read.',
      'Site code and server settings that change or turn off LazyLoad (filters, options, DONOTLAZYLOAD…) aren’t known to the simulation.'
    ]);
  });
});

describe('LazyLoad banner warnings', () => {
  it('warns of the caveats this page shows (C-1 with the Chromium sizes note), never the every-page ones', () => {
    const report: LazyloadSimulationReport = {
      ...lazyloadSimulatedReport(),
      caveats: [
        'core-lazy-loading',
        'image-smilies',
        'foreign-lazy-markup',
        'hook-text-placement',
        'runtime-url',
        'above-the-fold-exclusions',
        'site-filters'
      ]
    };
    expect(simulationLimitLines(report)).toEqual([
      'WordPress marked some images loading="lazy" here; with LazyLoad on it wouldn’t, so their fallback copies differ slightly from the site’s. Chromium-based browsers also ignore the sizes="auto, …" WordPress wrote, so such an image with a srcset may load a larger file here than on the site.',
      'This page shows WordPress image smilies, which WP Rocket prints slightly differently with LazyLoad on.',
      'This page already holds another plugin’s lazy-load markup, lazy loaded again here as WP Rocket would.'
    ]);
    expect(simulationLimitLines(cleanLazyload())).toEqual([]);
  });

  it('warns of the placeholders a CSP blocks, and of a CSP it could not evaluate', () => {
    expect(simulationLimitLines({ ...cleanLazyload(), cspLimits: ['placeholders'] })).toEqual([
      'This page’s Content Security Policy blocks data: images: LazyLoad’s placeholders show as broken images until each image loads, as they would on the site.'
    ]);
    expect(simulationLimitLines({ ...cleanLazyload(), cspUnavailable: 'oversized' })).toEqual([
      'CSP not evaluated for LazyLoad: this page’s Content Security Policy is too large to check, so whether it blocks LazyLoad’s script, options or placeholders isn’t known.'
    ]);
    expect(simulationLimitLines({ ...cleanLazyload(), cspUnavailable: 'unreadable' })).toEqual([
      'CSP not evaluated for LazyLoad: this page’s Content Security Policy couldn’t be read, so whether it blocks LazyLoad’s script, options or placeholders isn’t known.'
    ]);
  });

  it('says nothing for a step that did not run', () => {
    expect(simulationLimitLines(lazyload('already-served'))).toEqual([]);
  });

  it('keeps a clean LazyLoad page’s banner ok, warns once the page shows a caveat', () => {
    expect(stateBanner(READY, applied({ lazyloadSimulation: cleanLazyload() }))).toMatchObject({
      tone: 'ok',
      glyph: 'check'
    });
    const banner = stateBanner(READY, applied({ lazyloadSimulation: lazyloadSimulatedReport() }));
    expect(banner).toMatchObject({ tone: 'warn', glyph: 'alert' });
    expect(banner?.notes[0]).toMatch(/^WordPress marked some images loading="lazy"/);
  });
});

describe('LazyLoad outcome banners', () => {
  it('names a simulated LazyLoad alone, and three features in buffer order', () => {
    expect(viewCopy(applied({ lazyloadSimulation: cleanLazyload() }))).toEqual({
      title: 'Applied',
      body: 'This page was rendered with your exclusions and WP Rocket’s LazyLoad for images simulated — not the site’s real configuration. The site’s own WP Rocket exclusions aren’t included (the extension can’t read them). Add them as rows to test them (LazyLoad: images only).'
    });
    const clean = { ...simulatedReport(), cspLimits: undefined, caveats: undefined };
    expect(
      viewCopy(
        applied({
          lazyloadSimulation: cleanLazyload(),
          deferSimulation: deferSimulatedReport(),
          simulation: clean
        })
      ).body
    ).toBe(
      'This page was rendered with your exclusions and WP Rocket’s LazyLoad for images, Load JavaScript deferred and Delay JavaScript execution simulated — not the site’s real configuration. The site’s own WP Rocket exclusions aren’t included (the extension can’t read them). Add them as rows to test them (LazyLoad: images only).'
    );
  });

  it.each([
    [
      lazyload('already-served'),
      'Applied — WP Rocket already lazy loads images here',
      'Nothing was simulated: your exclusions apply to WP Rocket’s own LazyLoad for images, as served.'
    ],
    [
      lazyload('csp-blocked'),
      'Not simulated: blocked by this page’s Content Security Policy',
      `The policy forbids WP Rocket’s LazyLoad script or its inline options, as it would on the site, so no image was lazy loaded and the page was rendered with your exclusions only. ${REMEDY}`
    ],
    [
      lazyload('not-applicable', 'amp'),
      'Not simulated: AMP page',
      `WP Rocket never lazy loads images on AMP pages, so ${AS_SERVED} ${STOP_ASKING}`
    ],
    [
      lazyload('not-applicable', 'preview'),
      'Not simulated: preview',
      `WP Rocket never lazy loads images on a preview, so ${AS_SERVED} ${STOP_ASKING}`
    ],
    [
      lazyload('not-applicable', 'search'),
      'Not simulated: search page',
      `WP Rocket never lazy loads images on search results, so ${AS_SERVED} ${STOP_ASKING}`
    ],
    [
      lazyload('not-applicable', 'page-builder-editor'),
      'Not simulated: page builder editor',
      `WP Rocket never lazy loads images in a page builder’s editor, so ${AS_SERVED} ${STOP_ASKING}`
    ],
    [
      lazyload('not-applicable', 'no-head-end'),
      'Not simulated: page has no usable head or body end',
      `LazyLoad’s style and scripts go before the page’s </head> and </body>, which this page lacks, so ${AS_SERVED} ${REMEDY}`
    ],
    [
      lazyload('not-applicable', 'runtime-unavailable'),
      'Not simulated: LazyLoad’s script file is unavailable',
      `The extension’s packaged copy of LazyLoad’s script couldn’t be loaded or is damaged, so ${AS_SERVED} Reload the page to retry (if it persists, reload or reinstall the extension), or choose As served to stop asking for the simulation.`
    ],
    [
      lazyload('not-applicable', 'beyond-exact-reproduction', 'lazyload-images'),
      'Not simulated: this page can’t be reproduced exactly',
      `WP Rocket’s LazyLoad image matching pattern may stop on this page, which the simulation can’t reproduce, so ${AS_SERVED} ${REMEDY}`
    ],
    [
      lazyload('not-applicable', 'beyond-exact-reproduction', 'lazyload-injected-scripts'),
      'Not simulated: LazyLoad’s scripts would be delayed or deferred',
      `The Delay JS or Defer JS exclusion list in use would delay or defer LazyLoad’s own scripts, which WP Rocket’s lists never do, so ${AS_SERVED} ${REMEDY}`
    ],
    [
      lazyload('not-applicable', 'beyond-exact-reproduction', 'lazyload-runtime-url'),
      'Not simulated: LazyLoad’s script address is too long',
      `The address worked out for LazyLoad’s script is longer than the extension can follow, so ${AS_SERVED} ${REMEDY}`
    ]
  ])('words %j', (report, title, body) => {
    expect(simulationOutcomeCopy(report)).toEqual({ title, body });
  });

  it('says the other features’ outcomes beside a LazyLoad step that did not run', () => {
    const clean = { ...simulatedReport(), cspLimits: undefined, caveats: undefined };
    expect(
      viewCopy(
        applied({
          lazyloadSimulation: lazyload('not-applicable', 'search'),
          deferSimulation: deferSimulatedReport(),
          simulation: clean
        })
      )
    ).toEqual({
      title: 'Not simulated: search page',
      body: `WP Rocket never lazy loads images on search results, so the page was rendered with Load JavaScript deferred and Delay JavaScript execution simulated and your exclusions. ${STOP_ASKING} ${SITE_NOTE}`
    });
    expect(
      viewCopy(applied({ lazyloadSimulation: lazyload('already-served'), simulation: clean }))
    ).toEqual({
      title: 'Applied — WP Rocket already lazy loads images here',
      body: `LazyLoad for images wasn’t simulated: your exclusions apply to WP Rocket’s own LazyLoad for images, as served. Delay JavaScript execution was simulated. ${SITE_NOTE}`
    });
  });

  it('warns when the LazyLoad step did not run', () => {
    expect(
      stateBanner(READY, applied({ lazyloadSimulation: lazyload('not-applicable', 'search') }))
    ).toMatchObject({ tone: 'warn', glyph: 'alert' });
  });
});

describe('site-exclusions note', () => {
  const clean = { ...simulatedReport(), cspLimits: undefined, caveats: undefined };

  it('names LazyLoad’s narrower row scope only when LazyLoad simulated', () => {
    expect(siteExclusionsNote(['delay_js'])).toBe(SITE_NOTE);
    expect(siteExclusionsNote(['defer_all_js', 'delay_js'])).toBe(SITE_NOTE);
    expect(siteExclusionsNote(['lazyload'])).toBe(SITE_NOTE_LAZYLOAD);
    // Repeats and order never repeat the scope.
    expect(siteExclusionsNote(['delay_js', 'lazyload', 'lazyload'])).toBe(SITE_NOTE_LAZYLOAD);
  });

  it('ends a mixed banner once when another feature simulated, without LazyLoad’s scope', () => {
    const body = viewCopy(
      applied({ lazyloadSimulation: lazyload('csp-blocked'), simulation: clean })
    ).body;
    expect(occurrences(body, SITE_NOTE)).toBe(1);
    expect(body).not.toContain('LazyLoad: images only');
    expect(body.endsWith(SITE_NOTE)).toBe(true);
  });

  it('carries LazyLoad’s scope on a mixed banner where LazyLoad simulated', () => {
    const body = viewCopy(
      applied({
        lazyloadSimulation: cleanLazyload(),
        simulation: { ...clean, state: 'csp-blocked' }
      })
    ).body;
    expect(occurrences(body, SITE_NOTE_LAZYLOAD)).toBe(1);
    expect(body.endsWith(SITE_NOTE_LAZYLOAD)).toBe(true);
  });

  it('says nothing when no feature simulated', () => {
    for (const views of [
      { lazyloadSimulation: lazyload('csp-blocked') },
      { lazyloadSimulation: lazyload('already-served') },
      {
        lazyloadSimulation: lazyload('csp-blocked'),
        deferSimulation: { ...deferSimulatedReport(), state: 'csp-blocked' as const }
      },
      {}
    ]) {
      expect(viewCopy(applied(views)).body).not.toContain(SITE_NOTE);
    }
  });

  it('follows the no-match words on a simulated page, never on an unsimulated one', () => {
    const unmatched = (views: Parameters<typeof applied>[0]): string =>
      viewCopy({ ...applied(views), unmatched: 2 }).body;
    const delayed = unmatched({ simulation: clean });
    expect(delayed).toBe(
      `2 rows match no element on this page. Check the rows marked “No match”. ${SITE_NOTE}`
    );
    expect(unmatched({ lazyloadSimulation: cleanLazyload(), simulation: clean })).toContain(
      SITE_NOTE_LAZYLOAD
    );
    expect(unmatched({})).not.toContain(SITE_NOTE);
  });
});
