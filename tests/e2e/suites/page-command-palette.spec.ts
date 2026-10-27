/**
 * The on-page command palette (P19B), opened the way the context menu will:
 * the background's `openCommandPalette` row sent from the service worker to
 * the fixture tab (native menus are not Playwright-reachable).
 *
 * - Open: the view loads on demand (not in the page before the first open),
 *   sits in the top layer with focus in its field, writes nothing into the
 *   host document (no body, head or <html> write across open, typing, moves, close and
 *   gate-off), and keeps typed keys from the page's window-capture
 *   hotkeys; Escape / Tab / an outside click dismiss, focus returns to the
 *   page control; a re-open is a fresh surface.
 * - Rows run their shipped mechanisms: the detection-widget toggle writes
 *   the per-origin entry, Side-by-Side opens its overlay, the builder opens
 *   its overlay — and a later open paints above it (top-layer order).
 * - Gate-off from the palette: the inline confirm (Cancel focused), then the
 *   gate is stored off, the view leaves the page, the notice names the way
 *   back, and the receiver is gone (the menu send finds no receiver); a
 *   gate-on write re-arms it.
 * - D-1 at 320 / 480 / 768 / 1280 px (no horizontal scroll), D-2 palettes +
 *   reduced motion (no animation after mount), D-4 axe per state over the
 *   palette and notice hosts only.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { Locator, Page } from '@playwright/test';

import { expect, openFixturePage, test, type ExtensionDriver } from '../helpers/extension';

/** The dev-time axe source (injected into the page under test, never bundled). */
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8'
);

/** The fixture: a page with window-capture hotkeys and one focusable control. */
const FIXTURE = '/palette/hotkeys.html';
/** The view's and the notice's shadow hosts. */
const PALETTE_HOST = 'wpr-fdt-command-palette';
const NOTICE_HOST = 'wpr-fdt-page-notice';
/** The two storage keys the suite drives (sync area). */
const GATE_KEY = 'page-ui-gate';
const ORIGINS_KEY = 'inspector-origins';
/** Generous mount wait (the view is injected on demand). */
const MOUNT = { timeout: 10_000 };

const field = (page: Page): Locator => page.locator(`${PALETTE_HOST} [data-fdt="palette-input"]`);
const rows = (page: Page): Locator => page.locator(`${PALETTE_HOST} [data-fdt="palette-command"]`);

/** Send the menu's open row; resolves the reply or the no-receiver error text. */
async function sendOpen(extension: ExtensionDriver, tabId: number): Promise<string> {
  try {
    return String(await extension.sendToTab<boolean>(tabId, 'openCommandPalette'));
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

/** Open the palette and wait for its armed field. */
async function openPalette(extension: ExtensionDriver, page: Page, tabId: number): Promise<void> {
  expect(await sendOpen(extension, tabId)).toBe('true');
  await expect(field(page)).toBeFocused(MOUNT);
  await expect(field(page)).toHaveAttribute('aria-activedescendant', /.+/);
}

/** Reset the two storage items the suite writes. */
async function resetStorage(extension: ExtensionDriver): Promise<void> {
  await extension.evaluateInWorker(
    (keys: string[]) => chrome.storage.sync.remove(keys),
    [GATE_KEY, ORIGINS_KEY]
  );
}

/** Run axe over the given hosts only (the fixture's markup is not ours). */
async function axeHosts(page: Page, hosts: readonly string[]): Promise<string[]> {
  await page.evaluate(AXE_SOURCE);
  return await page.evaluate(async (include) => {
    const axe = (
      window as unknown as {
        axe: {
          run: (context: unknown) => Promise<{
            violations: { id: string; nodes: { target: unknown }[] }[];
          }>;
        };
      }
    ).axe;
    const present = include.filter((host) => document.querySelector(host) !== null);
    if (present.length === 0) return ['no host to audit'];
    const result = await axe.run({ include: present.map((host) => [host]) });
    return result.violations.map(
      (rule) => `${rule.id}: ${rule.nodes.map((node) => JSON.stringify(node.target)).join(' | ')}`
    );
  }, hosts);
}

test.describe('on-page command palette', () => {
  test.beforeEach(async ({ extension }) => {
    await resetStorage(extension);
  });

  test('opens on demand, isolated from the page, and dismisses three ways', async ({
    extension
  }) => {
    const { page, tabId } = await openFixturePage(extension, FIXTURE);
    // Lazy: nothing of the view exists before the first open.
    await expect(page.locator(PALETTE_HOST)).toHaveCount(0);
    await page.focus('#page-focus');
    await openPalette(extension, page, tabId);

    await expect(rows(page)).toHaveText([
      'Open Side By Side',
      'Open Side By Side Performance',
      'Toggle the detection widget on this site',
      'Exclusion Builder',
      'Turn off all on-page UI'
    ]);
    expect(
      await page.locator(`${PALETTE_HOST} .cp-layer`).evaluate((el) => el.matches(':popover-open')),
      'the view sits in the top layer'
    ).toBe(true);
    // Non-modal toward the host: nothing written into the page.
    expect(
      await page.evaluate(() => [
        document.body.getAttribute('aria-hidden'),
        document.body.getAttribute('style'),
        document.documentElement.getAttribute('style'),
        document.querySelector('main')?.getAttribute('aria-hidden') ?? null
      ])
    ).toEqual([null, null, null, null]);

    // Typed keys never reach the page's window-capture hotkeys.
    await page.evaluate(() => {
      (window as unknown as { __pageKeys: string[] }).__pageKeys = [];
    });
    await page.keyboard.type('toggle');
    await expect(field(page)).toHaveValue('toggle');
    await expect(rows(page)).toHaveText(['Toggle the detection widget on this site']);
    expect(
      await page.evaluate(() => (window as unknown as { __pageKeys: string[] }).__pageKeys)
    ).toEqual([]);

    // Escape: closed, focus back on the page control.
    await page.keyboard.press('Escape');
    await expect(field(page)).toHaveCount(0);
    await expect(page.locator('#page-focus')).toBeFocused();

    // A re-open is a fresh surface; an outside click dismisses.
    await openPalette(extension, page, tabId);
    await expect(field(page)).toHaveValue('');
    await page.mouse.click(10, 700);
    await expect(field(page)).toHaveCount(0);

    // Tab dismisses too (the field is the palette's only stop).
    await openPalette(extension, page, tabId);
    await page.keyboard.press('Tab');
    await expect(field(page)).toHaveCount(0);
    await page.close();
  });

  test('never writes into the host document (open, typing, moves, close, gate-off)', async ({
    extension
  }) => {
    const { page, tabId } = await openFixturePage(extension, FIXTURE);
    // Record every host-document write from now on: the body and head
    // subtrees (children, attributes, text), <html>'s attributes and its
    // direct children. Sanctioned:
    // our own `wpr-fdt-*` hosts inserted/removed as direct <html> children
    // (palette, notice), and the detection widget's host `wpr-fdt-inspector`
    // (a sibling surface, mounted on its own schedule) as a body child.
    const bodyChildrenBefore = await page.evaluate(() => {
      const scope = window as unknown as { __hostWrites: string[] };
      scope.__hostWrites = [];
      const html = document.documentElement;
      const isHtmlHost = (node: Node): boolean =>
        node instanceof Element && node.localName.startsWith('wpr-fdt-');
      const isBodyHost = (node: Node): boolean =>
        node instanceof Element && node.localName === 'wpr-fdt-inspector';
      /** Whether a record only adds/removes our sanctioned hosts at its level. */
      const sanctioned = (record: MutationRecord): boolean => {
        if (record.type !== 'childList') return false;
        const touched = [...record.addedNodes, ...record.removedNodes];
        if (touched.length === 0) return false;
        if (record.target === html) return touched.every(isHtmlHost);
        if (record.target === document.body) return touched.every(isBodyHost);
        return false;
      };
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (sanctioned(record)) continue;
          const names = [...record.addedNodes, ...record.removedNodes]
            .map((node) => node.nodeName)
            .join(',');
          const attribute = record.attributeName === null ? '' : `[${record.attributeName}]`;
          scope.__hostWrites.push(
            `${record.type}${attribute} on ${record.target.nodeName} ${names}`
          );
        }
      });
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true
      });
      observer.observe(document.head, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true
      });
      // <html> itself: its attributes and direct children (not the subtrees).
      observer.observe(html, { childList: true, attributes: true });
      return [...document.body.children].filter((child) => !isBodyHost(child)).length;
    });

    await openPalette(extension, page, tabId);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.type('side');
    await page.keyboard.type('zzz');
    await expect(page.locator(`${PALETTE_HOST} [data-fdt="palette-empty"]`)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(field(page)).toHaveCount(0);

    // Gate-off from the palette (confirm, notice, teardown) writes nothing into the host document either.
    await openPalette(extension, page, tabId);
    await page.keyboard.type('turn off');
    await page.keyboard.press('Enter');
    await page.locator(`${PALETTE_HOST} [data-fdt="palette-confirm-action"]`).click();
    await expect(page.locator(PALETTE_HOST)).toHaveCount(0, MOUNT);
    await expect(page.locator(`${NOTICE_HOST} [data-fdt="page-notice"]`)).toBeVisible(MOUNT);

    expect(
      await page.evaluate(() => ({
        writes: (window as unknown as { __hostWrites: string[] }).__hostWrites,
        children: [...document.body.children].filter(
          (child) => child.localName !== 'wpr-fdt-inspector'
        ).length,
        announcers: document.querySelectorAll('[data-live-announcer]').length
      }))
    ).toEqual({ writes: [], children: bodyChildrenBefore, announcers: 0 });
    await page.close();
  });

  test('rows run the shipped mechanisms; the palette paints above the builder', async ({
    extension
  }) => {
    const { page, tabId } = await openFixturePage(extension, FIXTURE);
    const origin = new URL(page.url()).origin;

    await openPalette(extension, page, tabId);
    await page.keyboard.type('detection widget');
    await expect(rows(page)).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect
      .poll(() =>
        extension.evaluateInWorker(
          (key: string) => chrome.storage.sync.get([key]).then((stored) => stored[key]),
          ORIGINS_KEY
        )
      )
      .toEqual({ [origin]: { enabled: false } });

    await openPalette(extension, page, tabId);
    await page.keyboard.type('exclusion');
    await page.keyboard.press('Enter');
    await expect(page.locator('wpr-fdt-exclusion-builder')).toHaveCount(1, MOUNT);
    // Opened at once: the builder's first-frame focus move yields to the palette.

    // Re-shown on open: the palette is the newest top-layer entry.
    await openPalette(extension, page, tabId);
    // A point inside the builder's docked panel: the palette's scrim covers it.
    const overBuilder = await page.evaluate(() => {
      const hit = document.elementFromPoint(window.innerWidth - 100, 300);
      return hit?.localName ?? null;
    });
    expect(overBuilder, 'the palette paints over the builder').toBe(PALETTE_HOST);
    await page.keyboard.press('Escape');

    await openPalette(extension, page, tabId);
    await page.keyboard.type('side by side');
    await page.keyboard.press('Enter');
    await expect(page.locator('wpr-fdt-side-by-side .sbs-overlay--open')).toHaveCount(1, MOUNT);
    await page.close();
  });

  test('turning on-page UI off from the palette confirms, notices and tears down', async ({
    extension
  }) => {
    const { page, tabId } = await openFixturePage(extension, FIXTURE);
    await openPalette(extension, page, tabId);
    await page.keyboard.type('turn off');
    await expect(rows(page)).toHaveCount(1);
    await page.keyboard.press('Enter');

    const cancel = page.locator(`${PALETTE_HOST} [data-fdt="palette-confirm-cancel"]`);
    await expect(cancel).toBeFocused(MOUNT);
    await expect(page.locator(`${PALETTE_HOST} [data-fdt="dialog"]`)).toContainText(
      'This also turns off this command palette. Turn it back on from the page’s right-click menu (“Turn on all on-page UI”) or the extension’s options (“Show on-page UI”).'
    );
    expect(await axeHosts(page, [PALETTE_HOST]), 'axe: confirm').toEqual([]);

    await page.locator(`${PALETTE_HOST} [data-fdt="palette-confirm-action"]`).click();
    await expect
      .poll(() =>
        extension.evaluateInWorker(
          (key: string) => chrome.storage.sync.get([key]).then((stored) => stored[key]),
          GATE_KEY
        )
      )
      .toBe(false);
    await expect(page.locator(PALETTE_HOST)).toHaveCount(0);
    const notice = page.locator(`${NOTICE_HOST} [data-fdt="page-notice"]`);
    await expect(notice).toContainText('On-page UI is off', MOUNT);
    await expect(notice).toContainText('Turn on all on-page UI');
    expect(await axeHosts(page, [NOTICE_HOST]), 'axe: notice').toEqual([]);

    // The receiver died with the gate: the menu's send finds no receiver.
    expect(await sendOpen(extension, tabId)).not.toBe('true');

    // Gate on re-arms it (no reload).
    await extension.evaluateInWorker(
      (key: string) => chrome.storage.sync.set({ [key]: true }),
      GATE_KEY
    );
    await expect.poll(() => sendOpen(extension, tabId)).toBe('true');
    await expect(field(page)).toBeFocused(MOUNT);
    await page.close();
  });

  test('§D: widths, palettes, reduced motion and axe per state', async ({ extension }) => {
    const { page, tabId } = await openFixturePage(extension, FIXTURE);
    for (const width of [320, 480, 768, 1280]) {
      await page.setViewportSize({ width, height: 700 });
      await openPalette(extension, page, tabId);
      const fit = await page.locator(`${PALETTE_HOST} [data-fdt="dialog"]`).evaluate((dialog) => {
        const box = dialog.getBoundingClientRect();
        return {
          inside: box.left >= 0 && box.right <= window.innerWidth,
          noScroll: dialog.scrollWidth <= dialog.clientWidth,
          pageNoScroll: document.documentElement.scrollWidth <= window.innerWidth
        };
      });
      expect(fit, `D-1 at ${String(width)} px`).toEqual({
        inside: true,
        noScroll: true,
        pageNoScroll: true
      });
      await page.keyboard.press('Escape');
    }

    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await openPalette(extension, page, tabId);
      expect(await axeHosts(page, [PALETTE_HOST]), `axe: open (${colorScheme})`).toEqual([]);
      await page.keyboard.type('zzz');
      await expect(page.locator(`${PALETTE_HOST} [data-fdt="palette-empty"]`)).toBeVisible();
      expect(await axeHosts(page, [PALETTE_HOST]), `axe: empty (${colorScheme})`).toEqual([]);
      await page.keyboard.press('Escape');
    }

    // D-2: nothing animates after mount under reduced motion — and the check bites without it.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openPalette(extension, page, tabId);
    // Reduced motion collapses transitions to 0.01 ms rather than removing
    // them, and a collapsed transition can chain for a few frames (an inherited
    // color reaches a child a frame later): sample ten frames — every
    // animation seen is a collapsed one, and the last four frames have none.
    const motion = await page.locator(PALETTE_HOST).evaluate(async (host) => {
      const frame = (): Promise<void> =>
        new Promise((resolve) => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      let longest = 0;
      const counts: number[] = [];
      for (let i = 0; i < 10; i += 1) {
        const animations = host.shadowRoot?.getAnimations() ?? [];
        counts.push(animations.length);
        for (const animation of animations)
          longest = Math.max(longest, Number(animation.effect?.getComputedTiming().duration ?? 0));
        await frame();
      }
      return { longest, settled: counts.slice(-4).every((count) => count === 0) };
    });
    expect(motion.longest).toBeLessThanOrEqual(0.01);
    expect(motion.settled).toBe(true);
    await page.keyboard.press('Escape');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await sendOpen(extension, tabId)).toBe('true');
    await expect(field(page)).toHaveCount(1, MOUNT);
    expect(
      await page
        .locator(PALETTE_HOST)
        .evaluate((host) => host.shadowRoot?.getAnimations().length ?? -1)
    ).toBeGreaterThan(0);
    await page.close();
  });
});
