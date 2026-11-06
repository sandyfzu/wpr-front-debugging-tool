/**
 * The debounced writer: one write per pause, flush writes now and waits,
 * a store-refused configuration is never sent, a storage rejection is
 * shown and retried by the next flush, an edit during a write queues the
 * next one.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ScheduleTimer } from '../../../../lib/messaging/bounded-ask';
import {
  DEFAULT_RUCSS_TESTER_CONFIG,
  RUCSS_CONFIG_LIMITS,
  type RucssTesterConfig
} from '../../../../lib/rucss-tester/config';
import { createConfigWriter } from './config-writer';

/** A manual timer: `fire()` runs the armed callback. */
function manualTimer(): { schedule: ScheduleTimer; fire: () => void; armed: () => boolean } {
  let pending: (() => void) | null = null;
  return {
    schedule: (run) => {
      pending = run;
      return () => {
        if (pending === run) pending = null;
      };
    },
    fire: () => {
      const run = pending;
      pending = null;
      run?.();
    },
    armed: () => pending !== null
  };
}

/** A configuration with a distinct safelist. */
function config(safelist: string): RucssTesterConfig {
  return { ...DEFAULT_RUCSS_TESTER_CONFIG, replacements: [], safelist };
}

/** Let queued promise callbacks run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index++) await Promise.resolve();
}

describe('createConfigWriter', () => {
  it('writes the last edit of a burst once the pause passes', async () => {
    const timer = manualTimer();
    const write = vi.fn(() => Promise.resolve());
    const writer = createConfigWriter({ write, schedule: timer.schedule, delayMs: 400 });
    expect(writer.state()).toEqual({ status: 'saved' });
    writer.queue(config('a'));
    writer.queue(config('ab'));
    expect(writer.state()).toEqual({ status: 'pending' });
    expect(write).not.toHaveBeenCalled();
    timer.fire();
    expect(writer.state()).toEqual({ status: 'saving' });
    await settle();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(config('ab'));
    expect(writer.state()).toEqual({ status: 'saved' });
  });

  it('flush writes now, waits for it and disarms the timer', async () => {
    const timer = manualTimer();
    const write = vi.fn(() => Promise.resolve());
    const writer = createConfigWriter({ write, schedule: timer.schedule, delayMs: 400 });
    writer.queue(config('x'));
    await expect(writer.flush()).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(timer.armed()).toBe(false);
    // Nothing queued: a flush writes nothing more.
    await expect(writer.flush()).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('never sends what the store would refuse, and says why', async () => {
    const timer = manualTimer();
    const write = vi.fn(() => Promise.resolve());
    const writer = createConfigWriter({ write, schedule: timer.schedule, delayMs: 400 });
    const heavy = '\u0001'.repeat(RUCSS_CONFIG_LIMITS.cssChars);
    writer.queue({ ...config(''), prepend: heavy, append: heavy });
    await expect(writer.flush()).resolves.toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(writer.state()).toMatchObject({
      status: 'refused',
      message: expect.stringContaining('too large to save') as unknown
    });
  });

  it('shows a storage rejection and retries it on the next flush', async () => {
    const timer = manualTimer();
    const write = vi
      .fn<(config: RucssTesterConfig) => Promise<void>>()
      .mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'))
      .mockResolvedValue(undefined);
    const writer = createConfigWriter({ write, schedule: timer.schedule, delayMs: 400 });
    writer.queue(config('q'));
    await expect(writer.flush()).resolves.toBe(false);
    expect(writer.state()).toEqual({
      status: 'failed',
      message:
        "Couldn't save the settings (QUOTA_BYTES quota exceeded). Your edits stay here; the next change or run tries again."
    });
    await expect(writer.flush()).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith(config('q'));
  });

  it('an edit during a write stays pending and is written after it', async () => {
    const timer = manualTimer();
    let release = (): void => undefined;
    const write = vi
      .fn<(config: RucssTesterConfig) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      )
      .mockResolvedValue(undefined);
    const writer = createConfigWriter({ write, schedule: timer.schedule, delayMs: 400 });
    writer.queue(config('one'));
    timer.fire();
    await settle();
    writer.queue(config('two'));
    release();
    await settle();
    expect(writer.state()).toEqual({ status: 'pending' });
    await expect(writer.flush()).resolves.toBe(true);
    expect(write.mock.calls.map(([value]) => value.safelist)).toEqual(['one', 'two']);
  });

  it('flush resolves once the edit current at its call is stored, not a later one', async () => {
    const timer = manualTimer();
    let release = (): void => undefined;
    const write = vi
      .fn<(config: RucssTesterConfig) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      )
      .mockResolvedValue(undefined);
    const writer = createConfigWriter({ write, schedule: timer.schedule, delayMs: 400 });
    writer.queue(config('at-run'));
    const flushing = writer.flush();
    await settle();
    // Typed while the flush's write is in flight: it keeps its own debounce.
    writer.queue(config('typed-meanwhile'));
    release();
    await expect(flushing).resolves.toBe(true);
    expect(write.mock.calls.map(([value]) => value.safelist)).toEqual(['at-run']);
    expect(writer.state()).toEqual({ status: 'pending' });
    expect(timer.armed()).toBe(true);
    timer.fire();
    await settle();
    expect(write).toHaveBeenLastCalledWith(config('typed-meanwhile'));
    expect(writer.state()).toEqual({ status: 'saved' });
  });

  it('flush also covers an edit whose debounce write is already in flight', async () => {
    const timer = manualTimer();
    let release = (): void => undefined;
    const write = vi
      .fn<(config: RucssTesterConfig) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      )
      .mockResolvedValue(undefined);
    const writer = createConfigWriter({ write, schedule: timer.schedule, delayMs: 400 });
    writer.queue(config('debounced'));
    timer.fire();
    await settle();
    const flushing = writer.flush();
    release();
    await expect(flushing).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('flush reports a held edit refused by a concurrent write pass', async () => {
    const timer = manualTimer();
    const write = vi.fn(() => Promise.resolve());
    const writer = createConfigWriter({ write, schedule: timer.schedule, delayMs: 400 });
    const heavy = '\u0001'.repeat(RUCSS_CONFIG_LIMITS.cssChars);
    writer.queue({ ...config(''), prepend: heavy, append: heavy });
    timer.fire();
    await settle();
    // Nothing queued any more, nothing stored: the store does not hold the form.
    await expect(writer.flush()).resolves.toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it('cancel drops a queued write', async () => {
    const timer = manualTimer();
    const write = vi.fn(() => Promise.resolve());
    const writer = createConfigWriter({ write, schedule: timer.schedule, delayMs: 400 });
    writer.queue(config('gone'));
    writer.cancel();
    timer.fire();
    await writer.flush();
    expect(write).not.toHaveBeenCalled();
  });
});
