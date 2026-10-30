/**
 * Delay JS simulation end to end over REAL sessions on the docker site:
 * the overlay injected as the background opens it, a Delay mode picked,
 * Apply through the session backend (the page reloads, the served HTML is
 * rewritten in flight), then the fulfilled document, the page's runtime
 * behavior and every surface read off the tab.
 *
 * Pages: `/fdt/` with the delay scenario (`fdt-delay=1`), always a live
 * render (`fdt-no-store=1`, never stored) — served WITHOUT Delay JS
 * (`nowprocket=1`, the "off" page the simulation runs on) or WITH it (the
 * "on" page WP Rocket delays itself, the reference the simulation is
 * compared with); `/fdt-beacon/` as a second page of the site; and
 * `wp-login.php`.
 *
 * Cases: the off page simulated (runtime + delayed scripts in the fulfilled
 * document, the scenario's error only after an interaction, the marker
 * verified, "Simulated" on the overlay, the detection widget and the panel,
 * the toolbar badge unchanged, the bundled list named with why the latest
 * one did not run); the simulated render equal to WP Rocket's own; a Delay
 * row composed on top; Reset, Stop, a reload, and As served applied; the
 * session following the tab to a second page and to a page WP Rocket
 * already delays; the on page (Simulated not offered, Disabled and rows as
 * before); the login screen's warning; a forged marker never verified.
 *
 * The site itself is never changed: sessions are in-browser only, every
 * page is requested as served. One case per test, each in its own tab; the
 * widget map and the saved drafts cleared around each.
 */
import type { Locator, Page, Route } from '@playwright/test';

import {
  BUILDER_MARKER_META_NAME,
  SIMULATION_MARKER_META_NAME
} from '../../../lib/wp-rocket/constants';
import { readBadge } from '../helpers/badge';
import {
  APPLIED,
  DELAY,
  MOUNT,
  applyButton,
  clearDrafts,
  injectOverlay,
  lane,
  readBanners,
  readIndicator,
  reloadThroughSession,
  typeRow
} from '../helpers/exclusion-overlay';
import { expect, test, type ExtensionDriver } from '../helpers/extension';
import { devtoolsShim, panelPageUrl } from '../helpers/panel-data';
import {
  applySimulated,
  chooseDelayMode,
  delayModeGroup,
  openCapturedBuilder,
  type CapturedBuilder,
  delayedScriptCount,
  delayLaneLines,
  delayModeNotes,
  delayModes,
  documentSimulation,
  executedScriptCount,
  hasDelayRuntime,
  interact,
  normalizeDelayRender,
  simulatedChip,
  simulationMarkers,
  storedSession
} from '../helpers/simulation';
import { openSitePage, SITE_URL } from '../helpers/site';
import { clearWidgetMap, PILL_SUFFIX, STRIP_HOST } from '../helpers/strip-pill';

/** The page WP Rocket serves without Delay JS (the simulation's page). */
const OFF = `${SITE_URL}/fdt/?fdt-delay=1&fdt-no-store=1&nowprocket=1`;

/** The same page with WP Rocket's own Delay JS (the reference render). */
const ON = `${SITE_URL}/fdt/?fdt-delay=1&fdt-no-store=1`;

/** A second page of the site, also served without Delay JS. */
const SECOND = `${SITE_URL}/fdt-beacon/?fdt-no-store=1&nowprocket=1`;

/** The scenario's delayed script that throws once WP Rocket's queue runs it. */
const SCENARIO_ERROR = 'ReferenceError: fdtDelayTypedDependency is not defined';

/** Scripts WP Rocket delays on the scenario page (its own render, verified live). */
const SCENARIO_DELAYED = 5;

/** The WP Rocket version simulated on a page that names none (the newest supported). */
const SIMULATED_VERSION = '3.24';

/** A simulation marker naming Delay JS with a 128-bit id. */
const MARKER = /^v1 delay_js=simulated id=[0-9a-f]{32}$/;

/** Bounded wait for surfaces following a load. */
const FRESH = { timeout: 15_000, intervals: [100, 250, 500] };

/** The surfaces' simulated words. */
const WORDS = {
  badge: 'Simulated in this tab',
  sentence:
    ", Simulated in this tab by the extension — not the site's configuration; its own WP Rocket exclusions aren't included.",
  unverifiedBadge: 'Simulation not verified',
  unverifiedSentence:
    ", This page claims a simulation the extension can't confirm, so it's read as served.",
  stripLine: 'Exclusion Builder rewrote this page',
  stripHint: 'Delay JS simulated',
  appliedBody:
    'This page was rendered with your exclusions and WP Rocket’s Delay JavaScript execution simulated — not the site’s real configuration. The site’s own WP Rocket exclusions aren’t included (the extension can’t read them). Add them as rows to test them.',
  bundledList: `Exclusion list: bundled with WP Rocket ${SIMULATED_VERSION} (latest list unreachable: network error)`,
  version: `Simulated · WP Rocket ${SIMULATED_VERSION}`,
  siteExclusions:
    'The site’s own WP Rocket exclusions aren’t included (the extension can’t read them). Add them as rows to test them.',
  alreadyDelayed: 'WP Rocket already delays scripts on this page — exclusions apply to its output.',
  adminScreen:
    'This is a WordPress admin or login screen. WP Rocket never optimizes these screens, so a simulation here shows something the site never serves.'
} as const;

/** The simulation's lane count line. */
const countLine = (delayed: number, excluded: number): string =>
  `${String(delayed)} delayed by the simulation · ${String(excluded)} excluded by your rows`;

/** Open the real panel on Detections, inspecting `tabId` through the devtools seam. */
async function openPanel(extension: ExtensionDriver, tabId: number): Promise<Page> {
  const panel = await extension.browserContext.newPage();
  await panel.addInitScript(devtoolsShim(tabId));
  await panel.goto(`${await panelPageUrl(extension)}#/detections`, { waitUntil: 'load' });
  return panel;
}

/** The panel's Delay JS card. */
const delayCard = (panel: Page): Locator =>
  panel.locator('[data-fdt-page="detections"] [data-fdt-card-id="delay_js"]');

/** The panel summary's headline. */
const headline = (panel: Page): Locator =>
  panel.locator('[data-fdt-page="detections"] [data-fdt-summary-headline]');

/** The summary headline's "X of Y" figures, once it shows them. */
async function activeFigures(panel: Page): Promise<{ active: number; total: number }> {
  await expect(headline(panel)).toHaveText(/\d+\s+of\s+\d+\s+optimizations active/, FRESH);
  const match = /(\d+)\s+of\s+(\d+)/.exec((await headline(panel).textContent()) ?? '');
  if (match === null) throw new Error('the summary headline lost its figures');
  return { active: Number(match[1]), total: Number(match[2]) };
}

/** The open strip card's Delay JS row. */
const stripDelayRow = (page: Page): Locator =>
  page.locator(`${STRIP_HOST} .ins-row`, {
    has: page.locator('.ins-chip', { hasText: /^Delay JS$/ })
  });

/** Open the strip card from its pill with the keyboard (left as is when already open). */
async function openStripCard(page: Page): Promise<void> {
  const card = page.locator(`${STRIP_HOST} .ins-card`);
  if (await card.isVisible()) return;
  const pill = page.locator(`${STRIP_HOST} .ins-pill`);
  await expect(pill).toContainText('WPR', MOUNT);
  await pill.focus();
  await page.keyboard.press('Enter');
  await expect(card).toBeVisible();
}

/** The first delayed script's id the scenario page serves, by id: the benign lifecycle one. */
const LIFECYCLE_ID = 'fdt-delayed-lifecycle-js';

/** Whether `html` serves the script with `id` delayed. */
function servesDelayed(html: string, id: string): boolean {
  const tag = new RegExp(`<script\\b[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0] ?? '';
  return /\btype="(?:text\/)?rocketlazyloadscript"/.test(tag);
}

/** The page's builder markers' `content`. */
async function builderMarkers(page: Page): Promise<(string | null)[]> {
  return await page.evaluate(
    (name) =>
      Array.from(document.querySelectorAll(`meta[name="${name}"]`), (meta) =>
        meta.getAttribute('content')
      ),
    BUILDER_MARKER_META_NAME
  );
}

/**
 * Open a site page with error + document capture attached, and the overlay in it.
 *
 * @param extension The driver.
 * @param url The site page (default: the off page).
 */
async function openSiteBuilder(
  extension: ExtensionDriver,
  url: string = OFF
): Promise<CapturedBuilder> {
  return await openCapturedBuilder(extension, (hook) => openSitePage(extension, url, hook));
}

test.describe('Delay JS simulation over real sessions', () => {
  test.beforeEach(async ({ extension }) => {
    await clearDrafts(extension);
    await clearWidgetMap(extension);
  });

  test.afterEach(async ({ extension }) => {
    await clearWidgetMap(extension);
    await clearDrafts(extension);
  });

  test('the off page simulated: runtime + delayed scripts served, the error only after an interaction, "Simulated" on every surface, the badge unchanged', async ({
    extension
  }) => {
    const { opened, errors, lastDocument } = await openSiteBuilder(extension);
    const { page, tabId } = opened;
    const panel = await openPanel(extension, tabId);
    try {
      // The served page: no simulation anywhere, the served figures and badge to compare with.
      const served = await activeFigures(panel);
      await expect(delayCard(panel).locator('[data-fdt-card-simulation]')).toHaveCount(0);
      await expect.poll(async () => (await readBadge(extension, tabId)).text, FRESH).not.toBe('');
      const badgeBefore = await readBadge(extension, tabId);
      expect(await delayModes(page)).toEqual([
        { value: 'served', checked: true, disabled: false },
        { value: 'simulated', checked: false, disabled: false },
        { value: 'disabled', checked: false, disabled: false }
      ]);
      await expect(delayModeNotes(page)).toHaveCount(0);

      errors.reset();
      // No pointer event reaches this page before the "nothing ran" reads below: the
      // apply is keyboard-driven, so no synthetic hover can trigger the runtime early.
      expect(await applySimulated(page)).toBe('Applied');

      // The fulfilled document: WP Rocket's runtime, the scenario's scripts delayed, one marker.
      const html = await lastDocument();
      expect(hasDelayRuntime(html)).toBe(true);
      expect(delayedScriptCount(html)).toBe(SCENARIO_DELAYED);
      const report = await documentSimulation(extension, tabId);
      expect(report).toMatchObject({
        feature: 'delay_js',
        state: 'simulated',
        delayed: SCENARIO_DELAYED,
        runtimeInjected: true,
        wpRocketVersion: SIMULATED_VERSION,
        listSource: 'bundled',
        listMiss: 'network-error'
      });
      const markers = await simulationMarkers(page);
      expect(markers).toHaveLength(1);
      expect(markers?.[0]).toMatch(MARKER);
      expect(markers?.[0]).toContain(`id=${String(report.markerId)}`);

      // Nothing ran before an interaction; WP Rocket's queue runs every delayed script after one.
      expect(await executedScriptCount(page)).toBe(0);
      expect(errors.errors).toEqual([]);
      await interact(page);
      await expect.poll(() => executedScriptCount(page), FRESH).toBe(SCENARIO_DELAYED);
      await expect.poll(() => errors.errors, FRESH).toEqual([SCENARIO_ERROR]);

      // The overlay: applied over a simulated render, the lane's simulation lines.
      expect(await readIndicator(page, 'header')).toEqual({
        label: 'Applied',
        tone: 'ok',
        glyph: 'lucide-check'
      });
      await expect(simulatedChip(page, 'header')).toHaveText('Simulated');
      await expect(simulatedChip(page, 'header')).toHaveAttribute('data-tone', 'info');
      const banners = await readBanners(page);
      expect(banners.map(({ title, body }) => ({ title, body }))).toEqual([
        { title: 'Applied', body: WORDS.appliedBody }
      ]);
      expect(await delayLaneLines(page)).toEqual(
        expect.arrayContaining([
          countLine(SCENARIO_DELAYED, 0),
          WORDS.version,
          WORDS.siteExclusions,
          WORDS.bundledList
        ])
      );

      // The detection widget: the verified marker as the Delay JS row's modifier + the tab line.
      const glyph = page.locator(`${STRIP_HOST} [data-fdt-strip-pill-builder]`);
      await expect(glyph).toHaveAttribute('data-fdt-strip-pill-builder', 'simulated', FRESH);
      await expect(page.locator(`${STRIP_HOST} .ins-pill`)).toHaveAccessibleName(
        new RegExp(PILL_SUFFIX)
      );
      await openStripCard(page);
      const row = stripDelayRow(page);
      await expect(row.locator('[data-fdt-strip-modifier]')).toHaveAttribute(
        'data-fdt-strip-modifier',
        'simulated'
      );
      await expect(row.locator('[data-fdt-strip-modifier]')).toHaveText(WORDS.badge);
      await expect(row.locator('[data-fdt-strip-modifier-line]')).toHaveText(WORDS.sentence);
      const line = page.locator(`${STRIP_HOST} [data-fdt-strip-builder]`);
      await expect(line.locator('.ins-builder-title')).toHaveText(WORDS.stripLine);
      await expect(line.locator('[data-fdt-strip-builder-hint]')).toHaveText([WORDS.stripHint]);

      // The panel: the card's simulation modifier; the summary counts it apart from "active".
      const card = delayCard(panel);
      await expect(card.locator('[data-fdt-card-simulation]')).toHaveAttribute(
        'data-fdt-card-simulation',
        'simulated',
        FRESH
      );
      await expect(card.locator('[data-fdt-card-simulation]')).toContainText(WORDS.badge);
      await expect(card.locator('[data-fdt-card-simulation-line]')).toHaveText(WORDS.sentence);
      await expect(headline(panel)).toHaveText(
        new RegExp(
          `^\\s*${String(served.active)}\\s+of\\s+${String(served.total)}\\s+optimizations active,\\s+1 simulated in this tab\\s*$`
        )
      );

      // The toolbar badge reads the served page: a simulation is not WP Rocket.
      expect(await readBadge(extension, tabId)).toEqual(badgeBefore);
      await page.getByRole('button', { name: 'Stop' }).click();
    } finally {
      await panel.close();
      await page.close();
    }
  });

  test('the simulated render equals WP Rocket’s own Delay JS render, and runs as many scripts', async ({
    extension
  }) => {
    // Live-render guard: the reference is WP Rocket's live render, never a stored copy.
    const reference = await extension.browserContext.request.get(ON);
    expect(reference.ok()).toBe(true);
    expect(reference.headers()['last-modified']).toBeUndefined();
    const onHtml = await reference.text();
    expect(onHtml).not.toMatch(/cached@\d+/);
    expect(onHtml).toMatch(
      /<meta name="generator" content="WP Rocket [^"]*" data-wpr-features="[^"]*wpr_delay_js/
    );
    expect(delayedScriptCount(onHtml)).toBe(SCENARIO_DELAYED);

    const { opened, lastDocument } = await openSiteBuilder(extension);
    const onPage = await extension.browserContext.newPage();
    try {
      expect(await applySimulated(opened.page)).toBe('Applied');
      const simulated = await lastDocument();
      expect(normalizeDelayRender(simulated)).toBe(normalizeDelayRender(onHtml));

      await onPage.goto(ON, { waitUntil: 'load' });
      await interact(onPage);
      await interact(opened.page);
      await expect.poll(() => executedScriptCount(onPage), FRESH).toBe(SCENARIO_DELAYED);
      await expect.poll(() => executedScriptCount(opened.page), FRESH).toBe(SCENARIO_DELAYED);
      await opened.page.getByRole('button', { name: 'Stop' }).click();
    } finally {
      await onPage.close();
      await opened.page.close();
    }
  });

  test('a Delay row composes with the simulation: its script served as is, counted as excluded on the overlay and the panel', async ({
    extension
  }) => {
    const { opened, lastDocument } = await openSiteBuilder(extension);
    const { page, tabId } = opened;
    try {
      await chooseDelayMode(page, 'Simulated');
      await typeRow(page, DELAY, 'fdt-delayed-lifecycle');
      await page.keyboard.press('Tab');
      expect(await reloadThroughSession(page, () => applyButton(page).click())).toBe('Applied');

      const html = await lastDocument();
      expect(hasDelayRuntime(html)).toBe(true);
      expect(servesDelayed(html, LIFECYCLE_ID)).toBe(false);
      expect(delayedScriptCount(html)).toBe(SCENARIO_DELAYED - 1);
      expect(await documentSimulation(extension, tabId)).toMatchObject({
        state: 'simulated',
        delayed: SCENARIO_DELAYED
      });
      expect(await delayLaneLines(page)).toContain(countLine(SCENARIO_DELAYED, 1));
      await expect(lane(page, DELAY).getByRole('listitem').nth(0)).toContainText('1 match');
      expect(await simulationMarkers(page)).toEqual([expect.stringMatching(MARKER)]);
      expect(await builderMarkers(page)).toEqual(['v1 delay_js=excluded:1']);

      // The panel card carries both: the simulation, and the row's "1 excluded".
      const panel = await openPanel(extension, tabId);
      try {
        const card = delayCard(panel);
        await expect(card.locator('[data-fdt-card-simulation]')).toHaveAttribute(
          'data-fdt-card-simulation',
          'simulated',
          FRESH
        );
        await expect(card.locator('[data-fdt-card-modifier]')).toHaveAttribute(
          'data-fdt-card-modifier',
          'excluded'
        );
        await expect(card.locator('[data-fdt-card-modifier]')).toContainText('1 excluded');
      } finally {
        await panel.close();
      }
      await page.getByRole('button', { name: 'Stop' }).click();
    } finally {
      await page.close();
    }
  });

  test('Reset re-applies the simulation over an edit; Stop keeps the simulated page, a reload serves it as is; As served applied removes it', async ({
    extension
  }) => {
    const { opened, lastDocument } = await openSiteBuilder(extension);
    const { page, tabId } = opened;
    try {
      expect(await applySimulated(page)).toBe('Applied');
      const first = (await documentSimulation(extension, tabId)).markerId;
      const reset = page.getByRole('button', { name: 'Reset' });
      await expect(reset).toHaveAttribute('aria-disabled', 'true');

      // An edit (As served, not applied) frees Reset; Reset discards it and re-simulates.
      await chooseDelayMode(page, 'As served');
      await expect(reset).not.toHaveAttribute('aria-disabled', 'true');
      expect(await reloadThroughSession(page, () => reset.click())).toBe('Applied');
      await expect(
        delayModeGroup(page).getByRole('radio', { name: 'Simulated', exact: true })
      ).toBeChecked();
      expect(hasDelayRuntime(await lastDocument())).toBe(true);
      const second = await documentSimulation(extension, tabId);
      expect(second.state).toBe('simulated');
      expect(second.markerId).not.toBe(first);

      // Stop: no navigation — the simulated page stays, and says a reload removes it.
      const rewrittenOrigin = await page.evaluate(() => performance.timeOrigin);
      await page.getByRole('button', { name: 'Stop' }).click();
      await expect
        .poll(
          async () =>
            (await readBanners(page)).find((banner) => banner.title === 'Session stopped')?.body,
          FRESH
        )
        .toBe('Reload to see the page without exclusions or the simulation.');
      await expect(simulatedChip(page, 'header')).toBeVisible();
      await expect(delayModeNotes(page)).toHaveText([
        'Simulated · reload to see the page without it.'
      ]);
      expect(await simulationMarkers(page)).toEqual([expect.stringMatching(MARKER)]);
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(rewrittenOrigin);
      expect(await storedSession(extension, tabId)).toBeNull();

      // A reload serves the page as WP Rocket does: no runtime, no marker.
      await page.reload({ waitUntil: 'load' });
      expect(hasDelayRuntime(await lastDocument())).toBe(false);
      expect(await simulationMarkers(page)).toEqual([]);

      // Simulated again, then a reload inside the session: still simulated.
      await injectOverlay(extension, opened);
      expect(await applySimulated(page)).toBe('Applied');
      await page.reload({ waitUntil: 'load' });
      await expect(page.getByRole('heading', { name: 'Exclusion builder' })).toBeVisible(APPLIED);
      expect(hasDelayRuntime(await lastDocument())).toBe(true);
      await expect
        .poll(() => simulationMarkers(page), FRESH)
        .toEqual([expect.stringMatching(MARKER)]);

      // As served + Apply: the exclusions alone, no simulation asked or served.
      await chooseDelayMode(page, 'As served');
      expect(await reloadThroughSession(page, () => applyButton(page).click())).toBe('Applied');
      const html = await lastDocument();
      expect(hasDelayRuntime(html)).toBe(false);
      expect(delayedScriptCount(html)).toBe(0);
      expect(await simulationMarkers(page)).toEqual([]);
      await expect(simulatedChip(page, 'header')).toHaveCount(0);
      const session = await storedSession(extension, tabId);
      expect(session?.simulate).toBeUndefined();
      expect(session?.document?.simulation).toBeUndefined();
      await page.getByRole('button', { name: 'Stop' }).click();
    } finally {
      await page.close();
    }
  });

  test('the session follows the tab: a second page is simulated too, a page WP Rocket delays is left as served', async ({
    extension
  }) => {
    const { opened, lastDocument } = await openSiteBuilder(extension);
    const { page, tabId } = opened;
    try {
      expect(await applySimulated(page)).toBe('Applied');

      // A second page of the site, opened in the tab: simulated, the overlay back on it.
      await page.goto(SECOND, { waitUntil: 'load' });
      await expect(page.getByRole('heading', { name: 'Exclusion builder' })).toBeVisible(APPLIED);
      expect(hasDelayRuntime(await lastDocument())).toBe(true);
      expect((await documentSimulation(extension, tabId)).state).toBe('simulated');
      await expect
        .poll(() => simulationMarkers(page), FRESH)
        .toEqual([expect.stringMatching(MARKER)]);
      await expect(simulatedChip(page, 'header')).toBeVisible(FRESH);
      await expect(page.locator(`${STRIP_HOST} [data-fdt-strip-pill-builder]`)).toHaveAttribute(
        'data-fdt-strip-pill-builder',
        'simulated',
        FRESH
      );

      // A page WP Rocket already delays: its own Delay JS, nothing simulated, the mode kept.
      await page.goto(ON, { waitUntil: 'load' });
      await expect(page.getByRole('heading', { name: 'Exclusion builder' })).toBeVisible(APPLIED);
      await expect
        .poll(
          async () => (await storedSession(extension, tabId))?.document?.simulation?.state,
          FRESH
        )
        .toBe('already-served');
      const html = await lastDocument();
      expect(html).toMatch(/data-wpr-features="[^"]*wpr_delay_js/);
      expect(await simulationMarkers(page)).toEqual([]);
      await expect
        .poll(async () => (await readBanners(page)).map((banner) => banner.title), FRESH)
        .toContain('Applied — WP Rocket already delays scripts here');
      await expect(delayModeNotes(page)).toContainText([
        'Simulated doesn’t apply here, so this page runs as served (Simulated stays set for other pages).'
      ]);
      await expect(simulatedChip(page, 'header')).toHaveCount(0);
      await page.getByRole('button', { name: 'Stop' }).click();
    } finally {
      await page.close();
    }
  });

  test('the on page: Simulated is not offered and says why; Disabled and rows apply as before', async ({
    extension
  }) => {
    const { opened, lastDocument } = await openSiteBuilder(extension, ON);
    const { page, tabId } = opened;
    try {
      await expect
        .poll(() => delayModes(page), FRESH)
        .toEqual([
          { value: 'served', checked: true, disabled: false },
          { value: 'simulated', checked: false, disabled: true },
          { value: 'disabled', checked: false, disabled: false }
        ]);
      await expect(delayModeNotes(page)).toHaveText([WORDS.alreadyDelayed]);

      // Disabled: every delayed script restored, no simulation.
      await chooseDelayMode(page, 'Disabled');
      expect(await reloadThroughSession(page, () => applyButton(page).click())).toBe('Applied');
      expect(delayedScriptCount(await lastDocument())).toBe(0);
      await expect(
        lane(page, DELAY).getByText(
          `All ${String(SCENARIO_DELAYED)} delayed scripts restored (feature disabled)`
        )
      ).toBeVisible();
      expect(await builderMarkers(page)).toEqual(['v1 delay_js=off']);
      expect(await simulationMarkers(page)).toEqual([]);
      expect((await storedSession(extension, tabId))?.document?.simulation).toBeUndefined();

      // As served + a row: the row restores its script out of WP Rocket's own output.
      await chooseDelayMode(page, 'As served');
      await typeRow(page, DELAY, 'fdt-delayed-lifecycle');
      await page.keyboard.press('Tab');
      expect(await reloadThroughSession(page, () => applyButton(page).click())).toBe('Applied');
      const html = await lastDocument();
      expect(servesDelayed(html, LIFECYCLE_ID)).toBe(false);
      expect(delayedScriptCount(html)).toBe(SCENARIO_DELAYED - 1);
      await expect(lane(page, DELAY).getByRole('listitem').nth(0)).toContainText('1 match');
      expect(await builderMarkers(page)).toEqual(['v1 delay_js=excluded:1']);
      await page.getByRole('button', { name: 'Stop' }).click();
    } finally {
      await page.close();
    }
  });

  test('the login screen warns that WP Rocket never optimizes it, and the simulation still applies', async ({
    extension
  }) => {
    const { opened, lastDocument } = await openSiteBuilder(extension, `${SITE_URL}/wp-login.php`);
    const { page, tabId } = opened;
    try {
      await expect(delayModeNotes(page)).toHaveText([WORDS.adminScreen]);
      expect((await delayModes(page)).find((mode) => mode.value === 'simulated')?.disabled).toBe(
        false
      );
      expect(await applySimulated(page)).toBe('Applied');
      expect(hasDelayRuntime(await lastDocument())).toBe(true);
      expect((await documentSimulation(extension, tabId)).state).toBe('simulated');
      expect(await simulationMarkers(page)).toEqual([expect.stringMatching(MARKER)]);
      await expect(delayModeNotes(page)).toHaveText([WORDS.adminScreen]);
      await page.getByRole('button', { name: 'Stop' }).click();
    } finally {
      await page.close();
    }
  });

  test('a page serving its own simulation marker is never read as simulated: "not verified", the badge unchanged', async ({
    extension
  }) => {
    // The URL as served first, for the badge it earns.
    const forgedUrl = `${OFF}&fdt-forged-marker=1`;
    const plain = await openSitePage(extension, forgedUrl);
    await expect
      .poll(async () => (await readBadge(extension, plain.tabId)).text, FRESH)
      .not.toBe('');
    const badgeServed = await readBadge(extension, plain.tabId);
    await plain.page.close();

    // Then served with a well-formed marker of its own (an id the extension never drew).
    const forge = async (route: Route): Promise<void> => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        '<head>',
        `<head><meta name="${SIMULATION_MARKER_META_NAME}" content="v1 delay_js=simulated id=0123456789abcdef0123456789abcdef">`
      );
      await route.fulfill({ response, body });
    };
    await extension.browserContext.route(forgedUrl, forge);
    const forged = await openSitePage(extension, forgedUrl);
    const panel = await openPanel(extension, forged.tabId);
    try {
      expect(await simulationMarkers(forged.page)).toHaveLength(1);
      await openStripCard(forged.page);
      const row = stripDelayRow(forged.page);
      await expect(row.locator('[data-fdt-strip-modifier]')).toHaveAttribute(
        'data-fdt-strip-modifier',
        'unverified',
        FRESH
      );
      await expect(row.locator('[data-fdt-strip-modifier]')).toHaveText(WORDS.unverifiedBadge);
      await expect(row.locator('[data-fdt-strip-modifier-line]')).toHaveText(
        WORDS.unverifiedSentence
      );
      // Never the simulated words: no tab line, no pill glyph.
      await expect(forged.page.locator(`${STRIP_HOST} [data-fdt-strip-builder]`)).toHaveCount(0);
      await expect(forged.page.locator(`${STRIP_HOST} [data-fdt-strip-pill-builder]`)).toHaveCount(
        0
      );

      const card = delayCard(panel);
      await expect(card.locator('[data-fdt-card-simulation]')).toHaveAttribute(
        'data-fdt-card-simulation',
        'unverified',
        FRESH
      );
      await expect(card.locator('[data-fdt-card-simulation-line]')).toHaveText(
        WORDS.unverifiedSentence
      );
      await expect(headline(panel)).toHaveText(/optimizations active, simulation not verified\s*$/);
      expect(await readBadge(extension, forged.tabId)).toEqual(badgeServed);
    } finally {
      await panel.close();
      await forged.page.close();
      await extension.browserContext.unroute(forgedUrl, forge);
    }
  });
});
