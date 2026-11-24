/**
 * `pnpm screenshots:release`: shoots every release image of the plan
 * (`scripts/release-shots.ts`) on the real shipped UI — the What's new
 * highlights (`public/whats-new/`, both palettes, WebP), the store set
 * (`store/screenshots/`, PNG; the README embeds it) — over the docker site
 * and the built extension, through this tier's harness (build gate, site
 * baseline gate, blocked remote hosts).
 *
 * Each target restages its surface on fresh pages, so the run is the same
 * whatever ran before; `SHOTS_STAGES=<ids>` re-shoots some stages only. One
 * fresh-profile browser per device scale (What's new at 1×, the store set at
 * 2×), rendering repeatable pixels. The site-facing shots show a showcase page the run creates on the site
 * (and deletes after); with the frozen clock and cache stamp (`./stages.ts`),
 * an unchanged UI re-shoots to the same bytes.
 * Every What's new image prints its WebP and PNG sizes (the format choice's
 * evidence); a PNG that comes out smaller is reported.
 *
 * Local-only (docker site + this machine's Chromium), never CI, never part
 * of `pnpm test:e2e` (its own config: `tests/e2e/capture.config.ts`).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { BrowserContext, Page } from '@playwright/test';

import {
  SHOWCASE_PAGE,
  WEBP_QUALITY,
  captureTargets,
  selectTargets,
  type CaptureTarget
} from '../../../scripts/release-shots';
import { CACHE_TIMESTAMP_PATTERN } from '../../../lib/wp-rocket/constants';
import { ExtensionDriver, test } from '../helpers/extension';
import { SITE_URL } from '../helpers/site';
import { createSitePage, deleteSitePage } from '../helpers/site-wpcli';
import { CACHED_PAGES, settle, STAGES } from './stages';

/** The repository root (this file sits in `tests/e2e/capture/`). */
const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

/** The targets of this run. */
const TARGETS = selectTargets(captureTargets(), process.env.SHOTS_STAGES);

/**
 * Encode a PNG as lossy WebP in the browser (Chromium's own encoder: no
 * image dependency in the repo).
 *
 * @param context The browser context (a scratch page is opened and closed).
 * @param png The PNG bytes.
 * @param quality The WebP quality, 0–1.
 * @returns The WebP bytes.
 * @throws {Error} When the browser produced no WebP.
 */
async function encodeWebp(context: BrowserContext, png: Buffer, quality: number): Promise<Buffer> {
  const page = await context.newPage();
  try {
    const base64 = await page.evaluate(
      async ({ data, q }) => {
        const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const drawing = canvas.getContext('2d');
        if (drawing === null) throw new Error('no 2d context');
        drawing.drawImage(bitmap, 0, 0);
        const blob = await canvas.convertToBlob({ type: 'image/webp', quality: q });
        if (blob.type !== 'image/webp') throw new Error(`encoded ${blob.type}, not WebP`);
        const out = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (const byte of out) binary += String.fromCharCode(byte);
        return btoa(binary);
      },
      { data: png.toString('base64'), q: quality }
    );
    return Buffer.from(base64, 'base64');
  } finally {
    await page.close();
  }
}

/**
 * Write one target's image and print its size line.
 *
 * @param context The browser context (WebP encoding).
 * @param target The target.
 * @param png The shot.
 */
async function writeImage(
  context: BrowserContext,
  target: CaptureTarget,
  png: Buffer
): Promise<void> {
  const file = path.join(ROOT, target.file);
  mkdirSync(path.dirname(file), { recursive: true });
  const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
  if (target.format === 'webp') {
    const webp = await encodeWebp(context, png, WEBP_QUALITY);
    writeFileSync(file, webp);
    const note = png.length < webp.length ? ' — PNG is smaller: reconsider the format' : '';
    console.log(`[shots] ${target.file}: webp ${kb(webp.length)} (png ${kb(png.length)})${note}`);
  } else {
    writeFileSync(file, png);
    console.log(`[shots] ${target.file}: png ${kb(png.length)}`);
  }
}

/**
 * Screenshot options: PNG; finite CSS animations and transitions jump to
 * their end (one a settle missed cannot leave a mid-way frame); the caret
 * is hidden (Playwright's default).
 */
const SHOT = { type: 'png', animations: 'disabled' } as const;

/** Shots taken before two consecutive ones agree: past this, the page never settled. */
const MAX_SHOTS = 6;

/**
 * Shoot the viewport until two consecutive shots are byte-identical: a
 * headless compositor can hand back a frame mid-update (a band of an older
 * frame), which a repeat exposes.
 *
 * @param page The staged page.
 * @returns The settled PNG.
 * @throws {Error} When no two consecutive shots agree.
 */
async function stableShot(page: Page): Promise<Buffer> {
  let previous = await page.screenshot(SHOT);
  for (let shot = 1; shot < MAX_SHOTS; shot += 1) {
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    );
    const next = await page.screenshot(SHOT);
    if (next.equals(previous)) return next;
    previous = next;
  }
  throw new Error(`${page.url()}: no two consecutive shots agreed in ${String(MAX_SHOTS)}`);
}

/** Visits that may pass before a page is served from WP Rocket's cache. */
const WARM_ATTEMPTS = 3;

/**
 * Get a site page into WP Rocket's page cache (a purge — the showcase
 * page's create or delete included — empties it): the first visit renders
 * it live and writes the cached copy; a later one is served from it (its
 * footer carries the cache stamp). A plain desktop request, as the browser's.
 *
 * @param sitePath The site path.
 * @throws {Error} When no visit is served from the cache.
 */
async function warmPage(sitePath: string): Promise<void> {
  const url = `${SITE_URL}${sitePath}`;
  for (let attempt = 0; attempt < WARM_ATTEMPTS; attempt += 1) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} answered ${String(response.status)}`);
    if (CACHE_TIMESTAMP_PATTERN.test(await response.text())) return;
  }
  throw new Error(
    `${url} was not served from WP Rocket's cache after ${String(WARM_ATTEMPTS)} visits`
  );
}

/** One fresh-profile browser per device scale, launched on first use. */
const drivers = new Map<number, ExtensionDriver>();

/**
 * The browser shooting at `scale` (a fresh profile: the fresh-install state).
 *
 * @param scale Device pixels per CSS pixel.
 * @returns The driver.
 */
async function driverFor(scale: number): Promise<ExtensionDriver> {
  const known = drivers.get(scale);
  if (known !== undefined) return known;
  const driver = await ExtensionDriver.launch(
    (profileDir) => {
      rmSync(profileDir, { recursive: true, force: true });
    },
    { deviceScaleFactor: scale, repeatablePixels: true }
  );
  drivers.set(scale, driver);
  return driver;
}

/** The showcase page's id while the run owns it. */
let showcaseId: number | undefined;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  showcaseId = await createSitePage(SHOWCASE_PAGE.slug, SHOWCASE_PAGE.title, SHOWCASE_PAGE.html);
  for (const sitePath of CACHED_PAGES) await warmPage(sitePath);
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  try {
    for (const driver of drivers.values()) await driver.close('teardown');
  } finally {
    drivers.clear();
    if (showcaseId !== undefined) await deleteSitePage(showcaseId);
    showcaseId = undefined;
  }
});

for (const target of TARGETS) {
  test(target.file, async () => {
    const extension = await driverFor(target.scale);
    const staged = await STAGES[target.stage]({
      extension,
      palette: target.palette,
      viewport: target.viewport
    });
    try {
      await staged.page.bringToFront();
      await settle(staged.page);
      const png = await stableShot(staged.page);
      await writeImage(extension.browserContext, target, png);
    } finally {
      await staged.dispose();
    }
  });
}
