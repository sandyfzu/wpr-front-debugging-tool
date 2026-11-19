/**
 * Reduced motion on the extension pages, frame by frame: a page entrance
 * (the panel boot, a route switch, a list's drill-in view swap, the options
 * mount) never paints its `from` state — no frame at opacity < 1 or moved —
 * and no animation object exists at any sampled frame. A collapsed (0.01 ms)
 * keyframe still painted one or two `from` frames; the page layer now drops
 * the motion outright. The feedback leg proves dropped transitions strand no
 * state (focus ring, menu, palette dialog reach their end state; the Filters
 * sheet's reduced-motion leg is in `panel-facets`); the no-preference leg
 * proves the entrance itself still runs for users who allow motion.
 *
 * The probe samples in `requestAnimationFrame` (before each frame's paint,
 * the computed style is that frame's painted value), from the document's
 * first frame (an init script) or around a switch.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { openScriptDetail, scriptRows } from '../helpers/javascript-page';
import { openOptionsPage } from '../helpers/options';
import { openPanelForFixture } from '../helpers/panel-data';

/** One sampled frame: the entrance element's painted state and the document's animations. */
interface FrameSample {
  readonly opacity: string;
  readonly transform: string;
  readonly animations: number;
}

/** Frames sampled per leg (≈ 0.5 s at 60 Hz: well past the 180 ms entrance). */
const FRAMES = 30;

/**
 * The sampler, installed before the page's modules: `__fdtSampleMotion(selector)`
 * records {@link FRAMES} frames of the first element matching `selector`
 * (frames where none matches are skipped, so a mount landing late is still
 * caught from its first frame). It also starts once at document start for
 * the boot entrance, on `__fdtBootSelector`.
 */
const SAMPLER = `(() => {
  const sample = (selector) => new Promise((resolve) => {
    const samples = [];
    let frames = 0;
    const tick = () => {
      frames += 1;
      const element = document.querySelector(selector);
      if (element !== null) {
        const style = getComputedStyle(element);
        samples.push({
          opacity: style.opacity,
          transform: style.transform,
          animations: document.getAnimations().length
        });
      }
      if (frames < ${String(FRAMES * 4)} && samples.length < ${String(FRAMES)}) requestAnimationFrame(tick);
      else resolve(samples);
    };
    requestAnimationFrame(tick);
  });
  window.__fdtSampleMotion = sample;
  window.__fdtBootSamples = sample(window.__fdtBootSelector ?? '.fdt-page > [data-fdt]');
})()`;

/** The panel's page-entrance element (the route body inside `.fdt-page`). */
const PAGE_ENTRANCE = ".fdt-page > [data-fdt='page-body']";

/**
 * Sample the entrance of a switch the callback triggers.
 *
 * @param page The page (the sampler installed).
 * @param selector The entering element.
 * @param trigger Starts the switch once sampling runs.
 * @returns The samples.
 */
async function sampleSwitch(
  page: Page,
  selector: string,
  trigger: () => Promise<void>
): Promise<FrameSample[]> {
  // Sampling starts before the trigger; frames before the element exists are skipped.
  const pending = page.evaluate(
    (target) =>
      (
        window as unknown as { __fdtSampleMotion: (s: string) => Promise<FrameSample[]> }
      ).__fdtSampleMotion(target),
    selector
  );
  await trigger();
  return pending;
}

/**
 * Assert every sampled frame painted the final state with no animation.
 *
 * @param samples The frames.
 * @param leg The leg's name (failure context).
 */
function expectStill(samples: readonly FrameSample[], leg: string): void {
  expect(samples.length, `${leg}: frames sampled`).toBeGreaterThan(0);
  expect(
    samples.filter((frame) => frame.opacity !== '1' || frame.transform !== 'none'),
    `${leg}: no frame paints the entrance's from state`
  ).toEqual([]);
  expect(
    samples.filter((frame) => frame.animations !== 0),
    `${leg}: no animation object at any frame`
  ).toEqual([]);
}

test('panel: boot, route switch and drill-in never paint a from frame under reduced motion', async ({
  extension
}) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html', {
    emulation: { colorScheme: 'dark', reducedMotion: 'reduce' },
    panelInit: `window.__fdtBootSelector = ${JSON.stringify(PAGE_ENTRANCE)}; ${SAMPLER}`
  });
  try {
    await panel.setViewportSize({ width: 420, height: 800 });
    await expect(panel.getByRole('heading', { name: 'Detections', level: 1 })).toBeVisible();
    const boot = await panel.evaluate(
      () => (window as unknown as { __fdtBootSamples: Promise<FrameSample[]> }).__fdtBootSamples
    );
    expectStill(boot, 'boot');

    const route = await sampleSwitch(
      panel,
      "[data-fdt-page='javascript'] > [data-fdt='page-body']",
      async () => {
        await panel.evaluate(() => {
          location.hash = '#/javascript';
        });
      }
    );
    expectStill(route, 'route switch');

    // 420 px: a row opens the drill-in view (the view-swap keyframe's moment).
    const row = scriptRows(panel).first();
    const drill = await sampleSwitch(panel, '[data-fdt-view-enter]', async () => {
      await openScriptDetail(panel, row);
    });
    expectStill(drill, 'drill-in');
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('panel: state feedback still reaches its end state with motion dropped', async ({
  extension
}) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html', {
    emulation: { colorScheme: 'dark', reducedMotion: 'reduce' }
  });
  try {
    await expect(panel.getByRole('heading', { name: 'Detections', level: 1 })).toBeVisible();
    // Focus ring: no transition to wait for, the ring is on at the keypress.
    const appearance = panel.getByRole('button', { name: /^Appearance: / });
    await appearance.focus();
    await panel.keyboard.press('Shift+Tab');
    await panel.keyboard.press('Tab');
    await expect(appearance).toBeFocused();
    expect(
      await appearance.evaluate((el) => {
        const css = getComputedStyle(el);
        return (
          css.boxShadow !== 'none' || (css.outlineStyle !== 'none' && css.outlineWidth !== '0px')
        );
      }),
      'the focus ring paints'
    ).toBe(true);
    // A menu opens and its exit unmounts it (no exit animation left to await).
    await panel.keyboard.press('Enter');
    const menu = panel.getByRole('menu');
    await expect(menu).toBeVisible();
    await panel.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(appearance).toBeFocused();
    // The palette dialog likewise.
    await panel.keyboard.press('ControlOrMeta+k');
    const field = panel.getByRole('combobox');
    await expect(field).toBeVisible();
    await panel.keyboard.press('Escape');
    await expect(field).toHaveCount(0);
    expect(await panel.evaluate(() => document.getAnimations().length)).toBe(0);
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('panel: the entrance still runs when motion is allowed', async ({ extension }) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html', {
    emulation: { colorScheme: 'light', reducedMotion: 'no-preference' },
    panelInit: SAMPLER
  });
  try {
    await expect(panel.getByRole('heading', { name: 'Detections', level: 1 })).toBeVisible();
    const route = await sampleSwitch(
      panel,
      "[data-fdt-page='javascript'] > [data-fdt='page-body']",
      async () => {
        await panel.evaluate(() => {
          location.hash = '#/javascript';
        });
      }
    );
    expect(
      route.some((frame) => Number(frame.opacity) < 1),
      'the entrance fades in over several frames'
    ).toBe(true);
    expect(route.at(-1)?.opacity, 'and settles opaque').toBe('1');
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('options: the mount entrance never paints a from frame under reduced motion', async ({
  extension
}) => {
  const id = await extension.extensionId();
  const page = await extension.browserContext.newPage();
  try {
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.addInitScript(
      `window.__fdtBootSelector = ".fdt-page > [data-fdt='options-body']"; ${SAMPLER}`
    );
    await page.goto(`chrome-extension://${id}/options.html`, { waitUntil: 'load' });
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    const boot = await page.evaluate(
      () => (window as unknown as { __fdtBootSamples: Promise<FrameSample[]> }).__fdtBootSamples
    );
    expectStill(boot, 'options mount');
  } finally {
    await page.close();
  }
  // The shared helper's reduced-motion arm boots the same way (sanity: the page is usable).
  const options = await openOptionsPage(extension, { reducedMotion: 'reduce' });
  await options.close();
});
