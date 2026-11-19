/**
 * The JavaScript detail's source-link tile in the real browser: Open in
 * Sources through `devtools.panels.openResource` (a recording stand-in —
 * standalone panel pages have no real DevTools, so the native open stays a
 * manual check), its failure toast, the new-tab fallback without the
 * capability, the companion new-tab link, and the detail's code blocks
 * really token-colored (the on-demand HTML and JavaScript grammars load).
 *
 * The fixture is generated per run on the fixture origin, so its script URLs
 * are absolute (a relative URL renders as plain text, not a tile) and point
 * at a real fixture file the opened tab can load.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, ORIGIN_A, test } from '../helpers/extension';
import { openScriptDetail, scriptRowNamed } from '../helpers/javascript-page';
import { openPanelForFixture, openResourceCalls, type InspectedPanel } from '../helpers/panel-data';

/** The fixture path (served by the route below, never a committed file). */
const FIXTURE_PATH = '/javascript/source-link.html';

/** The external script's URL: absolute, with a query and a fragment. */
const SCRIPT_URL = `${ORIGIN_A}/exclusion/lib/deferred-one.js?ver=2#source-map`;

/** What DevTools gets: resources carry no fragment, so the opener drops it. */
const SOURCES_TARGET = `${ORIGIN_A}/exclusion/lib/deferred-one.js?ver=2`;

/** The fixture host as the tile names it (host + port). */
const HOST = new URL(ORIGIN_A).host;

/**
 * The fixture page: one delayed external script (never fetched by the page)
 * and one delayed inline script, so both detail kinds have a served tag.
 *
 * @returns The document.
 */
function sourceLinkPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Source link</title></head>
    <body><h1>Source link</h1>
    <script type="rocketlazyloadscript" data-rocket-src="${SCRIPT_URL}" id="fragment-script"></script>
    <script type="rocketlazyloadscript">const answer = 42;
function greet(name) { return 'Hello, ' + name + '!'; }</script>
    </body></html>`;
}

/**
 * Open the JavaScript page on the fixture (reduced motion: toasts and the
 * pane settle at once) with the given `openResource` stub.
 *
 * @param extension The extension driver.
 * @param openResource The stub's answer; omitted = no capability.
 * @returns The panel and fixture pages.
 */
async function openSourceLinkPanel(
  extension: Parameters<typeof openPanelForFixture>[0],
  openResource?: 'ok' | 'fail'
): Promise<InspectedPanel> {
  return await openPanelForFixture(extension, FIXTURE_PATH, {
    bootHash: '#/javascript',
    emulation: { colorScheme: 'dark', reducedMotion: 'reduce' },
    openResource
  });
}

/**
 * Open the external script's detail and return its tile.
 *
 * @param panel The panel page.
 */
async function externalTile(panel: Page): Promise<Locator> {
  const root = panel.locator('[data-fdt-page="javascript"]');
  const detail = await openScriptDetail(panel, scriptRowNamed(root, 'deferred-one.js'));
  const tile = detail.locator('[data-fdt="source-link"]');
  await expect(tile).toBeVisible();
  return tile;
}

/**
 * Wait until a detail section's code block is highlighted for real: the
 * block is stamped and its lines carry generated token classes.
 *
 * @param section The detail section (`script-source` / `script-served-tag`).
 */
async function expectTokenColored(section: Locator): Promise<void> {
  const block = section.locator('[data-fdt="code-block"]');
  // The block highlights once it is on screen (an intersection gate).
  await block.scrollIntoViewIfNeeded();
  await expect(block).toHaveAttribute('data-fdt-highlighted', '', { timeout: 15_000 });
  await expect(block.locator('[class*="fdt-tk-"]').first()).toBeAttached();
}

test.beforeEach(async ({ extension }) => {
  await extension.browserContext.route(`**${FIXTURE_PATH}*`, async (route) => {
    await route.fulfill({ contentType: 'text/html', body: sourceLinkPage() });
  });
});

test.afterEach(async ({ extension }) => {
  await extension.browserContext.unroute(`**${FIXTURE_PATH}*`);
});

test('one click opens the script in Sources once, at its fragment-free URL and line 0', async ({
  extension
}) => {
  const { panel, fixture } = await openSourceLinkPanel(extension, 'ok');
  try {
    const tile = await externalTile(panel);
    const open = tile.locator('[data-fdt="source-link-open"]');
    await expect(open).toHaveAttribute('data-fdt-action', 'sources');
    await expect(open).toContainText(`Open in Sources · ${HOST}`);
    await open.click();
    await expect.poll(() => openResourceCalls(panel)).toEqual([[SOURCES_TARGET, 0]]);
    // Success is quiet: no toast.
    await expect(panel.locator('[data-fdt="toast"]')).toHaveCount(0);
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('a DevTools failure record in the callback shows the "Couldn\'t open in Sources" toast', async ({
  extension
}) => {
  const { panel, fixture } = await openSourceLinkPanel(extension, 'fail');
  try {
    const tile = await externalTile(panel);
    await tile.locator('[data-fdt="source-link-open"]').click();
    await expect.poll(() => openResourceCalls(panel)).toEqual([[SOURCES_TARGET, 0]]);
    const toast = panel.locator('[data-fdt="toast"]');
    await expect(toast).toHaveCount(1);
    await expect(toast).toContainText("Couldn't open in Sources");
    await expect(toast).toContainText('Open it in a new tab instead.');
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('the companion link opens a new tab with the full URL and never calls DevTools', async ({
  extension
}) => {
  const { panel, fixture } = await openSourceLinkPanel(extension, 'ok');
  try {
    const tile = await externalTile(panel);
    const [tab] = await Promise.all([
      extension.browserContext.waitForEvent('page'),
      tile.locator('[data-fdt="source-link-new-tab"]').click()
    ]);
    try {
      await tab.waitForLoadState('domcontentloaded');
      expect(tab.url()).toBe(SCRIPT_URL);
    } finally {
      await tab.close();
    }
    expect(await openResourceCalls(panel)).toEqual([]);
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('without the capability the tile reads "Open in new tab" and opens the full URL in a tab', async ({
  extension
}) => {
  const { panel, fixture } = await openSourceLinkPanel(extension);
  try {
    const tile = await externalTile(panel);
    const open = tile.locator('[data-fdt="source-link-open"]');
    await expect(open).toHaveAttribute('data-fdt-action', 'new-tab');
    await expect(open).toContainText(`Open in new tab · ${HOST}`);
    // One action, no companion: the tile itself is the new-tab link.
    await expect(tile.locator('[data-fdt="source-link-new-tab"]')).toHaveCount(0);
    const [tab] = await Promise.all([extension.browserContext.waitForEvent('page'), open.click()]);
    try {
      await tab.waitForLoadState('domcontentloaded');
      expect(tab.url()).toBe(SCRIPT_URL);
    } finally {
      await tab.close();
    }
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('the detail token-colors the served tag (HTML) and an inline script’s source (JavaScript)', async ({
  extension
}) => {
  const { panel, fixture } = await openSourceLinkPanel(extension);
  try {
    const root = panel.locator('[data-fdt-page="javascript"]');
    // External: the served tag is the only code block.
    let detail = await openScriptDetail(panel, scriptRowNamed(root, 'deferred-one.js'));
    const externalTag = detail.locator('[data-fdt="script-served-tag"]');
    await expectTokenColored(externalTag);
    await expect(externalTag.locator('[data-fdt="code-block"]')).toContainText(
      'type="rocketlazyloadscript"'
    );
    // Inline: the source block and its served tag.
    detail = await openScriptDetail(panel, scriptRowNamed(root, 'Inline script #1'));
    const source = detail.locator('[data-fdt="script-source"]');
    await expectTokenColored(source);
    await expect(source.locator('[data-fdt="code-block"]')).toContainText('const answer = 42;');
    await expectTokenColored(detail.locator('[data-fdt="script-served-tag"]'));
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
