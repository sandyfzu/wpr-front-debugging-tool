/**
 * Shared native scrollbar styling over built extension pages and a real
 * injected shadow tree. Probes deliberately use bare overflow elements so a
 * component-specific class cannot conceal an unstyled textarea/code block.
 */
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expect, openFixturePage, panelPageUrl, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';
import { settleFrames } from '../helpers/frames';
import { resetStoredOptions } from '../helpers/options';

// One profile serves every suite: the options this file writes go back to the
// fresh-install item after each test (its assertions are over, so a page it
// left open no longer needs them) and no stored choice reaches the next suite.
test.afterEach(async ({ extension }) => {
  await resetStoredOptions(extension);
});

/**
 * Resolved `--fg-muted` thumb values; literals pin both palette branches. The
 * extension pages (panel, options) take the extension-page token block's
 * light value; injected shadow trees keep the shared one.
 */
const PAGE_THUMB = { light: 'rgb(94, 103, 118)', dark: 'rgb(139, 150, 169)' } as const;
const INJECTED_THUMB = { light: 'rgb(93, 102, 117)', dark: 'rgb(139, 150, 169)' } as const;

/**
 * Exercise native keyboard and wheel scrolling on both axes, without scripted input substitutes.
 * @param page Page containing the keyboard-focusable probe at its starting offset.
 */
async function assertKeyboardAndWheel(page: Page): Promise<void> {
  const probe = page.locator('#scrollbar-probe');
  await probe.focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => probe.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => probe.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  // Native keyboard scrolling is compositor-animated; do not reset mid-flight.
  await page.waitForTimeout(400);
  await probe.evaluate((el) => {
    el.scrollTo(0, 0);
    el.blur();
  });
  await probe.hover();
  await page.waitForTimeout(150);
  await page.mouse.wheel(100, 100);
  await expect.poll(() => probe.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect.poll(() => probe.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  await probe.evaluate((el) => {
    el.scrollTo(0, 0);
  });
}

/**
 * Decode real screenshot pixels, including an identifying mark proving the probe
 * is painted above the overlay. CSS readbacks alone cannot detect idle auto-hide.
 * @param page Page owning the probe (including an open shadow tree).
 * @param resting Whether the probe is at the origin, with its identifying mark visible.
 * @returns The screenshot, after checking both thumb/track pairs against their palette.
 */
async function assertBarPixels(page: Page, resting = true): Promise<Buffer> {
  const probe = page.locator('#scrollbar-probe');
  const image = await probe.screenshot({ scale: 'css' });
  const pixels = await probe.evaluate(async (el, base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Scrollbar pixel probe has no canvas context');
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const coordinates: [number, number][] = [
      [4, 4],
      [canvas.width - 4, 10],
      [canvas.width - 4, 60],
      [10, canvas.height - 4],
      [60, canvas.height - 4]
    ];
    /**
     * Read one opaque screenshot pixel as a comparable resolved CSS color.
     * @param x Horizontal screenshot coordinate.
     * @param y Vertical screenshot coordinate.
     * @returns The pixel's resolved RGB color.
     */
    const colorAt = (x: number, y: number): string => {
      const data = context.getImageData(x, y, 1, 1).data;
      return `rgb(${String(data[0])}, ${String(data[1])}, ${String(data[2])})`;
    };
    const actual = coordinates.map(([x, y]) => colorAt(x, y));
    const marker = el.querySelector('[data-paint-marker]');
    if (!marker) throw new Error('Scrollbar probe has no identifying paint marker');
    const forced = matchMedia('(forced-colors: active)').matches;
    const systemTrack = document.createElement('span');
    systemTrack.style.backgroundColor = 'Canvas';
    el.append(systemTrack);
    const canvasColor = getComputedStyle(systemTrack).backgroundColor;
    systemTrack.remove();
    return {
      actual,
      marker: getComputedStyle(marker).backgroundColor,
      thumb: getComputedStyle(el, '::-webkit-scrollbar-thumb').backgroundColor,
      track: getComputedStyle(el, '::-webkit-scrollbar').backgroundColor,
      forced,
      canvasColor,
      parts: ['::-webkit-scrollbar', '::-webkit-scrollbar-thumb', '::-webkit-scrollbar-corner'].map(
        (part) => getComputedStyle(el, part).forcedColorAdjust
      ),
      corner: getComputedStyle(el, '::-webkit-scrollbar-corner').backgroundColor,
      border: getComputedStyle(el, '::-webkit-scrollbar-thumb').borderTopColor,
      axes: [
        Array.from({ length: canvas.height - 8 }, (_, y) => colorAt(canvas.width - 4, y)),
        Array.from({ length: canvas.width - 8 }, (_, x) => colorAt(x, canvas.height - 4))
      ]
    };
  }, image.toString('base64'));
  expect(pixels.thumb).not.toBe(pixels.track);
  for (const axis of pixels.axes) {
    // Rounded caps on the narrower thumb leave fewer fully opaque centerline pixels.
    expect(axis.filter((color) => color === pixels.thumb).length).toBeGreaterThanOrEqual(16);
    expect(axis.filter((color) => color === pixels.track).length).toBeGreaterThanOrEqual(20);
  }
  if (resting) {
    expect(pixels.actual).toEqual([
      pixels.marker,
      pixels.thumb,
      pixels.track,
      pixels.thumb,
      pixels.track
    ]);
  }
  if (pixels.forced) {
    expect(pixels.thumb).toBe(pixels.marker);
    expect(pixels.track).toBe(pixels.canvasColor);
    expect(pixels.corner).toBe(pixels.canvasColor);
    expect(pixels.border).toBe(pixels.canvasColor);
    expect(pixels.parts).toEqual(['auto', 'auto', 'auto']);
  }
  return image;
}

/**
 * Assert painted idle thumbs, not merely computed styling, then stable hover geometry.
 * @param page Built extension page containing the bare two-axis probe.
 */
async function assertPaintedStableBars(page: Page): Promise<void> {
  const probe = page.locator('#scrollbar-probe');
  await probe.evaluate((el) => {
    el.scrollTo(0, 0);
  });
  await page.mouse.move(500, 300);
  // Outlast the OS overlay fade: a computed width alone did not detect the bug.
  await page.waitForTimeout(2200);
  const idle = await assertBarPixels(page);
  const geometry = await probe.evaluate((el: HTMLElement) => ({
    x: el.offsetWidth - el.clientWidth,
    y: el.offsetHeight - el.clientHeight
  }));
  expect(geometry).toEqual({ x: 8, y: 8 });
  await probe.hover();
  expect((await probe.screenshot()).equals(idle)).toBe(true);
  const box = await probe.boundingBox();
  if (!box) throw new Error('Scrollbar probe has no rendered box');
  await page.mouse.move(box.x + box.width - 4, box.y + 10);
  await page.waitForTimeout(400);
  expect((await probe.screenshot()).equals(idle)).toBe(true);
  await probe.evaluate((el) => {
    el.style.setProperty('--scrollbar-thumb', 'transparent');
  });
  await expect
    .poll(() =>
      probe.evaluate((el) => getComputedStyle(el, '::-webkit-scrollbar-thumb').backgroundColor)
    )
    .toMatch(/^rgba\(\d+, \d+, \d+, 0\)$/);
  // Trigger native scrollbar repaint after the token swap (Chromium caches parts).
  await probe.evaluate((el: HTMLElement) => {
    el.style.overflow = 'hidden';
    el.getBoundingClientRect();
    el.style.overflow = 'auto';
  });
  expect((await probe.screenshot()).equals(idle)).toBe(false);
  await probe.evaluate((el: HTMLElement) => {
    el.style.removeProperty('--scrollbar-thumb');
    el.style.overflow = 'hidden';
    el.getBoundingClientRect();
    el.style.overflow = 'auto';
  });
  // Drag the actual native thumb, rather than simulating scrolling in JavaScript.
  await page.mouse.move(box.x + box.width - 4, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + 55, { steps: 5 });
  expect(await probe.evaluate((el: HTMLElement) => el.offsetWidth - el.clientWidth)).toBe(8);
  await test.info().attach('vertical-drag-held', {
    body: await assertBarPixels(page, false),
    contentType: 'image/png'
  });
  await page.mouse.up();
  await expect.poll(() => probe.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await probe.evaluate((el: HTMLElement) => el.offsetWidth - el.clientWidth)).toBe(8);
  // Let the compositor finish the native drag before restoring its scroll offset.
  await page.mouse.move(500, 300);
  await page.waitForTimeout(400);
  await probe.evaluate((el) => {
    el.scrollTo(0, 0);
  });
  await page.mouse.move(box.x + 10, box.y + box.height - 4);
  await page.mouse.down();
  await page.mouse.move(box.x + 55, box.y + box.height - 4, { steps: 5 });
  expect(await probe.evaluate((el: HTMLElement) => el.offsetHeight - el.clientHeight)).toBe(8);
  await test.info().attach('horizontal-drag-held', {
    body: await assertBarPixels(page, false),
    contentType: 'image/png'
  });
  await page.mouse.up();
  await expect.poll(() => probe.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await page.mouse.move(500, 300);
  await page.waitForTimeout(400);
  await probe.evaluate((el) => {
    el.scrollTo(0, 0);
  });
  await expect.poll(() => probe.evaluate((el) => [el.scrollLeft, el.scrollTop])).toEqual([0, 0]);
  await page.waitForTimeout(2200);
  const afterScroll = await assertBarPixels(page);
  await test.info().attach('idle-thumb', { body: idle, contentType: 'image/png' });
  await test.info().attach('after-scroll-thumb', { body: afterScroll, contentType: 'image/png' });
  expect(afterScroll.equals(idle)).toBe(true);
  await assertKeyboardAndWheel(page);
  await probe.evaluate((el) => {
    const content = el.firstElementChild;
    if (!(content instanceof HTMLElement)) throw new Error('Scrollbar probe has no content');
    content.style.width = '50px';
    content.style.height = '50px';
  });
  expect(
    await probe.evaluate((el: HTMLElement) => [
      el.offsetWidth - el.clientWidth,
      el.offsetHeight - el.clientHeight
    ])
  ).toEqual([0, 0]);
  await probe.evaluate((el) => {
    const content = el.firstElementChild;
    if (!(content instanceof HTMLElement)) throw new Error('Scrollbar probe has no content');
    content.style.width = '800px';
    content.style.height = '800px';
  });
}

/**
 * Create a keyboard-focusable, two-axis overflow probe inside an owned tree.
 * @param page Built extension page, or fixture page containing the overlay.
 * @param shadow Whether the probe belongs inside the real overlay shadow root.
 * @returns The probe's locator selector (Playwright pierces open shadow roots).
 */
async function addProbe(page: Page, shadow = false): Promise<string> {
  await page.evaluate((inShadow: boolean) => {
    const parent = inShadow
      ? document
          .querySelector('wpr-fdt-side-by-side')
          ?.shadowRoot?.querySelector('.sbs-overlay--open')
      : document.body;
    if (!parent) throw new Error('Scrollbar probe has no owned container');
    const probe = document.createElement('div');
    probe.id = 'scrollbar-probe';
    probe.tabIndex = 0;
    probe.setAttribute('aria-label', 'Scrollbar test region');
    probe.style.cssText =
      'position:fixed;inset:10px auto auto 10px;width:120px;height:100px;overflow:auto;z-index:9999;background:var(--surface-1)';
    const content = document.createElement('div');
    content.style.cssText = 'width:800px;height:800px';
    const marker = document.createElement('div');
    marker.dataset.paintMarker = '';
    marker.style.cssText = 'width:8px;height:8px;background:CanvasText';
    content.append(marker);
    probe.append(content);
    parent.append(probe);
  }, shadow);
  return '#scrollbar-probe';
}

/**
 * Read the effective scrollbar branch, including Chromium's native pseudo-elements.
 * @param page The page containing the element.
 * @param selector Element selector, piercing open shadow trees.
 * @returns Computed width/color and scrollable dimensions.
 */
async function scrollbarState(
  page: Page,
  selector: string
): Promise<{ width: string; color: string; overflowX: boolean; overflowY: boolean }> {
  return await page.locator(selector).evaluate((element) => {
    return {
      width: getComputedStyle(element, '::-webkit-scrollbar').width,
      color: getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor,
      overflowX: element.scrollWidth > element.clientWidth,
      overflowY: element.scrollHeight > element.clientHeight
    };
  });
}

test('all built page elements get fixed bars, live palettes and native scrolling', async ({
  extension
}) => {
  for (const name of ['panel.html', 'options.html']) {
    const page = await extension.browserContext.newPage();
    await page.goto((await panelPageUrl(extension)).replace('panel.html', name));
    const selector = await addProbe(page);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(() => {
      document.documentElement.removeAttribute('data-theme');
    });
    expect(await scrollbarState(page, selector)).toEqual({
      width: '8px',
      color: PAGE_THUMB.light,
      overflowX: true,
      overflowY: true
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    expect((await scrollbarState(page, selector)).color).toContain(PAGE_THUMB.dark);
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    expect((await scrollbarState(page, selector)).color).toContain(PAGE_THUMB.light);
    await assertPaintedStableBars(page);
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    expect((await scrollbarState(page, selector)).color).toContain(PAGE_THUMB.dark);
    expect(await page.locator('html').evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe(
      'auto'
    );
    const probe = page.locator(selector);
    await assertPaintedStableBars(page);
    await page.emulateMedia({ forcedColors: 'active' });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.setAttribute('data-theme', value);
      }, theme);
      expect((await scrollbarState(page, selector)).width).toBe('8px');
      expect(await probe.evaluate((el) => getComputedStyle(el).forcedColorAdjust)).toBe('auto');
      expect(await probe.evaluate((el) => getComputedStyle(el).scrollbarColor)).toBe('auto');
      await assertPaintedStableBars(page);
    }
    await page.emulateMedia({ forcedColors: 'none' });
    expect((await scrollbarState(page, selector)).width).toBe('8px');
    await page.close();
  }
});

test('JavaScript virtual lists and nested code keep fixed native bars at narrow widths', async ({
  extension
}) => {
  // A parallel worktree can own the shared fixture server. Serve this new fixture
  // from this checkout while retaining the real HTTP origin and capture pipeline.
  const fixtureUrl = /\/scrollbars\/scripts\.html(?:\?|$)/;
  await extension.browserContext.route(fixtureUrl, async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: readFileSync(new URL('../fixtures/scrollbars/scripts.html', import.meta.url), 'utf8')
    });
  });
  const { panel, fixture } = await openPanelForFixture(extension, '/scrollbars/scripts.html', {
    bootHash: '#/javascript'
  });
  try {
    expect(await fixture.page.content()).toContain('Scrollable script inventory');
    expect(await fixture.page.locator('script').count()).toBe(301);
    const list = panel.getByRole('list', { name: 'Scripts', exact: true });
    await expect(list).toBeVisible();
    await panel.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [320, 480, 768, 1280]) {
      await panel.setViewportSize({ width, height: 800 });
      // The nav form follows the shell width in the next frame (before it paints).
      await settleFrames(panel);
      await expect.poll(() => list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      expect(
        await list.evaluate((el: HTMLElement) => ({
          gutter:
            el.offsetWidth -
            el.clientWidth -
            parseFloat(getComputedStyle(el).borderLeftWidth) -
            parseFloat(getComputedStyle(el).borderRightWidth),
          horizontal: el.scrollWidth > el.clientWidth
        }))
      ).toEqual({ gutter: 8, horizontal: false });
      const code = panel.getByRole('group', { name: 'Inline script 2', exact: true });
      await expect(code).toBeVisible();
      expect(
        await code.evaluate((el) => ({
          horizontal: el.scrollWidth > el.clientWidth,
          vertical: el.scrollHeight > el.clientHeight,
          height: getComputedStyle(el, '::-webkit-scrollbar').height
        }))
      ).toEqual({ horizontal: true, vertical: false, height: '8px' });
      expect(
        await panel.evaluate(
          () => document.documentElement.scrollWidth === document.documentElement.clientWidth
        )
      ).toBe(true);
      // The code pane owns horizontal overflow and the list owns vertical overflow;
      // their page ancestor must not become a second vertical scroller at normal height.
      await expect
        .poll(() =>
          list.evaluate((el) => {
            const area = el.closest('[data-fdt="panel-content"]');
            if (!area) throw new Error('Scripts list has no page scroll area');
            return area.scrollHeight <= area.clientHeight;
          })
        )
        .toBe(true);
      await test.info().attach(`javascript-scrollbars-${String(width)}`, {
        body: await panel.screenshot(),
        contentType: 'image/png'
      });
    }
    await list.hover();
    await panel.mouse.wheel(0, 600);
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect
      .poll(() =>
        panel.evaluate(
          () =>
            document.getAnimations().filter((animation) => animation.playState === 'running').length
        )
      )
      .toBe(0);
  } finally {
    await panel.close();
    await fixture.page.close();
    await extension.browserContext.unroute(fixtureUrl);
  }
});

test('injected bars follow the owned palette and leave host page bars untouched', async ({
  extension
}) => {
  await extension.evaluateInWorker(() => chrome.storage.sync.set({ options: {} }), undefined);
  const { page, tabId } = await openFixturePage(extension, '/side-by-side.html');
  await page.emulateMedia({ colorScheme: 'dark' });
  const hostBefore = await page.locator('html').evaluate((el) => ({
    width: getComputedStyle(el).scrollbarWidth,
    color: getComputedStyle(el).scrollbarColor
  }));
  await extension.sendToTab<boolean>(tabId, 'openSideBySide');
  await expect(page.locator('wpr-fdt-side-by-side .sbs-overlay--open')).toHaveCount(1);
  const selector = await addProbe(page, true);
  // WXT adopts the shadow stylesheet asynchronously after mounting the host.
  await expect.poll(async () => (await scrollbarState(page, selector)).width).toBe('8px');
  expect(await scrollbarState(page, selector)).toEqual({
    width: '8px',
    color: INJECTED_THUMB.dark,
    overflowX: true,
    overflowY: true
  });
  await assertPaintedStableBars(page);
  await page.emulateMedia({ colorScheme: 'light' });
  expect((await scrollbarState(page, selector)).color).toContain(INJECTED_THUMB.light);
  await assertPaintedStableBars(page);
  await extension.evaluateInWorker(
    () => chrome.storage.sync.set({ options: { appearance: 'dark' } }),
    undefined
  );
  await expect
    .poll(async () => (await scrollbarState(page, selector)).color)
    .toContain(INJECTED_THUMB.dark);
  expect(
    await page.locator('html').evaluate((el) => ({
      width: getComputedStyle(el).scrollbarWidth,
      color: getComputedStyle(el).scrollbarColor
    }))
  ).toEqual(hostBefore);
  expect(
    await page.locator('wpr-fdt-side-by-side').evaluate((el) => getComputedStyle(el).scrollbarWidth)
  ).toBe('auto');
  await page.emulateMedia({ forcedColors: 'active' });
  expect((await scrollbarState(page, selector)).width).toBe('8px');
  await assertPaintedStableBars(page);
  expect(
    await page.locator('html').evaluate((el) => getComputedStyle(el, '::-webkit-scrollbar').width)
  ).toBe('auto');
  expect(
    await page
      .locator('wpr-fdt-side-by-side')
      .evaluate((el) => getComputedStyle(el).forcedColorAdjust)
  ).toBe('auto');
  await page.close();
});
