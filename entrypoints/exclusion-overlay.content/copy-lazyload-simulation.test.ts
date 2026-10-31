/**
 * The LazyLoad simulation's words (pinned so every change is deliberate):
 * its mode control, its lane lines (counts, then the limits disclosure:
 * script address, end-tag fallbacks, every-page caveats), the banner's warnings (CSP, the caveats
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
  noteToText,
  simulationLaneLimits,
  simulationLimitLines,
  simulationOutcomeCopy,
  siteExclusionsNote,
  simulatedRenderWords,
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
const SITE_NOTE = 'The site’s own WP Rocket exclusions aren’t included; add them as rows.';
/** …and with it (its rows restore images only). */
const SITE_NOTE_LAZYLOAD =
  'The site’s own WP Rocket exclusions aren’t included; add them as rows (LazyLoad: images only).';

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
    expect(LAZYLOAD_MODE_COPY.blockedDraft('preview')).toBe(
      'Set for this site; doesn’t apply on this page (preview). Choose As served to clear it.'
    );
    expect(LAZYLOAD_MODE_COPY.blockedDraft('page-builder-editor')).toBe(
      'Set for this site; doesn’t apply on this page (page builder editor). Choose As served to clear it.'
    );
  });
});

describe('LazyLoad lane lines', () => {
  /** The URL the fixture's runtime loads from. */
  const URL =
    'https://example.com/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js';
  /** The inferred-address limit line (another plugin's or a theme's asset). */
  const INFERRED_SCRIPT = `Script address inferred from this page; your plugin folder or CDN may differ: ${URL}`;
  /** The guessed-address limit line (the fixture's source: WordPress's default folders). */
  const GUESSED_SCRIPT = `Script address guessed from WordPress’s default folders; your folders or CDN may differ: ${URL}`;
  /** The every-page caveats after it, in vocabulary order. */
  const EVERY_PAGE = [
    'Style and scripts placed where most themes print them.',
    'Above-the-fold and LCP images aren’t skipped (needs WP Rocket’s site data).',
    'Site filters, options and DONOTLAZYLOAD aren’t applied.'
  ];

  /** A lane's limits as plain text. */
  function limitsText(report: LazyloadSimulationReport, restored = 0): string[] {
    return simulationLaneLimits(report, restored).map(noteToText);
  }

  it('counts images, pictures and background images, each agreeing with its count', () => {
    expect(SIMULATION_LANE_COPY.lazyloadLine(lazyloadSimulatedReport(), 3)).toBe(
      '5 images, 1 picture and 2 background images lazy loaded by the simulation · 3 excluded by your rows'
    );
  });

  it('leaves out the kinds it lazy loaded none of', () => {
    const line = (images: number, pictures: number, backgrounds: number): string =>
      SIMULATION_LANE_COPY.lazyloadLine({ images, pictures, backgrounds }, 0);
    const TAIL = ' lazy loaded by the simulation · 0 excluded by your rows';
    expect(line(43, 0, 0)).toBe(`43 images${TAIL}`);
    expect(line(1, 0, 0)).toBe(`1 image${TAIL}`);
    expect(line(43, 2, 0)).toBe(`43 images and 2 pictures${TAIL}`);
    expect(line(1, 0, 1)).toBe(`1 image and 1 background image${TAIL}`);
    expect(line(0, 1, 0)).toBe(`1 picture${TAIL}`);
    expect(line(0, 0, 3)).toBe(`3 background images${TAIL}`);
    expect(line(43, 2, 1)).toBe(`43 images, 2 pictures and 1 background image${TAIL}`);
  });

  it('says every kind when it lazy loaded nothing', () => {
    expect(SIMULATION_LANE_COPY.lazyloadLine({ images: 0, pictures: 0, backgrounds: 0 }, 0)).toBe(
      '0 images, 0 pictures and 0 background images lazy loaded by the simulation · 0 excluded by your rows'
    );
  });

  it('says a script address guessed from WordPress’s defaults as the first limit, address as code', () => {
    // The fixture's source: WordPress's default folders.
    expect(simulationLaneLimits(lazyloadSimulatedReport(), 0)[0]).toEqual([
      'Script address guessed from WordPress’s default folders; your folders or CDN may differ: ',
      { code: URL }
    ]);
  });

  it('says a script address inferred from a plugin’s or theme’s asset as the first limit', () => {
    for (const assetsUrlSource of ['plugin-asset', 'theme-asset'] as const) {
      expect(limitsText({ ...lazyloadSimulatedReport(), assetsUrlSource })[0]).toBe(
        INFERRED_SCRIPT
      );
    }
  });

  it('says a beacon-given script address as a limit too (a CDN rewrite isn’t visible from it)', () => {
    const lines = simulationLaneLimits(
      { ...lazyloadSimulatedReport(), assetsUrlSource: 'beacon' },
      0
    );
    expect(lines[0]).toEqual([
      'Script address from WP Rocket’s beacon tag; a CDN may serve another: ',
      { code: URL }
    ]);
    expect(lines.slice(1).map(noteToText)).toEqual(EVERY_PAGE);
  });

  it('cuts a long script address (it comes from the page)', () => {
    const runtimeUrl = `https://example.com/${'a'.repeat(400)}/lazyload.min.js`;
    const code = simulationLaneLimits({ ...lazyloadSimulatedReport(), runtimeUrl }, 0)[0]?.[1];
    expect(typeof code === 'object' && code.code.length).toBe(161);
    expect(typeof code === 'object' && code.code.endsWith('…')).toBe(true);
  });

  it('says no address when the report names none', () => {
    const withoutUrl: LazyloadSimulationReport = { ...lazyloadSimulatedReport() };
    delete (withoutUrl as { runtimeUrl?: string }).runtimeUrl;
    expect(limitsText(withoutUrl)).toEqual(EVERY_PAGE);
  });

  it('words each end tag chosen among several, after the script line', () => {
    const report: LazyloadSimulationReport = {
      ...lazyloadSimulatedReport(),
      placement: {
        head: 'before-end-tag',
        footer: 'before-beacon-block',
        fallbacks: ['first-of-several-head-ends', 'last-of-several-body-ends']
      }
    };
    expect(limitsText(report)).toEqual([
      GUESSED_SCRIPT,
      'Several </head> tags: LazyLoad’s style went before the first.',
      'Several </body> tags: LazyLoad’s scripts went before the last.',
      ...EVERY_PAGE
    ]);
  });

  it('says the restored images keep their noscript copy, only when rows restored some', () => {
    const NOTE = 'Images your rows restore keep their noscript copy, unlike on the site.';
    expect(limitsText(lazyloadSimulatedReport(), 2)).toEqual([GUESSED_SCRIPT, NOTE, ...EVERY_PAGE]);
    expect(limitsText(lazyloadSimulatedReport(), 0)).not.toContain(NOTE);
    const report: LazyloadSimulationReport = {
      ...lazyloadSimulatedReport(),
      placement: {
        head: 'before-end-tag',
        footer: 'before-beacon-block',
        fallbacks: ['first-of-several-head-ends']
      }
    };
    // After the page's own placement caveat.
    expect(limitsText(report, 1)).toEqual([
      GUESSED_SCRIPT,
      'Several </head> tags: LazyLoad’s style went before the first.',
      NOTE,
      ...EVERY_PAGE
    ]);
  });

  it('says only the every-page caveats in the lane (the page-found ones are the banner’s)', () => {
    // The fixture carries `core-lazy-loading` too: a banner line, never a lane limit.
    expect(limitsText(lazyloadSimulatedReport())).toEqual([GUESSED_SCRIPT, ...EVERY_PAGE]);
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
      'WordPress added loading="lazy" here, which it skips with LazyLoad on: fallback copies differ slightly. Chromium ignores WordPress’s sizes="auto, …": srcset images may load larger files here.',
      'WordPress image smilies here: WP Rocket prints them slightly differently with LazyLoad on.',
      'Another plugin’s lazy-load markup here is lazy loaded again, as WP Rocket would.'
    ]);
    expect(simulationLimitLines(cleanLazyload())).toEqual([]);
  });

  it('warns of the placeholders a CSP blocks, and of a CSP it could not evaluate', () => {
    expect(simulationLimitLines({ ...cleanLazyload(), cspLimits: ['placeholders'] })).toEqual([
      'CSP blocks data: images: placeholders look broken until images load, as on the site.'
    ]);
    expect(simulationLimitLines({ ...cleanLazyload(), cspUnavailable: 'oversized' })).toEqual([
      'CSP not evaluated (too large to check): may block LazyLoad’s script, options or placeholders.'
    ]);
    expect(simulationLimitLines({ ...cleanLazyload(), cspUnavailable: 'unreadable' })).toEqual([
      'CSP not evaluated (unreadable): may block LazyLoad’s script, options or placeholders.'
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
    expect(banner?.notes[0]).toMatch(/^WordPress added loading="lazy" here/);
  });
});

describe('LazyLoad outcome banners', () => {
  it('names a simulated LazyLoad alone, and three features in buffer order', () => {
    expect(viewCopy(applied({ lazyloadSimulation: cleanLazyload() }))).toEqual({
      title: 'Applied',
      body: 'Rendered with your exclusions and simulated LazyLoad — not the site’s real setup. The site’s own WP Rocket exclusions aren’t included; add them as rows (LazyLoad: images only).'
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
      'Rendered with your exclusions and simulated LazyLoad, Defer JS and Delay JS — not the site’s real setup. The site’s own WP Rocket exclusions aren’t included; add them as rows (LazyLoad: images only).'
    );
  });

  it.each([
    [
      lazyload('already-served'),
      'Applied — WP Rocket already lazy loads images here',
      'Nothing was simulated: your exclusions apply to WP Rocket’s own LazyLoad, as served.'
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
      body: `WP Rocket never lazy loads images on search results, so the page was rendered with Defer JS and Delay JS simulated and your exclusions. ${STOP_ASKING} ${SITE_NOTE}`
    });
    expect(
      viewCopy(applied({ lazyloadSimulation: lazyload('already-served'), simulation: clean }))
    ).toEqual({
      title: 'Applied — WP Rocket already lazy loads images here',
      body: `LazyLoad wasn’t simulated: your exclusions apply to WP Rocket’s own LazyLoad, as served. Delay JS was simulated. ${SITE_NOTE}`
    });
  });

  it('warns when the LazyLoad step did not run', () => {
    expect(
      stateBanner(READY, applied({ lazyloadSimulation: lazyload('not-applicable', 'search') }))
    ).toMatchObject({ tone: 'warn', glyph: 'alert' });
  });
});

describe('the simulated Applied body', () => {
  /** The body's lead for these short names. */
  const lead = (names: string): string =>
    `Rendered with your exclusions and simulated ${names} — not the site’s real setup.`;
  const TAIL = 'The site’s own WP Rocket exclusions aren’t included; add them as rows.';
  const TAIL_LAZYLOAD =
    'The site’s own WP Rocket exclusions aren’t included; add them as rows (LazyLoad: images only).';

  it.each([
    [['delay_js'], `${lead('Delay JS')} ${TAIL}`],
    [['defer_all_js'], `${lead('Defer JS')} ${TAIL}`],
    [['lazyload'], `${lead('LazyLoad')} ${TAIL_LAZYLOAD}`],
    [['delay_js', 'defer_all_js'], `${lead('Defer JS and Delay JS')} ${TAIL}`],
    [['delay_js', 'lazyload'], `${lead('LazyLoad and Delay JS')} ${TAIL_LAZYLOAD}`],
    [['defer_all_js', 'lazyload'], `${lead('LazyLoad and Defer JS')} ${TAIL_LAZYLOAD}`],
    [
      ['delay_js', 'defer_all_js', 'lazyload'],
      `${lead('LazyLoad, Defer JS and Delay JS')} ${TAIL_LAZYLOAD}`
    ]
  ] as const)('names %j by short name, in registry order', (features, body) => {
    expect(simulatedRenderWords(features)).toBe(body);
  });

  it('ignores repeats', () => {
    expect(simulatedRenderWords(['delay_js', 'delay_js'])).toBe(`${lead('Delay JS')} ${TAIL}`);
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
