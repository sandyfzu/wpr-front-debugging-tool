/**
 * The extension namespaces a page's DOM cannot forge.
 *
 * Chromium installs `browser` and `chrome` in an extension's isolated world
 * when the world is created, and skips a name the page's DOM already answers:
 * in a tab loaded before the extension started (install, update, reload), the
 * first injected script creates the world after the page parsed, and a page
 * `<form id="browser"><input name="runtime" id="x">` becomes `browser` (same
 * for `chrome`, which the messaging library reads bare). The root element
 * exists even at `document_start`: `<html id="chrome">` is decorated as
 * `chrome`, until the body's second `id="chrome"` turns named access into a
 * bare HTMLCollection. The build resolves every `browser` import through a
 * resolver that takes only an own global, and pins the genuine namespace as
 * the world's own `chrome` (`utils/extension-api`).
 *
 * - Install after load (`browser` form): the exclusion builder overlay (the
 *   background opens it on any tab) mounts in a pre-existing tab, and both
 *   runtime-injected views report the real runtime id.
 * - Install after load (`chrome` form): the overlay mounts — its messaging
 *   runs over the pinned `chrome`.
 * - Load after install (`browser` form): `document_start` scripts create the
 *   world before the body exists — a control, passes either way.
 * - Load after install (`<html id="chrome">` + `<p id="chrome">`): the
 *   isolated script's sends after parse reach the background (its served
 *   page data carries the background's header capture).
 * - No shipped bundle reads the `browser` global; every bundle pins `chrome`
 *   before its first `chrome` read.
 *
 * Witness: each WXT content script posts `<runtime.id>:<entrypoint>:wxt:
 * content-script-started` to the window at start — the id its `browser` reads.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Page, Worker } from '@playwright/test';

import {
  EXTENSION_PATH,
  ORIGIN_A,
  expect,
  launchForLateInstall,
  test,
  wireEnvelope,
  type LateInstallBrowser,
  type WireEnvelope
} from '../helpers/extension';

/** The fixture page: a form named `browser` with a `runtime` input of id `x`. */
const FIXTURE = '/extension-api/browser-form.html';
/** A form named `chrome` whose `runtime` is an input. */
const CHROME_FORM = '/extension-api/chrome-form.html';
/** A root element named `chrome`, plus a second `chrome` in the body. */
const CHROME_ROOT = '/extension-api/chrome-root.html';
/** The runtime id the clobbering form forges. */
const FORGED_ID = 'x';
/** Mount wait (the overlay is injected on demand). */
const MOUNT = { timeout: 15_000 };

/** The start announcements the page saw. */
const starts = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __wxtStarts: string[] }).__wxtStarts);

/**
 * Inject one built script into a tab's top frame, the way the background's
 * openers do (`scripting.executeScript` with files, default world).
 *
 * @param worker The extension service worker.
 * @param url The tab's exact URL.
 * @param file The built file.
 */
async function injectInto(worker: Worker, url: string, file: string): Promise<void> {
  await worker.evaluate(
    async ({ url, file }) => {
      const [tab] = await chrome.tabs.query({ url });
      if (tab?.id === undefined) throw new Error(`No tab at ${url}`);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        files: [file]
      });
    },
    { url, file }
  );
}

/**
 * Ask the tab's isolated script for its panel payload, as the panel does.
 *
 * @param worker The extension service worker.
 * @param url The tab's exact URL.
 * @returns The served payload's header capture (`null` when its fetch failed).
 */
async function servedHeaders(worker: Worker, url: string): Promise<unknown> {
  return await worker.evaluate(
    async ({ url, envelope }: { url: string; envelope: WireEnvelope }) => {
      const [tab] = await chrome.tabs.query({ url });
      if (tab?.id === undefined) throw new Error(`No tab at ${url}`);
      const reply = await chrome.tabs.sendMessage<
        WireEnvelope,
        { res?: { pageHeaders?: unknown }; err?: string } | undefined
      >(tab.id, envelope);
      if (reply?.err !== undefined) throw new Error(reply.err);
      return reply?.res?.pageHeaders ?? null;
    },
    { url, envelope: wireEnvelope('getFdtData', undefined) }
  );
}

/** Collect the page's `[WPR FDT]` console lines. */
function extensionLogs(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('[WPR FDT]')) lines.push(message.text());
  });
  return lines;
}

test.describe('extension namespace vs page DOM clobbering', () => {
  let late: LateInstallBrowser;

  test.beforeEach(async () => {
    late = await launchForLateInstall();
  });

  test.afterEach(async () => {
    await late.close();
  });

  test('a tab loaded before install: the injected overlay and palette resolve the real namespace', async () => {
    const page = await late.context.newPage();
    const url = `${ORIGIN_A}${FIXTURE}?leg=before-install`;
    await page.goto(url, { waitUntil: 'load' });
    // The page's DOM answers `browser` in its own world.
    expect(await page.evaluate(() => (window as unknown as { browser: Element }).browser.id)).toBe(
      'browser'
    );

    const { id, worker } = await late.install();
    expect(id).not.toBe(FORGED_ID);

    await injectInto(worker, url, '/content-scripts/exclusion-overlay.js');
    // The palette view leaves a page without its module (no document_start
    // script ran here) — its start announcement still names its namespace.
    await injectInto(worker, url, '/content-scripts/command-palette.js');

    await expect
      .poll(() => starts(page))
      .toEqual([
        `${id}:exclusion-overlay:wxt:content-script-started`,
        `${id}:command-palette:wxt:content-script-started`
      ]);
    await expect(page.getByRole('heading', { name: 'Exclusion Builder' })).toBeVisible(MOUNT);
  });

  test('a tab loaded before install with a form named chrome: the overlay messages over the pinned chrome', async () => {
    const page = await late.context.newPage();
    const logs = extensionLogs(page);
    const url = `${ORIGIN_A}${CHROME_FORM}?leg=chrome-before-install`;
    await page.goto(url, { waitUntil: 'load' });
    // The page's main world keeps its own `chrome` object (Chromium defines
    // one there), so the shape is checked in the DOM itself.
    expect(await page.locator('form#chrome input[name="runtime"]').count()).toBe(1);

    const { id, worker } = await late.install();
    await injectInto(worker, url, '/content-scripts/exclusion-overlay.js');

    await expect
      .poll(() => starts(page))
      .toEqual([`${id}:exclusion-overlay:wxt:content-script-started`]);
    await expect(page.getByRole('heading', { name: 'Exclusion Builder' })).toBeVisible(MOUNT);
    expect(logs.filter((line) => /failed/i.test(line))).toEqual([]);
  });

  test('a tab loaded after install with a root element named chrome: the isolated script messages after parse', async () => {
    const { id, worker } = await late.install();
    // Readiness gate on a plain page: loads in the first moments after
    // install are served without a header capture (measured, any page).
    const gate = await late.context.newPage();
    const warmUp = `${ORIGIN_A}${FIXTURE}?leg=warm-up`;
    await expect
      .poll(
        async () => {
          await gate.goto(warmUp, { waitUntil: 'load' });
          return await servedHeaders(worker, warmUp);
        },
        { timeout: 15_000 }
      )
      .not.toBeNull();

    // A fresh tab: its first document is where the root element answers
    // `chrome` at world creation (a later navigation in the same tab did not
    // reproduce, measured on this Chromium).
    const page = await late.context.newPage();
    const logs = extensionLogs(page);
    const url = `${ORIGIN_A}${CHROME_ROOT}?leg=chrome-root`;
    await page.goto(url, { waitUntil: 'load' });
    // Two elements named `chrome`, the first the root.
    expect(await page.evaluate(() => document.documentElement.id)).toBe('chrome');
    expect(await page.locator('[id="chrome"]').count()).toBe(2);
    await expect
      .poll(async () => [...(await starts(page))].sort())
      .toEqual([
        `${id}:isolated:wxt:content-script-started`,
        `${id}:ua-relay:wxt:content-script-started`
      ]);

    // The payload awaits the isolated script's own header fetch (a send to
    // the background, after parse): a forged `chrome` serves `null`.
    expect(await servedHeaders(worker, url)).not.toBeNull();
    expect(logs.filter((line) => /failed|unanswered/i.test(line))).toEqual([]);
  });

  test('a tab loaded after install: document_start scripts resolve the real namespace', async () => {
    const { id, worker } = await late.install();
    const page = await late.context.newPage();
    const url = `${ORIGIN_A}${FIXTURE}?leg=after-install`;
    await page.goto(url, { waitUntil: 'load' });

    await expect
      .poll(async () => [...(await starts(page))].sort())
      .toEqual([
        `${id}:isolated:wxt:content-script-started`,
        `${id}:ua-relay:wxt:content-script-started`
      ]);
    await injectInto(worker, url, '/content-scripts/exclusion-overlay.js');
    await expect(page.getByRole('heading', { name: 'Exclusion Builder' })).toBeVisible(MOUNT);
    expect(await starts(page)).not.toContainEqual(expect.stringMatching(/^x:/));
  });

  test('no shipped bundle reads the browser global; every namespace user carries the resolver', () => {
    const files = readdirSync(EXTENSION_PATH, { recursive: true, encoding: 'utf8' }).filter(
      (file) => file.endsWith('.js')
    );
    const read = (file: string): string => readFileSync(path.join(EXTENSION_PATH, file), 'utf8');
    expect(
      files.filter((file) => /\b(globalThis|self|window)\.browser\b/.test(read(file)))
    ).toEqual([]);
    // Every bundle reading `chrome` (bare, as the messaging library does, or
    // off the global) pins it first: the pin's call is a top-level statement
    // ahead of the first read.
    const chromeRead = /(^|[^.\w$])chrome\.(runtime|tabs)\b|globalThis\.chrome\b/;
    const pinCall = /[\w$]+\(globalThis,[\w$]+\(globalThis\)\)/;
    const chromeReaders = files.filter((file) => chromeRead.test(read(file)));
    expect(chromeReaders.length).toBeGreaterThan(0);
    for (const file of chromeReaders) {
      const source = read(file);
      const pinAt = source.search(pinCall);
      expect(pinAt, `${file} pins chrome`).toBeGreaterThanOrEqual(0);
      expect(pinAt, `${file} pins before its first chrome read`).toBeLessThan(
        source.search(chromeRead)
      );
    }
    const resolving = files.filter((file) => /Object\.hasOwn\([\w$]+,`browser`\)/.test(read(file)));
    for (const bundle of [
      'background.js',
      'beacon-runner.js',
      'content-scripts/isolated.js',
      'content-scripts/ua-relay.js',
      'content-scripts/exclusion-overlay.js',
      'content-scripts/command-palette.js'
    ]) {
      expect(resolving).toContain(bundle);
    }
  });
});
