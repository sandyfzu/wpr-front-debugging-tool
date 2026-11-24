/**
 * Repetition without accumulation: ten in-place extension reloads, twenty
 * page navigations and fifty inspected-tab navigations under an open panel.
 *
 * Reload leg (CDP loader, own profile — `helpers/cdp-loader.ts` says why a
 * second `Extensions.loadUnpacked` is the real in-place reload, unlike the
 * relaunch proxy `boot-and-registry.spec.ts` uses): after every reload every
 * registry menu id is present, the alarms are exactly the expected set and
 * the reloaded admin page carries the D-bugger entry once. A tab left open
 * across all ten reloads keeps the content-script set it loaded with (a
 * reload injects none into an open tab, so that set is orphaned): under DOM
 * churn its world, listener and observer counts never grow past the fresh
 * set's, its post-GC heap stays flat from reload 1 to 10, and no error from
 * the extension reaches a page or a worker.
 *
 * Navigation leg: a real back/forward-cache restore (cache kept for this
 * browser, logged-out front page) runs no second content-script set; twenty
 * wp-admin/front navigations in one tab and a back/forward to an admin
 * document (never cached: WordPress serves it `no-store`, so the browser
 * reloads it) carry the entry once, and the worker's post-GC heap does not
 * grow with the count.
 *
 * Panel leg (shared driver + panel seam): fifty navigations of the inspected
 * fixture tab, each awaited as the panel's in-place refresh; the panel's and
 * the worker's post-GC heaps stay flat.
 *
 * Heap bounds are generous on purpose (GC timing noise is ~100 KB); measured
 * numbers are attached as test annotations for the receipt.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page, Worker } from '@playwright/test';
import { EXTENSION_PATH, MENU_PARITY_IDS, ORIGIN_A, expect, test } from '../helpers/extension';
import {
  launchLoader,
  loadUnpacked,
  probeMenuIds,
  targetHeapAfterGc,
  type LoaderBrowser,
  type LoaderOptions
} from '../helpers/cdp-loader';
import { openWorldReader, type WorldInventory } from '../helpers/content-world';
import { openPanelForFixture } from '../helpers/panel-data';
import { SITE_URL, loginAdminPage } from '../helpers/site';

/** The admin-bar entry the improvement injects. */
const DBUGGER_ITEM = '#wp-admin-bar-d-bugger';

/** A menu id outside the registry: proves the probe can answer "absent". */
const ABSENT_MENU_ID = 'e2e-leak-absence-control';

/** The top bar's answer on the detected fixture (absent on the plain one). */
const DETECTED_ANSWER = 'WP Rocket 3.20.1';

/** Heap growth tolerated across a whole leg (bytes). */
const HEAP_SLACK_BYTES = 1024 * 1024;

/**
 * Growth tolerated in the orphaned tab's heap from reload 1 to 10 (bytes):
 * the churn leaves no node behind, so this is GC noise only (measured ~25 KB).
 */
const ORPHAN_HEAP_SLACK_BYTES = 256 * 1024;

/** The alarms the background keeps (name → period in minutes), sorted by name. */
const EXPECTED_ALARMS = [
  { name: 'refresh-latest-exclusion-list', periodInMinutes: 60 },
  { name: 'update-known-conflicts-db', periodInMinutes: 60 }
];

/** Text the extension's own console lines and its context-loss errors carry. */
const EXTENSION_ERROR_MARKERS = [
  '[WPR FDT]',
  'Extension context invalidated',
  'chrome-extension://'
];

/**
 * Collect error-level console lines and uncaught errors that come from the
 * extension (page-own noise is not ours to judge).
 *
 * @param page The page to watch.
 * @param into The list to append to.
 */
function collectExtensionErrors(page: Page, into: string[]): void {
  const keep = (text: string): void => {
    if (EXTENSION_ERROR_MARKERS.some((marker) => text.includes(marker))) into.push(text);
  };
  page.on('console', (message) => {
    if (message.type() === 'error') keep(message.text());
  });
  page.on('pageerror', (error) => {
    keep(`${error.message}\n${error.stack ?? ''}`);
  });
}

/**
 * Collect every error-level console line of the extension's workers.
 *
 * @param loader The loader browser.
 * @param into The list to append to.
 */
function collectWorkerErrors(loader: LoaderBrowser, into: string[]): void {
  const watch = (worker: Worker): void => {
    worker.on('console', (message) => {
      if (message.type() === 'error') into.push(message.text());
    });
  };
  loader.context.serviceWorkers().forEach(watch);
  loader.context.on('serviceworker', watch);
}

/**
 * Every alarm (name + period), sorted by name.
 *
 * @param worker The extension's worker.
 */
function alarmSet(worker: Worker): Promise<{ name: string; periodInMinutes?: number }[]> {
  return worker.evaluate(async () =>
    (await chrome.alarms.getAll())
      .map(({ name, periodInMinutes }) => ({ name, periodInMinutes }))
      .sort((left, right) => left.name.localeCompare(right.name))
  );
}

/**
 * Churn the page's DOM with nodes the content scripts react to (scripts,
 * lazy images), then remove them all, so the document ends as it began.
 *
 * @param page The page.
 */
async function churnDom(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (let index = 0; index < 50; index += 1) {
      const node = document.body.appendChild(document.createElement('div'));
      node.className = 'e2e-churn';
      node.innerHTML = '<script src="/e2e-missing.js"></script><img data-lazy-src="/x.png">';
    }
    window.scrollBy(0, 200);
    document.querySelectorAll('.e2e-churn').forEach((node) => {
      node.remove();
    });
  });
}

/**
 * Assert no count of `now` exceeds the same count of `bound`.
 *
 * @param now The later inventory.
 * @param bound The inventory it must not outgrow.
 * @param label What is compared (for the failure message).
 */
function expectNoGrowth(now: WorldInventory, bound: WorldInventory, label: string): void {
  expect(now.worlds, `${label}: worlds`).toBeLessThanOrEqual(bound.worlds);
  expect(now.listeners, `${label}: listeners`).toBeLessThanOrEqual(bound.listeners);
  for (const [kind, count] of Object.entries(now.observers)) {
    expect(count, `${label}: ${kind}`).toBeLessThanOrEqual(
      bound.observers[kind as keyof WorldInventory['observers']]
    );
  }
}

/**
 * The D-bugger entries on the page's current document.
 *
 * @param page The page.
 */
function dbuggerCount(page: Page): Promise<number> {
  return page.locator(DBUGGER_ITEM).count();
}

/**
 * Wait for the entry to settle on an admin document (the improvement runs
 * after `load`), then return the count.
 *
 * @param page The admin page.
 */
async function settledDbuggerCount(page: Page): Promise<number> {
  await expect(page.locator(DBUGGER_ITEM).first()).toBeAttached({ timeout: 10_000 });
  // One more frame: a duplicate would land in the same task as the first.
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => {
          done(null);
        })
      )
  );
  return dbuggerCount(page);
}

/**
 * The extension worker's post-GC heap.
 *
 * @param loader The loader browser.
 * @param id The extension id.
 */
function workerHeap(loader: LoaderBrowser, id: string): Promise<number> {
  return targetHeapAfterGc(loader.session, `chrome-extension://${id}/`, 'service_worker');
}

/**
 * Attach one measured number to the test report (the receipt's source).
 *
 * @param name What was measured.
 * @param value The number.
 */
function receipt(name: string, value: number | string): void {
  test.info().annotations.push({ type: name, description: String(value) });
}

/**
 * Run `body` on a fresh loader profile with the built bundle loaded.
 *
 * @param body The leg.
 * @param options Loader launch choices.
 */
async function withLoader(
  body: (loader: LoaderBrowser, loaded: { id: string; worker: Worker }) => Promise<void>,
  options: LoaderOptions = {}
): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), 'wpr-fdt-e2e-leaks-'));
  const loader = await launchLoader(path.join(root, 'profile'), options);
  try {
    await body(loader, await loadUnpacked(loader, EXTENSION_PATH));
  } finally {
    await loader.context.close().catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
}

test.describe('reload and navigation leaks', () => {
  test.describe.configure({ timeout: 240_000 });

  test('ten in-place reloads: menus present, exact alarms, one admin entry; the orphaned tab neither grows nor errors', async () => {
    await withLoader(async (loader, first) => {
      const workerErrors: string[] = [];
      const pageErrors: string[] = [];
      collectWorkerErrors(loader, workerErrors);
      const admin = await loader.context.newPage();
      collectExtensionErrors(admin, pageErrors);
      await loginAdminPage(admin);
      const orphan = await loader.context.newPage();
      collectExtensionErrors(orphan, pageErrors);
      await orphan.goto(`${SITE_URL}/`, { waitUntil: 'load' });
      const world = await openWorldReader(orphan, `chrome-extension://${first.id}`);
      try {
        const fresh = await world.read();
        expect(fresh.worlds, 'the open tab runs one content-script set').toBe(1);

        let current = first;
        const workerHeaps: number[] = [];
        const orphanAfter: { inventory: WorldInventory; heap: number }[] = [];
        for (let reload = 1; reload <= 10; reload += 1) {
          current = await loadUnpacked(loader, EXTENSION_PATH, current.worker);
          expect(current.id, 'a reload keeps the id').toBe(first.id);
          // Let the boot steps (menus, alarms, primes) finish.
          await current.worker.evaluate(() => new Promise((done) => setTimeout(done, 1_000)));

          const menus = await probeMenuIds(current.worker, [...MENU_PARITY_IDS, ABSENT_MENU_ID]);
          for (const id of MENU_PARITY_IDS)
            expect(menus[id], `reload ${String(reload)}: menu ${id}`).toBe(true);
          expect(menus[ABSENT_MENU_ID], 'the probe can answer absent').toBe(false);
          expect(await alarmSet(current.worker), `reload ${String(reload)}: alarms`).toEqual(
            EXPECTED_ALARMS
          );

          // The orphaned tab's DOM churns: a dead context's observers must not throw.
          await churnDom(orphan);
          if (reload === 1 || reload === 10) {
            orphanAfter.push({ inventory: await world.read(), heap: await world.heapAfterGc() });
          }

          await admin.reload({ waitUntil: 'load' });
          expect(await settledDbuggerCount(admin), `reload ${String(reload)}: admin entry`).toBe(1);
          workerHeaps.push(await workerHeap(loader, first.id));
        }

        const [afterOne, afterTen] = orphanAfter;
        if (afterOne === undefined || afterTen === undefined) throw new Error('missing samples');
        receipt('orphaned tab: fresh set (worlds / listeners / observers)', JSON.stringify(fresh));
        receipt('orphaned tab: after reload 10', JSON.stringify(afterTen.inventory));
        receipt(
          'orphaned tab heap after reload 1 / 10 (bytes)',
          `${String(afterOne.heap)} / ${String(afterTen.heap)}`
        );
        // Each fresh worker is its own isolate: this bounds one boot's state, not a cross-reload leak.
        receipt('worker heap after reloads 1–10 (bytes)', workerHeaps.map(String).join(' / '));
        expectNoGrowth(afterOne.inventory, fresh, 'reload 1 vs the fresh set');
        expectNoGrowth(afterTen.inventory, afterOne.inventory, 'reload 10 vs reload 1');
        expect(afterTen.heap, 'orphaned tab heap, reload 10 vs 1').toBeLessThanOrEqual(
          afterOne.heap + ORPHAN_HEAP_SLACK_BYTES
        );
        expect(workerHeaps.at(-1) ?? 0).toBeLessThanOrEqual(
          (workerHeaps[0] ?? 0) + HEAP_SLACK_BYTES
        );
        expect(
          await orphan.evaluate(() => document.title.length > 0),
          'the orphaned tab still works'
        ).toBe(true);
        expect(pageErrors, 'no extension error reaches a page').toEqual([]);
        expect(workerErrors, 'no worker logs an error').toEqual([]);
      } finally {
        await world.detach();
      }
    });
  });

  test('bfcache restore + twenty navigations + admin back/forward: one content-script set, one admin entry per document, flat worker heap', async () => {
    await withLoader(
      async (loader, loaded) => {
        const pageErrors: string[] = [];
        const admin = await loader.context.newPage();
        collectExtensionErrors(admin, pageErrors);

        // Logged out first: WordPress's front page is cacheable until a login
        // cookie makes the browser refuse it.
        await admin.goto(`${SITE_URL}/`, { waitUntil: 'load' });
        const world = await openWorldReader(admin, `chrome-extension://${loaded.id}`);
        try {
          const before = await world.read();
          await admin.evaluate(() => {
            const marked = window as unknown as { e2eMarker?: number; e2ePersisted?: boolean[] };
            marked.e2eMarker = 1;
            marked.e2ePersisted = [];
            addEventListener('pageshow', (event) => {
              marked.e2ePersisted?.push(event.persisted);
            });
          });
          await admin.goto(`${SITE_URL}/?p=1`, { waitUntil: 'load' });
          // A restore fires no `load`: wait for the commit, then completeness.
          await admin.goBack({ waitUntil: 'commit' });
          await admin.waitForFunction(() => document.readyState === 'complete');
          const restored = await admin.evaluate(() => {
            const marked = window as unknown as { e2eMarker?: number; e2ePersisted?: boolean[] };
            return { marker: marked.e2eMarker ?? null, persisted: marked.e2ePersisted ?? [] };
          });
          expect(
            restored,
            'a back/forward-cache restore (same window, persisted pageshow)'
          ).toEqual({
            marker: 1,
            persisted: [true]
          });
          // The restored document is the same window: the same single set, nothing added.
          expect(before.worlds, 'one content-script set before leaving').toBe(1);
          expect(await world.read(), 'the restore runs no second set').toEqual(before);
        } finally {
          await world.detach();
        }

        await loginAdminPage(admin);
        const targets = [
          { url: `${SITE_URL}/wp-admin/index.php`, admin: true },
          { url: `${SITE_URL}/wp-admin/edit.php`, admin: true },
          { url: `${SITE_URL}/`, admin: false }
        ];
        const baseline = await workerHeap(loader, loaded.id);
        let midway = 0;
        for (let step = 0; step < 20; step += 1) {
          const target = targets[step % targets.length] ?? targets[0];
          if (target === undefined) throw new Error('no navigation target');
          await admin.goto(target.url, { waitUntil: 'load' });
          if (target.admin)
            expect(await settledDbuggerCount(admin), `navigation ${String(step + 1)}`).toBe(1);
          else
            expect(await dbuggerCount(admin), `navigation ${String(step + 1)}`).toBeLessThanOrEqual(
              1
            );
          if (step === 9) midway = await workerHeap(loader, loaded.id);
        }
        // Back to an admin document (`no-store`: reloaded, never restored) and
        // forward again: each new document carries the entry once.
        await admin.goBack({ waitUntil: 'load' });
        expect(
          await admin.evaluate(
            () =>
              (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).type
          ),
          'the admin back is a reload'
        ).toBe('back_forward');
        expect(await settledDbuggerCount(admin), 'after back').toBe(1);
        await admin.goForward({ waitUntil: 'load' });
        expect(await dbuggerCount(admin), 'after forward').toBeLessThanOrEqual(1);
        const final = await workerHeap(loader, loaded.id);

        receipt('worker heap before navigations (bytes)', baseline);
        receipt('worker heap after 10 navigations (bytes)', midway);
        receipt('worker heap after 20 navigations + back/forward (bytes)', final);
        expect(final).toBeLessThanOrEqual(baseline + HEAP_SLACK_BYTES);
        expect(pageErrors, 'no extension error reaches the page').toEqual([]);
      },
      { backForwardCache: true }
    );
  });

  test('fifty inspected-tab navigations under the panel: flat panel and worker heaps', async ({
    extension
  }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
    const browser = extension.browserContext.browser();
    if (browser === null) throw new Error('the driver context exposes no browser for CDP');
    const browserSession = await browser.newBrowserCDPSession();
    const panelSession = await extension.browserContext.newCDPSession(panel);
    const id = await extension.extensionId();
    const panelHeap = async (): Promise<number> => {
      await panelSession.send('HeapProfiler.collectGarbage');
      return (await panelSession.send('Runtime.getHeapUsage')).usedSize;
    };
    const swHeap = (): Promise<number> =>
      targetHeapAfterGc(browserSession, `chrome-extension://${id}/`, 'service_worker');
    const barText = (): Promise<string | null> =>
      panel.evaluate(
        () => document.querySelector('[data-fdt="panel-top-bar"]')?.textContent ?? null
      );
    try {
      await expect.poll(barText, { timeout: 15_000 }).toContain(DETECTED_ANSWER);
      const heaps: { panel: number; worker: number }[] = [];
      for (let step = 1; step <= 50; step += 1) {
        const detected = step % 2 === 0;
        await fixture.page.goto(`${ORIGIN_A}/pipeline/${detected ? 'markers' : 'plain'}.html`, {
          waitUntil: 'load'
        });
        // The bar flips with each page: the in-place refresh landed.
        await expect
          .poll(async () => (await barText())?.includes(DETECTED_ANSWER), {
            timeout: 15_000,
            intervals: [50, 100, 250]
          })
          .toBe(detected);
        if (step === 6 || step === 26 || step === 50) {
          heaps.push({ panel: await panelHeap(), worker: await swHeap() });
        }
      }
      const [warm, mid, last] = heaps;
      if (warm === undefined || mid === undefined || last === undefined) {
        throw new Error('missing heap samples');
      }
      receipt(
        'panel heap after 6 / 26 / 50 navigations (bytes)',
        [warm.panel, mid.panel, last.panel].join(' / ')
      );
      receipt(
        'worker heap after 6 / 26 / 50 navigations (bytes)',
        [warm.worker, mid.worker, last.worker].join(' / ')
      );
      expect(last.panel).toBeLessThanOrEqual(warm.panel + HEAP_SLACK_BYTES);
      expect(last.worker).toBeLessThanOrEqual(warm.worker + HEAP_SLACK_BYTES);
    } finally {
      await panelSession.detach().catch(() => undefined);
      await browserSession.detach().catch(() => undefined);
      await panel.close().catch(() => undefined);
      await fixture.page.close().catch(() => undefined);
    }
  });
});
