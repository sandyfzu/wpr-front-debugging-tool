/**
 * The Headers & Cookies page's name filter over a real capture — the field
 * narrows by header and cookie names only (a value-naming query never
 * matches), section badges restate the matching counts, the shared count
 * line announces the commit and stays quiet on refresh, Esc and the
 * filtered-empty way back restore the full list with focus kept on the
 * field, and every verdict hint presents its evidence tone on the shared
 * status vocabulary. The changed states' a11y floor: strict axe at the
 * narrow width in both palettes.
 *
 * Shared-profile contract: the tier's worker-scoped browser shares one
 * profile — cookies persist per origin across suites — so each test clears
 * the context's cookies before opening its fixture: the exact counts pinned
 * below are deterministic regardless of which suites ran before.
 *
 * Strict-empty axe is safe here: the audited states are query-bounded
 * (2–3 rows, nothing to clip at 320×800) — the virtual-list clip allowance
 * lives in panel-layout.
 */
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

/** Debugger injection keeps the accessibility engine outside extension CSP. */
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8'
);

/** The axe run's fail slice (violations + incompletes are both asserted). */
interface AxeResults {
  readonly violations: readonly { readonly id: string }[];
  readonly incomplete: readonly { readonly id: string }[];
}

/** Double-RAF settle: the render's paint inputs land before an audit. */
async function settlePaint(page: Page): Promise<void> {
  await page.evaluate((): Promise<void> => {
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  });
}

/** Run the injected axe over the whole document. */
async function runAxe(page: Page): Promise<AxeResults> {
  await settlePaint(page);
  await page.evaluate(AXE_SOURCE);
  return await page.evaluate(async (): Promise<AxeResults> => {
    const axe = (window as { axe?: { run(): Promise<AxeResults> } }).axe;
    if (axe === undefined) throw new Error('the axe engine did not install into the page');
    const result = await axe.run();
    return { violations: result.violations, incomplete: result.incomplete };
  });
}

test('the name filter narrows a real capture by names only, with recovery and toned hints', async ({
  extension
}) => {
  // The exact count pins below need a clean slate (see the header note).
  await extension.browserContext.clearCookies();
  const { panel, fixture } = await openPanelForFixture(extension, '/__e2e/header-filter', {
    bootHash: '#/headers-cookies'
  });
  try {
    const root = panel.locator('[data-fdt-page="headers-cookies"]');
    const field = root.getByRole('searchbox', { name: 'Search header and cookie names' });
    const status = root.locator('[data-fdt="headers-results-status"]');
    const list = root.getByRole('list', { name: 'Response headers and cookies' });

    // The unfiltered capture: 10 headers (the fixture's six — content-type
    // included; it files under Other headers — plus the server's own
    // Date/Connection/Keep-Alive/Transfer-Encoding) + 3 page-readable
    // cookie names. `via` is a caching-class row.
    await expect(root.getByRole('heading', { name: 'Caching evidence 4 headers' })).toBeVisible();
    await expect(root.getByRole('heading', { name: 'Other headers 6 headers' })).toBeVisible();
    await expect(root.getByRole('heading', { name: 'Cookies 3 cookies' })).toBeVisible();
    await expect(status).toHaveText('Showing all 13 entries');

    // The searched fields are the NAMES: a query matching a header's or a
    // cookie's VALUE (its hint text included) can never match a row.
    await field.fill('edge-01');
    await expect(status).toHaveText(/No entries match/);
    await expect(root.getByText('No matches')).toBeVisible();

    // Back out of the filtered-empty state the one-click way: the field is
    // cleared, the full list restored, focus stays on the field.
    await root.getByRole('button', { name: 'Clear search' }).click();
    await expect(field).toHaveValue('');
    await expect(status).toHaveText('Showing all 13 entries');
    await expect(field).toBeFocused();

    // Header names narrow across sections; sections without matches drop
    // and the surviving badge restates its matching count.
    await field.fill('cache');
    await expect(root.getByRole('heading', { name: 'Caching evidence 2 headers' })).toBeVisible();
    await expect(root.getByRole('heading', { name: 'Cookies 3 cookies' })).toHaveCount(0);
    await expect(status).toHaveText('Showing 2 of 13 entries');
    await expect(list.getByRole('listitem')).toHaveCount(3); // heading + 2 rows

    // Cookie names narrow the same way.
    await field.fill('filter');
    await expect(root.getByRole('heading', { name: 'Cookies 2 cookies' })).toBeVisible();
    await expect(status).toHaveText('Showing 2 of 13 entries');

    // Esc in the field is the binding's rule: field and list restore.
    await field.press('Escape');
    await expect(field).toHaveValue('');
    await expect(status).toHaveText('Showing all 13 entries');

    // The verdict hints ride the shared status vocabulary on the real DOM:
    // the row's hint line's icon carries the verdict's tone class.
    const toneOf = (name: string): Promise<string | null> =>
      root
        .getByRole('button', { name })
        .locator('xpath=ancestor::*[@role="listitem"]')
        .locator('svg[class*="text-status-"]')
        .first()
        .getAttribute('class');
    expect(await toneOf('x-cache header — copy')).toContain('text-status-ok');
    expect(await toneOf('cache-control header — copy')).toContain('text-status-warn');
    expect(await toneOf('via header — copy')).toContain('text-status-info');
    expect(await toneOf('age header — copy')).toContain('text-status-ok');
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('the filtered and filtered-empty states pass strict axe at the narrow width, both palettes', async ({
  extension
}) => {
  // The exact count pins below need a clean slate (see the header note).
  await extension.browserContext.clearCookies();
  const { panel, fixture } = await openPanelForFixture(extension, '/__e2e/header-filter', {
    bootHash: '#/headers-cookies'
  });
  try {
    await panel.setViewportSize({ width: 320, height: 800 });
    const root = panel.locator('[data-fdt-page="headers-cookies"]');
    const field = root.getByRole('searchbox', { name: 'Search header and cookie names' });
    for (const theme of ['light', 'dark'] as const) {
      await panel.emulateMedia({ colorScheme: theme });
      // The narrowed list.
      await field.fill('cache');
      await expect(root.getByRole('heading', { name: 'Caching evidence 2 headers' })).toBeVisible();
      const filtered = await runAxe(panel);
      expect(filtered).toEqual({ violations: [], incomplete: [] });
      // The filtered-empty state.
      await field.fill('zzz-nothing');
      await expect(root.getByText('No matches')).toBeVisible();
      const empty = await runAxe(panel);
      expect(empty).toEqual({ violations: [], incomplete: [] });
      await field.press('Escape');
      await expect(field).toHaveValue('');
    }
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
