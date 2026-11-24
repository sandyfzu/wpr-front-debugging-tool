/**
 * Hostile host CSS against the injected surfaces the detection-widget suite
 * does not cover (that suite pins the strip): the on-page command palette,
 * the Exclusion Builder overlay and the Side-by-Side overlay. Each surface is
 * opened, its shadow host and every shadow part snapshotted (all computed
 * properties plus box sizes), then a reset-plus-high-specificity sheet is
 * added to the page — the universal `all: unset`, host-tag targets, a root
 * font-size change (rem sizes would follow it) and token-name overrides —
 * and the snapshot must be identical. The palette leg also pins that a
 * page's declaration-less `style` attribute on `<body>` survives open/close
 * (the dialog library's close removes such an attribute; the dialog wrapper
 * puts it back).
 *
 * The hostile sheet keeps the viewport size fixed (`html { overflow: hidden }`):
 * its huge fonts would otherwise add a classic scrollbar, and a
 * viewport-sized surface would change size for that reason alone — layout
 * the page owns, not style leakage. Positions resolved against the viewport
 * (`top`/`left`/… ) are left out for the same reason; sizes stay in, except
 * the frame container's own box (an in-flow child of the inline host, sized
 * by the page's flow — the surface inside is fixed or in the top layer).
 * Custom properties are compared through the real properties they feed: a
 * page value inherited by an element that never reads it renders nothing.
 */
import type { Page } from '@playwright/test';

import { injectOverlay, OVERLAY_HOST, clearDrafts } from '../helpers/exclusion-overlay';
import { expect, openFixturePage, test, type ExtensionDriver } from '../helpers/extension';

/** The palette view's shadow host and its field. */
const PALETTE_HOST = 'wpr-fdt-command-palette';
/** The Side-by-Side overlay's shadow host. */
const SBS_HOST = 'wpr-fdt-side-by-side';
/** Generous mount wait (views are injected on demand). */
const MOUNT = { timeout: 15_000 };

/** The hostile sheet: every host tag under test named, plus the universal reset. */
const HOSTILE_CSS = `
  *, *::before, *::after { all: unset !important; font: 31px/3 serif !important;
    color: rgb(255, 0, 0) !important; background: rgb(0, 255, 0) !important;
    border: 5px solid rgb(0, 0, 255) !important; padding: 13px !important;
    margin: 11px !important; letter-spacing: 3px !important;
    cursor: crosshair !important; transition: all 9s !important;
    box-sizing: content-box !important; }
  ${PALETTE_HOST}, ${OVERLAY_HOST}, ${SBS_HOST},
  html body ${PALETTE_HOST}, html > ${PALETTE_HOST}[style], html > ${OVERLAY_HOST}[style] {
    display: block !important; position: static !important; opacity: 0.1 !important;
    z-index: -1 !important; width: 10px !important; height: 10px !important;
    filter: blur(4px) !important; transform: scale(0.2) !important;
    --surface-2: red; --fg-primary: red; --font-mono: serif; --motion-slow: 9s;
    --scrollbar-thumb: red; --xo-gutter: 300px; }
  button, input, section, div, dialog, [popover] { display: none !important; }
  :root { font-size: 40px !important; --surface-2: red; --fg-primary: red; --scrim: red; }
  html { overflow: hidden !important; }
`;

/**
 * Every computed property of the shadow host's stacking/visibility set and of
 * each shadow element (in document order), with their box sizes, once the
 * surface's animations have finished. The pointer rests off the surface
 * first (`:hover` is state, not leakage).
 *
 * @param page The page holding the surface.
 * @param host The surface's shadow host tag.
 * @throws {@link Error} when the host or its open shadow root is missing.
 */
async function surfaceSnapshot(page: Page, host: string): Promise<Record<string, string>> {
  await page.mouse.move(1, 1);
  await expect
    .poll(() =>
      page.evaluate(
        (tag: string) =>
          document
            .querySelector(tag)
            ?.shadowRoot?.getAnimations()
            .filter((animation) => animation.playState === 'running').length ?? -1,
        host
      )
    )
    .toBe(0);
  return await page.evaluate((tag: string) => {
    const hostElement = document.querySelector(tag);
    const root = hostElement?.shadowRoot ?? null;
    if (hostElement === null || root === null) throw new Error(`${tag} is missing`);
    const hostStyle = getComputedStyle(hostElement);
    const hostProps = [
      'opacity',
      'display',
      'visibility',
      'filter',
      'transform',
      'z-index',
      'position',
      'mix-blend-mode',
      'isolation',
      'pointer-events',
      'clip-path',
      'width',
      'height'
    ].map((name) => `${name}=${hostStyle.getPropertyValue(name)}`);
    const viewportResolved = new Set([
      'top',
      'left',
      'right',
      'bottom',
      'inset-block-start',
      'inset-block-end',
      'inset-inline-start',
      'inset-inline-end'
    ]);
    // The frame's own box (the container, an in-flow child of the inline
    // host) follows the page's flow; the surface inside is fixed/top-layer.
    const frameBox = new Set([
      'width',
      'height',
      'inline-size',
      'block-size',
      'transform-origin',
      'perspective-origin'
    ]);
    const flat: Record<string, string> = {};
    for (const entry of hostProps) flat[`host ${entry}`] = '';
    Array.from(root.querySelectorAll('*')).forEach((element, index) => {
      // Never rendered: the injected stylesheet element.
      if (element.localName === 'style') return;
      const frame = element.parentNode === root;
      const part = `${String(index)}:${element.localName}.${element.getAttribute('class') ?? ''}`;
      const style = getComputedStyle(element);
      for (const name of Array.from(style)) {
        // Custom properties count only through the real properties they feed.
        if (name.startsWith('--') || viewportResolved.has(name)) continue;
        if (frame && frameBox.has(name)) continue;
        flat[`${part} ${name}`] = style.getPropertyValue(name);
      }
      if (frame) return;
      const rect = element.getBoundingClientRect();
      flat[`${part} (size)`] =
        `${String(Math.round(rect.width))}x${String(Math.round(rect.height))}`;
    });
    return flat;
  }, host);
}

/**
 * Snapshot the open surface, add the hostile sheet, snapshot again and
 * compare; the sheet is removed afterwards.
 *
 * @param page The page holding the open surface.
 * @param host The surface's shadow host tag.
 * @param label The surface's name, for the assertion message.
 */
async function expectImmune(page: Page, host: string, label: string): Promise<void> {
  const before = await surfaceSnapshot(page, host);
  const sheet = await page.addStyleTag({ content: HOSTILE_CSS });
  try {
    const after = await surfaceSnapshot(page, host);
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((key) => before[key] !== after[key])
      .map((key) => `${key}: ${before[key] ?? '(none)'} → ${after[key] ?? '(none)'}`);
    expect(changed, `${label} is identical under hostile CSS`).toEqual([]);
  } finally {
    await sheet.evaluate((element) => {
      (element as Element).remove();
    });
  }
}

/** Open the palette through the background's menu row and wait for its armed field. */
async function openPalette(extension: ExtensionDriver, page: Page, tabId: number): Promise<void> {
  expect(await extension.sendToTab<boolean>(tabId, 'openCommandPalette')).toBe(true);
  await expect(page.locator(`${PALETTE_HOST} [data-fdt="palette-input"]`)).toBeFocused(MOUNT);
}

test.describe('injected surfaces under hostile host CSS', () => {
  test('the command palette is immune, and keeps a body style attribute with no declarations', async ({
    extension
  }) => {
    const { page, tabId } = await openFixturePage(extension, '/palette/hotkeys.html');
    try {
      // `style=" "` — no declaration the CSSOM counts: the case the dialog
      // library's close would remove.
      await page.evaluate(() => {
        document.body.setAttribute('style', ' ');
      });
      await openPalette(extension, page, tabId);
      await expectImmune(page, PALETTE_HOST, 'the open palette');
      await page.keyboard.press('Escape');
      await expect(page.locator(`${PALETTE_HOST} [data-fdt="palette-input"]`)).toHaveCount(0);
      await openPalette(extension, page, tabId);
      await page.mouse.click(10, 700);
      await expect(page.locator(`${PALETTE_HOST} [data-fdt="palette-input"]`)).toHaveCount(0);
      expect(
        await page.evaluate(() => document.body.getAttribute('style')),
        'the page body keeps its own style attribute across open/close'
      ).toBe(' ');
    } finally {
      await page.close();
    }
  });

  test('the Exclusion Builder overlay is immune', async ({ extension }) => {
    await clearDrafts(extension);
    const opened = await openFixturePage(extension, '/palette/hotkeys.html');
    try {
      await injectOverlay(extension, opened);
      await expectImmune(opened.page, OVERLAY_HOST, 'the open builder');
    } finally {
      await opened.page.close();
    }
  });

  test('the Side-by-Side overlay is immune', async ({ extension }) => {
    const { page, tabId } = await openFixturePage(extension, '/side-by-side.html');
    try {
      expect(await extension.sendToTab<boolean>(tabId, 'openSideBySide')).toBe(true);
      await expect(page.locator(`${SBS_HOST} .sbs-overlay.sbs-overlay--open`)).toHaveCount(
        1,
        MOUNT
      );
      await expectImmune(page, SBS_HOST, 'the open Side-by-Side overlay');
    } finally {
      await page.close();
    }
  });
});
