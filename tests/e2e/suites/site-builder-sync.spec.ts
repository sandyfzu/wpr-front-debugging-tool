/**
 * The Exclusion Builder's state across surfaces, end to end over REAL
 * sessions: the overlay injected as the background opens it, rows/toggles
 * composed in it, Apply through the session backend (the page reloads and
 * the served HTML is rewritten in flight), then every surface read off the
 * rewritten tab.
 *
 * Cases: the docker site's `/fdt/` (WP Rocket's own cached page) for Delay
 * JS off, a Delay JS row, Defer JS off, a Defer JS row that turns it off for
 * the page and a LazyLoad row; a fixture page serving Automatic Lazy
 * Rendering's meta + elements for ALR off and an ALR row. Per case: exactly
 * one builder marker with its exact content, the payload's per-row
 * `builder` fact (and no other), the panel card (served verdict kept,
 * modifier badge + visible sentence, the summary's "N off in this tab"
 * where a feature is off), the strip (served chip kept, row modifier +
 * sentence, tab-level line, the closed pill's glyph + spoken hint) and the
 * support report row. Then Stop: no
 * reload, so the rewritten page and every surface's modifier stay; then a
 * reload serves WP Rocket's page again and every surface is back to the
 * served verdict.
 *
 * Spoof: a page serving two well-formed markers of its own carries no fact
 * (exactly one is required); applied, the rewrite replaces both with its
 * own single marker.
 *
 * The site itself is never changed: sessions are in-browser only, the page
 * is requested as served. One case per test, each in its own tab (a session
 * is per tab), the widget map (on by default) and saved drafts cleared around each. The
 * panel status bar's builder entry is not assertable here: the standalone
 * panel page's sender has a tab, and the background answers only tab-less
 * (real DevTools) senders.
 */
import type { Locator, Page } from '@playwright/test';

import { BUILDER_MARKER_META_NAME } from '../../../lib/wp-rocket/constants';
import type { BuilderFact, BuilderFactRow } from '../../../lib/wp-rocket/types';
import {
  expect,
  openFixturePage,
  test,
  type DriverPage,
  type ExtensionDriver
} from '../helpers/extension';
import { devtoolsShim, panelPageUrl } from '../helpers/panel-data';
import {
  APPLIED,
  DEFER,
  DELAY,
  LAZY_RENDER,
  LAZYLOAD,
  MOUNT,
  clearDrafts,
  injectOverlay
} from '../helpers/exclusion-overlay';
import { chooseDelayMode, deferModeGroup } from '../helpers/simulation';
import { openSitePage, SITE_URL } from '../helpers/site';
import { clearWidgetMap, expectPillHint, STRIP_HOST } from '../helpers/strip-pill';

/** The rows a builder fact can sit on (the payload's contract). */
const FACT_ROWS: readonly FactRow[] = [
  'delay_js',
  'defer_all_js',
  'automatic_lazy_rendering',
  'lazyload'
];
type FactRow = BuilderFactRow;

/** The tab-level line's title. */
const LINE_TITLE = 'Exclusion Builder rewrote this page';

/** Bounded wait for a fresh payload. */
const FRESH = { timeout: 15_000, intervals: [100, 250, 500] };

/** One changed row as every surface shows it. */
interface ChangedRow {
  readonly row: FactRow;
  readonly fact: BuilderFact;
  /** The panel card / report row name. */
  readonly name: string;
  /** The strip chip's label. */
  readonly chipLabel: string;
  /** The strip's modifier kind. */
  readonly kind: 'off' | 'excluded';
  /** The badge words. */
  readonly badge: string;
  /** The visible sentence. */
  readonly sentence: string;
  /** The strip line's hint. */
  readonly hint: string;
}

/** One real-session case. */
interface SyncCase {
  readonly title: string;
  /** Where the case runs: the docker site's `/fdt/` or a fixture path. */
  readonly page: { readonly site: '/fdt/' } | { readonly fixture: string };
  /** Compose the set in the open overlay. */
  readonly compose: (page: Page) => Promise<void>;
  /** The one marker's exact content after Apply. */
  readonly marker: string;
  readonly changed: ChangedRow;
}

const DELAY_OFF: ChangedRow = {
  row: 'delay_js',
  fact: { off: 'feature' },
  name: DELAY,
  chipLabel: 'Delay JS',
  kind: 'off',
  badge: 'Disabled in this tab',
  sentence: 'Disabled in this tab by the Exclusion Builder.',
  hint: 'Delay JS off'
};

const DEFER_OFF: ChangedRow = {
  ...DELAY_OFF,
  row: 'defer_all_js',
  name: DEFER,
  chipLabel: 'Defer JS',
  hint: 'Defer JS off'
};

const ALR_OFF: ChangedRow = {
  ...DELAY_OFF,
  row: 'automatic_lazy_rendering',
  name: LAZY_RENDER,
  chipLabel: LAZY_RENDER,
  hint: `${LAZY_RENDER} off`
};

/**
 * Turn a lane's feature off for the page (its switch; Delay JS and Defer JS: their Disabled mode).
 *
 * @param page The page with the overlay.
 * @param label The lane's label.
 */
async function disable(page: Page, label: string): Promise<void> {
  if (label === DELAY) {
    await chooseDelayMode(page, 'Disabled');
    return;
  }
  if (label === DEFER) {
    // Defer JS's switch is its mode control's Disabled too.
    const group = deferModeGroup(page);
    await group.getByText('Disabled', { exact: true }).click();
    await expect(group.getByRole('radio', { name: 'Disabled', exact: true })).toBeChecked();
    return;
  }
  const toggle = page.getByRole('switch', { name: `Disable feature: ${label} on this page` });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
}

/**
 * Add one row to a lane.
 *
 * @param page The page with the overlay.
 * @param label The lane's label.
 * @param text The row text.
 */
async function addRow(page: Page, label: string, text: string): Promise<void> {
  await page.getByRole('region', { name: label }).getByRole('button', { name: 'Add row' }).click();
  await page.keyboard.type(text);
  await page.keyboard.press('Tab');
}

const CASES: readonly SyncCase[] = [
  {
    title: 'Delay JS off',
    page: { site: '/fdt/' },
    compose: (page) => disable(page, DELAY),
    marker: 'v1 delay_js=off',
    changed: DELAY_OFF
  },
  {
    title: 'a Delay JS row',
    page: { site: '/fdt/' },
    // Matches one of the page's two delayed scripts (the navigation module).
    compose: (page) => addRow(page, DELAY, 'navigation'),
    marker: 'v1 delay_js=excluded:1',
    changed: {
      ...DELAY_OFF,
      fact: { excluded: 1 },
      kind: 'excluded',
      badge: '1 excluded',
      sentence: '1 script excluded by the Exclusion Builder.',
      hint: 'Delay JS: 1 excluded'
    }
  },
  {
    title: 'Defer JS off',
    page: { site: '/fdt/' },
    compose: (page) => disable(page, DEFER),
    marker: 'v1 defer_all_js=off',
    changed: DEFER_OFF
  },
  {
    title: 'a Defer JS row that turns it off for the page',
    page: { site: '/fdt/' },
    // Its open `\Q` quotes the joined pattern's closing parenthesis: WP Rocket's check fails.
    compose: (page) => addRow(page, DEFER, '\\p{L}\\Qab'),
    marker: 'v1 defer_all_js=page-off',
    changed: {
      ...DEFER_OFF,
      fact: { off: 'page' },
      badge: 'Off on this page',
      sentence: 'Off in this tab: an Exclusion Builder row stops WP Rocket deferring.',
      hint: 'Defer JS off on this page'
    }
  },
  {
    title: 'a LazyLoad row',
    page: { site: '/fdt/' },
    // The page's only lazy-loaded image.
    compose: (page) => addRow(page, LAZYLOAD, 'fdt-lcp'),
    marker: 'v1 lazyload=excluded:1',
    changed: {
      row: 'lazyload',
      fact: { excluded: 1 },
      name: LAZYLOAD,
      chipLabel: 'Lazyload Images',
      kind: 'excluded',
      badge: '1 excluded',
      sentence: '1 image excluded by the Exclusion Builder.',
      hint: 'Lazyload Images: 1 excluded'
    }
  },
  {
    title: 'Automatic Lazy Rendering off',
    page: { fixture: '/exclusion/lazy-render.html' },
    compose: (page) => disable(page, LAZY_RENDER),
    marker: 'v1 automatic_lazy_rendering=off',
    changed: ALR_OFF
  },
  {
    title: 'an Automatic Lazy Rendering row',
    page: { fixture: '/exclusion/lazy-render.html' },
    // One of the three sibling sections.
    compose: (page) => addRow(page, LAZY_RENDER, 'id="alr-two"'),
    marker: 'v1 automatic_lazy_rendering=excluded:1',
    changed: {
      ...ALR_OFF,
      fact: { excluded: 1 },
      kind: 'excluded',
      badge: '1 excluded',
      sentence: '1 element excluded by the Exclusion Builder.',
      hint: `${LAZY_RENDER}: 1 excluded`
    }
  }
];

/** The page's builder markers' `content`, from the live document (null mid-navigation). */
async function markers(page: Page): Promise<(string | null)[] | null> {
  return await page
    .evaluate(
      (name) =>
        Array.from(document.querySelectorAll(`meta[name="${name}"]`), (meta) =>
          meta.getAttribute('content')
        ),
      BUILDER_MARKER_META_NAME
    )
    .catch((error: unknown) => {
      // A destroyed context is a navigation in flight: poll again; anything else is real.
      if (error instanceof Error && error.message.includes('Execution context was destroyed'))
        return null;
      throw error;
    });
}

/** Each fact row's `builder` fact in the tab's current payload (null: no payload yet). */
async function payloadFacts(
  extension: ExtensionDriver,
  tabId: number
): Promise<Partial<Record<FactRow, BuilderFact>> | null> {
  const fdt = await extension
    .sendToTab<{
      wprDetections: Record<FactRow, { builder?: BuilderFact }>;
    } | null>(tabId, 'getFdtData')
    .catch(() => null);
  if (fdt === null) return null;
  const facts: Partial<Record<FactRow, BuilderFact>> = {};
  for (const row of FACT_ROWS) {
    const fact = fdt.wprDetections[row].builder;
    if (fact !== undefined) facts[row] = fact;
  }
  return facts;
}

/** Open a case's page. */
async function openCasePage(
  extension: ExtensionDriver,
  where: SyncCase['page']
): Promise<DriverPage> {
  // Param-free: WP Rocket serves its optimized (cached) page only to its own URL.
  return 'site' in where
    ? await openSitePage(extension, `${SITE_URL}${where.site}`)
    : await openFixturePage(extension, where.fixture);
}

/** Open the real panel on Detections, inspecting `tabId` through the devtools seam. */
async function openPanel(extension: ExtensionDriver, tabId: number): Promise<Page> {
  const panel = await extension.browserContext.newPage();
  await panel.addInitScript(devtoolsShim(tabId));
  await panel.goto(`${await panelPageUrl(extension)}#/detections`, { waitUntil: 'load' });
  return panel;
}

/** Apply the composed set and wait for the rewritten page (reloaded) and its active session. */
async function apply(page: Page): Promise<void> {
  // Apply reloads the tab through the session: the rewritten document is the next main-frame load.
  const reloaded = page.waitForEvent('load', APPLIED);
  await page.getByRole('button', { name: /^Apply$/ }).click();
  await reloaded;
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible(APPLIED);
}

/** The summary headline's "X of Y" figures. */
async function activeFigures(panel: Page): Promise<{ active: number; total: number }> {
  const headline = panel.locator('[data-fdt-page="detections"] [data-fdt-summary-headline]');
  await expect(headline).toHaveText(/\d+\s+of\s+\d+\s+optimizations active/);
  const match = /(\d+)\s+of\s+(\d+)/.exec((await headline.textContent()) ?? '');
  if (match === null) throw new Error('the summary headline lost its figures');
  return { active: Number(match[1]), total: Number(match[2]) };
}

/** A panel card by its row id. */
const card = (panel: Page, row: string): Locator =>
  panel.locator(`[data-fdt-page="detections"] [data-fdt-card-id="${row}"]`);

/** A strip row by its chip label. */
const stripRow = (page: Page, label: string): Locator =>
  page.locator(`${STRIP_HOST} .ins-row`, {
    has: page.locator('.ins-chip', { hasText: new RegExp(`^${label}$`) })
  });

/** Open the strip card from its pill with the keyboard (left as is when already open). */
async function openStripCard(page: Page): Promise<void> {
  const cardLocator = page.locator(`${STRIP_HOST} .ins-card`);
  if (await cardLocator.isVisible()) return;
  const pill = page.locator(`${STRIP_HOST} .ins-pill`);
  // The pass has answered once the identity carries a version.
  await expect(pill).toContainText(/WPR \d/, MOUNT);
  await pill.focus();
  await page.keyboard.press('Enter');
  await expect(cardLocator).toBeVisible();
}

/** Assert the panel card + summary carry the case's modifier. */
async function expectPanelModifier(
  panel: Page,
  changed: ChangedRow,
  served: { active: number; total: number }
): Promise<void> {
  const root = panel.locator('[data-fdt-page="detections"]');
  const changedCard = card(panel, changed.row);
  const badge = changedCard.locator('[data-fdt-card-modifier]');
  await expect(badge).toHaveAttribute('data-fdt-card-modifier', changed.kind, FRESH);
  await expect(badge).toContainText(changed.badge);
  // The sentence follows a comma assistive tech hears (visually hidden).
  await expect(changedCard.locator('[data-fdt-card-modifier-line]')).toHaveText(
    `, ${changed.sentence}`
  );
  // O-N2: WP Rocket's served verdict stays.
  await expect(changedCard.locator('[data-fdt="status-badge"]')).toHaveText('Active');
  // Only the changed card carries a modifier.
  await expect(root.locator('[data-fdt-card-modifier]')).toHaveCount(1);
  // O-N3: off counts as inactive, with the reason; excluded rows stay active.
  const headline = root.locator('[data-fdt-summary-headline]');
  if (changed.kind === 'off') {
    await expect(headline).toHaveText(
      new RegExp(
        `^\\s*${String(served.active - 1)}\\s+of\\s+${String(served.total)}\\s+optimizations active,\\s+1 off in this tab\\s*$`
      )
    );
  } else {
    await expect(headline).toHaveText(
      new RegExp(
        `^\\s*${String(served.active)}\\s+of\\s+${String(served.total)}\\s+optimizations active\\s*$`
      )
    );
  }
}

/** Assert the strip (open card) carries the case's modifier and tab-level line. */
async function expectStripModifier(page: Page, changed: ChangedRow): Promise<void> {
  await openStripCard(page);
  const line = page.locator(`${STRIP_HOST} [data-fdt-strip-builder]`);
  await expect(line.locator('.ins-builder-title')).toHaveText(LINE_TITLE);
  await expect(line.locator('[data-fdt-strip-builder-hint]')).toHaveText([changed.hint]);
  await expect(page.locator(`${STRIP_HOST} [role="dialog"]`)).toHaveAccessibleDescription(
    `${LINE_TITLE} — ${changed.hint}`
  );
  const row = stripRow(page, changed.chipLabel);
  const badge = row.locator('[data-fdt-strip-modifier]');
  await expect(badge).toHaveAttribute('data-fdt-strip-modifier', changed.kind);
  await expect(badge).toHaveText(changed.badge);
  await expect(row.locator('[data-fdt-strip-modifier-line]')).toHaveText(`, ${changed.sentence}`);
  // The served chip stays; a turned-off row drops the rewritten page's count.
  await expect(row.locator('.ins-chip')).toHaveClass(/ins-chip-ok/);
  await expect(row.locator('.ins-value')).toHaveCount(changed.kind === 'off' ? 0 : 1);
  await expect(page.locator(`${STRIP_HOST} [data-fdt-strip-modifier]`)).toHaveCount(1);
}

/** Copy the support report from the panel and return its lines (this copy's, never an earlier one). */
async function reportLines(panel: Page): Promise<string[]> {
  await panel.evaluate(() => navigator.clipboard.writeText(''));
  await panel.getByRole('button', { name: 'Copy report', exact: true }).click();
  await expect(panel.getByText('Report copied').first()).toBeVisible();
  await expect.poll(() => panel.evaluate(() => navigator.clipboard.readText())).not.toBe('');
  return (await panel.evaluate(() => navigator.clipboard.readText())).split('\n');
}

/** The report's summary line for `active` of `total`, with the off-in-tab suffix when given. */
function optimizationsLine(active: number, total: number, offInTab: number): string {
  const suffix = offInTab > 0 ? ` · ${String(offInTab)} off in this tab` : '';
  return `- **Optimizations:** ${String(active)} of ${String(total)} active${suffix}`;
}

/** Assert the report's summary line and the changed row. */
async function expectReport(
  panel: Page,
  changed: ChangedRow,
  served: { active: number; total: number }
): Promise<void> {
  const lines = await reportLines(panel);
  const off = changed.kind === 'off';
  expect(lines).toContain(
    optimizationsLine(off ? served.active - 1 : served.active, served.total, off ? 1 : 0)
  );
  const row = lines.find((line) =>
    line.startsWith(`| ${changed.name} | Active | Generator meta |`)
  );
  expect(row, `report row for ${changed.name}`).toBeDefined();
  expect(row).toContain(changed.sentence);
  expect(lines.filter((line) => line.includes('Exclusion Builder'))).toHaveLength(1);
}

/** Assert every surface reads the served page: no marker, no fact, no modifier. */
async function expectServed(
  extension: ExtensionDriver,
  opened: DriverPage,
  panel: Page,
  changed: ChangedRow,
  served: { active: number; total: number }
): Promise<void> {
  await expect.poll(() => payloadFacts(extension, opened.tabId), FRESH).toEqual({});
  expect(await markers(opened.page)).toEqual([]);
  const root = panel.locator('[data-fdt-page="detections"]');
  await expect(root.locator('[data-fdt-card-modifier]')).toHaveCount(0, FRESH);
  await expect(root.locator('[data-fdt-card-modifier-line]')).toHaveCount(0);
  await expect(card(panel, changed.row).locator('[data-fdt="status-badge"]')).toHaveText('Active');
  expect(await activeFigures(panel)).toEqual(served);
  await expectPillHint(opened.page, null);
  await openStripCard(opened.page);
  await expect(stripRow(opened.page, changed.chipLabel)).toBeVisible();
  await expect(opened.page.locator(`${STRIP_HOST} [data-fdt-strip-builder]`)).toHaveCount(0);
  await expect(opened.page.locator(`${STRIP_HOST} [data-fdt-strip-modifier]`)).toHaveCount(0);
  // The served count is back on a row the builder had turned off.
  await expect(stripRow(opened.page, changed.chipLabel).locator('.ins-value')).toHaveCount(1);
  // The report: the served summary, and no builder line anywhere.
  const lines = await reportLines(panel);
  expect(lines).toContain(optimizationsLine(served.active, served.total, 0));
  expect(lines.filter((line) => line.includes('Exclusion Builder'))).toEqual([]);
}

test.describe('builder state across surfaces over real sessions', () => {
  test.beforeEach(async ({ extension }) => {
    await extension.browserContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    await clearDrafts(extension);
    await clearWidgetMap(extension);
  });

  test.afterEach(async ({ extension }) => {
    await clearWidgetMap(extension);
    await clearDrafts(extension);
  });

  for (const syncCase of CASES) {
    test(`${syncCase.title}: marker, payload, panel, strip and report agree; Stop keeps them, a reload clears them`, async ({
      extension
    }) => {
      const { changed } = syncCase;
      const opened = await openCasePage(extension, syncCase.page);
      const panel = await openPanel(extension, opened.tabId);
      try {
        // The served page first: no marker, no fact; the served figures to compare with.
        await expect.poll(() => payloadFacts(extension, opened.tabId), FRESH).toEqual({});
        expect(await markers(opened.page)).toEqual([]);
        await expect(card(panel, changed.row).locator('[data-fdt="status-badge"]')).toHaveText(
          'Active',
          FRESH
        );
        const served = await activeFigures(panel);
        await expectPillHint(opened.page, null);

        await injectOverlay(extension, opened);
        await syncCase.compose(opened.page);
        await apply(opened.page);

        // The rewritten document: exactly one marker, its exact content.
        await expect.poll(() => markers(opened.page)).toEqual([syncCase.marker]);
        await expect
          .poll(() => payloadFacts(extension, opened.tabId), FRESH)
          .toEqual({ [changed.row]: changed.fact });
        await expectPanelModifier(panel, changed, served);
        await expectPillHint(opened.page, changed.kind);
        await expectStripModifier(opened.page, changed);
        await expectReport(panel, changed, served);

        // Stop: no reload — the rewritten page, and what every surface says of it, stay.
        const rewrittenOrigin = await opened.page.evaluate(() => performance.timeOrigin);
        await opened.page.getByRole('button', { name: 'Stop' }).click();
        await expect(opened.page.getByText('Session stopped')).toBeVisible();
        await expect.poll(() => markers(opened.page)).toEqual([syncCase.marker]);
        await expect
          .poll(() => payloadFacts(extension, opened.tabId), FRESH)
          .toEqual({ [changed.row]: changed.fact });
        await expectPanelModifier(panel, changed, served);
        await expectPillHint(opened.page, changed.kind);
        await expectStripModifier(opened.page, changed);
        // Still the same document: Stop did not navigate.
        expect(await opened.page.evaluate(() => performance.timeOrigin)).toBe(rewrittenOrigin);

        // A reload serves WP Rocket's page again: the served verdict alone.
        await opened.page.reload({ waitUntil: 'load' });
        await expectServed(extension, opened, panel, changed, served);
      } finally {
        await panel.close();
        await opened.page.close();
      }
    });
  }

  test('a served duplicate marker carries no fact; applied, the rewrite replaces it with its own', async ({
    extension
  }) => {
    const opened = await openFixturePage(extension, '/exclusion/builder-marker-spoof.html');
    const panel = await openPanel(extension, opened.tabId);
    try {
      // Two well-formed copies served by the page: not exactly one, so no fact anywhere.
      expect(await markers(opened.page)).toEqual(['v1 defer_all_js=off', 'v1 lazyload=excluded:9']);
      await expect.poll(() => payloadFacts(extension, opened.tabId), FRESH).toEqual({});
      await expect(card(panel, 'delay_js').locator('[data-fdt="status-badge"]')).toHaveText(
        'Active',
        FRESH
      );
      const served = await activeFigures(panel);
      await expect(panel.locator('[data-fdt-card-modifier]')).toHaveCount(0);
      await expectPillHint(opened.page, null);
      await openStripCard(opened.page);
      await expect(stripRow(opened.page, 'Delay JS')).toBeVisible();
      await expect(opened.page.locator(`${STRIP_HOST} [data-fdt-strip-builder]`)).toHaveCount(0);

      await injectOverlay(extension, opened);
      await disable(opened.page, DELAY);
      await apply(opened.page);
      // Both served copies are gone; the one marker is the rewrite's.
      await expect.poll(() => markers(opened.page)).toEqual(['v1 delay_js=off']);
      await expect
        .poll(() => payloadFacts(extension, opened.tabId), FRESH)
        .toEqual({ delay_js: { off: 'feature' } });
      await expectPanelModifier(panel, DELAY_OFF, served);
      await expectPillHint(opened.page, 'off');
      await expectStripModifier(opened.page, DELAY_OFF);
      await expectReport(panel, DELAY_OFF, served);
      await opened.page.getByRole('button', { name: 'Stop' }).click();
      await expect(opened.page.getByText('Session stopped')).toBeVisible();
      // Stop leaves the rewrite displayed: still only the rewrite's marker.
      await expect.poll(() => markers(opened.page)).toEqual(['v1 delay_js=off']);
    } finally {
      await panel.close();
      await opened.page.close();
    }
  });
});
