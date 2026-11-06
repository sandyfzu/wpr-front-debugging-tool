/**
 * The shared stored-settings form over a toy tool: load machine (+ retry and
 * a load landing after dispose), debounced writes of the form's value, the
 * check's refusal, and foreign writes landing only while nothing is unsaved.
 */
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleTimer } from '../../../../lib/messaging/bounded-ask';
import { createStoredSettings, type StoredSettingsDeps } from './stored-settings';

/** The toy value and its form (a count shown as text). */
interface Toy {
  readonly count: number;
}
interface ToyForm {
  text: string;
}

/** Let queued promise callbacks run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

/** A manual timer: `fire()` runs the armed callback. */
function manualTimer(): { schedule: ScheduleTimer; fire: () => void } {
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
    }
  };
}

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

/** Build the form in a root with doubles. */
function setup(overrides: Partial<StoredSettingsDeps<Toy, ToyForm>> = {}) {
  const timer = manualTimer();
  let watcher: ((value: Toy) => void) | null = null;
  const warn = vi.fn();
  const deps = {
    read: vi.fn(() => Promise.resolve<Toy>({ count: 3 })),
    write: vi.fn<(value: Toy) => Promise<void>>(() => Promise.resolve()),
    watch: vi.fn((onChange: (value: Toy) => void) => {
      watcher = onChange;
      return () => {
        watcher = null;
      };
    }),
    check: (value: Toy) => (value.count > 99 ? 'Too big.' : null),
    toForm: (value: Toy): ToyForm => ({ text: String(value.count) }),
    toValue: (form: ToyForm): Toy => ({ count: Number(form.text) }),
    initial: { count: 0 },
    schedule: timer.schedule,
    delayMs: 400,
    log: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    label: 'Toy',
    ...overrides
  };
  const form = createRoot((dispose) => {
    disposers.push(dispose);
    return createStoredSettings(deps);
  });
  disposers.push(form.dispose);
  return { form, deps, warn, timer, foreign: (value: Toy) => watcher?.(value) };
}

describe('createStoredSettings', () => {
  it('holds the initial value while loading, then the stored one', async () => {
    const { form } = setup();
    expect(form.load()).toEqual({ status: 'loading' });
    expect(form.form.text).toBe('0');
    await settle();
    expect(form.load()).toEqual({ status: 'ready' });
    expect(form.value()).toEqual({ count: 3 });
  });

  it('reads a failed load as failed (logged with the label) and retries', async () => {
    const read = vi
      .fn<() => Promise<Toy>>()
      .mockRejectedValueOnce(new Error('dead context'))
      .mockResolvedValueOnce({ count: 5 });
    const { form, warn } = setup({ read });
    await settle();
    expect(form.load()).toEqual({ status: 'failed' });
    expect(warn).toHaveBeenCalledWith('Toy: reading the settings failed', 'dead context');
    form.retryLoad();
    expect(form.load()).toEqual({ status: 'loading' });
    await settle();
    expect(form.load()).toEqual({ status: 'ready' });
    expect(form.form.text).toBe('5');
  });

  it('writes the edited value once the pause passes, and flush writes now', async () => {
    const { form, deps, timer } = setup();
    await settle();
    form.setForm('text', '7');
    form.edited();
    expect(form.save()).toEqual({ status: 'pending' });
    timer.fire();
    await settle();
    expect(deps.write).toHaveBeenCalledWith({ count: 7 });
    expect(form.save()).toEqual({ status: 'saved' });
    form.setForm('text', '8');
    form.edited();
    await expect(form.flush()).resolves.toBe(true);
    expect(deps.write).toHaveBeenLastCalledWith({ count: 8 });
  });

  it("never sends what the tool's check refuses, and says why", async () => {
    const { form, deps } = setup();
    await settle();
    form.setForm('text', '100');
    form.edited();
    await expect(form.flush()).resolves.toBe(false);
    expect(deps.write).not.toHaveBeenCalled();
    expect(form.save()).toEqual({ status: 'refused', message: 'Too big.' });
  });

  it('takes a foreign write only while loaded with nothing unsaved', async () => {
    const { form, foreign } = setup();
    foreign({ count: 1 });
    expect(form.form.text).toBe('0'); // still loading
    await settle();
    foreign({ count: 9 });
    expect(form.form.text).toBe('9');
    form.setForm('text', '4');
    form.edited();
    foreign({ count: 2 });
    expect(form.form.text).toBe('4'); // the unsaved edit wins
  });

  it('ignores a load landing after dispose and stops watching', async () => {
    let resolve: (value: Toy) => void = () => undefined;
    const read = vi.fn(() => new Promise<Toy>((done) => (resolve = done)));
    const unsubscribe = vi.fn();
    const { form } = setup({ read, watch: () => unsubscribe });
    form.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    resolve({ count: 42 });
    await settle();
    expect(form.load()).toEqual({ status: 'loading' });
    expect(form.form.text).toBe('0');
  });
});
