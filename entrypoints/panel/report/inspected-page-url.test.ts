/**
 * The inspected-page URL read: a valid http(s) answer passes; every failure
 * shape (no API, DevTools-side error, page exception, junk/oversized/non-web
 * answer, sync throw, timeout) resolves null; `lastError` is always read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PAGE_URL_MAX_LENGTH,
  readInspectedPageUrl,
  realInspectedEvalApi,
  type InspectedEvalApi
} from './inspected-page-url';

afterEach(() => {
  vi.useRealTimers();
});

/** An eval seam answering synchronously with the given callback arguments. */
function answering(result: unknown, exceptionInfo?: unknown): InspectedEvalApi {
  return {
    eval: (_expression, callback) => {
      callback(result, exceptionInfo);
    }
  };
}

const noError = (): undefined => undefined;

describe('readInspectedPageUrl', () => {
  it('returns a valid http(s) URL and evaluates location.href', async () => {
    const seen: string[] = [];
    const api: InspectedEvalApi = {
      eval: (expression, callback) => {
        seen.push(expression);
        callback('https://example.com/a?b=1');
      }
    };
    expect(await readInspectedPageUrl(api, noError)).toBe('https://example.com/a?b=1');
    expect(seen).toEqual(['location.href']);
  });

  it('answers null without a DevTools API', async () => {
    expect(await readInspectedPageUrl(null, noError)).toBeNull();
  });

  it.each([
    ['a page exception', answering(undefined, { isException: true, value: 'x' })],
    ['a non-string answer', answering({ href: 'https://a.test/' })],
    ['a non-web scheme', answering('chrome://settings/')],
    ['a javascript: answer', answering('javascript:alert(1)')],
    ['an oversized answer', answering(`https://a.test/${'x'.repeat(PAGE_URL_MAX_LENGTH)}`)]
  ])('answers null on %s', async (_label, api) => {
    expect(await readInspectedPageUrl(api, noError)).toBeNull();
  });

  it('reads lastError inside the callback and answers null when it is set', async () => {
    const lastError = vi.fn(() => ({ message: 'No tab with id' }));
    expect(await readInspectedPageUrl(answering(undefined), lastError)).toBeNull();
    expect(lastError).toHaveBeenCalledTimes(1);
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
      }
    };
    const pending = readInspectedPageUrl(api, noError, 50);
    vi.advanceTimersByTime(50);
    expect(await pending).toBeNull();
    late?.('https://example.com/');
    expect(await pending).toBeNull();
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

  it('binds the namespace eval when present', () => {
    const evaluate = vi.fn();
    withDevtools({ inspectedWindow: { eval: evaluate } }, () => {
      const callback = vi.fn();
      realInspectedEvalApi()?.eval('location.href', callback);
      expect(evaluate).toHaveBeenCalledWith('location.href', callback);
    });
  });
});
