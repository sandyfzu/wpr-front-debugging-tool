import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debounce } from './debounce';

/* Debounce timing is mocked with fake timers; the clock only moves in `vi.advanceTimersByTime`. */

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs only the last invocation of a burst, after the quiet period', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced(1);
    debounced(2);
    debounced(3);
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  it('restarts the wait when new calls keep arriving', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('first');
    vi.advanceTimersByTime(90);
    debounced('second');
    vi.advanceTimersByTime(90);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('second');
  });

  it('cancel drops the pending invocation without running it', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 50);

    debounced('never');
    debounced.cancel();
    vi.advanceTimersByTime(500);

    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel is safe when nothing is pending, and does not block later calls', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 50);

    debounced.cancel();
    debounced('after-cancel');
    vi.advanceTimersByTime(50);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('after-cancel');
  });

  it('accepts a zero wait (fires on the next tick)', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 0);

    debounced('tick');
    vi.advanceTimersByTime(0);

    expect(fn).toHaveBeenCalledWith('tick');
  });
});
