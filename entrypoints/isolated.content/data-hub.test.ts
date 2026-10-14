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
import {
  createCaptureWaitPoint,
  mergeErrorWords,
  processSerializedPage,
  type CaptureWaitPointDeps
} from './data-hub';

const fixture = (name: (typeof FIXTURES)[number]): string =>
  readFileSync(join(FIXTURE_DIR, name), 'utf8');

describe('processSerializedPage', () => {
  it('classifies a WP Rocket page end to end and applies presence propagation', async () => {
    const result = await processSerializedPage(fixture('me-home-cached.html'));
    expect(result.detections.wpr).toMatchObject({ present: true, cached: true });
    expect(result.detections.wpr.version).toMatch(/^\d+\.\d+/);
    // Rows are in the published record shape.
    expect(result.detections.delay_js.scripts.length).toBeGreaterThan(0);
    expect(result.detections.rocket_cdn).toEqual({ present: false });
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
  /** Recording seams: the two triggers fire on demand. */
  function recordingDeps(options: { past: boolean }): {
    deps: CaptureWaitPointDeps;
    fireParserReady(): void;
    fireInvalidated(): void;
  } {
    const parserReady: Array<() => void> = [];
    const invalidated: Array<() => void> = [];
    return {
      deps: {
        pastParserReady: () => options.past,
        registerParserReady: (callback) => {
          parserReady.push(callback);
        },
        registerInvalidated: (callback) => {
          invalidated.push(callback);
        }
      },
      fireParserReady: () => {
        for (const callback of parserReady.splice(0, parserReady.length)) callback();
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

  it('a pending wait releases on the resolve() call, idempotently', async () => {
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

  it('the no-hang pin: invalidation before the parser-ready moment releases the waiter', async () => {
    const seams = recordingDeps({ past: false });
    const point = createCaptureWaitPoint(seams.deps);
    seams.fireInvalidated();
    await expect(point.settled).resolves.toBeUndefined();
  });

  it('the parser-ready trigger releases the wait too, before any invalidation', async () => {
    const seams = recordingDeps({ past: false });
    const point = createCaptureWaitPoint(seams.deps);
    seams.fireParserReady();
    await expect(point.settled).resolves.toBeUndefined();
  });
});
