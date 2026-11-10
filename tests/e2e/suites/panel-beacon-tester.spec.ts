/**
 * The Beacon Tester page over a real run (P14C C1): the panel asks the
 * fixture tab to run WP Rocket's beacon — the runner injected on demand —
 * and renders each outcome: the desktop viewport bail at WP Rocket's
 * 1600 × 700 defaults (the fixture window is 1280 × 800), then, with lower
 * thresholds, the completed run's candidate table (the hero first, as `lcp`)
 * and the lazy-render hashes; the settings survive a panel reload. The page
 * is screenshotted in both palettes at the compact floor and a wide size
 * (no horizontal overflow at either).
 *
 * The beacon instructions card over the local WordPress site's beacon page
 * (P14.5C.5): the summary matches the page's own config, the three groups,
 * the raw JSON and its copy (no request field), every width, both palettes
 * and reduced motion, a reload keeping the view, and a navigation to a page
 * without the beacon reading "No longer on the page" until dismissed.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { devtoolsShim, openPanelForFixture, panelPageUrl } from '../helpers/panel-data';
import { openSitePage, SITE_URL } from '../helpers/site';

/** Open the Beacon Tester route and wait for its loaded form. */
async function openTester(panel: Page): Promise<void> {
  await panel.evaluate(() => {
    location.hash = '#/beacon-tester';
  });
  await expect(panel.getByRole('heading', { level: 1, name: 'Beacon Tester' })).toBeVisible();
  await expect(panel.getByLabel('Candidate elements')).toBeVisible();
}

/**
 * Toggle a switch the way a pointer does: its track (the input is visually hidden).
 *
 * @param panel The panel page.
 * @param name The switch's label.
 */
async function toggle(panel: Page, name: string): Promise<void> {
  const id = await panel.getByRole('switch', { name }).getAttribute('id');
  if (id === null) throw new Error(`The ${name} switch has no id`);
  await panel.locator(`[id="${id.replace(/-input$/, '-control')}"]`).click();
}

/** The finished run's outcome block. */
function outcome(panel: Page) {
  return panel.locator('[data-fdt="beacon-outcome"]');
}

test('runs the beacon on the inspected page: viewport bail, results, persisted settings', async ({
  extension
}, info) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/beacon/candidates.html');
  try {
    await openTester(panel);
    // A page without WP Rocket's beacon: the instructions card's one calm line.
    await expect(panel.locator('[data-fdt="beacon-instructions"]')).toHaveAttribute(
      'data-fdt-beacon-instructions',
      'none'
    );
    await toggle(panel, 'Optimize Critical Images');
    await toggle(panel, 'Automatic Lazy Rendering');

    // WP Rocket's desktop defaults need a viewport of at least 1600 × 700.
    await panel.locator('[data-fdt-beacon-run]').click();
    await expect(outcome(panel)).toHaveAttribute('data-fdt-beacon-outcome', 'bailed');
    await expect(outcome(panel)).toContainText('at least 1,600 × 700 px');

    await panel.getByLabel('Viewport width (px)').fill('1000');
    await panel.getByLabel('Viewport height (px)').fill('600');
    await panel.locator('[data-fdt-beacon-run]').click();
    await expect(outcome(panel)).toHaveAttribute('data-fdt-beacon-outcome', 'completed');
    await expect(outcome(panel)).toContainText('Beacon test complete');

    // The run opens the critical images: the hero is the LCP.
    const candidates = panel.locator('[data-fdt="beacon-candidate-row"]');
    await expect(candidates.first()).toContainText('#hero');
    await expect(candidates.first()).toContainText('lcp');
    expect(await candidates.count()).toBeGreaterThanOrEqual(2);

    await panel.getByRole('tab', { name: /Lazy rendering/ }).click();
    const hashes = panel.locator('[data-fdt="beacon-lazy-row"]');
    await expect(hashes).toHaveText(['far-section-one', 'far-section-two']);

    // The fixture page is not scrolled or changed by the run.
    expect(await fixture.page.evaluate(() => window.scrollY)).toBe(0);

    for (const scheme of ['light', 'dark'] as const) {
      await panel.emulateMedia({ colorScheme: scheme });
      for (const width of [320, 1280]) {
        await panel.setViewportSize({ width, height: 800 });
        await panel.getByRole('tab', { name: /Critical images/ }).click();
        const overflow = await panel
          .locator('[data-fdt="panel-content"]')
          .evaluate((element) => element.scrollWidth - element.clientWidth);
        expect(overflow, `horizontal overflow at ${String(width)} px (${scheme})`).toBe(0);
        await info.attach(`beacon-tester-${scheme}-${String(width)}`, {
          body: await panel.screenshot({ fullPage: true }),
          contentType: 'image/png'
        });
        await panel.getByRole('tab', { name: 'Settings' }).click();
        await expect(panel.getByLabel('Candidate elements')).toBeVisible();
        expect(
          await panel
            .locator('[data-fdt="panel-content"]')
            .evaluate((element) => element.scrollWidth - element.clientWidth),
          `settings overflow at ${String(width)} px (${scheme})`
        ).toBe(0);
        await info.attach(`beacon-tester-settings-${scheme}-${String(width)}`, {
          body: await panel.locator('[data-fdt="panel-content"]').screenshot(),
          contentType: 'image/png'
        });
      }
    }

    // The settings were saved: a fresh panel document shows them.
    await panel.reload({ waitUntil: 'load' });
    await openTester(panel);
    await expect(panel.getByLabel('Viewport width (px)')).toHaveValue('1000');
    await expect(panel.getByRole('switch', { name: 'Automatic Lazy Rendering' })).toBeChecked();
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

/** The site's beacon page, rendered fresh (never a stored copy). */
const BEACON_PAGE = `${SITE_URL}/fdt-beacon/?fdt-no-store=1`;

/**
 * A page without the beacon, deterministically: a URL the site does not have,
 * so WordPress answers 404, and WP Rocket's buffer processes only 200
 * responses, so it never adds the beacon to it (a real page's beacon depends
 * on its stored rows).
 */
const NO_BEACON_PAGE = `${SITE_URL}/fdt-no-such-page/?fdt-no-store=1`;

/** The beacon config fields the card reads (the plugin's own names). */
interface PageBeaconConfig {
  readonly nonce: string;
  readonly is_mobile: boolean;
  readonly status: Record<string, unknown>;
}

test('beacon instructions card: follows the site page, groups, raw copy, stale after navigation', async ({
  extension
}, info) => {
  const site = await openSitePage(extension, BEACON_PAGE);
  const panel = await extension.browserContext.newPage();
  try {
    // The page's own config, read where WP Rocket printed it.
    const config = await site.page.evaluate(
      () =>
        (window as unknown as { rocket_beacon_data?: PageBeaconConfig }).rocket_beacon_data ?? null
    );
    // WP Rocket drops the beacon once every feature's row is saved for the URL.
    if (config === null) {
      throw new Error(
        'beacon absent on /fdt-beacon/ (its rows were saved) — run docker/scripts/reset.sh'
      );
    }
    const known = ['atf', 'lrc', 'preload_fonts', 'preconnect_external_domain'];
    const on = known.filter((key) => config.status[key] === true).length;

    await panel.addInitScript(devtoolsShim(site.tabId, { origin: SITE_URL, resources: [] }));
    await panel.goto(`${await panelPageUrl(extension)}#/beacon-tester`, { waitUntil: 'load' });
    await expect(panel.getByRole('heading', { level: 1, name: 'Beacon Tester' })).toBeVisible();

    const card = panel.locator('[data-fdt="beacon-instructions"]');
    await expect(card).toHaveAttribute('data-fdt-beacon-instructions', 'instructions');
    await expect(card.locator('[data-fdt-beacon-instructions-summary]')).toHaveText(
      `${String(on)} of 4 features on · ${config.is_mobile ? 'Mobile' : 'Desktop'}`
    );
    // Collapsed by default.
    await expect(card.locator('[data-fdt-beacon-instructions-details]')).toHaveCount(0);

    const toggle = card.locator('[data-fdt-beacon-instructions-toggle]');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(card.locator('[data-fdt-beacon-instructions-group] h3')).toHaveText([
      /^Features/,
      /^Elements checked\d+$/,
      /^Exclusions\d+$/
    ]);
    await expect(
      card.locator('[data-fdt-beacon-instructions-list="elements"] li').first()
    ).toHaveText('img');

    // Raw JSON + copy: the parsed config only — the page's nonce never reaches it.
    await card.getByRole('button', { name: 'Show raw' }).click();
    const raw = card.locator('[data-fdt-beacon-instructions-raw]');
    await expect(raw).toContainText('"preconnect_external_domain_elements"');
    await expect(raw).not.toContainText('nonce');
    await expect(raw).not.toContainText(config.nonce);
    await extension.browserContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    await card.getByRole('button', { name: 'Beacon instructions' }).click();
    await expect(panel.getByText('Beacon instructions copied', { exact: true })).toBeVisible();
    const copied = await panel.evaluate(() => navigator.clipboard.readText());
    expect(JSON.parse(copied)).toMatchObject({ isMobile: config.is_mobile });
    expect(copied).not.toContain(config.nonce);
    expect(copied).not.toContain('ajax_url');

    // Widths (docked right: tall; docked bottom: short), both palettes, reduced motion.
    const sizes = [
      [320, 800],
      [480, 800],
      [768, 800],
      [1280, 800],
      [768, 320],
      [1280, 320]
    ] as const;
    for (const scheme of ['light', 'dark'] as const) {
      await panel.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      for (const [width, height] of sizes) {
        await panel.setViewportSize({ width, height });
        const overflow = await panel
          .locator('[data-fdt="panel-content"]')
          .evaluate((element) => element.scrollWidth - element.clientWidth);
        expect(overflow, `overflow at ${String(width)}×${String(height)} (${scheme})`).toBe(0);
        if (height === 800 && (width === 320 || width === 1280)) {
          await info.attach(`beacon-instructions-${scheme}-${String(width)}`, {
            body: await card.screenshot(),
            contentType: 'image/png'
          });
        }
      }
      await expect
        .poll(() =>
          panel.evaluate(
            () =>
              document.getAnimations().filter((animation) => animation.playState === 'running')
                .length
          )
        )
        .toBe(0);
    }
    await panel.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });

    // A reload: the card takes the new load (its stamp changes to the tab's new
    // capture id — only the new load produces it), the open view kept.
    const firstLoad = await card.getAttribute('data-fdt-beacon-instructions-load');
    expect(firstLoad).toMatch(/^[\da-f]{32}$/);
    await site.page.reload({ waitUntil: 'load' });
    const reloaded = await extension.sendToTab<{ scriptSnapshotId: string }>(
      site.tabId,
      'getFdtData'
    );
    expect(reloaded.scriptSnapshotId).not.toBe(firstLoad);
    await expect(card).toHaveAttribute(
      'data-fdt-beacon-instructions-load',
      reloaded.scriptSnapshotId
    );
    await expect(card).toHaveAttribute('data-fdt-beacon-instructions', 'instructions');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(raw).toBeVisible();

    // A navigation to a page without the beacon: the earlier instructions read stale.
    await site.page.goto(NO_BEACON_PAGE, { waitUntil: 'load' });
    await expect(card).toHaveAttribute('data-fdt-beacon-instructions', 'stale');
    await expect(card.getByText('No longer on the page')).toBeVisible();
    await card.getByRole('button', { name: 'Dismiss' }).click();
    await expect(card).toHaveAttribute('data-fdt-beacon-instructions', 'none');
    await expect(card).toContainText('No beacon on this page');
  } finally {
    await panel.close();
    await site.page.close();
  }
});
