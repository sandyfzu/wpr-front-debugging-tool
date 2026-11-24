/**
 * LazyLoad (images) simulation end to end over REAL sessions on the docker
 * site: the LazyLoad lane's mode control picked, Apply through the session
 * backend, the fulfilled document compared byte for byte with WP Rocket's
 * own render of the same page with LazyLoad on, WP Rocket's LazyLoad script
 * answered by the extension (never asked of the site), and the surfaces
 * read off the tab.
 *
 * The suite publishes its own page (`/fdt-e2e-lazyload/`: images inside and
 * outside the first screen, one with `srcset`, two WP Rocket skips, a
 * picture, a background image, an iframe, an image smiley) through wp-cli
 * and deletes it after. The site serves LazyLoad for images by default
 * (the bootstrap baseline), so a page served WITHOUT it needs the setting
 * off: the suite writes `lazyload = 0` (and `defer_all_js = 0` for the
 * three-feature leg) and restores the settings found after every leg and
 * in `afterAll`; it refuses to start off the baseline. Renders are live
 * (`fdt-no-store=1`); Delay JS is off where a leg simulates it
 * (`nowprocket=1`, which leaves LazyLoad as the setting says).
 *
 * What the byte comparison removes, beside the Delay JS normalization
 * (generator meta, markers, speculation rules, WP Rocket's comments,
 * whitespace) and the minified files' `ver`: WordPress core's lazy-loading
 * shapes, which core writes only while LazyLoad is off (the noscript
 * copies' `loading="lazy"`, the `auto, ` of their sizes), and the image
 * smiley, which WP Rocket's own smiley filter prints differently — both
 * caveats the simulation states on the page.
 */
import type { CDPSession, Locator, Page } from '@playwright/test';

import { readBadge } from '../helpers/badge';
import {
  LAZYLOAD,
  clearDrafts,
  lane,
  openSessionNotes,
  readBanners,
  typeRow
} from '../helpers/exclusion-overlay';
import { expect, test, type ExtensionDriver } from '../helpers/extension';
import { devtoolsShim, panelPageUrl } from '../helpers/panel-data';
import {
  applySimulated,
  deferModeGroup,
  delayModeGroup,
  documentDeferSimulation,
  documentLazyloadSimulation,
  documentSimulation,
  lazyloadModeGroup,
  lazyloadModeNotes,
  normalizeDelayRender,
  openCapturedBuilder,
  simulatedChip,
  simulationMarkers,
  storedSession,
  type CapturedBuilder
} from '../helpers/simulation';
import { openSitePage, SITE_URL } from '../helpers/site';
import {
  createSitePage,
  deleteSitePage,
  readWprSettings,
  siteLogMark,
  siteRequestCount,
  writeWprSettings,
  type WprSettings
} from '../helpers/site-wpcli';
import { clearWidgetMap, STRIP_HOST } from '../helpers/strip-pill';
import type { LazyloadAssetsUrlSource } from '../../../lib/wp-rocket-simulation/spec';

/** The suite's page slug (its URL path). */
const SLUG = 'fdt-e2e-lazyload';

/** The suite's page: what LazyLoad for images reads, plus what it must leave alone. */
const PAGE_HTML = [
  '<p>Smile :mrgreen: here.</p>',
  ...[1, 2, 3].map(
    (n) =>
      `<img src="/wp-content/mu-plugins/assets/fdt-lcp.png?n=${String(n)}" alt="image ${String(n)}" width="320" height="180">`
  ),
  '<img src="/wp-content/mu-plugins/assets/fdt-lcp.png?n=4" alt="srcset" width="320" height="180" srcset="/wp-content/mu-plugins/assets/fdt-lcp.png?n=4 320w, /wp-content/mu-plugins/assets/fdt-lcp.png?n=4b 640w" sizes="(max-width: 320px) 100vw, 320px">',
  '<img src="/wp-content/mu-plugins/assets/fdt-lcp.png?n=5" alt="no lazy" data-no-lazy="1" width="10" height="10">',
  '<img src="/wp-content/mu-plugins/assets/fdt-lcp.png?n=6" alt="skip lazy" class="skip-lazy" width="10" height="10">',
  '<picture><source srcset="/wp-content/mu-plugins/assets/fdt-lcp.png?p=1" type="image/webp"><img src="/wp-content/mu-plugins/assets/fdt-lcp.png?p=2" alt="picture" width="320" height="180"></picture>',
  `<div style="background-image: url('/wp-content/mu-plugins/assets/fdt-lcp.png?bg=1'); height:50px">bg</div>`,
  '<iframe src="/wp-content/mu-plugins/assets/fdt-lcp.png?frame=1" width="300" height="150" title="frame"></iframe>',
  '<div style="height:3000px"></div>',
  '<img src="/wp-content/mu-plugins/assets/fdt-lcp.png?far=1" alt="far below" width="320" height="180">'
].join('\n');

/** The page live, LazyLoad as the setting says (Delay JS and Defer JS on). */
const PAGE = `${SITE_URL}/${SLUG}/?fdt-no-store=1`;

/** The page live, Delay JS off. */
const PAGE_NO_DELAY = `${SITE_URL}/${SLUG}/?fdt-no-store=1&nowprocket=1`;

/**
 * A search results page (WP Rocket never lazy loads there). Its query
 * matches no post: WP Rocket's smiley filter still writes its lazy smiley
 * into a listed post's content (the suite's page has one), a WP Rocket
 * LazyLoad footprint that reads as already served.
 */
const SEARCH = `${SITE_URL}/?s=e2e-no-match&fdt-no-store=1`;

/** A preview URL of the page (WP Rocket never lazy loads there). */
const PREVIEW = `${SITE_URL}/${SLUG}/?preview=true&fdt-no-store=1`;

/** WP Rocket's LazyLoad script, by file name (the site serves it under its plugin folder). */
const RUNTIME_FILE = '/lazyload.min.js';

/** Bounded wait for surfaces following a load. */
const FRESH = { timeout: 15_000, intervals: [100, 250, 500] };

/** WP Rocket's lazy image carrier. */
const LAZY_IMAGE = /<img\b[^>]*\bdata-lazy-src=/g;

/** The words the surfaces carry. */
const WORDS = {
  appliedBody:
    'Rendered with your exclusions and simulated LazyLoad — not the site’s real setup. The site’s own WP Rocket exclusions aren’t included; add them as rows (LazyLoad: images only).',
  appliedAllBody:
    'Rendered with your exclusions and simulated LazyLoad, Defer JS and Delay JS — not the site’s real setup. The site’s own WP Rocket exclusions aren’t included; add them as rows (LazyLoad: images only).',
  alreadyServed:
    'WP Rocket already lazy loads images on this page — exclusions apply to its output.',
  search:
    'WP Rocket never lazy loads images on search results, so LazyLoad can’t be simulated here.',
  preview: 'WP Rocket never lazy loads images on a preview, so LazyLoad can’t be simulated here.',
  /** The banner's site-exclusions sentence: never a lane line (the version line says it in short). */
  siteExclusions:
    'The site’s own WP Rocket exclusions aren’t included; add them as rows (LazyLoad: images only).',
  /** The session note every applied banner holds (behind its disclosure). */
  persists:
    'Stays on in this tab until Stop or the tab closes; every page of this site you open here loads with these exclusions.',
  versionTail: ' · without the site’s own exclusions',
  /** The lane's every-page limits (behind its disclosure). */
  everyPageLimits: [
    'Style and scripts placed where most themes print them.',
    'Above-the-fold and LCP images aren’t skipped (needs WP Rocket’s site data).',
    'Site filters, options and DONOTLAZYLOAD aren’t applied.'
  ],
  badge: 'Simulated in this tab',
  stripHint: 'Lazyload Images simulated',
  panelNote:
    "Simulated in this tab by the extension — not the site's configuration; its own WP Rocket exclusions aren't included.",
  /** A lazy row's chip: the state word, its source the FDT simulation (flask, dashed outline). */
  panelChip: 'Lazyloaded'
} as const;

/** The lane's script-address line lead, by where the address came from. */
const INFERRED_LEAD =
  /^Script address inferred from this page; your plugin folder or CDN may differ: /;
const SCRIPT_LEADS: Readonly<Record<LazyloadAssetsUrlSource, RegExp>> = {
  beacon: /^Script address from WP Rocket’s beacon tag; a CDN may serve another: /,
  'plugin-asset': INFERRED_LEAD,
  'theme-asset': INFERRED_LEAD,
  default:
    /^Script address guessed from WordPress’s default folders; your folders or CDN may differ: /
};

/** The settings found before the suite wrote any (restored after every leg and in `afterAll`). */
let found: WprSettings | null = null;

/** The suite's page id (deleted in `afterAll`). */
let pageId: number | null = null;

/**
 * Write the baseline found with the given settings overridden.
 *
 * @param overrides The settings to change (none: the baseline itself).
 */
async function writeSettings(overrides: WprSettings = {}): Promise<void> {
  if (found === null) throw new Error('the baseline settings were never read');
  await writeWprSettings({ ...found, ...overrides });
}

/**
 * A render with what legitimately differs between a simulated document and
 * WP Rocket's own LazyLoad render removed (see the module doc).
 *
 * @param html The document's bytes.
 */
function normalizeRender(html: string): string {
  const stated = html
    // The image smiley (caveat): WP Rocket's smiley filter prints it differently with LazyLoad on.
    .replace(/<img\b[^>]*\bclass="wp-smiley"[^>]*>(?:<noscript>[\s\S]*?<\/noscript>)?/g, '[smiley]')
    // Core lazy-loading (caveat): what core wrote while LazyLoad was off, kept by the noscript copies…
    .replace(/<noscript><img loading="lazy" /g, '<noscript><img ')
    // …and in the sizes (`auto, `) of the lazy carriers and their noscript copies.
    .replace(/(data-lazy-sizes="|<noscript><img\b[^>]*?\bsizes=")auto, /g, '$1');
  return normalizeDelayRender(stated).replace(/(\/cache\/min\/[^"']*?\?ver=)\d+/g, '$1');
}

/** WP Rocket's live render of `url` (never a stored copy). */
async function liveRender(extension: ExtensionDriver, url: string): Promise<string> {
  const response = await extension.browserContext.request.get(url);
  expect(response.ok()).toBe(true);
  expect(response.headers()['last-modified']).toBeUndefined();
  const html = await response.text();
  expect(html).not.toMatch(/cached@\d+/);
  return html;
}

/** Open a site page with document capture, the overlay injected. */
async function openBuilder(extension: ExtensionDriver, url: string): Promise<CapturedBuilder> {
  return await openCapturedBuilder(extension, (hook) => openSitePage(extension, url, hook));
}

/**
 * Empty the browser's HTTP cache: a request the extension does not answer
 * must then reach the site (an earlier suite may have cached WP Rocket's
 * script from a page that serves it).
 *
 * @param page Any page of the browser.
 */
async function clearHttpCache(page: Page): Promise<void> {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  try {
    await cdp.send('Network.clearBrowserCache');
  } finally {
    await cdp.detach();
  }
}

/** Every radio of a mode control: value and disabled state, in order. */
async function modes(group: Locator): Promise<{ value: string; disabled: boolean }[]> {
  return await group.getByRole('radio').evaluateAll((inputs) =>
    inputs.map((input) => ({
      value: (input as HTMLInputElement).value,
      disabled: (input as HTMLInputElement).disabled
    }))
  );
}

/** An image of the page, by its alt text (the element, never its noscript copy). */
const image = (page: Page, alt: string): Locator => page.locator(`img[alt="${alt}"]`);

/** Whether LazyLoad's runtime loaded an image (its class and the real source in place). */
async function loadedImage(page: Page, alt: string): Promise<{ loaded: boolean; src: string }> {
  return await image(page, alt).evaluate((img) => ({
    loaded: img.classList.contains('lazyloaded'),
    src: (img as HTMLImageElement).getAttribute('src') ?? ''
  }));
}

/** The LazyLoad lane's count/hint/caveat lines. */
async function lazyloadLaneLines(page: Page): Promise<string[]> {
  return await lane(page, LAZYLOAD)
    .locator('.xo-lane-count, .xo-lane-hint, .xo-lane-caveat')
    .allTextContents();
}

/** The open strip card's LazyLoad row (the card opened from its pill with the keyboard). */
async function stripLazyloadRow(page: Page): Promise<Locator> {
  const card = page.locator(`${STRIP_HOST} .dw-card`);
  if (!(await card.isVisible())) {
    const pill = page.locator(`${STRIP_HOST} .dw-pill`);
    await pill.focus();
    await page.keyboard.press('Enter');
    await expect(card).toBeVisible();
  }
  return page.locator(`${STRIP_HOST} .dw-row`, {
    has: page.locator('.dw-chip', { hasText: /^Lazyload Images$/ })
  });
}

/** Open the real panel on its Lazyload page, inspecting `tabId` through the devtools seam. */
async function openLazyloadPanel(extension: ExtensionDriver, tabId: number): Promise<Page> {
  const panel = await extension.browserContext.newPage();
  await panel.addInitScript(devtoolsShim(tabId));
  await panel.goto(`${await panelPageUrl(extension)}#/lazyload`, { waitUntil: 'load' });
  return panel;
}

/**
 * Load WP Rocket's LazyLoad script by its exact URL from the page (a
 * parser-free script element, as the page's own tag would).
 *
 * @param page The page.
 * @param url The script's URL.
 * @returns `load` or `error`.
 */
async function loadScript(page: Page, url: string): Promise<string> {
  return await page.evaluate(
    async (src) =>
      await new Promise<string>((resolve) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => {
          resolve('load');
        };
        script.onerror = () => {
          resolve('error');
        };
        document.head.append(script);
      }),
    url
  );
}

test.describe('LazyLoad simulation over real sessions', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ extension }) => {
    const settings = await readWprSettings();
    const baseline = {
      lazyload: settings['lazyload'],
      lazyload_iframes: settings['lazyload_iframes'],
      lazyload_youtube: settings['lazyload_youtube'],
      defer_all_js: settings['defer_all_js'],
      delay_js: settings['delay_js']
    };
    const expected = {
      lazyload: 1,
      lazyload_iframes: 0,
      lazyload_youtube: 0,
      defer_all_js: 1,
      delay_js: 1
    };
    if (
      Object.entries(expected).some(
        ([key, value]) => Number(baseline[key as keyof typeof baseline]) !== value
      )
    ) {
      throw new Error(
        `wp_rocket_settings is not the bootstrap baseline ${JSON.stringify(expected)} (found ${JSON.stringify(baseline)}) — a killed run left it changed: run docker/scripts/up.sh to re-apply it`
      );
    }
    found = settings;
    pageId = await createSitePage(SLUG, 'LazyLoad simulation', PAGE_HTML);
    // Anonymous visitor: a site login from an earlier suite disables caching and optimizations.
    await extension.browserContext.clearCookies({ domain: new URL(SITE_URL).hostname });
  });

  test.afterAll(async () => {
    if (found !== null) await writeWprSettings(found);
    if (pageId !== null) await deleteSitePage(pageId);
  });

  test.beforeEach(async ({ extension }) => {
    await clearDrafts(extension);
    await clearWidgetMap(extension);
  });

  test.afterEach(async ({ extension }) => {
    await clearWidgetMap(extension);
    await clearDrafts(extension);
  });

  test('LazyLoad simulated on a page served without it equals WP Rocket’s LazyLoad render; its script answered by the extension; "simulated" on every surface; Stop serves the page as is', async ({
    extension
  }) => {
    await writeSettings({ lazyload: 0 });
    const served = await liveRender(extension, PAGE);
    expect(served).not.toContain('lazyLoadOptions');
    expect(served.match(LAZY_IMAGE)).toBeNull();
    const iframe = /<iframe\b[^>]*>/.exec(served)?.[0];
    expect(iframe).toContain('frame=1');

    const { opened, errors, lastDocument } = await openBuilder(extension, PAGE);
    const { page, tabId } = opened;
    const panel = await openLazyloadPanel(extension, tabId);
    try {
      expect(await modes(lazyloadModeGroup(page))).toEqual([
        { value: 'served', disabled: false },
        { value: 'simulated', disabled: false }
      ]);
      await expect(lazyloadModeNotes(page)).toHaveCount(0);
      const badgeBefore = await readBadge(extension, tabId);

      // Nothing cached: a script the extension did not answer would reach the site.
      await clearHttpCache(page);
      const logMark = await siteLogMark();
      const siteHitsBefore = await siteRequestCount(RUNTIME_FILE, logMark);
      expect(await applySimulated(page, [lazyloadModeGroup(page)])).toBe('Applied');

      const simulated = await lastDocument();
      const report = await documentLazyloadSimulation(extension, tabId);
      expect(report).toMatchObject({
        feature: 'lazyload',
        state: 'simulated',
        pictures: 1,
        backgrounds: 1,
        delivery: 'external'
      });
      expect(report.runtimeUrl).toMatch(new RegExp(`^${SITE_URL}/.*${RUNTIME_FILE}$`));
      expect(report.caveats).toEqual(
        expect.arrayContaining(['core-lazy-loading', 'image-smilies'])
      );
      expect(simulated).toContain(`src="${String(report.runtimeUrl)}"`);
      expect(simulated.match(LAZY_IMAGE)).toHaveLength(report.images + report.pictures);
      // Iframes are LazyLoad for iframes' (off): served as is.
      expect(simulated).toContain(String(iframe));
      expect(await simulationMarkers(page)).toHaveLength(1);

      // WP Rocket's runtime runs (the images in view load at once), the one far below on scroll.
      await expect.poll(async () => (await loadedImage(page, 'image 1')).loaded, FRESH).toBe(true);
      const far = await loadedImage(page, 'far below');
      expect(far.loaded).toBe(false);
      expect(far.src).toMatch(/^data:image\/svg\+xml,/);
      await image(page, 'far below').scrollIntoViewIfNeeded();
      await expect
        .poll(async () => await loadedImage(page, 'far below'), FRESH)
        .toEqual({ loaded: true, src: '/wp-content/mu-plugins/assets/fdt-lcp.png?far=1' });
      // …served by the extension: the site never saw a request for it.
      expect(await siteRequestCount(RUNTIME_FILE, logMark)).toBe(siteHitsBefore);
      expect(errors.errors).toEqual([]);

      // The overlay: the applied words name LazyLoad, its lane counts the simulation.
      await expect(simulatedChip(page, 'header')).toHaveText('Simulated');
      const banners = await readBanners(page);
      expect(banners[0]).toMatchObject({ title: 'Applied', body: WORDS.appliedBody });
      const laneLines = await lazyloadLaneLines(page);
      expect(laneLines).toEqual(
        expect.arrayContaining([
          `${String(report.images)} images, 1 picture and 1 background image lazy loaded by the simulation · 0 excluded by your rows`
        ])
      );
      expect(laneLines.filter((line) => line.endsWith(WORDS.versionTail))).toHaveLength(1);
      expect(laneLines).not.toContain(WORDS.siteExclusions);
      // The lane's limits: collapsed, then exactly the page's lines, its script address first.
      const toggle = lane(page, LAZYLOAD).getByRole('button', { name: /^\d+ limits?$/ });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(lane(page, LAZYLOAD).locator('.xo-note-disclosure-item')).toHaveCount(0);
      await toggle.click();
      const limits = await lane(page, LAZYLOAD)
        .locator('.xo-note-disclosure-item')
        .allTextContents();
      expect(limits).toEqual(expect.arrayContaining([...WORDS.everyPageLimits]));
      const source = report.assetsUrlSource;
      if (source === undefined)
        throw new Error('The simulated report names no script address source');
      expect(limits[0]).toMatch(SCRIPT_LEADS[source]);
      await expect(toggle).toHaveText(
        `${String(limits.length)} ${limits.length === 1 ? 'limit' : 'limits'}`
      );
      await toggle.click();
      await expect(lazyloadModeGroup(page).getByRole('radio', { name: 'Simulated' })).toBeChecked();

      // The detection widget: the verified marker as the LazyLoad row's modifier + the tab hint.
      const row = await stripLazyloadRow(page);
      await expect(row.locator('[data-fdt-strip-modifier]')).toHaveText(WORDS.badge, FRESH);
      await expect(
        page.locator(`${STRIP_HOST} [data-fdt-strip-builder] [data-fdt-strip-builder-hint]`)
      ).toHaveText([WORDS.stripHint]);

      // The panel's Lazyload page: simulated (never "detected"), said who did it, rows marked.
      await panel.reload({ waitUntil: 'load' });
      const summary = panel.locator('[data-fdt="resource-summary"]');
      await expect(summary.locator('[data-fdt="status-badge"]')).toHaveText('Simulated', FRESH);
      await expect(summary).not.toContainText(/detected/i);
      await expect(summary.locator('[data-fdt="resource-note"]')).toContainText([WORDS.panelNote]);
      await expect(
        panel
          .locator(
            '[data-fdt="lazyload-row"] [data-fdt="state-chip"][data-fdt-source="simulated"] [data-fdt="badge"]',
            { hasText: WORDS.panelChip }
          )
          .first()
      ).toBeVisible();

      // The toolbar badge reads the served page: a simulation is not WP Rocket.
      expect(await readBadge(extension, tabId)).toEqual(badgeBefore);

      // Stop: the next load is served as is, and WP Rocket's script URL reaches the site again.
      await page.getByRole('button', { name: 'Stop' }).click();
      await expect.poll(async () => await storedSession(extension, tabId), FRESH).toBeNull();
      await page.reload({ waitUntil: 'load' });
      const after = await lastDocument();
      expect(after).not.toContain('lazyLoadOptions');
      expect(after.match(LAZY_IMAGE)).toBeNull();
      expect(await simulationMarkers(page)).toEqual([]);
      await clearHttpCache(page);
      expect(await loadScript(page, String(report.runtimeUrl))).toBe('load');
      await expect
        .poll(async () => await siteRequestCount(RUNTIME_FILE, logMark), FRESH)
        .toBe(siteHitsBefore + 1);

      // WP Rocket's own render of the same page with LazyLoad on: the same bytes.
      await writeSettings();
      const reference = await liveRender(extension, PAGE);
      expect(reference).toMatch(/data-wpr-features="[^"]*wpr_lazyload_images/);
      expect(reference).toContain(`src="${String(report.runtimeUrl)}"`);
      expect(reference.match(LAZY_IMAGE)).toHaveLength(report.images + report.pictures);
      expect(normalizeRender(simulated)).toBe(normalizeRender(reference));
    } finally {
      await panel.close();
      await page.close();
      await writeSettings();
    }
  });

  test('a LazyLoad row composes with the simulation: its image served as is, counted as excluded', async ({
    extension
  }) => {
    await writeSettings({ lazyload: 0 });
    const { opened, lastDocument } = await openBuilder(extension, PAGE);
    const { page, tabId } = opened;
    try {
      await typeRow(page, LAZYLOAD, 'fdt-lcp.png?n=2');
      expect(await applySimulated(page, [lazyloadModeGroup(page)])).toBe('Applied');
      const simulated = await lastDocument();
      const report = await documentLazyloadSimulation(extension, tabId);
      expect(report).toMatchObject({ state: 'simulated' });
      // The row's image: as served, never a lazy carrier; the others stay lazy.
      const tag = /<img\b[^>]*\balt="image 2"[^>]*>/.exec(simulated)?.[0] ?? '';
      expect(tag).toContain('src="/wp-content/mu-plugins/assets/fdt-lcp.png?n=2"');
      expect(tag).not.toContain('data-lazy-src');
      expect(simulated).toMatch(/<img\b[^>]*\balt="image 3"[^>]*\bdata-lazy-src=/);
      expect(await lazyloadLaneLines(page)).toEqual(
        expect.arrayContaining([
          `${String(report.images)} images, 1 picture and 1 background image lazy loaded by the simulation · 1 excluded by your rows`
        ])
      );
      await page.getByRole('button', { name: 'Stop' }).click();
    } finally {
      await page.close();
      await writeSettings();
    }
  });

  test('LazyLoad, Defer JS and Delay JS simulated together equal WP Rocket’s render with all three on', async ({
    extension
  }) => {
    await writeSettings({ lazyload: 0, defer_all_js: 0 });
    const { opened, lastDocument } = await openBuilder(extension, PAGE_NO_DELAY);
    const { page, tabId } = opened;
    try {
      expect(
        await applySimulated(page, [
          lazyloadModeGroup(page),
          deferModeGroup(page),
          delayModeGroup(page)
        ])
      ).toBe('Applied');
      const simulated = await lastDocument();
      expect(await documentLazyloadSimulation(extension, tabId)).toMatchObject({
        state: 'simulated'
      });
      expect(await documentDeferSimulation(extension, tabId)).toMatchObject({
        state: 'simulated'
      });
      expect(await documentSimulation(extension, tabId)).toMatchObject({ state: 'simulated' });
      const banners = await readBanners(page);
      expect(banners[0]).toMatchObject({ title: 'Applied', body: WORDS.appliedAllBody });
      // The generic notes: collapsed behind one toggle, the persistence note first.
      expect(banners[0]?.sessionNotes).toMatch(/^\d session notes?$/);
      const sessionNotes = await openSessionNotes(page);
      expect(sessionNotes[0]).toBe(WORDS.persists);
      expect(banners[0]?.sessionNotes).toBe(
        `${String(sessionNotes.length)} session ${sessionNotes.length === 1 ? 'note' : 'notes'}`
      );
      await page.getByRole('button', { name: 'Stop' }).click();

      await writeSettings();
      const reference = await liveRender(extension, PAGE);
      expect(reference).toMatch(
        /data-wpr-features="[^"]*wpr_delay_js[^"]*wpr_defer_js[^"]*wpr_lazyload_images/
      );
      expect(normalizeRender(simulated)).toBe(normalizeRender(reference));
    } finally {
      await page.close();
      await writeSettings();
    }
  });

  test('Simulated is not offered where WP Rocket already lazy loads, nor on search results or a preview', async ({
    extension
  }) => {
    const cases: readonly { url: string; note: string }[] = [
      { url: PAGE, note: WORDS.alreadyServed },
      { url: SEARCH, note: WORDS.search },
      { url: PREVIEW, note: WORDS.preview }
    ];
    for (const { url, note } of cases) {
      const { opened } = await openBuilder(extension, url);
      try {
        expect(await modes(lazyloadModeGroup(opened.page)), url).toEqual([
          { value: 'served', disabled: false },
          { value: 'simulated', disabled: true }
        ]);
        await expect(lazyloadModeNotes(opened.page)).toHaveText([note]);
      } finally {
        await opened.page.close();
      }
    }
  });
});
