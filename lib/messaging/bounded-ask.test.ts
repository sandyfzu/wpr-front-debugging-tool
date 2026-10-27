/** Tests for the bounded ask: every outcome arm, deadline handling and the timer seam. */
import { describe, expect, it, vi } from 'vitest';
import { boundedAsk, type ScheduleTimer } from './bounded-ask';

/** Accepts only the string 'ok'. */
const parseOk = (answer: unknown): 'ok' | null => (answer === 'ok' ? 'ok' : null);

/** A manual timer seam: `fire()` runs the armed callback; `cancelled` tracks cancels. */
function manualTimer(): { schedule: ScheduleTimer; fire: () => void; cancelled: () => boolean } {
  let run: (() => void) | null = null;
  let cancelled = false;
  return {
    schedule: (callback) => {
      run = callback;
      return () => {
        cancelled = true;
      };
    },
    fire: () => run?.(),
    cancelled: () => cancelled
  };
}

describe('boundedAsk', () => {
  it('resolves a guarded answer as reply and cancels the deadline', async () => {
    const timer = manualTimer();
    const outcome = await boundedAsk({
      send: () => Promise.resolve('ok'),
      parse: parseOk,
      timeoutMs: 100,
      schedule: timer.schedule
    });
    expect(outcome).toEqual({ kind: 'reply', reply: 'ok' });
    expect(timer.cancelled()).toBe(true);
  });

  it('classifies an answer the guard rejects as invalid-reply', async () => {
    const outcome = await boundedAsk({
      send: () => Promise.resolve({ forged: true }),
      parse: parseOk,
      timeoutMs: 100
    });
    expect(outcome).toEqual({ kind: 'invalid-reply' });
  });

  it('classifies the runtime no-receiver rejections as no-receiver', async () => {
    for (const message of [
      'Could not establish connection. Receiving end does not exist.',
      'No response',
      'No listeners available'
    ]) {
      const outcome = await boundedAsk({
        send: () => Promise.reject(new Error(message)),
        parse: parseOk,
        timeoutMs: 100
      });
      expect(outcome, message).toEqual({ kind: 'no-receiver' });
    }
  });

  it('keeps real failures (async or a synchronous throw) as failed, with their cause', async () => {
    const cause = new Error('Extension context invalidated.');
    expect(
      await boundedAsk({ send: () => Promise.reject(cause), parse: parseOk, timeoutMs: 100 })
    ).toEqual({ kind: 'failed', cause });
    expect(
      await boundedAsk({
        send: () => {
          throw cause;
        },
        parse: parseOk,
        timeoutMs: 100
      })
    ).toEqual({ kind: 'failed', cause });
  });

  it('reports a throwing guard as failed, never as a reply', async () => {
    const cause = new Error('guard bug');
    const outcome = await boundedAsk({
      send: () => Promise.resolve('ok'),
      parse: () => {
        throw cause;
      },
      timeoutMs: 100
    });
    expect(outcome).toEqual({ kind: 'failed', cause });
  });

  it('times out when nothing settles, and ignores a late answer', async () => {
    const timer = manualTimer();
    let answer: (value: unknown) => void = () => undefined;
    const pending = boundedAsk({
      send: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
      parse: parseOk,
      timeoutMs: 100,
      schedule: timer.schedule
    });
    timer.fire();
    answer('ok');
    expect(await pending).toEqual({ kind: 'timeout' });
  });

  it('settles once even when the timer seam fires synchronously', async () => {
    const outcome = await boundedAsk({
      send: () => Promise.resolve('ok'),
      parse: parseOk,
      timeoutMs: 1,
      schedule: (run) => {
        run();
        return () => undefined;
      }
    });
    expect(outcome).toEqual({ kind: 'timeout' });
  });

  it('never sends once a synchronous timer seam already ended the ask', async () => {
    const send = vi.fn(() => Promise.resolve('ok'));
    const outcome = await boundedAsk({
      send,
      parse: parseOk,
      timeoutMs: 1,
      schedule: (run) => {
        run();
        return () => undefined;
      }
    });
    expect(outcome).toEqual({ kind: 'timeout' });
    expect(send).not.toHaveBeenCalled();
  });

  it('resolves a send that returns a non-thenable as failed — never rejects', async () => {
    for (const returned of [5, undefined, null, { then: 'not callable' }]) {
      const outcome = await boundedAsk({
        // The seam is typed to return a promise; a broken send is the case under test.
        send: (() => returned) as unknown as () => Promise<unknown>,
        parse: parseOk,
        timeoutMs: 1000
      });
      expect(outcome.kind, `returned ${typeof returned}`).toBe('failed');
      expect(outcome.kind === 'failed' ? outcome.cause : null).toBeInstanceOf(TypeError);
    }
  });

  it('adopts a foreign thenable as the send', async () => {
    const thenable: PromiseLike<unknown> = {
      then: (resolve) => {
        resolve?.('ok');
        return Promise.resolve() as never;
      }
    };
    expect(
      await boundedAsk({
        send: (() => thenable) as unknown as () => Promise<unknown>,
        parse: parseOk,
        timeoutMs: 1000
      })
    ).toEqual({ kind: 'reply', reply: 'ok' });
  });

  it('times out on the real timer at the deadline', async () => {
    vi.useFakeTimers();
    try {
      const pending = boundedAsk({
        send: () => new Promise(() => undefined),
        parse: parseOk,
        timeoutMs: 250
      });
      await vi.advanceTimersByTimeAsync(249);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ kind: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws on a deadline that is not a positive finite number (a broken caller)', () => {
    for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        boundedAsk({ send: () => Promise.resolve('ok'), parse: parseOk, timeoutMs })
      ).toThrow(RangeError);
    }
  });
});
