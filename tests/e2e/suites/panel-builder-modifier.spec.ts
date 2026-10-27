/**
 * The Exclusion Builder modifier on the real panel's Detections cards, over
 * a page carrying the builder marker (as a rewritten document does): Delay
 * JS off, Defer JS off for the page, LazyLoad rows excluded. Each card keeps
 * WP Rocket's served verdict and adds its modifier badge (icon + words) and
 * the full sentence as a visible line, spoken once; the summary counts the
 * two turned-off features as inactive and says why ("· 2 off in this tab"). Checked at 320/480/768/1280 px, in
 * both palettes, with reduced motion: no horizontal scroll, AA contrast of
 * the modifier text (computed colours), keyboard reach, strict axe. A last
 * test pins freshness: the modifier follows the displayed document — kept
 * while the rewritten page is re-read (Stop does not reload), gone once a
 * reload serves the page without the marker.
 *
 * Set `FDT_SHOTS_DIR` to save a screenshot per palette × width there (the
 * owner's visual receipt; nothing is written otherwise).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { BUILDER_MARKER_META_NAME } from '../../../lib/wp-rocket/constants';
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

/** The accessibility engine, injected into the panel page under test. */
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8'
);

/** The fixture path the route serves the marked page at. */
const FIXTURE_PATH = '/pipeline/builder-modifier.html';

/** A WP Rocket page as the builder's rewrite leaves it: the served declaration plus the marker. */
const MARKED_PAGE = `<!doctype html><html lang="en"><head><title>Builder modifier fixture</title>
<meta name="generator" content="WP Rocket 3.23.5.1" data-wpr-features="wpr_delay_js wpr_defer_js wpr_lazyload_images">
<meta name="${BUILDER_MARKER_META_NAME}" content="v1 delay_js=off defer_all_js=page-off lazyload=excluded:3">
</head><body><h1>Builder modifier fixture</h1>
<img src="/a.gif" data-lazy-src="/real-a.jpg" alt="A"><img src="/b.jpg" alt="B" data-wpr-fdt-excluded="lazyload">
</body></html>`;

/** Each changed card: its id, its modifier kind, its badge words and its visible sentence. */
const CASES = [
  {
    id: 'delay_js',
    kind: 'off',
    chip: 'Disabled in this tab',
    sentence: 'Disabled in this tab by the Exclusion Builder.'
  },
  {
    id: 'defer_all_js',
    kind: 'off',
    chip: 'Off on this page',
    sentence: 'Off in this tab: an Exclusion Builder row stops WP Rocket deferring.'
  },
  {
    id: 'lazyload',
    kind: 'excluded',
    chip: '3 excluded',
    sentence: '3 images excluded by the Exclusion Builder.'
  }
] as const;

/** The summary headline on the marked page: LazyLoad (rows excluded) runs, Delay + Defer are off. */
// The text form: the dot is a CSS gutter glyph (never in the text); assistive tech hears a comma.
const MARKED_HEADLINE = /^\s*1\s+of\s+\d+\s+optimizations active,\s+2 off in this tab\s*$/;

/** The panel widths of the UI bar's D-1 check. */
const WIDTHS = [320, 480, 768, 1280] as const;

/** The AA floor for the modifier's small text. */
const AA_SMALL_TEXT = 4.5;

/**
 * A regex matching an accessible name that contains `text` exactly once.
 *
 * @param text The literal the name must say once.
 */
function saysOnce(text: string): RegExp {
  const literal = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^(?![\\s\\S]*${literal}[\\s\\S]*${literal})[\\s\\S]*${literal}`);
}

/** One measured modifier text: which element, its card, and its contrast ratio. */
interface MeasuredContrast {
  readonly part: 'badge' | 'line';
  readonly card: string;
  readonly ratio: number;
}

/**
 * The contrast ratio of every modifier badge and sentence line against the
 * backgrounds it is painted over, from computed colours composited in a
 * 1 px canvas (so translucent layers count).
 */
async function modifierContrast(panel: Page): Promise<MeasuredContrast[]> {
  return await panel.evaluate(() => {
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
    const parts = document.querySelectorAll<HTMLElement>(
      '[data-fdt-card-modifier], [data-fdt-card-modifier-line]'
    );
    return Array.from(parts, (element) => {
      // Opaque page base first, then every ancestor's (possibly translucent) fill.
      const layers: string[] = ['#fff'];
      const fills: string[] = [];
      for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
        fills.unshift(getComputedStyle(node).backgroundColor);
      }
      layers.push(...fills);
      const background = paint(layers);
      const foreground = paint([...layers, getComputedStyle(element).color]);
      const [light = 0, dark = 0] = [luminance(foreground), luminance(background)].sort(
        (a, b) => b - a
      );
      return {
        part: element.hasAttribute('data-fdt-card-modifier-line') ? 'line' : 'badge',
        card: element.closest<HTMLElement>('[data-fdt-card-id]')?.dataset['fdtCardId'] ?? '',
        ratio: Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100
      } as const;
    });
  });
}

/**
 * Assert every modifier text clears AA and log the measured ratios (the receipt).
 *
 * @param panel The panel page.
 * @param label Which state was measured (palette, width, hover).
 */
async function expectModifierContrast(panel: Page, label: string): Promise<void> {
  const measured = await modifierContrast(panel);
  expect(measured, label).toHaveLength(CASES.length * 2);
  console.log(`[contrast] ${label} ${JSON.stringify(measured)}`);
  for (const entry of measured) {
    expect(entry.ratio, `${label} ${entry.card} ${entry.part}`).toBeGreaterThanOrEqual(
      AA_SMALL_TEXT
    );
  }
}

/**
 * Every name and value in Chromium's accessibility tree for the page (what
 * assistive tech can speak — CSS generated content included unless its alt
 * text is empty).
 */
async function accessibleTexts(panel: Page): Promise<string[]> {
  const session = await panel.context().newCDPSession(panel);
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

/** Run axe over the panel page; violations and incomplete checks, by rule id. */
async function axeAudit(panel: Page): Promise<unknown> {
  await panel.evaluate(AXE_SOURCE);
  return await panel.evaluate(async () => {
    await document.fonts.ready;
    const axe = (
      window as unknown as {
        axe: {
          run: () => Promise<{ violations: { id: string }[]; incomplete: { id: string }[] }>;
        };
      }
    ).axe;
    const result = await axe.run();
    return {
      violations: result.violations.map((rule) => rule.id),
      incomplete: result.incomplete.map((rule) => rule.id)
    };
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the Detections cards carry the builder modifiers (${colorScheme})`, async ({
    extension
  }) => {
    await extension.browserContext.route(`**${FIXTURE_PATH}*`, async (route) => {
      await route.fulfill({ contentType: 'text/html', body: MARKED_PAGE });
    });
    const { panel, fixture } = await openPanelForFixture(extension, FIXTURE_PATH, {
      bootHash: '#/detections',
      emulation: { colorScheme, reducedMotion: 'reduce' }
    });
    try {
      const root = panel.locator('[data-fdt-page="detections"]');
      for (const { id, kind, chip, sentence } of CASES) {
        const card = root.locator(`[data-fdt-card-id="${id}"]`);
        const badge = card.locator('[data-fdt-card-modifier]');
        await expect(badge, id).toHaveAttribute('data-fdt-card-modifier', kind);
        await expect(badge, id).toContainText(chip);
        await expect(badge.locator('svg'), id).toHaveCount(1);
        await expect(badge, id).not.toHaveAttribute('title');
        // The full sentence is visible text, never hover-only.
        await expect(card.locator('[data-fdt-card-modifier-line]'), id).toContainText(sentence);
        // Spoken once: the link card's name says the sentence a single time.
        await expect(card, id).toHaveAccessibleName(saysOnce(sentence));
        // The served verdict stays.
        await expect(card.locator('[data-fdt="status-badge"]'), id).toHaveText('Active');
      }
      // O-N3: the two features turned off in this tab are not counted active.
      const headline = root.locator('[data-fdt-summary-headline]');
      // Delay, Defer and LazyLoad are declared; only LazyLoad (rows excluded) still
      // runs — and the headline says why the other two are not counted.
      await expect(headline).toHaveText(MARKED_HEADLINE);
      // The dot never reaches assistive tech (empty CSS alt text): Chromium's own
      // accessibility tree has the suffix's words and no "·" anywhere.
      // Polled: the accessibility tree updates after the DOM text matches.
      await expect
        .poll(async () => {
          const spoken = await accessibleTexts(panel);
          return {
            suffix: spoken.some((text) => text.includes('2 off in this tab')),
            dots: spoken.filter((text) => text.includes('·'))
          };
        })
        .toEqual({ suffix: true, dots: [] });

      for (const width of WIDTHS) {
        await panel.setViewportSize({ width, height: 900 });
        await expect
          .poll(() => root.evaluate((element) => element.scrollWidth - element.clientWidth), {
            message: `no horizontal scroll at ${String(width)} px (${colorScheme})`
          })
          .toBe(0);
        await expect
          .poll(
            () =>
              panel.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth
              ),
            { message: `no document horizontal scroll at ${String(width)} px (${colorScheme})` }
          )
          .toBe(0);
        for (const { id } of CASES) {
          const card = root.locator(`[data-fdt-card-id="${id}"]`);
          await expect(card.locator('[data-fdt-card-modifier]'), id).toBeVisible();
          const line = card.locator('[data-fdt-card-modifier-line]');
          await expect(line, id).toBeVisible();
          // The line wraps inside its card, never past it.
          const inside = await line.evaluate((element) => {
            const own = element.getBoundingClientRect();
            const host = element.closest('[data-fdt="status-card"]')?.getBoundingClientRect();
            return (
              host !== undefined && own.left >= host.left - 0.5 && own.right <= host.right + 0.5
            );
          });
          expect(inside, `${id} line inside its card at ${String(width)} px`).toBe(true);
        }
        await expectModifierContrast(panel, `${colorScheme} ${String(width)} px`);
        // The headline's reason suffix: one unbroken line box, inside the summary card.
        const suffix = await root.locator('[data-fdt-summary-off]').evaluate((element) => {
          const boxes = element.getClientRects();
          const own = element.getBoundingClientRect();
          const host = element.closest('[data-fdt="detections-summary"]')?.getBoundingClientRect();
          const clip = element.closest('[data-fdt-summary-headline]')?.getBoundingClientRect();
          const lead = element.previousElementSibling?.getBoundingClientRect();
          const dot = getComputedStyle(element, '::before');
          const dotRight = own.left + parseFloat(dot.left) + parseFloat(dot.width);
          // The visible text: the element's own text nodes (the sr-only comma excluded).
          const visible = Array.from(element.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent ?? '')
            .join('')
            .trim();
          return {
            // One rect per text fragment; distinct tops = line boxes.
            lines: new Set(Array.from(boxes, (box) => Math.round(box.top))).size,
            inside:
              host !== undefined && own.left >= host.left - 0.5 && own.right <= host.right + 0.5,
            wrapped: lead !== undefined && own.top > lead.top + 1,
            startsLine: clip !== undefined && Math.abs(own.left - clip.left) < 0.5,
            dotHidden: clip !== undefined && dotRight <= clip.left + 0.5,
            dotContent: dot.content,
            visible
          };
        });
        console.log(`[suffix] ${colorScheme} ${String(width)} px ${JSON.stringify(suffix)}`);
        const at = `suffix at ${String(width)} px`;
        expect({ lines: suffix.lines, inside: suffix.inside }, at).toEqual({
          lines: 1,
          inside: true
        });
        expect(suffix.visible, at).toBe('2 off in this tab');
        expect(suffix.dotContent, at).toBe('"·" / ""');
        // The dot shows between the phrases and is clipped exactly when the suffix wraps,
        // so a wrapped line starts at the figure.
        expect(suffix.dotHidden, at).toBe(suffix.wrapped);
        if (suffix.wrapped) expect(suffix.startsLine, at).toBe(true);
        if (width === 320) expect(suffix.wrapped, 'the suffix wraps at 320 px').toBe(true);
        if (width === 1280) expect(suffix.wrapped, 'one headline line at 1280 px').toBe(false);
        const shots = process.env['FDT_SHOTS_DIR'];
        if (shots !== undefined && shots !== '') {
          mkdirSync(shots, { recursive: true });
          await panel.screenshot({
            path: join(shots, `detections-${colorScheme}-${String(width)}.png`),
            fullPage: true
          });
        }
      }

      // Keyboard: the changed link cards stay reachable with Tab; the badge adds no stop.
      await root.getByRole('heading', { level: 1 }).focus();
      const delay = root.locator('[data-fdt-card-id="delay_js"]');
      let reached = false;
      for (let step = 0; step < 40 && !reached; step++) {
        await panel.keyboard.press('Tab');
        reached = await delay.evaluate((element) => element === document.activeElement);
      }
      expect(reached, 'Tab reaches the Delay JS card').toBe(true);
      await expect(delay.locator('[tabindex], button, a')).toHaveCount(0);
      // The compact tier's hover row fill keeps the modifier text at AA.
      await panel.setViewportSize({ width: 320, height: 900 });
      await delay.hover();
      await expectModifierContrast(panel, `${colorScheme} 320 px hovered Delay JS card`);

      // Reduced motion: nothing animates after mount.
      await expect
        .poll(() =>
          panel.evaluate(
            () =>
              document.getAnimations().filter((animation) => animation.playState === 'running')
                .length
          )
        )
        .toBe(0);
      expect(await axeAudit(panel)).toEqual({ violations: [], incomplete: [] });
    } finally {
      await panel.close();
      await fixture.page.close();
      await extension.browserContext.unroute(`**${FIXTURE_PATH}*`);
    }
  });
}

test('the modifier follows the displayed document: kept on re-read, gone after a clean reload', async ({
  extension
}) => {
  // Stop does not reload: the rewritten document (and its marker) stays
  // displayed, so every re-read of it keeps the modifier. A reload serves
  // WP Rocket's own page again — no marker, no modifier.
  let body = MARKED_PAGE;
  await extension.browserContext.route(`**${FIXTURE_PATH}*`, async (route) => {
    await route.fulfill({ contentType: 'text/html', body });
  });
  const { panel, fixture } = await openPanelForFixture(extension, FIXTURE_PATH, {
    bootHash: '#/detections'
  });
  try {
    const root = panel.locator('[data-fdt-page="detections"]');
    const badges = root.locator('[data-fdt-card-modifier]');
    const lines = root.locator('[data-fdt-card-modifier-line]');
    const headline = root.locator('[data-fdt-summary-headline]');
    await expect(badges).toHaveCount(CASES.length);

    // Re-read of the rewritten document (marker intact). The re-read serves a
    // distinguishable version stamp, so the panel is proven to show the fresh
    // payload — not the pre-reload DOM — before the modifier is checked.
    body = MARKED_PAGE.replace('WP Rocket 3.23.5.1', 'WP Rocket 3.23.5.2');
    expect(body).toContain(BUILDER_MARKER_META_NAME);
    await fixture.page.reload();
    await expect(root.locator('[data-fdt-card-id="wpr"]')).toContainText('3.23.5.2', {
      timeout: 15_000
    });
    await expect(badges).toHaveCount(CASES.length);
    await expect(lines).toHaveCount(CASES.length);
    await expect(headline).toHaveText(MARKED_HEADLINE);

    // A reload that serves the page without the marker: the served verdicts alone.
    body = MARKED_PAGE.replace(/<meta name="[^"]+" content="v1 [^"]*">\n/, '');
    expect(body).not.toContain(BUILDER_MARKER_META_NAME);
    await fixture.page.reload();
    await expect.poll(() => badges.count(), { timeout: 15_000 }).toBe(0);
    await expect(lines).toHaveCount(0);
    await expect(root).not.toContainText('Exclusion Builder');
    await expect(headline).toHaveText(/^\s*3\s+of\s+\d+\s+optimizations active\s*$/);
    for (const { id } of CASES) {
      await expect(
        root.locator(`[data-fdt-card-id="${id}"] [data-fdt="status-badge"]`),
        id
      ).toHaveText('Active');
    }
  } finally {
    await panel.close();
    await fixture.page.close();
    await extension.browserContext.unroute(`**${FIXTURE_PATH}*`);
  }
});
