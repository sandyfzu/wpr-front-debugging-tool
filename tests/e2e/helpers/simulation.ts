/**
 * The browser tier's simulation seams: drive the overlay's mode controls
 * (Delay JS, Defer JS, LazyLoad), read what a simulated load left behind (the fulfilled
 * document's bytes, the session's per-document simulation report, the
 * page's simulation marker, page errors), dispatch the user interaction
 * WP Rocket's runtime waits for, and stage the background's latest
 * exclusion list from the profile's storage.
 *
 * Harness-only: no shipped module imports this file.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Locator, Page, Response } from '@playwright/test';

import type {
  DeferSimulationReport,
  DelaySimulationReport,
  LazyloadSimulationReport
} from '../../../lib/messaging/exclusion-simulation';
import { SIMULATION_MARKER_META_NAME } from '../../../lib/wp-rocket/constants';
import { expect, type DriverPage, type ExtensionDriver } from './extension';
import { DELAY, applyButton, injectOverlay, lane, reloadThroughSession } from './exclusion-overlay';

/** `chrome.storage.session` key of the per-tab sessions (WXT `session:exclusion-sessions`). */
const SESSIONS_KEY = 'exclusion-sessions';

/** `chrome.storage.local` key of the kept latest list (WXT `local:latest-exclusion-list`). */
const LATEST_LIST_KEY = 'latest-exclusion-list';

/** The Delay lane's mode control (its accessible name). */
export const DELAY_MODE_GROUP = 'Delay JavaScript execution on this page';

/** The three Delay modes, by their visible labels. */
export type DelayModeLabel = 'As served' | 'Simulated' | 'Disabled';

/** One radio of the mode control: its value, checked and disabled states. */
export interface DelayModeReading {
  readonly value: string;
  readonly checked: boolean;
  readonly disabled: boolean;
}

/** The mode control's radio group. */
export const delayModeGroup = (page: Page): Locator =>
  page.getByRole('radiogroup', { name: DELAY_MODE_GROUP });

/**
 * Pick a Delay mode the way a user does (its label; the radio input is
 * visually hidden) and confirm the control took it.
 *
 * @param page The page with the overlay.
 * @param label The mode's label.
 */
export async function chooseDelayMode(page: Page, label: DelayModeLabel): Promise<void> {
  const group = delayModeGroup(page);
  await group.getByText(label, { exact: true }).click();
  await expect(group.getByRole('radio', { name: label, exact: true })).toBeChecked();
}

/** Every radio of the mode control, in order. */
export async function delayModes(page: Page): Promise<DelayModeReading[]> {
  return await delayModeGroup(page)
    .getByRole('radio')
    .evaluateAll((inputs) =>
      inputs.map((input) => ({
        value: (input as HTMLInputElement).value,
        checked: (input as HTMLInputElement).checked,
        disabled: (input as HTMLInputElement).disabled
      }))
    );
}

/** The mode control's notes (block reason, admin warning, replaced, kept). */
export const delayModeNotes = (page: Page): Locator => page.locator('#xo-mode-notes-delayJs p');

/** The Defer JS mode control's accessible name. */
export const DEFER_MODE_GROUP = 'Load JavaScript deferred on this page';

/** The Defer JS mode control's radio group. */
export const deferModeGroup = (page: Page): Locator =>
  page.getByRole('radiogroup', { name: DEFER_MODE_GROUP });

/** The Defer JS mode control's notes. */
export const deferModeNotes = (page: Page): Locator => page.locator('#xo-mode-notes-deferJs p');

/** The LazyLoad mode control's accessible name. */
export const LAZYLOAD_MODE_GROUP = 'LazyLoad for images on this page';

/** The LazyLoad mode control's radio group. */
export const lazyloadModeGroup = (page: Page): Locator =>
  page.getByRole('radiogroup', { name: LAZYLOAD_MODE_GROUP });

/** The LazyLoad mode control's notes. */
export const lazyloadModeNotes = (page: Page): Locator => page.locator('#xo-mode-notes-lazyload p');

/** The Delay lane's count/hint/caveat lines (the simulation's count, version and list lines). */
export async function delayLaneLines(page: Page): Promise<string[]> {
  return await lane(page, DELAY)
    .locator('.xo-lane-count, .xo-lane-hint, .xo-lane-caveat')
    .allTextContents();
}

/** The overlay's "Simulated" chip in its header (`header`) or folded pill (`pill`). */
export const simulatedChip = (page: Page, scope: 'header' | 'pill'): Locator =>
  page.locator(`.xo-${scope} [data-indicator="simulated"]`);

/**
 * The simulation markers' `content` in the live document (null mid-navigation).
 *
 * @param page The page.
 */
export async function simulationMarkers(page: Page): Promise<(string | null)[] | null> {
  return await page
    .evaluate(
      (name) =>
        Array.from(document.querySelectorAll(`meta[name="${name}"]`), (meta) =>
          meta.getAttribute('content')
        ),
      SIMULATION_MARKER_META_NAME
    )
    .catch((error: unknown) => {
      // A destroyed context is a navigation in flight: poll again; anything else is real.
      if (error instanceof Error && error.message.includes('Execution context was destroyed'))
        return null;
      throw error;
    });
}

/** The session record fields the suites read (the stored shape, tolerant of the rest). */
interface StoredSession {
  readonly state?: string;
  readonly simulate?: { readonly features?: readonly string[] };
  readonly document?: {
    readonly outcome?: string;
    readonly simulation?: DelaySimulationReport;
    readonly deferSimulation?: DeferSimulationReport;
    readonly lazyloadSimulation?: LazyloadSimulationReport;
  };
}

/**
 * The tab's stored exclusion session (background-owned `session:` storage),
 * or null when the tab has none.
 *
 * @param extension The driver.
 * @param tabId The tab.
 */
export async function storedSession(
  extension: ExtensionDriver,
  tabId: number
): Promise<StoredSession | null> {
  return await extension.evaluateInWorker(
    async ({ key, tab }: { key: string; tab: number }) => {
      const all = (await chrome.storage.session.get(key))[key] as
        Record<string, StoredSession> | undefined;
      return all?.[String(tab)] ?? null;
    },
    { key: SESSIONS_KEY, tab: tabId }
  );
}

/** A stored document's report fields. */
type ReportField = 'simulation' | 'deferSimulation' | 'lazyloadSimulation';

/**
 * One feature's report of the tab's last intercepted document, polled
 * until one exists (the background records it as the reload lands).
 *
 * @param extension The driver.
 * @param tabId The tab.
 * @param field The document's report field (named in the failure).
 * @param read Reads that field off the stored document.
 * @throws {Error} When none is recorded in time.
 */
async function documentReport<Report>(
  extension: ExtensionDriver,
  tabId: number,
  field: ReportField,
  read: (document: NonNullable<StoredSession['document']>) => Report | undefined
): Promise<Report> {
  let report: Report | undefined;
  await expect
    .poll(
      async () => {
        const document = (await storedSession(extension, tabId))?.document;
        report = document === undefined ? undefined : read(document);
        return report !== undefined;
      },
      { timeout: 15_000, intervals: [100, 250, 500] }
    )
    .toBe(true);
  if (report === undefined) throw new Error(`tab ${String(tabId)} has no ${field} report`);
  return report;
}

/**
 * The Delay JS simulation report of the tab's last intercepted document.
 *
 * @param extension The driver.
 * @param tabId The tab.
 */
export async function documentSimulation(
  extension: ExtensionDriver,
  tabId: number
): Promise<DelaySimulationReport> {
  return await documentReport(extension, tabId, 'simulation', (document) => document.simulation);
}

/**
 * The Defer JS simulation report of the tab's last intercepted document.
 *
 * @param extension The driver.
 * @param tabId The tab.
 */
export async function documentDeferSimulation(
  extension: ExtensionDriver,
  tabId: number
): Promise<DeferSimulationReport> {
  return await documentReport(
    extension,
    tabId,
    'deferSimulation',
    (document) => document.deferSimulation
  );
}

/**
 * The LazyLoad simulation report of the tab's last intercepted document.
 *
 * @param extension The driver.
 * @param tabId The tab.
 */
export async function documentLazyloadSimulation(
  extension: ExtensionDriver,
  tabId: number
): Promise<LazyloadSimulationReport> {
  return await documentReport(
    extension,
    tabId,
    'lazyloadSimulation',
    (document) => document.lazyloadSimulation
  );
}

/**
 * Keep the bytes of every main-frame document the page receives (the
 * session's fulfilled response included: the network layer sees what the
 * renderer parses).
 *
 * @param page The page (attach before the navigation under test).
 * @returns A reader of the last received document body.
 */
export function captureDocuments(page: Page): () => Promise<string> {
  let last: Promise<string> | null = null;
  page.on('response', (response: Response) => {
    if (!response.request().isNavigationRequest() || response.frame() !== page.mainFrame()) return;
    last = response.text();
  });
  return async () => {
    if (last === null) throw new Error('no main-frame document was received');
    return await last;
  };
}

/**
 * Collect the page's uncaught errors; `reset` drops what an earlier load threw.
 *
 * @param page The page (attach before navigating).
 */
export function collectPageErrors(page: Page): { readonly errors: string[]; reset: () => void } {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
  return {
    errors,
    reset: () => {
      errors.length = 0;
    }
  };
}

/** A page opened with its errors and documents captured, the overlay in it. */
export interface CapturedBuilder {
  readonly opened: DriverPage;
  readonly errors: ReturnType<typeof collectPageErrors>;
  /** The last main-frame document's bytes. */
  readonly lastDocument: () => Promise<string>;
}

/**
 * Open a page with error + document capture attached before its first
 * navigation, then inject the overlay.
 *
 * @param extension The driver.
 * @param open Opens the page, running `hook` before navigating (`openSitePage` / `openFixturePage`).
 */
export async function openCapturedBuilder(
  extension: ExtensionDriver,
  open: (hook: (page: Page) => void) => Promise<DriverPage>
): Promise<CapturedBuilder> {
  let errors: ReturnType<typeof collectPageErrors> | undefined;
  let lastDocument: (() => Promise<string>) | undefined;
  const opened = await open((page) => {
    errors = collectPageErrors(page);
    lastDocument = captureDocuments(page);
  });
  if (errors === undefined || lastDocument === undefined) {
    throw new Error('openCapturedBuilder: the opener never ran the capture hook');
  }
  await injectOverlay(extension, opened);
  return { opened, errors, lastDocument };
}

/**
 * Pick Simulated and apply from the keyboard: the tab reloads through the
 * session.
 *
 * Keyboard only, never the pointer: a click leaves the cursor over the
 * page, and after the reload the browser may dispatch a synthetic
 * `mouseover`/`mousemove` at that spot (layout under a resting cursor) —
 * an "interaction" WP Rocket's runtime would answer, so a "nothing ran yet"
 * read would race it. With no pointer event ever sent to this page the
 * browser has no cursor position to synthesize from (callers keep the
 * pointer off the page until their "nothing ran yet" reads are done).
 *
 * @param page The page with the overlay.
 * @param groups The mode controls to set to Simulated (default: Delay JS's).
 * @returns The settled header indicator word.
 */
export async function applySimulated(
  page: Page,
  groups: readonly Locator[] = [delayModeGroup(page)]
): Promise<string> {
  for (const group of groups) {
    const simulated = group.getByRole('radio', { name: 'Simulated', exact: true });
    await simulated.focus();
    await page.keyboard.press('Space');
    await expect(simulated).toBeChecked();
  }
  return await reloadThroughSession(page, async () => {
    await applyButton(page).focus();
    await page.keyboard.press('Enter');
  });
}

/** Dispatch the user interaction WP Rocket's Delay JS runtime waits for (pointer moves). */
export async function interact(page: Page): Promise<void> {
  await page.mouse.move(40, 40);
  await page.mouse.move(120, 160);
  await page.mouse.move(200, 220);
}

/** How many scripts a document's bytes hold delayed (WP Rocket's lazy type). */
export function delayedScriptCount(html: string): number {
  return (html.match(/<script\b[^>]*\btype="(?:text\/)?rocketlazyloadscript"/g) ?? []).length;
}

/** Whether a document's bytes carry WP Rocket's Delay JS runtime (its versioned class). */
export function hasDelayRuntime(html: string): boolean {
  return /this\.v="\d+\.\d+\.\d+"/.test(html) && html.includes('RocketLazyLoadScripts');
}

/**
 * A document's bytes with what legitimately differs between WP Rocket's
 * own Delay JS render and the simulated one removed: the generator meta
 * (WP Rocket's) and the simulation marker (the extension's), the
 * speculation rules (every intercepted document drops them), the
 * per-feature `wpr_*` comments and the cache footer.
 *
 * @param html The document's bytes.
 */
export function normalizeDelayRender(html: string): string {
  return html
    .replace(/<meta name="generator" content="WP Rocket[^>]*>/g, '')
    .replace(new RegExp(`<meta name="${SIMULATION_MARKER_META_NAME}"[^>]*>`, 'g'), '')
    .replace(/<script type="speculationrules">[\s\S]*?<\/script>/g, '')
    .replace(/<!-- wpr_[a-z_]+ -->/g, '')
    .replace(/<!-- This website is like a Rocket[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `data-rocket-status="executed"` scripts in the live document. */
export async function executedScriptCount(page: Page): Promise<number> {
  return await page.evaluate(
    () => document.querySelectorAll('script[data-rocket-status="executed"]').length
  );
}

/** The bundled simulation data file (the package's copy, read by the background at runtime). */
const SIMULATION_DATA = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'public',
  'wp-rocket-simulation',
  'simulation-data.json'
);

/**
 * The bundled Delay JS exclusion list of a WP Rocket version, from the
 * shipped data file.
 *
 * @param version The WP Rocket version (a key of the file's `versions`).
 * @throws {Error} When the file has no list for that version.
 */
export function bundledExclusionList(version: string): string[] {
  return bundledList(version, 'delayJsExclusions');
}

/**
 * The bundled Defer JS exclusion lists of a WP Rocket version, from the
 * shipped data file (a fetched latest list carries both beside the Delay
 * JS rows).
 *
 * @param version The WP Rocket version (a key of the file's `versions`).
 * @throws {Error} When the file has no such lists for that version.
 */
export function bundledDeferLists(version: string): { external: string[]; inline: string[] } {
  return {
    external: bundledList(version, 'deferJsExternalExclusions'),
    inline: bundledList(version, 'deferJsInlineExclusions')
  };
}

/** The data file's lists a version entry points at. */
type BundledListName =
  'delayJsExclusions' | 'deferJsExternalExclusions' | 'deferJsInlineExclusions';

/**
 * One bundled list of a WP Rocket version.
 *
 * @param version The WP Rocket version.
 * @param name The version entry's list field.
 * @throws {Error} When the file has no such list for that version.
 */
function bundledList(version: string, name: BundledListName): string[] {
  const data = JSON.parse(readFileSync(SIMULATION_DATA, 'utf8')) as {
    versions: Record<string, Partial<Record<BundledListName, { sha256: string }>> | undefined>;
    rowLists: Record<string, string[] | undefined>;
  };
  const key = data.versions[version]?.[name]?.sha256;
  const rows = key === undefined ? undefined : data.rowLists[key];
  if (rows === undefined) throw new Error(`simulation-data.json has no ${name} for ${version}`);
  return rows;
}

/**
 * Store a latest exclusion list copy the way the background keeps a
 * fetched one, then relaunch the browser on the same profile: the
 * background reads its kept record once per lifetime, and a copy younger
 * than a day is not refreshed — so the session runs this copy and the
 * endpoint is never asked. Call it inside the `try` whose `finally` runs
 * {@link dropLatestList}: a relaunch failing after the write still has the
 * copy dropped.
 *
 * @param extension The driver.
 * @param rows The copy's rows.
 * @param fetchedAt When the copy was "fetched" (epoch ms).
 * @param defer The same document's Defer JS lists (a copy without them is
 *   refreshed at once, as one kept before they existed).
 */
export async function keepLatestList(
  extension: ExtensionDriver,
  rows: readonly string[],
  fetchedAt: number,
  defer: { readonly external: readonly string[]; readonly inline: readonly string[] }
): Promise<void> {
  const sha256 = createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
  await extension.evaluateInWorker(
    async ({ key, record }) => {
      await chrome.storage.local.set({ [key]: record });
    },
    {
      key: LATEST_LIST_KEY,
      record: { copy: { fetchedAt, sha256, rows, defer }, attemptedAt: fetchedAt }
    }
  );
  await extension.relaunch();
}

/**
 * Drop the kept latest list and relaunch: the next background lifetime
 * attempts its refresh (refused by the harness's host block) and keeps
 * only the miss — the state every other suite runs in.
 *
 * @param extension The driver.
 */
export async function dropLatestList(extension: ExtensionDriver): Promise<void> {
  await extension.evaluateInWorker(async (key: string) => {
    await chrome.storage.local.remove(key);
  }, LATEST_LIST_KEY);
  await extension.relaunch();
}

/** The background's kept latest-list record (raw storage). */
export async function latestListRecord(
  extension: ExtensionDriver
): Promise<{ copy?: unknown; attemptedAt?: number; lastMiss?: string } | undefined> {
  return await extension.evaluateInWorker(async (key: string) => {
    return (await chrome.storage.local.get(key))[key] as
      { copy?: unknown; attemptedAt?: number; lastMiss?: string } | undefined;
  }, LATEST_LIST_KEY);
}
