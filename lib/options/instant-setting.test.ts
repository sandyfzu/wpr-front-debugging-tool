/**
 * The instant-setting machine: boot read (populated, failed + retry, a
 * watched write during the read wins), optimistic writes (written,
 * unchanged, failed → revert, overlapping → superseded), live follow (idle
 * vs mid-write), the not-ready guard, and the idempotent dispose — over
 * controllable seams, plus one leg over the real (fake-browser) gate item.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../logger';
import { readPageUiEnabled, setPageUiGate } from '../storage/page-ui-gate';
import { createPageUiGateIO } from './instant-io';
import {
  createInstantSettingModel,
  type InstantSettingIO,
  type InstantSettingSnapshot
} from './instant-setting';

beforeEach(() => {
  fakeBrowser.reset();
});

/** A silent traced logger. */
function silentLog(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** A deferred promise the test settles by hand. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Controllable seams: reads/writes resolve per the queued deferreds; `push` fires the watch. */
function controllableIO(): {
  io: InstantSettingIO<boolean>;
  reads: Array<ReturnType<typeof deferred<boolean>>>;
  writes: Array<{ value: boolean; settle: ReturnType<typeof deferred<undefined>> }>;
  push: (value: boolean) => void;
  unwatch: ReturnType<typeof vi.fn>;
  logError: ReturnType<typeof vi.fn>;
} {
  const reads: Array<ReturnType<typeof deferred<boolean>>> = [];
  const writes: Array<{ value: boolean; settle: ReturnType<typeof deferred<undefined>> }> = [];
  let listener: ((value: boolean) => void) | null = null;
  const unwatch = vi.fn();
  const logError = vi.fn();
  return {
    io: {
      read: () => {
        const next = deferred<boolean>();
        reads.push(next);
        return next.promise;
      },
      write: (value) => {
        const settle = deferred<undefined>();
        writes.push({ value, settle });
        return settle.promise;
      },
      watch: (onChange) => {
        listener = onChange;
        return unwatch;
      },
      log: { ...silentLog(), error: logError }
    },
    logError,
    reads,
    writes,
    push: (value) => listener?.(value),
    unwatch
  };
}

/** Let pending microtasks run. */
async function flush(): Promise<void> {
  await new Promise((done) => setTimeout(done, 0));
}

/** A model over the seams, collecting every snapshot. */
function fixture(io: InstantSettingIO<boolean>) {
  const seen: Array<InstantSettingSnapshot<boolean>> = [];
  const model = createInstantSettingModel(io, Object.is, (snapshot) => seen.push(snapshot));
  return { model, seen };
}

describe('the boot read', () => {
  it('starts loading, then shows the read value (frozen)', async () => {
    const seams = controllableIO();
    const { model } = fixture(seams.io);
    expect(model.snapshot()).toEqual({ status: 'loading' });
    const loading = model.load();
    seams.reads[0]?.resolve(false);
    await loading;
    expect(model.snapshot()).toEqual({ status: 'ready', value: false, writing: false });
    expect(Object.isFrozen(model.snapshot())).toBe(true);
  });

  it('a rejected read fails with a logged cause; load retries', async () => {
    const seams = controllableIO();
    const { model } = fixture(seams.io);
    const first = model.load();
    seams.reads[0]?.reject(new Error('Extension context invalidated.'));
    await first;
    expect(model.snapshot()).toEqual({ status: 'failed' });
    expect(seams.logError).toHaveBeenCalledWith(
      expect.stringContaining('Reading the setting failed'),
      expect.any(Error)
    );
    const retry = model.load();
    seams.reads[1]?.resolve(true);
    await retry;
    expect(model.snapshot()).toEqual({ status: 'ready', value: true, writing: false });
  });

  it('runs without an observer (the default no-op)', async () => {
    const seams = controllableIO();
    const model = createInstantSettingModel(seams.io, Object.is);
    const loading = model.load();
    seams.reads[0]?.resolve(true);
    await loading;
    expect(model.snapshot()).toMatchObject({ status: 'ready', value: true });
  });

  it('one read at a time; a load while ready is a no-op', async () => {
    const seams = controllableIO();
    const { model } = fixture(seams.io);
    const first = model.load();
    void model.load();
    expect(seams.reads).toHaveLength(1);
    seams.reads[0]?.resolve(true);
    await first;
    await model.load();
    expect(seams.reads).toHaveLength(1);
  });

  it('a write watched while the read is in flight is newer — it wins', async () => {
    const seams = controllableIO();
    const { model } = fixture(seams.io);
    const loading = model.load();
    seams.push(false);
    seams.reads[0]?.resolve(true);
    await loading;
    expect(model.snapshot()).toMatchObject({ status: 'ready', value: false });
  });
});

describe('writes', () => {
  /** A ready model showing `value`. */
  async function readyFixture(value: boolean) {
    const seams = controllableIO();
    const built = fixture(seams.io);
    const loading = built.model.load();
    seams.reads[0]?.resolve(value);
    await loading;
    return { ...built, seams };
  }

  it('shows the new value at once, writing, then settles written', async () => {
    const { model, seams } = await readyFixture(true);
    const outcome = model.set(false);
    expect(model.snapshot()).toEqual({ status: 'ready', value: false, writing: true });
    expect(seams.writes.map((write) => write.value)).toEqual([false]);
    seams.writes[0]?.settle.resolve(undefined);
    expect(await outcome).toBe('written');
    expect(model.snapshot()).toEqual({ status: 'ready', value: false, writing: false });
  });

  it('the shown value is unchanged: no write', async () => {
    const { model, seams } = await readyFixture(true);
    expect(await model.set(true)).toBe('unchanged');
    expect(seams.writes).toHaveLength(0);
  });

  it('a rejected write restores the confirmed value and reports failed', async () => {
    const { model, seams } = await readyFixture(true);
    const outcome = model.set(false);
    seams.writes[0]?.settle.reject(new Error('quota'));
    expect(await outcome).toBe('failed');
    expect(model.snapshot()).toEqual({ status: 'ready', value: true, writing: false });
    expect(seams.logError).toHaveBeenCalledWith(
      expect.stringContaining('Writing the setting failed'),
      expect.any(Error)
    );
  });

  it('overlapping writes: only the latest settles the state', async () => {
    const { model, seams } = await readyFixture(true);
    const first = model.set(false);
    // Back to the original value mid-flight is still a real request.
    const second = model.set(true);
    expect(seams.writes.map((write) => write.value)).toEqual([false, true]);
    seams.writes[0]?.settle.resolve(undefined);
    expect(await first).toBe('superseded');
    expect(model.snapshot()).toEqual({ status: 'ready', value: true, writing: true });
    seams.writes[1]?.settle.resolve(undefined);
    expect(await second).toBe('written');
    expect(model.snapshot()).toEqual({ status: 'ready', value: true, writing: false });
  });

  it('a superseded write that fails stays quiet; the latest one decides', async () => {
    const { model, seams } = await readyFixture(true);
    const first = model.set(false);
    const second = model.set(true);
    seams.writes[0]?.settle.reject(new Error('quota'));
    expect(await first).toBe('superseded');
    seams.writes[1]?.settle.reject(new Error('quota'));
    expect(await second).toBe('failed');
    // The confirmed value (the boot read) is shown again.
    expect(model.snapshot()).toMatchObject({ value: true, writing: false });
  });

  it('refuses writes before it is ready — a wiring bug, named', async () => {
    const seams = controllableIO();
    const { model } = fixture(seams.io);
    await expect(model.set(true)).rejects.toThrow(/not ready \(status 'loading'\)/);
  });
});

describe('live follow', () => {
  it("applies another surface's write while idle, never mid-write", async () => {
    const seams = controllableIO();
    const { model } = fixture(seams.io);
    const loading = model.load();
    seams.reads[0]?.resolve(true);
    await loading;
    seams.push(false);
    expect(model.snapshot()).toMatchObject({ value: false });
    const outcome = model.set(true);
    // Mid-write, a watched value only moves the confirmed baseline.
    seams.push(false);
    expect(model.snapshot()).toMatchObject({ value: true, writing: true });
    seams.writes[0]?.settle.reject(new Error('quota'));
    expect(await outcome).toBe('failed');
    expect(model.snapshot()).toMatchObject({ value: false, writing: false });
  });

  it('dispose stops following, once', () => {
    const seams = controllableIO();
    const { model } = fixture(seams.io);
    model.dispose();
    model.dispose();
    expect(seams.unwatch).toHaveBeenCalledOnce();
  });
});

describe('over the real gate item (fake browser)', () => {
  it('reads, writes and follows sync:page-ui-gate', async () => {
    const { model, seen } = fixture(createPageUiGateIO(silentLog()));
    await model.load();
    expect(model.snapshot()).toMatchObject({ status: 'ready', value: true });
    expect(await model.set(false)).toBe('written');
    expect(await readPageUiEnabled()).toBe(false);
    // Another surface turns it back on (the context-menu rescue).
    await setPageUiGate(true);
    await flush();
    expect(model.snapshot()).toMatchObject({ value: true, writing: false });
    expect(seen.length).toBeGreaterThan(2);
    model.dispose();
  });
});
