/**
 * Suite 3 — Cross-origin sentinel.
 *
 * A script served from the second local origin throws uncaught on a page
 * from the first origin. The browser withholds the error's details
 * (`Script error.`), which is the sentinel path of the undefined-references
 * capture: one fixed word, `__EXTERNAL_ORIGIN_ERROR__`, must reach the
 * isolated world's receiver.
 *
 * Assert surface:
 * - the merged words at the extension's panel seam (`getFdtData` from the
 *   SW) contain the sentinel — the master-#21 resurrection, now pinned on
 *   every run;
 * - the delivery is IMMEDIATE, not debounced: the fixture self-times the
 *   error → window-bridge acknowledgment round trip with page-local clocks
 *   (the receiver acknowledges on arrival), and the harness reads that delta.
 *   The capture's cross-origin path flushes synchronously (the debounce is
 *   500 ms), so the delta must stay far below one debounce period.
 */

import { expect, test } from '../helpers/extension';
import { openFixturePage } from '../helpers/extension';

/** The fixed cross-origin word the capture sends instead of page details. */
const CROSS_ORIGIN_SENTINEL_WORD = '__EXTERNAL_ORIGIN_ERROR__';

/** Synchronous-sentinel headroom: well below the capture's 500 ms debounce. */
const IMMEDIATE_DELTA_LIMIT_MS = 450;

interface SentinelTiming {
  /** performance.now() at the cross-origin throw (page clock). */
  errorAt: number | null;
  /** performance.now() at the receiver's acknowledgment (page clock). */
  ackAt: number | null;
}

const SENTINEL_POLL_OPTIONS: { timeout: number; intervals: number[] } = {
  timeout: 8_000,
  intervals: [100, 100, 250]
};

test.describe('cross-origin sentinel', () => {
  test('the second-origin throw reaches the isolated receiver immediately', async ({
    extension
  }) => {
    const fixture = await openFixturePage(extension, '/errors/cross-origin.html');

    const fdt = await extension.sendToTab<{
      undefinedReferencesOnPage?: string[];
    } | null>(fixture.tabId, 'getFdtData');
    expect(fdt, 'the content script answered the panel pull').not.toBeNull();

    await expect
      .poll(async () => {
        const data = await extension.sendToTab<{ undefinedReferencesOnPage?: string[] } | null>(
          fixture.tabId,
          'getFdtData'
        );
        return data?.undefinedReferencesOnPage;
      }, SENTINEL_POLL_OPTIONS)
      .toEqual([CROSS_ORIGIN_SENTINEL_WORD]);

    const timing = await fixture.page.evaluate((): SentinelTiming => {
      // The fixture stores the two page-clock timestamps as plain window
      // fields (main world); TS needs the cast — the page owns its shape.
      const probe = window as unknown as {
        __sentinelErrorAt: number | null;
        __sentinelAckAt: number | null;
      };
      return {
        errorAt: probe.__sentinelErrorAt,
        ackAt: probe.__sentinelAckAt
      };
    });
    expect(timing.errorAt, 'the fixture recorded the throw').not.toBeNull();
    expect(timing.ackAt, 'the isolated receiver acknowledged the sentinel batch').not.toBeNull();

    const delta = (timing.ackAt ?? Number.POSITIVE_INFINITY) - (timing.errorAt ?? 0);
    expect(
      delta,
      `sentinel round trip ${delta.toFixed(1)} ms must stay below one debounce period (limit: ${String(IMMEDIATE_DELTA_LIMIT_MS)} ms)`
    ).toBeLessThan(IMMEDIATE_DELTA_LIMIT_MS);
  });
});
