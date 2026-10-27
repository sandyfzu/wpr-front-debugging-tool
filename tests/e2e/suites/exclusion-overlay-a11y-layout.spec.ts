/**
 * The exclusion builder overlay against the UI bar's §D checks, in the real
 * overlay over a fixture page (both palettes):
 *
 * - D-1: at 320 / 480 / 768 / 1280 px the panel never scrolls sideways, no
 *   descendant overflows it, every control sits inside it, and the page
 *   gains no horizontal scroll (populated editor, page list open).
 * - D-2: the OS palette resolves the overlay's own tokens and follows a live
 *   switch without a reload; under reduced motion nothing in the shadow
 *   root animates after mount nor across a fold/unfold (and it does without
 *   the preference — the check bites).
 * - D-3: a keyboard-only Tab walk reaches every control (held ones included) of the panel
 *   in order, each with a visible focus ring.
 * - D-4: axe reports no violation in each state (editor with notes and a
 *   refused row, applied with counts, unavailable, armed, stopped, page
 *   list open, picking, folded pill); its one unresolved rule, contrast in
 *   the top layer, is measured here instead (every painted text run ≥ AA).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { Page } from '@playwright/test';

import type { ExclusionSet } from '../../../lib/exclusion-builder/set';
import {
  expect,
  openFixturePage,
  ORIGIN_A,
  test,
  type DriverPage,
  type ExtensionDriver
} from '../helpers/extension';
import {
  DEFER,
  DELAY,
  OVERLAY_HOST,
  activeStatus,
  applyButton,
  clearDrafts,
  injectOverlay,
  pushStatus,
  readBanners,
  reloadThroughSession,
  typeRow
} from '../helpers/exclusion-overlay';

/** The dev-time axe source (injected into the page under test, never bundled). */
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8'
);

/** Two scripts served as Delay JavaScript execution delays them. */
const DELAYED = '/exclusion/delayed.html';

/** D-1's checkpoints (the overlay's floor, then the shared tiers and a wide size). */
const WIDTHS = [320, 480, 768, 1280] as const;

/** The pushed sessions' applied set. */
const SET: ExclusionSet = {
  rows: { delayJs: ['jquery-ui'], deferJs: [], lazyload: [], lazyRender: [] },
  disable: { delayJs: false, deferJs: false, lazyRender: false }
};

/**
 * Open the fixture with the palette and motion preference set before the
 * overlay mounts, then inject it.
 */
async function openBuilderWith(
  extension: ExtensionDriver,
  media: Parameters<Page['emulateMedia']>[0]
): Promise<DriverPage> {
  await clearDrafts(extension);
  const opened = await openFixturePage(extension, DELAYED);
  await opened.page.emulateMedia(media);
  await injectOverlay(extension, opened);
  return opened;
}

/** Wait until nothing in the overlay's shadow root is animating (geometry reads come after). */
async function settle(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        (host) =>
          document
            .querySelector(host)
            ?.shadowRoot?.getAnimations()
            .filter((animation) => animation.playState === 'running').length ?? -1,
        OVERLAY_HOST
      )
    )
    .toBe(0);
}

/** Every animation in the overlay's shadow root right now (transitions included). */
async function shadowAnimations(page: Page): Promise<number> {
  return await page.evaluate(
    (host) => document.querySelector(host)?.shadowRoot?.getAnimations().length ?? -1,
    OVERLAY_HOST
  );
}

/** The longest duration (ms) among the shadow root's current animations (0 when none). */
async function longestMotionMs(page: Page): Promise<number> {
  return await page.evaluate(
    (host) =>
      Math.max(
        0,
        ...(document
          .querySelector(host)
          ?.shadowRoot?.getAnimations()
          .map((animation) => Number(animation.effect?.getComputedTiming().duration ?? 0)) ?? [])
      ),
    OVERLAY_HOST
  );
}

/** D-1's layout reading of the open panel. */
interface PanelLayout {
  readonly panelWidth: number;
  readonly scrollers: readonly { name: string; scroll: number; client: number }[];
  /** Descendants whose box pokes out of the panel's sides (class + text). */
  readonly overflowing: readonly string[];
  /** Enabled controls not wholly inside the panel's sides. */
  readonly controlsOutside: readonly string[];
  readonly documentOverflow: number;
}

/** Read the panel's horizontal layout (after {@link settle}). */
async function panelLayout(page: Page): Promise<PanelLayout> {
  return await page.evaluate((host) => {
    const root = document.querySelector(host)?.shadowRoot;
    const panel = root?.querySelector<HTMLElement>('.xo-panel');
    if (panel === null || panel === undefined) throw new Error('the overlay has no panel');
    const box = panel.getBoundingClientRect();
    const label = (element: Element): string =>
      `${element.tagName.toLowerCase()}.${element.className} "${(element.getAttribute('aria-label') ?? element.textContent).trim().slice(0, 40)}"`;
    const scrollers = [panel, ...panel.querySelectorAll<HTMLElement>('*')]
      .filter((element) => {
        const overflowX = getComputedStyle(element).overflowX;
        return element === panel || overflowX === 'auto' || overflowX === 'scroll';
      })
      .map((element) => ({
        name: label(element),
        scroll: element.scrollWidth,
        client: element.clientWidth
      }));
    const overflowing: string[] = [];
    const controlsOutside: string[] = [];
    for (const element of panel.querySelectorAll('*')) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      // Visually hidden words (1 px, clipped) are not laid out content.
      if (getComputedStyle(element).clipPath !== 'none' && rect.width <= 1) continue;
      const outside = rect.left < box.left - 0.5 || rect.right > box.right + 0.5;
      if (outside) overflowing.push(label(element));
      if (outside && element.matches('button, input, [role="switch"], [tabindex="0"]')) {
        controlsOutside.push(label(element));
      }
    }
    return {
      panelWidth: Math.round(box.width),
      scrollers,
      overflowing,
      controlsOutside,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  }, OVERLAY_HOST);
}

/** Run axe over the overlay only (the host page's markup is not ours). */
async function axeOverlay(page: Page): Promise<{ violations: string[]; incomplete: string[] }> {
  await page.evaluate(AXE_SOURCE);
  return await page.evaluate(async (host) => {
    const axe = (
      window as unknown as {
        axe: {
          run: (context: unknown) => Promise<{
            violations: { id: string; nodes: { target: unknown; failureSummary?: string }[] }[];
            incomplete: { id: string }[];
          }>;
        };
      }
    ).axe;
    const result = await axe.run({ include: [[host]] });
    return {
      violations: result.violations.map(
        (rule) =>
          `${rule.id}: ${rule.nodes.map((node) => `${JSON.stringify(node.target)} ${node.failureSummary ?? ''}`).join(' | ')}`
      ),
      incomplete: result.incomplete.map((rule) => rule.id)
    };
  }, OVERLAY_HOST);
}

/** One text run whose contrast is under its WCAG AA floor. */
interface ContrastMiss {
  readonly text: string;
  readonly ratio: number;
  readonly floor: number;
}

/**
 * The backstop for axe's unresolved `color-contrast` (it cannot read
 * backgrounds in the top layer): every rendered text run of the overlay —
 * text nodes and filled inputs — painted over its stacked ancestor fills,
 * against its AA floor (4.5:1, 3:1 for large text). Held (`aria-disabled`)
 * controls are inactive UI, exempt as WCAG 1.4.3 says.
 *
 * @returns The runs under their floor, and how many were measured.
 */
async function contrastMisses(page: Page): Promise<{ measured: number; misses: ContrastMiss[] }> {
  return await page.evaluate((host) => {
    const root = document.querySelector(host)?.shadowRoot;
    if (root === undefined || root === null) throw new Error('the overlay has no shadow root');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('no 2d context');
    const paint = (layers: string[]): number[] => {
      context.clearRect(0, 0, 1, 1);
      for (const layer of layers) {
        context.fillStyle = layer;
        context.fillRect(0, 0, 1, 1);
      }
      return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
    };
    const luminance = (rgb: number[]): number => {
      const [r = 0, g = 0, b = 0] = rgb.map((value) => {
        const channel = value / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const holders = new Set<Element>();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if ((node.textContent ?? '').trim() !== '' && node.parentElement !== null) {
        holders.add(node.parentElement);
      }
    }
    for (const input of root.querySelectorAll('input')) if (input.value !== '') holders.add(input);
    const misses: { text: string; ratio: number; floor: number }[] = [];
    let measured = 0;
    for (const element of holders) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      // Not painted: hidden, folded away, or visually hidden words (1 px, clipped).
      if (rect.width <= 1 || rect.height <= 1 || style.visibility !== 'visible') continue;
      if (element.closest('[aria-disabled="true"], [inert], [aria-hidden="true"] svg') !== null)
        continue;
      const fills: string[] = [];
      for (
        let node: Element | null = element;
        node !== null;
        node =
          node.parentElement ??
          (node.parentNode instanceof ShadowRoot ? node.parentNode.host : null)
      ) {
        fills.unshift(getComputedStyle(node).backgroundColor);
      }
      const layers = ['#fff', ...fills];
      const [light = 0, dark = 0] = [
        luminance(paint([...layers, style.color])),
        luminance(paint(layers))
      ].sort((a, b) => b - a);
      const ratio = Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
      const size = Number.parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      const floor = large ? 3 : 4.5;
      measured += 1;
      if (ratio < floor) {
        const text = element instanceof HTMLInputElement ? element.value : element.textContent;
        misses.push({ text: text.trim().slice(0, 60), ratio, floor });
      }
    }
    return { measured, misses };
  }, OVERLAY_HOST);
}

/** The focused element inside the overlay: its name and whether a 2 px+ ring shows. */
async function focusedControl(
  page: Page
): Promise<{ inside: boolean; name: string; ring: boolean } | null> {
  return await page.evaluate((host) => {
    const shadowHost = document.querySelector(host);
    const active = shadowHost?.shadowRoot?.activeElement;
    if (document.activeElement !== shadowHost || active === null || active === undefined) {
      return { inside: false, name: '', ring: false };
    }
    const style = getComputedStyle(active);
    // The overlay's ring is a 2 px accent outline (`:focus-visible`), never transparent.
    const ring =
      style.outlineStyle === 'solid' &&
      Number.parseFloat(style.outlineWidth) >= 2 &&
      !/^rgba\(.*,\s*0\)$|transparent/.test(style.outlineColor);
    const name = (active.getAttribute('aria-label') ?? active.textContent).trim();
    return { inside: true, name: `${active.tagName.toLowerCase()} ${name}`, ring };
  }, OVERLAY_HOST);
}

/** Every focusable, rendered control of the panel, in DOM order (the walk's expectation). */
async function panelControls(page: Page): Promise<string[]> {
  return await page.evaluate((host) => {
    const panel = document.querySelector(host)?.shadowRoot?.querySelector('.xo-panel');
    return Array.from(
      panel?.querySelectorAll<HTMLElement>('button, input, [role="switch"], [tabindex="0"]') ?? []
    )
      .filter(
        (element) =>
          // Held controls stay reachable (`aria-disabled`, never `disabled`): their title says why.
          element.tabIndex >= 0 &&
          !(element as HTMLButtonElement).disabled &&
          element.getClientRects().length > 0 &&
          element.closest('[inert]') === null
      )
      .map(
        (element) =>
          `${element.tagName.toLowerCase()} ${(element.getAttribute('aria-label') ?? element.textContent).trim()}`
      );
  }, OVERLAY_HOST);
}

/**
 * Compose the populated editor: a stored-form note and a long no-match row,
 * plus (unless `refused` is false) a row the preview refuses.
 */
async function populate(page: Page, refused = true): Promise<void> {
  await typeRow(page, DELAY, 'jquery-*.js');
  await page.keyboard.press('Enter');
  await page.keyboard.type('wp-content/plugins/a-plugin-with-a-rather-long-folder-name/assets/');
  if (refused) await typeRow(page, DEFER, '(a+)+$');
  await page.keyboard.press('Tab');
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`exclusion builder overlay §D (${colorScheme})`, () => {
    test(`D-1: no sideways scroll, every control inside, at ${WIDTHS.join('/')} px`, async ({
      extension
    }) => {
      const { page } = await openBuilderWith(extension, { colorScheme, reducedMotion: 'reduce' });
      await populate(page);
      await page.getByRole('button', { name: /^On this page/ }).click();
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await settle(page);
        const layout = await panelLayout(page);
        const at = `${colorScheme} ${String(width)} px`;
        console.log(`[layout] ${at} panel ${String(layout.panelWidth)} px`);
        expect(layout.panelWidth, at).toBeLessThanOrEqual(width);
        for (const scroller of layout.scrollers) {
          expect(scroller.scroll, `${at} ${scroller.name}`).toBe(scroller.client);
        }
        expect(layout.overflowing, at).toEqual([]);
        expect(layout.controlsOutside, at).toEqual([]);
        expect(layout.documentOverflow, at).toBe(0);
      }
      await page.close();
    });

    test('D-3: a Tab walk reaches every control in order, each with a visible ring', async ({
      extension
    }) => {
      const { page } = await openBuilderWith(extension, { colorScheme, reducedMotion: 'reduce' });
      await populate(page, false);
      expect(await reloadThroughSession(page, () => applyButton(page).click())).not.toBe('');
      await page.getByRole('heading', { name: 'Exclusion builder' }).focus();
      const expected = await panelControls(page);
      const visited: string[] = [];
      for (let step = 0; step < expected.length + 5; step += 1) {
        await page.keyboard.press('Tab');
        const focused = await focusedControl(page);
        if (focused === null || !focused.inside) break;
        expect(focused.ring, `ring on ${focused.name}`).toBe(true);
        visited.push(focused.name);
        if (visited.length === expected.length) break;
      }
      expect(visited).toEqual(expected);
      await page.getByRole('button', { name: 'Stop' }).click();
      await page.close();
    });

    test('D-4: axe finds no violation in any state', async ({ extension }) => {
      const { page, tabId } = await openBuilderWith(extension, {
        colorScheme,
        reducedMotion: 'reduce'
      });
      const audit = async (state: string): Promise<void> => {
        await settle(page);
        const result = await axeOverlay(page);
        console.log(`[axe] ${colorScheme} ${state} ${JSON.stringify(result)}`);
        expect(result.violations, `${colorScheme} ${state}`).toEqual([]);
        // axe cannot resolve backgrounds in the top layer: contrast stays
        // unresolved there, nothing else may.
        expect(
          result.incomplete.filter((id) => id !== 'color-contrast'),
          `${colorScheme} ${state}`
        ).toEqual([]);
        const contrast = await contrastMisses(page);
        console.log(`[contrast] ${colorScheme} ${state} measured ${String(contrast.measured)}`);
        expect(contrast.measured, `${colorScheme} ${state}`).toBeGreaterThan(0);
        expect(contrast.misses, `${colorScheme} ${state}`).toEqual([]);
      };
      await audit('empty editor');
      await populate(page);
      await applyButton(page).click();
      await expect.poll(async () => (await readBanners(page))[0]?.title).toMatch(/^Fix 1 row/);
      await audit('notes + refused row');
      await page.getByRole('button', { name: /^On this page/ }).click();
      await audit('page list open');
      await page.getByRole('button', { name: 'Pick on page' }).click();
      await expect(page.getByRole('group', { name: 'Picking on the page' })).toBeVisible();
      await audit('picking');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: `Remove ${DEFER} row 1` }).click();
      expect(await reloadThroughSession(page, () => applyButton(page).click())).toBe(
        'Applied · no-match rows'
      );
      await audit('applied with counts');
      await page.getByRole('button', { name: 'Stop' }).click();
      await expect.poll(async () => (await readBanners(page))[0]?.title).toBe('Session stopped');
      await audit('stopped');
      await pushStatus(extension, tabId, activeStatus(ORIGIN_A, SET, null));
      await expect
        .poll(async () => (await readBanners(page))[0]?.title)
        .toBe('Applied — waiting for the page');
      await audit('armed');
      await pushStatus(extension, tabId, {
        state: 'unavailable',
        cause: 'attach-denied',
        at: Date.now()
      });
      await expect.poll(async () => (await readBanners(page))[0]?.glyph).toBe('lucide-ban');
      await audit('unavailable');
      await page.keyboard.press('Escape');
      await audit('folded pill');
      await page.close();
    });
  });
}

test.describe('exclusion builder overlay §D-2 (palette + motion)', () => {
  test('the OS palette resolves the overlay tokens and follows a live switch', async ({
    extension
  }) => {
    const { page } = await openBuilderWith(extension, { colorScheme: 'light' });
    /** The panel's resolved background and text (the token pair the palette sets). */
    const surface = (): Promise<{ background: string; text: string }> =>
      page.evaluate((host) => {
        const panel = document.querySelector(host)?.shadowRoot?.querySelector('.xo-panel');
        if (panel === null || panel === undefined) throw new Error('the overlay has no panel');
        const style = getComputedStyle(panel);
        return { background: style.backgroundColor, text: style.color };
      }, OVERLAY_HOST);
    /** Relative luminance of an `rgb()`/`rgba()`/`color(srgb …)` value. */
    const luminance = (color: string): number => {
      const parts = (color.match(/[\d.]+/g) ?? []).map(Number);
      const scale = color.startsWith('color(') ? 1 : 255;
      const [r = 0, g = 0, b = 0] = parts.map((part) => {
        const channel = part / scale;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    await settle(page);
    const light = await surface();
    expect(luminance(light.background)).toBeGreaterThan(luminance(light.text));
    await page.evaluate(() => {
      (window as unknown as { e2eSameDocument: boolean }).e2eSameDocument = true;
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect
      .poll(async () => {
        const dark = await surface();
        return luminance(dark.background) < luminance(dark.text);
      })
      .toBe(true);
    // Live: the same document, no reload, no remount.
    expect(await page.evaluate(() => 'e2eSameDocument' in window)).toBe(true);
    await page.close();
  });

  test('reduced motion: nothing moves after mount or across fold/unfold; without it the fold animates', async ({
    extension
  }) => {
    const reduced = await openBuilderWith(extension, { reducedMotion: 'reduce' });
    // The reset collapses every transition to a frame (≤ 0.01 ms), and then nothing runs.
    const motionless = async (at: string): Promise<void> => {
      expect(await longestMotionMs(reduced.page), at).toBeLessThanOrEqual(0.01);
      await expect.poll(() => shadowAnimations(reduced.page), at).toBe(0);
    };
    await motionless('after mount');
    await reduced.page.keyboard.press('Escape');
    await expect(
      reduced.page.getByRole('button', { name: /open the exclusion builder$/ })
    ).toBeFocused();
    await motionless('folded');
    await reduced.page.keyboard.press('Enter');
    await expect(reduced.page.getByRole('heading', { name: 'Exclusion builder' })).toBeFocused();
    await motionless('unfolded');
    await reduced.page.close();

    // Control: with motion allowed, the same fold runs its transitions on the motion tokens.
    const moving = await openBuilderWith(extension, { reducedMotion: 'no-preference' });
    await settle(moving.page);
    await moving.page.keyboard.press('Escape');
    await expect.poll(() => longestMotionMs(moving.page)).toBeGreaterThan(50);
    await moving.page.close();
  });
});
