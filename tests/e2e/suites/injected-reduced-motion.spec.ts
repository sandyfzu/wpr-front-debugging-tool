/**
 * Reduced motion on the UIs injected into host pages, frame by frame: an
 * entrance never paints its `from` state (every sampled frame is the
 * settled one, opaque) and no animation object exists in the UI's shadow
 * root at any sampled frame — the exclusion overlay (open, collapse to its
 * pill, re-expand), the on-page command palette (open, re-open), the
 * detection widget (mount, card open, pill return, with the focus round
 * trip) and the Known Conflicts card (mount, list open, focus hand-off). A
 * collapsed (0.01 ms) run still painted one `from` frame; the token layer
 * now drops the motion outright. The no-preference legs prove the probe bites and the
 * entrances still run for users who allow motion.
 *
 * The probe samples in `requestAnimationFrame` (before each frame's paint,
 * the computed style is that frame's painted value) from the main world,
 * through the open shadow roots; frames before the element exists (or while
 * it is hidden) are skipped, so a late mount is caught from its first shown
 * frame.
 */
import type { Page } from '@playwright/test';

import { clearDrafts, injectOverlay, OVERLAY_HOST } from '../helpers/exclusion-overlay';
import {
  expect,
  openFixturePage,
  ORIGIN_A,
  test,
  type ExtensionDriver
} from '../helpers/extension';
import { SITE_URL, siteTest } from '../helpers/site';

/** One sampled frame: the element's painted state and its shadow root's animations. */
interface FrameSample {
  readonly opacity: string;
  readonly transform: string;
  readonly visibility: string;
  readonly animations: number;
}

/** Frames sampled per leg (≈ 0.5 s at 60 Hz: well past the slowest 280 ms entrance). */
const FRAMES = 30;

/** The on-page palette's and the detection widget's shadow hosts. */
const PALETTE_HOST = 'wpr-fdt-command-palette';
const WIDGET_HOST = 'wpr-fdt-detection-widget';
const KC_HOST = 'wpr-fdt-known-conflicts';

/** Fixture pages: one with a focusable control (palette), one plain (widget). */
const PALETTE_PAGE = '/palette/hotkeys.html';
const PLAIN_PAGE = '/pipeline/plain.html';
const OVERLAY_PAGE = '/exclusion/delayed.html';

/** Generous mount wait (runtime UIs are injected on demand). */
const MOUNT = { timeout: 15_000 };

/**
 * The sampler, installed in the page's main world (init script or evaluate):
 * `__fdtSampleShadow(host, selector)` records {@link FRAMES} frames of the
 * first `selector` match inside `host`'s shadow root, from its first frame
 * with `visibility: visible` (the widgets keep hidden shapes mounted).
 */
const SAMPLER = `(() => {
  if (window.__fdtSampleShadow !== undefined) return;
  window.__fdtSampleShadow = (host, selector) => new Promise((resolve) => {
    const samples = [];
    let frames = 0;
    const tick = () => {
      frames += 1;
      const root = document.querySelector(host)?.shadowRoot ?? null;
      const element = root?.querySelector(selector) ?? null;
      const style = element === null ? null : getComputedStyle(element);
      // A shape kept mounted behind visibility counts from its first shown frame.
      if (root !== null && style !== null && style.visibility === 'visible') {
        samples.push({
          opacity: style.opacity,
          transform: style.transform,
          visibility: style.visibility,
          animations: root.getAnimations().length
        });
      }
      if (frames < ${String(FRAMES * 8)} && samples.length < ${String(FRAMES)}) requestAnimationFrame(tick);
      else resolve(samples);
    };
    requestAnimationFrame(tick);
  });
})()`;

/**
 * Sample an element's frames around a trigger (sampling starts first).
 *
 * @param page The host page.
 * @param host The UI's shadow host.
 * @param selector The entering element inside it.
 * @param trigger Starts the change once sampling runs.
 * @returns The samples.
 */
async function sampleAround(
  page: Page,
  host: string,
  selector: string,
  trigger: () => Promise<void>
): Promise<FrameSample[]> {
  await page.evaluate(SAMPLER);
  const pending = page.evaluate(
    ([target, part]) =>
      (
        window as unknown as {
          __fdtSampleShadow: (h: string, s: string) => Promise<FrameSample[]>;
        }
      ).__fdtSampleShadow(target, part),
    [host, selector] as const
  );
  await trigger();
  return await pending;
}

/**
 * Assert every sampled frame painted the settled state, opaque and visible,
 * with no animation object in the shadow root.
 *
 * @param samples The frames.
 * @param leg The leg's name (failure context).
 */
function expectStill(samples: readonly FrameSample[], leg: string): void {
  expect(samples.length, `${leg}: frames sampled`).toBeGreaterThan(0);
  const settled = samples.at(-1);
  expect(settled, `${leg}: the settled frame`).toMatchObject({
    opacity: '1',
    visibility: 'visible'
  });
  expect(
    samples.filter(
      (frame) =>
        frame.opacity !== settled?.opacity ||
        frame.transform !== settled.transform ||
        frame.visibility !== settled.visibility
    ),
    `${leg}: no frame paints an entrance's from state`
  ).toEqual([]);
  expect(
    samples.filter((frame) => frame.animations !== 0),
    `${leg}: no animation object at any frame`
  ).toEqual([]);
}

/**
 * Assert the entrance ran: some frame below full opacity, settling opaque.
 *
 * @param samples The frames.
 * @param leg The leg's name (failure context).
 */
function expectEntrance(samples: readonly FrameSample[], leg: string): void {
  expect(
    samples.some((frame) => Number(frame.opacity) < 1),
    `${leg}: the entrance fades in over frames`
  ).toBe(true);
  expect(samples.at(-1)?.opacity, `${leg}: and settles opaque`).toBe('1');
}

/**
 * Send the on-page palette's open row to a tab and wait for its field.
 *
 * @param extension The driver.
 * @param page The tab's page.
 * @param tabId The tab.
 */
async function openPalette(extension: ExtensionDriver, page: Page, tabId: number): Promise<void> {
  expect(await extension.sendToTab<boolean>(tabId, 'openCommandPalette')).toBe(true);
  await expect(page.locator(`${PALETTE_HOST} [data-fdt="palette-input"]`)).toBeFocused(MOUNT);
}

test('exclusion overlay: open, collapse and re-expand never paint a from frame under reduced motion', async ({
  extension
}) => {
  await clearDrafts(extension);
  const opened = await openFixturePage(extension, OVERLAY_PAGE, undefined, (target) => {
    void target.emulateMedia({ reducedMotion: 'reduce' });
  });
  const { page } = opened;
  try {
    const open = await sampleAround(page, OVERLAY_HOST, '.xo-panel', async () => {
      await injectOverlay(extension, opened);
    });
    expectStill(open, 'overlay open');
    const pill = await sampleAround(page, OVERLAY_HOST, '.xo-pill', async () => {
      await page.getByRole('button', { name: 'Collapse' }).click();
    });
    expectStill(pill, 'collapse to the pill');
    const expand = await sampleAround(
      page,
      OVERLAY_HOST,
      ".xo-panel[data-open='true']",
      async () => {
        await page.locator(`${OVERLAY_HOST} .xo-pill`).click();
      }
    );
    expectStill(expand, 're-expand');
  } finally {
    await page.close();
  }
});

test('exclusion overlay: the open still animates when motion is allowed', async ({ extension }) => {
  await clearDrafts(extension);
  const opened = await openFixturePage(extension, OVERLAY_PAGE, undefined, (target) => {
    void target.emulateMedia({ reducedMotion: 'no-preference' });
  });
  try {
    const open = await sampleAround(opened.page, OVERLAY_HOST, '.xo-panel', async () => {
      await injectOverlay(extension, opened);
    });
    expectEntrance(open, 'overlay open (motion allowed)');
  } finally {
    await opened.page.close();
  }
});

test('on-page palette: open and re-open never paint a from frame under reduced motion; the entrance runs with motion allowed', async ({
  extension
}) => {
  const { page, tabId } = await openFixturePage(extension, PALETTE_PAGE);
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const dialog = '[data-fdt="dialog"]';
    const first = await sampleAround(page, PALETTE_HOST, dialog, async () => {
      await openPalette(extension, page, tabId);
    });
    expectStill(first, 'palette open');
    await page.keyboard.press('Escape');
    await expect(page.locator(`${PALETTE_HOST} ${dialog}`)).toHaveCount(0);
    const again = await sampleAround(page, PALETTE_HOST, dialog, async () => {
      await openPalette(extension, page, tabId);
    });
    expectStill(again, 'palette re-open');
    await page.keyboard.press('Escape');
    await expect(page.locator(`${PALETTE_HOST} ${dialog}`)).toHaveCount(0);

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const moving = await sampleAround(page, PALETTE_HOST, dialog, async () => {
      await openPalette(extension, page, tabId);
    });
    expectEntrance(moving, 'palette open (motion allowed)');
    await page.keyboard.press('Escape');
  } finally {
    await page.close();
  }
});

test('detection widget: mount, card open and pill return never paint a from frame under reduced motion; focus rides the round trip', async ({
  extension
}) => {
  const page = await extension.browserContext.newPage();
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(SAMPLER);
    await page.addInitScript(
      `window.__fdtMountSamples = window.__fdtSampleShadow(${JSON.stringify(WIDGET_HOST)}, '.dw-pill');`
    );
    await page.goto(`${ORIGIN_A}${PLAIN_PAGE}`, { waitUntil: 'load' });
    const pill = page.locator(`${WIDGET_HOST} .dw-pill`);
    await expect(pill).toBeVisible(MOUNT);
    const mount = await page.evaluate(
      () => (window as unknown as { __fdtMountSamples: Promise<FrameSample[]> }).__fdtMountSamples
    );
    expectStill(mount, 'widget mount');

    await pill.focus();
    const card = await sampleAround(page, WIDGET_HOST, '.dw-card', async () => {
      await page.keyboard.press('Enter');
    });
    expectStill(card, 'card open');
    await expect(page.locator(`${WIDGET_HOST} [role="dialog"]`)).toBeFocused();

    const back = await sampleAround(page, WIDGET_HOST, '.dw-pill', async () => {
      await page.keyboard.press('Escape');
    });
    expectStill(back, 'pill return');
    await expect(pill).toBeFocused();
  } finally {
    await page.close();
  }
});

siteTest(
  'Known Conflicts: mount and list open never paint a from frame under reduced motion',
  async ({ adminPage, extension }) => {
    // The admin page logs the context in; a fresh page keeps the probe's
    // init scripts off the worker's shared admin page.
    expect(adminPage.isClosed()).toBe(false);
    const page = await extension.browserContext.newPage();
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(SAMPLER);
      await page.addInitScript(
        `window.__fdtMountSamples = window.__fdtSampleShadow(${JSON.stringify(KC_HOST)}, '.kc-badges');`
      );
      await page.goto(`${SITE_URL}/wp-admin/plugins.php`, { waitUntil: 'load' });
      const badge = page.locator(`${KC_HOST} .kc-badge`);
      await expect(badge).toBeVisible(MOUNT);
      const mount = await page.evaluate(
        () => (window as unknown as { __fdtMountSamples: Promise<FrameSample[]> }).__fdtMountSamples
      );
      expectStill(mount, 'KC mount');
      const list = await sampleAround(page, KC_HOST, '.kc-list', async () => {
        await badge.click();
      });
      expectStill(list, 'KC list open');
      // The focus hand-off with the departing marker hidden at once: the
      // card takes focus, Escape closes it and the badge regains it.
      await expect(page.locator(`${KC_HOST} .kc-list`)).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.locator(`${KC_HOST} .kc-list`)).toBeHidden();
      await expect(badge).toBeFocused();
    } finally {
      await page.close();
    }
  }
);
