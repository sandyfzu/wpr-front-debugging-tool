/**
 * P12A suite — the on-page detection widget over the real docker site.
 *
 * The strip mounts on a per-origin opt-in (the context-menu row's storage
 * item) and reports the real WP Rocket install's detections from the data
 * hub's already-cached single pass. Every page-native fact asserted here is
 * derived inline from what the extension itself reports through its real
 * protocol channel (`getWprDetections`) — the D-2 state matrix restated as
 * the assertion's derivation, never imported from the bundle.
 *
 * The native right-click is Playwright-unreachable (see the tier README's
 * manual remainder): enablement is driven through the same storage seam the
 * menu dispatch arm writes, and the menu row's registration is probed.
 *
 * Test order is load-bearing inside this worker profile: every leg cleans up
 * its own opt-in writes so the later suites see an inert store.
 */

import type { Page } from '@playwright/test';

import { expect, type ExtensionDriver } from '../helpers/extension';
import { loginAdminPage, openSitePage, siteTest, SITE_URL } from '../helpers/site';
/** The widget's shadow-root host (D-6's element name). */
const STRIP_HOST = 'wpr-fdt-inspector';

/** The WXT storage key under `chrome.storage.sync` for the opt-in map. */
const ORIGINS_KEY = 'inspector-origins';
/** The dockered site's origin (every site navigation happens on it). */
const SITE_ORIGIN = new URL(SITE_URL).origin;

/** Settle window: the mount + the hub's pass answer after enablement. */
const MOUNT_SETTLE = { timeout: 15_000, intervals: [250, 500] };

/**
 * The dockered site's real WP Rocket page verdict (the engine's shape), as
 * the protocol channel hands it over — only the fields the derivation reads.
 */
interface SiteDetections {
  wpr: { present: boolean; cached: boolean; version: string | null; timeStamp: number | null };
  remove_unused_css: { present: boolean };
  delay_js: { present: boolean; delayedScripts: number };
  defer_all_js: { present: boolean };
  async_css: { present: boolean };
  lazyload: { present: boolean; images: unknown[] };
  lazyload_iframes: { present: boolean };
  lazyload_css_bg_img: { present: boolean };
  minify_css: { present: boolean };
  minify_js: { present: boolean };
  preload_links: { present: boolean };
  rocket_cdn: { present: boolean };
  rocket_above_the_fold_optimization: {
    present: boolean;
    preloadedImages?: string[];
  };
  automatic_lazy_rendering: {
    present: boolean;
    lazyRenderElements: number;
    locationHashes: number;
  };
  auto_preload_fonts: { present: boolean; fonts: string[] };
  preconnect_external_domains: { present: boolean; domains: string[] };
  priority_elements_beacon: {
    present: boolean;
    status: Record<string, unknown> | null;
    isMobile: boolean | null;
  };
}

/**
 * The Priority Elements family rows' derivation keys — exactly the plugin's
 * own beacon config ids (the assertion mirrors the evidence only).
 */
const FAMILY_ROWS: Array<{
  label: string;
  configKey: string;
  id: 'critical-images' | 'lazy-rendering' | 'preload-fonts' | 'preconnect-domains';
  applied: (d: SiteDetections) => number;
}> = [
  {
    label: 'Optimize critical images',
    configKey: 'atf',
    id: 'critical-images',
    applied: (d) => d.rocket_above_the_fold_optimization.preloadedImages?.length ?? 0
  },
  {
    label: 'Automatic lazy rendering',
    configKey: 'lrc',
    id: 'lazy-rendering',
    applied: (d) => d.automatic_lazy_rendering.lazyRenderElements
  },
  {
    label: 'Preload fonts',
    configKey: 'preload_fonts',
    id: 'preload-fonts',
    applied: (d) => d.auto_preload_fonts.fonts.length
  },
  {
    label: 'Preconnect to external domains',
    configKey: 'preconnect_external_domain',
    id: 'preconnect-domains',
    applied: (d) => d.preconnect_external_domains.domains.length
  }
];

/**
 * The row set the card renders, restated inside the assertion (the verified
 * feature names, the study's groups). Used to pin the card's row labels and
 * the group headers exactly.
 */
const EXPECTED_ROWS: Array<{ label: string; group: string }> = [
  { label: 'Remove Unused CSS', group: 'File Optimization' },
  { label: 'Delay JavaScript execution', group: 'File Optimization' },
  { label: 'Load JavaScript deferred', group: 'File Optimization' },
  { label: 'Load CSS asynchronously', group: 'File Optimization' },
  { label: 'Minify CSS', group: 'File Optimization' },
  { label: 'Minify JavaScript', group: 'File Optimization' },
  { label: 'Image LazyLoad', group: 'Media' },
  { label: 'Iframes and videos LazyLoad', group: 'Media' },
  { label: 'CSS background images LazyLoad', group: 'Media' },
  { label: 'Preload links', group: 'Preload' },
  { label: 'RocketCDN', group: 'CDN' },
  ...FAMILY_ROWS.map((row) => ({ label: row.label, group: 'Features' }))
];

/** The chip state a given evidence state maps to (the D-2 matrix). */
function chipStateFor(state: string): string {
  switch (state) {
    case 'applied':
      return 'ins-chip-ok';
    case 'collecting':
      return 'ins-chip-attention';
    default:
      return 'ins-chip-neutral';
  }
}

/** The evidence state of one simple (markup-evidence) row. */
function simpleState(present: boolean): string {
  return present ? 'applied' : 'not applied';
}

/**
 * The evidence state of one family row: applied evidence wins, then the
 * page's collecting-phase markup, then the beacon config's allowed-context
 * answer (true reads collecting; a present false/omitted key reads not
 * enabled; an unreadable config degrades to not applied) — the same
 * composition the engine's view model performs, restated for the assertion.
 */
function familyState(
  key: string,
  appliedCount: number,
  collecting: boolean,
  beacon: SiteDetections['priority_elements_beacon']
): string {
  if (appliedCount > 0) return 'applied';
  if (collecting) return 'collecting';
  const status = beacon.status;
  if (status !== null && status[key] === true) return 'collecting';
  if (status !== null) return 'not enabled';
  return 'not applied';
}

/**
 * The expected chip class for one row, derived from the real detections.
 *
 * @param detections The tab's real engine output.
 * @param label The row's feature name.
 */
function expectedChip(detections: SiteDetections, label: string): string {
  const family = FAMILY_ROWS.find((row) => row.label === label);
  if (family === undefined) {
    const presentByLabel: Record<string, boolean | undefined> = {
      'Remove Unused CSS': detections.remove_unused_css.present,
      'Delay JavaScript execution': detections.delay_js.present,
      'Load JavaScript deferred': detections.defer_all_js.present,
      'Load CSS asynchronously': detections.async_css.present,
      'Image LazyLoad': detections.lazyload.present,
      'Iframes and videos LazyLoad': detections.lazyload_iframes.present,
      'CSS background images LazyLoad': detections.lazyload_css_bg_img.present,
      'Minify CSS': detections.minify_css.present,
      'Minify JavaScript': detections.minify_js.present,
      'Preload links': detections.preload_links.present,
      RocketCDN: detections.rocket_cdn.present
    };
    const present = presentByLabel[label];
    if (present === undefined) throw new Error(`the suite has no expected state for ${label}`);
    return chipStateFor(simpleState(present));
  }
  const collecting =
    family.id === 'lazy-rendering' ? detections.automatic_lazy_rendering.locationHashes > 0 : false;
  return chipStateFor(
    familyState(
      family.configKey,
      family.applied(detections),
      collecting,
      detections.priority_elements_beacon
    )
  );
}

/** What the shadow root reports (probe strings + per-row chip classes). */
interface StripRead {
  mounted: boolean;
  pillText: string | null;
  pillExpanded: string | null;
  cardOpen: boolean;
  title: string | null;
  cacheText: string | null;
  rows: Array<{ row: string; label: string | null; chip: string | null }>;
  groups: string[];
  footer: string | null;
  focusedClass: string | null;
}

/**
 * Read the widget's whole shadow tree (the host absent reads `mounted: false`).
 *
 * @param page The page whose (possibly absent) widget is probed.
 */
async function readStrip(page: Page): Promise<StripRead> {
  return await page.evaluate((host: string): StripRead => {
    const root = document.querySelector(host)?.shadowRoot ?? null;
    if (root === null) {
      return {
        mounted: false,
        pillText: null,
        pillExpanded: null,
        cardOpen: false,
        title: null,
        cacheText: null,
        rows: [],
        groups: [],
        footer: null,
        focusedClass: null
      };
    }
    const chrome = root.querySelector('.ins-chrome');
    const pill = root.querySelector('.ins-pill');
    const card = root.querySelector('.ins-card');
    return {
      mounted: true,
      pillText: pill?.textContent ?? null,
      pillExpanded: pill?.getAttribute('aria-expanded') ?? null,
      cardOpen: chrome?.classList.contains('ins-open') === true && card !== null,
      title: root.querySelector('.ins-title')?.textContent ?? null,
      cacheText: root.querySelector('.ins-card-head .ins-cache')?.textContent ?? null,
      groups: [...root.querySelectorAll('.ins-group-label')].map((node) => node.textContent),
      rows: [...root.querySelectorAll('.ins-row')].map((row) => ({
        row: row.querySelector('.ins-chip')?.textContent ?? '',
        label: row.querySelector('.ins-chip')?.textContent ?? null,
        chip: row.querySelector('.ins-chip')?.className ?? null
      })),
      footer: root.querySelector('.ins-card-foot')?.textContent ?? null,
      focusedClass: root.activeElement?.className ?? null
    };
  }, STRIP_HOST);
}

/** Enable or disable the widget for the site's origin (the dispatch seam). */
async function setWidgetEnabled(driver: ExtensionDriver, enabled: boolean): Promise<void> {
  await driver.evaluateInWorker(
    async (payload: { key: string; origin: string; enabled: boolean }) => {
      const current = (await chrome.storage.sync.get([payload.key]))[payload.key] as
        Record<string, unknown> | undefined;
      const map = { ...(current ?? {}) };
      map[payload.origin] = { enabled: payload.enabled };
      await chrome.storage.sync.set({ [payload.key]: map });
    },
    { key: ORIGINS_KEY, origin: SITE_ORIGIN, enabled }
  );
}

/** Remove the opt-in map entirely (the later suites must see an inert store). */
async function clearWidgetOptIn(driver: ExtensionDriver): Promise<void> {
  await driver.evaluateInWorker(async (key: string) => {
    await chrome.storage.sync.remove([key]);
  }, ORIGINS_KEY);
}

/** Reset the stored appearance (the palette legs pin their own per test). */
async function resetAppearance(driver: ExtensionDriver): Promise<void> {
  await driver.evaluateInWorker(async (appearance: string): Promise<void> => {
    const current = (await chrome.storage.sync.get(['options']))['options'] as
      { appearance?: string } | undefined;
    await chrome.storage.sync.set({
      options: {
        improvements: {},
        appearance,
        features: {},
        ...(current ?? {})
      }
    });
  }, 'system');
}

/* The chip's state classes the derivation compares against. */
const CHIP_CLASSES = ['ins-chip-ok', 'ins-chip-attention', 'ins-chip-neutral'] as const;

/** The class one rendered row carries, read through its chip's class list. */
function renderedChipClass(chip: string | null): string | null {
  if (chip === null) return null;
  for (const state of CHIP_CLASSES) {
    if (chip.includes(state)) return state;
  }
  return null;
}

/**
 * The dockered site's panel page the worker fixture navigates for this
 * suite's legs.
 */
const FDT_PAGE_URL = `${SITE_URL}/fdt/`;

/** A computed-style probe of one strip part (in-page, throws when absent). */
function stripPartStyle(
  page: Page,
  part: string,
  prop: 'backgroundColor' | 'transitionDuration' | 'color'
): Promise<string> {
  return page.evaluate(
    (payload: { host: string; part: string; prop: string }): string => {
      const host = document.querySelector<HTMLElement>(payload.host);
      const found = host?.shadowRoot?.querySelector(payload.part);
      if (found === null || found === undefined) {
        throw new Error(`the strip part ${payload.part} is missing (the widget's shape changed)`);
      }
      const style = getComputedStyle(found);
      return payload.prop === 'backgroundColor'
        ? style.backgroundColor
        : payload.prop === 'transitionDuration'
          ? style.transitionDuration
          : style.color;
    },
    { host: STRIP_HOST, part, prop }
  );
}

siteTest.describe('site detection widget', () => {
  // The cached truths below are served to ANONYMOUS visitors: WP Rocket
  // serves logged-in users plain pages (no cache, no optimization). Earlier
  // suite files in the run may have logged in on this shared worker profile.
  // The clearCookies legs below wipe that login — this file's afterAll logs
  // back in so the LATER files' cached admin fixture stays what it was.
  siteTest.beforeAll(async ({ extension }) => {
    await extension.browserContext.clearCookies({ domain: new URL(SITE_URL).hostname });
  });

  siteTest.afterAll(async ({ adminPage }) => {
    await loginAdminPage(adminPage);
  });

  siteTest('the widget is hidden by default on every page', async ({ extension }) => {
    const page = (await openSitePage(extension, FDT_PAGE_URL)).page;
    await expect(page.locator(STRIP_HOST)).toHaveCount(0);
    await page.close();
  });

  siteTest('the opt-in row is registered once in the menu registry', async ({ extension }) => {
    const state = await extension.probeMenuId('toggleDetectionWidget', false);
    expect(state, 'the detection-widget toggle entry is registered').toBe('registered');
  });

  siteTest(
    'enabling the origin mounts the pill with the real cached-page verdict',
    async ({ extension }) => {
      await setWidgetEnabled(extension, true);
      const { page } = await openSitePage(extension, FDT_PAGE_URL);
      try {
        await expect(page.locator(STRIP_HOST)).toHaveCount(1);
        // The cached /fdt/ page's own verdict: identity + the ✓ Cached chip
        // with the formatted stamp suffix.
        await expect
          .poll(async () => (await readStrip(page)).pillText, MOUNT_SETTLE)
          .toMatch(/^WP Rocket page analysis: WPR 3\.\d+(\.\d+)*.*✓ Cached/s);
        expect(
          (await readStrip(page)).pillText?.includes(' UTC'),
          'the stamp suffix rides the pill cache chip'
        ).toBe(true);
      } finally {
        await page.close();
        await clearWidgetOptIn(extension);
      }
    }
  );

  siteTest(
    'the report card’s rows match the docker site’s real detections',
    async ({ extension }) => {
      await setWidgetEnabled(extension, true);
      const { page, tabId } = await openSitePage(extension, FDT_PAGE_URL);
      try {
        await expect
          .poll(async () => (await readStrip(page)).pillText, MOUNT_SETTLE)
          .toContain('✓ Cached');

        await page.locator(`${STRIP_HOST} .ins-pill`).click();
        await expect(page.locator(`${STRIP_HOST} .ins-card`)).toBeVisible();
        const read = await readStrip(page);
        expect(read.cardOpen, 'the card is open').toBe(true);
        expect(read.cacheText, 'the header cache chip carries the stamp suffix').toMatch(
          /✓ Cached · [0-9-]{10} [0-9:]{8} UTC/
        );
        expect(read.footer, 'the footer stamp fixes every slot order').toMatch(
          /^WPR [\w.-]+ · WP [\w.-]+ · FDT [\w.-]+$/
        );

        // Group headers render in the study's order, every row present once.
        const groups = ['File Optimization', 'Media', 'Preload', 'CDN', 'Features'];
        for (const group of groups) {
          expect(read.groups, `the "${group}" group header renders`).toContain(group);
        }
        const renderedRows = read.rows.map((row) => row.row);
        expect(renderedRows).toEqual(EXPECTED_ROWS.map((row) => row.label));

        // Derive, per row, the expected chip from the REAL detections the tab
        // serves to the panel channel — the assertion mirrors the engine.
        const detections = await extension.sendToTab<SiteDetections | null>(
          tabId,
          'getWprDetections'
        );
        expect(detections, 'the tab answered with its real verdict').not.toBeNull();
        for (const row of EXPECTED_ROWS) {
          const expected = expectedChip(detections as SiteDetections, row.label);
          const actual = renderedChipClass(
            read.rows.find((entry) => entry.row === row.label)?.chip ?? null
          );
          expect(actual, `chip matches for ${row.label}`).toBe(expected);
        }
      } finally {
        await page.close();
        await clearWidgetOptIn(extension);
      }
    }
  );

  siteTest(
    'disabling hides the widget with no reload; the choice persists across reloads',
    async ({ extension }) => {
      await setWidgetEnabled(extension, true);
      const { page } = await openSitePage(extension, FDT_PAGE_URL);
      try {
        await expect(page.locator(STRIP_HOST)).toHaveCount(1);

        // Same page (proven by a hash mutation the page would lose on a
        // reload): disabling unmounts without navigation.
        const hashMarker = `#toggle-${String(Date.now())}`;
        await page.evaluate((marker: string) => {
          history.pushState(null, '', marker);
        }, hashMarker);
        await setWidgetEnabled(extension, false);
        await expect(page.locator(STRIP_HOST)).toHaveCount(0);
        expect(
          await page.evaluate(() => window.location.hash),
          'the page never reloaded under the disable'
        ).toBe(hashMarker);

        // Enabling again mounts again; the choice then survives a reload.
        await setWidgetEnabled(extension, true);
        await expect(page.locator(STRIP_HOST)).toHaveCount(1);
        await page.reload({ waitUntil: 'load' });
        await expect.poll(async () => (await readStrip(page)).mounted, MOUNT_SETTLE).toBe(true);
      } finally {
        await setWidgetEnabled(extension, false);
        await page.close();
        await clearWidgetOptIn(extension);
      }
    }
  );

  siteTest(
    'the pill opens focused and Escape hands focus back — reduced motion included',
    async ({ extension }) => {
      await setWidgetEnabled(extension, true);
      const { page } = await openSitePage(extension, FDT_PAGE_URL);
      try {
        await expect.poll(async () => (await readStrip(page)).mounted, MOUNT_SETTLE).toBe(true);
        await page.emulateMedia({ reducedMotion: 'reduce' });

        // Keyboard trace: pill focused, Enter opens, Escape closes.
        await page.evaluate(
          (payload: { host: string; part: string }): void => {
            const pill = document
              .querySelector<HTMLElement>(payload.host)
              ?.shadowRoot?.querySelector<HTMLElement>(payload.part);
            if (pill === null || pill === undefined) {
              throw new Error(`the strip part ${payload.part} is missing (shape changed)`);
            }
            pill.focus();
          },
          { host: STRIP_HOST, part: '.ins-pill' }
        );
        await expect(page.locator(`${STRIP_HOST} .ins-pill`)).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.locator(`${STRIP_HOST} .ins-card`)).toBeVisible();
        expect((await readStrip(page)).pillExpanded, 'aria-expanded rides the pill').toBe('true');

        // Reduced motion: the card is machinery-free (the scoped rule beats
        // the token override's 0.01ms global leg).
        expect(
          await stripPartStyle(page, '.ins-card', 'transitionDuration'),
          'the card has no reduced-motion transition leg'
        ).toBe('0s');

        await page.keyboard.press('Escape');
        await expect(page.locator(`${STRIP_HOST} .ins-card`)).toBeHidden();
        // Focus lands back on the pill (the marker pill regains it).
        await expect
          .poll(async () => (await readStrip(page)).focusedClass, {
            timeout: 5_000,
            intervals: [100]
          })
          .toContain('ins-pill');
      } finally {
        await page.close();
        await clearWidgetOptIn(extension);
      }
    }
  );

  siteTest(
    'KC and the strip coexist — their anchors never overlap',
    async ({ extension, adminPage }) => {
      await setWidgetEnabled(extension, true);
      try {
        // The worker's admin page: re-affirm the login first (cross-file
        // cookie state is not a leg's input), then navigate.
        await loginAdminPage(adminPage);
        await adminPage.goto(`${SITE_URL}/wp-admin/plugins.php`, { waitUntil: 'load' });
        await expect
          .poll(
            async () =>
              await adminPage.evaluate(
                (): boolean => document.querySelector('wpr-fdt-inspector') !== null
              ),
            { timeout: 10_000, intervals: [250, 500] }
          )
          .toBe(true);
        await expect
          .poll(
            async () =>
              await adminPage.evaluate(
                (): boolean => document.querySelector('wpr-fdt-known-conflicts') !== null
              ),
            { timeout: 15_000, intervals: [250, 500] }
          )
          .toBe(true);
        const overlap = await adminPage.evaluate((): boolean => {
          const host = document.querySelector('wpr-fdt-inspector');
          const ins = host?.shadowRoot?.querySelector('.ins-chrome');
          const kc = document
            .querySelector('wpr-fdt-known-conflicts')
            ?.shadowRoot?.querySelector('.kc-chrome');
          if (kc === null || kc === undefined || ins === null || ins === undefined) {
            throw new Error('one widget missing its floating chrome');
          }
          const kcBox = (kc as HTMLElement).getBoundingClientRect();
          const insBox = (ins as HTMLElement).getBoundingClientRect();
          return !(
            kcBox.right < insBox.left ||
            insBox.right < kcBox.left ||
            kcBox.bottom < insBox.top ||
            insBox.bottom < kcBox.top
          );
        });
        expect(overlap, 'the two floating widgets cross no boxes').toBe(false);
      } finally {
        await setWidgetEnabled(extension, false);
      }
    }
  );

  siteTest(
    'both palettes + the stored appearance live-follow on the strip',
    async ({ extension }) => {
      await setWidgetEnabled(extension, true);
      const { page } = await openSitePage(extension, FDT_PAGE_URL);
      try {
        await expect.poll(async () => (await readStrip(page)).mounted, MOUNT_SETTLE).toBe(true);

        // The pill reads `--surface-2` in both palettes; the system choice
        // declares itself and lets the OS scheme flip resolve (Playwright
        // emulates prefers-color-scheme faithfully).
        await page.emulateMedia({ colorScheme: 'dark' });
        const darkBackground = await stripPartStyle(page, '.ins-pill', 'backgroundColor');
        await page.emulateMedia({ colorScheme: 'light' });
        const lightBackground = await stripPartStyle(page, '.ins-pill', 'backgroundColor');
        expect(lightBackground, 'the surface token resolves both OS palettes').not.toBe(
          darkBackground
        );

        // The stored choice wins over the OS scheme, live: the appearance
        // write restyles the mounted tree without a reload.
        await extension.evaluateInWorker(async (appearance: string): Promise<void> => {
          const current = (await chrome.storage.sync.get(['options']))['options'] as
            Record<string, unknown> | undefined;
          await chrome.storage.sync.set({
            options: {
              improvements: {},
              features: {},
              ...(current ?? {}),
              appearance
            }
          });
        }, 'dark');
        await expect
          .poll(async () => stripPartStyle(page, '.ins-pill', 'backgroundColor'), {
            timeout: 10_000,
            intervals: [250, 500]
          })
          .toBe(darkBackground);
      } finally {
        await resetAppearance(extension);
        await page.close();
        await clearWidgetOptIn(extension);
      }
    }
  );
});
