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

/** The containment margin the drag clamp keeps (`DRAG_TUNING.containmentMarginPx`). */
const DRAG_CONTAINMENT_MARGIN = 4;

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

/** A draggable shape's viewport box (the fields the drag assertions read). */
interface DragScriptBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** The strip's live geometry (the DOM-honest drag-leg probe). */
interface StripGeometry {
  /** The visible shape's box: the card when open, else the pill. */
  shape: DragScriptBox | null;
  /** The live viewport (layout-client space — the fixed anchor's basis). */
  viewport: { width: number; height: number };
  /** The page's scroll offsets + scrollable extents (the SB-D16 pin). */
  scroll: { x: number; y: number; extentWidth: number; extentHeight: number };
  /** Whether the chrome carries the dragging state right now. */
  dragging: boolean;
  /** The chrome's computed cursor (the grab/grabbing affordance). */
  cursor: string;
}

/**
 * Probe the strip's live geometry in-page: the open card is the shape while
 * it covers the pill, otherwise the pill is; the fixed anchor rests per the
 * layout viewport (`documentElement.clientWidth` — scrollbars excluded),
 * which is the honest basis for the 16/16 and clamp assertions.
 *
 * @param page The page whose (possibly absent) widget is probed.
 */
async function stripGeometry(page: Page): Promise<StripGeometry> {
  return await page.evaluate((host: string): StripGeometry => {
    const root = document.querySelector(host)?.shadowRoot ?? null;
    const chrome = root?.querySelector('.ins-chrome') ?? null;
    const cardOpen = chrome?.classList.contains('ins-open') === true;
    const shape = root?.querySelector<HTMLElement>(cardOpen ? '.ins-card' : '.ins-pill') ?? null;
    const documentElement = document.documentElement;
    const asBox = (element: HTMLElement): DragScriptBox => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      };
    };
    return {
      shape: shape === null ? null : asBox(shape),
      viewport: { width: documentElement.clientWidth, height: documentElement.clientHeight },
      scroll: {
        x: window.scrollX,
        y: window.scrollY,
        extentWidth: documentElement.scrollWidth,
        extentHeight: documentElement.scrollHeight
      },
      dragging: chrome?.classList.contains('ins-dragging') === true,
      cursor: chrome === null ? '' : getComputedStyle(chrome).cursor
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

/**
 * Wait until the drag-asserted shapes are animation-free: the mount's
 * one-shot entrance and the open/close/hand-back choreography settle their
 * transforms, so position reads afterwards are settled geometry. The
 * pending phase's pulse chip animates on and is deliberately out here (the
 * pill/card boxes carry the drag's truth, not the chip's color beat).
 *
 * @param page The page whose widget's choreography settles.
 */
async function waitForChoreographySettle(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        await page.evaluate((host: string): string => {
          const root = document.querySelector(host)?.shadowRoot ?? null;
          if (root === null) return 'missing';
          const animated = [
            ...root.querySelectorAll<HTMLElement>('.ins-chrome, .ins-pill, .ins-card')
          ].some((node) => node.getAnimations().length > 0);
          return animated ? 'moving' : 'settled';
        }, STRIP_HOST),
      { timeout: 10_000, intervals: [100, 250] }
    )
    .toBe('settled');
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
        // The width contract measures the SETTLED card: the open choreography's
        // spring overshoots scale (a mid-flight rect reads wider than shipped).
        await waitForChoreographySettle(page);
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

        // Width contract (owner feedback round, 2026-10-13): every feature
        // name renders whole at the shipped card width — no chip is allowed
        // to elide over ANY registry row — and the value sits as its own
        // info-pair chip at the fixed 4 px row gap (the SB-D5 informational
        // pair reading: a distinct second surface, no state claim). The card
        // is min(352px, 100vw − 32px): asserted at the leg's viewport through
        // its literal.
        const geometry = await page.evaluate((host: string) => {
          const root = document.querySelector(host)?.shadowRoot ?? null;
          const card = root?.querySelector<HTMLElement>('.ins-card');
          const rows = [...(root?.querySelectorAll<HTMLElement>('.ins-row') ?? [])];
          return {
            cardWidth: card?.getBoundingClientRect().width ?? 0,
            viewportWidth: document.documentElement.clientWidth,
            rows: rows.map((row) => {
              const chip = row.querySelector<HTMLElement>('.ins-chip');
              const value = row.querySelector<HTMLElement>('.ins-value');
              const chipBox = chip?.getBoundingClientRect();
              const valueBox = value?.getBoundingClientRect();
              return {
                chip,
                value,
                gap:
                  chipBox !== undefined && valueBox !== undefined
                    ? valueBox.left - chipBox.right
                    : null,
                valueStyle: value === null ? null : getComputedStyle(value).backgroundColor
              };
            })
          };
        }, STRIP_HOST);
        expect(
          Math.abs(geometry.cardWidth - Math.min(352, geometry.viewportWidth - 32)),
          'the card rides the shipped viewport-bounded width'
        ).toBeLessThan(2);
        for (const row of geometry.rows) {
          const chip = row.chip;
          if (chip === null) throw new Error('a row lost its label chip');
          expect(
            chip.scrollWidth > chip.clientWidth,
            `the label of "${chip.textContent}" renders whole (no elide) at the shipped width`
          ).toBe(false);
          if (row.value !== null) {
            expect(
              row.value.scrollWidth > row.value.clientWidth,
              `the value of "${chip.textContent}" renders whole`
            ).toBe(false);
            expect(
              row.gap,
              `the value chip of "${chip.textContent}" sits at the row's 4 px gap`
            ).toBe(4);
            expect(
              row.valueStyle,
              `the value chip of "${chip.textContent}" carries a soft surface`
            ).not.toBe('rgba(0, 0, 0, 0)');
          }
        }
        const countedRows = geometry.rows.filter((row) => row.value !== null);
        expect(countedRows.length, 'the counted rows carry their value chips').toBeGreaterThan(0);
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
    'the pill drags beneath the pointer and reload returns it to the resting anchor (position is never stored)',
    async ({ extension }) => {
      await setWidgetEnabled(extension, true);
      const { page } = await openSitePage(extension, FDT_PAGE_URL);
      try {
        await expect.poll(async () => (await readStrip(page)).mounted, MOUNT_SETTLE).toBe(true);
        // The scan's verdict first: a pending→ready flip mid-drag would wander
        // under the held pointer (the pill's identity/chip re-composes).
        await expect
          .poll(async () => (await readStrip(page)).pillText, MOUNT_SETTLE)
          .toMatch(/✓ Cached|Not cached/);
        await waitForChoreographySettle(page);
        const resting = await stripGeometry(page);
        const pill = resting.shape;
        if (pill === null) throw new Error('the pill is missing its shape');
        // The resting anchor (bottom-right 16/16) — the baseline the drag departs from.
        expect(
          Math.abs(pill.right - (resting.viewport.width - 16)),
          'the resting pill rests 16 px off the right edge'
        ).toBeLessThan(2);
        expect(
          Math.abs(pill.bottom - (resting.viewport.height - 16)),
          'the resting pill rests 16 px off the bottom edge'
        ).toBeLessThan(2);

        const pillLocator = page.locator(`${STRIP_HOST} .ins-pill`);
        // The press rides the pill's center (the grab offset = pointer→top-left),
        // so the top-left must follow the pointer's exact travel from there.
        const press = { x: pill.left + pill.width / 2, y: pill.top + pill.height / 2 };
        await pillLocator.hover();
        await page.mouse.down();
        await page.mouse.move(press.x - 240, press.y - 140, { steps: 12 });
        // Mid-drag the grabbing affordance is on (SB-D12's cursor legs).
        await expect.poll(async () => (await stripGeometry(page)).dragging).toBe(true);
        await page.mouse.up();
        await expect.poll(async () => (await stripGeometry(page)).dragging).toBe(false);
        await waitForChoreographySettle(page);

        const dragged = await stripGeometry(page);
        const draggedShape = dragged.shape;
        if (draggedShape === null) throw new Error('the dragged pill lost its shape');
        // The pointer delta arrived 1:1 (the grabbed point stays under the pointer).
        expect(
          Math.abs(draggedShape.left - (pill.left - 240)),
          'the pill\u2019s top-left followed the pointer\u2019s left delta'
        ).toBeLessThan(2);
        expect(
          Math.abs(draggedShape.top - (pill.top - 140)),
          'the pill\u2019s top-left followed the pointer\u2019s top delta'
        ).toBeLessThan(2);
        // The same press must never open the card (its click belonged to the drag).
        expect((await readStrip(page)).cardOpen).toBe(false);

        // Session-local by decision: a reload never reads a position back.
        await page.reload({ waitUntil: 'load' });
        await expect.poll(async () => (await readStrip(page)).mounted, MOUNT_SETTLE).toBe(true);
        await expect
          .poll(async () => (await readStrip(page)).pillText, MOUNT_SETTLE)
          .toMatch(/✓ Cached|Not cached/);
        await waitForChoreographySettle(page);
        const after = await stripGeometry(page);
        const againShape = after.shape;
        if (againShape === null) throw new Error('the repainted pill lost its shape');
        expect(
          Math.abs(againShape.right - (after.viewport.width - 16)),
          'the reload rested the pill back at the right anchor'
        ).toBeLessThan(2);
        expect(
          Math.abs(againShape.bottom - (after.viewport.height - 16)),
          'the reload rested the pill back at the bottom anchor'
        ).toBeLessThan(2);
      } finally {
        await page.close();
        await clearWidgetOptIn(extension);
      }
    }
  );

  siteTest(
    'the card follows the dragged anchor and open/close keeps it (one draggable chrome)',
    async ({ extension }) => {
      await setWidgetEnabled(extension, true);
      const { page } = await openSitePage(extension, FDT_PAGE_URL);
      try {
        await expect.poll(async () => (await readStrip(page)).mounted, MOUNT_SETTLE).toBe(true);
        await expect
          .poll(async () => (await readStrip(page)).pillText, MOUNT_SETTLE)
          .toMatch(/✓ Cached|Not cached/);
        await waitForChoreographySettle(page);
        const pill = page.locator(`${STRIP_HOST} .ins-pill`);
        const pillBox = (await pill.boundingBox()) ?? null;
        if (pillBox === null) throw new Error('the pill is missing a box');
        // First: drag the pill somewhere (the press rides the pill's center,
        // so the top-left's displacement equals the pointer's).
        const press = {
          x: pillBox.x + pillBox.width / 2,
          y: pillBox.y + pillBox.height / 2
        };
        await pill.hover();
        await page.mouse.down();
        await page.mouse.move(press.x - 260, press.y - 160, { steps: 10 });
        await page.mouse.up();
        await waitForChoreographySettle(page);
        const draggedCorner = await stripGeometry(page);
        const corner = draggedCorner.shape;
        if (corner === null) throw new Error('the dragged pill lost its shape');

        // The card opens FROM the dragged anchor: same bottom-right corner
        // (both shapes hand it over inside the chrome).
        await pill.click();
        await expect(page.locator(`${STRIP_HOST} .ins-card`)).toBeVisible();
        await waitForChoreographySettle(page);
        const opened = await stripGeometry(page);
        const card = opened.shape;
        if (card === null) throw new Error('the open card lost its shape');
        expect(
          Math.abs(card.right - corner.right),
          'the open card took the pill\u2019s dragged right corner'
        ).toBeLessThan(2);
        expect(
          Math.abs(card.bottom - corner.bottom),
          'the open card took the pill\u2019s dragged bottom corner'
        ).toBeLessThan(2);

        // Then: drag the card by its header's non-interactive regions (the
        // close control on the right never grabs — aim at the title side).
        await page.mouse.move(card.left + 24, card.top + 12);
        await page.mouse.down();
        await page.mouse.move(card.left + 124, card.top - 70, { steps: 10 });
        await page.mouse.up();
        await waitForChoreographySettle(page);
        const cardDragged = await stripGeometry(page);
        const moved = cardDragged.shape;
        if (moved === null) throw new Error('the card drag lost its shape');
        expect(
          Math.abs(moved.left - (card.left + 100)),
          'the card followed its header pointer delta'
        ).toBeLessThan(3);
        expect(
          Math.abs(moved.top - (card.top - 82)),
          'the card followed its header pointer delta vertically'
        ).toBeLessThan(3);

        // Escape closes: the pill returns AT the dragged corner, not the resting one.
        await page.keyboard.press('Escape');
        await expect(page.locator(`${STRIP_HOST} .ins-pill`)).toBeFocused();
        await waitForChoreographySettle(page);
        const returned = await stripGeometry(page);
        const pillAgain = returned.shape;
        if (pillAgain === null) throw new Error('the returned pill lost its shape');
        expect(
          Math.abs(pillAgain.right - moved.right),
          'the returned pill kept the dragged right corner'
        ).toBeLessThan(2);
        expect(
          Math.abs(pillAgain.bottom - moved.bottom),
          'the returned pill kept the dragged bottom corner'
        ).toBeLessThan(2);
        // And it opens where the pill stands: no snap-back to the resting anchor.
        await pill.click();
        await expect(page.locator(`${STRIP_HOST} .ins-card`)).toBeVisible();
        await waitForChoreographySettle(page);
        const reopened = await stripGeometry(page);
        const reopenedCard = reopened.shape;
        if (reopenedCard === null) throw new Error('the reopened card lost its shape');
        expect(
          Math.abs(reopenedCard.right - moved.right),
          'the reopened card never snapped back'
        ).toBeLessThan(2);
        expect(
          Math.abs(reopenedCard.bottom - moved.bottom),
          'the reopened card never snapped back vertically'
        ).toBeLessThan(2);
      } finally {
        await page.close();
        await clearWidgetOptIn(extension);
      }
    }
  );

  siteTest(
    'after a card-handle drag, Escape hands focus back and Enter still opens the card (suppression is pointer-only)',
    async ({ extension }) => {
      await setWidgetEnabled(extension, true);
      const { page } = await openSitePage(extension, FDT_PAGE_URL);
      try {
        await expect.poll(async () => (await readStrip(page)).mounted, MOUNT_SETTLE).toBe(true);
        await expect
          .poll(async () => (await readStrip(page)).pillText, MOUNT_SETTLE)
          .toMatch(/✓ Cached|Not cached/);
        await waitForChoreographySettle(page);
        const pill = page.locator(`${STRIP_HOST} .ins-pill`);
        // Open, then drag the card by its header: the release's captured click
        // lands on the card root (consumer-less) and leaves the suppression
        // armed — the auditor's one-lost-Enter setup.
        await pill.click();
        await expect(page.locator(`${STRIP_HOST} .ins-card`)).toBeVisible();
        await waitForChoreographySettle(page);
        const opened = await stripGeometry(page);
        const card = opened.shape;
        if (card === null) throw new Error('the open card lost its shape');
        await page.mouse.move(card.left + 24, card.top + 12);
        await page.mouse.down();
        await page.mouse.move(card.left - 16, card.top - 42, { steps: 8 });
        await page.mouse.up();
        await waitForChoreographySettle(page);

        // Escape closes (focus rides back to the pill), then Enter re-opens:
        // the keyboard activation click (detail 0) must never read the
        // pointer path's suppression flag — the first Enter opens, not the
        // second (SB-D9's no-dead-ends through the keyboard).
        await page.keyboard.press('Escape');
        await expect(page.locator(`${STRIP_HOST} .ins-pill`)).toBeFocused();
        await waitForChoreographySettle(page);
        await page.keyboard.press('Enter');
        await expect(page.locator(`${STRIP_HOST} .ins-card`)).toBeVisible();
        const reopened = await readStrip(page);
        expect(reopened.cardOpen, 'the first Enter opens the card').toBe(true);
        expect(reopened.pillExpanded, 'aria-expanded rode the keyboard open').toBe('true');
      } finally {
        await page.close();
        await clearWidgetOptIn(extension);
      }
    }
  );

  siteTest(
    'drags keep the chrome fully inside the viewport and scroll nothing (SB-D16 pin)',
    async ({ extension }) => {
      await setWidgetEnabled(extension, true);
      const { page } = await openSitePage(extension, FDT_PAGE_URL);
      try {
        await expect.poll(async () => (await readStrip(page)).mounted, MOUNT_SETTLE).toBe(true);
        await expect
          .poll(async () => (await readStrip(page)).pillText, MOUNT_SETTLE)
          .toMatch(/✓ Cached|Not cached/);
        await waitForChoreographySettle(page);
        const pill = page.locator(`${STRIP_HOST} .ins-pill`);
        const pillBox = (await pill.boundingBox()) ?? null;
        if (pillBox === null) throw new Error('the pill is missing a box');
        const before = await stripGeometry(page);

        await pill.hover();
        await page.mouse.down();
        // The grab point outruns toward the top-left corner; the chrome may
        // not (full containment is the owner binding). Sample the live box
        // MID-DRAG, before releasing.
        await page.mouse.move(2, 2, { steps: 14 });
        const midDrag = await stripGeometry(page);
        const midShape = midDrag.shape;
        if (midShape === null) throw new Error('the mid-drag pill lost its shape');
        expect(midDrag.dragging, 'the drag is live at the sampled point').toBe(true);
        expect(
          midShape.left,
          'the mid-drag box stays inside the left edge (the containment margin)'
        ).toBeGreaterThanOrEqual(4 - 2);
        expect(midShape.top, 'the mid-drag box stays inside the top edge').toBeGreaterThanOrEqual(
          4 - 2
        );
        expect(midShape.right, 'the mid-drag box stays inside the right edge').toBeLessThanOrEqual(
          midDrag.viewport.width - 2
        );
        expect(
          midShape.bottom,
          'the mid-drag box stays inside the bottom edge'
        ).toBeLessThanOrEqual(midDrag.viewport.height - 2);
        await page.mouse.up();
        await waitForChoreographySettle(page);
        const parked = await stripGeometry(page);
        const shape = parked.shape;
        if (shape === null) throw new Error('the parked pill lost its shape');
        // At rest, the box is completely inside: nothing sits offscreen.
        expect(shape.left).toBeGreaterThanOrEqual(4 - 2);
        expect(shape.top).toBeGreaterThanOrEqual(4 - 2);
        expect(shape.right).toBeLessThanOrEqual(parked.viewport.width - 2);
        expect(shape.bottom).toBeLessThanOrEqual(parked.viewport.height - 2);
        // The park refused the offscreen trip: the committed position is not
        // the corner the pressure asked for.
        expect(
          Math.abs(shape.left - (before.shape?.left ?? shape.left)) +
            Math.abs(shape.top - (before.shape?.top ?? shape.top)),
          'the drag actually moved the chrome (the park is a clamped position)'
        ).toBeGreaterThan(8);
        // Host coexistence (SB-D16): the page scrolled nowhere new, and the
        // drag introduced no scrollable overflow.
        expect(parked.scroll.x).toBe(before.scroll.x);
        expect(parked.scroll.y).toBe(before.scroll.y);
        expect(parked.scroll.extentWidth).toBe(before.scroll.extentWidth);
        expect(parked.scroll.extentHeight).toBe(before.scroll.extentHeight);
      } finally {
        await page.close();
        await clearWidgetOptIn(extension);
      }
    }
  );

  siteTest(
    'a viewport change re-settles the parked chrome inside (smoothly, instant under reduced motion)',
    async ({ extension }) => {
      await setWidgetEnabled(extension, true);
      const { page } = await openSitePage(extension, FDT_PAGE_URL);
      try {
        await expect.poll(async () => (await readStrip(page)).mounted, MOUNT_SETTLE).toBe(true);
        await expect
          .poll(async () => (await readStrip(page)).pillText, MOUNT_SETTLE)
          .toMatch(/✓ Cached|Not cached/);
        await waitForChoreographySettle(page);
        const pill = page.locator(`${STRIP_HOST} .ins-pill`);
        const pillBox = (await pill.boundingBox()) ?? null;
        if (pillBox === null) throw new Error('the pill is missing a box');
        // Park left of mid-page so a shrink to 640 Strands it near the edge.
        await pill.hover();
        await page.mouse.down();
        await page.mouse.move(pillBox.x - 500, pillBox.y - 300, { steps: 10 });
        await page.mouse.up();
        await waitForChoreographySettle(page);
        const parked = await stripGeometry(page);
        const shape = parked.shape;
        if (shape === null) throw new Error('the parked pill lost its shape');
        expect(shape.left, 'the drag landed inside the original viewport').toBeGreaterThan(0);

        // Shrink: the parked position can no longer fit — the re-settle
        // moves the chrome back inside, over the chrome's smooth position
        // leg (the motion-token transition the owner instructed).
        await page.setViewportSize({ width: 640, height: 480 });
        // The smooth leg: while the re-settle class is on, the chrome's
        // transition runs at the motion-token duration — observed live on
        // the real element within the movement window.
        await expect
          .poll(
            async () =>
              await page.evaluate((host: string) => {
                const chrome = document
                  .querySelector(host)
                  ?.shadowRoot?.querySelector('.ins-chrome');
                if (chrome === null || chrome === undefined) return false;
                return (
                  chrome.classList.contains('ins-resettle') &&
                  chrome
                    .getAnimations()
                    .some((a) => a instanceof CSSTransition && a.effect !== null)
                );
              }, STRIP_HOST),
            { timeout: 5_000, intervals: [30, 60, 100] }
          )
          .toBe(true);
        // Settled: fully inside the shrunken viewport.
        await expect
          .poll(
            async () => {
              const read = await page.evaluate((host: string) => {
                const root = document.querySelector(host)?.shadowRoot ?? null;
                const chrome = root?.querySelector<HTMLElement>('.ins-chrome') ?? null;
                const pillNow = root?.querySelector<HTMLElement>('.ins-pill') ?? null;
                if (chrome === null || pillNow === null) return null;
                const pillRect = pillNow.getBoundingClientRect();
                const resettle = chrome.classList.contains('ins-resettle');
                return {
                  left: pillRect.left,
                  top: pillRect.top,
                  right: pillRect.right,
                  bottom: pillRect.bottom,
                  viewportWidth: document.documentElement.clientWidth,
                  viewportHeight: document.documentElement.clientHeight,
                  resettle
                };
              }, STRIP_HOST);
              if (read === null) return false;
              if (read.resettle) return false; // still moving
              return (
                read.left >= 4 - 2 &&
                read.top >= 4 - 2 &&
                read.right <= read.viewportWidth - 2 &&
                read.bottom <= read.viewportHeight - 2
              );
            },
            { timeout: 5_000, intervals: [60, 120] }
          )
          .toBe(true);
        // Reduced motion: the re-settle is the shipped instant snap — any
        // transition the collapse still reports is sub-frame, and the box
        // lands inside.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await waitForChoreographySettle(page);
        await page.setViewportSize({ width: 520, height: 420 });
        await expect
          .poll(
            async () => {
              const read = await page.evaluate((host: string) => {
                const root = document.querySelector(host)?.shadowRoot ?? null;
                const chrome = root?.querySelector<HTMLElement>('.ins-chrome') ?? null;
                const pillNow = root?.querySelector<HTMLElement>('.ins-pill') ?? null;
                if (chrome === null || pillNow === null) return null;
                const pillRect = pillNow.getBoundingClientRect();
                return {
                  instResettle: chrome.classList.contains('ins-resettle'),
                  running: chrome
                    .getAnimations()
                    .filter((a) => a instanceof CSSTransition)
                    .some((a) => {
                      const timing = a.effect?.getComputedTiming().duration;
                      return typeof timing === 'number' && timing > 50;
                    }),
                  left: pillRect.left,
                  top: pillRect.top,
                  right: pillRect.right,
                  bottom: pillRect.bottom,
                  viewportWidth: document.documentElement.clientWidth,
                  viewportHeight: document.documentElement.clientHeight
                };
              }, STRIP_HOST);
              if (read === null) return false;
              if (read.instResettle) return false; // mid-snap read
              return (
                !read.running &&
                read.left >= 4 - 2 &&
                read.top >= 4 - 2 &&
                read.right <= read.viewportWidth - 2 &&
                read.bottom <= read.viewportHeight - 2
              );
            },
            { timeout: 5_000, intervals: [60, 120] }
          )
          .toBe(true);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
      } finally {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.close();
        await clearWidgetOptIn(extension);
      }
    }
  );

  siteTest(
    'opening the card beyond an edge re-settles the chrome back inside',
    async ({ extension }) => {
      await setWidgetEnabled(extension, true);
      const { page } = await openSitePage(extension, FDT_PAGE_URL);
      try {
        await expect.poll(async () => (await readStrip(page)).mounted, MOUNT_SETTLE).toBe(true);
        await expect
          .poll(async () => (await readStrip(page)).pillText, MOUNT_SETTLE)
          .toMatch(/✓ Cached|Not cached/);
        await waitForChoreographySettle(page);
        const pill = page.locator(`${STRIP_HOST} .ins-pill`);
        const pillBox = (await pill.boundingBox()) ?? null;
        if (pillBox === null) throw new Error('the pill is missing a box');
        // Park near the TOP edge: the open card grows upward from the
        // pill's anchored corner, so its box would breach the top edge —
        // the re-settle holds the whole chrome inside.
        await pill.hover();
        await page.mouse.down();
        await page.mouse.move(pillBox.x - 60, 6, { steps: 10 });
        await page.mouse.up();
        await waitForChoreographySettle(page);
        const parked = await stripGeometry(page);
        const shape = parked.shape;
        if (shape === null) throw new Error('the parked pill lost its shape');
        // The parked pill: the drag's vertical demand crossed the top edge,
        // so the clamp pinned the box's top at the containment margin —
        // measured as the exact band (2 px tolerance = the leg's rounding).
        expect(
          Math.abs(shape.top - DRAG_CONTAINMENT_MARGIN),
          'the pill parks pinned at the top containment margin'
        ).toBeLessThanOrEqual(2);

        await pill.click();
        await expect(page.locator(`${STRIP_HOST} .ins-card`)).toBeVisible();
        await waitForChoreographySettle(page);
        const opened = await stripGeometry(page);
        const card = opened.shape;
        if (card === null) throw new Error('the open card lost its shape');
        // The card is a bigger box anchored at the pill's corner: its top
        // demand (corner − card height) sits far past the top edge, so the
        // re-settle pinS the card's top at the margin — measured exactly.
        expect(
          Math.abs(card.top - DRAG_CONTAINMENT_MARGIN),
          'the card re-settled with its top pinned at the containment margin'
        ).toBeLessThanOrEqual(2);
        // The unmoved edges stay fully inside (bands, per the shrink leg).
        expect(card.left).toBeGreaterThanOrEqual(DRAG_CONTAINMENT_MARGIN - 2);
        expect(card.right).toBeLessThanOrEqual(opened.viewport.width - DRAG_CONTAINMENT_MARGIN + 2);
        // The relocation is real: the card's bottom landed far below the
        // parked pill's corner (the chrome moved DOWN to let the card fit).
        expect(
          card.top + card.height - shape.bottom,
          'the re-settle moved the chrome down by the card\u2019s grown extent'
        ).toBeGreaterThan(100);
        expect((await readStrip(page)).cardOpen, 'the card stayed open through the re-settle').toBe(
          true
        );
        // Escape closes: the pill returns at the card's own re-settled corner
        // (the anchor rides the chrome) — measured corner-for-corner.
        await page.keyboard.press('Escape');
        await waitForChoreographySettle(page);
        const closed = await stripGeometry(page);
        const returned = closed.shape;
        if (returned === null) throw new Error('the returned pill lost its shape');
        expect(
          Math.abs(returned.right - card.right),
          'the returned pill took the card\u2019s re-settled right corner'
        ).toBeLessThanOrEqual(2);
        expect(
          Math.abs(returned.bottom - card.bottom),
          'the returned pill took the card\u2019s re-settled bottom corner'
        ).toBeLessThanOrEqual(2);
        expect(returned.left).toBeGreaterThanOrEqual(DRAG_CONTAINMENT_MARGIN - 2);
        expect(returned.top).toBeGreaterThanOrEqual(DRAG_CONTAINMENT_MARGIN - 2);
        expect(returned.right).toBeLessThanOrEqual(
          closed.viewport.width - DRAG_CONTAINMENT_MARGIN + 2
        );
        expect(returned.bottom).toBeLessThanOrEqual(
          closed.viewport.height - DRAG_CONTAINMENT_MARGIN + 2
        );
      } finally {
        await page.close();
        await clearWidgetOptIn(extension);
      }
    }
  );

  siteTest(
    'a versionless detection renders the honest unknown-version identity everywhere',
    async ({ extension }) => {
      await setWidgetEnabled(extension, true);
      const { page } = await openSitePage(extension, `${FDT_PAGE_URL}?fdt-wpr-versionless=1`);
      try {
        // The versionless copy's verdict: present + cached with NO version —
        // the pill's identity is the pinned unknown-version form, never a
        // fabricated number.
        await expect
          .poll(async () => (await readStrip(page)).pillText, MOUNT_SETTLE)
          .toMatch(/^WP Rocket page analysis: WPR \(unknown version\)✓ Cached/s);
        const pillText = (await readStrip(page)).pillText ?? '';
        expect(pillText, 'the pill never renders a version digit').not.toMatch(/WPR \d/);
        await page.locator(`${STRIP_HOST} .ins-pill`).click();
        await expect(page.locator(`${STRIP_HOST} .ins-card`)).toBeVisible();
        const read = await readStrip(page);
        expect(read.cardOpen, 'the card is open').toBe(true);
        expect(read.title, 'the card carries the same honest identity').toBe(
          'WPR (unknown version)'
        );
        expect(read.cacheText, 'the cached verdict rides the versionless state').toMatch(
          /✓ Cached · [0-9-]{10} [0-9:]{8} UTC/
        );
        expect(read.footer, 'the footer dashes the unknown version slot').toMatch(
          /^WPR — · WP [\w.-]+ · FDT [\w.-]+$/
        );
      } finally {
        await page.close();
        await clearWidgetOptIn(extension);
      }
    }
  );

  siteTest(
    'Escape mid-drag cancels it and restores the pre-drag position',
    async ({ extension }) => {
      await setWidgetEnabled(extension, true);
      const { page } = await openSitePage(extension, FDT_PAGE_URL);
      try {
        await expect.poll(async () => (await readStrip(page)).mounted, MOUNT_SETTLE).toBe(true);
        await expect
          .poll(async () => (await readStrip(page)).pillText, MOUNT_SETTLE)
          .toMatch(/✓ Cached|Not cached/);
        await waitForChoreographySettle(page);
        // Commit one drag first so the cancel has a real session position to
        // restore (not the untouched resting anchor).
        const pill = page.locator(`${STRIP_HOST} .ins-pill`);
        const pillBox = (await pill.boundingBox()) ?? null;
        if (pillBox === null) throw new Error('the pill is missing a box');
        await pill.hover();
        await page.mouse.down();
        await page.mouse.move(pillBox.x - 200, pillBox.y - 120, { steps: 10 });
        await page.mouse.up();
        await waitForChoreographySettle(page);
        const settled = await stripGeometry(page);
        const atRest = settled.shape;
        if (atRest === null) throw new Error('the settled pill lost its shape');

        // Second drag: Escape mid-press cancels (P12A.5's recorded semantics),
        // the release stays a click and is suppressed — the card never opens.
        await pill.hover();
        await page.mouse.down();
        await page.mouse.move(atRest.left - 140, atRest.top - 90, { steps: 10 });
        // The keydown path rides the widget's shadow root: focus goes to the
        // pill explicitly (a macOS Chromium mousedown leaves the body focused,
        // and the page must not be the Escape's audience).
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
        await page.keyboard.press('Escape');
        await page.mouse.up();
        await waitForChoreographySettle(page);
        const restored = await stripGeometry(page);
        const backShape = restored.shape;
        if (backShape === null) throw new Error('the restored pill lost its shape');
        expect(
          Math.abs(backShape.left - atRest.left),
          'the cancel restored the pre-drag left position'
        ).toBeLessThan(2);
        expect(
          Math.abs(backShape.top - atRest.top),
          'the cancel restored the pre-drag top position'
        ).toBeLessThan(2);
        expect((await readStrip(page)).cardOpen).toBe(false);

        // Third drag: a RIGHT press mid-drag cancels the same way (the brief's
        // source-parity nicety; cancel beats the primary-button guard).
        await pill.hover();
        await page.mouse.down();
        await page.mouse.move(backShape.left - 120, backShape.top - 70, { steps: 8 });
        await page.mouse.down({ button: 'right' });
        await page.mouse.up(); // the left release after the cancel is a no-op
        await page.mouse.up({ button: 'right' });
        await waitForChoreographySettle(page);
        const restored2 = await stripGeometry(page);
        const rightShape = restored2.shape;
        if (rightShape === null) throw new Error('the right-cancelled pill lost its shape');
        expect(
          Math.abs(rightShape.left - backShape.left),
          'the right-press cancel restored the pre-drag left position'
        ).toBeLessThan(2);
        expect(Math.abs(rightShape.top - backShape.top)).toBeLessThan(2);
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
        try {
          await expect
            .poll(
              async () =>
                await adminPage.evaluate(
                  (): boolean => document.querySelector('wpr-fdt-inspector') !== null
                ),
              { timeout: 10_000, intervals: [250, 500] }
            )
            .toBe(true);
        } catch (mountFailure: unknown) {
          // The mount ladder's known root (a doc_start boot racing the body
          // anchor) is fixed in the widget's boot sequence, so a failure here
          // is unexpected: report the one truth readable without touching the
          // host page — the stored gate state — with the timeout as the cause.
          throw new Error(
            `strip mount failed; gate state ${JSON.stringify(
              await extension.evaluateInWorker(async (key: string) => {
                const stored = (await chrome.storage.sync.get([key]))[key];
                return stored ?? null;
              }, 'inspector-origins')
            )}`,
            { cause: mountFailure }
          );
        }
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

  /**
   * The drag legs (P12A.5): session-local repositioning, SB-D12's semantics
   * minus persistence. Every drag goes through Playwright's real input
   * (trusted events — the synthetic-click gate must not block them), and
   * every leg cleans up its own opt-in write so the later suites see the
   * inert store.
   */
});
