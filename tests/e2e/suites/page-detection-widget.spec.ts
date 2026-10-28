/**
 * The on-page detection widget's state and presentation over the two local
 * fixture origins (`localhost` and `127.0.0.1` share one port but are
 * distinct origins — each is its own per-origin key), no docker site needed:
 *
 * - **Visibility resolution, live:** an unconfigured origin follows the
 *   options row "Show the detection widget on pages by default" (Saved
 *   through the real options page, applied to open pages without a reload);
 *   an explicit per-origin entry wins over that default in both directions
 *   under both defaults and outlives a default change; the other origin
 *   never moves with it.
 * - **The per-site toggle:** the shipped toggle helper the context-menu row
 *   dispatches (`toggleDetectionWidgetSite`), driven through the command
 *   palette's row — the native right-click itself is not Playwright-reachable
 *   (the tier README's manual remainder). It flips the origin's effective
 *   state live in every open tab of that origin, survives a reload, and
 *   never touches the other origin.
 * - **Appearance:** Options tile writes (System/Dark/Light) and emulated OS
 *   `prefers-color-scheme` flips restyle the open pill and card live.
 * - **Reduced motion (D-2):** every shadow duration is collapsed to a frame
 *   (closed and open) and each motion open/close starts is a collapsed
 *   one-shot, read at its start event; a no-preference control proves the
 *   recorder sees the real transition.
 * - **Zero markers:** a page with no WP Rocket footprint renders the honest
 *   absence (identity, cache chip, mood, tooltips, footer) and claims no
 *   verdict it does not have.
 * - **Widths (D-1):** 320 / 480 / 768 / 1280 px — the open card and the pill
 *   stay inside, nothing scrolls horizontally.
 *
 * Every leg restores the options item and the override map it wrote.
 */
import type { Page } from '@playwright/test';

import {
  expect,
  openFixturePage,
  ORIGIN_A,
  test,
  type ExtensionDriver
} from '../helpers/extension';
import {
  choiceTile,
  expectRealmAlive,
  openOptionsPage,
  rowSwitchInput,
  rowSwitchTrack,
  saveOptions,
  stampRealm,
  type ChoiceValue
} from '../helpers/options';

/** The widget's shadow-root host. */
const WIDGET_HOST = 'wpr-fdt-inspector';
/** The per-origin override map (sync area). */
const SITES_KEY = 'detection-widget-sites';
/** The device-local drag positions (local area). */
const POSITIONS_KEY = 'detection-widget-positions';
/** The options row id of the global default. */
const DEFAULT_ROW_ID = 'detectionWidget';
/** The second local origin: same server and port, a distinct origin. */
const ORIGIN_B = ORIGIN_A.replace('//localhost:', '//127.0.0.1:');
/** A page with no WP Rocket footprint at all. */
const PLAIN_PAGE = '/pipeline/plain.html';
/** The palette fixture (its rows are the shipped page commands). */
const PALETTE_PAGE = '/palette/hotkeys.html';
/** Mount / unmount settle: a storage watch round trip plus the page pass. */
const SETTLE = { timeout: 15_000, intervals: [100, 250, 500] };
/** The pill/card surface (`--surface-2`) under each palette. */
const SURFACE_2 = { dark: 'rgb(23, 27, 33)', light: 'rgb(255, 255, 255)' } as const;
/** The page-global log {@link recordWidgetHost} fills. */
const HOST_LOG = '__wprFdtWidgetHostLog';
/** The page-global log {@link recordMotion} fills. */
const MOTION_LOG = '__wprFdtMotionLog';
/**
 * How long a page is watched for a late widget move once its decision is
 * due. The widget exposes no "decided" marker: its decision is two storage
 * reads (or one storage change event, already seen by a sibling tab of the
 * same write) plus the body wait and the shadow-host creation — milliseconds.
 * The window starts only after a positive signal (the pass answered, or a
 * sibling tab reacted to the same write), and the host recorder catches even
 * a transient mount inside it.
 */
const QUIET_WINDOW_MS = 1_500;
/** A collapsed (reduced-motion) duration ceiling, in ms (`tokens.css`: 0.01ms). */
const COLLAPSED_MS = 0.01;

/** Remove the override map, the stored positions and the options item. */
async function resetWidgetState(driver: ExtensionDriver): Promise<void> {
  await driver.evaluateInWorker(
    async (keys: { sites: string; positions: string }) => {
      await chrome.storage.sync.remove([keys.sites, 'options']);
      await chrome.storage.local.remove([keys.positions]);
    },
    { sites: SITES_KEY, positions: POSITIONS_KEY }
  );
}

/**
 * Write one origin's explicit entry (the shape the toggle writes), or remove
 * it with `null`, keeping the other origins' entries.
 */
async function setSiteEntry(
  driver: ExtensionDriver,
  origin: string,
  enabled: boolean | null
): Promise<void> {
  await driver.evaluateInWorker(
    async (payload: { key: string; origin: string; enabled: boolean | null }) => {
      const current = (await chrome.storage.sync.get([payload.key]))[payload.key] as
        Record<string, unknown> | undefined;
      const map = Object.fromEntries(
        Object.entries(current ?? {}).filter(([origin]) => origin !== payload.origin)
      );
      if (payload.enabled !== null) map[payload.origin] = { enabled: payload.enabled };
      await chrome.storage.sync.set({ [payload.key]: map });
    },
    { key: SITES_KEY, origin, enabled }
  );
}

/** One origin's stored `enabled` (null when the origin has no entry). */
async function storedEnabled(driver: ExtensionDriver, origin: string): Promise<boolean | null> {
  return await driver.evaluateInWorker(
    async (payload: { key: string; origin: string }) => {
      const map = (await chrome.storage.sync.get([payload.key]))[payload.key] as
        Record<string, { enabled?: unknown }> | undefined;
      const entry = map?.[payload.origin];
      return typeof entry?.enabled === 'boolean' ? entry.enabled : null;
    },
    { key: SITES_KEY, origin }
  );
}

/**
 * Save the global default through the real options page (switch + Save),
 * the way a user changes it.
 */
async function saveDefault(driver: ExtensionDriver, on: boolean): Promise<void> {
  const options = await openOptionsPage(driver);
  try {
    const input = rowSwitchInput(options, DEFAULT_ROW_ID);
    if ((await input.isChecked()) !== on) await rowSwitchTrack(options, DEFAULT_ROW_ID).click();
    if (on) await expect(input).toBeChecked();
    else await expect(input).not.toBeChecked();
    await saveOptions(options);
  } finally {
    await options.close();
  }
}

/** Expect the widget mounted (`true`) or absent (`false`) on a page. */
async function expectWidget(page: Page, mounted: boolean, why: string): Promise<void> {
  await expect(page.locator(WIDGET_HOST), why).toHaveCount(mounted ? 1 : 0, SETTLE);
}

/**
 * Run the palette's "Toggle the detection widget on this site" row on a
 * page (the menu row's shipped writer, opened the way the menu sends it).
 */
async function togglePerSite(driver: ExtensionDriver, page: Page, tabId: number): Promise<void> {
  expect(await driver.sendToTab<boolean>(tabId, 'openCommandPalette')).toBe(true);
  const field = page.locator('wpr-fdt-command-palette [data-fdt="palette-input"]');
  await expect(field).toBeFocused(SETTLE);
  await page.keyboard.type('detection widget');
  await expect(page.locator('wpr-fdt-command-palette [data-fdt="palette-command"]')).toHaveText([
    'Toggle the detection widget on this site'
  ]);
  await page.keyboard.press('Enter');
}

/** The pill's and the card's computed surface colors. */
async function widgetSurfaces(page: Page): Promise<{ pill: string; card: string }> {
  return await page.evaluate((host: string) => {
    const root = document.querySelector(host)?.shadowRoot;
    const pill = root?.querySelector('.ins-pill');
    const card = root?.querySelector('.ins-card');
    if (pill === null || pill === undefined || card === null || card === undefined) {
      throw new Error('the widget pill or card is missing');
    }
    return {
      pill: getComputedStyle(pill).backgroundColor,
      card: getComputedStyle(card).backgroundColor
    };
  }, WIDGET_HOST);
}

/** Wait for the widget's pass answer (the pill's cache chip leaves "…"). */
async function settleVerdict(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        await page.evaluate(
          (host: string) =>
            document.querySelector(host)?.shadowRoot?.querySelector('.ins-pill .ins-cache-text')
              ?.textContent ?? null,
          WIDGET_HOST
        ),
      SETTLE
    )
    .not.toMatch(/^(…)?$/);
}

/**
 * Record every widget host entering (`+`) or leaving (`-`) the page from now
 * on — run as an init script it watches from document start, so a transient
 * mount is caught too. Re-running it in a live realm empties the log instead
 * of stacking a second observer. Runs in the page; self-contained.
 */
function recordWidgetHost(args: { host: string; key: string }): void {
  const scope = window as unknown as Record<string, unknown>;
  const existing = scope[args.key];
  if (Array.isArray(existing)) {
    existing.length = 0;
    return;
  }
  const entries: string[] = [];
  Object.defineProperty(window, args.key, { value: entries, configurable: true });
  const note = (node: Node, sign: string): void => {
    if (!(node instanceof Element)) return;
    for (const element of [node, ...node.querySelectorAll(args.host)]) {
      if (element.localName === args.host) entries.push(`${sign}${args.host}`);
    }
  };
  new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        note(node, '+');
      });
      record.removedNodes.forEach((node) => {
        note(node, '-');
      });
    }
  }).observe(document, { childList: true, subtree: true });
}

/** Start (or restart) the host recorder in a page's live realm. */
async function watchWidgetHost(page: Page): Promise<void> {
  await page.evaluate(recordWidgetHost, { host: WIDGET_HOST, key: HOST_LOG });
}

/** Arm the host recorder for the page's next loads (from document start). */
async function watchWidgetHostFromBoot(page: Page): Promise<void> {
  await page.addInitScript(recordWidgetHost, { host: WIDGET_HOST, key: HOST_LOG });
}

/**
 * Hold the quiet window, then expect the recorder saw no widget host enter
 * or leave — a late or transient move inside the window fails.
 *
 * @throws {@link Error} When no recorder runs on the page (a suite bug).
 */
async function expectHostQuiet(page: Page, why: string): Promise<void> {
  await page.waitForTimeout(QUIET_WINDOW_MS);
  const log = await page.evaluate((key: string) => {
    const entries = (window as unknown as Record<string, unknown>)[key];
    if (!Array.isArray(entries)) throw new Error('no widget host recorder on this page');
    return entries.map(String);
  }, HOST_LOG);
  expect(log, why).toEqual([]);
}

/**
 * Record the timing of every animation or transition that starts in the
 * widget's shadow tree from now on, read at its start event (the animation
 * is still running then, whatever its length). Re-running it on the same
 * root empties the log. Runs in the page; self-contained.
 *
 * @throws {@link Error} When the widget is not mounted.
 */
function recordMotion(args: { host: string; key: string }): void {
  const root = document.querySelector(args.host)?.shadowRoot;
  if (root === null || root === undefined) throw new Error('the widget is missing');
  const scope = window as unknown as Record<string, unknown>;
  const existing = scope[args.key] as { root: ShadowRoot; entries: unknown[] } | undefined;
  if (existing?.root === root) {
    existing.entries.length = 0;
    return;
  }
  const entries: { event: string; duration: number; iterations: number }[] = [];
  Object.defineProperty(window, args.key, { value: { root, entries }, configurable: true });
  const note = (event: Event): void => {
    if (!(event.target instanceof Element)) return;
    for (const animation of event.target.getAnimations()) {
      const timing = animation.effect?.getComputedTiming();
      entries.push({
        event: event.type,
        duration: typeof timing?.duration === 'number' ? timing.duration : Number.NaN,
        iterations: timing?.iterations ?? Number.NaN
      });
    }
  };
  root.addEventListener('transitionrun', note);
  root.addEventListener('animationstart', note);
}

/** Start (or restart) the motion recorder on the mounted widget. */
async function watchMotion(page: Page): Promise<void> {
  await page.evaluate(recordMotion, { host: WIDGET_HOST, key: MOTION_LOG });
}

/**
 * The motion the recorder saw, after three rendered frames: a style change
 * creates its transitions on the next frame and their start events dispatch
 * on the one after.
 */
async function recordedMotion(
  page: Page
): Promise<{ event: string; duration: number; iterations: number }[]> {
  return await page.evaluate(async (key: string) => {
    for (let frame = 0; frame < 3; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const log = (window as unknown as Record<string, unknown>)[key] as
      { entries: { event: string; duration: number; iterations: number }[] } | undefined;
    if (log === undefined) throw new Error('no motion recorder on this page');
    return [...log.entries];
  }, MOTION_LOG);
}

/** Expect every recorded motion collapsed to a frame and none looping. */
function expectCollapsedMotion(
  motion: readonly { event: string; duration: number; iterations: number }[],
  label: string
): void {
  for (const entry of motion) {
    expect(entry.duration, `${label}: ${entry.event} collapses to a frame`).toBeLessThanOrEqual(
      COLLAPSED_MS
    );
    expect(Number.isFinite(entry.iterations), `${label}: ${entry.event} never loops`).toBe(true);
  }
}

/**
 * Sweep every shadow node's computed animation/transition timing: no
 * infinite iteration, every duration collapsed to the token override's frame.
 */
async function expectCollapsedTimings(page: Page, label: string): Promise<void> {
  const timings = await page.evaluate((host: string) => {
    const root = document.querySelector(host)?.shadowRoot;
    if (root === null || root === undefined) throw new Error('the widget is missing');
    return [...root.querySelectorAll('*')].map((node) => {
      const style = getComputedStyle(node);
      return {
        iterations: style.animationIterationCount,
        durations: [
          ...style.animationDuration.split(','),
          ...style.transitionDuration.split(',')
        ].map((value) => Number.parseFloat(value))
      };
    });
  }, WIDGET_HOST);
  for (const timing of timings) {
    expect(timing.iterations, `${label}: no infinite animation`).not.toContain('infinite');
    for (const seconds of timing.durations) {
      expect(seconds, `${label}: motion collapses to a frame`).toBeLessThanOrEqual(
        COLLAPSED_MS / 1000
      );
    }
  }
}

/** Wait until no animation runs in the widget's shadow root. */
async function settleAnimations(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        await page.evaluate(
          (host: string) => document.querySelector(host)?.shadowRoot?.getAnimations().length ?? -1,
          WIDGET_HOST
        ),
      SETTLE
    )
    .toBe(0);
}

test.describe('on-page detection widget (fixture origins)', () => {
  test.beforeEach(async ({ extension }) => {
    await resetWidgetState(extension);
  });

  test.afterAll(async ({ extension }) => {
    await resetWidgetState(extension);
  });

  test('unconfigured origins follow the saved default live on both origins, with no reload', async ({
    extension
  }) => {
    const a = await openFixturePage(extension, PLAIN_PAGE);
    const b = await openFixturePage(extension, PLAIN_PAGE, ORIGIN_B);
    try {
      // Fresh install: no entry, no options item — default on everywhere.
      await expectWidget(a.page, true, 'default on (localhost)');
      await expectWidget(b.page, true, 'default on (127.0.0.1)');
      await stampRealm(a.page);
      await stampRealm(b.page);

      await saveDefault(extension, false);
      await expectWidget(a.page, false, 'Saved off hides the open page (localhost)');
      await expectWidget(b.page, false, 'Saved off hides the open page (127.0.0.1)');
      expect(await storedEnabled(extension, ORIGIN_A), 'the default writes no entry').toBeNull();
      expect(await storedEnabled(extension, ORIGIN_B), 'the default writes no entry').toBeNull();

      await saveDefault(extension, true);
      await expectWidget(a.page, true, 'Saved on mounts again (localhost)');
      await expectWidget(b.page, true, 'Saved on mounts again (127.0.0.1)');
      await expectRealmAlive(a.page);
      await expectRealmAlive(b.page);

      // A fresh load under default off stays hidden from the boot on.
      await saveDefault(extension, false);
      await expectWidget(a.page, false, 'Saved off hides the open page again');
      await watchWidgetHostFromBoot(a.page);
      await a.page.reload({ waitUntil: 'load' });
      // The pass has answered (the isolated world is alive); past the quiet
      // window the host never entered, not even briefly.
      await expect
        .poll(async () => await extension.sendToTab<unknown>(a.tabId, 'getWprDetections'), SETTLE)
        .not.toBeNull();
      await expectHostQuiet(a.page, 'a reload under default off mounts nothing');
      await expectWidget(a.page, false, 'a reload under default off mounts nothing');
      // Positive control: the reloaded module was alive and deciding.
      await saveDefault(extension, true);
      await expectWidget(a.page, true, 'Saved on mounts the reloaded page live');
    } finally {
      await a.page.close();
      await b.page.close();
    }
  });

  test('a per-origin entry wins over the default both ways, under both defaults; the other origin never moves', async ({
    extension
  }) => {
    const a = await openFixturePage(extension, PLAIN_PAGE);
    const b = await openFixturePage(extension, PLAIN_PAGE, ORIGIN_B);
    try {
      await expectWidget(a.page, true, 'default on');
      await expectWidget(b.page, true, 'default on');
      await stampRealm(a.page);
      await stampRealm(b.page);

      // Default ON: entry off hides only its origin; entry on keeps it shown.
      await setSiteEntry(extension, ORIGIN_A, false);
      await expectWidget(a.page, false, 'default on + entry off → hidden');
      await expectWidget(b.page, true, 'the unconfigured origin keeps the default');
      await setSiteEntry(extension, ORIGIN_A, true);
      await expectWidget(a.page, true, 'default on + entry on → shown');

      // Default OFF: the explicit entry outlives the default change.
      await saveDefault(extension, false);
      await expectWidget(b.page, false, 'the unconfigured origin follows default off');
      await expectWidget(a.page, true, 'default off + entry on → still shown');
      await setSiteEntry(extension, ORIGIN_A, false);
      await expectWidget(a.page, false, 'default off + entry off → hidden');
      await setSiteEntry(extension, ORIGIN_B, true);
      await expectWidget(b.page, true, 'default off + entry on → shown');
      await expectWidget(a.page, false, 'the other origin stays as its own entry says');

      // Removing the entries hands both origins back to the default.
      await setSiteEntry(extension, ORIGIN_A, null);
      await setSiteEntry(extension, ORIGIN_B, null);
      await expectWidget(b.page, false, 'no entry → default off');
      await saveDefault(extension, true);
      await expectWidget(a.page, true, 'no entry → default on');
      await expectWidget(b.page, true, 'no entry → default on');
      await expectRealmAlive(a.page);
      await expectRealmAlive(b.page);
    } finally {
      await a.page.close();
      await b.page.close();
    }
  });

  test('the per-site toggle flips the effective state in every tab of its origin under both defaults (an unconfigured origin included), survives a reload, and leaves the other origin alone', async ({
    extension
  }) => {
    const a = await openFixturePage(extension, PALETTE_PAGE);
    const aTwin = await openFixturePage(extension, PLAIN_PAGE);
    const b = await openFixturePage(extension, PLAIN_PAGE, ORIGIN_B);
    const bPalette = await openFixturePage(extension, PALETTE_PAGE, ORIGIN_B);
    /** B's stored entry after a step (null until B itself is toggled). */
    const expectBEntry = async (enabled: boolean | null, why: string): Promise<void> => {
      expect(await storedEnabled(extension, ORIGIN_B), why).toBe(enabled);
    };
    try {
      await expectWidget(a.page, true, 'default on');
      await expectWidget(b.page, true, 'default on');
      await expectWidget(bPalette.page, true, 'default on');
      for (const page of [a.page, b.page, bPalette.page]) await stampRealm(page);
      await watchWidgetHost(b.page);

      // Default ON, unconfigured: the toggle writes `off` (the effective flip).
      await togglePerSite(extension, a.page, a.tabId);
      await expectWidget(a.page, false, 'the toggle hides it live');
      await expectWidget(aTwin.page, false, 'every tab of the origin follows');
      // A's tabs reacted to the write: B's (same broadcast) stayed quiet.
      await expectHostQuiet(b.page, 'the other origin is untouched');
      await expectWidget(b.page, true, 'the other origin is untouched');
      expect(await storedEnabled(extension, ORIGIN_A)).toBe(false);
      await expectBEntry(null, 'no entry for the other origin');
      await watchWidgetHostFromBoot(aTwin.page);
      await aTwin.page.reload({ waitUntil: 'load' });
      await expect
        .poll(
          async () => await extension.sendToTab<unknown>(aTwin.tabId, 'getWprDetections'),
          SETTLE
        )
        .not.toBeNull();
      await expectHostQuiet(aTwin.page, 'the choice survives a reload');
      await expectWidget(aTwin.page, false, 'the choice survives a reload');

      // Positive control for the reloaded tab: it follows the next write live.
      await togglePerSite(extension, a.page, a.tabId);
      await expectWidget(a.page, true, 'toggled back on, live');
      await expectWidget(aTwin.page, true, 'the reloaded tab follows live too');
      expect(await storedEnabled(extension, ORIGIN_A)).toBe(true);
      await expectBEntry(null, 'still no entry for the other origin');

      // Default OFF, unconfigured origin B is hidden; A's explicit on stays.
      await saveDefault(extension, false);
      await expectWidget(b.page, false, 'B follows default off');
      await expectWidget(bPalette.page, false, 'B follows default off (every tab)');
      await expectWidget(a.page, true, 'A keeps its explicit entry');
      await expectBEntry(null, 'the default writes no entry');
      // A toggle under default off from an explicit on writes off…
      await togglePerSite(extension, a.page, a.tabId);
      await expectWidget(a.page, false, 'default off: the toggle hides');
      expect(await storedEnabled(extension, ORIGIN_A)).toBe(false);
      await expectBEntry(null, 'A’s toggle writes nothing for B');
      // …and from there back on — mounted although the default is off.
      await togglePerSite(extension, a.page, a.tabId);
      await expectWidget(a.page, true, 'default off: the toggle shows');
      expect(await storedEnabled(extension, ORIGIN_A)).toBe(true);
      await expectBEntry(null, 'A’s toggle writes nothing for B');
      for (const page of [a.page, b.page, bPalette.page]) await expectRealmAlive(page);
      await watchWidgetHost(b.page);
      await a.page.reload({ waitUntil: 'load' });
      await expectWidget(a.page, true, 'the shown choice survives a reload under default off');
      await expectHostQuiet(b.page, 'B never moved');
      await expectWidget(b.page, false, 'B never moved');

      // Default OFF, unconfigured B: its toggle reads the saved `off` default
      // and writes `on` — B mounts live in every tab; A never moves.
      await watchWidgetHost(a.page);
      await togglePerSite(extension, bPalette.page, bPalette.tabId);
      await expectWidget(bPalette.page, true, 'default off + unconfigured: the toggle shows');
      await expectWidget(b.page, true, 'every tab of B follows');
      await expectBEntry(true, 'the first toggle under default off writes on');
      await expectHostQuiet(a.page, 'A never moved');
      expect(await storedEnabled(extension, ORIGIN_A), 'A’s entry unchanged').toBe(true);
      await expectRealmAlive(b.page);
      await expectRealmAlive(bPalette.page);
    } finally {
      await a.page.close();
      await aTwin.page.close();
      await b.page.close();
      await bPalette.page.close();
    }
  });

  test('Options writes and OS scheme flips restyle the open pill and card live', async ({
    extension
  }) => {
    const { page } = await openFixturePage(extension, PLAIN_PAGE);
    const options = await openOptionsPage(extension);
    /** Pick an appearance tile (persists instantly). */
    const choose = async (value: ChoiceValue): Promise<void> => {
      await choiceTile(options, value).click();
      await expect(options.getByRole('radio', { checked: true })).toHaveCount(1);
    };
    /** Expect both surfaces in one palette. */
    const expectPalette = async (palette: 'dark' | 'light', why: string): Promise<void> => {
      await expect
        .poll(async () => await widgetSurfaces(page), { ...SETTLE, message: why })
        .toEqual({ pill: SURFACE_2[palette], card: SURFACE_2[palette] });
    };
    try {
      await page.emulateMedia({ colorScheme: 'dark' });
      await expectWidget(page, true, 'default on');
      await settleVerdict(page);
      await page.locator(`${WIDGET_HOST} .ins-pill`).click();
      await expect(page.locator(`${WIDGET_HOST} .ins-card`)).toBeVisible();
      await stampRealm(page);

      // System (no stored choice) follows the OS, both ways.
      await expectPalette('dark', 'System + OS dark');
      await page.emulateMedia({ colorScheme: 'light' });
      await expectPalette('light', 'System + OS light');

      // An explicit choice wins over every OS flip.
      await choose('dark');
      await expectPalette('dark', 'Dark written live');
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.emulateMedia({ colorScheme: 'light' });
      await expectPalette('dark', 'Dark beats OS light');
      await choose('light');
      await expectPalette('light', 'Light written live');
      await page.emulateMedia({ colorScheme: 'dark' });
      await expectPalette('light', 'Light beats OS dark');

      // Back to System: the OS decides again.
      await choose('system');
      await expectPalette('dark', 'System written live follows OS dark');
      await page.emulateMedia({ colorScheme: 'light' });
      await expectPalette('light', 'System follows the next OS flip');
      await expect(page.locator(`${WIDGET_HOST} .ins-card`), 'the card stayed open').toBeVisible();
      await expectRealmAlive(page);
    } finally {
      await options.close();
      await page.close();
    }
  });

  test('reduced motion: every shadow duration collapses to a frame (closed and open) and every motion started by open/close is a collapsed one-shot; a no-preference control proves the recorder sees real motion', async ({
    extension
  }) => {
    const page = await extension.browserContext.newPage();
    const pill = page.locator(`${WIDGET_HOST} .ins-pill`);
    const card = page.locator(`${WIDGET_HOST} .ins-card`);
    try {
      // Emulated before the navigation: the mount's entrance sees it.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`${ORIGIN_A}${PLAIN_PAGE}`, { waitUntil: 'load' });
      await expectWidget(page, true, 'default on');
      await settleVerdict(page);
      await settleAnimations(page);

      // No infinite loop survives (the pending pulse included) and every
      // duration is collapsed to the token override's frame — closed, then open.
      await expectCollapsedTimings(page, 'closed');

      // Each motion open/close starts is read at its own start event.
      await watchMotion(page);
      await pill.click();
      await expect(card).toBeVisible();
      expectCollapsedMotion(await recordedMotion(page), 'open');
      await expectCollapsedTimings(page, 'open');
      await watchMotion(page);
      await page.keyboard.press('Escape');
      await expect(card).toBeHidden();
      expectCollapsedMotion(await recordedMotion(page), 'close');

      // Control: the same recorder and read, with motion allowed, sees the
      // card's real open transition — the checks above can fail.
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await watchMotion(page);
      await pill.click();
      await expect(card).toBeVisible();
      const control = await recordedMotion(page);
      expect(
        control.some((entry) => entry.duration > COLLAPSED_MS),
        'with motion allowed, opening starts a real-length transition'
      ).toBe(true);
    } finally {
      await page.close();
    }
  });

  test('a page with no WP Rocket footprint renders the honest absence, tooltips included', async ({
    extension
  }) => {
    const { page, tabId } = await openFixturePage(extension, PLAIN_PAGE);
    try {
      await expectWidget(page, true, 'default on');
      await settleVerdict(page);
      const detections = await extension.sendToTab<{ wpr: { present: boolean } } | null>(
        tabId,
        'getWprDetections'
      );
      expect(detections?.wpr.present, 'the pass found no WP Rocket').toBe(false);

      const pill = page.locator(`${WIDGET_HOST} .ins-pill`);
      await expect(pill).toHaveText('WP Rocket page analysis: WPR not found—');
      await expect(pill).toHaveAttribute(
        'title',
        'WPR not found — WP Rocket did not handle this page.'
      );
      await expect(page.locator(`${WIDGET_HOST} .ins-chrome`)).toHaveClass(/\bins-gray\b/);

      await pill.click();
      const card = page.locator(`${WIDGET_HOST} .ins-card`);
      await expect(card).toBeVisible();
      await expect(card.locator('.ins-title')).toHaveText('WPR not found');
      const cache = card.locator('.ins-cache');
      await expect(cache).toHaveText('—');
      await expect(cache).toHaveClass(/\bins-cache-neutral\b/);
      await expect(cache).toHaveAttribute('title', 'WP Rocket did not handle this page.');
      await expect(card.locator('.ins-close')).toHaveAttribute('title', 'Close the report');
      await expect(card.locator('.ins-card-foot')).toHaveText(/^WPR — · WP — · FDT [\w.-]+$/);
      // A ready answer: no loading or failure copy.
      await expect(card.locator('.ins-state')).toHaveCount(0);

      const rows = await card.locator('.ins-row').evaluateAll((nodes) =>
        nodes.map((row) => ({
          chip: row.querySelector('.ins-chip')?.className ?? '',
          value: row.querySelector('.ins-value')?.textContent ?? null,
          title: row.getAttribute('title') ?? ''
        }))
      );
      expect(rows.length, 'the registry rows still render, each honest').toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.chip, `no applied verdict is claimed (${row.title})`).not.toMatch(/ins-chip-ok/);
        // Only the honest absence states: neutral, or attention (unsure).
        expect(row.chip, `an absence chip state (${row.title})`).toMatch(
          /\bins-chip-(neutral|attention)\b/
        );
        // A measured count may show, and on this page it can only be zero.
        if (row.value !== null) {
          expect(row.value, `only an empty count (${row.title})`).toMatch(/^0 \w/);
        }
        expect(row.title, 'every row explains itself').toMatch(/^.+ — .+/);
        expect(row.title, 'no row claims WP Rocket applied it').not.toContain(
          'applied on this page'
        );
      }
    } finally {
      await page.close();
    }
  });

  test('D-1 widths: at 320 / 480 / 768 / 1280 px the pill and the open card stay inside, no horizontal scroll', async ({
    extension
  }) => {
    const { page } = await openFixturePage(extension, PLAIN_PAGE);
    try {
      await expectWidget(page, true, 'default on');
      await settleVerdict(page);
      for (const width of [320, 480, 768, 1280]) {
        await page.setViewportSize({ width, height: 640 });
        for (const open of [false, true]) {
          const pill = page.locator(`${WIDGET_HOST} .ins-pill`);
          const isOpen = await page.locator(`${WIDGET_HOST} .ins-card`).isVisible();
          if (open !== isOpen) {
            if (open) await pill.click();
            else await page.keyboard.press('Escape');
          }
          await settleAnimations(page);
          const read = await page.evaluate(
            (payload: { host: string; open: boolean }) => {
              const root = document.querySelector(payload.host)?.shadowRoot;
              const shape = root?.querySelector(payload.open ? '.ins-card' : '.ins-pill');
              const body = root?.querySelector('.ins-card-body');
              if (shape === null || shape === undefined || body === null || body === undefined) {
                throw new Error('the widget shape is missing');
              }
              const box = shape.getBoundingClientRect();
              const viewport = document.documentElement;
              return {
                left: box.left,
                top: box.top,
                right: viewport.clientWidth - box.right,
                bottom: viewport.clientHeight - box.bottom,
                pageScrolls: viewport.scrollWidth > viewport.clientWidth,
                bodyScrolls: body.scrollWidth > body.clientWidth
              };
            },
            { host: WIDGET_HOST, open }
          );
          const label = `${String(width)} px, ${open ? 'card' : 'pill'}`;
          for (const edge of ['left', 'top', 'right', 'bottom'] as const) {
            expect(read[edge], `${label}: inside (${edge})`).toBeGreaterThanOrEqual(0);
          }
          expect(read.pageScrolls, `${label}: the page gains no horizontal scroll`).toBe(false);
          expect(read.bodyScrolls, `${label}: the card body never scrolls sideways`).toBe(false);
        }
      }
    } finally {
      await page.close();
    }
  });
});
