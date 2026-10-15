/**
 * Shared native scrollbar styling over built extension pages and a real
 * injected shadow tree. Probes deliberately use bare overflow elements so a
 * component-specific class cannot conceal an unstyled textarea/code block.
 */
import type { Page } from '@playwright/test';
import { expect, openFixturePage, panelPageUrl, test } from '../helpers/extension';

/** Resolved foreground token values; literals pin both palette branches. */
const THUMB = { light: 'rgb(93, 102, 117)', dark: 'rgb(139, 150, 169)' } as const;

/**
 * Create a keyboard-focusable, two-axis overflow probe inside an owned tree.
 * @param page Built extension page, or fixture page containing the overlay.
 * @param shadow Whether the probe belongs inside the real overlay shadow root.
 * @returns The probe's locator selector (Playwright pierces open shadow roots).
 */
async function addProbe(page: Page, shadow = false): Promise<string> {
  await page.evaluate((inShadow: boolean) => {
    const parent = inShadow
      ? document.querySelector('wpr-fdt-side-by-side')?.shadowRoot?.querySelector('[data-theme]')
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
    content.textContent = 'Overflow content';
    probe.append(content);
    parent.append(probe);
  }, shadow);
  return '#scrollbar-probe';
}

/**
 * Read the computed native scrollbar treatment from an existing element.
 * @param page The page containing the element.
 * @param selector Element selector, piercing open shadow trees.
 * @returns Computed width/color and scrollable dimensions.
 */
async function scrollbarState(
  page: Page,
  selector: string
): Promise<{ width: string; color: string; overflowX: boolean; overflowY: boolean }> {
  return await page.locator(selector).evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      width: style.scrollbarWidth,
      color: style.scrollbarColor,
      overflowX: element.scrollWidth > element.clientWidth,
      overflowY: element.scrollHeight > element.clientHeight
    };
  });
}

test('all built page elements get thin bars, live palettes and native scrolling', async ({
  extension
}) => {
  for (const name of ['panel.html', 'popup.html']) {
    const page = await extension.browserContext.newPage();
    await page.goto((await panelPageUrl(extension)).replace('panel.html', name));
    const selector = await addProbe(page);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(() => {
      document.documentElement.removeAttribute('data-theme');
    });
    expect(await scrollbarState(page, selector)).toEqual({
      width: 'thin',
      color: `${THUMB.light} rgba(0, 0, 0, 0)`,
      overflowX: true,
      overflowY: true
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    expect((await scrollbarState(page, selector)).color).toContain(THUMB.dark);
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    expect((await scrollbarState(page, selector)).color).toContain(THUMB.light);
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    expect((await scrollbarState(page, selector)).color).toContain(THUMB.dark);
    expect(await page.locator('html').evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe(
      'thin'
    );
    const probe = page.locator(selector);
    await probe.focus();
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => probe.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => probe.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await probe.evaluate((el) => {
      el.scrollTo(0, 0);
    });
    await probe.hover();
    await page.mouse.wheel(100, 100);
    await expect.poll(() => probe.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => probe.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await page.emulateMedia({ forcedColors: 'active' });
    expect((await scrollbarState(page, selector)).width).toBe('auto');
    expect((await scrollbarState(page, selector)).color).toBe('auto');
    await page.emulateMedia({ forcedColors: 'none' });
    expect((await scrollbarState(page, selector)).width).toBe('thin');
    await page.close();
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
  expect(await scrollbarState(page, selector)).toEqual({
    width: 'thin',
    color: `${THUMB.dark} rgba(0, 0, 0, 0)`,
    overflowX: true,
    overflowY: true
  });
  await page.emulateMedia({ colorScheme: 'light' });
  expect((await scrollbarState(page, selector)).color).toContain(THUMB.light);
  await extension.evaluateInWorker(
    () => chrome.storage.sync.set({ options: { appearance: 'dark' } }),
    undefined
  );
  await expect.poll(async () => (await scrollbarState(page, selector)).color).toContain(THUMB.dark);
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
  expect((await scrollbarState(page, selector)).width).toBe('auto');
  expect((await scrollbarState(page, selector)).color).toBe('auto');
  await page.close();
});
