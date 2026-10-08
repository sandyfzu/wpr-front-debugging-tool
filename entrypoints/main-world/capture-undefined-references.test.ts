/**
 * Behavior pins for the page-world capture:
 *
 * - the extraction matrix (the three shapes, priority, nesting, line-local
 *   matching, absence) over real error shapes and the exact wire forms;
 * - batching with fake timers: the dedupe ledger (page identifiers only — the
 *   cross-origin sentinel never shares it), debounce restart, word and batch
 *   caps, the immediate cross-origin sentinel and its cancel-then-flush
 *   timing, cleanup;
 * - one composed flow over the real window bridge (real timers, a fresh
 *   receiver messenger under the shared namespace) — words actually cross the
 *   boundary and come back acknowledged.
 *
 * Data fidelity: batching tests drive real `Error` objects so stacks are
 * whatever the runtime really produces; only hostile/control-character rows
 * are hand-built and labeled as such.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineWindowMessaging } from '@webext-core/messaging/page';
import {
  CROSS_ORIGIN_ERROR_MESSAGE,
  CROSS_ORIGIN_ERROR_WORD,
  WINDOW_BRIDGE_NAMESPACE,
  type WindowProtocolMap
} from '../../lib/messaging/window-bridge';
import { ERROR_WORD_LIMITS } from '../../lib/messaging/error-words';
import {
  DEFAULT_FLUSH_DELAY_MS,
  extractUndefinedReference,
  startUndefinedReferenceCapture,
  type UndefinedReferenceCaptureDeps
} from './capture-undefined-references';

/*
 * The sentinel strings are contract-facing literals: the matching message is
 * what browsers deliver for cross-origin script errors and the word is what
 * the panel renders. Pin them here so neither half can drift silently.
 */
describe('cross-origin contract constants', () => {
  it('the recognized message and its wire word are the exact literals', () => {
    expect(CROSS_ORIGIN_ERROR_MESSAGE).toBe('Script error.');
    expect(CROSS_ORIGIN_ERROR_WORD).toBe('__EXTERNAL_ORIGIN_ERROR__');
  });
});

/**
 * Throw a page `error` with the given thrown value, exactly as script errors
 * arrive in the page world (through a real window event).
 */
const pageError = (thrownValue: unknown, message = ''): void => {
  window.dispatchEvent(new ErrorEvent('error', { message, error: thrownValue }));
};

/**
 * Fire an `unhandledrejection` with the given reason. `unhandledrejection`
 * events deliver a `reason` property on an event of the standard type; the
 * double mirrors that shape without waiting on a real un-handled promise.
 */
const pageRejection = (reason: unknown): void => {
  const event = new Event('unhandledrejection');
  Object.defineProperty(event, 'reason', { value: reason, configurable: true });
  window.dispatchEvent(event);
};

/** A capture over the real window whose flushed batches are echoed into `sends`. */
const startRecording = (
  overrides: Partial<UndefinedReferenceCaptureDeps> = {}
): { sends: string[][]; stop: () => void } => {
  const sends: string[][] = [];
  const stop = startUndefinedReferenceCapture({
    sendBatch: (words) => {
      sends.push(words);
    },
    ...overrides
  });
  return { sends, stop };
};

describe('extractUndefinedReference', () => {
  it('ReferenceError: the identifier is the undefined reference', () => {
    expect(extractUndefinedReference('ReferenceError: jQuery is not defined')).toBe('jQuery');
  });

  it('property read on undefined: the reading key is the reference', () => {
    expect(
      extractUndefinedReference(
        "TypeError: Cannot read properties of undefined (reading 'theForm')"
      )
    ).toBe('theForm');
  });

  it('not-a-function chain reduces to its last segment (nested paths)', () => {
    expect(extractUndefinedReference('TypeError: window.foo.bar is not a function')).toBe('bar');
    expect(extractUndefinedReference('TypeError: myFn is not a function')).toBe('myFn');
  });

  it('multi-line stacks: the capture is line-local, anywhere in the text', () => {
    // A stack as browsers build one: message line first, frames after.
    expect(
      extractUndefinedReference('ReferenceError: foo is not defined\n    at bar.js:2:13')
    ).toBe('foo');
    // A pattern embedded mid-stack (re-thrown error text inside a frame) still captures.
    expect(
      extractUndefinedReference(
        '    at log (a.js:1:1)\nTypeError: evalThing is not a function\n    at b.js:2:2'
      )
    ).toBe('evalThing');
    // Phrasing broken across lines is not a match (`.` cannot cross lines).
    expect(extractUndefinedReference('ReferenceError: foo is not\ndefined')).toBeNull();
  });

  it('pattern priority: the earlier pattern family wins', () => {
    expect(
      extractUndefinedReference(
        "ReferenceError: alpha is not defined\nTypeError: Cannot read properties of undefined (reading 'beta')"
      )
    ).toBe('alpha');
    expect(
      extractUndefinedReference(
        "TypeError: Cannot read properties of undefined (reading 'beta')\nTypeError: beta is not a function"
      )
    ).toBe('beta');
  });

  it('no shape, no word', () => {
    expect(
      extractUndefinedReference('SyntaxError: Unexpected token < in JSON at position 0')
    ).toBeNull();
    expect(
      extractUndefinedReference('TypeError: Cannot convert undefined or null to object')
    ).toBeNull();
    expect(extractUndefinedReference('')).toBeNull();
  });

  it('an empty capture is no word (the guard falls through to nothing)', () => {
    // Double space: the pattern matches with an identifier-less capture.
    expect(extractUndefinedReference('ReferenceError:  is not defined')).toBeNull();
  });
});

describe('batching (fake timers, recorded sink)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('one identifier waits out its quiet period, then ships once', () => {
    const { sends, stop } = startRecording();
    pageError(new ReferenceError('foo is not defined'));
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS - 1);
    expect(sends).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(sends).toEqual([['foo']]);
    stop();
  });

  it('identifiers arriving inside the window ride one batch, in arrival order', () => {
    const { sends, stop } = startRecording();
    pageError(new ReferenceError('foo is not defined'));
    vi.advanceTimersByTime(400);
    pageError(new ReferenceError('bar is not defined'));
    vi.advanceTimersByTime(99);
    expect(sends).toHaveLength(0); // the quiet period restarted with the second word…
    vi.advanceTimersByTime(1);
    expect(sends).toHaveLength(0); // …so it is not already due here
    vi.advanceTimersByTime(400);
    expect(sends).toEqual([['foo', 'bar']]);
    stop();
  });

  it('the same identifier never ships twice in a page lifetime', () => {
    const { sends, stop } = startRecording();
    pageError(new ReferenceError('foo is not defined'));
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    pageError(new ReferenceError('foo is not defined')); // after the flush, still deduped
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toEqual([['foo']]);
    stop();
  });

  it('a fresh identifier after a flush starts its own batch', () => {
    const { sends, stop } = startRecording();
    pageError(new ReferenceError('foo is not defined'));
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    pageError(new ReferenceError('bar is not defined'));
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toEqual([['foo'], ['bar']]);
    stop();
  });

  it('the unique-identifier cap closes the ledger for good, announced once', () => {
    const capWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { sends, stop } = startRecording({ maxUniqueWords: 2 });
    pageError(new ReferenceError('foo is not defined'));
    pageError(new ReferenceError('bar is not defined'));
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toEqual([['foo', 'bar']]);
    pageError(new ReferenceError('baz is not defined'));
    pageError(new ReferenceError('qux is not defined'));
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toEqual([['foo', 'bar']]); // ledger full: nothing else ships, ever
    expect(capWarn).toHaveBeenCalledTimes(1); // announced once, not per refused word
    capWarn.mockRestore();
    stop();
  });

  it('the per-word cap refuses overlong identifiers whole', () => {
    const { sends, stop } = startRecording({ maxWordChars: 5 });
    pageError(new ReferenceError('abcdef is not defined'));
    pageError(new ReferenceError('abcde is not defined'));
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toEqual([['abcde']]);
    stop();
  });

  it('the production word caps are exactly the bridge contract (the only table of numbers)', () => {
    // The app runs on the injected defaults; the defaults must be the shared
    // contract row — 50 unique identifiers, 200 characters — so a good-faith
    // page never loses a word to a second, drifted table.
    const { sends, stop } = startRecording();
    pageError(new ReferenceError(`${'x'.repeat(ERROR_WORD_LIMITS.chars)} is not defined`));
    pageError(new ReferenceError(`${'x'.repeat(ERROR_WORD_LIMITS.chars + 1)} is not defined`));
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toEqual([['x'.repeat(ERROR_WORD_LIMITS.chars)]]);
    stop();
  });

  it('a burst never ships more words than the receiver accepts', () => {
    // Sixty fresh identifiers inside one quiet period: the ledger cap stops at
    // the contract ceiling, so the flush cannot exceed it either — the batch
    // stays within `parseErrorWords`' count cap, never rejected on arrival.
    const { sends, stop } = startRecording();
    for (let index = 0; index < 60; index += 1) {
      pageError(new ReferenceError(`symbol${String(index)} is not defined`));
    }
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toHaveLength(ERROR_WORD_LIMITS.count);
    stop();
  });

  it('a fat batch truncates to the ceiling keeping the sentinel; overflow is announced', () => {
    const truncateWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { sends, stop } = startRecording({ maxBatchWords: 2 });
    pageError(new ReferenceError('first is not defined'));
    pageError(new ReferenceError('second is not defined'));
    vi.advanceTimersByTime(10);
    pageError(null, CROSS_ORIGIN_ERROR_MESSAGE); // cap-exempt sentinel on a pending burst
    // Four pending words (three identifiers + sentinel) against a 2-word
    // ceiling: the newest identifier spills, the sentinel rides.
    expect(sends).toEqual([['first', CROSS_ORIGIN_ERROR_WORD]]);
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toEqual([['first', CROSS_ORIGIN_ERROR_WORD]]); // no second flush
    expect(truncateWarn).toHaveBeenCalledTimes(1);
    truncateWarn.mockRestore();
    stop();
  });

  it('a full burst plus the sentinel truncates the newest identifier, announced once', () => {
    const truncateWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { sends, stop } = startRecording();
    for (let index = 0; index < ERROR_WORD_LIMITS.count; index += 1) {
      pageError(new ReferenceError(`symbol${String(index)} is not defined`));
    }
    pageError(null, CROSS_ORIGIN_ERROR_MESSAGE); // the sentinel lands on the full burst
    // 50 pending identifiers + the sentinel (each with its own reservations):
    // the batch keeps the 49 oldest identifiers and the sentinel in the same
    // send — exactly the receiver's word cap, never refusable wholesale; only
    // the newest identifier spills.
    expect(sends).toHaveLength(1);
    const flushed = sends[0] ?? [];
    expect(flushed).toHaveLength(ERROR_WORD_LIMITS.count);
    expect(flushed[0]).toBe('symbol0'); // oldest stay first
    expect(flushed[ERROR_WORD_LIMITS.count - 2]).toBe('symbol48'); // 49 kept
    expect(flushed[ERROR_WORD_LIMITS.count - 1]).toBe(CROSS_ORIGIN_ERROR_WORD); // intact
    expect(truncateWarn).toHaveBeenCalledTimes(1); // once per truncated batch
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toHaveLength(1); // the spilled word was ledger-charged — no re-send
    truncateWarn.mockRestore();
    stop();
  });

  it('identifiers never exceed the ledger across a page lifetime (the sentinel shares none)', () => {
    const capWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { sends, stop } = startRecording();
    pageError(null, CROSS_ORIGIN_ERROR_MESSAGE); // sentinel first in the page's lifetime
    for (let index = 0; index < 60; index += 1) {
      pageError(new ReferenceError(`symbol${String(index)} is not defined`));
    }
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    // All 50 identifier slots stayed available to the page: the sentinel —
    // delivered first, flagged outside the ledger — reserved none of them. A
    // shared ledger would have delivered 49 identifiers here.
    const burst = Array.from(
      { length: ERROR_WORD_LIMITS.count },
      (_, index) => `symbol${String(index)}`
    );
    expect(sends).toEqual([[CROSS_ORIGIN_ERROR_WORD], burst]); // the full cap, in arrival order
    for (let index = 0; index < 5; index += 1) {
      pageError(new ReferenceError(`late${String(index)} is not defined`));
    }
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toHaveLength(2); // ledger closed for good — overage is refused, not sent
    expect(capWarn).toHaveBeenCalledTimes(1);
    capWarn.mockRestore();
    stop();
  });
});

describe('cross-origin sentinel: immediate, deduped, cancel-then-flush', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ships at once, dedupes afterwards, and leaves no debounce behind', () => {
    const { sends, stop } = startRecording();
    pageError(null, CROSS_ORIGIN_ERROR_MESSAGE);
    expect(sends).toEqual([[CROSS_ORIGIN_ERROR_WORD]]); // immediate, before any quiet period
    pageError(null, CROSS_ORIGIN_ERROR_MESSAGE);
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS * 3);
    expect(sends).toEqual([[CROSS_ORIGIN_ERROR_WORD]]); // deduped like any word
    stop();
  });

  it('pending identifiers ride the immediate sentinel batch, exactly once', () => {
    const { sends, stop } = startRecording();
    pageError(new ReferenceError('jane is not defined'));
    pageError(null, CROSS_ORIGIN_ERROR_MESSAGE);
    expect(sends).toEqual([['jane', CROSS_ORIGIN_ERROR_WORD]]);
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toEqual([['jane', CROSS_ORIGIN_ERROR_WORD]]); // the restarted debounce was canceled
    stop();
  });

  it('the sentinel stays reportable when the identifier ledger is already full', () => {
    const { sends, stop } = startRecording({ maxUniqueWords: 1 });
    pageError(new ReferenceError('first is not defined'));
    pageError(new ReferenceError('second is not defined')); // refuses a ledger place
    pageError(null, CROSS_ORIGIN_ERROR_MESSAGE); // not an identifier — still reported
    expect(sends).toEqual([['first', CROSS_ORIGIN_ERROR_WORD]]);
    stop();
  });

  it('a closed ledger never blocks the sentinel: immediate flush, pending identifiers riding', () => {
    const capWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { sends, stop } = startRecording({ maxUniqueWords: 2 });
    pageError(new ReferenceError('foo is not defined'));
    pageError(new ReferenceError('bar is not defined')); // ledger now full, both pending
    pageError(new ReferenceError('refused is not defined')); // beyond the ledger
    pageError(null, CROSS_ORIGIN_ERROR_MESSAGE); // flushed immediately all the same…
    expect(sends).toEqual([['foo', 'bar', CROSS_ORIGIN_ERROR_WORD]]); // …with both riding
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toEqual([['foo', 'bar', CROSS_ORIGIN_ERROR_WORD]]); // nothing was held back
    expect(capWarn).toHaveBeenCalledTimes(1); // the refusal announced once
    capWarn.mockRestore();
    stop();
  });

  it('repeated cross-origin errors stay one sentinel, never re-queued into later flushes', () => {
    const { sends, stop } = startRecording();
    pageError(null, CROSS_ORIGIN_ERROR_MESSAGE); // delivered here, once
    pageError(new ReferenceError('foo is not defined'));
    pageError(null, CROSS_ORIGIN_ERROR_MESSAGE); // deduped while an identifier batch is pending
    pageError(null, CROSS_ORIGIN_ERROR_MESSAGE);
    pageError(new ReferenceError('bar is not defined'));
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toEqual([
      [CROSS_ORIGIN_ERROR_WORD],
      ['foo', 'bar'] // the identifier flush carries no sentinel again
    ]);
    stop();
  });
});

describe('unhandled rejections feed the same ledger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a rejection contributes like an error, sharing the ledger', () => {
    const { sends, stop } = startRecording();
    pageRejection(new TypeError('window.foo.bar is not a function'));
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toEqual([['bar']]);
    stop();
  });

  it('a shapeless reason is left alone', () => {
    const { sends, stop } = startRecording();
    pageRejection('plain string rejection');
    pageRejection(null);
    pageRejection({ message: 'no stack here' });
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toEqual([]);
    stop();
  });

  it('a callable is skipped even when a page stapled a string stack onto it', () => {
    // Deliberate surface gate: only object-shaped throwables are scanned.
    // Callables never carry a stack of their own in this engine (V8 yields
    // `undefined`), so the only reachable word would come from a page-attached
    // arbitrary string — no real error surface produces the recognizable
    // shapes through one.
    const callable = Object.assign(() => 'not an object', {
      stack: 'ReferenceError: rocketFn is not defined\n    at page.js:1:1'
    });
    const { sends, stop } = startRecording();
    pageRejection(callable);
    pageError(callable);
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toEqual([]);
    stop();
  });
});

describe('page-world safety', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('page error events are never intercepted (no preventDefault, no rethrow)', () => {
    const { stop } = startRecording();
    const event = new ErrorEvent('error', {
      message: 'ReferenceError: foo is not defined',
      error: new ReferenceError('foo is not defined'),
      cancelable: true
    } satisfies ErrorEventInit);
    window.dispatchEvent(event);
    // Nothing threw while the capture ran, and the browser's own default
    // handling stays untouched.
    expect(event.defaultPrevented).toBe(false);
    stop();
  });

  it('a hostile thrown value (throwing stack getter) cannot break the listener', () => {
    const { sends, stop } = startRecording();
    const hostile = {};
    Object.defineProperty(hostile, 'stack', {
      get: () => {
        throw new Error('getter boom');
      },
      configurable: true
    });
    expect(() => {
      pageError(hostile);
    }).not.toThrow();
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toEqual([]); // unreadable is unreadable — nothing extracted
    stop();
  });

  it('a control character would poison a batch — such a capture is refused instead', () => {
    const { sends, stop } = startRecording();
    // Hand-built stack (adversarial page data): real captures cannot carry this.
    const poisoned = 'ReferenceError: bad\u0007word is not defined';
    pageError({ stack: poisoned });
    pageError(new ReferenceError('healthy is not defined'));
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toEqual([['healthy']]); // the poisoned word was refused at admission
    stop();
  });

  it('stop tears the listeners down and cancels a pending flush', () => {
    const { sends, stop } = startRecording();
    pageError(new ReferenceError('pending is not defined'));
    stop(); // before the quiet period ends
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toEqual([]);

    pageError(new ReferenceError('after is not defined'));
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toEqual([]); // no longer observed
  });

  it('stop after a flush keeps later words out', () => {
    const { sends, stop } = startRecording();
    pageError(new ReferenceError('before is not defined'));
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    stop();
    pageError(new ReferenceError('after is not defined'));
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toEqual([['before']]);
  });
});

describe('capture over the real window bridge', () => {
  // Real timers on purpose: fake ones stall happy-dom's postMessage delivery,
  // and the flow under test is the asynchronous bridge round trip itself.
  it('a batch crosses the bridge and comes back acknowledged', async () => {
    const listenerMessenger = defineWindowMessaging<WindowProtocolMap>({
      namespace: WINDOW_BRIDGE_NAMESPACE
    });
    const batches: string[][] = [];
    const removeListener = listenerMessenger.onMessage('undefinedReferenceBatch', ({ data }) => {
      batches.push([...data]);
      return true;
    });
    const stop = startUndefinedReferenceCapture();
    try {
      // Real thrown errors, as a page would make them: the stack's first line
      // carries the message, the exact wire word comes out at the other side.
      pageError(new TypeError("Cannot read properties of undefined (reading 'vendor')"));
      pageError(null, CROSS_ORIGIN_ERROR_MESSAGE);
      await vi.waitFor(
        () => {
          expect(batches).toEqual([['vendor', CROSS_ORIGIN_ERROR_WORD]]);
        },
        { timeout: 2_000, interval: 25 }
      );
    } finally {
      stop();
      removeListener();
    }
  });
});
