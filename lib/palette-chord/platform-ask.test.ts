/**
 * The shared platform ask: the reply's narrowing, the answer winning, every
 * unanswered outcome (no receiver, a failed or throwing send, the deadline)
 * standing in the navigator's convention with one warning, and a broken
 * stand-in degrading to the Ctrl convention — never a rejection.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ScheduleTimer } from '../messaging/bounded-ask';
import type { ChordPlatform } from '../storage/palette-chord-platform';
import {
  askChordPlatform,
  narrowChordPlatform,
  PLATFORM_ASK_TIMEOUT_MS,
  type ChordPlatformAsk
} from './platform-ask';

describe('narrowChordPlatform', () => {
  it.each<[unknown, string]>([
    ['mac', 'mac'],
    ['other', 'other'],
    ['win', 'other'],
    ['MAC', 'other'],
    [undefined, 'other'],
    [{ os: 'mac' }, 'other']
  ])('%j → %s', (reply, expected) => {
    expect(narrowChordPlatform(reply)).toBe(expected);
  });
});

/** An ask over fake seams; `expire` fires the armed deadline by hand. */
function harness(ask: () => Promise<unknown>, fallback: ChordPlatform = 'mac') {
  const warn = vi.fn();
  let fire: (() => void) | null = null;
  const schedule = vi.fn<ScheduleTimer>((run) => {
    fire = run;
    return () => {
      fire = null;
    };
  });
  const fallbackPlatform = vi.fn(() => fallback);
  const source: ChordPlatformAsk = {
    askPlatform: ask,
    fallbackPlatform,
    schedule,
    log: { warn }
  };
  return {
    source,
    warn,
    schedule,
    fallbackPlatform,
    expire: () => {
      fire?.();
    }
  };
}

describe('askChordPlatform', () => {
  it('resolves the narrowed answer without consulting the navigator, deadline cleared', async () => {
    const h = harness(() => Promise.resolve('mac'), 'other');
    await expect(askChordPlatform(h.source)).resolves.toBe('mac');
    expect(h.schedule).toHaveBeenCalledWith(expect.any(Function), PLATFORM_ASK_TIMEOUT_MS);
    expect(h.fallbackPlatform).not.toHaveBeenCalled();
    expect(h.warn).not.toHaveBeenCalled();
  });

  it('a junk answer narrows to the Ctrl convention (an answer, not a miss)', async () => {
    const h = harness(() => Promise.resolve({ os: 'mac' }));
    await expect(askChordPlatform(h.source)).resolves.toBe('other');
    expect(h.warn).not.toHaveBeenCalled();
  });

  it('no receiver stands in the navigator, naming the miss', async () => {
    const h = harness(() =>
      Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'))
    );
    await expect(askChordPlatform(h.source)).resolves.toBe('mac');
    expect(h.warn).toHaveBeenCalledWith(
      "Keyboard convention unanswered — using the navigator's (mac)",
      'no-receiver'
    );
  });

  it('a failed or synchronously throwing send stands in the navigator, logging its cause', async () => {
    const rejected = harness(() => Promise.reject(new Error('boom')), 'other');
    await expect(askChordPlatform(rejected.source)).resolves.toBe('other');
    expect(rejected.warn).toHaveBeenCalledWith(
      "Keyboard convention unanswered — using the navigator's (other)",
      new Error('boom')
    );
    const thrown = harness(() => {
      throw new Error('no runtime');
    });
    await expect(askChordPlatform(thrown.source)).resolves.toBe('mac');
    expect(thrown.warn).toHaveBeenCalledWith(
      "Keyboard convention unanswered — using the navigator's (mac)",
      new Error('no runtime')
    );
  });

  it('past the deadline the navigator stands in; a late answer changes nothing', async () => {
    let answer: (reply: unknown) => void = () => undefined;
    const h = harness(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const pending = askChordPlatform(h.source);
    h.expire();
    await expect(pending).resolves.toBe('mac');
    expect(h.warn).toHaveBeenCalledWith(
      "Keyboard convention unanswered — using the navigator's (mac)",
      'timeout'
    );
    answer('other');
    await expect(pending).resolves.toBe('mac');
    expect(h.warn).toHaveBeenCalledOnce();
  });

  it('a throwing stand-in degrades to the Ctrl convention, never a rejection', async () => {
    const h = harness(() => Promise.reject(new Error('boom')));
    h.fallbackPlatform.mockImplementation(() => {
      throw new Error('no navigator');
    });
    await expect(askChordPlatform(h.source)).resolves.toBe('other');
    expect(h.warn).toHaveBeenCalledWith(
      'Keyboard convention unresolved — using the Ctrl convention',
      new Error('no navigator')
    );
  });

  it('without a timer seam the platform timer bounds the ask', async () => {
    vi.useFakeTimers();
    try {
      const warn = vi.fn();
      const pending = askChordPlatform({
        askPlatform: () => new Promise<unknown>(() => undefined),
        fallbackPlatform: () => 'other',
        log: { warn }
      });
      await vi.advanceTimersByTimeAsync(PLATFORM_ASK_TIMEOUT_MS);
      await expect(pending).resolves.toBe('other');
      expect(warn).toHaveBeenCalledWith(
        "Keyboard convention unanswered — using the navigator's (other)",
        'timeout'
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
