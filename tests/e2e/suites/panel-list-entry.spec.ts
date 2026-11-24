/**
 * Tab entry into a scrolled virtual list: the entry press lands on a visible
 * row's control at the untouched scroll position (never an offscreen overscan
 * row and never a reveal jump), the interior Tab walk keeps reaching the
 * overscan-ahead rows, and no mask residue survives a press. Real panel,
 * real virtualizer, real keyboard, over the scripts, lazyload and headers
 * lists.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { expect, test, type ExtensionDriver } from '../helpers/extension';
import { openPanelForFixture, showPanelRoute } from '../helpers/panel-data';

/** Debugger injection keeps the accessibility engine outside extension CSP. */
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8'
);

/**
 * Build an inventory fixture without remote requests: enough scripts and
 * lazyload images for a multi-thousand-pixel deep scroll. Every sixth script
 * is an inline delay script with code, so any deep band mixes inline and
 * external rows; the rest are external markers.
 * @returns The fixture HTML.
 */
function inventoryPage(): string {
  const inlineCode = (index: number): string =>
    [
      `const fixtureA${String(index)} = 1;`,
      `const fixtureB${String(index)} = 2;`,
      `const fixtureC${String(index)} = 3;`,
      `const fixtureD${String(index)} = 4;`,
      `const fixtureE${String(index)} = 5;`,
      `const fixtureF${String(index)} = 6;`,
      `const fixtureG${String(index)} = 7;`,
      `const fixtureH${String(index)} = 8;`
    ].join('\n');
  const rows = Array.from({ length: 1200 }, (_, index) => {
    const url = `https://example.test/${String(index)}/script.js`;
    const inline =
      index % 6 === 5 ? `<script type="rocketlazyloadscript">${inlineCode(index)}</script>` : '';
    return `${inline}<script type="rocketlazyloadscript" data-rocket-src="${url}"></script>
      <img data-lazy-src="${url}" alt="Fixture ${String(index)}">`;
  });
  return `<!doctype html><html lang="en"><head><title>List entry fixture</title></head>
    <body><h1>List entry fixture</h1>${rows.join('')}</body></html>`;
}

/** The measured entry state the assertions read. */
interface EntryReading {
  /** The focused row's index (null when focus left the list). */
  row: string | null;
  /** The focused row's client-space top/bottom. */
  rowTop: number;
  rowBottom: number;
  /** The list's client-space band top/bottom. */
  bandTop: number;
  bandBottom: number;
  /** The list's scrollTop (px). */
  scrollTop: number;
  /** Rows carrying an `inert` attribute right now. */
  inert: number;
}

/** The `[data-fdt-page]` root per route under test. */
const ROUTES = {
  javascript: '[data-fdt-page="javascript"]',
  lazyload: '[data-fdt-page="lazyload"]',
  headers: '[data-fdt-page="headers-cookies"]'
} as const;

/**
 * Read the focused row geometry straight from the panel document.
 *
 * @param page The panel page.
 * @param pageSel The route root selector.
 */
async function readEntry(page: Page, pageSel: string): Promise<EntryReading> {
  return page.evaluate((sel) => {
    const scroller = document.querySelector(`${sel} [data-fdt="virtual-list"]`);
    // An emptied list unmounts its scroller entirely (the route's Show):
    // report no focus and no work rather than failing the read.
    if (!(scroller instanceof HTMLElement)) {
      return {
        row: null,
        rowTop: -1,
        rowBottom: -1,
        bandTop: 0,
        bandBottom: 0,
        scrollTop: 0,
        inert: document.querySelectorAll('[data-index][inert]').length
      };
    }
    const band = scroller.getBoundingClientRect();
    const focused = document.activeElement;
    const row = focused instanceof Element ? focused.closest('[data-index]') : null;
    const rect = row?.getBoundingClientRect();
    return {
      row: row?.getAttribute('data-index') ?? null,
      rowTop: rect?.top ?? -1,
      rowBottom: rect?.bottom ?? -1,
      bandTop: band.top,
      bandBottom: band.bottom,
      scrollTop: scroller.scrollTop,
      inert: document.querySelectorAll('[data-index][inert]').length
    };
  }, pageSel);
}

/**
 * Scroll the list deep and settle it with the band's top edge exactly at a
 * rendered row's start, so the band's first row is fully visible and an
 * entry there has zero work to do (the geometry the natural behavior fails
 * to give).
 *
 * The deep scroll reads the virtualizer's estimate-based extent, and row
 * starts keep shifting while the deep window's rows first mount and measure
 * (estimate → real heights), so the deterministic ground is the row that
 * actually occupies the band top once settled: jump to the middle of the
 * extent, then align to that row and re-verify across two settled reads.
 *
 * @param page The panel page.
 * @param pageSel The route root selector.
 * @param minIndex The aligned row must sit at least this deep (well past
 *   any overscan, so the natural entry would land offscreen).
 * @returns The settled band-top row's index.
 */
async function alignDeepScroll(page: Page, pageSel: string, minIndex: number): Promise<string> {
  // The one-shot read below needs the list itself, not just its page frame.
  await expect(page.locator(`${pageSel} [data-fdt="virtual-list"]`)).toBeAttached();
  await page.evaluate(
    ({ sel, min }: { sel: string; min: number }) => {
      const scroller = document.querySelector(`${sel} [data-fdt="virtual-list"]`);
      if (!(scroller instanceof HTMLElement)) throw new Error('list not mounted');
      // Half of the live extent: deep in the inventory with untouched rows
      // left below for the align step. The extent is estimate-based here,
      // so no fixed pixel constant is durable — a ratio is.
      scroller.scrollTop = Math.max(4_000, (scroller.scrollHeight - scroller.clientHeight) * 0.5);
      scroller.dispatchEvent(new Event('scroll'));
      const rows = Array.from(scroller.querySelectorAll<HTMLElement>('[data-index]'));
      const target = rows.findLast((row) => Number(row.dataset.index) >= min);
      if (!target) throw new Error('deep rows did not render');
    },
    { sel: pageSel, min: minIndex }
  );

  /**
   * One settled read of the list: two frames in, the row occupying the band
   * top (the deepest rendered start at or above the scroll position) plus
   * the current scrollTop.
   */
  const settle = async (): Promise<{
    index: string;
    start: number;
    scrollTop: number;
  }> =>
    page.evaluate(async (sel) => {
      // Two rAFs let a dispatched scroll re-render and the ResizeObserver
      // measure callbacks land before the read.
      await new Promise<void>((done) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            done();
          });
        });
      });
      const scroller = document.querySelector(`${sel} [data-fdt="virtual-list"]`);
      if (!(scroller instanceof HTMLElement)) throw new Error('list not mounted');
      let best: { index: string; start: number } | null = null;
      for (const row of scroller.querySelectorAll<HTMLElement>('[data-index]')) {
        const start = Number(/translateY\(([-\d.]+)px\)/.exec(row.style.transform)?.[1] ?? NaN);
        if (!Number.isFinite(start)) continue;
        // Sub-pixel slack: transforms land on rounded integer starts.
        if (start <= scroller.scrollTop + 0.5 && (best === null || start > best.start)) {
          best = { index: row.dataset.index ?? '', start };
        }
      }
      if (best === null) throw new Error('no band-top row rendered');
      return { ...best, scrollTop: scroller.scrollTop };
    }, pageSel);

  let previous: { index: string; start: number } | null = null;
  let state = await settle();
  for (let pass = 0; pass < 5; pass += 1) {
    // Done when the previously set row still occupies the band top at the
    // position it was set to — the render cascade has finished with it.
    if (previous?.index === state.index && Math.abs(state.scrollTop - state.start) < 0.5) {
      return state.index;
    }
    await page.evaluate(
      ({ sel, start }: { sel: string; start: number }) => {
        const scroller = document.querySelector(`${sel} [data-fdt="virtual-list"]`);
        if (!(scroller instanceof HTMLElement)) throw new Error('list not mounted');
        scroller.scrollTop = start;
        scroller.dispatchEvent(new Event('scroll'));
      },
      { sel: pageSel, start: state.start }
    );
    previous = state;
    state = await settle();
  }
  throw new Error(`band top never settled at or below ${String(minIndex)}`);
}

/**
 * Assert one entry reading: the focused row intersects the list's visible
 * band and no row is stuck inert after the press settles.
 *
 * @param reading The entry state.
 * @param fromBandStart When the aligned geometry promises a fully visible
 *   first row, the entry row may not sit overscan above the band top.
 */
function expectVisibleEntry(reading: EntryReading, fromBandStart = false): void {
  if (reading.row === null) throw new Error('focus did not enter a list row');
  expect(reading.rowTop, 'the focused row reaches into the band').toBeLessThan(reading.bandBottom);
  expect(reading.rowBottom, 'the focused row is not wholly above the band').toBeGreaterThan(
    reading.bandTop - 1
  );
  if (fromBandStart) {
    expect(
      reading.rowTop >= reading.bandTop - 1,
      'the entry row is not overscan above the band top'
    ).toBe(true);
  }
  expect(reading.inert, 'no mask residue after settlement').toBe(0);
}

/** The inert-row readback the residue assertions poll. */
function inertCount(panel: Page): Promise<number> {
  return panel.evaluate(() => document.querySelectorAll('[data-index][inert]').length);
}

/** The entry fixture's route pattern on the shared extension context. */
const ENTRY_PATTERN = '**/pipeline/list-entry.html*';

/**
 * Serve the entry fixture once for the calling test. Registration is
 * per test (never a `beforeEach` on the worker-scoped context), matching the
 * sibling suites: identical handlers must not stack across the run's tests,
 * so the caller unroutes {@link ENTRY_PATTERN} in its `finally`.
 *
 * @param extension The launched extension context driver.
 */
async function serveEntryFixture(extension: ExtensionDriver): Promise<void> {
  await extension.browserContext.route(ENTRY_PATTERN, async (route) => {
    await route.fulfill({ contentType: 'text/html', body: inventoryPage() });
  });
}

test('entry into a deep-scrolled scripts list targets the first visible row at zero scroll', async ({
  extension
}) => {
  await serveEntryFixture(extension);
  const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/list-entry.html', {
    bootHash: '#/javascript'
  });
  try {
    await panel.emulateMedia({ reducedMotion: 'reduce' });
    await panel.setViewportSize({ width: 1280, height: 800 });
    await expect(panel.locator(ROUTES.javascript)).toBeVisible();
    const alignedIndex = await alignDeepScroll(panel, ROUTES.javascript, 150);
    const before = await panel.evaluate(
      (sel) =>
        (document.querySelector(`${sel} [data-fdt="virtual-list"]`) as HTMLElement).scrollTop,
      ROUTES.javascript
    );

    // Tab from the search field: the natural target is a top-overscan row
    // several rows above the band — the masked entry must land on the first
    // fully visible row instead, with the scroll position untouched.
    await panel.locator(`${ROUTES.javascript} input[type="search"]`).focus();
    await panel.keyboard.press('Tab');
    const entry = await readEntry(panel, ROUTES.javascript);
    expectVisibleEntry(entry, true);
    expect(entry.row, 'the aligned band-start row is the entry target').toBe(alignedIndex);
    expect(entry.scrollTop, 'the band edge never moved').toBe(before);

    // The walk that follows still climbs beyond the band like it always did:
    // each step's focus stays a list row and the rendered window follows
    // (a band-edge trap would exhaust the budget and fail).
    let last = entry;
    let presses = 0;
    while (last.scrollTop <= before && presses < 60) {
      await panel.keyboard.press('Tab');
      last = await readEntry(panel, ROUTES.javascript);
      expect(last.row, 'the walk stayed inside the list').not.toBeNull();
      presses += 1;
    }
    expect(presses, 'the walk revealed rows past the band within its budget').toBeLessThan(60);
    expect(last.scrollTop).toBeGreaterThan(before);
    expect(await inertCount(panel)).toBe(0);
  } finally {
    await panel.close();
    await fixture.page.close();
    await extension.browserContext.unroute(ENTRY_PATTERN);
  }
});

test('backward entry from below the list targets the last visible row', async ({ extension }) => {
  await serveEntryFixture(extension);
  const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/list-entry.html', {
    bootHash: '#/javascript'
  });
  try {
    await panel.emulateMedia({ reducedMotion: 'reduce' });
    await panel.setViewportSize({ width: 1280, height: 800 });
    await expect(panel.locator(ROUTES.javascript)).toBeVisible();
    // The focus lives below the list; a backward entry press must enter at
    // the last visible row, never at the bottom-overscan cluster the natural
    // navigation prefers. The shell has no focusable after the page canvas
    // (its answers live in the top bar, above it), so a focusable sentinel
    // right after the rail-and-content row stands in for "Shift+Tab from
    // below the list". It takes layout height (the content row shrinks), so
    // it goes in first and the list is aligned and measured with it there.
    await panel.evaluate(() => {
      const row = document.querySelector('[data-fdt="panel-content"]')?.parentElement;
      if (row === null || row === undefined) throw new Error('content row not mounted');
      const sentinel = document.createElement('button');
      sentinel.type = 'button';
      sentinel.dataset.e2eBelowList = '';
      sentinel.textContent = 'below the list';
      row.after(sentinel);
    });
    await alignDeepScroll(panel, ROUTES.javascript, 150);
    // Focused before the measure: a focus that scrolls anything is measured too.
    const below = panel.locator('[data-e2e-below-list]');
    await below.focus();
    const before = await panel.evaluate(
      (sel) =>
        (document.querySelector(`${sel} [data-fdt="virtual-list"]`) as HTMLElement).scrollTop,
      ROUTES.javascript
    );
    // The expected target is the exact row the natural navigation must reach
    // once the off-band rows are masked: the last row intersecting the
    // content band (the same border-aware band the mask plans against).
    const lastBandIndex = await panel.evaluate((sel) => {
      const scroller = document.querySelector(`${sel} [data-fdt="virtual-list"]`);
      if (!(scroller instanceof HTMLElement)) throw new Error('list not mounted');
      const spacer = scroller.querySelector<HTMLElement>(':scope > [data-fdt-virtual-spacer]');
      if (spacer === null) throw new Error('list spacer missing');
      const box = scroller.getBoundingClientRect();
      const contentTop = box.top + scroller.clientTop;
      const contentBottom = box.bottom - (box.height - scroller.clientHeight - scroller.clientTop);
      let last: string | null = null;
      for (const row of spacer.querySelectorAll<HTMLElement>(':scope > [data-index]')) {
        const rect = row.getBoundingClientRect();
        if (rect.bottom > contentTop && rect.top < contentBottom) last = row.dataset.index ?? null;
      }
      if (last === null) throw new Error('no band row rendered');
      return last;
    }, ROUTES.javascript);
    await panel.keyboard.press('Shift+Tab');
    const entry = await readEntry(panel, ROUTES.javascript);
    expectVisibleEntry(entry);
    expect(entry.row, 'the backward entry lands the last visible band row').toBe(lastBandIndex);
    // The reveal must go downward only (the pressed row's own lower controls
    // come into view; their amount is the browser's own reveal semantics).
    expect(entry.scrollTop - before).toBeGreaterThanOrEqual(0);
  } finally {
    await panel.close();
    await fixture.page.close();
    await extension.browserContext.unroute(ENTRY_PATTERN);
  }
});

test('a real row remeasure (compact rows stack their chips) keeps the entry geometry honest', async ({
  extension
}) => {
  await serveEntryFixture(extension);
  const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/list-entry.html', {
    bootHash: '#/javascript'
  });
  try {
    await panel.emulateMedia({ reducedMotion: 'reduce' });
    await panel.setViewportSize({ width: 1280, height: 800 });
    await expect(panel.locator(ROUTES.javascript)).toBeVisible();
    // Variable heights for real: narrowed to the compact tier, every row
    // stacks its chips onto a third line, so each rendered row remeasures
    // (taller) while the list sits deep — the virtualizer's offsets move
    // under the band, the work the entry geometry must stay honest through.
    await alignDeepScroll(panel, ROUTES.javascript, 150);
    // Every row carries a chip (all delayed), so any rendered row tells the height.
    const rowHeight = (): Promise<number> =>
      panel
        .locator(`${ROUTES.javascript} [data-fdt="virtual-list"] [data-index]`)
        .first()
        .evaluate((row) => row.getBoundingClientRect().height);
    const regularHeight = await rowHeight();
    await panel.setViewportSize({ width: 420, height: 800 });
    const bar = panel.locator(`${ROUTES.javascript} [data-fdt="facet-bar"]`);
    await expect(bar).toHaveAttribute('data-fdt-compact', '');
    await expect.poll(rowHeight).toBeGreaterThan(regularHeight);
    const alignedIndex = await alignDeepScroll(panel, ROUTES.javascript, 150);
    const before = await panel.evaluate(
      (sel) =>
        (document.querySelector(`${sel} [data-fdt="virtual-list"]`) as HTMLElement).scrollTop,
      ROUTES.javascript
    );
    // The compact bar's last control before the list is its Filters button.
    await bar.locator('[data-fdt="facet-filters-button"]').focus();
    await panel.keyboard.press('Tab');
    const entry = await readEntry(panel, ROUTES.javascript);
    expectVisibleEntry(entry, true);
    expect(entry.row, 'the settled band-top row stays the entry target').toBe(alignedIndex);
    expect(entry.scrollTop, 'the band edge never moved').toBe(before);
    await expect.poll(() => inertCount(panel)).toBe(0);
    // The accessibility engine passes over the changed, deep-scrolled state.
    await panel.evaluate(AXE_SOURCE);
    const audit = await panel.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((done) => {
        requestAnimationFrame(() => {
          done();
        });
      });
      const axe = (
        window as unknown as { axe: { run: () => Promise<{ violations: { id: string }[] }> } }
      ).axe;
      return (await axe.run()).violations.map((rule) => rule.id);
    });
    expect(audit).toEqual([]);
  } finally {
    await panel.close();
    await fixture.page.close();
    await extension.browserContext.unroute(ENTRY_PATTERN);
  }
});

test('an emptied list keeps navigation intact with no residue', async ({ extension }) => {
  await serveEntryFixture(extension);
  const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/list-entry.html', {
    bootHash: '#/javascript'
  });
  try {
    await panel.emulateMedia({ reducedMotion: 'reduce' });
    await panel.setViewportSize({ width: 1280, height: 800 });
    await expect(panel.locator(ROUTES.javascript)).toBeVisible();
    await alignDeepScroll(panel, ROUTES.javascript, 150);
    const search = panel.locator(`${ROUTES.javascript} input[type="search"]`);
    await search.fill('__none-matches-this__');
    await expect
      .poll(() => panel.evaluate(() => document.querySelectorAll('[data-index]').length))
      .toBe(0);
    // No rows: the mask has nothing to do and navigation must not hang.
    await search.focus();
    await panel.keyboard.press('Tab');
    const emptied = await readEntry(panel, ROUTES.javascript);
    expect(emptied.row).toBeNull();
    // Esc restores the full list (the field's own rule); entry works again.
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await search.focus();
    await panel.keyboard.press('Tab');
    const restored = await readEntry(panel, ROUTES.javascript);
    expectVisibleEntry(restored, true);
  } finally {
    await panel.close();
    await fixture.page.close();
    await extension.browserContext.unroute(ENTRY_PATTERN);
  }
});

test('resource lists compute the same entry from their top control', async ({ extension }) => {
  await serveEntryFixture(extension);
  const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/list-entry.html', {
    bootHash: '#/lazyload'
  });
  try {
    await panel.emulateMedia({ reducedMotion: 'reduce' });
    await panel.setViewportSize({ width: 1280, height: 800 });
    await expect(panel.locator(ROUTES.lazyload)).toBeVisible();
    const alignedIndex = await alignDeepScroll(panel, ROUTES.lazyload, 60);
    await panel.locator(`${ROUTES.lazyload} input[type="search"]`).focus();
    await panel.keyboard.press('Tab');
    const entry = await readEntry(panel, ROUTES.lazyload);
    expectVisibleEntry(entry, true);
    expect(entry.row, 'the aligned band-start row is the entry target').toBe(alignedIndex);
    expect(await inertCount(panel)).toBe(0);
  } finally {
    await panel.close();
    await fixture.page.close();
    await extension.browserContext.unroute(ENTRY_PATTERN);
  }
});

test('a flooded captured headers list still enters and walks out cleanly', async ({
  extension
}) => {
  // The flood serves more than the 256-row capture cap: a deep (capped)
  // inventory where the natural entry would land far offscreen. Its rows all
  // carry copy controls, so the entry must resolve to the aligned band-start
  // row exactly.
  const { panel, fixture } = await openPanelForFixture(extension, '/__e2e/header-flood');
  try {
    await panel.emulateMedia({ reducedMotion: 'reduce' });
    await panel.setViewportSize({ width: 1280, height: 800 });
    await showPanelRoute(panel, 'headers-cookies');
    const alignedIndex = await alignDeepScroll(panel, ROUTES.headers, 60);
    const all = panel.locator(ROUTES.headers).getByRole('button', { name: 'All headers' });
    await all.focus();
    // Two real focusables live between the page action and the list: the
    // fetched stamp's tooltip trigger and the name filter's search field.
    // Each takes one press as an intermediate stop (no rows walked into, no
    // residue), and the third press is the entry.
    await panel.keyboard.press('Tab');
    expect((await readEntry(panel, ROUTES.headers)).row).toBeNull();
    expect(await inertCount(panel)).toBe(0);
    await panel.keyboard.press('Tab');
    expect((await readEntry(panel, ROUTES.headers)).row).toBeNull();
    expect(await inertCount(panel)).toBe(0);
    await panel.keyboard.press('Tab');
    const entry = await readEntry(panel, ROUTES.headers);
    expectVisibleEntry(entry, true);
    expect(entry.row, 'the aligned band-start row is the entry target').toBe(alignedIndex);
    // Walk back out through the top edge: the interior walk's first shift
    // press reaches the overscan-ahead row above the band (the walk's
    // window-following promise), then the walk keeps going — each step
    // reveals the next row above — until it leaves the list.
    await panel.keyboard.press('Shift+Tab');
    expect(
      (await readEntry(panel, ROUTES.headers)).row,
      'the first interior shift reaches the overscan-ahead row'
    ).toBe(String(Number(alignedIndex) - 1));
    let presses = 0;
    let walked = await readEntry(panel, ROUTES.headers);
    expect(walked.inert).toBe(0);
    // The interior walk consumes one row per press (backward traversal steps
    // element-wise, each step revealing the next row above), so the bound is
    // the aligned depth plus the forward walk's 60-press headroom — generous
    // enough that a second focusable on the headers row cannot silently
    // starve the walk.
    while (walked.row !== null && presses < Number(alignedIndex) + 60) {
      await panel.keyboard.press('Shift+Tab');
      walked = await readEntry(panel, ROUTES.headers);
      presses += 1;
    }
    expect(walked.row, 'the walk leaves the list through its top edge').toBeNull();
    expect(await inertCount(panel)).toBe(0);
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
