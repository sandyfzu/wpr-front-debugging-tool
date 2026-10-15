/**
 * The captured-header cache guarantee: rows enter only through the shared
 * validator, the cap evicts predictably, and a failing capture can never
 * leave the previous page's rows behind under the new page's tab — plus the
 * response listener's full contract (capture stored per tab, stale rows
 * reset, junk references ignored, and the badge half never entangled with
 * the capture half). The fake `browser` cannot fire `webRequest` events, so
 * the listener body is tested directly as the injected-deps unit it is: the
 * production registration passes the real cache and badge runtime to it.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CachedTabHeaders,
  HEADER_CACHE_CAPACITY,
  handleResponseStarted,
  type HeaderCaptureDeps,
  type HeaderCaptureStore
} from './headers';
import type { BadgeEffect } from './badge';
import { redactPageHeaders } from '../../lib/redaction/headers';
import { PLANTED, PLANTED_RAW_HEADERS } from '../../lib/redaction/planted-secrets.fixtures';
import type { SimMainFrameHook } from './device-simulation';

/** A capture-shaped header list: plain, with missing values, with odd rows. */
const NORMAL_ROWS = [
  { name: 'content-type', value: 'text/html' },
  { name: 'x-cache', value: 'HIT 23' },
  { name: 'age', value: '19' }
];

/** Badge half of the deps: records applied effects; overrides inject failures. */
function badgeHalf(
  applied: Array<BadgeEffect | null>,
  overrides: Partial<HeaderCaptureDeps['badge']> = {}
): HeaderCaptureDeps['badge'] {
  const half: HeaderCaptureDeps['badge'] = {
    navigationStarted: (tabId) => ({ kind: 'clear', tabId }),
    apply: (effect) => {
      applied.push(effect);
      return Promise.resolve();
    }
  };
  return Object.assign(half, overrides);
}

/** Sim half of the deps: records the tabs whose main-frame response arrived. */
function simHalf(navigated: number[], overrides: Partial<SimMainFrameHook> = {}): SimMainFrameHook {
  const half: SimMainFrameHook = {
    mainFrameNavigation: (tabId) => {
      navigated.push(tabId);
      return Promise.resolve();
    }
  };
  return Object.assign(half, overrides);
}

describe('CachedTabHeaders', () => {
  it('stores and serves validated rows per tab', () => {
    const cache = new CachedTabHeaders();
    expect(cache.store(11, NORMAL_ROWS)).toBe(true);
    expect(cache.take(11)).toEqual(NORMAL_ROWS);
  });

  it('serves null for tabs never captured, and for binaries-only captures', () => {
    const cache = new CachedTabHeaders();
    expect(cache.take(42)).toBeNull();
    expect(cache.store(42, undefined)).toBe(false);
    // A response without any header is nothing usable to render from.
    expect(cache.store(42, [])).toBe(true);
    expect(cache.take(42)).toBeNull();
  });

  it('normalizes non-UTF8 rows instead of losing the whole capture', () => {
    const cache = new CachedTabHeaders();
    const rows = [
      { name: 'x-cache', value: 'HIT' },
      // The runtime hands non-renderable values as binaryValue; the value is
      // dropped (not renderable), but the row survives with its name.
      { name: 'x-odd', value: undefined, binaryValue: new Uint8Array([72, 73]) } as never
    ];
    expect(cache.store(7, rows)).toBe(true);
    expect(cache.take(7)).toEqual([{ name: 'x-cache', value: 'HIT' }, { name: 'x-odd' }]);
  });

  it('drops a malformed capture, and empties the tab first', () => {
    const cache = new CachedTabHeaders();
    cache.store(13, NORMAL_ROWS);
    expect(cache.take(13)).toEqual(NORMAL_ROWS);
    // A row with an empty name is no header at all: a shape fault that
    // bounding never repairs — the whole capture rejects.
    expect(cache.store(13, [...NORMAL_ROWS, { name: '', value: 'x' }])).toBe(false);
    // The prior page's rows must not survive for the new capture's tab.
    expect(cache.take(13)).toBeNull();
  });

  it('redacts at capture: no planted secret is stored or served', () => {
    const cache = new CachedTabHeaders();
    expect(cache.store(21, PLANTED_RAW_HEADERS)).toBe(true);
    const served = cache.takeCapture(21);
    expect(served).toEqual({ headers: redactPageHeaders(PLANTED_RAW_HEADERS) });
    expect(JSON.stringify(served)).not.toContain(PLANTED);
    expect(served?.headers).toContainEqual({
      name: 'Set-Cookie',
      redacted: true,
      cookieName: 'wordpress_logged_in_ab'
    });
  });

  it('withholds an over-cap secret whole: no clipped raw prefix survives', () => {
    const cache = new CachedTabHeaders();
    // Longer than the value cap: the rule judges the full value and the
    // row is withheld, so no clipped prefix of the secret is kept either.
    const long = `${'a'.repeat(5_000)}PLANTED_TAIL`;
    cache.store(22, [{ name: 'Authorization', value: long }]);
    expect(cache.takeCapture(22)).toEqual({ headers: [{ name: 'Authorization', redacted: true }] });
  });

  it('rejects a capture with a non-string name instead of crashing the rule', () => {
    const cache = new CachedTabHeaders();
    expect(cache.store(23, [{ name: 42, value: 'x' } as never])).toBe(false);
    expect(cache.take(23)).toBeNull();
  });

  it('bounds an oversize capture instead of dropping it, and marks it truncated', () => {
    const cache = new CachedTabHeaders();
    // More rows than the cap: the first 256 survive, in capture order.
    const flood = Array.from({ length: 300 }, (_, index): { name: string; value: string } => ({
      name: `x-h-${String(index)}`,
      value: 'v'
    }));
    expect(cache.store(13, flood)).toBe(true);
    const bounded = cache.takeCapture(13);
    expect(bounded?.truncated).toBe(true);
    expect(bounded?.headers).toEqual(flood.slice(0, 256));

    // One over-long value (a large CSP) is clipped; every other row stays.
    const bloated = [...NORMAL_ROWS, { name: 'content-security-policy', value: 'x'.repeat(5_000) }];
    expect(cache.store(14, bloated)).toBe(true);
    expect(cache.takeCapture(14)).toEqual({
      headers: [...NORMAL_ROWS, { name: 'content-security-policy', value: 'x'.repeat(4096) }],
      truncated: true
    });

    // Within the caps: no mark at all.
    cache.store(15, NORMAL_ROWS);
    expect(cache.takeCapture(15)).toEqual({ headers: NORMAL_ROWS });
  });

  it('evicts the least recently used tab beyond the cap; reads refresh recency', () => {
    expect(HEADER_CACHE_CAPACITY).toBe(100);
    const cache = new CachedTabHeaders();
    for (let tabId = 1; tabId <= HEADER_CACHE_CAPACITY; tabId += 1) {
      expect(cache.store(tabId, NORMAL_ROWS)).toBe(true);
    }
    cache.take(1); // read counts as use → tab 1 is the most recent
    cache.store(HEADER_CACHE_CAPACITY + 1, NORMAL_ROWS); // 101st tab
    expect(cache.take(1)).toEqual(NORMAL_ROWS);
    expect(cache.take(2)).toBeNull(); // on the queue longer than any read tab
    expect(cache.take(HEADER_CACHE_CAPACITY + 1)).toEqual(NORMAL_ROWS);
  });

  it('forgets a tab explicitly (closed tab, or unparsable page)', () => {
    const cache = new CachedTabHeaders();
    cache.store(5, NORMAL_ROWS);
    cache.forget(5);
    expect(cache.take(5)).toBeNull();
    // Forgetting an absent tab is a no-op, not a crash.
    expect(() => {
      cache.forget(5);
    }).not.toThrow();
  });
});

describe('handleResponseStarted (the webRequest listener body)', () => {
  /** A capture that fails itself, to prove the guard boundaries sit per effect. */
  function brokenCapture(): HeaderCaptureStore {
    return {
      store(): boolean {
        throw new TypeError('cache storage broke');
      }
    };
  }

  it('stores a main-frame capture per tab so it comes back retrievable via the cache', () => {
    const cache = new CachedTabHeaders();
    const applied: Array<BadgeEffect | null> = [];
    handleResponseStarted(
      { tabId: 21, responseHeaders: NORMAL_ROWS },
      { capture: cache, badge: badgeHalf(applied), sim: simHalf([]) }
    );
    // The regression pin for the disconnected-capture bug: a served capture
    // must land in the cache, or the panel's header cards stay dead.
    expect(cache.take(21)).toEqual(NORMAL_ROWS);
  });

  it('a response with no delivered headers resets the tab (previous page loses its rows)', () => {
    const cache = new CachedTabHeaders();
    cache.store(3, NORMAL_ROWS);
    handleResponseStarted({ tabId: 3 }, { capture: cache, badge: badgeHalf([]), sim: simHalf([]) });
    expect(cache.take(3)).toBeNull();
  });

  it('ignores tabless and junk tab references: no capture, no badge, no session removal', () => {
    const cache = new CachedTabHeaders();
    const applied: Array<BadgeEffect | null> = [];
    const navigated: number[] = [];
    for (const tabId of [-1, 1.5, Number.NaN]) {
      handleResponseStarted(
        { tabId, responseHeaders: NORMAL_ROWS },
        { capture: cache, badge: badgeHalf(applied), sim: simHalf(navigated) }
      );
    }
    expect(applied).toHaveLength(0);
    expect(navigated).toHaveLength(0);
  });

  it('a main-frame response signals the end of the simulated session', async () => {
    const cache = new CachedTabHeaders();
    const navigated: number[] = [];
    handleResponseStarted(
      { tabId: 55, responseHeaders: NORMAL_ROWS },
      { capture: cache, badge: badgeHalf([]), sim: simHalf(navigated) }
    );
    // Every main-frame response runs the hook — removal decides inside the
    // sessions (a tab without a session removes an id that is simply absent).
    await vi.waitFor(() => {
      expect(navigated).toEqual([55]);
    });
    expect(cache.take(55)).toEqual(NORMAL_ROWS);
  });

  it('a broken sim hook never costs the capture or the badge', () => {
    const cache = new CachedTabHeaders();
    const applied: Array<BadgeEffect | null> = [];
    const broken = simHalf([], {
      mainFrameNavigation: () => {
        throw new RangeError('sim hook broke');
      }
    });
    handleResponseStarted(
      { tabId: 87, responseHeaders: NORMAL_ROWS },
      { capture: cache, badge: badgeHalf(applied), sim: broken }
    );
    expect(cache.take(87)).toEqual(NORMAL_ROWS);
    expect(applied).toEqual([{ kind: 'clear', tabId: 87 }]);
  });

  it('a wholesale-rejected capture still clears the stale badge (one half never blocks the other)', async () => {
    const cache = new CachedTabHeaders();
    cache.store(9, NORMAL_ROWS);
    const applied: Array<BadgeEffect | null> = [];
    // A malformed row (empty name): the capture is rejected as a whole.
    const malformed = [...NORMAL_ROWS, { name: '', value: 'x' }];
    handleResponseStarted(
      { tabId: 9, responseHeaders: malformed },
      { capture: cache, badge: badgeHalf(applied), sim: simHalf([]) }
    );
    expect(cache.take(9)).toBeNull();
    await vi.waitFor(() => {
      expect(applied).toEqual([{ kind: 'clear', tabId: 9 }]);
    });
  });

  it('a broken capture store keeps the badge clear and the sim hook running', async () => {
    const applied: Array<BadgeEffect | null> = [];
    const navigated: number[] = [];
    handleResponseStarted(
      { tabId: 4, responseHeaders: NORMAL_ROWS },
      { capture: brokenCapture(), badge: badgeHalf(applied), sim: simHalf(navigated) }
    );
    await vi.waitFor(() => {
      expect(applied).toEqual([{ kind: 'clear', tabId: 4 }]);
    });
    await vi.waitFor(() => {
      expect(navigated).toEqual([4]);
    });
  });

  it('a broken badge runtime never costs the capture', () => {
    const cache = new CachedTabHeaders();
    const breaking = badgeHalf([], {
      navigationStarted: () => {
        throw new RangeError('badge broke');
      }
    });
    handleResponseStarted(
      { tabId: 74, responseHeaders: NORMAL_ROWS },
      { capture: cache, badge: breaking, sim: simHalf([]) }
    );
    expect(cache.take(74)).toEqual(NORMAL_ROWS);
  });
});
