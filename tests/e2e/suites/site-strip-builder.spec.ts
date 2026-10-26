/**
 * The Exclusion Builder on the on-page strip, in real Chromium, over the
 * docker site's real `/fdt/` markup carrying a marker the real writer put
 * there (as a rewritten document does): Delay JS off, Defer JS off for the
 * page, LazyLoad rows excluded.
 *
 * The open card carries the tab-level "Exclusion Builder rewrote this page"
 * line (visible title + hints, dots drawn in a clipped gutter and never
 * spoken; the dialog's description, so keyboard opening announces it) and
 * each changed row's modifier (badge with icon + visible sentence). Checked
 * at 320/480/768/1280 px in both palettes with reduced motion: no
 * horizontal scroll, AA contrast from computed colours, keyboard reach,
 * strict axe over the strip. Freshness: the line follows the displayed
 * document — kept on a re-read of the rewritten page (Stop does not
 * reload), gone once a reload serves the page without the marker.
 *
 * Each case serves the real `/fdt/` HTML (fetched read-only) through a route
 * on a unique site URL — the site itself is never changed.
 *
 * Set `FDT_SHOTS_DIR` to save a card screenshot per palette × width there.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { writeBuilderMarker } from '../../../lib/exclusion-builder/builder-marker-write';
import { BUILDER_MARKER_META_NAME } from '../../../lib/wp-rocket/constants';
import { expect, test, type ExtensionDriver } from '../helpers/extension';
import { openSitePage, SITE_ORIGIN, SITE_URL } from '../helpers/site';

/** The widget's shadow-root host. */
const STRIP_HOST = 'wpr-fdt-inspector';

/** The WXT storage key under `chrome.storage.sync` for the per-origin widget map. */
const ORIGINS_KEY = 'inspector-origins';

/** The accessibility engine, injected into the page under test. */
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8'
);

/** The note every marked case writes. */
const NOTE = {
  delay_js: { off: 'feature' },
  defer_all_js: { off: 'page' },
  lazyload: { excluded: 3 }
} as const;

/** The tab-level line's visible title and hints. */
const TITLE = 'Exclusion Builder rewrote this page';
const HINTS = ['Delay JS off', 'Defer JS off on this page', 'Lazyload Images: 3 excluded'];

/** What opening the card announces (the shared line, its dots spoken as commas). */
const DESCRIPTION = `${TITLE} — ${HINTS.join(', ')}`;

/** Each changed row: its chip label, modifier kind, badge words and sentence. */
const ROWS = [
  {
    label: 'Delay JS',
    kind: 'off',
    chip: 'Disabled in this tab',
    sentence: 'Disabled in this tab by the Exclusion Builder.'
  },
  {
    label: 'Defer JS',
    kind: 'off',
    chip: 'Off on this page',
    sentence: 'Off in this tab: an Exclusion Builder row stops WP Rocket deferring.'
  },
  {
    label: 'Lazyload Images',
    kind: 'excluded',
    chip: '3 excluded',
    sentence: '3 images excluded by the Exclusion Builder.'
  }
] as const;

/** The UI bar's D-1 widths. */
const WIDTHS = [320, 480, 768, 1280] as const;

/** The AA floor for the strip's small text. */
const AA_SMALL_TEXT = 4.5;

/** The real `/fdt/` HTML, as the site serves it. */
async function servedFdtHtml(extension: ExtensionDriver): Promise<string> {
  const response = await extension.browserContext.request.get(`${SITE_URL}/fdt/`);
  expect(response.ok(), `GET ${SITE_URL}/fdt/ answered ${String(response.status())}`).toBe(true);
  return await response.text();
}

/** Enable (or clear) the widget for the site's origin through its storage seam. */
async function setWidget(extension: ExtensionDriver, enabled: boolean | null): Promise<void> {
  await extension.evaluateInWorker(
    async (payload: { key: string; origin: string; enabled: boolean | null }) => {
      if (payload.enabled === null) {
        await chrome.storage.sync.remove([payload.key]);
        return;
      }
      await chrome.storage.sync.set({
        [payload.key]: { [payload.origin]: { enabled: payload.enabled } }
      });
    },
    { key: ORIGINS_KEY, origin: SITE_ORIGIN, enabled }
  );
}

/**
 * Serve `body()` at a unique site URL (re-read per request, so a reload can
 * serve a different document) and open it.
 */
async function openServed(
  extension: ExtensionDriver,
  label: string,
  body: () => string
): Promise<{ page: Page; url: string }> {
  const url = `${SITE_URL}/fdt/?fdt-strip-builder=${label}-${String(Date.now())}`;
  await extension.browserContext.route(url, async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: body() });
  });
  const { page } = await openSitePage(extension, url);
  return { page, url };
}

/** Open the card from the pill with the keyboard; resolves once the card is settled. */
async function openCardByKeyboard(page: Page): Promise<void> {
  const pill = page.locator(`${STRIP_HOST} .ins-pill`);
  await expect(pill).toContainText('WPR', { timeout: 15_000 });
  // The pass must have answered (identity carries a version) before opening.
  await expect(pill).toContainText(/WPR \d/, { timeout: 15_000 });
  await pill.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(`${STRIP_HOST} .ins-card`)).toBeVisible();
  await settle(page);
}

/** Wait until the strip has no running animation, then two frames. */
async function settle(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          (host) =>
            (document.querySelector(host)?.shadowRoot?.getAnimations() ?? []).filter(
              (animation) => animation.playState === 'running'
            ).length,
          STRIP_HOST
        ),
      { timeout: 10_000 }
    )
    .toBe(0);
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            done();
          });
        });
      })
  );
}

/** One measured text: which part, its text and its contrast ratio. */
interface MeasuredContrast {
  readonly part: string;
  readonly text: string;
  readonly ratio: number;
}

/**
 * The contrast ratio of every builder text in the strip against the layers
 * it is painted over, from computed colours composited in a 1 px canvas
 * (translucent soft fills count), walking out of the shadow root.
 */
async function builderContrast(page: Page): Promise<MeasuredContrast[]> {
  return await page.evaluate((host) => {
    const root = document.querySelector(host)?.shadowRoot;
    if (root === undefined || root === null) throw new Error('no strip');
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
    const parts = root.querySelectorAll<HTMLElement>(
      '.ins-builder-title, .ins-builder-hint, .ins-mod, .ins-mod-line'
    );
    return Array.from(parts, (element) => {
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
      const background = paint(layers);
      const foreground = paint([...layers, getComputedStyle(element).color]);
      const [light = 0, dark = 0] = [luminance(foreground), luminance(background)].sort(
        (a, b) => b - a
      );
      return {
        part: element.className,
        text: element.textContent,
        ratio: Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100
      };
    });
  }, STRIP_HOST);
}

/** The card's layout facts at the current width (overflow + the hints' gutter dots). */
interface BuilderLayout {
  cardInside: boolean;
  bodyOverflow: number;
  /** The horizontal document overflow the strip adds (the theme's own excluded). */
  documentOverflow: number;
  hintLines: number;
  /** Per hint: whether it starts a line and whether its dot is clipped. */
  hints: { startsLine: boolean; dotHidden: boolean; dotContent: string; inside: boolean }[];
  sentencesInside: boolean;
}

/** Read the open card's layout facts. */
async function builderLayout(page: Page): Promise<BuilderLayout> {
  return await page.evaluate((host) => {
    const root = document.querySelector(host)?.shadowRoot;
    if (root === undefined || root === null) throw new Error('no strip');
    const card = root.querySelector<HTMLElement>('.ins-card');
    const body = root.querySelector<HTMLElement>('.ins-card-body');
    const clip = root.querySelector<HTMLElement>('.ins-builder-hints');
    if (card === null || body === null || clip === null) throw new Error('no builder line');
    const cardBox = card.getBoundingClientRect();
    const clipBox = clip.getBoundingClientRect();
    const hints = Array.from(root.querySelectorAll<HTMLElement>('.ins-builder-hint'));
    // The strip's own share of the document's horizontal overflow: the host
    // theme's overflow (if any) is not ours, so measure with and without it.
    const overflow = (): number =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const withStrip = overflow();
    const hostElement = document.querySelector<HTMLElement>(host);
    hostElement?.style.setProperty('display', 'none', 'important');
    const withoutStrip = overflow();
    hostElement?.style.removeProperty('display');
    return {
      cardInside: cardBox.left >= -0.5 && cardBox.right <= window.innerWidth + 0.5,
      bodyOverflow: body.scrollWidth - body.clientWidth,
      documentOverflow: withStrip - withoutStrip,
      hintLines: new Set(hints.map((hint) => Math.round(hint.getBoundingClientRect().top))).size,
      hints: hints.map((hint) => {
        const own = hint.getBoundingClientRect();
        const dot = getComputedStyle(hint, '::before');
        const dotRight = own.left + parseFloat(dot.left) + parseFloat(dot.width);
        return {
          startsLine: Math.abs(own.left - clipBox.left) < 0.5,
          dotHidden: dotRight <= clipBox.left + 0.5,
          dotContent: dot.content,
          inside: own.left >= clipBox.left - 0.5 && own.right <= clipBox.right + 0.5
        };
      }),
      sentencesInside: Array.from(root.querySelectorAll<HTMLElement>('.ins-mod-line')).every(
        (line) => {
          const box = line.getBoundingClientRect();
          return box.left >= cardBox.left - 0.5 && box.right <= cardBox.right + 0.5;
        }
      )
    };
  }, STRIP_HOST);
}

/** Every name and value in Chromium's accessibility tree for the page. */
async function accessibleTexts(page: Page): Promise<string[]> {
  const session = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await session.send('Accessibility.getFullAXTree')) as {
      nodes: { ignored?: boolean; name?: { value?: unknown }; value?: { value?: unknown } }[];
    };
    return nodes
      .filter((node) => node.ignored !== true)
      .flatMap((node) => [node.name?.value, node.value?.value])
      .filter((text): text is string => typeof text === 'string' && text !== '');
  } finally {
    await session.detach();
  }
}

/** Every accessible description in Chromium's accessibility tree for the page. */
async function accessibleDescriptions(page: Page): Promise<string[]> {
  const session = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await session.send('Accessibility.getFullAXTree')) as {
      nodes: { ignored?: boolean; description?: { value?: unknown } }[];
    };
    return nodes
      .filter((node) => node.ignored !== true)
      .map((node) => node.description?.value)
      .filter((text): text is string => typeof text === 'string' && text !== '');
  } finally {
    await session.detach();
  }
}

/** Run axe over the strip only (the host page's own markup is not ours). */
async function axeStrip(page: Page): Promise<unknown> {
  await page.evaluate(AXE_SOURCE);
  return await page.evaluate(async (host) => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            context: unknown
          ) => Promise<{ violations: { id: string }[]; incomplete: { id: string }[] }>;
        };
      }
    ).axe;
    const result = await axe.run({ include: [[host]] });
    return {
      violations: result.violations.map((rule) => rule.id),
      incomplete: result.incomplete.map((rule) => rule.id)
    };
  }, STRIP_HOST);
}

test.describe('strip builder line + modifiers', () => {
  test.afterEach(async ({ extension }) => {
    await setWidget(extension, null);
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`the open card says what the builder changed (${colorScheme})`, async ({ extension }) => {
      await setWidget(extension, true);
      const marked = writeBuilderMarker(await servedFdtHtml(extension), NOTE);
      expect(marked).toContain(BUILDER_MARKER_META_NAME);
      const { page, url } = await openServed(extension, `marked-${colorScheme}`, () => marked);
      try {
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        await openCardByKeyboard(page);

        // Keyboard: the card took focus and announces the line as its description.
        const dialog = page.locator(`${STRIP_HOST} [role="dialog"]`);
        await expect(dialog).toBeFocused();
        await expect(dialog).toHaveAccessibleDescription(DESCRIPTION);
        // Tab reaches the scroll region that holds the line (after the close control).
        const scroller = page.locator(`${STRIP_HOST} .ins-card-body`);
        await page.keyboard.press('Tab');
        await expect(page.locator(`${STRIP_HOST} .ins-close`)).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(scroller).toBeFocused();
        await expect(scroller.locator('[data-fdt-strip-builder]')).toHaveCount(1);

        const line = page.locator(`${STRIP_HOST} [data-fdt-strip-builder]`);
        await expect(line).toBeVisible();
        await expect(line.locator('.ins-builder-title')).toHaveText(TITLE);
        const hints = line.locator('[data-fdt-strip-builder-hint]');
        await expect(hints).toHaveCount(HINTS.length);
        for (const [index, hint] of HINTS.entries()) {
          await expect(hints.nth(index)).toHaveText(hint);
        }
        await expect(line).not.toContainText('·');

        for (const { label, kind, chip, sentence } of ROWS) {
          const row = page.locator(`${STRIP_HOST} .ins-row`, {
            has: page.locator('.ins-chip', { hasText: new RegExp(`^${label}$`) })
          });
          const badge = row.locator('[data-fdt-strip-modifier]');
          await expect(badge, label).toHaveAttribute('data-fdt-strip-modifier', kind);
          await expect(badge, label).toHaveText(chip);
          await expect(badge, label).toHaveAttribute('aria-hidden', 'true');
          await expect(badge.locator('svg'), label).toHaveCount(1);
          const sentenceLine = row.locator('[data-fdt-strip-modifier-line]');
          await expect(sentenceLine, label).toBeVisible();
          await expect(sentenceLine, label).toHaveText(`, ${sentence}`);
          // The served chip stays (WP Rocket served all three on /fdt/).
          await expect(row.locator('.ins-chip'), label).toHaveClass(/ins-chip-ok/);
          // Turned off: the count of the rewritten page gives way to the modifier.
          await expect(row.locator('.ins-value'), label).toHaveCount(kind === 'off' ? 0 : 1);
        }

        // Assistive tech never hears the dot.
        // Polled: the accessibility tree updates after the DOM.
        await expect
          .poll(async () => {
            const spoken = await accessibleTexts(page);
            return {
              title: spoken.some((text) => text.includes(TITLE)),
              dots: spoken.filter((text) => text.includes('·') && text.includes(TITLE))
            };
          })
          .toEqual({ title: true, dots: [] });
        // Each sentence is spoken once: no row repeats it as its description.
        const described = await accessibleDescriptions(page);
        for (const { sentence } of ROWS) {
          expect(
            described.filter((text) => text.includes(sentence)),
            sentence
          ).toEqual([]);
        }
        // The line itself is the dialog's description, nothing else's.
        expect(described.filter((text) => text.includes(TITLE))).toEqual([DESCRIPTION]);

        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await settle(page);
          const layout = await builderLayout(page);
          console.log(`[layout] ${colorScheme} ${String(width)} px ${JSON.stringify(layout)}`);
          const at = `${colorScheme} ${String(width)} px`;
          expect(layout.cardInside, at).toBe(true);
          expect(layout.bodyOverflow, at).toBe(0);
          expect(layout.documentOverflow, at).toBe(0);
          expect(layout.sentencesInside, at).toBe(true);
          for (const [index, hint] of layout.hints.entries()) {
            expect(hint.inside, `${at} hint ${String(index)} inside`).toBe(true);
            expect(hint.dotContent, at).toBe('"·" / ""');
            // A line never starts with a dot: clipped exactly at line starts.
            expect(hint.dotHidden, `${at} hint ${String(index)} dot`).toBe(hint.startsLine);
          }
          expect(layout.hints[0]?.startsLine, at).toBe(true);
          if (width === 320)
            expect(layout.hintLines, 'the hints wrap at 320 px').toBeGreaterThan(1);
          // The overflow probe re-showed the host: let any restyle settle first.
          await settle(page);
          const measured = await builderContrast(page);
          console.log(`[contrast] ${at} ${JSON.stringify(measured)}`);
          // Title + three hints + three badges + three sentences.
          expect(measured, at).toHaveLength(1 + HINTS.length + ROWS.length * 2);
          for (const entry of measured) {
            expect(entry.ratio, `${at} ${entry.part} "${entry.text}"`).toBeGreaterThanOrEqual(
              AA_SMALL_TEXT
            );
          }
          const shots = process.env['FDT_SHOTS_DIR'];
          if (shots !== undefined && shots !== '') {
            mkdirSync(shots, { recursive: true });
            await page.locator(`${STRIP_HOST} .ins-card`).screenshot({
              path: join(shots, `strip-${colorScheme}-${String(width)}.png`)
            });
          }
        }

        // Reduced motion: nothing in the strip animates at rest.
        await settle(page);
        expect(await axeStrip(page)).toEqual({ violations: [], incomplete: [] });
      } finally {
        await page.close();
        await extension.browserContext.unroute(url);
      }
    });
  }

  test('without a fact the card has no line and no modifier', async ({ extension }) => {
    await setWidget(extension, true);
    const served = await servedFdtHtml(extension);
    expect(served).not.toContain(BUILDER_MARKER_META_NAME);
    const { page, url } = await openServed(extension, 'plain', () => served);
    try {
      await openCardByKeyboard(page);
      await expect(page.locator(`${STRIP_HOST} .ins-row`).first()).toBeVisible();
      await expect(page.locator(`${STRIP_HOST} [data-fdt-strip-builder]`)).toHaveCount(0);
      await expect(page.locator(`${STRIP_HOST} [data-fdt-strip-modifier]`)).toHaveCount(0);
      await expect(page.locator(`${STRIP_HOST} .ins-card`)).not.toContainText('Exclusion Builder');
      await expect(page.locator(`${STRIP_HOST} [role="dialog"]`)).not.toHaveAttribute(
        'aria-describedby'
      );
    } finally {
      await page.close();
      await extension.browserContext.unroute(url);
    }
  });

  test('the line follows the displayed document: kept on re-read, gone after a clean reload', async ({
    extension
  }) => {
    await setWidget(extension, true);
    const served = await servedFdtHtml(extension);
    const version = /content="WP Rocket ([\d.]+)"/.exec(served)?.[1];
    if (version === undefined) throw new Error('the served /fdt/ page lost its generator version');
    // The detected version keeps four parts: bump the last one.
    const parts = version.split('.');
    const bumped = [...parts.slice(0, -1), String(Number(parts.at(-1)) + 1)].join('.');
    let body = writeBuilderMarker(served, NOTE);
    const { page, url } = await openServed(extension, 'fresh', () => body);
    const line = page.locator(`${STRIP_HOST} [data-fdt-strip-builder]`);
    const title = page.locator(`${STRIP_HOST} .ins-title`);
    try {
      await openCardByKeyboard(page);
      await expect(line).toBeVisible();

      // A re-read of the rewritten document (Stop leaves it displayed): a
      // distinguishable version stamp proves the fresh payload is shown.
      body = writeBuilderMarker(
        served.replaceAll(`WP Rocket ${version}`, `WP Rocket ${bumped}`),
        NOTE
      );
      await page.reload();
      await openCardByKeyboard(page);
      await expect(title).toHaveText(`WPR ${bumped}`, { timeout: 15_000 });
      await expect(line).toBeVisible();
      await expect(line.locator('[data-fdt-strip-builder-hint]')).toHaveCount(HINTS.length);

      // A reload that serves WP Rocket's own page again: no marker, no line.
      body = served;
      await page.reload();
      await openCardByKeyboard(page);
      await expect(title).toHaveText(`WPR ${version}`, { timeout: 15_000 });
      await expect(line).toHaveCount(0);
      await expect(page.locator(`${STRIP_HOST} [data-fdt-strip-modifier]`)).toHaveCount(0);
    } finally {
      await page.close();
      await extension.browserContext.unroute(url);
    }
  });
});
