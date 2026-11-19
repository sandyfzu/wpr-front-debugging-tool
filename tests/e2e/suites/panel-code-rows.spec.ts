/**
 * Inline code in the JavaScript page's detail (the calm list's rows carry a
 * one-line preview only; the code, its language caption and its single Wrap
 * live in the selected row's detail). Real panel, real virtualizer: one
 * language caption and one Wrap per source block, every line shown (no
 * clamp), focus stays on the pressed Wrap, wide content really scrolls
 * sideways unwrapped and folds with no sideways scroll wrapped — the block
 * grows and the section below it moves with it — at 320 (drill-in) in both
 * palettes; the detail's wrap state survives a real virtual unmount/remount
 * of its selected row on scroll (the row is pinned detached while deep) and
 * another row's detail starts fresh. One more test keeps the calm rows'
 * `CALM_ROW_ESTIMATES` seeds honest against the real measured shapes.
 */
import type { Locator } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { closeScriptDetail, openScriptDetail } from '../helpers/javascript-page';
import { openPanelForFixture } from '../helpers/panel-data';
import { resetStoredOptions } from '../helpers/options';

// One profile serves every suite: the options this file writes go back to the
// fresh-install item after each test (its assertions are over, so a page it
// left open no longer needs them) and no stored choice reaches the next suite.
test.afterEach(async ({ extension }) => {
  await resetStoredOptions(extension);
});

/**
 * A script inventory with every code shape: two external markers, a
 * one-wide-line row, then alternating five-line rows and wide rows (four
 * 220-char lines: real sideways scroll unwrapped, folded lines wrapped).
 * 33 scripts so the list scrolls deep enough for a real mount/unmount window.
 * @returns The fixture HTML.
 */
function codeRowsPage(): string {
  const fiveLine = (index: number): string =>
    Array.from(
      { length: 5 },
      (_, line) => `const five${String(index)}_${String(line)} = ${String(line)};`
    ).join('\n');
  const wideLine = (index: number, line: number): string =>
    `wide${String(index)}_${String(line)}(${'x'.repeat(220)})`;
  const wide = (index: number): string =>
    Array.from({ length: 4 }, (_, line) => wideLine(index, line)).join('\n');
  const rows: string[] = [
    '<script type="rocketlazyloadscript" data-rocket-src="https://example.test/a.js"></script>',
    '<script type="rocketlazyloadscript" data-rocket-src="https://example.test/b.js"></script>',
    `<script type="rocketlazyloadscript">${wideLine(0, 0)};</script>`
  ];
  for (let index = 1; index < 30; index += 1) {
    if (index % 2 === 0) {
      rows.push(`<script type="rocketlazyloadscript">${fiveLine(index)}</script>`);
    } else {
      rows.push(`<script type="rocketlazyloadscript">${wide(index)}</script>`);
    }
  }
  return `<!doctype html><html lang="en"><head><title>Code rows fixture</title></head>
    <body><h1>Code rows fixture</h1>${rows.join('')}</body></html>`;
}

/** The first five-line row (index 2 → "five2_"; unique substring). */
const FIVE_ROW = '[data-index]:has-text("five2_")';

/** The first wide multi-line row (index 1 → "wide1_"; unique substring). */
const WIDE_ROW = '[data-index]:has-text("wide1_")';

/** The last five-line row — deep in the list, past a real unmount window. */
const DEEP_ROW = '[data-index]:has-text("five28_")';

/** One frame's geometry of the detail's source block and the section below it. */
interface BlockGeometry {
  /** The block's own height (px). */
  height: number;
  /** The next section's (the served tag's) viewport top: the block's layout consequence. */
  followerTop: number;
  /** The code area's sideways extent vs its box (horizontal-overflow check). */
  areaScrollWidth: number;
  areaClientWidth: number;
  /** The computed `white-space` of the code (the wrap state's real effect). */
  preWhiteSpace: string;
}

/**
 * The detail's inline source section.
 *
 * @param detail The open detail.
 */
function sourceSection(detail: Locator): Locator {
  return detail.locator('[data-fdt="script-source"]');
}

/**
 * Read the source block's real geometry in a single frame.
 *
 * @param detail The open detail.
 */
async function blockGeometry(detail: Locator): Promise<BlockGeometry> {
  return await sourceSection(detail).evaluate((section) => {
    const block = section.querySelector<HTMLElement>('[data-fdt="code-block"]');
    if (block === null) throw new Error('no code block in the source section');
    const follower = section.nextElementSibling;
    if (!(follower instanceof HTMLElement)) throw new Error('no section after the source');
    const area = block.querySelector<HTMLElement>('[data-fdt-code-area]');
    if (area === null) throw new Error('no code area in the block');
    const pre = area.querySelector('pre');
    if (pre === null) throw new Error('no pre in the code area');
    return {
      height: block.getBoundingClientRect().height,
      followerTop: follower.getBoundingClientRect().top,
      areaScrollWidth: area.scrollWidth,
      areaClientWidth: area.clientWidth,
      preWhiteSpace: getComputedStyle(pre).whiteSpace
    };
  });
}

/**
 * Read a **settled** frame: two consecutive identical reads (fonts, the
 * highlighted swap and the wrap's reflow are done) — no sleep, no tolerance.
 *
 * @param detail The open detail.
 */
async function settledBlock(detail: Locator): Promise<BlockGeometry> {
  let previous: string | undefined;
  await expect
    .poll(async () => {
      const next = JSON.stringify(await blockGeometry(detail));
      const settled = previous === next;
      previous = next;
      return settled;
    })
    .toBe(true);
  return await blockGeometry(detail);
}

/**
 * The source block's single Wrap control.
 *
 * @param detail The open detail.
 */
function wrapToggle(detail: Locator): Locator {
  return sourceSection(detail).locator('[data-fdt-code-block-wrap]');
}

test('the detail owns the caption and the single Wrap; wrapping folds for real at 320 in both palettes', async ({
  extension
}) => {
  await extension.browserContext.route('**/code-rows.html*', async (route) => {
    await route.fulfill({ contentType: 'text/html', body: codeRowsPage() });
  });
  const { panel, fixture } = await openPanelForFixture(extension, '/code-rows.html', {
    bootHash: '#/javascript'
  });
  try {
    await expect(fixture.page.locator('script')).toHaveCount(32);
    await panel.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    const page = panel.locator('[data-fdt-page="javascript"]');
    for (const theme of ['light', 'dark']) {
      await extension.evaluateInWorker(async (appearance: string) => {
        await chrome.storage.sync.set({
          options: { appearance, improvements: {}, features: {} }
        });
      }, theme);
      await expect(panel.locator('html')).toHaveAttribute('data-theme', theme);
      await panel.setViewportSize({ width: 320, height: 800 });

      // Rows carry no code: the code is the detail's.
      await expect(page.locator(FIVE_ROW).first().locator('[data-fdt="code-block"]')).toHaveCount(
        0
      );

      /* The five-line source: its section names the line count, its block
         carries exactly one language caption and one Wrap, and every line
         shows (no clamp). Short lines do not fold, so wrapping keeps its
         height; focus stays on the pressed control. */
      let detail = await openScriptDetail(panel, page.locator(FIVE_ROW).first());
      await expect(sourceSection(detail).locator('h3')).toHaveText(/^Source\s*5 lines$/);
      await expect(sourceSection(detail).locator('[data-fdt-code-block-lang]')).toHaveText(
        'javascript'
      );
      await expect(wrapToggle(detail)).toHaveCount(1);
      await expect(wrapToggle(detail)).toHaveAttribute('aria-pressed', 'false');
      await expect(sourceSection(detail).locator('[data-fdt-code-area]')).not.toHaveAttribute(
        'data-fdt-clamped',
        ''
      );
      await expect(sourceSection(detail)).toContainText('const five2_4 = 4;');
      const fivePlain = await settledBlock(detail);
      await wrapToggle(detail).click();
      await expect(wrapToggle(detail)).toBeFocused();
      await expect(wrapToggle(detail)).toHaveAttribute('aria-pressed', 'true');
      const fiveWrapped = await settledBlock(detail);
      expect(fiveWrapped.preWhiteSpace).toBe('pre-wrap');
      expect(Math.abs(fiveWrapped.height - fivePlain.height)).toBeLessThanOrEqual(2);
      await closeScriptDetail(panel);

      /* The wide source: unwrapped it scrolls horizontally (pre stays
         `pre`); wrapping folds its lines — the block grows, the section
         below slides down by the same shift (layout follows), the pre
         computes to `pre-wrap`, and no sideways scroll remains. Unwrapping
         restores the scrolling shape. */
      detail = await openScriptDetail(panel, page.locator(WIDE_ROW).first());
      await expect(sourceSection(detail).locator('h3')).toHaveText(/^Source\s*4 lines$/);
      await expect(wrapToggle(detail)).toHaveCount(1);
      // A fresh detail: the five-line block's pressed Wrap never leaks here.
      await expect(wrapToggle(detail)).toHaveAttribute('aria-pressed', 'false');
      const unwrapped = await settledBlock(detail);
      expect(unwrapped.preWhiteSpace).toBe('pre');
      expect(unwrapped.areaScrollWidth).toBeGreaterThan(unwrapped.areaClientWidth);
      await wrapToggle(detail).click();
      await expect(wrapToggle(detail)).toBeFocused();
      await expect(wrapToggle(detail)).toHaveAttribute('aria-pressed', 'true');
      const wrapped = await settledBlock(detail);
      expect(wrapped.preWhiteSpace).toBe('pre-wrap');
      expect(wrapped.areaScrollWidth).toBeLessThanOrEqual(wrapped.areaClientWidth);
      const growth = wrapped.height - unwrapped.height;
      expect(growth).toBeGreaterThanOrEqual(20);
      expect(wrapped.followerTop - unwrapped.followerTop).toBeGreaterThanOrEqual(growth - 1);
      expect(wrapped.followerTop - unwrapped.followerTop).toBeLessThanOrEqual(growth + 1);
      await wrapToggle(detail).click();
      await expect(wrapToggle(detail)).toHaveAttribute('aria-pressed', 'false');
      const rest = await settledBlock(detail);
      expect(rest.preWhiteSpace).toBe('pre');
      expect(Math.abs(rest.height - unwrapped.height)).toBeLessThanOrEqual(1);
      // End each loop clean, so the next theme starts from the list.
      await closeScriptDetail(panel);
    }
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('the detail’s wrap state survives a real virtual unmount/remount of its row on scroll', async ({
  extension
}) => {
  await extension.browserContext.route('**/code-rows.html*', async (route) => {
    await route.fulfill({ contentType: 'text/html', body: codeRowsPage() });
  });
  const { panel, fixture } = await openPanelForFixture(extension, '/code-rows.html', {
    bootHash: '#/javascript'
  });
  try {
    await panel.setViewportSize({ width: 1280, height: 800 });
    const page = panel.locator('[data-fdt-page="javascript"]');
    const scroller = page.locator('[data-fdt="virtual-list"]');
    const fiveRow = page.locator(FIVE_ROW).first();

    // The side pane: the list stays beside it, so its rows really scroll.
    const detail = await openScriptDetail(panel, fiveRow);
    await expect(page.locator('[data-fdt="detail-pane"]')).toBeVisible();
    await wrapToggle(detail).click();
    await expect(wrapToggle(detail)).toHaveAttribute('aria-pressed', 'true');

    // Scroll the selected row far out of the render window, then back. Deep
    // means really deep: the window moved onto far rows AND the selected row
    // itself fell out of it — otherwise every later "survives" assertion
    // would pass on a row that never unmounted.
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll'));
    });
    await expect(page.locator(DEEP_ROW)).toBeAttached(); // the window really moved
    await expect(page.locator(FIVE_ROW)).toHaveCount(0); // and the selected row really fell out
    // The detail stayed: same row, still wrapped.
    await expect(page.locator('[data-fdt="detail-title"]')).toHaveText('Inline script #3');
    await expect(wrapToggle(detail)).toHaveAttribute('aria-pressed', 'true');
    await scroller.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event('scroll'));
    });
    // The remounted row is still the selected one; the block is still wrapped.
    await expect(fiveRow.locator('[data-fdt="script-row"]')).toHaveAttribute('data-selected', '');
    await expect(wrapToggle(detail)).toHaveAttribute('aria-pressed', 'true');
    const wrapped = await settledBlock(detail);
    expect(wrapped.preWhiteSpace).toBe('pre-wrap');
    expect(wrapped.areaScrollWidth).toBeLessThanOrEqual(wrapped.areaClientWidth);
    // A row that was never touched opens with nothing to inherit.
    const wide = await openScriptDetail(panel, page.locator(WIDE_ROW).first());
    await expect(wrapToggle(wide)).toHaveAttribute('aria-pressed', 'false');
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

/**
 * One row per calm-row seed shape, delayed (a Delayed chip) and plain (no
 * chip) for both script kinds, plus one padding row at the end.
 * @returns The fixture HTML.
 */
function seedShapesPage(): string {
  return `<!doctype html><html lang="en"><head><title>Seed shapes</title></head>
    <body><h1>Seed shapes</h1>
    <script type="rocketlazyloadscript" data-rocket-src="https://example.test/a.js"></script>
    <script type="rocketlazyloadscript">const delayedShape = 1;</script>
    <script src="https://example.test/plain.js"></script>
    <script>const plainShape = 2;</script>
    <script type="rocketlazyloadscript" data-rocket-src="https://example.test/b.js"></script>
    </body></html>`;
}

/**
 * One measured shape: its row probe in {@link seedShapesPage} (the text only
 * that row renders), whether it shows a state chip, and the
 * `CALM_ROW_ESTIMATES` seeds it must stay honest to — regular and compact
 * (mirrored here as literals by convention for behavior pins).
 */
interface SeedShape {
  /** Probe for the row's `[data-index]` wrapper. */
  readonly marker: string;
  /** Mirrored from `CALM_ROW_ESTIMATES` (`list-row.tsx`), px: the regular tier. */
  readonly regular: number;
  /** The compact tier (chips stack onto a third line). */
  readonly compact: number;
}

/** The four seed shapes and their mirrored estimates. */
const SEED_SHAPES: readonly SeedShape[] = [
  { marker: '[data-index]:has-text("example.test/a.js")', regular: 58, compact: 78 },
  { marker: '[data-index]:has-text("delayedShape")', regular: 58, compact: 78 },
  { marker: '[data-index]:has-text("example.test/plain.js")', regular: 58, compact: 58 },
  { marker: '[data-index]:has-text("plainShape")', regular: 58, compact: 58 }
];

/** A row wrapper's content height — what `measureElement` caches. */
function rowRectHeight(target: Element): number {
  if (!(target instanceof HTMLElement)) throw new Error('row is not an element');
  return target.getBoundingClientRect().height;
}

/**
 * One settled read of a row's real height: two consecutive identical reads.
 * The wrapper's own rect is its content height from the first layout, so a
 * pair of equal frames means refinement (fonts, RO pass) is done — no sleep,
 * no tolerance.
 *
 * @param row The row wrapper's locator (resolved live; never query by hand).
 */
async function stableRowHeight(row: Locator): Promise<number> {
  let previous: number | undefined;
  await expect
    .poll(async () => {
      const next = await row.evaluate(rowRectHeight);
      const settled = previous !== undefined && previous === next ? next : Number.NaN;
      previous = next;
      return settled;
    })
    .not.toBeNaN();
  return previous ?? Number.NaN;
}

test('row-size seeds stay honest to the real shapes they estimate', async ({ extension }) => {
  await extension.browserContext.route('**/seed-shapes.html*', async (route) => {
    await route.fulfill({ contentType: 'text/html', body: seedShapesPage() });
  });
  // The plain external script really loads: it answers empty at once.
  await extension.browserContext.route('https://example.test/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
  });
  const { panel, fixture } = await openPanelForFixture(extension, '/seed-shapes.html', {
    bootHash: '#/javascript'
  });
  try {
    const page = panel.locator('[data-fdt-page="javascript"]');
    for (const shape of SEED_SHAPES) {
      await expect(page.locator(shape.marker)).toBeAttached();
    }

    // The regular tier: every two-line row sits on its seed, chips or not
    // (the chips take their own column).
    await panel.setViewportSize({ width: 1280, height: 800 });
    for (const shape of SEED_SHAPES) {
      const height = await stableRowHeight(page.locator(shape.marker));
      expect
        .soft(height, `${shape.marker} at 1280 sits on its seed`)
        .toBeGreaterThanOrEqual(shape.regular - 1);
      expect
        .soft(height, `${shape.marker} at 1280 sits on its seed`)
        .toBeLessThanOrEqual(shape.regular + 1);
    }

    // 320 — the compact list stacks a row's chips onto a third line: the
    // chip rows sit on the stacked seed, the chip-less ones stay two-line.
    await panel.setViewportSize({ width: 320, height: 800 });
    await expect(page.locator('[data-fdt="facet-bar"]')).toHaveAttribute('data-fdt-compact', '');
    for (const shape of SEED_SHAPES) {
      const height = await stableRowHeight(page.locator(shape.marker));
      expect
        .soft(height, `${shape.marker} at 320 sits on its seed`)
        .toBeGreaterThanOrEqual(shape.compact - 1);
      expect
        .soft(height, `${shape.marker} at 320 sits on its seed`)
        .toBeLessThanOrEqual(shape.compact + 1);
    }
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
