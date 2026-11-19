/**
 * Live tools in Chromium: themes, motion and perf.
 *
 * - Themes: the three live-tool surfaces (Beacon Tester, LCP & Vitals, the
 *   JavaScript page's Runtime states) render each palette from the tokens —
 *   the page background and the primary text flip between light and dark,
 *   with no horizontal overflow at the 320 px floor.
 * - Motion: with reduced motion asked, no animation or transition of any
 *   length runs on those surfaces (a Runtime states row's drill-in detail
 *   included); without it, that view enters on the motion token, never
 *   longer.
 * - Perf (UI bar P-3, at this list's own cap): a 1,201-script page (1,200 delayed + its generator) read
 *   into Runtime states (1,000 listed, the cut named), then a State value, a
 *   Source value, a search and opening the row — no long task over 50 ms,
 *   total blocking time under 200 ms in those warm steps.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { openScriptDetail, pickFacet } from '../helpers/javascript-page';
import { openPanelForFixture } from '../helpers/panel-data';

/** The live-tool surfaces and the element each one is ready on. */
const SURFACES = [
  { hash: '#/beacon-tester', ready: '[data-fdt="beacon-run"]' },
  { hash: '#/lcp-vitals', ready: '[data-fdt="vitals-rows"]' },
  { hash: '#/javascript', ready: '[data-fdt="runtime-row"]', tab: 'Runtime states' }
] as const;

/**
 * Show one surface.
 *
 * @param panel The panel page.
 * @param surface The surface.
 */
async function show(panel: Page, surface: (typeof SURFACES)[number]): Promise<void> {
  await panel.evaluate((hash) => {
    location.hash = hash;
  }, surface.hash);
  if ('tab' in surface) await panel.getByRole('tab', { name: surface.tab }).click();
  await expect(panel.locator(surface.ready).first()).toBeVisible();
}

/** The palette's background and text colors as rendered. */
async function palette(panel: Page): Promise<{ background: string; text: string }> {
  return await panel.evaluate(() => {
    const heading = document.querySelector('h1');
    // The first painted background from the content up (the page body itself is transparent).
    let element: Element | null = document.querySelector('[data-fdt="panel-content"]');
    let background = 'rgba(0, 0, 0, 0)';
    while (element !== null && background === 'rgba(0, 0, 0, 0)') {
      background = getComputedStyle(element).backgroundColor;
      element = element.parentElement;
    }
    return {
      background,
      text: heading === null ? '' : getComputedStyle(heading).color
    };
  });
}

test('themes and motion on the three live-tool surfaces', async ({ extension }) => {
  // The System appearance (an earlier suite may have left Dark or Light chosen): the
  // palette then follows the emulated scheme. The stored options come back after.
  const stored = await extension.evaluateInWorker(async () => {
    const { options } = await chrome.storage.sync.get<{ options?: object }>('options');
    await chrome.storage.sync.set({ options: { ...options, appearance: 'system' } });
    return options ?? null;
  }, undefined);
  const { panel, fixture } = await openPanelForFixture(extension, '/runtime/scripts.html');
  try {
    await panel.setViewportSize({ width: 320, height: 900 });
    for (const surface of SURFACES) {
      await show(panel, surface);
      await panel.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
      const light = await palette(panel);
      await panel.emulateMedia({ colorScheme: 'dark' });
      const dark = await palette(panel);
      expect(light.background, `${surface.hash} background flips`).not.toBe(dark.background);
      expect(light.text, `${surface.hash} text flips`).not.toBe(dark.text);
      const overflow = await panel
        .locator('[data-fdt="panel-content"]')
        .evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(overflow, `${surface.hash} overflow at 320 px`).toBe(0);
    }

    // A row's drill-in detail (320 px): the view entrance on the motion token
    // without a preference, nothing with reduce.
    const drill = await openScriptDetail(panel, panel.locator('[data-fdt="runtime-row"]').first());
    await expect(drill).toHaveAttribute('data-fdt', 'drill-detail');
    const entrance = async (): Promise<number> =>
      await drill.evaluate((element) =>
        Math.max(
          ...getComputedStyle(element)
            .animationDuration.split(',')
            .map((value) => parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000))
        )
      );
    expect(await entrance()).toBeGreaterThan(0);
    expect(await entrance()).toBeLessThanOrEqual(280);
    await panel.emulateMedia({ reducedMotion: 'reduce' });
    expect(await entrance()).toBeLessThan(1);
    await panel.locator('[data-fdt="drill-back"]').click();
    for (const surface of SURFACES) {
      await show(panel, surface);
      const lasting = await panel.evaluate(() =>
        document
          .getAnimations()
          .filter((animation) => {
            const timing = animation.effect?.getComputedTiming();
            return Number(timing?.duration ?? 0) >= 1 || timing?.iterations === Infinity;
          })
          .map((animation) =>
            'animationName' in animation ? (animation as CSSAnimation).animationName : animation.id
          )
      );
      expect(lasting, `${surface.hash} animations under reduced motion`).toEqual([]);
    }
  } finally {
    await panel.close();
    await fixture.page.close();
    await extension.evaluateInWorker(
      (options: object | null) =>
        options === null
          ? chrome.storage.sync.remove('options')
          : chrome.storage.sync.set({ options }),
      stored
    );
  }
});

test('Runtime states at its cap: read, facets, search and open without a long task', async ({
  extension
}, info) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/runtime/many.html');
  try {
    await panel.evaluate(() => {
      location.hash = '#/javascript';
    });
    await panel.getByRole('tab', { name: 'Runtime states' }).click();
    await expect(panel.locator('[data-fdt-runtime-note]')).toContainText(
      'The page has 1,201 scripts; the first 1,000 are listed.'
    );
    await panel.evaluate(() => {
      const collected: { duration: number }[] = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) collected.push({ duration: entry.duration });
      });
      observer.observe({ type: 'longtask', buffered: false });
      (window as unknown as { fdtTasks: typeof collected }).fdtTasks = collected;
    });

    await panel.locator('[data-fdt-runtime-read]').click();
    await expect(panel.locator('[data-fdt-runtime-read]')).toBeEnabled();
    await pickFacet(panel, 'pending');
    await pickFacet(panel, 'plugin');
    await expect(panel.locator('[data-fdt="runtime-row"]').first()).toContainText(
      '/wp-content/plugins/'
    );
    await panel.locator('[data-fdt="runtime-states"] input[type="search"]').fill('p401');
    await expect(panel.locator('[data-fdt="runtime-row"]')).toHaveCount(1);
    await openScriptDetail(panel, panel.locator('[data-fdt="runtime-row"]'));
    // Let the last frame and the search debounce settle before reading the tasks.
    await panel.waitForTimeout(500);

    const tasks = await panel.evaluate(
      () => (window as unknown as { fdtTasks: { duration: number }[] }).fdtTasks
    );
    await info.attach('runtime-states-longtasks.json', {
      body: JSON.stringify(tasks),
      contentType: 'application/json'
    });
    expect(tasks.filter((task) => task.duration > 50)).toEqual([]);
    const tbt = tasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0);
    expect(tbt).toBeLessThan(200);
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
