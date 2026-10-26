/**
 * The Exclusion Builder's document marker through the real data hub, in
 * real Chromium, on the real site's markup.
 *
 * The rewrite appends its marker at the end of `<head>`; the data hub reads
 * a serialized snapshot of the live document. WP Rocket's LazyLoad head
 * carries `<noscript><style id="rocket-lazyload-nojs-css">…</noscript>`,
 * which the live (scripting-on) document holds as text: once serialized and
 * re-parsed, that text closes `<head>` early and the marker lands in
 * `<body>`. A stray element in `<head>` moves it there even in the live
 * document. The fact must still reach the payload. And a served copy whose
 * name is spelled with character references is a marker to the DOM, so the
 * rewrite must remove it.
 *
 * Each case serves the real `/fdt/` HTML (fetched read-only from the site)
 * through a route on a unique site URL — the page is never rewritten on the
 * site itself — with the marker written by the real writer.
 *
 * Assert surface: the `getFdtData` payload's `wprDetections` rows.
 */

import { writeBuilderMarker } from '../../../lib/exclusion-builder/builder-marker-write';
import type { WprDetections } from '../../../lib/wp-rocket/types';
import { BUILDER_MARKER_META_NAME } from '../../../lib/wp-rocket/constants';
import { expect, test, type ExtensionDriver } from '../helpers/extension';
import { openSitePage, SITE_URL } from '../helpers/site';

/** WP Rocket's LazyLoad no-JS style id: the head `<noscript>` the cases depend on. */
const LAZYLOAD_NOJS_STYLE = 'rocket-lazyload-nojs-css';

/** The note every case writes. */
const NOTE = { delay_js: { off: 'feature' } } as const;

/** The real `/fdt/` HTML, as the site serves it. */
async function servedFdtHtml(extension: ExtensionDriver): Promise<string> {
  const response = await extension.browserContext.request.get(`${SITE_URL}/fdt/`);
  expect(response.ok(), `GET ${SITE_URL}/fdt/ answered ${String(response.status())}`).toBe(true);
  const html = await response.text();
  const head = html.slice(0, html.search(/<\/head\s*>/i));
  // The case depends on WP Rocket's head noscript; fail loudly if the site lost it.
  expect(head, 'the served head carries the LazyLoad noscript style').toContain(
    LAZYLOAD_NOJS_STYLE
  );
  expect(head).toMatch(/<noscript>/i);
  return html;
}

/**
 * Serve `html` at a unique site URL, open it, and wait for the hub's payload.
 *
 * @returns The served detections.
 */
async function detectionsFor(
  extension: ExtensionDriver,
  html: string,
  label: string
): Promise<WprDetections> {
  const url = `${SITE_URL}/fdt/?fdt-builder-marker=${label}-${String(Date.now())}`;
  await extension.browserContext.route(url, async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });
  const page = await openSitePage(extension, url);
  try {
    const latest: { detections: WprDetections | null } = { detections: null };
    await expect
      .poll(
        async () => {
          const fdt = await extension
            .sendToTab<{ wprDetections: WprDetections } | null>(page.tabId, 'getFdtData')
            .catch(() => null);
          latest.detections = fdt?.wprDetections ?? null;
          return latest.detections !== null;
        },
        { timeout: 10_000, intervals: [100, 250, 500] }
      )
      .toBe(true);
    if (latest.detections === null) throw new Error(`no payload for ${url}`);
    return latest.detections;
  } finally {
    await page.page.close();
    await extension.browserContext.unroute(url);
  }
}

test.describe('site builder marker', () => {
  test('the fact reaches the payload on a WP Rocket LazyLoad head (marker moved to body)', async ({
    extension
  }) => {
    const served = await servedFdtHtml(extension);
    const rewritten = writeBuilderMarker(served, NOTE);
    // The real writer put it just before </head>, after the noscript.
    const markerAt = rewritten.indexOf(`name="${BUILDER_MARKER_META_NAME}"`);
    expect(markerAt).toBeGreaterThan(rewritten.indexOf(LAZYLOAD_NOJS_STYLE));
    expect(markerAt).toBeLessThan(rewritten.search(/<\/head\s*>/i));

    const detections = await detectionsFor(extension, rewritten, 'noscript');
    expect(detections.delay_js.builder).toEqual({ off: 'feature' });
    // The served verdict is untouched by the fact.
    expect(detections.delay_js.present).toBe(true);
  });

  test('the fact reaches the payload when a stray element closed the head early', async ({
    extension
  }) => {
    const served = await servedFdtHtml(extension);
    const stray = served.replace(/<head\b[^>]*>/i, (open) => `${open}<div id="fdt-stray"></div>`);
    expect(stray).toContain('fdt-stray');
    const detections = await detectionsFor(extension, writeBuilderMarker(stray, NOTE), 'stray');
    expect(detections.delay_js.builder).toEqual({ off: 'feature' });
  });

  test('a served copy named with character references is a marker to the DOM, and is removed', async ({
    extension
  }) => {
    const served = await servedFdtHtml(extension);
    const spoof = `<meta name="wpr-fdt-exclusion&#45;builder" content="v1 lazyload=excluded:9">`;
    const withSpoof = served.replace(/<\/head\s*>/i, (close) => `${spoof}${close}`);
    // Left in place, the DOM decodes the name and reads it as the one marker…
    const kept = await detectionsFor(extension, withSpoof, 'spoof-kept');
    expect(kept.lazyload.builder).toEqual({ excluded: 9 });
    // …so the rewrite removes it, even when it has nothing of its own to say.
    const cleared = await detectionsFor(extension, writeBuilderMarker(withSpoof, {}), 'spoof-gone');
    expect(cleared.lazyload).not.toHaveProperty('builder');
    expect(cleared.delay_js).not.toHaveProperty('builder');
  });
});
