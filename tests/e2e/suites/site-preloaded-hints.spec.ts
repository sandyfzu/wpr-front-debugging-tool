/**
 * The Preloaded Resources page (the resource-hint inventory) over the docker
 * site's real output. Ground truth is the live page's own `<link>` hints,
 * read beside the panel: every hint is listed, WordPress core's module
 * preload reads "Unattributed" (never claimed), and WP Rocket's count is the
 * page's stamped hints. A second arm stores a DNS prefetch domain (WP Rocket
 * then declares the feature and core prints a plain hint for it): the hint
 * still reads unattributed, the page notes the proof limit, and the payload
 * declares DNS prefetch (meta) while Preconnect stays refuted. The suite
 * restores the settings it found (purged after, the hub page re-stored).
 */
import type { Locator, Page } from '@playwright/test';

import { DNS_PREFETCH_LIMIT } from '../../../lib/detection/hud';
import { expect, test, type ExtensionDriver } from '../helpers/extension';
import { facetCount } from '../helpers/javascript-page';
import { devtoolsShim, panelPageUrl } from '../helpers/panel-data';
import { openSitePage, SITE_URL } from '../helpers/site';
import { readWprSettings, writeWprSettings, type WprSettings } from '../helpers/site-wpcli';

/** The default scenario, never cached (each load is WP Rocket's fresh output). */
const PAGE = `${SITE_URL}/fdt/?fdt-no-store=1`;

/** The DNS prefetch arm's stored domain (a reserved-for-tests host, never resolved). */
const DNS_HOST = 'fdt-dns.example';

/** The live page's hints, as the inventory reads them. */
interface HintTruth {
  /** Hint rows: one per listed kind per link outside `<noscript>`. */
  readonly total: number;
  /** Rows carrying a WP Rocket stamp on its emitter's kind. */
  readonly stamped: number;
  readonly modulepreload: number;
  readonly dnsPrefetch: number;
}

/**
 * Read the live page's hints (an independent reading of the same rules).
 *
 * @param page The site page.
 */
async function hintTruth(page: Page): Promise<HintTruth> {
  return await page.evaluate(() => {
    const kinds = ['preload', 'modulepreload', 'preconnect', 'dns-prefetch'];
    const stamps: Record<string, (link: Element) => boolean> = {
      preload: (link) =>
        link.hasAttribute('data-rocket-preload') ||
        link.getAttribute('data-rocket-async') === 'style',
      preconnect: (link) => link.hasAttribute('data-rocket-preconnect'),
      'dns-prefetch': (link) => link.hasAttribute('data-rocket-prefetch')
    };
    const truth = { total: 0, stamped: 0, modulepreload: 0, dnsPrefetch: 0 };
    for (const link of document.querySelectorAll('link')) {
      if (link.closest('noscript') !== null) continue;
      // Kinds come from the real `rel` tokens only (the marker adds none).
      const rels = new Set([...link.relList].map((token) => token.toLowerCase()));
      for (const kind of kinds.filter((entry) => rels.has(entry))) {
        truth.total += 1;
        if (stamps[kind]?.(link) === true) truth.stamped += 1;
        if (kind === 'modulepreload') truth.modulepreload += 1;
        if (kind === 'dns-prefetch') truth.dnsPrefetch += 1;
      }
    }
    return truth;
  });
}

/**
 * Open the panel on the Preloaded Resources page for a site tab.
 *
 * @param extension The driver.
 * @param tabId The inspected tab.
 */
async function openHintsPage(extension: ExtensionDriver, tabId: number): Promise<Page> {
  const panel = await extension.browserContext.newPage();
  await panel.setViewportSize({ width: 1280, height: 2400 });
  await panel.addInitScript(devtoolsShim(tabId));
  await panel.goto(`${await panelPageUrl(extension)}#/preloaded-resources`, { waitUntil: 'load' });
  await expect(panel.getByRole('heading', { level: 1, name: 'Preloaded Resources' })).toBeVisible();
  return panel;
}

/**
 * A facet value's count on the page (`any` is the Source facet's).
 *
 * @param panel The panel page.
 * @param value The value id.
 */
function hintCount(panel: Page, value: string): Locator {
  const root = panel.locator('[data-fdt-page="preloaded-resources"]');
  return facetCount(root, value, value === 'any' ? 'Source' : undefined);
}

/**
 * The hint rows whose preview starts with a kind.
 *
 * @param panel The panel page.
 * @param rel The `rel` kind.
 */
function rowsOfKind(panel: Page, rel: string): Locator {
  return panel.locator('[data-fdt="hint-row"]').filter({
    has: panel.locator('[data-fdt="list-row-preview"]', { hasText: new RegExp(`^${rel} · `) })
  });
}

/** The settings found before the suite (restored after). */
let found: WprSettings | null = null;

test.describe('Preloaded Resources over the docker site', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ extension }) => {
    // Anonymous visitor: a site login from an earlier suite disables the optimizations.
    await extension.browserContext.clearCookies({ domain: new URL(SITE_URL).hostname });
    found = await readWprSettings();
  });

  test.afterAll(async () => {
    const snapshot = found;
    if (snapshot === null) return;
    await writeWprSettings(snapshot);
    // Re-store the hub page the restore purged (later suites' cached legs read it).
    const response = await fetch(`${SITE_URL}/fdt/`, {
      headers: { 'User-Agent': 'fdt-hints-probe' }
    });
    await response.text();
    if (response.status !== 200) throw new Error(`/fdt/ answered ${String(response.status)}`);
  });

  test('lists every hint; core’s module preload reads unattributed', async ({ extension }) => {
    const site = await openSitePage(extension, PAGE);
    const panel = await openHintsPage(extension, site.tabId);
    try {
      const truth = await hintTruth(site.page);
      expect(truth.modulepreload, 'WordPress core prints its module preload').toBeGreaterThan(0);
      await expect(hintCount(panel, 'any')).toHaveText(String(truth.total));
      await expect(hintCount(panel, 'wp-rocket')).toHaveText(String(truth.stamped));
      await expect(hintCount(panel, 'modulepreload')).toHaveText(String(truth.modulepreload));
      const moduleRow = rowsOfKind(panel, 'modulepreload').first();
      await expect(moduleRow.locator('[data-fdt="hint-attribution"]')).toHaveText('Unattributed');
      await expect(moduleRow.locator('[data-fdt="hint-attribution-mark"]')).toHaveCount(0);
      // No DNS prefetch is stored: no proof-limit note.
      await expect(panel.locator('[data-fdt="resource-note"]')).toHaveCount(0);
    } finally {
      await panel.close();
      await site.page.close();
    }
  });

  test('a declared DNS prefetch: the core hint reads unattributed, the limit is noted', async ({
    extension
  }) => {
    test.setTimeout(120_000);
    if (found === null) throw new Error('the settings snapshot is missing');
    await writeWprSettings({ ...found, dns_prefetch: [`//${DNS_HOST}`] });
    const site = await openSitePage(extension, PAGE);
    const panel = await openHintsPage(extension, site.tabId);
    try {
      const truth = await hintTruth(site.page);
      expect(truth.dnsPrefetch, 'core prints the stored domain as a hint').toBeGreaterThan(0);
      await expect(hintCount(panel, 'any')).toHaveText(String(truth.total));
      await expect(hintCount(panel, 'dns-prefetch')).toHaveText(String(truth.dnsPrefetch));
      const dnsRow = panel.locator('[data-fdt="hint-row"]').filter({ hasText: DNS_HOST });
      await expect(dnsRow).toHaveCount(1);
      await expect(dnsRow.locator('[data-fdt="list-row-preview"]')).toHaveText(/^dns-prefetch · /);
      await expect(dnsRow.locator('[data-fdt="hint-attribution"]')).toHaveText('Unattributed');
      await expect(panel.locator('[data-fdt="resource-note"]')).toHaveText([DNS_PREFETCH_LIMIT]);
      // The declaration decides DNS prefetch, never Preconnect (refuted by the same meta).
      const served = await extension.sendToTab<{
        dns_prefetch: { present: boolean; domains: string[]; source?: string };
        preconnect_external_domains: { present: boolean; source?: string };
      } | null>(site.tabId, 'getWprDetections');
      expect(served?.dns_prefetch).toMatchObject({ present: true, source: 'meta' });
      expect(served?.dns_prefetch.domains).toContain(`http://${DNS_HOST}/`);
      expect(served?.preconnect_external_domains).toMatchObject({ present: false, source: 'meta' });
    } finally {
      await panel.close();
      await site.page.close();
    }
  });
});
