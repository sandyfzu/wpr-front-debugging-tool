/**
 * The source-build driver: a second browser context loading the source
 * extension's own unpacked build, for the acceptance tier's parity rounds.
 *
 * Why a second context: a parity round must put the port and the source
 * build on the SAME served fixture and read both panels' rendered state —
 * one Chromium instance per extension install (Chromium refuses a second
 * unpacked extension in one context). Everything here mirrors the main
 * driver's mechanics (`helpers/extension.ts`): persistent context, the
 * load-extension pair, the SW drive plane, unique per-page `e2e-tab` query
 * params, and the first-navigation capture warm-up. The panel page gets the
 * same devtools seam the port's suites use (the shim is imported from
 * `panel-data`), so both builds boot their real fetch over a real fixture
 * tab.
 *
 * The build comes from the source checkout next to this repo
 * (`E2E_SOURCE_REPO` overrides the checkout, `E2E_SOURCE_BUILD_DIR` the
 * unpacked build). When the build is missing or stale (its recorded source
 * HEAD or dirty state differs), `ensureSourceBuild` runs the source repo's
 * own build once and stamps the provenance it was built from; a machine
 * without the checkout skips the parity suite (the receipt records the
 * round as manual).
 *
 * Harness-only: no shipped module imports this file.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';

import { test as extensionTest, ORIGIN_A } from './extension';
import { devtoolsShim, type InspectedResourceStub } from './panel-data';

/**
 * The source checkout: `E2E_SOURCE_REPO` when set; else the sibling of the
 * MAIN checkout (this repo's primary working tree, per git — the worktrees
 * are ephemeral clones whose parents hold nothing), else the local parent.
 *
 * @returns The first existing candidate's path.
 */
function sourceRepoDefault(): string {
  const name = 'wpr-front-debugging-tool-legacy';
  const candidates: string[] = [];
  try {
    const commonDir = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', cwd: import.meta.dirname }
    ).trim();
    // The common dir is the main checkout's `.git`; the checkout's parent
    // holds the sibling (two levels up).
    candidates.push(path.resolve(commonDir, '..', '..', name));
  } catch {
    // No git answer (unusual harness state): only the local sibling remains.
  }
  // The local sibling is the declared floor: a definite string, so the
  // fallback below never needs a non-null read of the array.
  const local = path.resolve(import.meta.dirname, '..', '..', '..', name);
  candidates.push(local);
  return candidates.find((candidate) => existsSync(path.join(candidate, 'package.json'))) ?? local;
}

/** The source checkout, or `E2E_SOURCE_REPO`. */
const SOURCE_REPO = process.env.E2E_SOURCE_REPO ?? sourceRepoDefault();

/** The source checkout's unpacked Chromium build, or `E2E_SOURCE_BUILD_DIR`. */
export const SOURCE_BUILD_PATH =
  process.env.E2E_SOURCE_BUILD_DIR ?? path.join(SOURCE_REPO, '.output', 'chrome-mv3');

/** The stamp file recording which source HEAD a build came from (build-derived data). */
const SOURCE_HEAD_STAMP = path.join(SOURCE_BUILD_PATH, 'source-head.json');

/** Whether the source checkout (and therefore this file's rounds) is available. */
export function sourceRepoAvailable(): boolean {
  return existsSync(path.join(SOURCE_REPO, 'package.json'));
}

/**
 * The source checkout's HEAD, short form.
 *
 * @returns The short hash, or null when the checkout is missing / has none.
 */
export function sourceRepoHead(): string | null {
  try {
    return execFileSync('git', ['-C', SOURCE_REPO, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8'
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Whether the source checkout's working tree is dirty — any staged,
 * unstaged or untracked change (`git status --porcelain` non-empty). A
 * dirty tree can build differently than its HEAD alone says, so it rides
 * the build stamp.
 *
 * @returns True when dirty, or when git answers nothing usable — an unknown
 *   state is never trusted as clean. False only on a provably clean tree.
 */
function sourceRepoDirty(): boolean {
  try {
    return (
      execFileSync('git', ['-C', SOURCE_REPO, 'status', '--porcelain'], {
        encoding: 'utf8'
      }).trim().length > 0
    );
  } catch {
    return true;
  }
}

/**
 * The build-dir's stamped provenance, or nulls when unstamped (a foreign
 * build — its provenance is unknown, so it is rebuilt).
 *
 * @returns The stamped short hash and dirty flag; the flag defaults to
 *   false when a stamp predates it (an old stamp reads as a clean-tree
 *   build — the format stays additive/back-compat).
 */
function stampedProvenance(): { head: string | null; dirty: boolean } {
  try {
    const parsed: unknown = JSON.parse(readFileSync(SOURCE_HEAD_STAMP, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return { head: null, dirty: false };
    const stamp = parsed as { head?: unknown; dirty?: unknown };
    return {
      head: typeof stamp.head === 'string' ? stamp.head : null,
      dirty: stamp.dirty === true
    };
  } catch {
    return { head: null, dirty: false };
  }
}

/** The source build's provenance, after {@link ensureSourceBuild}. */
export interface SourceBuildInfo {
  /** The short source HEAD the round is verified against. */
  readonly head: string;
  /** The unpacked build directory that was loaded. */
  readonly buildDir: string;
  /** Whether this run performed the build (cold) or reused a current one. */
  readonly builtNow: boolean;
}

/**
 * Make sure the source build exists and matches its checkout's working
 * tree, building it (and stamping the HEAD + dirty state) when it does
 * not. The tier runs one worker at a time — no concurrent-build race by
 * construction.
 *
 * @returns The provenance record for the receipt.
 * @throws {Error} When the checkout is missing or answers no HEAD (callers
 *   skip instead of faking a parity round against nothing).
 */
export function ensureSourceBuild(): SourceBuildInfo {
  if (!sourceRepoAvailable())
    throw new Error(`The source checkout is missing: ${SOURCE_REPO} (set E2E_SOURCE_REPO)`);
  const head = sourceRepoHead();
  if (head === null) throw new Error(`The source checkout answers no HEAD: ${SOURCE_REPO}`);
  const stamp = stampedProvenance();
  const dirty = sourceRepoDirty();
  const current =
    existsSync(path.join(SOURCE_BUILD_PATH, 'manifest.json')) &&
    stamp.head === head &&
    stamp.dirty === dirty;
  if (!current) {
    try {
      execFileSync('pnpm', ['build'], { cwd: SOURCE_REPO, stdio: 'pipe', timeout: 240_000 });
    } catch (cause) {
      throw new Error(
        `The source checkout's build failed (checkout: ${SOURCE_REPO}) — build it manually and re-run: ${String(cause)}`
      );
    }
    writeFileSync(SOURCE_HEAD_STAMP, JSON.stringify({ head, dirty }, null, 2));
  }
  return { head, buildDir: SOURCE_BUILD_PATH, builtNow: !current };
}

/**
 * One source-build install over one browser profile — the parity rounds'
 * second extension context. Launch/warm-up mechanics are the main driver's,
 * pointed at the source build.
 */
export class SourceBuildDriver {
  /** The live persistent context. */
  private context!: BrowserContext;

  /** Profile directory on disk; deleted on close. */
  private readonly profileDir: string;

  /** Per-run unique query-key sequence (the main driver's uniqueness rule). */
  private tabIdentitySequence = 0;

  /** The source build's provenance this driver loads. */
  readonly build: SourceBuildInfo;

  /**
   * Create an unlaunched driver over one fresh profile.
   *
   * @param build The build the driver loads (from {@link ensureSourceBuild}).
   */
  private constructor(build: SourceBuildInfo) {
    this.build = build;
    this.profileDir = mkdtempSync(path.join(tmpdir(), 'wpr-fdt-e2e-source-'));
  }

  /** The live context (suites route fixtures and open pages through it). */
  get browserContext(): BrowserContext {
    return this.context;
  }

  /**
   * Launch Chromium with the source build and settle its header capture
   * (the same first-navigation warm-up the main driver performs).
   *
   * @param build The ensured build.
   * @returns The launched driver.
   */
  static async launch(build: SourceBuildInfo): Promise<SourceBuildDriver> {
    const driver = new SourceBuildDriver(build);
    try {
      driver.context = await chromium.launchPersistentContext(driver.profileDir, {
        channel: 'chromium',
        headless: process.env.E2E_HEADED !== '1',
        ignoreDefaultArgs: ['--hide-scrollbars'],
        viewport: { width: 1280, height: 800 },
        timeout: 30_000,
        args: [
          `--disable-extensions-except=${build.buildDir}`,
          `--load-extension=${build.buildDir}`
        ]
      });
    } catch (cause) {
      // No context was handed back, but the fresh profile dir the attempt
      // was given dies with it — an aborted launch never leaks it.
      rmSync(driver.profileDir, { recursive: true, force: true });
      throw new Error(
        `Launching Chromium with the source build timed out or failed after 30 s. source build path: ${build.buildDir}`,
        { cause }
      );
    }
    // The main driver's shape: a launch whose service worker never appears
    // is closed immediately — a half-working context left open hangs the
    // teardown and keeps windows alive, and the fresh profile dies with the
    // failed round.
    try {
      await driver.serviceWorker();
    } catch (cause) {
      try {
        await driver.context.close();
      } catch (closeCause: unknown) {
        console.error(
          `[e2e] closing the browser after the failed source-build launch also failed: ${String(closeCause)}`
        );
      }
      rmSync(driver.profileDir, { recursive: true, force: true });
      throw new Error(
        [
          `The source build's service worker did not appear within 20 s after the launch.`,
          `source build path: ${build.buildDir}`,
          'usual causes: the build has no background entrypoint registered, or the MV3 worker crashed — rebuild it and re-run'
        ].join('\n'),
        { cause }
      );
    }
    await driver.warmUpHeaderCapture();
    return driver;
  }

  /**
   * One throwaway first navigation so the source extension's first real
   * fixture page cannot lose its header capture (same reason as the main
   * driver's warm-up). It must be a real http navigation: about:blank
   * passes no network stack, so the source worker's first listener
   * registration would still race the page that follows.
   */
  private async warmUpHeaderCapture(): Promise<void> {
    const page = await this.context.newPage();
    try {
      await page.goto(`${ORIGIN_A}/`, { waitUntil: 'load', timeout: 10_000 });
    } catch (cause) {
      console.error(
        `[e2e] the source build's capture warm-up page failed to load: ${String(cause)}`
      );
    } finally {
      await page.close();
    }
  }

  /**
   * The source extension's service worker handle.
   *
   * @returns The worker target.
   */
  async serviceWorker(): Promise<Worker> {
    const existing = this.context.serviceWorkers()[0];
    return existing ?? (await this.context.waitForEvent('serviceworker', { timeout: 20_000 }));
  }

  /**
   * The source extension's id (the worker URL's host segment).
   *
   * @returns The id.
   */
  async extensionId(): Promise<string> {
    return new URL((await this.serviceWorker()).url()).host;
  }

  /**
   * Open a fixture page in the source build's browser and resolve its tab id
   * through the source worker's `tabs.query` (the same read-back rule as the
   * main driver).
   *
   * @param urlPath The fixture path below the server root.
   * @param origin The local origin to load from.
   * @returns The page plus its tab id.
   */
  async openFixturePage(urlPath: string, origin: string): Promise<{ page: Page; tabId: number }> {
    const page = await this.context.newPage();
    this.tabIdentitySequence += 1;
    const fullUrl = `${origin}${urlPath}${urlPath.includes('?') ? '&' : '?'}e2e-tab=${String(this.tabIdentitySequence)}`;
    await page.goto(fullUrl, { waitUntil: 'load' });
    const tabId = await (
      await this.serviceWorker()
    ).evaluate(
      (pattern: string) => chrome.tabs.query({ url: pattern }).then((tabs) => tabs[0]?.id ?? null),
      fullUrl
    );
    if (tabId === null)
      throw new Error(`No tab matched ${fullUrl} in the source build's browser — broken round`);
    return { page, tabId };
  }

  /**
   * Open the source build's panel page over one fixture tab, through the
   * same devtools seam the port's suites use (the shim stamps the inspected
   * tab id — and, when given, the resource table the definitions search
   * enumerates).
   *
   * @param fixture The fixture page binding.
   * @param bootHash The panel document's boot hash (the source build's own
   *   route vocabulary, e.g. `#/JavaScriptPage`).
   * @param resources When given, the `inspectedWindow.getResources` stub
   *   answers with them (the definitions search's asset table).
   * @returns The open panel page.
   */
  async openPanel(
    fixture: { readonly tabId: number },
    bootHash: string,
    resources?: readonly InspectedResourceStub[]
  ): Promise<Page> {
    const panel = await this.context.newPage();
    await panel.addInitScript(
      devtoolsShim(
        fixture.tabId,
        resources === undefined
          ? undefined
          : { origin: 'http://localhost:0/', resources: [...resources] }
      )
    );
    await panel.goto(`chrome-extension://${await this.extensionId()}/fdt.html${bootHash}`, {
      waitUntil: 'load'
    });
    return panel;
  }

  /**
   * Close the browser and delete the profile.
   *
   * @param reason Teardown reason (non-default reasons are logged).
   */
  async close(reason: string): Promise<void> {
    await this.context.close();
    rmSync(this.profileDir, { recursive: true, force: true });
    if (reason !== 'teardown') console.error(`[e2e] source-build driver closed: ${reason}`);
  }
}

/**
 * Worker-scoped source-build fixture: the build is ensured and the driver
 * launched once per worker; the same worker's tests route fixtures through
 * its context.
 */
interface SourceBuildFixtures {
  /** The source-build driver (build ensured + launched). */
  readonly source: SourceBuildDriver;
}

/** Marker type: no test-scoped fixture is declared here (the worker ones suffice). */
interface NoSourceTestFixtures {
  readonly none?: undefined;
}

/** The parity suites' test: the main driver's `extension` plus `source`. */
export const sourceTest = extensionTest.extend<NoSourceTestFixtures, SourceBuildFixtures>({
  source: [
    async ({}, use) => {
      const driver = await SourceBuildDriver.launch(ensureSourceBuild());
      await use(driver);
      await driver.close('teardown');
    },
    {
      // Must outlive the whole launch cost it owns — the build budget (240 s,
      // `ensureSourceBuild`) plus the launch/warm-up — so a slow cold build
      // surfaces as its own failure message, never a fixture timeout.
      scope: 'worker',
      timeout: 300_000
    }
  ]
});

/** Re-exported so parity suites do not import from two places. */
export { expect };
