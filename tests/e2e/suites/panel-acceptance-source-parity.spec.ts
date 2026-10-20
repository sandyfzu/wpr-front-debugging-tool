/**
 * P6.1 browser acceptance — the source-build parity round (row 1 of
 * 07-phase-6-panel-pages.md).
 *
 * The port and the source extension's own build are installed in two
 * separate Chromium contexts (one unpacked extension per context) and both
 * panels render the SAME served fixture: one generated parity page (mixed
 * script inventory, lazy images, preload hints, the plugin's served
 * footprints, a server/platform header pair) fulfilled by each context's
 * own route interception from one shared `{ body, headers }` build. Every
 * assertion reads rendered state on both sides — the Detections cards'
 * names/verdicts/subtitles, the resource pages' chip counts and filter
 * results, and the undefined-references page's definition search — and the
 * deltas the port ships on purpose are pinned next to the comparison.
 *
 * Known intentional deltas this file pins (provenance recorded with the
 * phase receipt):
 * - the preloaded-hints page's feature label (the source states the
 *   lazyload feature's name there),
 * - the cached card's subtitle form (raw `Timestamp:` seconds vs the aged
 *   reading),
 * - the "optimize critical images" feature name's case and its subtitle's
 *   evidence form (the preload count vs the source's beacon wording),
 * - the plugin card's subtitle colon, and the definitions search's display
 *   form (file name vs full URL).
 *
 * The round runs only when the source checkout is on this machine;
 * otherwise the suite skips naming the reason; the manual remainder is
 * recorded.
 */
import type { BrowserContext, Page } from '@playwright/test';

import {
  expect,
  openFixturePage,
  ORIGIN_A,
  panelPageUrl,
  type ExtensionDriver
} from '../helpers/extension';
import {
  devtoolsShim,
  openPanelForFixture,
  type InspectedResourceStub
} from '../helpers/panel-data';
import {
  sourceRepoAvailable,
  sourceRepoHead,
  sourceTest,
  type SourceBuildDriver
} from '../helpers/source-build';
import { STATUS_LABELS } from '../../../lib/panel/detections-summary';

/** The source round's fixture version stamp (the generator meta's). */
const WPR_VERSION = '3.20.1';

/** The served cache stamp (the cache-debug comment's raw seconds). */
const CACHE_STAMP_SECONDS = 1791342253;

/** The served `server` header value (the Server card's subtitle, both builds). */
const SERVER_VALUE = 'nginx/1.24.0';

/** The served platform header value (the Known Platform card's evidence). */
const PLATFORM_VALUE = 'WP Engine/7.3';

/** One script row the fixture serves (the HTML and the counts read this array). */
interface ScriptRow {
  readonly url: string;
  readonly content: string;
  readonly delayed: boolean;
  readonly inline: boolean;
  readonly deferred: boolean;
  readonly deferredByWPR: boolean;
}

/** The Delay-JS controller's marker text (its own record names the version). */
const CONTROLLER =
  'class RocketLazyLoadScripts{constructor(){this.v="2.0.4",this.userEvents=["mousemove"]}}';

/**
 * The fixture's script inventory: five delayed external, three
 * Delay-JS-deferred external, four delayed inline, then the plugin's own
 * controller inline (its marker names the feature's version), the lazyload
 * options blob inline, one plain inline, three plain external (one with the
 * native defer attribute) and the lazyload module itself.
 */
const SCRIPT_ROWS: readonly ScriptRow[] = [
  ...Array.from({ length: 5 }, (_, i): ScriptRow => ({
    url: `/parity/ext-delayed-${String(i + 1)}.js`,
    content: '',
    delayed: true,
    inline: false,
    deferred: false,
    deferredByWPR: false
  })),
  ...Array.from({ length: 3 }, (_, i): ScriptRow => ({
    url: `/parity/ext-deferred-${String(i + 1)}.js`,
    content: '',
    delayed: true,
    inline: false,
    deferred: false,
    deferredByWPR: true
  })),
  ...Array.from({ length: 4 }, (_, i): ScriptRow => ({
    url: '',
    content: `/* delayed inline ${String(i + 1)} */\nconsole.log('delayed-${String(i + 1)}');`,
    delayed: true,
    inline: true,
    deferred: false,
    deferredByWPR: false
  })),
  {
    url: '',
    content: CONTROLLER,
    delayed: false,
    inline: true,
    deferred: false,
    deferredByWPR: false
  },
  {
    url: '',
    content:
      "window.lazyLoadOptions={threshold:200,images:'img[data-lazy-src]'};window.addEventListener('load',function(){});",
    delayed: false,
    inline: true,
    deferred: false,
    deferredByWPR: false
  },
  {
    url: '',
    content: "console.log('plain inline one');",
    delayed: false,
    inline: true,
    deferred: false,
    deferredByWPR: false
  },
  {
    url: '/parity/plain-1.js',
    content: '',
    delayed: false,
    inline: false,
    deferred: false,
    deferredByWPR: false
  },
  {
    url: '/parity/plain-2.js',
    content: '',
    delayed: false,
    inline: false,
    deferred: false,
    deferredByWPR: false
  },
  {
    url: '/parity/plain-3.js',
    content: '',
    delayed: false,
    inline: false,
    deferred: true,
    deferredByWPR: false
  },
  {
    url: '/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js',
    content: '',
    delayed: false,
    inline: false,
    deferred: false,
    deferredByWPR: false
  }
];

/** The chips' expected counts, derived from the same array the HTML reads.
 * `deferred` counts the native `defer` attribute's scripts (both builds'
 * chip predicate); the plugin's own `data-rocket-defer` rows state
 * "Deferred (By WP Rocket)" on their labels instead. */
const SCRIPT_COUNTS = {
  total: SCRIPT_ROWS.length,
  delayed: SCRIPT_ROWS.filter((row) => row.delayed).length,
  nonDelayed: SCRIPT_ROWS.filter((row) => !row.delayed).length,
  deferred: SCRIPT_ROWS.filter((row) => row.deferred).length,
  nonDeferred: SCRIPT_ROWS.filter((row) => !row.deferred).length,
  inline: SCRIPT_ROWS.filter((row) => row.inline).length,
  external: SCRIPT_ROWS.filter((row) => !row.inline).length
};

/** Lazy images (data-lazy-src) and one plain image the inventory also lists. */
const LAZY_IMAGE_COUNT = 7;
const PLAIN_IMAGE_COUNT = 1;

/** Preload hints per media type (the chips' expected counts). */
const PRELOAD_IMAGE_COUNT = 4;
const PRELOAD_FONT_COUNT = 3;

/**
 * Build the parity fixture: the document both contexts serve and both
 * captures read. The cache-debug comment rides after the document element
 * (its parse position — a document sibling — is the detection's read site).
 *
 * @returns The fixture's response parts: the headers, then the body.
 */
function parityFixture(): { headers: Record<string, string>; body: string } {
  const scripts = SCRIPT_ROWS.map((row) => {
    if (row.inline)
      return row.delayed
        ? `<script type="rocketlazyloadscript">${row.content}</script>`
        : `<script>${row.content}</script>`;
    if (row.delayed)
      return `<script type="rocketlazyloadscript" data-rocket-src="${row.url}"${row.deferredByWPR ? ' data-rocket-defer' : ''}></script>`;
    return `<script src="${row.url}"${row.deferred ? ' defer' : ''}></script>`;
  });
  const images = [
    ...Array.from(
      { length: LAZY_IMAGE_COUNT },
      (_, i) => `<img data-lazy-src="/parity/img-${String(i + 1)}.jpg" alt="lazy ${String(i + 1)}">`
    ),
    `<img src="/parity/plain.jpg" alt="plain">`
  ];
  const preloads = [
    ...Array.from(
      { length: PRELOAD_IMAGE_COUNT },
      (_, i) => `<link data-rocket-preload as="image" href="/parity/pre-img-${String(i + 1)}.jpg">`
    ),
    ...Array.from(
      { length: PRELOAD_FONT_COUNT },
      (_, i) =>
        `<link data-rocket-preload as="font" href="/parity/pre-font-${String(i + 1)}.woff2">`
    )
  ];
  return {
    headers: { server: SERVER_VALUE, 'x-powered-by': PLATFORM_VALUE },
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="generator" content="WP Rocket ${WPR_VERSION}" /><title>Source parity fixture</title>
</head><body><h1>Source parity fixture</h1>
${scripts.join('')}${images.join('')}${preloads.join('')}
</body></html>
<!-- This website is like a Rocket, isn't it? Performance optimized by WP Rocket. Learn more: https://wp-rocket.me - Debug: cached@${String(CACHE_STAMP_SECONDS)} -->`
  };
}

/** The route pattern every context fulfills for this round. */
const PARITY_ROUTE = '**/pipeline/source-parity.html*';
/** The fixture path (below the fixture server root). */
const PARITY_PATH = '/pipeline/source-parity.html';

/**
 * Serve the parity fixture through one context's interception (the same
 * response parts both contexts fulfill — the "same fixture" guarantee).
 *
 * @param context The browser context to route (both drivers expose it).
 * @param fixture The response parts.
 */
async function serveParityFixture(
  context: BrowserContext,
  fixture: { headers: Record<string, string>; body: string }
): Promise<void> {
  await context.route(PARITY_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: fixture.headers,
      body: fixture.body
    });
  });
}

/**
 * One round's open panels: both builds' fixture pages open on the parity
 * fixture, both panel pages booted over their own tab. The caller owns the
 * cleanup (closes everything and unroutes).
 */
interface ParityRound {
  /** The port panel page. */
  readonly portPanel: Page;
  /** The source panel page. */
  readonly sourcePanel: Page;
  /** The port side's fixture page. */
  readonly portFixture: Page;
  /** The source side's fixture page. */
  readonly sourceFixture: Page;
  /** Close both panels/fixture pages and drop the routes. */
  readonly cleanup: () => Promise<void>;
}

/**
 * Open both panels on the parity fixture (one shared `{ body, headers }`,
 * each context's own route), with each side's devtools seam stamping its
 * own inspected tab.
 *
 * @param extension The port's driver.
 * @param source The source build's driver.
 * @param portBootHash The port panel's boot hash.
 * @param sourceBootHash The source panel's boot hash (its route vocabulary;
 *   empty string boots its default route).
 * @returns The four pages plus the cleanup.
 */
async function openParityRound(
  extension: ExtensionDriver,
  source: SourceBuildDriver,
  portBootHash: string,
  sourceBootHash: string
): Promise<ParityRound> {
  const fixture = parityFixture();
  await serveParityFixture(extension.browserContext, fixture);
  await serveParityFixture(source.browserContext, fixture);
  const portFixture = await openFixturePage(extension, PARITY_PATH);
  const sourceFixture = await source.openFixturePage(PARITY_PATH, ORIGIN_A);

  const portPanel = await extension.browserContext.newPage();
  await portPanel.addInitScript(devtoolsShim(portFixture.tabId));
  await portPanel.goto(`${await panelPageUrl(extension)}${portBootHash}`, { waitUntil: 'load' });
  const sourcePanel = await source.openPanel(sourceFixture, sourceBootHash);
  return {
    portPanel,
    sourcePanel,
    portFixture: portFixture.page,
    sourceFixture: sourceFixture.page,
    cleanup: async () => {
      await portPanel.close();
      await sourcePanel.close();
      await portFixture.page.close();
      await sourceFixture.page.close();
      await extension.browserContext.unroute(PARITY_ROUTE);
      await source.browserContext.unroute(PARITY_ROUTE);
    }
  };
}

/**
 * The port panel's rendered cards, in render order.
 *
 * @param panel The port panel page.
 */
function portCards(
  panel: Page
): Promise<{ id: string | null; name: string; active: boolean; subtitle: string | null }[]> {
  return panel.evaluate(
    (activeLabel: string) =>
      Array.from(document.querySelectorAll('[data-fdt-card-id]')).map((card) => {
        const name = card.querySelector('[data-fdt-card-name]');
        const subtitle = card.querySelector('[data-fdt-card-subtitle]');
        return {
          id: card.getAttribute('data-fdt-card-id'),
          name: name?.textContent ?? '',
          // The verdict is the badge's own word (STATUS_LABELS'), never a
          // styling class on the name.
          active: card.querySelector('[data-fdt="status-badge"]')?.textContent === activeLabel,
          subtitle: subtitle?.textContent ?? null
        };
      }),
    STATUS_LABELS.active
  );
}

/**
 * The source panel's rendered Detections cards, in render order.
 *
 * @param panel The source panel page.
 */
function sourceCards(
  panel: Page
): Promise<{ name: string; active: boolean; subtitle: string | null }[]> {
  return panel.evaluate(() =>
    Array.from(document.querySelectorAll('main .grid > li')).map((li) => ({
      name: li.querySelector('.text-sm.font-semibold')?.textContent ?? '',
      active: li.querySelector('.text-emerald-400') !== null,
      subtitle: li.querySelector('.text-xs.text-gray-400')?.textContent ?? null
    }))
  );
}

/**
 * The source panel's resource summary, one count per KNOWN summary label
 * (the bar's text concatenates its words, so each label's own `:N` run is
 * read case-sensitively — 'Delayed:' never matches inside 'Non-delayed:').
 *
 * @param panel The source panel page.
 * @param labels The summary labels to read.
 */
function sourceSummaryCounts(
  panel: Page,
  labels: readonly string[]
): Promise<Record<string, number>> {
  return panel.evaluate((read: readonly string[]) => {
    const text = document.querySelector('div.bg-gray-800.p-3')?.textContent ?? '';
    const counts: Record<string, number> = {};
    for (const label of read)
      counts[label] =
        Number.parseInt(new RegExp(`${label}:(\\d+)`).exec(text)?.[1] ?? 'NaN', 10) || 0;
    return counts;
  }, labels);
}

/**
 * The source panel's rendered row count (its lists are not virtualized —
 * every rendered row is in the DOM).
 *
 * @param panel The source panel page.
 */
function sourceRowCount(panel: Page): Promise<number> {
  return panel.evaluate(() => document.querySelectorAll('main ul > li').length);
}

/**
 * One port chip's count span text.
 *
 * @param panel The port panel page.
 * @param chipId The chip id.
 */
function portChipCount(panel: Page, chipId: string): Promise<string | null> {
  return panel.evaluate(
    (id) =>
      document.querySelector(`[data-fdt-filter-chip="${id}"] [data-fdt-filter-count]`)
        ?.textContent ?? null,
    chipId
  );
}

/** Skip reason when the source checkout is not on this machine. */
const SKIP_REASON = 'the source checkout is not on this machine — set E2E_SOURCE_REPO';

/** The source name → the port's name, where the port's differs on purpose. */
const PORT_NAME_DELTAS: Readonly<Record<string, string>> = {
  // The feature's native label, sentence case (the naming decision's own case).
  'Optimize Critical Images': 'Optimize critical images'
};

sourceTest.describe('source-build parity over one served fixture', () => {
  sourceTest.skip(!sourceRepoAvailable(), SKIP_REASON);

  sourceTest(
    'Detections: cards, verdicts and subtitles agree with the source render',
    async ({ extension, source }, info) => {
      const head = sourceRepoHead();
      await info.attach('source-head.txt', { body: head ?? 'unknown', contentType: 'text/plain' });
      const round = await openParityRound(extension, source, '#/detections', '');
      const { portPanel, sourcePanel } = round;
      try {
        // Both panels live on their rendered Detections page.
        await expect(
          portPanel.locator('[data-fdt-page="detections"]').getByRole('heading', { level: 1 })
        ).toBeVisible();
        const sourceList = sourcePanel.locator('main .grid > li').first();
        await expect(sourceList).toBeVisible();

        const port = await portCards(portPanel);
        const origin = await sourceCards(sourcePanel);
        // Every source card exists on the port side with the same verdict;
        // the port's own second-baseline rows (committed extensions, receipted
        // by their own phases) are the extra set pinned below.
        expect(port.length).toBeGreaterThanOrEqual(origin.length);
        const portByName = new Map(port.map((card) => [card.name, card]));
        for (const [index, sourceCard] of origin.entries()) {
          const portCard = portByName.get(PORT_NAME_DELTAS[sourceCard.name] ?? sourceCard.name);
          expect(portCard, `card ${index.toString()} (${sourceCard.name}) exists`).toBeDefined();
          expect(portCard?.active, `card ${index.toString()} (${sourceCard.name}) verdict`).toBe(
            sourceCard.active
          );
          // The two cards whose subtitle form intentionally differs: the
          // cached card ages its stamp (relative reading vs the raw seconds),
          // the plugin card prints its label and value without the colon, and
          // the critical-images card's subtitle follows the port's dedicated
          // family model (the preload count is the applied evidence, so it
          // states the count — the source's own rendering says "Beacon
          // detected" for that evidence; the recorded P1.1 delta).
          if (sourceCard.name === 'Cached') {
            expect(portCard?.subtitle ?? '', 'the cached card ages its stamp').toMatch(
              /^Generated \d+ (?:s|min|h|d) ago$/
            );
          } else if (sourceCard.name === 'WP Rocket') {
            expect(portCard?.subtitle ?? '', 'the plugin card drops the subtitle colon').toBe(
              sourceCard.subtitle?.replace('Version: ', 'Version ') ?? null
            );
          } else if (sourceCard.name === 'Optimize Critical Images') {
            expect(
              portCard?.subtitle ?? '',
              'the critical-images card states the preload count'
            ).toBe(`Preloaded images detected: ${PRELOAD_IMAGE_COUNT.toString()}`);
          } else {
            expect(portCard?.subtitle ?? null, `card ${String(index)} subtitle`).toBe(
              sourceCard.subtitle
            );
          }
        }
        // The port's own rows beyond the source's card vocabulary: the two
        // header-derived cards ride the port's own main-frame capture (the
        // source's manifest declares no host permissions, so MV3 webRequest
        // observation never fires there — the source render has no Server or
        // Platform card in this environment), plus the committed
        // second-baseline extensions.
        const originNames = new Set(origin.map((card) => PORT_NAME_DELTAS[card.name] ?? card.name));
        expect(
          port.filter((card) => !originNames.has(card.name)).map((card) => card.name),
          'the port rows beyond the source vocabulary'
        ).toEqual([
          'Server',
          'Known Platform',
          'Self-host Google Fonts',
          'Add missing image dimensions',
          'Automatic lazy rendering',
          'Preload fonts',
          'Preconnect to external domains',
          'Priority Elements beacon'
        ]);
        // The two header-derived cards the fixture's headers create, with
        // their evidence subtitles.
        expect(port.find((card) => card.id === 'server')?.subtitle).toBe(SERVER_VALUE);
        expect(port.find((card) => card.id === 'known-platform')?.subtitle).toBe('WP Engine');
      } finally {
        await round.cleanup();
      }
    }
  );

  sourceTest(
    'resource pages: chip counts and one filter result agree with the source',
    async ({ extension, source }) => {
      const round = await openParityRound(extension, source, '#/javascript', '#/JavaScriptPage');
      try {
        // --- JavaScript page, both sides.
        await expect(round.portPanel.locator('[data-fdt="script-total"]')).toHaveText(
          `${SCRIPT_COUNTS.total.toLocaleString('en-US')} scripts`
        );
        await expect(
          round.sourcePanel.locator('div.rounded-lg.shadow-inner > button').first()
        ).toBeVisible();
        // The source's summary numbers are the chips' counts on the port side.
        const originSummary = await sourceSummaryCounts(round.sourcePanel, [
          'Delayed',
          'Non-delayed',
          'Deferred',
          'Non-deferred',
          'Inline',
          'External',
          'Total'
        ]);
        expect(originSummary['Delayed']).toBe(SCRIPT_COUNTS.delayed);
        expect(originSummary['Non-delayed']).toBe(SCRIPT_COUNTS.nonDelayed);
        expect(originSummary['Deferred']).toBe(SCRIPT_COUNTS.deferred);
        expect(originSummary['Non-deferred']).toBe(SCRIPT_COUNTS.nonDeferred);
        expect(originSummary['Inline']).toBe(SCRIPT_COUNTS.inline);
        expect(originSummary['External']).toBe(SCRIPT_COUNTS.external);
        expect(originSummary['Total']).toBe(SCRIPT_COUNTS.total);
        expect(await portChipCount(round.portPanel, 'delayed')).toBe(
          SCRIPT_COUNTS.delayed.toString()
        );
        expect(await portChipCount(round.portPanel, 'non-delayed')).toBe(
          SCRIPT_COUNTS.nonDelayed.toString()
        );
        expect(await portChipCount(round.portPanel, 'deferred')).toBe(
          SCRIPT_COUNTS.deferred.toString()
        );
        expect(await portChipCount(round.portPanel, 'non-deferred')).toBe(
          SCRIPT_COUNTS.nonDeferred.toString()
        );
        expect(await portChipCount(round.portPanel, 'inline')).toBe(
          SCRIPT_COUNTS.inline.toString()
        );
        expect(await portChipCount(round.portPanel, 'external')).toBe(
          SCRIPT_COUNTS.external.toString()
        );

        // One filter result parity: the source's Delayed click renders exactly
        // its count (its lists are not virtualized); the port's count line
        // states the same number.
        await round.sourcePanel.getByRole('button', { name: 'Delayed', exact: true }).click();
        expect(await sourceRowCount(round.sourcePanel)).toBe(SCRIPT_COUNTS.delayed);
        await round.portPanel.locator('[data-fdt-filter-chip="delayed"]').click();
        await expect(round.portPanel.locator('[data-fdt="script-results-status"]')).toHaveText(
          `Showing ${SCRIPT_COUNTS.delayed.toLocaleString('en-US')} of ${SCRIPT_COUNTS.total.toLocaleString('en-US')} scripts`
        );

        // --- Lazyload page, both sides. The source wait keys on the NEW
        //     route's summary label first: both builds' resource pages share
        //     the summary container, so a container-visibility wait matches
        //     the outgoing page too and the counts would read it.
        await round.sourcePanel.evaluate(() => {
          window.location.hash = '#/LazyLoadPage';
        });
        await expect(round.sourcePanel.locator('div.bg-gray-800.p-3')).toContainText('Lazyloaded');
        const lazySummary = await sourceSummaryCounts(round.sourcePanel, [
          'Lazyloaded',
          'Non-lazyloaded',
          'Total'
        ]);
        expect(lazySummary['Lazyloaded']).toBe(LAZY_IMAGE_COUNT);
        expect(lazySummary['Non-lazyloaded']).toBe(PLAIN_IMAGE_COUNT);
        expect(lazySummary['Total']).toBe(LAZY_IMAGE_COUNT + PLAIN_IMAGE_COUNT);
        await round.portPanel.evaluate(() => {
          location.hash = '#/lazyload';
        });
        const portLazyPage = round.portPanel.locator('[data-fdt-page="lazyload"]');
        await expect(
          portLazyPage.locator('[data-fdt-filter-chip="lazyloaded"] [data-fdt-filter-count]')
        ).toHaveText(LAZY_IMAGE_COUNT.toString());
        await expect(
          portLazyPage.locator('[data-fdt-filter-chip="non-lazyloaded"] [data-fdt-filter-count]')
        ).toHaveText(PLAIN_IMAGE_COUNT.toString());

        // --- Preloaded Resources page, both sides. Same new-route-evidence
        //     wait as the lazyload switch: the label is only the incoming
        //     route's.
        await round.sourcePanel.evaluate(() => {
          window.location.hash = '#/PreloadedResourcesPage';
        });
        await expect(round.sourcePanel.locator('div.bg-gray-800.p-3')).toContainText('Fonts');
        const preloadedSummary = await sourceSummaryCounts(round.sourcePanel, [
          'Images',
          'Fonts',
          'Total'
        ]);
        expect(preloadedSummary['Images']).toBe(PRELOAD_IMAGE_COUNT);
        expect(preloadedSummary['Fonts']).toBe(PRELOAD_FONT_COUNT);
        expect(preloadedSummary['Total']).toBe(PRELOAD_IMAGE_COUNT + PRELOAD_FONT_COUNT);
        await round.portPanel.evaluate(() => {
          location.hash = '#/preloaded-resources';
        });
        const portPreloadedPage = round.portPanel.locator('[data-fdt-page="preloaded-resources"]');
        await expect(
          portPreloadedPage.locator('[data-fdt-filter-chip="images"] [data-fdt-filter-count]')
        ).toHaveText(PRELOAD_IMAGE_COUNT.toString());
        await expect(
          portPreloadedPage.locator('[data-fdt-filter-chip="fonts"] [data-fdt-filter-count]')
        ).toHaveText(PRELOAD_FONT_COUNT.toString());
        // The feature label delta: the source names the lazyload feature on
        // this page; the port names the preload-hints feature.
        await expect(round.sourcePanel.locator('div.bg-gray-800.p-3')).toContainText('Lazyload');
        await expect(portPreloadedPage.locator('[data-fdt="resource-summary"]')).toContainText(
          'Preload hints'
        );
      } finally {
        await round.cleanup();
      }
    }
  );

  sourceTest(
    'definitions: the same stubbed asset table answers the same origins',
    async ({ extension, source }) => {
      // The found-reference fixture: the throw's word is defined by one file;
      // both panels' searches read the SAME stubbed resource table (the
      // harness's inspected-window stand-in, one array passed to both). The
      // zero-asset branch is not this round's input: the source's own
      // zero-resource loader never resolves there (a recorded source defect;
      // the port's none-found rendering is covered by its own standing
      // suites).
      const RESOURCES: readonly InspectedResourceStub[] = [
        {
          url: `${ORIGIN_A}/errors/wocket-definer.js`,
          content: 'window.wocketInventory = null;'
        }
      ];
      const portRound = await openPanelForFixture(extension, '/errors/found-reference.html', {
        bootHash: '#/undefined-references',
        inspect: { origin: ORIGIN_A, resources: RESOURCES }
      });
      const sourceFixture = await source.openFixturePage('/errors/found-reference.html', ORIGIN_A);
      const sourcePanel = await source.openPanel(
        sourceFixture,
        '#/UndefinedReferencesFinderPage',
        RESOURCES
      );
      try {
        // --- Port: the word card answers with the file origin (its display
        //     form is the file's name; the source's is the full URL — the
        //     display delta — so the origin identity rides the href).
        await expect(
          portRound.panel.getByRole('heading', { name: 'Undefined References', level: 1 })
        ).toBeVisible();
        await expect(portRound.panel.locator('[data-fdt-word]')).toHaveText('wocketInventory');
        const portDefinition = portRound.panel
          .locator('[data-fdt-definition="url"] [data-fdt="script-link"]')
          .first();
        await expect(portDefinition).toContainText('wocket-definer.js');
        const portHref = await portRound.panel
          .locator('[data-fdt-definition="url"] a')
          .first()
          .getAttribute('href');
        expect(portHref).toBe(`${ORIGIN_A}/errors/wocket-definer.js`);

        // --- Source: the same word and the same file origin (full-URL text).
        await expect(sourcePanel.getByText('wocketInventory')).toBeVisible();
        await expect(sourcePanel.locator('main a[href*="wocket-definer.js"]').first()).toHaveText(
          `${ORIGIN_A}/errors/wocket-definer.js`
        );
      } finally {
        await portRound.panel.close();
        await portRound.fixture.page.close();
        await sourcePanel.close();
        await sourceFixture.page.close();
      }
    }
  );
});
