/**
 * In-place update from the published 2.2.5 store item to this build, on one
 * profile, as a real `runtime.onInstalled` `update`.
 *
 * The published build is replaced by a stand-in extension in the same
 * folder (same unpacked id): manifest version 2.2.5 and an empty worker,
 * from which the suite writes exactly the state the published build leaves
 * behind — the storage of `fixtures/upgrade/published-storage.json`
 * (recorded from a live 2.2.5 run after changing its one option and letting
 * its database refresh: the rows are trimmed to three), its hourly alarm and
 * its four context-menu ids. The real bundle is then swapped into the folder
 * and loaded again through CDP `Extensions.loadUnpacked`, which Chromium
 * treats as an update of the loaded extension (a command-line
 * `--load-extension` relaunch is always an install).
 *
 * Asserted per database case (endpoint answers / endpoint down / stored
 * value not the row shape): the stored option survives (storage + the
 * options page's switch), the rows end as the case expects (refreshed,
 * kept or re-seeded — never an unvalidated stored shape), unrelated keys
 * stay, the alarms are exactly this build's two hourly ones (the published
 * one's name reused), every current menu id is present, the id only the
 * published build created is gone (Chromium itself drops every menu entry on
 * an update — measured; the build's own `removeAll` before creating is a
 * guard, not what this proves), exactly one What's new tab opens (its
 * address carrying `since=2.2.5`, the newest announced release shown), the worker
 * logs no error, and one more reload on the same version opens no What's
 * new tab (a reload closes the extension's own tabs, so any is a new one).
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Route, Worker } from '@playwright/test';
import { EXTENSION_PATH, MENU_PARITY_IDS, expect, test } from '../helpers/extension';
import { launchLoader, loadUnpacked, probeMenuIds } from '../helpers/cdp-loader';
import { optionsReady, rowSwitchInput } from '../helpers/options';
import {
  WHATS_NEW_WAIT_MS,
  expectSecondWakeOpensNone,
  featuredRelease,
  whatsNewTabs
} from '../helpers/whats-new';
import packageInfo from '../../../package.json' with { type: 'json' };

/** The published store version this build replaces. */
const PUBLISHED_VERSION = '2.2.5';

/** Storage the published build leaves (recorded live; rows trimmed). */
interface PublishedStorage {
  sync: Record<string, unknown>;
  local: Record<string, unknown>;
  session: Record<string, unknown>;
}

const PUBLISHED_STORAGE = JSON.parse(
  readFileSync(
    path.resolve(import.meta.dirname, '../fixtures/upgrade/published-storage.json'),
    'utf8'
  )
) as PublishedStorage;

/** The packaged database snapshot (what a re-seed writes). */
const SEED_ROWS = JSON.parse(
  readFileSync(
    path.resolve(import.meta.dirname, '../../../lib/known-conflicts/known-conflicts-db.json'),
    'utf8'
  )
) as { id: string }[];

/** The published build's alarm (name kept by this build). */
const ALARM = 'update-known-conflicts-db';

/** The published build's menu ids; the last is the one this build dropped. */
const PUBLISHED_MENU_IDS = [
  'wprSideBySide',
  'psiSideBySide',
  'updateKnownConflictsDB',
  'exclusionBuilderPage'
] as const;

/** The database endpoint (every request this suite makes to it is routed). */
const DB_ROUTE = 'https://apps.wpr-support.com/kc/known-conflicts.json';

/** The database key and its meta key in `storage.local`. */
const DB_KEY = 'known-conflicts-db';
const DB_META_KEY = 'known-conflicts-db$';

/** A sync key the published build never wrote: an update must leave it alone. */
const UNRELATED_SYNC = { 'e2e-unrelated': { kept: true } };

/** One row the routed endpoint answers on a successful refresh. */
const FRESH_ROW = {
  id: 'e2e-fresh-row',
  type: 'Plugin',
  name: 'E2E Fresh Row',
  detection_pattern: '/e2e-fresh/',
  summary: 'Prevent Caching',
  issue_description: '',
  url: 'https://example.com/e2e-fresh'
};

/** The ids of the recorded rows. */
const RECORDED_IDS = (PUBLISHED_STORAGE.local[DB_KEY] as { id: string }[]).map((row) => row.id);

/** One database case: what is stored before, how the endpoint answers, the rows after. */
interface DbCase {
  name: string;
  storedDb: unknown;
  endpoint: 'answers' | 'down';
  expectedIds: string[];
  /** Whether the refresh stamps `updatedAt`. */
  stamped: boolean;
}

const DB_CASES: readonly DbCase[] = [
  {
    name: 'endpoint answers: rows refreshed',
    storedDb: PUBLISHED_STORAGE.local[DB_KEY],
    endpoint: 'answers',
    expectedIds: [FRESH_ROW.id],
    stamped: true
  },
  {
    name: 'endpoint down: recorded rows kept',
    storedDb: PUBLISHED_STORAGE.local[DB_KEY],
    endpoint: 'down',
    expectedIds: RECORDED_IDS,
    stamped: false
  },
  {
    name: 'endpoint down, stored value not rows: snapshot seeded',
    storedDb: { message: 'not the row shape' },
    endpoint: 'down',
    expectedIds: SEED_ROWS.map((row) => row.id),
    stamped: false
  }
];

/**
 * Write the stand-in published build into `dir`: version 2.2.5, an empty
 * worker, and the permissions its state needs.
 *
 * @param dir The extension folder (replaced wholesale).
 */
function stagePublishedStandIn(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Published stand-in',
      version: PUBLISHED_VERSION,
      permissions: ['storage', 'alarms', 'contextMenus'],
      background: { service_worker: 'background.js' }
    })
  );
  writeFileSync(path.join(dir, 'background.js'), '');
}

/**
 * Replace `dir` with the real built bundle.
 *
 * @param dir The extension folder.
 */
function stageRelease(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  cpSync(EXTENSION_PATH, dir, { recursive: true });
}

/**
 * Write the published build's leftover state from the stand-in's worker.
 *
 * @param worker The stand-in's worker.
 * @param storedDb The database value this case stores.
 */
async function writePublishedState(worker: Worker, storedDb: unknown): Promise<void> {
  await worker.evaluate(
    async ({ storage, db, dbKey, unrelated, alarm, menuIds }) => {
      await chrome.storage.sync.set({ ...storage.sync, ...unrelated });
      await chrome.storage.local.set({ ...storage.local, [dbKey]: db });
      await chrome.alarms.create(alarm, { periodInMinutes: 60 });
      for (const id of menuIds) {
        await new Promise<void>((done, fail) => {
          chrome.contextMenus.create({ id, title: id, contexts: ['all'] }, () => {
            const error = chrome.runtime.lastError;
            if (error === undefined) done();
            else fail(new Error(error.message));
          });
        });
      }
    },
    {
      storage: PUBLISHED_STORAGE,
      db: storedDb,
      dbKey: DB_KEY,
      unrelated: UNRELATED_SYNC,
      alarm: ALARM,
      menuIds: [...PUBLISHED_MENU_IDS]
    }
  );
}

/**
 * Wait until the database meta carries `updatedAt` (refresh cases) or the
 * boot prime had time to finish (the others).
 *
 * @param worker The extension's worker.
 * @param stamped Whether a stamp is expected.
 */
async function settleDatabase(worker: Worker, stamped: boolean): Promise<void> {
  if (stamped) {
    await expect
      .poll(
        async () =>
          (
            (await worker.evaluate((key) => chrome.storage.local.get(key), DB_META_KEY))[
              DB_META_KEY
            ] as { updatedAt?: unknown } | undefined
          )?.updatedAt,
        { timeout: 15_000 }
      )
      .toEqual(expect.any(Number));
    return;
  }
  await worker.evaluate(() => new Promise((done) => setTimeout(done, 3_000)));
}

test.describe('in-place update from the published build', () => {
  test.describe.configure({ timeout: 120_000 });

  for (const dbCase of DB_CASES) {
    test(dbCase.name, async () => {
      const root = mkdtempSync(path.join(tmpdir(), 'wpr-fdt-e2e-upgrade-'));
      const extensionDir = path.join(root, 'extension');
      const loader = await launchLoader(path.join(root, 'profile'));
      const { context } = loader;
      const routeDb = (route: Route): Promise<void> =>
        dbCase.endpoint === 'answers'
          ? route.fulfill({ json: [FRESH_ROW] })
          : route.abort('internetdisconnected');
      await context.route(DB_ROUTE, routeDb);
      try {
        stagePublishedStandIn(extensionDir);
        const published = await loadUnpacked(loader, extensionDir);
        await writePublishedState(published.worker, dbCase.storedDb);

        stageRelease(extensionDir);
        const errors: string[] = [];
        context.on('serviceworker', (worker) => {
          worker.on('console', (message) => {
            if (message.type() === 'error') errors.push(message.text());
          });
        });
        const updated = await loadUnpacked(loader, extensionDir, published.worker);
        expect(updated.id, 'the update keeps the extension id').toBe(published.id);
        await settleDatabase(updated.worker, dbCase.stamped);

        const state = await updated.worker.evaluate(async () => ({
          version: chrome.runtime.getManifest().version,
          sync: await chrome.storage.sync.get(null),
          local: await chrome.storage.local.get(null),
          alarms: (await chrome.alarms.getAll()).map(({ name, periodInMinutes }) => ({
            name,
            periodInMinutes
          }))
        }));
        expect(state.version).toBe(packageInfo.version);
        expect(state.sync.options, 'the stored option survives').toMatchObject({
          improvements: { 'wp-dashboard-dbugger-entry': false }
        });
        expect(state.sync['e2e-unrelated'], 'unrelated keys stay').toEqual(
          UNRELATED_SYNC['e2e-unrelated']
        );
        const rows = state.local[DB_KEY] as { id: string }[];
        expect(rows.map((row) => row.id)).toEqual(dbCase.expectedIds);
        const meta = state.local[DB_META_KEY] as Record<string, unknown> | undefined;
        if (dbCase.stamped) expect(meta?.updatedAt).toEqual(expect.any(Number));
        else expect(meta?.updatedAt).toBeUndefined();
        expect(
          [...state.alarms].sort((left, right) => left.name.localeCompare(right.name)),
          'exactly the current alarms'
        ).toEqual([
          { name: 'refresh-latest-exclusion-list', periodInMinutes: 60 },
          { name: ALARM, periodInMinutes: 60 }
        ]);

        const menus = await probeMenuIds(updated.worker, [
          ...MENU_PARITY_IDS,
          'exclusionBuilderPage'
        ]);
        for (const id of MENU_PARITY_IDS) expect(menus[id], `menu ${id}`).toBe(true);
        // Browser behaviour, not the build's: Chromium clears menus on update.
        expect(menus.exclusionBuilderPage, 'the dropped menu id is gone').toBe(false);

        const options = await context.newPage();
        await options.goto(`chrome-extension://${updated.id}/options.html`, { waitUntil: 'load' });
        await optionsReady(options);
        await expect(rowSwitchInput(options, 'wp-dashboard-dbugger-entry')).not.toBeChecked();
        await options.close();

        // Polled from the first moment: the update opens it on its own.
        await expect
          .poll(() => whatsNewTabs(context).length, { timeout: WHATS_NEW_WAIT_MS })
          .toBe(1);
        const [whatsNew] = whatsNewTabs(context);
        if (whatsNew === undefined) throw new Error('the What’s new tab vanished');
        expect(new URL(whatsNew.url()).searchParams.get('since')).toBe(PUBLISHED_VERSION);
        await expect(
          whatsNew.locator(`[data-fdt-release="${featuredRelease(PUBLISHED_VERSION)}"]`)
        ).toBeVisible();

        expect(errors, 'the updated worker logs no error').toEqual([]);

        // A second wake on the same version: nothing new opens.
        await loadUnpacked(loader, extensionDir, updated.worker);
        await expectSecondWakeOpensNone(context);
      } finally {
        await context.close().catch(() => undefined);
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
