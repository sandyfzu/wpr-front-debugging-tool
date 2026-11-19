/**
 * The JavaScript page's facets in the real browser: combined facets narrow
 * the rows while each facet's counts follow the other facets and the search
 * (standard faceting); the compact bar's Filters button, removable chips and
 * bottom sheet (Reset, "Show N scripts", closed on widening, its footer in
 * view on a short panel, no motion under reduced motion); the filtered-empty
 * sentence with Clear filters; and the DevTools find working inside the
 * filtered rows.
 *
 * The fixture is generated per run on the fixture origin: one script per
 * facet value (see {@link FACET_SCRIPTS}), plus optional delayed fillers that
 * make the list scroll. No script runs (delayed or inert types only).
 */
import type { Locator, Page } from '@playwright/test';
import { expect, ORIGIN_A, test } from '../helpers/extension';
import {
  facetCount,
  facetSegment,
  facetToggle,
  pickFacet,
  setFacetToggle
} from '../helpers/javascript-page';
import { openPanelForFixture, relaySearchAction, type InspectedPanel } from '../helpers/panel-data';

/** The fixture path (served by the route below; `?fill=N` adds fillers). */
const FIXTURE_PATH = '/pipeline/facets.html';

/** A plain script the page never runs (an inert type), with optional attributes. */
const INERT = 'type="application/x-fdt-inert"';

/**
 * One script per facet value, each named once:
 * Delay: delayed = alpha, bravo, echo, the bundle, india (5) · non-delayed = 4;
 * Defer: deferred = bravo, charlie (2); Type: inline = echo, foxtrot (2);
 * File: minified = india, combined = the bundle; Excluded: hotel.
 */
const FACET_SCRIPTS: readonly string[] = [
  `<script type="rocketlazyloadscript" data-rocket-src="https://example.test/fx-alpha.js"></script>`,
  `<script type="rocketlazyloadscript" data-rocket-src="https://example.test/fx-bravo.js" data-rocket-defer defer></script>`,
  `<script ${INERT} src="https://example.test/fx-charlie.js" defer></script>`,
  `<script ${INERT} src="https://example.test/fx-delta.js"></script>`,
  `<script type="rocketlazyloadscript">// fx-echo\nwindow.echo = 1;</script>`,
  `<script ${INERT}>// fx-foxtrot\nwindow.foxtrot = 1;</script>`,
  `<script type="rocketlazyloadscript" data-rocket-src="${ORIGIN_A}/wp-content/cache/min/1/0123456789abcdef0123456789abcdef.js"></script>`,
  `<script ${INERT} src="https://example.test/fx-hotel.js" data-wpr-fdt-excluded="delay_js"></script>`,
  `<script type="rocketlazyloadscript" data-rocket-src="${ORIGIN_A}/wp-content/cache/min/1/wp-content/themes/demo/fx-india.min.js"></script>`
];

/** Scripts on the page without fillers. */
const TOTAL = FACET_SCRIPTS.length;

/**
 * The fixture page: WP Rocket's feature meta (Delay, Defer, Minify and
 * Combine JS, so the File facet classifies), the facet scripts, then
 * `fill` delayed external fillers `fill-NN.js`.
 *
 * @param fill How many fillers to append.
 * @returns The document.
 */
function facetsPage(fill: number): string {
  const fillers = Array.from(
    { length: fill },
    (_, index) =>
      `<script type="rocketlazyloadscript" data-rocket-src="https://example.test/fill-${String(index).padStart(2, '0')}.js"></script>`
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Facets</title>
    <meta name="generator" content="WP Rocket 3.24" data-wpr-features="wpr_delay_js wpr_defer_js wpr_minify_js wpr_minify_concatenate_js wpr_desktop">
    </head><body><h1>Facets</h1>${[...FACET_SCRIPTS, ...fillers].join('')}</body></html>`;
}

/** The JavaScript page root. */
function jsPage(panel: Page): Locator {
  return panel.locator('[data-fdt-page="javascript"]');
}

/** The list's results line ("Showing 4 of 9 scripts"). */
function resultsStatus(panel: Page): Locator {
  return jsPage(panel).locator('[data-fdt="resource-results-status"]');
}

/** The open Filters sheet (portalled outside the page). */
function sheet(panel: Page): Locator {
  return panel.locator('[data-fdt="sheet"]');
}

/**
 * Open the JavaScript page on the fixture at a viewport, booted into reduced
 * motion, and wait for the capture (the Delay facet's Any count).
 *
 * @param extension The extension driver.
 * @param viewport The panel viewport.
 * @param fill Delayed fillers to append.
 */
async function openFacets(
  extension: Parameters<typeof openPanelForFixture>[0],
  viewport: { width: number; height: number },
  fill = 0
): Promise<InspectedPanel> {
  const opened = await openPanelForFixture(extension, `${FIXTURE_PATH}?fill=${String(fill)}`, {
    bootHash: '#/javascript',
    emulation: { colorScheme: 'dark', reducedMotion: 'reduce' }
  });
  await opened.panel.setViewportSize(viewport);
  await expect(jsPage(opened.panel).locator('[data-fdt="script-total"]')).toHaveText(
    `${String(TOTAL + fill)} scripts`
  );
  // The bar's form follows the list's measured width (a resize observer):
  // wait until it agrees with the settled width, so a move never reads a
  // form about to change (the compact tier is below 480 px of list).
  await expect
    .poll(() =>
      jsPage(opened.panel)
        .locator('[data-fdt="calm-list"]')
        .evaluate((list) => {
          const width = list.getBoundingClientRect().width;
          const compact = list.querySelector('[data-fdt="facet-bar"][data-fdt-compact]') !== null;
          return width > 0 && compact === width < 480;
        })
    )
    .toBe(true);
  return opened;
}

/**
 * Assert a facet's counts (each segment's number, `any` included).
 *
 * @param panel The panel page.
 * @param facet The facet's label ("Delay").
 * @param counts Value id → expected count.
 */
async function expectCounts(
  panel: Page,
  facet: string,
  counts: Readonly<Record<string, number>>
): Promise<void> {
  for (const [value, count] of Object.entries(counts))
    await expect(facetCount(jsPage(panel), value, facet), `${facet} › ${value}`).toHaveText(
      String(count)
    );
}

/**
 * The animations running on an element's subtree after two frames (reduced
 * motion's near-zero durations end by then; a full-motion entrance does not).
 *
 * @param target The element (e.g. the open sheet).
 */
function runningAnimations(target: Locator): Promise<string[]> {
  return target.evaluate(
    (element) =>
      new Promise<string[]>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve(
              element
                .getAnimations({ subtree: true })
                .filter((animation) => animation.playState === 'running')
                .map((animation) =>
                  animation instanceof CSSTransition
                    ? animation.transitionProperty
                    : animation instanceof CSSAnimation
                      ? animation.animationName
                      : animation.id
                )
            );
          });
        });
      })
  );
}

/** The find's marked row's name, or null while none is marked. */
function markedRowName(panel: Page): Promise<string | null> {
  return panel.evaluate(
    () =>
      document
        .querySelector('[data-fdt-page] [role="listitem"][aria-current="true"]')
        ?.querySelector('[data-fdt="list-row-name"]')?.textContent ?? null
  );
}

/** Whether the marked row lies fully inside the list's scroller. */
function markedRowInView(panel: Page): Promise<boolean> {
  return panel.evaluate(() => {
    const list = document.querySelector('[data-fdt-page] [role="list"]');
    const row = list?.querySelector('[aria-current="true"]');
    if (!(list instanceof HTMLElement) || !(row instanceof HTMLElement)) return false;
    const rowBox = row.getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    return rowBox.top >= listBox.top && rowBox.bottom <= listBox.bottom + 1;
  });
}

test.beforeEach(async ({ extension }) => {
  await extension.browserContext.route(`**${FIXTURE_PATH}*`, async (route) => {
    const fill = Number(new URL(route.request().url()).searchParams.get('fill') ?? '0');
    await route.fulfill({ contentType: 'text/html', body: facetsPage(fill) });
  });
});

test.afterEach(async ({ extension }) => {
  await extension.browserContext.unroute(`**${FIXTURE_PATH}*`);
});

test('combined facets narrow the rows, and each facet counts under the other facets and the search', async ({
  extension
}) => {
  const opened = await openFacets(extension, { width: 1280, height: 800 });
  const { panel } = opened;
  try {
    await expectCounts(panel, 'Delay', { any: TOTAL, delayed: 5, 'non-delayed': 4 });
    await expectCounts(panel, 'Defer', { deferred: 2, 'non-deferred': 7 });
    await expectCounts(panel, 'Type', { inline: 2, external: 7 });
    await expectCounts(panel, 'File', { minified: 1, combined: 1 });
    await expect(facetToggle(jsPage(panel), 'excluded')).toContainText('1');

    // The toggle combines with the choices like any facet.
    await setFacetToggle(jsPage(panel), 'excluded', true);
    await expect(resultsStatus(panel)).toHaveText(`Showing 1 of ${String(TOTAL)} scripts`);
    await expectCounts(panel, 'Delay', { any: 1, delayed: 0, 'non-delayed': 1 });
    await setFacetToggle(jsPage(panel), 'excluded', false);
    await expect(resultsStatus(panel)).toHaveText(`Showing all ${String(TOTAL)} scripts`);

    await pickFacet(jsPage(panel), 'delayed');
    await expect(resultsStatus(panel)).toHaveText(`Showing 5 of ${String(TOTAL)} scripts`);
    // The other facets count inside Delay = delayed; Delay itself does not narrow its own.
    await expectCounts(panel, 'Type', { any: 5, inline: 1, external: 4 });
    await expectCounts(panel, 'Defer', { deferred: 1, 'non-deferred': 4 });
    await expectCounts(panel, 'Delay', { any: TOTAL, delayed: 5, 'non-delayed': 4 });

    await pickFacet(jsPage(panel), 'external');
    await expect(resultsStatus(panel)).toHaveText(`Showing 4 of ${String(TOTAL)} scripts`);
    await expectCounts(panel, 'Delay', { any: 7, delayed: 4, 'non-delayed': 3 });
    await expectCounts(panel, 'Type', { any: 5, inline: 1, external: 4 });

    // The search narrows every facet's counts too.
    await jsPage(panel).locator('input[type="search"]').fill('fx-b');
    await expect(resultsStatus(panel)).toHaveText(`Showing 1 of ${String(TOTAL)} scripts`);
    await expectCounts(panel, 'Delay', { any: 1, delayed: 1, 'non-delayed': 0 });
    await expectCounts(panel, 'Type', { any: 1, inline: 0, external: 1 });
    await expect(jsPage(panel).locator('[data-fdt="list-row-name"]')).toHaveText(['fx-bravo.js']);
  } finally {
    await opened.panel.close();
    await opened.fixture.page.close();
  }
});

test('a compact list folds the facets into Filters: active count, removable chips, a sheet with Reset and "Show N scripts"', async ({
  extension
}) => {
  const opened = await openFacets(extension, { width: 420, height: 800 });
  const { panel } = opened;
  try {
    const bar = jsPage(panel).locator('[data-fdt="facet-bar"]');
    await expect(bar).toHaveAttribute('data-fdt-compact', '');
    const filters = bar.locator('[data-fdt="facet-filters-button"]');
    await pickFacet(jsPage(panel), 'delayed');
    await pickFacet(jsPage(panel), 'external');
    await expect(filters.locator('[data-fdt="facet-filters-count"]')).toHaveText('2');
    await expect(resultsStatus(panel)).toHaveText(`Showing 4 of ${String(TOTAL)} scripts`);
    const chips = bar.locator('[data-fdt="facet-chip"]');
    await expect(chips).toHaveCount(2);
    // One chip removes its own facet only.
    await bar.getByRole('button', { name: 'Remove filter Delayed' }).click();
    await expect(chips).toHaveCount(1);
    await expect(chips).toHaveAccessibleName('Remove filter External');
    await expect(resultsStatus(panel)).toHaveText(`Showing 7 of ${String(TOTAL)} scripts`);

    await filters.click();
    await expect(sheet(panel)).toBeVisible();
    // Segments stretch to the sheet's width.
    const widths = await sheet(panel).evaluate((root) => ({
      body: root.querySelector('[data-fdt="sheet-body"]')?.clientWidth ?? 0,
      group: root.querySelector('[role="radiogroup"]')?.getBoundingClientRect().width ?? 0
    }));
    expect(widths.group).toBeGreaterThan(widths.body * 0.8);
    const show = sheet(panel).locator('[data-fdt="facet-sheet-show"]');
    await expect(show).toHaveText('Show 7 scripts');
    await sheet(panel).locator('[data-fdt="facet-sheet-reset"]').click();
    await expect(show).toHaveText(`Show ${String(TOTAL)} scripts`);
    await expect(facetSegment(sheet(panel), 'any', 'Type').locator('input')).toBeChecked();
    await show.click();
    await expect(sheet(panel)).toHaveCount(0);
    await expect(chips).toHaveCount(0);
    await expect(filters).toBeFocused();
    await expect(resultsStatus(panel)).toHaveText(`Showing all ${String(TOTAL)} scripts`);
  } finally {
    await opened.panel.close();
    await opened.fixture.page.close();
  }
});

test('the open sheet closes once the list widens out of compact, the facets inline again', async ({
  extension
}) => {
  const opened = await openFacets(extension, { width: 420, height: 800 });
  const { panel } = opened;
  try {
    await jsPage(panel).locator('[data-fdt="facet-filters-button"]').click();
    await expect(sheet(panel)).toBeVisible();
    await panel.setViewportSize({ width: 1280, height: 800 });
    await expect(sheet(panel)).toHaveCount(0);
    const bar = jsPage(panel).locator('[data-fdt="facet-bar"]');
    await expect(bar).not.toHaveAttribute('data-fdt-compact');
    await expect(bar.getByRole('radiogroup', { name: 'Delay' })).toBeVisible();
    // Focus left the closed sheet for a control on the page, never the body.
    expect(
      await panel.evaluate(
        () => document.activeElement !== null && document.activeElement !== document.body
      )
    ).toBe(true);
  } finally {
    await opened.panel.close();
    await opened.fixture.page.close();
  }
});

test('a facet move right after a resize takes the form the new width gives, into compact and back', async ({
  extension
}) => {
  const opened = await openFacets(extension, { width: 1280, height: 800 });
  const { panel } = opened;
  try {
    const bar = jsPage(panel).locator('[data-fdt="facet-bar"]');
    // No wait between a resize and the move: the bar's form changes in the
    // next frame's resize-observer step, which the move must not race.
    await panel.setViewportSize({ width: 420, height: 800 });
    await setFacetToggle(jsPage(panel), 'excluded', true);
    await expect(bar).toHaveAttribute('data-fdt-compact', '');
    await expect(sheet(panel)).toHaveCount(0);
    await expect(resultsStatus(panel)).toHaveText(`Showing 1 of ${String(TOTAL)} scripts`);
    await panel.setViewportSize({ width: 1280, height: 800 });
    await pickFacet(jsPage(panel), 'external');
    await expect(bar).not.toHaveAttribute('data-fdt-compact');
    await expect(facetToggle(bar, 'excluded')).toHaveAttribute('aria-pressed', 'true');
    await expect(resultsStatus(panel)).toHaveText(`Showing 1 of ${String(TOTAL)} scripts`);
  } finally {
    await opened.panel.close();
    await opened.fixture.page.close();
  }
});

test('on a short panel the sheet keeps its footer in view, and nothing in it runs under reduced motion', async ({
  extension
}) => {
  const opened = await openFacets(extension, { width: 420, height: 320 });
  const { panel } = opened;
  try {
    await jsPage(panel).locator('[data-fdt="facet-filters-button"]').click();
    await expect(sheet(panel)).toBeVisible();
    await expect(sheet(panel).locator('[data-fdt="facet-sheet-show"]')).toBeInViewport({
      ratio: 1
    });
    await expect(sheet(panel).locator('[data-fdt="facet-sheet-reset"]')).toBeInViewport({
      ratio: 1
    });
    expect(await runningAnimations(sheet(panel))).toEqual([]);
  } finally {
    await opened.panel.close();
    await opened.fixture.page.close();
  }
});

test('filtered-empty names the narrowing facets; Clear filters brings every row back and focuses the search', async ({
  extension
}) => {
  const opened = await openFacets(extension, { width: 1280, height: 800 });
  const { panel } = opened;
  try {
    // Two facets that only meet in nothing (a value whose count drops to 0
    // is disabled, so the search makes the empty set).
    await pickFacet(jsPage(panel), 'delayed');
    await pickFacet(jsPage(panel), 'inline');
    const search = jsPage(panel).locator('input[type="search"]');
    await search.fill('fx-alpha');
    await expect(jsPage(panel).getByText('No matches')).toBeVisible();
    await expect(jsPage(panel)).toContainText('Nothing in "Delayed", "Inline" matches "fx-alpha".');
    await jsPage(panel).getByRole('button', { name: 'Clear filters' }).click();
    await expect(resultsStatus(panel)).toHaveText(`Showing all ${String(TOTAL)} scripts`);
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('');
    await expect(facetSegment(jsPage(panel), 'any', 'Delay').locator('input')).toBeChecked();
    await expect(facetSegment(jsPage(panel), 'any', 'Type').locator('input')).toBeChecked();
  } finally {
    await opened.panel.close();
    await opened.fixture.page.close();
  }
});

test('the DevTools find works inside the filtered rows: it marks and scrolls to a deep match', async ({
  extension
}) => {
  const opened = await openFacets(extension, { width: 1280, height: 800 }, 40);
  const { panel, fixture } = opened;
  try {
    await pickFacet(jsPage(panel), 'delayed');
    await expect(resultsStatus(panel)).toHaveText(`Showing 45 of ${String(TOTAL + 40)} scripts`);
    // A find over every filler, inside Delay = delayed (the inert scripts
    // never match: the facet still narrows under the find's query).
    await relaySearchAction(extension, {
      action: 'performSearch',
      query: 'fill-',
      tabId: fixture.tabId
    });
    await expect(jsPage(panel).locator('input[type="search"]')).toHaveValue('fill-');
    await expect(resultsStatus(panel)).toHaveText(`Showing 40 of ${String(TOTAL + 40)} scripts`);
    await expect(facetSegment(jsPage(panel), 'delayed').locator('input')).toBeChecked();
    await expect.poll(() => markedRowName(panel)).toBe('fill-00.js');
    // Previous wraps to the last filtered match, viewports down: the list scrolls to it.
    await relaySearchAction(extension, { action: 'previousSearchResult', tabId: fixture.tabId });
    await expect.poll(() => markedRowName(panel)).toBe('fill-39.js');
    await expect.poll(() => markedRowInView(panel)).toBe(true);
    expect(
      await jsPage(panel)
        .locator('[data-fdt="virtual-list"]')
        .evaluate((list) => list.scrollTop)
    ).toBeGreaterThan(0);
    await relaySearchAction(extension, { action: 'cancelSearch', tabId: fixture.tabId });
    await expect.poll(() => markedRowName(panel)).toBeNull();
    await expect(resultsStatus(panel)).toHaveText(`Showing 45 of ${String(TOTAL + 40)} scripts`);
  } finally {
    await opened.panel.close();
    await opened.fixture.page.close();
  }
});
