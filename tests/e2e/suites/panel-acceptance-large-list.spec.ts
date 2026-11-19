/**
 * P6.1 browser acceptance — the seeded large-list round (rows 4–5 of
 * 07-phase-6-panel-pages.md).
 *
 * The 5,000-row fixture is generated on demand (never committed JSON): this
 * file builds a deterministic inventory page and serves it through the real
 * capture path (a live fixture tab → the content script's real pass → the
 * real boundary validator → the panel store), so the panel's lists are its
 * own rendering of a genuine captured payload on this machine's real
 * Chromium. The fixture's HTML and every expected count/case below derive
 * from one shared row array, so the fixture can never drift from the
 * assertions.
 *
 * Round 1 rides the whole scripted interaction budget (route/view switches,
 * a facet change, a typed search commit, opening a row's detail, and the
 * panel-wide find's large-list result navigation — perform into a
 * viewport-deep single match, then a match set far enough to wrap both ways)
 * with a PerformanceObserver armed from before the panel's module graph.
 * Each action is its own timeline phase (by timestamp), so the readback
 * names the longest task per action. It asserts the standing bars over the
 * warm phases (no action leaves a long task over 50 ms; total blocking time
 * under 200 ms) and records the cold mount honestly: its per-entry durations
 * are attached, its ceiling is the standing `panel cold-start ≤ 500 ms` row,
 * not this budget.
 *
 * Round 2 pins the round's behavioral quality on the same fixture: the find
 * lands on a specific deep row with real scroll, lands again beside an open
 * detail pane (the list narrowed by it, the selection kept inside the
 * match set), a live find resets with its route, sequential keyboard entry
 * lands rendered content (never the overscan), and the find-active list
 * state with its pane passes strict axe — with the one named reviewed
 * allowance carried from the layout suite (a virtual row partially clipped
 * at a scroller's edge), resolved explicitly, never silent.
 */
import type { Page } from '@playwright/test';
import type { DriverPage, ExtensionDriver } from '../helpers/extension';
import { expect, test } from '../helpers/extension';
import {
  facetSegment,
  openScriptDetail,
  pickFacet,
  scriptDetail
} from '../helpers/javascript-page';
import { openPanelForFixture, relaySearchAction } from '../helpers/panel-data';
import { runPanelAxe, type PanelAxeAudit } from '../helpers/audit';

/** Rows per list kind — the payloads' per-list capture cap. */
const ROWS = 5_000;

/** The Delay-JS controller's marker text (its own record also names the version). */
const CONTROLLER =
  'class RocketLazyLoadScripts{constructor(){this.v="2.0.4",this.userEvents=["mousemove"]}}';

/** The URL of one inventory row (segmented so matches land viewports deep). */
function rowUrl(index: number): string {
  return `https://each.test/block${(index % 9).toString()}/row-${String(index).padStart(4, '0')}.js`;
}

/** The row token every shape renders (URL or leading comment). */
function rowToken(index: number): string {
  return `row-${String(index).padStart(4, '0')}`;
}

/** One row's shape, decided once — the HTML and the counts read the same array. */
interface RowShape {
  readonly url: string;
  readonly delayed: boolean;
  readonly inline: boolean;
  readonly deferred: boolean;
  /** Source text of an inline shape (empty for an external row). */
  readonly content: string;
  readonly preloadAs: 'image' | 'font';
}

/**
 * The deterministic row set: the first row is the plugin's own Delay-JS
 * controller script; the rest cycle four shapes (delayed external, external
 * inert, delayed inline — mostly short, every 25th tall — and a plain inline
 * one-liner). One in ten delayed external rows is additionally
 * WP-Rocket-deferred.
 *
 * @returns Exactly {@link ROWS} shapes.
 */
function rows(): readonly RowShape[] {
  return Array.from({ length: ROWS }, (_, index): RowShape => {
    if (index === 0)
      return {
        url: rowUrl(0),
        delayed: false,
        inline: true,
        deferred: false,
        content: CONTROLLER,
        preloadAs: 'image'
      };
    const shape = index % 4;
    const url = rowUrl(index);
    if (shape === 1)
      return {
        url,
        delayed: false,
        inline: false,
        deferred: false,
        content: '',
        preloadAs: 'image'
      };
    if (shape === 3)
      return {
        url,
        delayed: false,
        inline: true,
        deferred: false,
        // The trailing comment keeps the row's own token visible in text.
        content: `// ${rowToken(index)}\nwindow.dataLayer = window.dataLayer || []; dataLayer.push({ event: 'inline-${String(index)}' });`,
        preloadAs: 'image'
      };
    if (shape === 2) {
      // Most delayed inline blocks are short; every 25th is a tall
      // variable-height member (the expanded-state round finds it).
      const lines = index % 25 === 0 ? 40 + (index % 10) : 3 + (index % 7);
      return {
        url,
        delayed: true,
        inline: true,
        deferred: false,
        content: [
          `// ${rowToken(index)}`,
          ...Array.from(
            { length: lines },
            (__, line) => `const peak${String(line)} = { lazy: true, at: ${String(index)} };`
          )
        ].join('\n'),
        preloadAs: index % 2 === 0 ? 'image' : 'font'
      };
    }
    return {
      url,
      delayed: true,
      inline: false,
      deferred: index % 10 === 0,
      content: '',
      preloadAs: 'image'
    };
  });
}

/** The one shared row array of this file (fixtures and counts read it). */
const INVENTORY_ROWS = rows();

/** How many rows carry one shape (the chips' and summary's expected counts). */
function countOf(kind: 'delayed' | 'inline' | 'external' | 'deferred' | 'delayed-inline'): number {
  switch (kind) {
    case 'delayed-inline':
      return INVENTORY_ROWS.filter((row) => row.delayed && row.inline).length;
    case 'delayed':
      return INVENTORY_ROWS.filter((row) => row.delayed).length;
    case 'inline':
      return INVENTORY_ROWS.filter((row) => row.inline).length;
    case 'external':
      return INVENTORY_ROWS.filter((row) => !row.inline).length;
    case 'deferred':
      return INVENTORY_ROWS.filter((row) => row.deferred).length;
  }
}

/**
 * The served inventory page: one HTML string from the row array. Non-delay
 * script types stay non-executing, so the fixture carries sources without
 * running any of them; only the controller script defines its own class.
 *
 * @returns The complete fixture document.
 */
function perfInventoryHtml(): string {
  const markup = INVENTORY_ROWS.map((row, index) => {
    const script =
      index === 0
        ? `<script>${row.content}</script>`
        : row.inline
          ? `<script type="${row.delayed ? 'rocketlazyloadscript' : 'application/x-fdt-inert'}">${row.content}</script>`
          : row.delayed
            ? `<script type="rocketlazyloadscript" data-rocket-src="${row.url}"${row.deferred ? ' data-rocket-defer' : ''}></script>`
            : `<script type="application/x-fdt-inert" src="${row.url}"></script>`;
    return `${script}<img data-lazy-src="${row.url}" alt="Inventory row ${rowToken(index)}">
      <link rel="preload" data-rocket-preload as="${row.preloadAs}" href="${row.url}">`;
  });
  return `<!doctype html><html lang="en"><head><title>Large-list perf fixture</title></head>
    <body><h1>Large-list perf fixture</h1>${markup.join('')}</body></html>`;
}

// The file's one fixture pattern; both round-1 and round-2 open servers serve it.
const FIXTURE_PATTERN = '**/pipeline/list-perf.html*';
const FIXTURE_PATH = '/pipeline/list-perf.html';

/**
 * The fixture's own precondition: the served capture carries the shape this
 * file's row array defines (per-list counts, no truncation), so behind-cap
 * slices would fail here instead of quietly moving every later assertion.
 *
 * @param extension The extension driver (reads the served payload from the
 *   fixture page's tab through the real `getFdtData` contract).
 * @param fixture The fixture page binding.
 */
async function assertCapturedShape(extension: ExtensionDriver, fixture: DriverPage): Promise<void> {
  const payload = await extension.sendToTab<{
    wprDetections: {
      delay_js: {
        present: boolean;
        scripts: unknown[];
        delayedScripts: number;
      };
      lazyload: { present: boolean; images: unknown[] };
    };
    preloadedResources: { present: boolean; resources: unknown[] };
    pageHeaders: unknown;
  }>(fixture.tabId, 'getFdtData');
  const delayJs = payload.wprDetections.delay_js;
  expect(delayJs.present).toBe(true);
  expect(delayJs.scripts, 'the JS capture kept exactly the seeded rows').toHaveLength(ROWS);
  expect(delayJs.delayedScripts, 'the capture delayed count matches the row array').toBe(
    countOf('delayed')
  );
  expect(
    payload.wprDetections.lazyload.images,
    'the image capture kept the seeded rows'
  ).toHaveLength(ROWS);
  expect(
    payload.preloadedResources.resources,
    'the preload capture kept the seeded rows'
  ).toHaveLength(ROWS);
}

/**
 * The marked find row's token, or null while no row is named: reading the
 * exact expected name answers "is this the cursor's row" without assuming
 * any internal state.
 */
function markedRowToken(panel: Page): Promise<string | null> {
  return panel.evaluate(() => {
    const row = document.querySelector('[data-fdt-page] [role="listitem"][aria-current="true"]');
    return row?.textContent.match(/row-\d{4}/)?.[0] ?? null;
  });
}

/** The marked row's viewport containment plus the list's scroll position. */
function markedRowGeometry(panel: Page): Promise<{ inView: boolean; scrollTop: number } | null> {
  return panel.evaluate(() => {
    const list = document.querySelector('[data-fdt-page] [role="list"]');
    const row = list?.querySelector('[aria-current="true"]');
    if (!(list instanceof HTMLElement) || !(row instanceof HTMLElement)) return null;
    const rowRect = row.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    return {
      inView: rowRect.top >= listRect.top && rowRect.bottom <= listRect.bottom + 1,
      scrollTop: list.scrollTop
    };
  });
}

/**
 * The find-active list state's strict axe round. Dark palette + reduced
 * motion was booted into (the round's opening); this re-asserts the same
 * state — a no-op against the renderer — before the audit, so the changed
 * landing state is always the audited one.
 *
 * @param panel The panel page.
 * @returns The full audited slice, expected clean.
 */
async function auditFindActive(panel: Page): Promise<PanelAxeAudit> {
  await panel.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  return await runPanelAxe(panel);
}

test.describe('large-list acceptance (5,000-row seeded fixture, real capture)', () => {
  test('route/view/filter/search and find navigation stay inside the long-task and TBT budget', async ({
    extension
  }, info) => {
    await extension.browserContext.route(FIXTURE_PATTERN, async (route) => {
      await route.fulfill({ contentType: 'text/html', body: perfInventoryHtml() });
    });
    const { panel, fixture } = await openPanelForFixture(extension, FIXTURE_PATH, {
      bootHash: '#/javascript',
      panelInit: PERF_OBSERVER
    });
    try {
      await assertCapturedShape(extension, fixture);
      const jsPage = panel.locator('[data-fdt-page="javascript"]');
      // Cold phase precondition: the whole captured list is mounted, the
      // Delay facet's Any naming the exact count (and its capture-floor state).
      const anyDelay = facetSegment(jsPage, 'any', 'Delay');
      await expect(anyDelay.locator('input')).toHaveAccessibleName(/5,000$/);
      await expect(jsPage.locator('[data-fdt="script-total"]')).toHaveText('5,000 scripts');
      const status = jsPage.locator('[data-fdt="resource-results-status"]');

      // The collector is live: a deliberate 70 ms block is observed (a dead
      // observer would pass every budget below trivially).
      await setPerfPhase(panel, 'probe');
      await panel.evaluate(
        () =>
          // A page task of its own (a protocol-evaluated script is not one).
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
      await expect
        .poll(async () => (await peekLongest(panel, 'probe')) >= 60, {
          message: 'the long-task observer saw the probe block'
        })
        .toBe(true);

      // The warm phases start with the first scripted action.
      await setPerfPhase(panel, 'routes');

      // --- Route/view switches: two other list pages mount their own rows.
      await panel.evaluate(() => {
        location.hash = '#/lazyload';
      });
      await expect(
        facetSegment(panel.locator('[data-fdt-page="lazyload"]'), 'any', 'Lazyload').locator(
          'input'
        )
      ).toHaveAccessibleName(/5,000$/);
      await panel.evaluate(() => {
        location.hash = '#/preloaded-resources';
      });
      await expect(
        facetSegment(
          panel.locator('[data-fdt-page="preloaded-resources"]'),
          'any',
          'Source'
        ).locator('input')
      ).toHaveAccessibleName(/5,000$/);
      await panel.evaluate(() => {
        location.hash = '#/javascript';
      });
      await expect(anyDelay.locator('input')).toHaveAccessibleName(/5,000$/);

      // --- Facet changes: Delay = delayed narrows to its exact count, then
      // Type = inline combines with it, then both back to Any.
      await setPerfPhase(panel, 'facet');
      await expect(facetSegment(jsPage, 'delayed').locator('[data-fdt-choice-count]')).toHaveText(
        countOf('delayed').toLocaleString('en-US')
      );
      await pickFacet(jsPage, 'delayed');
      await expect(status).toHaveText(
        `Showing ${countOf('delayed').toLocaleString('en-US')} of 5,000 scripts`
      );
      await pickFacet(jsPage, 'inline');
      await expect(status).toHaveText(
        `Showing ${countOf('delayed-inline').toLocaleString('en-US')} of 5,000 scripts`
      );
      await pickFacet(jsPage, 'any', 'Type');
      await pickFacet(jsPage, 'any', 'Delay');
      await expect(status).toHaveText('Showing all 5,000 scripts');

      // --- Typed search over the shared field.
      await setPerfPhase(panel, 'search');
      const field = panel.locator('input[type="search"]');
      await field.fill('row-4900');
      await expect(status).toHaveText('Showing 1 of 5,000 scripts');
      await field.press('Escape');
      await expect(status).toHaveText('Showing all 5,000 scripts');

      // --- Opening a row's detail (the pane, with its on-demand reads), a
      // step to the next row, and closing it again.
      await setPerfPhase(panel, 'open');
      const firstRow = jsPage.locator('[data-fdt="script-row"]').first();
      await openScriptDetail(panel, firstRow);
      await panel.keyboard.press('ArrowDown');
      await expect(jsPage.locator('[data-fdt="script-row"]').nth(1)).toHaveAttribute(
        'data-selected',
        ''
      );
      await panel.keyboard.press('Escape');
      await expect(scriptDetail(panel)).toHaveCount(0);

      // --- The find's large-list result navigation over the relay seam:
      // a single deep match, then a wide set whose cursor wraps a whole
      // viewport-span across the list's far end.
      await setPerfPhase(panel, 'find');
      await relaySearchAction(extension, {
        action: 'performSearch',
        query: 'row-4900',
        tabId: fixture.tabId
      });
      await expect.poll(() => markedRowToken(panel)).toBe('row-4900');
      await expect
        .poll(() => markedRowGeometry(panel), { message: 'the deep single match scrolled in view' })
        .toMatchObject({ inView: true });
      await expect(field).toHaveValue('row-4900');

      await relaySearchAction(extension, {
        action: 'performSearch',
        query: 'row-49',
        tabId: fixture.tabId
      });
      // The field adopting the new query is the delivery's own evidence: the
      // marked row alone cannot prove this search landed (it already marks
      // row-4900 from the single-match search above).
      await expect(field).toHaveValue('row-49');
      await expect.poll(() => markedRowToken(panel)).toBe('row-4900');
      await relaySearchAction(extension, { action: 'previousSearchResult', tabId: fixture.tabId });
      await expect.poll(() => markedRowToken(panel)).toBe('row-4999');
      await expect
        .poll(() => markedRowGeometry(panel), {
          message: 'the wrapped last match scrolled in view'
        })
        .toMatchObject({ inView: true });
      await relaySearchAction(extension, { action: 'nextSearchResult', tabId: fixture.tabId });
      await expect.poll(() => markedRowToken(panel)).toBe('row-4900');
      await relaySearchAction(extension, { action: 'nextSearchResult', tabId: fixture.tabId });
      await expect.poll(() => markedRowToken(panel)).toBe('row-4901');
      await relaySearchAction(extension, { action: 'cancelSearch', tabId: fixture.tabId });
      await expect.poll(() => markedRowToken(panel)).toBeNull();
      await expect(field).toHaveValue('');

      // --- The timeline read.
      const audit = await readPerf(panel);
      await info.attach('large-list-longtasks.json', {
        body: JSON.stringify(audit),
        contentType: 'application/json'
      });
      // The receipt's per-action numbers (longest task, ms) ride the report.
      console.log(`[large-list] longest task per phase (ms): ${JSON.stringify(audit.longest)}`);
      const coldOver50 = audit.tasks.filter((task) => task.phase === 'cold' && task.duration > 50);
      // Not asserted — the cold mount's ceiling is the standing cold-start
      // row; the copies land in the attached artifact for the receipt.
      if (coldOver50.length > 0)
        await info.attach('cold-tasks-over-50ms.json', {
          body: JSON.stringify(coldOver50),
          contentType: 'application/json'
        });
      const warm = (phase: string): boolean => phase !== 'cold' && phase !== 'probe';
      const warmOver50 = audit.tasks.filter((task) => warm(task.phase) && task.duration > 50);
      expect(
        warmOver50,
        `warm long tasks over 50 ms: ${JSON.stringify(warmOver50.slice(0, 3))}`
      ).toEqual([]);
      const warmTbt = Object.entries(audit.tbtByPhase)
        .filter(([phase]) => warm(phase))
        .reduce((sum, [, tbt]) => sum + tbt, 0);
      expect(
        warmTbt,
        `warm-phase TBT (sum of task time past 50 ms) is ${String(warmTbt)} ms`
      ).toBeLessThan(200);
    } finally {
      await panel.close();
      await fixture.page.close();
      await extension.browserContext.unroute(FIXTURE_PATTERN);
    }
  });

  test('find lands exact deep rows, lands again beside an open detail, resets with its route, and audits strict', async ({
    extension
  }, info) => {
    await extension.browserContext.route(FIXTURE_PATTERN, async (route) => {
      await route.fulfill({ contentType: 'text/html', body: perfInventoryHtml() });
    });
    const { panel, fixture } = await openPanelForFixture(extension, FIXTURE_PATH, {
      bootHash: '#/javascript',
      emulation: { colorScheme: 'dark', reducedMotion: 'reduce' }
    });
    try {
      await assertCapturedShape(extension, fixture);
      const jsPage = panel.locator('[data-fdt-page="javascript"]');
      await expect(facetSegment(jsPage, 'any', 'Delay').locator('input')).toHaveAccessibleName(
        /5,000$/
      );
      const status = jsPage.locator('[data-fdt="resource-results-status"]');

      // --- One exact deep match over the wire, with real scroll.
      await relaySearchAction(extension, {
        action: 'performSearch',
        query: 'row-1999',
        tabId: fixture.tabId
      });
      await expect.poll(() => markedRowToken(panel)).toBe('row-1999');
      await expect
        .poll(() => markedRowGeometry(panel), { message: 'row-1999 visible after landing' })
        .toMatchObject({ inView: true });

      // --- Sequential keyboard entry from the page h1 walks into the
      // rendered list content (the entry-mask contract, at 5,000-row
      // scale): repeat Tab until a control inside the virtual list is
      // activeElement — checked and captured atomically, because a virtual
      // remount between two evaluations can drop focus to the body — then
      // assert it is rendered content, not offscreen overscan. The walk's
      // stop count is layout-dependent (chips bar, field, rail…), so the
      // budget is generous; never landing inside the list is the failure.
      await jsPage.getByRole('heading', { level: 1 }).focus();
      let landed: { inList: boolean; visible: boolean } | null = null;
      for (let steps = 0; steps < 40; steps += 1) {
        landed = await panel.evaluate(() => {
          const active = document.activeElement;
          if (
            !(active instanceof HTMLElement) ||
            active.closest('[data-fdt="virtual-list"]') === null
          )
            return null;
          const list = document.querySelector('[data-fdt-page] [role="list"]');
          if (!(list instanceof HTMLElement)) return null;
          const rowRect = active.getBoundingClientRect();
          const listRect = list.getBoundingClientRect();
          return {
            inList: true,
            visible: rowRect.bottom > listRect.top && rowRect.top < listRect.bottom
          };
        });
        if (landed !== null) break;
        await panel.keyboard.press('Tab');
      }
      expect(landed, 'Tab reached the list within one page of tab stops').not.toBeNull();
      expect(landed?.visible ?? false, 'the landed control is rendered content').toBe(true);

      // --- A detail open beside the list: select a row inside the next
      // find's match set (typed over the live one-match find — the list
      // shows the typed match, never the find's — then the search cleared:
      // the pane keeps it), then find again; the landing is exact in the
      // list the pane narrows, and the selection survives (it is a match).
      const search = panel.locator('input[type="search"]');
      await search.fill(rowToken(2003));
      await expect(status).toHaveText('Showing 1 of 5,000 scripts');
      // One match replaced by another (an equal count): the row is the typed one.
      const typed = jsPage.locator('[data-fdt="script-row"]');
      await expect(typed).toHaveCount(1);
      await expect(typed).toContainText(rowToken(2003));
      await openScriptDetail(panel, typed);
      const pane = panel.locator('[data-fdt="detail-pane"]');
      await search.fill('');
      await expect(status).toHaveText('Showing all 5,000 scripts');
      await expect(pane).toBeVisible();
      await relaySearchAction(extension, {
        action: 'performSearch',
        query: 'row-200',
        tabId: fixture.tabId
      });
      await expect.poll(() => markedRowToken(panel)).toBe('row-2000');
      await expect
        .poll(() => markedRowGeometry(panel), { message: 'row-2000 visible beside the pane' })
        .toMatchObject({ inView: true });
      await expect(pane).toBeVisible();
      await expect(
        jsPage.locator('[data-fdt="script-row"][data-selected]', { hasText: rowToken(2003) })
      ).toHaveCount(1);

      // --- The find-active state (marker on a deep row, the pane open
      // beside it) audits strict at the wide tier. Palettes ride the
      // counts-titles round; this is the changed landing state.
      await panel.setViewportSize({ width: 1280, height: 800 });
      const audit = await auditFindActive(panel);
      expect(audit).toEqual({ violations: [], incomplete: [], detail: [] });
      await info.attach('find-active-axe', { body: 'clean', contentType: 'text/plain' });

      // --- Route reset: a live find does not survive navigation.
      await panel.evaluate(() => {
        location.hash = '#/lazyload';
      });
      await expect(panel.locator('[data-fdt-page="lazyload"]')).toBeVisible();
      await panel.evaluate(() => {
        location.hash = '#/javascript';
      });
      await expect.poll(() => markedRowToken(panel)).toBeNull();
      await expect(panel.locator('input[type="search"]')).toHaveValue('');
      await expect(status).toHaveText('Showing all 5,000 scripts');
    } finally {
      await panel.close();
      await fixture.page.close();
      await extension.browserContext.unroute(FIXTURE_PATTERN);
    }
  });
});

/** One observed long task, tagged with the phase live at its start. */
interface PerfTask {
  readonly phase: string;
  readonly duration: number;
  readonly startTime: number;
}

/** Shape of the collector installed by {@link PERF_OBSERVER} (for the TS view). */
interface PerfState {
  /** Phase boundaries in timeline order (`cold` from time 0). */
  phases: { name: string; at: number }[];
  tasks: { duration: number; startTime: number }[];
  observer: PerformanceObserver;
}

/**
 * Start a named warm phase: long tasks starting from now count for it (by
 * their own start time, so a late observer callback never misfiles one).
 *
 * @param panel The panel page.
 * @param name The phase (one scripted action).
 */
async function setPerfPhase(panel: Page, name: string): Promise<void> {
  await panel.evaluate((phase) => {
    const perf = (window as unknown as { __fdtPerf?: PerfState }).__fdtPerf;
    if (perf === undefined) throw new Error('the performance collector did not install');
    perf.phases.push({ name: phase, at: performance.now() });
  }, name);
}

/**
 * The longest task (ms) observed so far in one phase, without stopping the
 * collector (the liveness probe's read).
 *
 * @param panel The panel page.
 * @param name The phase.
 * @returns The longest duration, 0 when none was observed.
 */
async function peekLongest(panel: Page, name: string): Promise<number> {
  return await panel.evaluate((phase) => {
    const perf = (window as unknown as { __fdtPerf?: PerfState }).__fdtPerf;
    if (perf === undefined) throw new Error('the performance collector did not install');
    const start = perf.phases.find((entry) => entry.name === phase)?.at ?? Infinity;
    const next = perf.phases.find((entry) => entry.at > start)?.at ?? Infinity;
    return Math.max(
      0,
      ...perf.tasks
        .filter((task) => task.startTime >= start && task.startTime < next)
        .map((task) => task.duration)
    );
  }, name);
}

/**
 * Stop the collector and read its tasks, each filed under the phase it
 * started in, with each phase's total blocking time and longest task.
 *
 * @param panel The panel page.
 * @returns The filed tasks, TBT and longest task (ms) per phase.
 */
async function readPerf(panel: Page): Promise<{
  tasks: PerfTask[];
  tbtByPhase: Record<string, number>;
  longest: Record<string, number>;
}> {
  const raw = await panel.evaluate(() => {
    const perf = (window as unknown as { __fdtPerf?: PerfState }).__fdtPerf;
    if (perf === undefined) throw new Error('the performance collector did not install');
    perf.observer.disconnect();
    return { phases: perf.phases, tasks: perf.tasks };
  });
  const tasks = raw.tasks.map((task): PerfTask => {
    const phase = raw.phases.filter((entry) => entry.at <= task.startTime).at(-1)?.name ?? 'cold';
    return { phase, duration: task.duration, startTime: task.startTime };
  });
  const tbtByPhase: Record<string, number> = {};
  const longest: Record<string, number> = {};
  for (const entry of raw.phases) {
    tbtByPhase[entry.name] = 0;
    longest[entry.name] = 0;
  }
  for (const task of tasks) {
    tbtByPhase[task.phase] = (tbtByPhase[task.phase] ?? 0) + Math.max(0, task.duration - 50);
    longest[task.phase] = Math.max(longest[task.phase] ?? 0, Math.round(task.duration));
  }
  return { tasks, tbtByPhase, longest };
}

/**
 * The init script arming the collector before the panel's module graph.
 * Long-task entries keep their start time; the readback files each under
 * the phase live at that time, so the cold mount (boot + the first
 * 5,000-row render) splits from each scripted warm action. Measurement only
 * — no app state.
 */
const PERF_OBSERVER = `(() => {
  if (!PerformanceObserver.supportedEntryTypes.includes('longtask'))
    throw new Error('Long-task observation unavailable');
  const collector = { phases: [{ name: 'cold', at: 0 }], tasks: [] };
  collector.observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      collector.tasks.push({ duration: entry.duration, startTime: entry.startTime });
  });
  collector.observer.observe({ type: 'longtask', buffered: false });
  window.__fdtPerf = collector;
})();
`;
