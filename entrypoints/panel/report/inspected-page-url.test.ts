/**
 * The inspected-page URL read, in every API shape with one evaluation: the
 * callback form answers the (always-passed, lastError-reading) callback; an
 * implementation returning a promise is read from it (Firefox's
 * `[result, exceptionInfo]` pair or a bare result) with no wait; one that
 * refuses the callback argument is retried once without it; every failure shape (no API, DevTools-side
 * error, page exception, rejection, junk/oversized/non-web answer, sync
 * throw, timeout) resolves null; `lastError` is read in the callback.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PAGE_URL_MAX_LENGTH,
  readInspectedPageUrl,
  realInspectedEvalApi,
  type InspectedEvalApi
} from './inspected-page-url';
import type { LastErrorSlot, LastErrorValue } from '../../../utils/last-error';

afterEach(() => {
  vi.useRealTimers();
});

/** A callback-form seam (returns nothing from a callback-less call). */
function callbackForm(result: unknown, exceptionInfo?: unknown): InspectedEvalApi {
  return {
    eval: (_expression, callback) => {
      callback?.(result, exceptionInfo);
      return undefined;
    }
  };
}

/** A promise-form seam resolving (or rejecting) with the given value. */
function promiseForm(settle: () => Promise<unknown>): {
  api: InspectedEvalApi;
  calls: Array<{ expression: string; withCallback: boolean }>;
} {
  const calls: Array<{ expression: string; withCallback: boolean }> = [];
  return {
    api: {
      eval: (expression, callback) => {
        calls.push({ expression, withCallback: callback !== undefined });
        return settle();
      }
    },
    calls
  };
}

/** A runtime whose `lastError` is unset (Chromium's success spelling). */
const noError: LastErrorSlot = {};

/**
 * A runtime whose `lastError` getter returns `value` and counts its reads.
 *
 * @param value The slot's value.
 */
function countingRuntime(value: LastErrorValue): { runtime: LastErrorSlot; reads: () => number } {
  let reads = 0;
  return {
    runtime: {
      get lastError(): LastErrorValue {
        reads += 1;
        return value;
      }
    },
    reads: () => reads
  };
}

describe('readInspectedPageUrl — callback form', () => {
  it('returns a valid http(s) URL and evaluates location.href', async () => {
    const seen: Array<{ expression: string; withCallback: boolean }> = [];
    const api: InspectedEvalApi = {
      eval: (expression, callback) => {
        seen.push({ expression, withCallback: callback !== undefined });
        callback?.('https://example.com/a?b=1');
        return undefined;
      }
    };
    expect(await readInspectedPageUrl(api, noError)).toBe('https://example.com/a?b=1');
    // One evaluation, always with the lastError-reading callback.
    expect(seen).toEqual([{ expression: 'location.href', withCallback: true }]);
  });

  it('answers null without a DevTools API', async () => {
    expect(await readInspectedPageUrl(null, noError)).toBeNull();
  });

  it.each([
    ['a page exception', callbackForm(undefined, { isException: true, value: 'x' })],
    ['a non-string answer', callbackForm({ href: 'https://a.test/' })],
    ['a non-web scheme', callbackForm('chrome://settings/')],
    ['a javascript: answer', callbackForm('javascript:alert(1)')],
    ['an oversized answer', callbackForm(`https://a.test/${'x'.repeat(PAGE_URL_MAX_LENGTH)}`)]
  ])('answers null on %s', async (_label, api) => {
    expect(await readInspectedPageUrl(api, noError)).toBeNull();
  });

  it('reads lastError inside the callback and answers null when it is set', async () => {
    const slot = countingRuntime({ message: 'No tab with id' });
    expect(await readInspectedPageUrl(callbackForm(undefined), slot.runtime)).toBeNull();
    expect(slot.reads()).toBe(1);
  });

  it("treats Firefox's null lastError as success", async () => {
    expect(await readInspectedPageUrl(callbackForm('https://a.test/'), { lastError: null })).toBe(
      'https://a.test/'
    );
  });

  it('answers null when lastError is set, even beside a valid URL', async () => {
    const slot = countingRuntime({ message: 'No tab with id' });
    expect(await readInspectedPageUrl(callbackForm('https://a.test/'), slot.runtime)).toBeNull();
    expect(slot.reads()).toBe(1);
  });

  it('answers null when lastError is set without a message', async () => {
    // A set error is a failure whatever it carries; it must not read as success.
    const slot = countingRuntime({});
    expect(await readInspectedPageUrl(callbackForm('https://a.test/'), slot.runtime)).toBeNull();
    expect(slot.reads()).toBe(1);
  });

  it('answers null when the eval cannot start', async () => {
    const api: InspectedEvalApi = {
      eval: () => {
        throw new Error('detached');
      }
    };
    expect(await readInspectedPageUrl(api, noError)).toBeNull();
  });

  it('answers null at the deadline, and ignores a late answer', async () => {
    vi.useFakeTimers();
    let late: ((result: unknown) => void) | undefined;
    const api: InspectedEvalApi = {
      eval: (_expression, callback) => {
        late = callback;
        return undefined;
      }
    };
    const pending = readInspectedPageUrl(api, noError, 50);
    vi.advanceTimersByTime(50);
    expect(await pending).toBeNull();
    late?.('https://example.com/');
    expect(await pending).toBeNull();
  });
});

describe('readInspectedPageUrl — promise form', () => {
  it("takes Firefox's [result, exceptionInfo] pair from the returned promise, with no wait", async () => {
    vi.useFakeTimers();
    const form = promiseForm(() => Promise.resolve(['https://example.com/ff', undefined]));
    const url = await readInspectedPageUrl(form.api, noError);
    expect(url).toBe('https://example.com/ff');
    // One evaluation: the callback was accepted (ignored), the promise answered.
    expect(form.calls).toEqual([{ expression: 'location.href', withCallback: true }]);
    // Settled without advancing any timer, and none left armed.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts a bare resolved result', async () => {
    const form = promiseForm(() => Promise.resolve('https://example.com/bare'));
    expect(await readInspectedPageUrl(form.api, noError)).toBe('https://example.com/bare');
  });

  it.each([
    ['an exception in the pair', () => Promise.resolve([undefined, { isException: true }])],
    ['a rejection', () => Promise.reject(new Error('No tab'))],
    ['an undefined-reason rejection', () => Promise.reject(undefined as unknown as Error)],
    ['a junk result', () => Promise.resolve(['ftp://a.test/', undefined])],
    ['a null exception slot with junk', () => Promise.resolve([42, null])]
  ])('answers null on %s', async (_label, settle) => {
    expect(await readInspectedPageUrl(promiseForm(settle).api, noError)).toBeNull();
  });
});

describe('readInspectedPageUrl — a form that refuses the callback argument', () => {
  /** A strict promise-only seam: a callback argument throws synchronously. */
  function strict(answer: () => unknown): {
    api: InspectedEvalApi;
    calls: boolean[];
  } {
    const calls: boolean[] = [];
    return {
      api: {
        eval: (_expression, callback) => {
          calls.push(callback !== undefined);
          if (callback !== undefined) throw new TypeError('Incorrect argument types');
          return answer();
        }
      },
      calls
    };
  }

  it('retries once without the callback and reads the promise', async () => {
    const form = strict(() => Promise.resolve(['https://example.com/strict', undefined]));
    expect(await readInspectedPageUrl(form.api, noError)).toBe('https://example.com/strict');
    expect(form.calls).toEqual([true, false]);
  });

  it('answers null at once when the retry returns no promise', async () => {
    vi.useFakeTimers();
    const form = strict(() => undefined);
    expect(await readInspectedPageUrl(form.api, noError)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('answers null when the retry throws too', async () => {
    const form = strict(() => {
      throw new Error('detached');
    });
    expect(await readInspectedPageUrl(form.api, noError)).toBeNull();
  });
});

describe('realInspectedEvalApi', () => {
  /** The test browser's namespace slot, swapped per test and restored. */
  const target = browser as unknown as { devtools?: unknown };

  /**
   * Run with the namespace slot replaced.
   *
   * @param value The stand-in namespace.
   * @param body The assertions.
   */
  function withDevtools(value: unknown, body: () => void): void {
    const original = target.devtools;
    target.devtools = value;
    try {
      body();
    } finally {
      target.devtools = original;
    }
  }

  it('is null where the DevTools namespace or its eval is absent', () => {
    withDevtools(undefined, () => {
      expect(realInspectedEvalApi()).toBeNull();
    });
    withDevtools({ inspectedWindow: {} }, () => {
      expect(realInspectedEvalApi()).toBeNull();
    });
  });

  it('forwards exactly the arguments given (no callback → none passed) and the return value', () => {
    const evaluate = vi.fn((...args: unknown[]) => (args.length > 0 ? 'returned' : 'unreachable'));
    withDevtools({ inspectedWindow: { eval: evaluate } }, () => {
      const api = realInspectedEvalApi();
      expect(api?.eval('location.href')).toBe('returned');
      expect(evaluate).toHaveBeenLastCalledWith('location.href');
      expect(evaluate.mock.lastCall).toHaveLength(1);
      const callback = vi.fn();
      api?.eval('location.href', callback);
      expect(evaluate).toHaveBeenLastCalledWith('location.href', callback);
    });
  });
});
