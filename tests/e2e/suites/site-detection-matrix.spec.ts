/**
 * P11.1 — the detection site matrix over the real docker site.
 *
 * Three WP Rocket settings combinations are written through wp-cli (config
 * regenerated, caches purged), and per-request fixture flags vary what the
 * page carries: the generator meta (versioned / digits-free / suppressed),
 * decoy footprints, the cache signature (an edge layer strips it) and the
 * hosting cache headers (the edge sends them) — comment and headers varied
 * independently. Every round asserts one declared expectation
 * (`helpers/detection-matrix.ts`, the round list) on four surfaces at once:
 * the served detection payload (row presence + evidence source), the on-page
 * strip (chip state, tooltip source, cache chip, identity), the panel's
 * Detections cards + summary facts, and the support report — plus the
 * Headers page whenever the edge sent a host header.
 *
 * The suite runs anonymous (logged-in visitors get no cache and no
 * optimization) and restores what it changed — the stored settings it found
 * (purged after) and the widget override map — so later site suites see the
 * bootstrap baseline.
 */

import type { Page } from '@playwright/test';

import { CACHE_COMMENT_MARKERS, CACHE_TIMESTAMP_PATTERN } from '../../../lib/wp-rocket/constants';
import { expect, test, type ExtensionDriver } from '../helpers/extension';
import { devtoolsShim, panelPageUrl } from '../helpers/panel-data';
import { openSitePage, SITE_ORIGIN, SITE_URL } from '../helpers/site';
import { readWprSettings, writeWprSettings, type WprSettings } from '../helpers/site-wpcli';
import {
  baselineDrift,
  DECOY_SELECTORS,
  LIVE_NONCE_FLAG,
  MATRIX_ROUNDS,
  SETTINGS_COMBOS,
  wantsDecoys,
  type MatrixRound,
  type MatrixRow,
  type RowExpectation
} from '../helpers/detection-matrix';

/** The widget's shadow-root host. */
const STRIP_HOST = 'wpr-fdt-inspector';

/** The WXT storage key under `chrome.storage.sync` for the per-origin widget map. */
const ORIGINS_KEY = 'detection-widget-sites';

/** Settle window for the strip mount + header-resolved cache chip. */
const SETTLE = { timeout: 15_000, intervals: [250, 500] };

/** How each pinned row renders on the three surfaces (the UI's own literals). */
const ROW_UI: Readonly<Record<MatrixRow, { readonly name: string; readonly chip: string }>> = {
  remove_unused_css: { name: 'Remove Unused CSS', chip: 'Remove Unused CSS' },
  async_css: { name: 'Load CSS asynchronously', chip: 'Load CSS asynchronously' },
  delay_js: { name: 'Delay JavaScript execution', chip: 'Delay JS' },
  defer_all_js: { name: 'Load JavaScript deferred', chip: 'Defer JS' },
  minify_css: { name: 'Minify CSS files', chip: 'Minify CSS' },
  minify_js: { name: 'Minify JavaScript files', chip: 'Minify JS' },
  lazyload: { name: 'LazyLoad for images', chip: 'Lazyload Images' },
  lazyload_iframes: { name: 'LazyLoad for iframes/videos', chip: 'Lazyload Iframes' },
  lazyload_css_bg_img: {
    name: 'LazyLoad CSS backgrounds',
    chip: 'Lazyload CSS Background Images'
  },
  image_dimensions: { name: 'Add missing image dimensions', chip: 'Image Dimensions' },
  self_hosted_fonts: { name: 'Self-host Google Fonts', chip: 'Self-host Google Fonts' },
  preload_links: { name: 'Preload Links', chip: 'Preload Links' },
  rocket_cdn: { name: 'RocketCDN', chip: 'RocketCDN' }
};

/**
 * The beacon-measured family rows. `/fdt/` serves the beacon in its
 * collecting phase on every round (location hashes stamped, nothing applied
 * yet), so a tag-absent page must leave each row absent with no source — the
 * beacon script alone never activates a feature.
 */
const FAMILY_ROWS = [
  'rocket_above_the_fold_optimization',
  'automatic_lazy_rendering',
  'auto_preload_fonts',
  'preconnect_external_domains'
] as const;

/** The source chip's tooltip / the report cell, per evidence class. */
const SOURCE_TEXT = {
  Meta: {
    tooltip: "Decided by WP Rocket's generator meta tag on this page.",
    report: 'Generator meta'
  },
  Footprint: { tooltip: 'Decided by markup WP Rocket left on this page.', report: 'Page footprint' }
} as const;

/** One expectation split into status word + source (null = no source chip). */
interface ParsedExpectation {
  readonly status: 'Active' | 'Not active' | 'Unknown';
  readonly source: 'Meta' | 'Footprint' | null;
}

/**
 * Split `Active (Meta)`-style expectations.
 *
 * @param expectation The round-list literal.
 */
function parse(expectation: RowExpectation): ParsedExpectation {
  const match = /^(Active|Not active|Unknown)(?: \((Meta|Footprint)\))?$/.exec(expectation);
  if (match === null) throw new Error(`unparseable row expectation: ${expectation}`);
  return {
    status: match[1] as ParsedExpectation['status'],
    source: (match[2] ?? null) as ParsedExpectation['source']
  };
}

/** The strip chip class a status reads as (D-2: unsure states are amber). */
const CHIP_CLASS: Readonly<Record<ParsedExpectation['status'], string>> = {
  Active: 'ins-chip-ok',
  'Not active': 'ins-chip-neutral',
  Unknown: 'ins-chip-attention'
};

/**
 * The merged "Optimize CSS delivery" card's expectation: Remove Unused CSS
 * stands in when applied, else Load CSS asynchronously; neither applied reads
 * Not active, decided by the meta only when the meta refuted both.
 *
 * @param round The round.
 * @returns The card's name and expectation.
 */
function cssDeliveryCard(round: MatrixRound): { name: string; expected: ParsedExpectation } {
  const rucss = parse(round.rows.remove_unused_css);
  const async = parse(round.rows.async_css);
  if (rucss.status === 'Active') return { name: ROW_UI.remove_unused_css.name, expected: rucss };
  if (async.status === 'Active') return { name: ROW_UI.async_css.name, expected: async };
  return {
    name: 'Optimize CSS delivery',
    expected: {
      status: 'Not active',
      source: rucss.source === 'Meta' && async.source === 'Meta' ? 'Meta' : null
    }
  };
}

/** The served detection rows the assertions read (the engine's shape, narrowed). */
type ServedRows = Record<string, { present: boolean; source?: 'meta' | 'footprint' }> & {
  wpr: { present: boolean; cached: boolean; version: string | null };
};

/**
 * Fetch one site URL as an anonymous probe.
 *
 * @param url The absolute URL.
 * @returns The response headers and body.
 * @throws {Error} When the site does not answer 200.
 */
async function probe(url: string): Promise<{ headers: Headers; body: string }> {
  const response = await fetch(url, { headers: { 'User-Agent': 'fdt-matrix-probe' } });
  const body = await response.text();
  if (response.status !== 200) throw new Error(`${url} answered ${String(response.status)}`);
  return { headers: response.headers, body };
}

/**
 * Prove a never-stored URL really is never stored: a repeat request must
 * still answer a live render. WP Rocket attaches its stored file's
 * `Last-Modified` whenever it writes or serves a copy, and a served copy's
 * footer carries the `cached@` stamp, so neither may appear.
 *
 * @param url The absolute URL (requested twice here).
 * @throws {Error} Naming the URL and the stored-copy evidence found.
 */
async function assertNeverStored(url: string): Promise<void> {
  for (const attempt of ['first', 'repeat'] as const) {
    const { headers, body } = await probe(url);
    const stamped =
      CACHE_COMMENT_MARKERS.some((marker) => body.includes(marker)) &&
      CACHE_TIMESTAMP_PATTERN.test(body);
    if (headers.has('last-modified') || stamped) {
      throw new Error(
        `${url} (${attempt} request) answered a stored WP Rocket copy (last-modified: ${headers.get('last-modified') ?? 'none'}, stamped footer: ${String(stamped)}) — is fdt-no-store a cached query string (docker/scripts/up.sh)?`
      );
    }
  }
}

/** Everything the strip renders that a round reads. */
interface StripRead {
  readonly title: string | null;
  readonly cacheText: string | null;
  readonly cacheTooltip: string | null;
  readonly text: string;
  readonly rows: ReadonlyArray<{ chip: string; className: string; tooltip: string }>;
}

/**
 * Read the open strip card's shadow tree.
 *
 * @param page The site page.
 */
async function readStripCard(page: Page): Promise<StripRead> {
  return await page.evaluate((host: string): StripRead => {
    const root = document.querySelector(host)?.shadowRoot ?? null;
    const head = root?.querySelector('.ins-card-head .ins-cache') ?? null;
    return {
      title: root?.querySelector('.ins-title')?.textContent ?? null,
      cacheText: head?.textContent ?? null,
      cacheTooltip: head?.getAttribute('title') ?? null,
      text: root?.querySelector('.ins-card')?.textContent ?? '',
      rows: [...(root?.querySelectorAll('.ins-row') ?? [])].map((row) => ({
        chip: row.querySelector('.ins-chip')?.textContent ?? '',
        className: row.querySelector('.ins-chip')?.className ?? '',
        tooltip: row.getAttribute('title') ?? ''
      }))
    };
  }, STRIP_HOST);
}

/**
 * Read the per-origin widget map as stored (undefined when absent).
 *
 * @param driver The extension driver.
 */
async function readStripOverrides(driver: ExtensionDriver): Promise<unknown> {
  return await driver.evaluateInWorker(
    async (key: string) => (await chrome.storage.sync.get(key))[key],
    ORIGINS_KEY
  );
}

/**
 * Write the per-origin widget map whole, or remove it (undefined).
 *
 * @param driver The extension driver.
 * @param value The map to store.
 */
async function writeStripOverrides(driver: ExtensionDriver, value: unknown): Promise<void> {
  await driver.evaluateInWorker(
    async (payload: { key: string; value: unknown }) => {
      if (payload.value === undefined) await chrome.storage.sync.remove(payload.key);
      else await chrome.storage.sync.set({ [payload.key]: payload.value });
    },
    { key: ORIGINS_KEY, value }
  );
}

/**
 * The round's URL: warmed so the browser receives the stored cached copy,
 * made unique so it receives the live render, or proven never stored.
 *
 * @param round The round.
 * @returns The absolute URL to open.
 * @throws {Error} When a probe does not answer 200, or a never-stored URL was stored.
 */
async function prepareUrl(round: MatrixRound): Promise<string> {
  const base = `${SITE_URL}${round.path}`;
  if (round.visit === 'live') {
    // A unique nonce-flag value is a fresh cache key with the same page.
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}${LIVE_NONCE_FLAG}=matrix-${String(Date.now())}`;
  }
  if (round.visit === 'uncached') await assertNeverStored(base);
  else await probe(base);
  return base;
}

/**
 * Read one panel card by id: its badge word and source chip.
 *
 * @param panel The panel page.
 * @param id The card id.
 */
async function readCard(
  panel: Page,
  id: string
): Promise<{ name: string; status: string; source: string | null } | null> {
  return await panel.evaluate((cardId: string) => {
    const card = document.querySelector(`[data-fdt="status-card"][data-fdt-card-id="${cardId}"]`);
    if (card === null) return null;
    const source = card.querySelector('[data-fdt-card-source]');
    // The chip's visible word is its first text node (sr-only spans carry the rest).
    const chipWord =
      source === null
        ? null
        : [...source.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent ?? '')
            .join('')
            .trim();
    return {
      name: card.querySelector('[data-fdt-card-name]')?.textContent ?? '',
      status: card.querySelector('[data-fdt="status-badge"]')?.textContent ?? '',
      source: chipWord
    };
  }, id);
}

/**
 * Assert the served payload against the round: meta shape and every row.
 *
 * @param served The tab's detections.
 * @param round The round.
 */
function assertPayload(served: ServedRows, round: MatrixRound): void {
  expect(served.wpr.present, `${round.id}: WP Rocket handled the page`).toBe(true);
  if (round.meta === 'versioned') {
    expect(served.wpr.version, `${round.id}: the meta's version`).toMatch(/^\d+(?:\.\d+)+/);
  } else {
    expect(served.wpr.version, `${round.id}: no version without digits`).toBeNull();
  }
  for (const [row, expectation] of Object.entries(round.rows) as [MatrixRow, RowExpectation][]) {
    const expected = parse(expectation);
    const entry = served[row];
    expect(entry, `${round.id}: row ${row} served`).toBeDefined();
    expect(
      { present: entry?.present, source: entry?.source ?? null },
      `${round.id}: ${row} payload`
    ).toEqual({
      present: expected.status === 'Active',
      source: expected.source === null ? null : expected.source.toLowerCase()
    });
  }
  // The family: the meta refutes each row whenever it is issued (nothing here
  // declares their tokens); without it, the collecting beacon is served but
  // no applied marker is, so each row stays absent with no source.
  expect(served.priority_elements_beacon?.present, `${round.id}: the beacon is served`).toBe(true);
  for (const row of FAMILY_ROWS) {
    const entry = served[row];
    expect(entry, `${round.id}: row ${row} served`).toBeDefined();
    expect(
      { present: entry?.present, source: entry?.source ?? null },
      `${round.id}: ${row} ${round.meta === 'absent' ? 'absent without meta' : 'refuted'}`
    ).toEqual({ present: false, source: round.meta === 'absent' ? null : 'meta' });
  }
}

/**
 * Assert the open strip card against the round.
 *
 * @param strip The strip read.
 * @param served The payload (for the identity's version).
 * @param round The round.
 */
function assertStrip(strip: StripRead, served: ServedRows, round: MatrixRound): void {
  expect(strip.title, `${round.id}: strip identity`).toBe(
    served.wpr.version === null ? 'WPR (unknown version)' : `WPR ${served.wpr.version}`
  );
  expect(strip.cacheText ?? '', `${round.id}: strip cache chip`).toMatch(
    new RegExp(`^${round.cache.chip.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( · |$)`)
  );
  for (const [row, expectation] of Object.entries(round.rows) as [MatrixRow, RowExpectation][]) {
    const expected = parse(expectation);
    const rendered = strip.rows.find((entry) => entry.chip === ROW_UI[row].chip);
    expect(rendered, `${round.id}: strip row ${row}`).toBeDefined();
    expect(rendered?.className, `${round.id}: strip chip state of ${row}`).toContain(
      CHIP_CLASS[expected.status]
    );
    for (const source of ['Meta', 'Footprint'] as const) {
      expect(
        rendered?.tooltip.includes(SOURCE_TEXT[source].tooltip),
        `${round.id}: strip tooltip of ${row} names ${source}`
      ).toBe(expected.source === source);
    }
  }
}

/**
 * Assert the panel's Detections cards + summary facts against the round.
 *
 * @param panel The panel page (on `#/detections`).
 * @param round The round.
 */
async function assertCards(panel: Page, round: MatrixRound): Promise<void> {
  for (const [row, expectation] of Object.entries(round.rows) as [MatrixRow, RowExpectation][]) {
    // The CSS-delivery pair renders as one merged card (asserted below).
    if (row === 'remove_unused_css' || row === 'async_css') continue;
    const expected = parse(expectation);
    expect(await readCard(panel, row), `${round.id}: card ${row}`).toEqual({
      name: ROW_UI[row].name,
      status: expected.status,
      source: expected.source
    });
  }
  const css = cssDeliveryCard(round);
  expect(await readCard(panel, 'remove_unused_css'), `${round.id}: CSS delivery card`).toEqual({
    name: css.name,
    status: css.expected.status,
    source: css.expected.source
  });

  // Summary facts: the stamped form shows the stamp fact, every other state
  // its chip; the layer fact only when the round names a layer.
  const cacheFact = (await panel.locator('[data-fdt-summary-fact="cache"]').textContent()) ?? '';
  if (round.cache.chip === '✓ Cached') {
    expect(cacheFact, `${round.id}: summary cache fact`).toMatch(/^Cache generated /);
  } else expect(cacheFact.trim(), `${round.id}: summary cache fact`).toBe(round.cache.chip);
  const layerFact = panel.locator('[data-fdt-summary-fact="cache-layer"]');
  if (round.cache.layer === null) await expect(layerFact).toHaveCount(0);
  else await expect(layerFact).toHaveText(`${round.cache.layer} cache-layer marker captured`);

  // The status bar's cache segment reads the same vocabulary (the cached
  // form is its age chip, every other state its copy chip as a link).
  const statusBar = panel.locator('[data-fdt="panel-status-bar"]');
  if (round.cache.chip === '✓ Cached') await expect(statusBar).toContainText('Cached');
  else await expect(statusBar.getByRole('link', { name: round.cache.chip })).toBeVisible();
}

/**
 * Copy the support report and assert its cache lines and pinned rows.
 *
 * @param panel The panel page (on `#/detections`).
 * @param round The round.
 * @returns The report text.
 */
async function assertReport(panel: Page, round: MatrixRound): Promise<string> {
  await panel.getByRole('button', { name: 'Copy report', exact: true }).click();
  await expect(panel.getByText('Report copied')).toBeVisible();
  const report = await panel.evaluate(() => navigator.clipboard.readText());
  const lines = report.split('\n');
  const cacheLine = lines.find((line) => line.startsWith('- **Page cache:** '));
  expect(cacheLine, `${round.id}: report cache line`).toBeDefined();
  expect((cacheLine ?? '').slice('- **Page cache:** '.length)).toMatch(
    new RegExp(`^${round.cache.report.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
  );
  const layerLine = lines.find((line) => line.startsWith('- **Hosting cache layer:** '));
  if (round.cache.layer === null) expect(layerLine, `${round.id}: no layer line`).toBeUndefined();
  else
    expect(layerLine).toMatch(
      new RegExp(`^- \\*\\*Hosting cache layer:\\*\\* ${round.cache.layer} `)
    );

  const expectRow = (name: string, expected: ParsedExpectation): void => {
    const source = expected.source === null ? '—' : SOURCE_TEXT[expected.source].report;
    expect(
      lines.some((line) => line.startsWith(`| ${name} | ${expected.status} | ${source} |`)),
      `${round.id}: report row "${name}" reads ${expected.status} / ${source}`
    ).toBe(true);
  };
  for (const [row, expectation] of Object.entries(round.rows) as [MatrixRow, RowExpectation][]) {
    if (row === 'remove_unused_css' || row === 'async_css') continue;
    expectRow(ROW_UI[row].name, parse(expectation));
  }
  const css = cssDeliveryCard(round);
  expectRow(css.name, css.expected);
  return report;
}

/**
 * Assert the edge's host header on the Headers page, exactly as sent.
 *
 * @param panel The panel page.
 * @param header The header pair.
 */
async function assertHeaderListed(
  panel: Page,
  header: readonly [name: string, value: string]
): Promise<void> {
  await panel.evaluate(() => {
    location.hash = '#/headers-cookies';
  });
  await expect(panel.locator('[data-fdt-page="headers-cookies"]')).toBeVisible();
  const rows = await panel.evaluate(() =>
    [...document.querySelectorAll('[data-fdt-inventory-row="header"]')].map((row) => ({
      term: row.querySelector('[data-fdt-key-value-term]')?.textContent ?? null,
      value: row.querySelector('[data-fdt-key-value-value]')?.textContent ?? null
    }))
  );
  // The value cell leads with the raw value; a known header's verdict hint
  // follows it inside the same cell.
  expect(
    rows.some((row) => row.term === header[0] && row.value?.startsWith(header[1]) === true),
    `the sent host header ${header[0]}: ${header[1]} is listed (got ${JSON.stringify(rows.slice(0, 4))})`
  ).toBe(true);
}

/**
 * Run one round end to end: open the page, read the payload, the strip, the
 * panel and the report, then close everything.
 *
 * @param extension The extension driver.
 * @param round The round.
 */
async function runRound(extension: ExtensionDriver, round: MatrixRound): Promise<void> {
  const url = await prepareUrl(round);
  const site = await openSitePage(extension, url);
  const panel = await extension.browserContext.newPage();
  try {
    // The decoys are in the served DOM exactly when the round asks for them
    // (a decoy round passing on a decoy-free page would prove nothing).
    const decoyCounts = await site.page.evaluate(
      (selectors: readonly string[]) =>
        selectors.map((selector) => document.querySelectorAll(selector).length),
      DECOY_SELECTORS
    );
    expect(decoyCounts, `${round.id}: decoy elements served`).toEqual(
      DECOY_SELECTORS.map(() => (wantsDecoys(round) ? 1 : 0))
    );

    const served = await extension.sendToTab<ServedRows | null>(site.tabId, 'getWprDetections');
    if (served === null) throw new Error(`${round.id}: the tab answered no detections`);
    assertPayload(served, round);

    // Strip: wait for the header-resolved cache chip, open the card.
    await expect
      .poll(
        async () =>
          await site.page.evaluate(
            (host: string) =>
              document.querySelector(host)?.shadowRoot?.querySelector('.ins-pill .ins-cache-text')
                ?.textContent ?? null,
            STRIP_HOST
          ),
        SETTLE
      )
      .toBe(round.cache.chip);
    await site.page.locator(`${STRIP_HOST} .ins-pill`).click();
    await expect(site.page.locator(`${STRIP_HOST} .ins-card`)).toBeVisible();
    const strip = await readStripCard(site.page);
    assertStrip(strip, served, round);

    // Panel over the same tab (the report's URL line answers this page).
    await panel.addInitScript(devtoolsShim(site.tabId, { origin: url, resources: [] }));
    await panel.goto(`${await panelPageUrl(extension)}#/detections`, { waitUntil: 'load' });
    await expect(
      panel.locator('[data-fdt-page="detections"]').getByRole('heading', { level: 1 })
    ).toHaveText('Detections');
    await assertCards(panel, round);
    const report = await assertReport(panel, round);

    if (round.cache.header !== undefined) await assertHeaderListed(panel, round.cache.header);
    if (round.cache.header?.[0] === 'x-proxy-cache') {
      // The generic proxy header is its own layer: no surface may call it SiteGround.
      const panelText = await panel.evaluate(() => document.body.textContent);
      for (const [surface, text] of [
        ['strip', `${strip.text} ${strip.cacheTooltip ?? ''}`],
        ['panel', panelText],
        ['report', report]
      ] as const) {
        expect(text.includes('SiteGround'), `${round.id}: ${surface} never says SiteGround`).toBe(
          false
        );
      }
    }
  } finally {
    await panel.close();
    await site.page.close();
  }
}

/** The settings found before the suite wrote any (restored in `afterAll`). */
let found: WprSettings | null = null;

/**
 * The widget override map found before the suite wrote it (restored in
 * `afterAll`), or null when it was never read — `undefined` is a real reading
 * (no map stored), so restoring an unread value would delete the stored map.
 */
let foundOverrides: { readonly value: unknown } | null = null;

test.describe('detection site matrix (P11.1)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ extension }) => {
    const settings = await readWprSettings();
    const drift = baselineDrift(settings);
    if (drift.length > 0) {
      throw new Error(
        `wp_rocket_settings is not the bootstrap baseline (${drift.join('; ')}) — a killed run left its combination, or the stack predates this bootstrap: run docker/scripts/up.sh to re-apply it`
      );
    }
    found = settings;
    foundOverrides = { value: await readStripOverrides(extension) };
    // Anonymous visitor: a site login from an earlier suite disables caching
    // (site-scoped, like the sibling suites; the admin suites log in themselves).
    await extension.browserContext.clearCookies({ domain: new URL(SITE_URL).hostname });
    await extension.browserContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    await writeStripOverrides(extension, { [SITE_ORIGIN]: { enabled: true } });
  });

  test.afterAll(async ({ extension }) => {
    // Each restore runs whatever an earlier one threw; every failure surfaces.
    const failures: unknown[] = [];
    const attempt = async (step: () => Promise<void>): Promise<void> => {
      try {
        await step();
      } catch (error) {
        failures.push(error);
      }
    };
    const snapshot = found;
    if (snapshot !== null) {
      await attempt(async () => {
        await writeWprSettings(snapshot);
        // Re-store the hub page the restore purged: a browser whose first
        // visit gets the live render keeps that unstamped body, because the
        // stored copy then answers its revalidation (`If-Modified-Since`)
        // with 304 — later suites' cached-truth legs would read it.
        await probe(`${SITE_URL}/fdt/`);
      });
    }
    const overrides = foundOverrides;
    if (overrides !== null) {
      await attempt(async () => {
        await writeStripOverrides(extension, overrides.value);
      });
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'detection matrix restore failed');
    }
  });

  for (const combo of SETTINGS_COMBOS) {
    test(`combination "${combo.id}": ${combo.why}`, async ({ extension }) => {
      test.setTimeout(180_000);
      if (found === null) throw new Error('the settings snapshot is missing');
      await writeWprSettings({ ...found, ...combo.overrides });
      for (const round of MATRIX_ROUNDS.filter((entry) => entry.combo === combo.id)) {
        await test.step(`${round.id}: ${round.proves}`, async () => {
          await runRound(extension, round);
        });
      }
    });
  }
});
