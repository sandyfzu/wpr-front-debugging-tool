/**
 * The detail layout in the real browser (owner round P23.2): the side pane
 * takes a share of the list width (half by default) and grows with the
 * panel; its splitter drags (pointer) and steps (keyboard), resets on a
 * double-click, persists as a share across a panel reload and re-clamps on a
 * resize (the list keeps its 480 px floor); the drill-in detail stays one
 * column across its whole width range (source tile and code full width);
 * detail code comes last, grows with its content up to the view's height
 * and scrolls inside past it (whole once scrolled to, short docks and the
 * drill-in included), short code stays compact, minified code opens wrapped;
 * the wheel over half-shown code scrolls the panel and the view first (each
 * tick landing once), then the code, short docks included; a
 * plain click on the splitter stores nothing, Esc mid-drag keeps the shown
 * width; short docks raise no ResizeObserver loop error; and on a 5,000-row
 * list neither a splitter drag nor opening big code runs a long task over
 * 50 ms.
 *
 * The fixture is generated per run (never committed): {@link ROWS} delayed
 * external scripts, one hand-written inline script of {@link BIG_LINES}
 * lines, one minified inline script, one one-liner; plus a minified inline
 * style of ~180 000 characters (past the highlight limit: plain, wrapped).
 */
import type { Locator, Page } from '@playwright/test';
import type { ExtensionDriver } from '../helpers/extension';
import { expect, test } from '../helpers/extension';
import { settleFrames } from '../helpers/frames';
import { openPanelForFixture, type InspectedPanel } from '../helpers/panel-data';

/** The fixture path (served by the route below). */
const FIXTURE_PATH = '/pipeline/detail-width.html';

/** Delayed external scripts on the fixture (the P-3 list size). */
const ROWS = 5_000;

/** Lines of the hand-written inline script. */
const BIG_LINES = 400;

/** The storage key of the pane share (`local:` area). */
const SHARE_KEY = 'panel-detail-share';

/** The list floor beside a pane and the pane floor (UI bar L-3). */
const LIST_MIN = 480;
const PANE_MIN = 350;

/** The hand-written script: many short lines. */
function bigScript(): string {
  return Array.from(
    { length: BIG_LINES },
    (_, line) => `  const handler${String(line)} = () => window.dispatchEvent(new Event('x'));`
  ).join('\n');
}

/** A minified script: one ~19 000-character line (under the highlight limit). */
function minifiedScript(): string {
  return `(()=>{${'var a=document.querySelector("#x");a&&a.remove();'.repeat(360)}})();`;
}

/** A minified style of ~180 000 characters (plain past the highlight limit). */
function hugeStyle(): string {
  return '.card>.title{color:#333;margin:0 0 4px;font-weight:600}'.repeat(3_300);
}

/** The fixture page. */
function fixtureHtml(): string {
  const externals = Array.from(
    { length: ROWS },
    (_, index) =>
      `<script type="rocketlazyloadscript" data-rocket-src="https://example.test/js/row-${String(index).padStart(4, '0')}.js"></script>`
  ).join('');
  return `<!doctype html><html lang="en"><head><title>Detail width</title>
    <style id="huge-style">${hugeStyle()}</style>
    <style id="tiny-style">.tiny{color:red}</style></head>
    <body><h1>Detail width</h1>
    <script type="rocketlazyloadscript" id="big-script">${bigScript()}</script>
    <script type="rocketlazyloadscript" id="minified-script">${minifiedScript()}</script>
    <script id="tiny-script">window.tinyOne = 1;</script>
    ${externals}</body></html>`;
}

/** The long-task collector, armed before the panel's modules. */
const PERF_OBSERVER = `(() => {
  const collector = { phase: 'cold', tasks: [] };
  collector.observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) collector.tasks.push({ phase: collector.phase, duration: entry.duration });
  });
  collector.observer.observe({ type: 'longtask', buffered: false });
  window.__fdtDetailPerf = collector;
})();`;

/** The panel's page errors (`window` error events), collected from boot. */
const PAGE_ERRORS = `(() => {
  window.__fdtPageErrors = [];
  addEventListener('error', (event) => window.__fdtPageErrors.push(String(event.message)));
})();`;

/** The page errors seen so far. */
async function pageErrors(panel: Page): Promise<string[]> {
  return panel.evaluate(() => [
    ...(window as unknown as { __fdtPageErrors: string[] }).__fdtPageErrors
  ]);
}

/** The detail view (pane or drill body) and its source code area, measured. */
async function codeView(panel: Page) {
  await settleFrames(panel);
  return panel.evaluate(() => {
    const view = (document.querySelector('[data-fdt="detail-pane"]') ??
      document.querySelector('[data-fdt="drill-body"]')) as HTMLElement;
    const area = document.querySelector(
      '[data-fdt="script-source"] [data-fdt-code-area]'
    ) as HTMLElement;
    const content = document.querySelector('[data-fdt="panel-content"]') as HTMLElement;
    const v = view.getBoundingClientRect();
    const a = area.getBoundingClientRect();
    const c = content.getBoundingClientRect();
    const viewTop = v.top + view.clientTop;
    const top = Math.max(viewTop, c.top);
    const bottom = Math.min(viewTop + view.clientHeight, c.bottom, innerHeight);
    return {
      outerScroll: content.scrollTop,
      viewScroll: view.scrollTop,
      viewMax: view.scrollHeight - view.clientHeight,
      codeScroll: area.scrollTop,
      codeMax: area.scrollHeight - area.clientHeight,
      /** The whole code area (its scrollbar ends included) is on screen. */
      whole: a.top >= top - 0.5 && a.bottom <= bottom + 0.5,
      /** Where to point at the code's visible part (null: none of it shows). */
      aim:
        Math.min(a.bottom, bottom) - Math.max(a.top, top) < 8
          ? null
          : { x: a.left + a.width / 2, y: (Math.max(a.top, top) + Math.min(a.bottom, bottom)) / 2 }
    };
  });
}

/** Scroll the detail view and the content region to their ends. */
async function scrollToEnds(panel: Page): Promise<void> {
  await panel.evaluate(() => {
    for (const hook of ['detail-pane', 'drill-body', 'panel-content']) {
      const element = document.querySelector<HTMLElement>(`[data-fdt="${hook}"]`);
      if (element !== null) element.scrollTop = element.scrollHeight;
    }
  });
  await settleFrames(panel);
}

/** The collector's shape. */
interface PerfCollector {
  phase: string;
  tasks: { phase: string; duration: number }[];
}

/** Switch the collector's phase. */
async function setPhase(panel: Page, phase: string): Promise<void> {
  await panel.evaluate((next) => {
    (window as unknown as { __fdtDetailPerf: PerfCollector }).__fdtDetailPerf.phase = next;
  }, phase);
}

/** The longest task recorded in a phase (ms). */
async function longest(panel: Page, phase: string): Promise<number> {
  return panel.evaluate((wanted) => {
    const tasks = (window as unknown as { __fdtDetailPerf: PerfCollector }).__fdtDetailPerf.tasks;
    return Math.max(0, ...tasks.filter((t) => t.phase === wanted).map((t) => t.duration));
  }, phase);
}

/** The stored share, as the background reads it. */
async function storedShare(extension: ExtensionDriver): Promise<unknown> {
  return extension.evaluateInWorker(async (key: string) => {
    const stored = await chrome.storage.local.get(key);
    return stored[key];
  }, SHARE_KEY);
}

/** Forget the stored share (the extension is shared across the file's tests). */
async function clearShare(extension: ExtensionDriver): Promise<void> {
  await extension.evaluateInWorker(async (key: string) => {
    await chrome.storage.local.remove(key);
  }, SHARE_KEY);
}

/**
 * Open a route on the fixture at a size, booted into reduced motion.
 *
 * @param extension The extension driver.
 * @param route The route id.
 * @param size The panel viewport.
 * @param perf Arm the long-task collector (else the page-error collector).
 * @param colorScheme The palette.
 */
async function openRoute(
  extension: ExtensionDriver,
  route: 'javascript' | 'stylesheets',
  size: { width: number; height: number },
  perf = false,
  colorScheme: 'dark' | 'light' = 'dark'
): Promise<InspectedPanel> {
  const opened = await openPanelForFixture(extension, FIXTURE_PATH, {
    bootHash: `#/${route}`,
    viewport: size,
    emulation: { colorScheme, reducedMotion: 'reduce' },
    panelInit: perf ? PERF_OBSERVER : PAGE_ERRORS
  });
  await expect(opened.panel.locator('[data-fdt-row-open]').first()).toBeVisible({
    timeout: 30_000
  });
  return opened;
}

/** A row's open button by the text its row shows (name or preview). */
function rowOpen(panel: Page, text: string): Locator {
  return panel
    .locator('[data-fdt="calm-list-rows"] [role="listitem"]', { hasText: text })
    .first()
    .locator('[data-fdt-row-open]');
}

/**
 * Open a script row's detail and wait until it stops moving: the served tag
 * above the source is read on open (a skeleton line until it answers), so
 * the code sits higher until the tag lands — positions measured before that
 * shift by the tag's height.
 */
async function openSettledScript(panel: Page, text: string): Promise<void> {
  await rowOpen(panel, text).click();
  await expect(panel.locator('[data-fdt="script-source"] [data-fdt-code-area]')).toBeVisible();
  await expect(
    panel.locator('[data-fdt="script-served-tag"] [data-fdt="code-block"]')
  ).toBeVisible();
  await settleFrames(panel);
}

/** The calm list root (its width is the pane's content width). */
function calmList(panel: Page): Locator {
  return panel.locator('[data-fdt="calm-list"]').first();
}

/** An element's rounded box width. */
async function widthOf(locator: Locator): Promise<number> {
  return locator.evaluate((element) => Math.round(element.getBoundingClientRect().width));
}

/** The pane frame's width once it settles. */
async function paneWidth(panel: Page): Promise<number> {
  await settleFrames(panel);
  return widthOf(panel.locator('[data-fdt="detail-pane-frame"]'));
}

/** The default pane width (half, clamped) for the list's current width. */
async function expectedDefault(panel: Page): Promise<number> {
  const list = await calmList(panel).evaluate((element) => element.clientWidth);
  return Math.min(list - LIST_MIN, Math.max(PANE_MIN, Math.round(list / 2)));
}

test.beforeEach(async ({ extension }) => {
  await clearShare(extension);
  await extension.browserContext.route(`**${FIXTURE_PATH}*`, async (route) => {
    await route.fulfill({ contentType: 'text/html', body: fixtureHtml() });
  });
});

test.afterEach(async ({ extension }) => {
  await extension.browserContext.unroute(`**${FIXTURE_PATH}*`);
  await clearShare(extension);
});

test('the pane takes half the list width, grows with the panel and keeps both floors', async ({
  extension
}) => {
  const { panel, fixture } = await openRoute(extension, 'javascript', {
    width: 1280,
    height: 800
  });
  try {
    await rowOpen(panel, 'Inline script #3').click();
    await expect(panel.locator('[data-fdt="detail-pane"]')).toBeVisible();
    const at1280 = await paneWidth(panel);
    expect(Math.abs(at1280 - (await expectedDefault(panel)))).toBeLessThanOrEqual(1);
    await panel.setViewportSize({ width: 1600, height: 800 });
    const at1600 = await paneWidth(panel);
    expect(at1600).toBeGreaterThan(at1280);
    expect(Math.abs(at1600 - (await expectedDefault(panel)))).toBeLessThanOrEqual(1);
    // Just past the split width: both floors meet, the list keeps its 480.
    await panel.setViewportSize({ width: 920, height: 800 });
    await settleFrames(panel);
    await expect(calmList(panel)).toHaveAttribute('data-fdt-layout', 'pane');
    const list = await widthOf(panel.locator('[data-fdt="calm-list-rows"]'));
    expect(list).toBeGreaterThanOrEqual(LIST_MIN);
    expect(await paneWidth(panel)).toBeGreaterThanOrEqual(PANE_MIN);
    // No horizontal scroll anywhere in the content.
    expect(
      await panel.evaluate(() => {
        const main = document.querySelector('main');
        return main === null ? -1 : main.scrollWidth - main.clientWidth;
      })
    ).toBe(0);
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('the splitter drags, steps, resets, persists across a reload and re-clamps on a resize', async ({
  extension
}) => {
  const { panel, fixture } = await openRoute(extension, 'javascript', {
    width: 1400,
    height: 800
  });
  try {
    await rowOpen(panel, 'Inline script #3').click();
    const splitter = panel.getByRole('separator', { name: 'Resize details' });
    await expect(splitter).toBeVisible();
    const start = await paneWidth(panel);
    // Pointer: press on the splitter, travel 100 px left in steps, release.
    const box = await splitter.boundingBox();
    if (box === null) throw new Error('the splitter has no box');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await panel.mouse.move(x, y);
    await panel.mouse.down();
    await expect(panel.locator('[data-fdt="detail-splitter-shield"]')).toBeVisible();
    for (let step = 1; step <= 5; step += 1) await panel.mouse.move(x - step * 20, y);
    await panel.mouse.up();
    await expect(panel.locator('[data-fdt="detail-splitter-shield"]')).toHaveCount(0);
    const dragged = await paneWidth(panel);
    const list = await calmList(panel).evaluate((element) => element.clientWidth);
    expect(Math.abs(dragged - Math.min(start + 100, list - LIST_MIN))).toBeLessThanOrEqual(1);
    expect(dragged).toBeGreaterThan(start);
    await expect.poll(() => storedShare(extension)).toBeCloseTo(dragged / list, 2);

    // Keyboard: ← grows by 16, Home/End jump to the floors.
    await splitter.focus();
    await panel.keyboard.press('ArrowLeft');
    expect(await paneWidth(panel)).toBe(dragged + 16);
    await panel.keyboard.press('Home');
    expect(await paneWidth(panel)).toBe(PANE_MIN);
    await panel.keyboard.press('End');
    expect(await paneWidth(panel)).toBe(list - LIST_MIN);
    // Esc on the splitter closes the pane, like anywhere in it.
    await panel.keyboard.press('Escape');
    await expect(panel.locator('[data-fdt="detail-pane"]')).toHaveCount(0);

    // Persisted: a reloaded panel opens the pane at the stored share. (The
    // sidebar folds once the pane is back: measure after it settled.)
    await rowOpen(panel, 'Inline script #3').click();
    await settleFrames(panel);
    const listNow = await calmList(panel).evaluate((element) => element.clientWidth);
    await panel.getByRole('separator', { name: 'Resize details' }).focus();
    await panel.keyboard.press('Home');
    await panel.keyboard.press('ArrowLeft');
    const kept = PANE_MIN + 16;
    await expect.poll(() => storedShare(extension)).toBeCloseTo(kept / listNow, 3);
    await panel.reload({ waitUntil: 'load' });
    await expect(panel.locator('[data-fdt-row-open]').first()).toBeVisible({ timeout: 30_000 });
    await rowOpen(panel, 'Inline script #3').click();
    expect(Math.abs((await paneWidth(panel)) - kept)).toBeLessThanOrEqual(1);

    // A wide share re-clamps on a narrower panel (the list keeps 480 px).
    await panel.getByRole('separator', { name: 'Resize details' }).focus();
    await panel.keyboard.press('End');
    await panel.setViewportSize({ width: 1000, height: 800 });
    await settleFrames(panel);
    await expect(calmList(panel)).toHaveAttribute('data-fdt-layout', 'pane');
    expect(await widthOf(panel.locator('[data-fdt="calm-list-rows"]'))).toBeGreaterThanOrEqual(
      LIST_MIN
    );

    // Double-click: back to half, the stored share forgotten.
    await panel.getByRole('separator', { name: 'Resize details' }).dblclick();
    expect(Math.abs((await paneWidth(panel)) - (await expectedDefault(panel)))).toBeLessThanOrEqual(
      1
    );
    await expect.poll(() => storedShare(extension)).toBeUndefined();
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

/** The right edges (px) of the page canvas, its controls, the list and the pane. */
async function rightEdges(panel: Page) {
  await settleFrames(panel);
  return panel.evaluate(() => {
    const right = (selector: string): number | null => {
      const element = document.querySelector(selector);
      return element === null ? null : Math.round(element.getBoundingClientRect().right);
    };
    const body = document.querySelector('[data-fdt="page-body"]') as HTMLElement;
    const region = document.querySelector('[data-fdt="panel-content"]') as HTMLElement;
    return {
      bodyWidth: Math.round(body.getBoundingClientRect().width),
      regionWidth: region.clientWidth,
      canvas: body.dataset.fdtCanvas,
      bodyContent: Math.round(body.getBoundingClientRect().right - 12),
      summary: right('[data-fdt="script-summary"]'),
      search: right('[data-fdt="search-field"]'),
      list: right('[data-fdt="calm-list"]'),
      pane: right('[data-fdt="detail-pane-frame"]')
    };
  });
}

test('wide panels: one aligned 80 rem block without a pane; list + pane span the content with one', async ({
  extension
}) => {
  for (const width of [1600, 1920, 2560]) {
    const { panel, fixture } = await openRoute(extension, 'javascript', { width, height: 800 });
    try {
      const closed = await rightEdges(panel);
      const at = `${String(width)} no pane`;
      expect(closed.canvas, at).toBe('standard');
      expect(closed.bodyWidth, at).toBe(Math.min(closed.regionWidth, 1280));
      // Search, summary strip and list end at the canvas's content edge.
      for (const edge of [closed.summary, closed.search, closed.list]) {
        expect(edge, at).not.toBeNull();
        expect(Math.abs((edge ?? 0) - closed.bodyContent), at).toBeLessThanOrEqual(1);
      }
      await rowOpen(panel, 'Inline script #1').click();
      await expect(panel.locator('[data-fdt="detail-pane"]')).toBeVisible();
      const open = await rightEdges(panel);
      const withPane = `${String(width)} pane`;
      expect(open.canvas, withPane).toBe('full');
      expect(open.bodyWidth, withPane).toBe(open.regionWidth);
      // The pane ends where the controls do: one block, the whole width.
      expect(Math.abs((open.pane ?? 0) - open.bodyContent), withPane).toBeLessThanOrEqual(1);
      expect(Math.abs((open.search ?? 0) - open.bodyContent), withPane).toBeLessThanOrEqual(1);
      expect(await paneWidth(panel), withPane).toBe(await expectedDefault(panel));
      await panel.locator('[data-fdt="detail-close"]').click();
      await expect(panel.locator('[data-fdt="detail-pane"]')).toHaveCount(0);
      expect((await rightEdges(panel)).canvas, `${String(width)} closed again`).toBe('standard');
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  }
});

test('the drill-in detail stays one column at every drill width: tile and code full width', async ({
  extension
}) => {
  const { panel, fixture } = await openRoute(extension, 'javascript', {
    width: 320,
    height: 800
  });
  try {
    for (const text of ['row-0000.js', 'Inline script #1']) {
      for (let width = 320; width <= 880; width += 40) {
        await panel.setViewportSize({ width, height: 800 });
        await settleFrames(panel);
        if ((await calmList(panel).getAttribute('data-fdt-layout')) !== 'drill') continue;
        if ((await panel.locator('[data-fdt="drill-detail"]').count()) === 0) {
          await rowOpen(panel, text).click();
        }
        const geometry = await panel.evaluate(() => {
          const body = document.querySelector('[data-fdt="drill-body"]');
          const blocks = [
            ...document.querySelectorAll(
              '[data-fdt="drill-body"] [data-fdt="source-link"], [data-fdt="drill-body"] [data-fdt="code-block"]'
            )
          ];
          if (body === null) return null;
          const inner = body.getBoundingClientRect();
          return {
            overflow: body.scrollWidth - body.clientWidth,
            blocks: blocks.map((block) => {
              const rect = block.getBoundingClientRect();
              return { left: Math.round(rect.left - inner.left), width: Math.round(rect.width) };
            }),
            content: Math.round(body.clientWidth)
          };
        });
        expect(geometry, `drill body at ${String(width)} px`).not.toBeNull();
        if (geometry === null) continue;
        expect(geometry.overflow, `no sideways scroll at ${String(width)} px`).toBe(0);
        expect(geometry.blocks.length).toBeGreaterThan(0);
        for (const block of geometry.blocks) {
          // Every tile and code block starts at the body's edge and spans it.
          expect(block.left, `${text} at ${String(width)} px`).toBe(0);
          expect(
            geometry.content - block.width,
            `${text} at ${String(width)} px`
          ).toBeLessThanOrEqual(1);
        }
      }
      await panel.locator('[data-fdt="drill-back"]').click();
    }
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('detail code comes last, grows to the view and scrolls inside past it; short code stays compact; minified opens wrapped', async ({
  extension
}) => {
  const { panel, fixture } = await openRoute(extension, 'javascript', {
    width: 1280,
    height: 800
  });
  try {
    const sourceArea = panel.locator('[data-fdt="script-source"] [data-fdt-code-area]');
    // Hand-written, 400 lines: capped to the pane's height, scrolls inside.
    await rowOpen(panel, 'Inline script #1').click();
    const big = await sourceArea.evaluate((area) => {
      const pane = area.closest('[data-fdt="detail-pane"]') as HTMLElement;
      const padding = Number.parseFloat(getComputedStyle(pane).paddingTop) * 2;
      return {
        height: area.clientHeight,
        scrolls: area.scrollHeight > area.clientHeight,
        paneContent: pane.clientHeight - padding,
        // Nothing follows the source section in the detail body.
        last: area.closest('[data-fdt="script-source"]')?.nextElementSibling === null
      };
    });
    const rem = 16;
    expect(big.scrolls).toBe(true);
    expect(big.last).toBe(true);
    expect(big.height).toBeGreaterThan(300);
    expect(big.height).toBeLessThanOrEqual(
      Math.min(big.paneContent, Math.max(10 * rem, big.paneContent - 3.5 * rem)) + 1
    );
    await expect(
      panel.locator('[data-fdt="script-source"] [data-fdt-code-block-wrap]')
    ).toHaveAttribute('aria-pressed', 'false');
    // The served tag sits above it, in view without scrolling the pane.
    await expect(panel.locator('[data-fdt="script-served-tag"]')).toBeInViewport();
    // Scrolled to the end, the whole code area shows (both scrollbar ends).
    await scrollToEnds(panel);
    expect((await codeView(panel)).whole).toBe(true);

    // A one-liner: natural height, no inner scroll.
    await rowOpen(panel, 'Inline script #3').click();
    const tiny = await sourceArea.evaluate((area) => ({
      height: area.clientHeight,
      scrolls: area.scrollHeight > area.clientHeight
    }));
    expect(tiny.scrolls).toBe(false);
    expect(tiny.height).toBeLessThan(60);

    // Minified: opens wrapped, no sideways scroll, capped and scrolling down.
    await rowOpen(panel, 'Inline script #2').click();
    await expect(
      panel.locator('[data-fdt="script-source"] [data-fdt-code-block-wrap]')
    ).toHaveAttribute('aria-pressed', 'true');
    const minified = await sourceArea.evaluate((area) => ({
      sideways: area.scrollWidth - area.clientWidth,
      scrolls: area.scrollHeight > area.clientHeight,
      height: area.clientHeight
    }));
    expect(minified.sideways).toBe(0);
    expect(minified.scrolls).toBe(true);
    expect(minified.height).toBeGreaterThan(300);
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

/**
 * Bring the code's top just on screen (24 px of it) by scrolling the detail
 * view first, then the content region — which so keeps room to scroll when
 * the view reaches below it (short docks).
 */
async function uncoverCodeTop(panel: Page): Promise<void> {
  await panel.evaluate(() => {
    const view = (document.querySelector('[data-fdt="detail-pane"]') ??
      document.querySelector('[data-fdt="drill-body"]')) as HTMLElement;
    const area = document.querySelector(
      '[data-fdt="script-source"] [data-fdt-code-area]'
    ) as HTMLElement;
    const content = document.querySelector('[data-fdt="panel-content"]') as HTMLElement;
    content.scrollTop = 0;
    view.scrollTop = 0;
    for (let step = 0; step < 1_000; step++) {
      const v = view.getBoundingClientRect();
      const bottom = Math.min(
        v.top + view.clientTop + view.clientHeight,
        content.getBoundingClientRect().bottom,
        innerHeight
      );
      if (area.getBoundingClientRect().top <= bottom - 24) return;
      if (view.scrollTop < view.scrollHeight - view.clientHeight - 1) view.scrollTop += 4;
      else content.scrollTop += 4;
    }
  });
  await settleFrames(panel);
}

/** The window's wheel tally (see {@link wheelsSeen}). */
interface WheelTally {
  __fdtWheels?: number;
  __fdtWheelPrevented?: boolean;
}

/**
 * The wheel events the panel has seen so far (a passive window listener,
 * installed on the first call — it runs after the detail's own listeners,
 * so it also records whether the last one was prevented): the input
 * pipeline delivers a wheel after `mouse.wheel` resolves, so a tick is
 * measured only once it has landed.
 */
async function wheelsSeen(panel: Page): Promise<{ count: number; prevented: boolean }> {
  return panel.evaluate(() => {
    const tally = window as unknown as WheelTally;
    if (tally.__fdtWheels === undefined) {
      tally.__fdtWheels = 0;
      addEventListener(
        'wheel',
        (event) => {
          tally.__fdtWheels = (tally.__fdtWheels ?? 0) + 1;
          tally.__fdtWheelPrevented = event.defaultPrevented;
        },
        { passive: true }
      );
    }
    return { count: tally.__fdtWheels, prevented: tally.__fdtWheelPrevented ?? false };
  });
}

/**
 * One measured wheel tick over the code's visible part: a real mouse wheel,
 * or a synthetic cancelable `WheelEvent` on the element there (`prevented`
 * says whether the rule took it; a synthetic event has no default scroll,
 * so the rule's own scroll is all it moves).
 */
async function wheelOverCode(panel: Page, deltaY: number, synthetic = false) {
  const before = await codeView(panel);
  if (before.aim === null) throw new Error('no code on screen to point at');
  const aim = before.aim;
  let prevented: boolean | null = null;
  if (synthetic) {
    prevented = await panel.evaluate(
      ({ point, delta }) => {
        const target = document.elementFromPoint(point.x, point.y);
        if (target === null) throw new Error('nothing at the aim point');
        const event = new WheelEvent('wheel', {
          deltaY: delta,
          clientX: point.x,
          clientY: point.y,
          bubbles: true,
          cancelable: true
        });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      },
      { point: aim, delta: deltaY }
    );
  } else {
    const seen = (await wheelsSeen(panel)).count;
    await panel.mouse.move(aim.x, aim.y);
    await panel.mouse.wheel(0, deltaY);
    await expect.poll(async () => (await wheelsSeen(panel)).count).toBeGreaterThan(seen);
    prevented = (await wheelsSeen(panel)).prevented;
  }
  const after = await codeView(panel);
  return {
    prevented,
    after,
    outer: after.outerScroll - before.outerScroll,
    view: after.viewScroll - before.viewScroll,
    code: after.codeScroll - before.codeScroll
  };
}

// The rule's accounting is driven by synthetic cancelable wheels at the
// code's visible part (deterministic: headless Chromium now and then hands a
// real wheel over non-cancelable, so it can't reach the rule — the platform,
// not the rule). One real wheel per direction then checks the hand-off: once
// the code is whole the rule leaves the wheel alone and the browser scrolls
// the code natively, nothing else.
test('the wheel over half-shown code scrolls the view until the code is whole, then the code; every tick lands once (pane and drill)', async ({
  extension
}) => {
  for (const width of [1280, 760]) {
    const label = `${String(width)}x800`;
    const { panel, fixture } = await openRoute(extension, 'javascript', { width, height: 800 });
    try {
      await openSettledScript(panel, 'Inline script #2');
      const start = await codeView(panel);
      expect(start.whole, `${label}: the code starts cut off below`).toBe(false);
      // Down: the view first, never the code while it is cut off; each tick's
      // 120 px land exactly once (no double scroll; the rest of the tick that
      // makes the code whole goes to the code, nothing dropped).
      let ticks = 0;
      let whole = false;
      while (!whole && ticks < 6) {
        const tick = await wheelOverCode(panel, 120, true);
        ticks += 1;
        whole = tick.after.whole;
        const at = `${label} tick ${String(ticks)}`;
        expect(tick.prevented, at).toBe(true);
        expect(tick.outer + tick.view + tick.code, at).toBeCloseTo(120, 0);
        if (!whole) expect(tick.code, at).toBe(0);
      }
      expect(whole, label).toBe(true);
      expect(ticks, label).toBeLessThanOrEqual(3);
      // Whole: the rule leaves the wheel to the browser.
      expect((await wheelOverCode(panel, 120, true)).prevented, label).toBe(false);
      // Then real wheels scroll the code alone, both ways.
      const down = await wheelOverCode(panel, 120);
      expect(down.prevented, label).toBe(false);
      expect([down.outer, down.view], label).toEqual([0, 0]);
      expect(down.code, label).toBeCloseTo(120, 0);
      const up = await wheelOverCode(panel, -120);
      expect(up.prevented, label).toBe(false);
      expect([up.outer, up.view], label).toEqual([0, 0]);
      expect(up.code, label).toBeCloseTo(-120, 0);
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  }
});

// Short docks drive the rule with synthetic cancelable wheels at the code's
// visible part: headless Chromium hands real wheels there over
// non-cancelable — even to a document-level blocking listener — and then
// scrolls nothing, so a real wheel cannot reach the rule (real Chrome: the
// owner's manual check). The layout, the clipping scrollers and the rule's
// DOM side are the real ones.
test('short docks: the wheel rule brings cut-off code whole on screen, the panel scroller first, each tick landing once', async ({
  extension
}) => {
  for (const size of [
    { width: 1280, height: 300 },
    { width: 1280, height: 260 },
    { width: 760, height: 300 },
    { width: 760, height: 260 }
  ]) {
    const label = `${String(size.width)}x${String(size.height)}`;
    const { panel, fixture } = await openRoute(extension, 'javascript', size);
    try {
      await openSettledScript(panel, 'Inline script #2');
      await uncoverCodeTop(panel);
      const start = await codeView(panel);
      expect(start.whole, `${label}: the code starts cut off`).toBe(false);
      // How far the panel scroller can still go, and whether it is what cuts the view off.
      const clip = await panel.evaluate(() => {
        const content = document.querySelector('[data-fdt="panel-content"]') as HTMLElement;
        const view = (document.querySelector('[data-fdt="detail-pane"]') ??
          document.querySelector('[data-fdt="drill-body"]')) as HTMLElement;
        return {
          outerRoom: content.scrollHeight - content.clientHeight - content.scrollTop,
          viewPastPanel:
            view.getBoundingClientRect().bottom > content.getBoundingClientRect().bottom + 1
        };
      });
      let ticks = 0;
      let whole = false;
      while (!whole && ticks < 6) {
        const tick = await wheelOverCode(panel, 120, true);
        ticks += 1;
        whole = tick.after.whole;
        const at = `${label} tick ${String(ticks)} ${JSON.stringify(clip)}`;
        expect(tick.prevented, at).toBe(true);
        expect(tick.outer + tick.view + tick.code, at).toBeCloseTo(120, 0);
        if (!whole) expect(tick.code, at).toBe(0);
        // A view reaching below the panel: the panel scroller goes first.
        if (ticks === 1 && clip.viewPastPanel && clip.outerRoom > 1) {
          expect(tick.outer, at).toBeCloseTo(Math.min(clip.outerRoom, 120), 0);
        }
      }
      expect(whole, `${label}: whole on screen`).toBe(true);
      expect(ticks, label).toBeLessThanOrEqual(4);
      // Whole: the rule leaves the next tick to the browser (the code).
      const next = await wheelOverCode(panel, 120, true);
      expect(next.prevented, label).toBe(false);
      expect([next.outer, next.view], label).toEqual([0, 0]);
      expect(await pageErrors(panel), label).toEqual([]);
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  }
});

test('short docks: the whole code area fits once scrolled to, the pane region keeps its floor, no ResizeObserver loop', async ({
  extension
}) => {
  for (const colorScheme of ['dark', 'light'] as const) {
    const { panel, fixture } = await openRoute(
      extension,
      'javascript',
      { width: 1280, height: 800 },
      false,
      colorScheme
    );
    try {
      await openSettledScript(panel, 'Inline script #2');
      await expect(panel.locator('[data-fdt="detail-pane"]')).toBeVisible();
      for (const height of [400, 300, 260]) {
        await panel.setViewportSize({ width: 1280, height });
        await settleFrames(panel);
        // Pane open: the rows region is 20 rem, or the view below the top bar.
        const region = await panel
          .locator('[data-fdt="calm-list-region"]')
          .evaluate((element) => Math.round(element.getBoundingClientRect().height));
        expect(region, `region at ${String(height)}`).toBe(
          Math.max(192, Math.min(320, height - 68))
        );
        await scrollToEnds(panel);
        expect((await codeView(panel)).whole, `pane at ${String(height)}`).toBe(true);
      }
      // The drill-in on a short dock is taller than the panel: still whole.
      for (const height of [300, 260]) {
        await panel.setViewportSize({ width: 760, height });
        await settleFrames(panel);
        if ((await panel.locator('[data-fdt="drill-body"]').count()) === 0) {
          await openSettledScript(panel, 'Inline script #2');
        }
        await expect(panel.locator('[data-fdt="drill-body"]')).toBeVisible();
        await scrollToEnds(panel);
        expect((await codeView(panel)).whole, `drill at ${String(height)}`).toBe(true);
      }
      // A shrinking list re-windows a frame later: no loop error reaches the page.
      expect(await pageErrors(panel)).toEqual([]);
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  }
});

test('the splitter keeps the shown width when Esc closes the pane mid-drag, and stores nothing for a plain click', async ({
  extension
}) => {
  const { panel, fixture } = await openRoute(extension, 'javascript', {
    width: 1400,
    height: 800
  });
  try {
    await rowOpen(panel, 'Inline script #3').click();
    await settleFrames(panel);
    const splitter = panel.getByRole('separator', { name: 'Resize details' });
    const box = await splitter.boundingBox();
    if (box === null) throw new Error('the splitter has no box');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    // Drag 120 px left, then Esc while still pressed: the pane closes.
    const start = await paneWidth(panel);
    await panel.mouse.move(x, y);
    await panel.mouse.down();
    for (let step = 1; step <= 4; step += 1) await panel.mouse.move(x - step * 30, y);
    await settleFrames(panel);
    const shown = await paneWidth(panel);
    expect(shown).toBeGreaterThan(start);
    const list = await calmList(panel).evaluate((element) => element.clientWidth);
    await panel.keyboard.press('Escape');
    await expect(panel.locator('[data-fdt="detail-pane"]')).toHaveCount(0);
    await panel.mouse.up();
    await expect.poll(() => storedShare(extension)).toBeCloseTo(shown / list, 2);

    // A plain click (press + release, no move) stores nothing.
    await clearShare(extension);
    await rowOpen(panel, 'Inline script #3').click();
    await settleFrames(panel);
    const again = await panel.getByRole('separator', { name: 'Resize details' }).boundingBox();
    if (again === null) throw new Error('the splitter has no box');
    await panel.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
    await panel.mouse.down();
    await panel.mouse.up();
    await panel.waitForTimeout(300);
    expect(await storedShare(extension)).toBeUndefined();
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('5,000 rows: a splitter drag and opening big code run no long task over 50 ms', async ({
  extension
}, info) => {
  const { panel, fixture } = await openRoute(
    extension,
    'javascript',
    { width: 1400, height: 900 },
    true
  );
  try {
    await expect(panel.locator('[data-fdt="script-total"]')).toHaveText(/^5,000\+? scripts$/);
    // The collector is live: a deliberate 70 ms block is seen.
    await setPhase(panel, 'probe');
    await panel.evaluate(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            const until = performance.now() + 70;
            while (performance.now() < until) {
              // Busy-wait: one long task by construction.
            }
            resolve();
          }, 0);
        })
    );
    await expect.poll(() => longest(panel, 'probe')).toBeGreaterThanOrEqual(60);

    // Open the minified script (wrapped, highlighted) and settle.
    await setPhase(panel, 'open-code');
    await rowOpen(panel, 'Inline script #2').click();
    await expect(panel.locator('[data-fdt="script-source"] [data-fdt-code-area]')).toBeVisible();
    await panel.waitForTimeout(1_500);

    // Drag the splitter across its range and back, one move per frame or more.
    await setPhase(panel, 'drag');
    const box = await panel.getByRole('separator', { name: 'Resize details' }).boundingBox();
    if (box === null) throw new Error('the splitter has no box');
    const y = box.y + box.height / 2;
    let x = box.x + box.width / 2;
    await panel.mouse.move(x, y);
    await panel.mouse.down();
    for (let step = 0; step < 30; step += 1) {
      x -= 12;
      await panel.mouse.move(x, y);
    }
    for (let step = 0; step < 60; step += 1) {
      x += 12;
      await panel.mouse.move(x, y);
    }
    await panel.mouse.up();
    await panel.waitForTimeout(500);

    // The huge minified style: plain, wrapped, capped.
    await setPhase(panel, 'open-style');
    await panel.evaluate(() => {
      location.hash = '#/stylesheets';
    });
    await rowOpen(panel, 'huge-style').click();
    await expect(
      panel.locator('[data-fdt="style-css"] [data-fdt-code-block-wrap]')
    ).toHaveAttribute('aria-pressed', 'true');
    await panel.waitForTimeout(1_000);
    await setPhase(panel, 'drag-style');
    const styleBox = await panel.getByRole('separator', { name: 'Resize details' }).boundingBox();
    if (styleBox === null) throw new Error('the splitter has no box');
    x = styleBox.x + styleBox.width / 2;
    await panel.mouse.move(x, y);
    await panel.mouse.down();
    for (let step = 0; step < 20; step += 1) {
      x -= 15;
      await panel.mouse.move(x, y);
    }
    await panel.mouse.up();
    await panel.waitForTimeout(500);

    const phases = ['open-code', 'drag', 'open-style', 'drag-style'];
    const report = Object.fromEntries(
      await Promise.all(phases.map(async (phase) => [phase, await longest(panel, phase)] as const))
    );
    await info.attach('detail-width-longtasks.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json'
    });
    for (const phase of phases) {
      expect(report[phase], `longest task in ${phase}`).toBeLessThanOrEqual(50);
    }
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
