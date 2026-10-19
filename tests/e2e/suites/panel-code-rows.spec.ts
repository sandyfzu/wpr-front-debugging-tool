/**
 * Compact inline-code rows (P6G.6, 07-phase-6-panel-pages.md): the block
 * owns no chrome — the row carries the language caption and the single
 * accessible Wrap toggle through the page-owned reactive state. Real panel,
 * real virtualizer: one Wrap per code row, actual variable-height remeasure
 * when wrapping folds extended lines (the following row moves with it), focus
 * stays on the pressed control, wide content really scrolls sideways unwrapped
 * and folds with no sideways scroll wrapped — both at 320, both palettes; the
 * flag survives an expand/collapse swap and a real virtual unmount/remount on
 * scroll (the fallen row is pinned detached while deep). One more test keeps
 * the list's `ROW_ESTIMATES` seeds honest against the real measured shapes.
 */
import type { Locator } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

/**
 * A script inventory with every code-row shape: two external markers, a
 * one-wide-line row, then alternating five-line rows (clamped preview +
 * toggle) and wide rows (four 220-char lines: truncated preview, real
 * sideways scroll when expanded, folded lines when wrapped). 33 scripts so
 * the list scrolls deep enough for a real mount/unmount window.
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

/** One wall-clock frame's geometry: the row, its follower, and its code. */
interface RowGeometry {
  /** The row's viewport top (the chain anchor). */
  rowTop: number;
  /** The row's own height (px). */
  height: number;
  /** The following row's client-space top (the row's layout consequence). */
  followerTop: number;
  /** The code area's sideways extent vs its box (horizontal-overflow check). */
  areaScrollWidth: number;
  areaClientWidth: number;
  /** The computed `white-space` of the code (the wrap state's real effect). */
  preWhiteSpace: string;
}

/**
 * Read one rendered row's real geometry in a single frame.
 *
 * @param row The row wrapper's locator (resolved live; never query by hand).
 */
async function rowGeometry(row: Locator): Promise<RowGeometry> {
  return row.evaluate((target) => {
    if (!(target instanceof HTMLElement)) throw new Error('row is not an element');
    const follower = target.nextElementSibling;
    if (!(follower instanceof HTMLElement)) {
      throw new Error('no following rendered row');
    }
    const area = target.querySelector<HTMLElement>('[data-fdt-code-area]');
    if (area === null) throw new Error('no code area in the row');
    const pre = area.querySelector('pre');
    if (pre === null) throw new Error('no pre in the code area');
    return {
      rowTop: target.getBoundingClientRect().top,
      height: target.getBoundingClientRect().height,
      followerTop: follower.getBoundingClientRect().top,
      areaScrollWidth: area.scrollWidth,
      areaClientWidth: area.clientWidth,
      preWhiteSpace: getComputedStyle(pre).whiteSpace
    };
  });
}

/**
 * Wait for the list's re-measure reflow — the row's own rect changes
 * instantly while the ResizeObserver moves the followers a frame later —
 * then read a **settled** frame: `followerTop == rowTop + height` (the
 * absolute stack has no gap). Only a settled frame is coherent; a racing
 * read pairs a fresh row height with a stale follower offset.
 *
 * @param row The row wrapper's locator.
 */
async function settledBounds(row: Locator): Promise<RowGeometry> {
  await expect
    .poll(async () => {
      const snap = await rowGeometry(row);
      return Math.abs(snap.followerTop - (snap.rowTop + snap.height));
    })
    .toBeLessThanOrEqual(1);
  return rowGeometry(row);
}

test('rows own the caption and the single Wrap; wrapping remeasures for real at 320 in both palettes', async ({
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

      // The row owns the language fact; the block renders no chrome of its
      // own, and the compact row keeps exactly one Wrap control.
      const fiveRow = page.locator(FIVE_ROW).first();
      const fiveWrap = fiveRow.locator('[data-fdt="script-code-wrap"]');
      await expect(fiveRow.locator('[data-fdt-code-block-lang]')).toHaveCount(0);
      await expect(fiveRow).toContainText('javascript · 5 lines');
      await expect(fiveWrap).toHaveCount(1);
      await expect(fiveWrap).toHaveAttribute('aria-pressed', 'false');

      /* Actual variable-height remeasure, on real sideways content: the
           expanded wide row scrolls horizontally (pre stays `pre`); wrapping
           folds its lines — the row's geometry grows, the following row
           slides down by the same shift (layout follows the measurement),
           the pre computes to `pre-wrap`, and no sideways scroll remains.
           Focus never leaves the pressed control. */
      const wideRow = page.locator(WIDE_ROW).first();
      const wideWrap = wideRow.locator('[data-fdt="script-code-wrap"]');
      await expect(wideRow).toContainText('javascript · 4 lines');
      await wideRow.scrollIntoViewIfNeeded();
      const expand = wideRow.getByRole('button', { name: 'Show all 4 lines' });
      await expand.click();
      const unwrapped = await settledBounds(wideRow);
      expect(unwrapped.preWhiteSpace).toBe('pre');
      expect(unwrapped.areaScrollWidth).toBeGreaterThan(unwrapped.areaClientWidth);
      await wideWrap.click();
      await expect(wideWrap).toBeFocused();
      await expect(wideWrap).toHaveAttribute('aria-pressed', 'true');
      const wrapped = await settledBounds(wideRow);
      expect(wrapped.preWhiteSpace).toBe('pre-wrap');
      expect(wrapped.areaScrollWidth).toBeLessThanOrEqual(wrapped.areaClientWidth);
      /* Actual variable-height remeasure: the fold grows the measured row,
         and the following row slides down by exactly that growth — layout
         follows the measurement, no stale remains. */
      const growth = wrapped.height - unwrapped.height;
      expect(growth).toBeGreaterThanOrEqual(20);
      expect(wrapped.followerTop - unwrapped.followerTop).toBeGreaterThanOrEqual(growth - 1);
      expect(wrapped.followerTop - unwrapped.followerTop).toBeLessThanOrEqual(growth + 1);
      // Expanded + wrapped stays at least as tall (no fold lost to layout).
      expect(wrapped.height).toBeGreaterThanOrEqual(unwrapped.height);
      await wideRow.getByRole('button', { name: 'Collapse' }).click();
      const collapsedWrapped = await rowGeometry(wideRow);
      expect(collapsedWrapped.height).toBeLessThan(wrapped.height);
      // Wrap state rides the collapse: still the single pressed toggle.
      await expect(wideWrap).toHaveAttribute('aria-pressed', 'true');

      /* Expand/collapse/wrap interplay on the five-line row: the flag
           rides the page-owned state across the text + clamp swap (expanded
           full text re-highlights); short lines do not fold, so its wrapped
           height matches its unwrapped expanded height; unwrap restores the
           plain clamped shape. */
      const showAll = fiveRow.getByRole('button', { name: 'Show all 5 lines' });
      await showAll.click();
      const expandedPlain = await settledBounds(fiveRow);
      expect(expandedPlain.height).toBeGreaterThan(80); // 5 whole lines, unclamped
      await fiveWrap.click();
      await expect(fiveWrap).toBeFocused();
      await expect(fiveWrap).toHaveAttribute('aria-pressed', 'true');
      const expandedWrapped = await settledBounds(fiveRow);
      expect(expandedWrapped.height).toBeGreaterThanOrEqual(expandedPlain.height - 2);
      await fiveRow.getByRole('button', { name: 'Collapse' }).click();
      await expect(showAll).toBeVisible();
      await expect(fiveWrap).toHaveAttribute('aria-pressed', 'true');
      await fiveWrap.click();
      await expect(fiveWrap).toHaveAttribute('aria-pressed', 'false');
      const rest = await settledBounds(fiveRow);
      expect(rest.height).toBeLessThan(expandedWrapped.height);
      // The block stayed chrome-less through the whole round.
      await expect(fiveRow.locator('[data-fdt-code-block-lang]')).toHaveCount(0);
      /* End each loop clean, so the next theme starts from false states. */
      await wideWrap.click();
      await expect(wideWrap).toHaveAttribute('aria-pressed', 'false');
    }
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('the wrapped flag survives a real virtual unmount/remount on scroll', async ({
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
    const fiveWrap = fiveRow.locator('[data-fdt="script-code-wrap"]');

    await fiveWrap.click();
    await expect(fiveWrap).toHaveAttribute('aria-pressed', 'true');

    // Scroll the wrapped row far out of the render window, then back. Deep
    // means really deep: the window moved onto far rows AND the wrapped row
    // itself fell out of it — otherwise every later "survives" assertion
    // would pass on a row that never unmounted.
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll'));
    });
    await expect(page.locator(DEEP_ROW)).toBeAttached(); // the window really moved
    await expect(page.locator(FIVE_ROW)).toHaveCount(0); // and the wrapped row really fell out
    await scroller.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event('scroll'));
    });
    await expect(fiveWrap).toHaveAttribute('aria-pressed', 'true');
    // Actually wrapped after the remount: the pre computes `pre-wrap`.
    const wrapped = await rowGeometry(fiveRow);
    expect(wrapped.preWhiteSpace).toBe('pre-wrap');
    expect(wrapped.areaScrollWidth).toBeLessThanOrEqual(wrapped.areaClientWidth);
    // A row that was never touched comes back with nothing to inherit.
    const wideRow = page.locator(WIDE_ROW).first();
    await wideRow.scrollIntoViewIfNeeded();
    await expect(wideRow.locator('[data-fdt="script-code-wrap"]')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

/**
 * Exactly one row per `ROW_ESTIMATES` shape — the shapes whose heights the
 * list's seeds name — plus one external padding row at the end so every
 * measured row keeps a following rendered row. Shapes are sized to the
 * member their seed denominates: the short seed's tallest member (three
 * lines, no toggle) is the honest one to check, not a shorter cousin.
 * @returns The fixture HTML.
 */
function seedShapesPage(): string {
  const five = [
    'const five0 = 0;',
    'const five1 = 1;',
    'const five2 = 2;',
    'const five3 = 3;',
    'const five4 = 4;'
  ].join('\n');
  const short = ['const short0 = 0;', 'const short1 = 1;', 'const short2 = 2;'].join('\n');
  return `<!doctype html><html lang="en"><head><title>Seed shapes</title></head>
    <body><h1>Seed shapes</h1>
    <script type="rocketlazyloadscript" data-rocket-src="https://example.test/a.js"></script>
    <script type="rocketlazyloadscript"></script>
    <script type="rocketlazyloadscript">${short}</script>
    <script type="rocketlazyloadscript">${five}</script>
    <script type="rocketlazyloadscript" data-rocket-src="https://example.test/b.js"></script>
    </body></html>`;
}

/**
 * One measured shape: its row locator in {@link seedShapesPage} (the text
 * only that row renders), the `ROW_ESTIMATES` seed it must stay honest to
 * (the int-rounded real sizes measured at the regular tier — mirrored here
 * as literals by convention for behavior pins), and whether the shape
 * carries code rows' 320 growth (a wrapped chips line).
 */
interface SeedShape {
  /** Probe for the row's `[data-index]` wrapper. */
  readonly marker: string;
  /** Mirrored from `ROW_ESTIMATES` (`script-view.ts`), px. */
  readonly seed: number;
  /** Whether the 320 growth assertion applies (code-carrying shapes). */
  readonly code: boolean;
}

/** The four seed shapes and their mirrored estimates. */
const SEED_SHAPES: readonly SeedShape[] = [
  { marker: '[data-index]:has(a[href$="a.js"])', seed: 37, code: true },
  { marker: '[data-index]:has-text("Empty inline script")', seed: 57, code: false },
  { marker: '[data-index]:has-text("short2 = 2")', seed: 115, code: true },
  { marker: '[data-index]:has-text("five1 = 1")', seed: 145, code: true }
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
  const { panel, fixture } = await openPanelForFixture(extension, '/seed-shapes.html', {
    bootHash: '#/javascript'
  });
  try {
    const page = panel.locator('[data-fdt-page="javascript"]');
    for (const shape of SEED_SHAPES) {
      await expect(page.locator(shape.marker)).toBeAttached();
    }

    // The regular tier — the one the seeds were measured at: every shape sits
    // on its seed (integer-rounded sizes stay within rounding).
    await panel.setViewportSize({ width: 1280, height: 800 });
    for (const shape of SEED_SHAPES) {
      const height = await stableRowHeight(page.locator(shape.marker));
      expect(Math.abs(height - shape.seed)).toBeLessThanOrEqual(1);
    }

    // 320 — a code row's chips line wraps and the row grows by ~26 px, so the
    // width-blind seed now underestimates: real growth stays within one chips
    // line of the seed (never negative, never wild). The blank shape has no
    // code line to add — it stays on its seed at both tiers.
    await panel.setViewportSize({ width: 320, height: 800 });
    for (const shape of SEED_SHAPES) {
      const height = await stableRowHeight(page.locator(shape.marker));
      if (shape.code) {
        const growth = height - shape.seed;
        expect(growth).toBeGreaterThanOrEqual(20);
        expect(growth).toBeLessThanOrEqual(40);
      } else {
        expect(Math.abs(height - shape.seed)).toBeLessThanOrEqual(1);
      }
    }
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
