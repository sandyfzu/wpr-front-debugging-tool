/**
 * LazyLoad (images) simulation over real sessions on fixture pages — no WP
 * Rocket, no docker: `fixtures/simulation/lazyload.html` (one image in
 * view, one far below) under the Content Security Policies the fixture
 * server's `/__e2e/csp/<case>` sets, and a page served over https by this
 * suite whose WP Rocket assets URL is http (mixed content).
 *
 * Cases: a policy allowing LazyLoad's scripts but not `data:` images ⇒
 * simulated with that limit named, WP Rocket's script answered by the
 * extension (the fixture server has no such file) and images loaded as
 * they come into view; a policy forbidding LazyLoad's inline options ⇒
 * nothing simulated, the page as served, the policy named; an https page
 * whose LazyLoad script would load over http ⇒ not simulated, the mixed
 * content named.
 *
 * Each case runs in a fresh tab.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';

import { clearDrafts, readBanners } from '../helpers/exclusion-overlay';
import { expect, openFixturePage, test, type ExtensionDriver } from '../helpers/extension';
import {
  applySimulated,
  documentLazyloadSimulation,
  lazyloadModeGroup,
  openCapturedBuilder,
  simulatedChip,
  type CapturedBuilder
} from '../helpers/simulation';
import { clearWidgetMap } from '../helpers/strip-pill';

/** Bounded wait for the page's images after a load or a scroll. */
const LOADED = { timeout: 10_000, intervals: [100, 250, 500] };

/** WP Rocket's LazyLoad script where the fixture origin's WordPress defaults put it. */
const DEFAULT_RUNTIME =
  /^http:\/\/localhost:\d+\/wp-content\/plugins\/wp-rocket\/assets\/js\/lazyload\/[\d.]+\/lazyload\.min\.js$/;

/** The fixture's image (its two copies differ by query). */
const IMAGE_FILE = path.resolve(import.meta.dirname, '..', 'fixtures', 'simulation', 'image.svg');

/**
 * The https page: WP Rocket's beacon block (the assets URL's strongest
 * evidence) names an http, non-loopback host, so LazyLoad's script would
 * load over http — mixed content, which no browser requests. Inline (not a
 * fixture file): the block must abut `</body>` byte for byte.
 */
const MIXED_PAGE =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>LazyLoad mixed content</title></head><body>' +
  '<h1>LazyLoad mixed content</h1><img src="/simulation/image.svg?n=near" alt="near" width="320" height="180">' +
  `<script>var rocket_beacon_data = {}</script><script data-name="wpr-wpr-beacon" src='http://cdn.invalid/wp-content/plugins/wp-rocket/assets/js/wpr-beacon.min.js' async></script></body></html>`;

/** The words the overlay carries. */
const WORDS = {
  placeholders:
    'CSP blocks data: images: placeholders look broken until images load, as on the site.',
  blockedTitle: 'Not simulated: blocked by this page’s Content Security Policy',
  blockedBody:
    'The policy forbids WP Rocket’s LazyLoad script or its inline options, as it would on the site, so no image was lazy loaded',
  mixedTitle: 'Not simulated: LazyLoad’s script would be blocked as mixed content'
} as const;

/** An image of the page, by its alt text. */
const image = (page: Page, alt: string): Locator => page.locator(`img[alt="${alt}"]`);

/** Whether LazyLoad's runtime loaded an image (its class), and its `src` attribute. */
async function loadedImage(page: Page, alt: string): Promise<{ loaded: boolean; src: string }> {
  return await image(page, alt).evaluate((img) => ({
    loaded: img.classList.contains('lazyloaded'),
    src: img.getAttribute('src') ?? ''
  }));
}

/** Open a fixture origin's page with document capture, the overlay injected. */
async function openFixtureBuilder(
  extension: ExtensionDriver,
  urlPath: string,
  origin?: string
): Promise<CapturedBuilder> {
  return await openCapturedBuilder(extension, (hook) =>
    openFixturePage(extension, urlPath, origin, hook)
  );
}

/** A self-signed certificate for `127.0.0.1` (openssl, into a fresh directory). */
function selfSignedCertificate(dir: string): { key: Buffer; cert: Buffer } {
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-days',
        '1',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1'
      ],
      { stdio: 'pipe' }
    );
  } catch (cause) {
    throw new Error('the mixed-content case needs `openssl` on PATH to issue its certificate', {
      cause
    });
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

/**
 * Serve {@link MIXED_PAGE} and the fixture image over https on a free
 * loopback port.
 *
 * @param credentials The server's key and certificate.
 * @returns The listening server and its origin.
 */
async function serveMixedPage(credentials: {
  key: Buffer;
  cert: Buffer;
}): Promise<{ server: Server; origin: string }> {
  const server = createServer(credentials, (request, response) => {
    const url = new URL(request.url ?? '/', 'https://127.0.0.1');
    if (url.pathname === '/') {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      });
      response.end(MIXED_PAGE);
      return;
    }
    if (url.pathname === '/simulation/image.svg') {
      response.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
      response.end(readFileSync(IMAGE_FILE));
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { server, origin: `https://127.0.0.1:${String(port)}` };
}

test.describe('LazyLoad simulation on fixture pages', () => {
  // Each case starts from As served (the overlay restores the origin's saved draft).
  test.beforeEach(async ({ extension }) => {
    await clearDrafts(extension);
    await clearWidgetMap(extension);
  });

  test.afterEach(async ({ extension }) => {
    await clearDrafts(extension);
    await clearWidgetMap(extension);
  });

  test('a policy without data: images: simulated with the placeholders limit named; the script answered by the extension, images loaded into view', async ({
    extension
  }) => {
    const { opened, errors, lastDocument } = await openFixtureBuilder(
      extension,
      '/__e2e/csp/lazyload-placeholders'
    );
    const { page, tabId } = opened;
    try {
      expect(await applySimulated(page, [lazyloadModeGroup(page)])).toBe('Applied');
      const html = await lastDocument();
      const report = await documentLazyloadSimulation(extension, tabId);
      expect(report).toMatchObject({
        state: 'simulated',
        images: 2,
        cspLimits: ['placeholders'],
        assetsUrlSource: 'default',
        delivery: 'external'
      });
      expect(report.runtimeUrl).toMatch(DEFAULT_RUNTIME);
      expect(html).toContain(`src="${String(report.runtimeUrl)}"`);
      await expect(simulatedChip(page, 'header')).toHaveText('Simulated');
      await expect(page.getByText(WORDS.placeholders)).toBeVisible();

      // The fixture server has no such script: the image in view loads only through the extension's copy.
      await expect.poll(async () => (await loadedImage(page, 'near')).loaded, LOADED).toBe(true);
      expect((await loadedImage(page, 'far below')).loaded).toBe(false);
      await image(page, 'far below').scrollIntoViewIfNeeded();
      await expect
        .poll(async () => await loadedImage(page, 'far below'), LOADED)
        .toEqual({ loaded: true, src: '/simulation/image.svg?n=far' });
      expect(errors.errors).toEqual([]);
      await page.getByRole('button', { name: 'Stop' }).click();
    } finally {
      await page.close();
    }
  });

  test('a policy forbidding LazyLoad’s inline options: nothing simulated, the page as served, the policy named', async ({
    extension
  }) => {
    const { opened, lastDocument } = await openFixtureBuilder(
      extension,
      '/__e2e/csp/lazyload-blocked'
    );
    const { page, tabId } = opened;
    try {
      expect(await applySimulated(page, [lazyloadModeGroup(page)])).toBe('Applied');
      const html = await lastDocument();
      expect(await documentLazyloadSimulation(extension, tabId)).toMatchObject({
        state: 'csp-blocked',
        images: 0
      });
      expect(html).not.toContain('lazyLoadOptions');
      expect(html).not.toContain('data-lazy-src');
      const banner = (await readBanners(page)).find((one) => one.title === WORDS.blockedTitle);
      expect(banner?.body).toContain(WORDS.blockedBody);
      // As served: the far image keeps its own source, no runtime marks it.
      expect(await loadedImage(page, 'far below')).toEqual({
        loaded: false,
        src: '/simulation/image.svg?n=far'
      });
      await page.getByRole('button', { name: 'Stop' }).click();
    } finally {
      await page.close();
    }
  });

  test('an https page whose LazyLoad script would load over http: not simulated, the mixed content named', async ({
    extension
  }) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wpr-fdt-e2e-tls-'));
    // The key never outlives the test, whichever step fails.
    try {
      const { server, origin } = await serveMixedPage(selfSignedCertificate(dir));
      try {
        // The suite's certificate is self-signed: this browser lifetime accepts it.
        await extension.relaunch(['--ignore-certificate-errors']);
        const { opened, lastDocument } = await openFixtureBuilder(extension, '/', origin);
        const { page, tabId } = opened;
        try {
          expect(await applySimulated(page, [lazyloadModeGroup(page)])).toBe('Applied');
          const html = await lastDocument();
          expect(await documentLazyloadSimulation(extension, tabId)).toMatchObject({
            state: 'not-applicable',
            reason: 'runtime-mixed-content'
          });
          expect(html).not.toContain('lazyLoadOptions');
          expect(html).not.toContain('data-lazy-src');
          expect((await readBanners(page)).map((banner) => banner.title)).toContain(
            WORDS.mixedTitle
          );
          await page.getByRole('button', { name: 'Stop' }).click();
        } finally {
          await page.close();
        }
      } finally {
        // Back to the tier's own launch arguments for every later suite of this worker.
        await extension.relaunch();
        server.closeAllConnections();
        server.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
