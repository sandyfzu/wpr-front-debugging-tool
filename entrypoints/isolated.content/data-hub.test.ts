/**
 * The data hub's logic half: the processing pass runs the real detection
 * engine over a committed corpus fixture (pinned shapes, presence propagation
 * included, one parse per pass) and the word-merge keeps first-occurrence
 * order under the protocol cap. The messaging/listener wiring is entrypoint
 * glue and stays out of scope here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type FIXTURES, FIXTURE_DIR } from '../../lib/detection/fixtures/corpus';
import { boundPageHeaders, PAYLOAD_LIMITS } from '../../lib/messaging/payload-bounds';
import { redactPageHeaders } from '../../lib/redaction/headers';
import { redactPageDataForExport } from '../../lib/redaction/page-data';
import { PLANTED, PLANTED_RAW_HEADERS } from '../../lib/redaction/planted-secrets.fixtures';
import { parseFdtData } from '../../lib/messaging/validate';
import {
  composeFdtData,
  createCaptureWaitPoint,
  mergeErrorWords,
  processSerializedPage,
  servedDetections,
  type CaptureWaitPointDeps,
  type LivePageFacts
} from './data-hub';

const fixture = (name: (typeof FIXTURES)[number]): string =>
  readFileSync(join(FIXTURE_DIR, name), 'utf8');

describe('processSerializedPage', () => {
  it('classifies a WP Rocket page end to end and applies presence propagation', async () => {
    const result = await processSerializedPage(fixture('me-home-cached.html'));
    expect(result.detections.wpr).toMatchObject({
      present: true,
      cacheMarkerFound: true,
      cached: true
    });
    expect(result.detections.wpr.version).toMatch(/^\d+\.\d+/);
    // Rows are in the published record shape.
    expect(result.detections.delay_js.scripts.length).toBeGreaterThan(0);
    expect(result.detections.rocket_cdn).toEqual({ present: false, source: 'meta' });
    expect(result.preloadedResources).toEqual({
      present: true,
      resources: [
        { href: 'https://wp-rocket.me/wp-content/uploads/2022/02/Img.svg', type: 'image' }
      ]
    });
    // A page without a diagnoser print leaves both slots null.
    expect(result.diagnoserData).toEqual({ noRocketData: null, rocketData: null });
  });

  it('shares one parsed tree across every consumer (no re-parse per pass)', async () => {
    // The timing budget rides on this: parsePage runs once, and the engine,
    // the preloaded-resources check and the diagnoser extraction all read the
    // same tree.
    const html = fixture('me-support-cdn.html');
    const original = globalThis.DOMParser;
    let parsedCount = 0;
    class CountingParser extends original {
      constructor(...args: ConstructorParameters<typeof DOMParser>) {
        super(...args);
        parsedCount += 1;
      }
    }
    globalThis.DOMParser = CountingParser;
    try {
      await processSerializedPage(html);
    } finally {
      globalThis.DOMParser = original;
    }
    expect(parsedCount).toBe(1);
  });

  it('extracts a repairable diagnoser print (malformed JSON tolerated)', async () => {
    // jsonrepair's tolerance covers the plugin's realistic corruption shapes
    // (single quotes, trailing commas) — arbitrary garbage still fails the
    // slot to null, which the panel renders explicitly.
    const html = `${fixture('psi-shell.html')}<script id="wpr-diagnoser-rocket-json-data" type="application/json">{'options': {},}</script>`;
    const result = await processSerializedPage(html);
    expect(result.diagnoserData?.rocketData).toEqual({ options: {} });
    const garbage = `${fixture('psi-shell.html')}<script id="wpr-diagnoser-rocket-json-data" type="application/json">{broken,</script>`;
    expect((await processSerializedPage(garbage)).diagnoserData?.rocketData).toBeNull();
  });
});

describe('mergeErrorWords', () => {
  it('appends unseen words in first-occurrence order', () => {
    expect(mergeErrorWords(['a', 'b'], ['c', 'b', 'd'])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('never grows past the protocol cap (50 words total)', () => {
    const first = Array.from({ length: 40 }, (_, i) => `w${String(i)}`);
    const second = Array.from({ length: 40 }, (_, i) => `n${String(i)}`);
    const merged = mergeErrorWords(first, second);
    expect(merged).toHaveLength(50);
    expect(merged.at(-1)).toBe('n9');
  });

  it('does not mutate the caller\u2019s list', () => {
    const existing = ['a'];
    mergeErrorWords(existing, ['b']);
    expect(existing).toEqual(['a']);
  });
});

describe('createCaptureWaitPoint', () => {
  /** Recording seams: the teardown trigger fires on demand. */
  function recordingDeps(options: { past: boolean }): {
    deps: Pick<CaptureWaitPointDeps, 'pastParserReady' | 'registerInvalidated'>;
    fireInvalidated(): void;
  } {
    const invalidated: Array<() => void> = [];
    return {
      deps: {
        pastParserReady: () => options.past,
        registerInvalidated: (callback) => {
          invalidated.push(callback);
        }
      },
      fireInvalidated: () => {
        for (const callback of invalidated.splice(0, invalidated.length)) callback();
      }
    };
  }

  it('a past parser-ready moment settles the waiter immediately', async () => {
    const point = createCaptureWaitPoint(recordingDeps({ past: true }).deps);
    await expect(point.settled).resolves.toBeUndefined();
  });

  it('a pending wait releases on the caller’s resolve() call, idempotently', async () => {
    const seams = recordingDeps({ past: false });
    const point = createCaptureWaitPoint(seams.deps);
    const settled = point.settled;
    expect(await Promise.race([settled.then(() => 'released'), Promise.resolve('pending')])).toBe(
      'pending'
    );
    point.resolve();
    point.resolve();
    await expect(settled).resolves.toBeUndefined();
  });

  it('the no-hang pin: invalidation before the caller’s capture releases the waiter', async () => {
    const seams = recordingDeps({ past: false });
    const point = createCaptureWaitPoint(seams.deps);
    seams.fireInvalidated();
    await expect(point.settled).resolves.toBeUndefined();
  });

  it('the wait stays pending while neither the caller’s resolve nor invalidation ran', async () => {
    const seams = recordingDeps({ past: false });
    const point = createCaptureWaitPoint(seams.deps);
    expect(
      await Promise.race([point.settled.then(() => 'released'), Promise.resolve('pending')])
    ).toBe('pending');
    point.resolve();
    await expect(point.settled).resolves.toBeUndefined();
  });
});

/** A page carrying `count` attributed LCP-image preloads (the critical-images list). */
function pageWithPreloadedImages(count: number, cacheStamp = '1727000000'): string {
  const links = Array.from(
    { length: count },
    (_, i) =>
      `<link rel="preload" as="image" data-rocket-preload href="https://example.test/lcp-${String(i)}.jpg">`
  ).join('');
  return `<!doctype html><html><head>${links}</head><body></body></html><!-- This website is like a Rocket, isn't it? Debug: cached@${cacheStamp} -->`;
}

const LIVE: LivePageFacts = {
  allScriptsLoaded: false,
  headerCapture: null,
  undefinedReferences: [],
  cookies: null,
  bypassAttested: false
};

describe('composeFdtData — oversize pages still yield a payload the panel accepts', () => {
  const cap = PAYLOAD_LIMITS.preloadedImages.count;

  for (const count of [cap - 1, cap, cap + 1, 1226]) {
    it(`${String(count)} preloaded images`, async () => {
      const data = await processSerializedPage(pageWithPreloadedImages(count));
      // The pass result stays whole for same-context readers.
      expect(data.detections.rocket_above_the_fold_optimization.preloadedImages).toHaveLength(
        count
      );
      const parsed = parseFdtData(composeFdtData(data, LIVE));
      expect(parsed).not.toBeNull();
      const row = parsed?.wprDetections.rocket_above_the_fold_optimization;
      expect(row?.preloadedImages).toHaveLength(Math.min(count, cap));
      expect(row?.truncated === true).toBe(count > cap);
      // The resources report carries the same links, under its own (higher) cap.
      expect(parsed?.preloadedResources.resources).toHaveLength(count);
    });
  }

  it('normalizes a cache stamp too long for a number to null (finite-only contract)', async () => {
    const data = await processSerializedPage(pageWithPreloadedImages(1, '9'.repeat(400)));
    expect(data.detections.wpr).toMatchObject({
      present: true,
      cacheMarkerFound: true,
      cached: true,
      timeStamp: null
    });
    expect(parseFdtData(composeFdtData(data, LIVE))).not.toBeNull();
  });

  it('carries the bypass attestation only when the capture saw it', async () => {
    const data = await processSerializedPage(pageWithPreloadedImages(1));
    expect(composeFdtData(data, { ...LIVE, bypassAttested: true })).toMatchObject({
      bypassAttested: true
    });
    expect('bypassAttested' in composeFdtData(data, LIVE)).toBe(false);
  });

  it('carries the live facts and omits cookies only when none were captured', async () => {
    const data = await processSerializedPage(pageWithPreloadedImages(1));
    const cookies = { names: ['wprocket'], capturedAt: 1 };
    const payload = composeFdtData(data, {
      allScriptsLoaded: true,
      headerCapture: { headers: [{ name: 'x-cache', value: 'HIT' }] },
      undefinedReferences: ['jQuery'],
      cookies,
      bypassAttested: false
    });
    expect(payload).toMatchObject({
      allScriptsLoaded: true,
      pageHeaders: [{ name: 'x-cache', value: 'HIT' }],
      undefinedReferencesOnPage: ['jQuery'],
      cookies
    });
    expect('cookies' in composeFdtData(data, LIVE)).toBe(false);
    expect('pageHeadersTruncated' in payload).toBe(false);
  });

  it('serves no planted secret: the capture arrives redacted and stays so through the panel and the export', async () => {
    const data = await processSerializedPage(pageWithPreloadedImages(1));
    // The capture exactly as the background serves it: redacted, then bounded.
    const served = boundPageHeaders(redactPageHeaders(PLANTED_RAW_HEADERS));
    const payload = composeFdtData(data, { ...LIVE, headerCapture: served });
    expect(JSON.stringify(payload)).not.toContain(PLANTED);
    const parsed = parseFdtData(payload);
    expect(parsed?.pageHeaders).toEqual(served.headers);
    expect(JSON.stringify(redactPageDataForExport(payload))).not.toContain(PLANTED);
  });

  it('carries the header capture list-level mark to the payload', async () => {
    const data = await processSerializedPage(pageWithPreloadedImages(1));
    const payload = composeFdtData(data, {
      ...LIVE,
      headerCapture: { headers: [{ name: 'csp', value: 'x' }], truncated: true }
    });
    expect(payload.pageHeadersTruncated).toBe(true);
    expect(parseFdtData(payload)).toMatchObject({ pageHeadersTruncated: true });
  });

  it('bounds the preloaded-resources report (5,001 links → 5,000, marked)', async () => {
    // Attributed non-image preloads: they feed the resources report only,
    // so this leg isolates its own bound from the critical-images list.
    const cap = PAYLOAD_LIMITS.preloaded.count;
    const links = Array.from(
      { length: cap + 1 },
      (_, i) => `<link rel="preload" as="script" data-rocket-preload href="/s-${String(i)}.js">`
    ).join('');
    const data = await processSerializedPage(`<!doctype html><html><head>${links}</head></html>`);
    expect(data.preloadedResources.resources).toHaveLength(cap + 1);
    const parsed = parseFdtData(composeFdtData(data, LIVE));
    expect(parsed?.preloadedResources.resources).toHaveLength(cap);
    expect(parsed?.preloadedResources.truncated).toBe(true);
  });
});

describe('servedDetections — the getWprDetections reply', () => {
  it('bounds the detections exactly like the panel payload', async () => {
    const cap = PAYLOAD_LIMITS.preloadedImages.count;
    const data = await processSerializedPage(pageWithPreloadedImages(cap + 1));
    const served = servedDetections(data);
    expect(served.rocket_above_the_fold_optimization.preloadedImages).toHaveLength(cap);
    expect(served.rocket_above_the_fold_optimization.truncated).toBe(true);
    expect(served).toEqual(composeFdtData(data, LIVE).wprDetections);
  });
});
