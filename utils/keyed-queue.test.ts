import { describe, expect, it } from 'vitest';
import { createKeyedQueue } from './keyed-queue';

/** A promise with its resolver exposed. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('createKeyedQueue', () => {
  it('runs one key’s tasks serially, in order', async () => {
    const enqueue = createKeyedQueue();
    const order: string[] = [];
    const gate = deferred();
    const first = enqueue(1, async () => {
      order.push('first:start');
      await gate.promise;
      order.push('first:end');
    });
    const second = enqueue(1, () => {
      order.push('second');
      return Promise.resolve();
    });
    await Promise.resolve();
    expect(order).toEqual(['first:start']);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('runs different keys independently', async () => {
    const enqueue = createKeyedQueue();
    const gate = deferred();
    const blocked = enqueue(1, () => gate.promise);
    await expect(enqueue(2, () => Promise.resolve('free'))).resolves.toBe('free');
    gate.resolve();
    await blocked;
  });

  it('keeps running a key after a failed task, rejecting only its caller', async () => {
    const enqueue = createKeyedQueue();
    const failed = enqueue(1, () => Promise.reject(new Error('boom')));
    const next = enqueue(1, () => Promise.resolve('next'));
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('next');
  });

  it('passes each task’s value through', async () => {
    const enqueue = createKeyedQueue();
    await expect(enqueue(5, () => Promise.resolve(42))).resolves.toBe(42);
  });
});
