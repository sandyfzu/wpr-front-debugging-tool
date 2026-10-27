/** Tests for the write queue: ordering, outcome pass-through, and recovery after a rejection. */
import { describe, expect, it } from 'vitest';
import { createWriteQueue } from './write-queue';

describe('createWriteQueue', () => {
  it('starts each task only after the previous one settled', async () => {
    const enqueue = createWriteQueue();
    const events: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const first = enqueue(async () => {
      events.push('first:start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push('first:end');
      return 1;
    });
    const second = enqueue(() => {
      events.push('second:start');
      return Promise.resolve(2);
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    releaseFirst();
    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('rejects only the failing task’s caller; the next task still runs', async () => {
    const enqueue = createWriteQueue();
    const failing = enqueue(() => Promise.reject(new Error('write failed')));
    const next = enqueue(() => Promise.resolve('ran'));
    await expect(failing).rejects.toThrow('write failed');
    await expect(next).resolves.toBe('ran');
  });

  it('keeps separate queues independent', async () => {
    const a = createWriteQueue();
    const b = createWriteQueue();
    const blocked = a(() => new Promise<never>(() => undefined));
    await expect(b(() => Promise.resolve('free'))).resolves.toBe('free');
    void blocked;
  });
});
