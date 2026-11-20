/** The latest-wins writer: one write in flight, bursts collapse, failures reported. */
import { describe, expect, it, vi } from 'vitest';
import { createLatestWriter } from './latest-writer';

/** A write double whose calls settle when the test says so. */
function controlledWrite() {
  const calls: { value: number; settle: (error?: Error) => void }[] = [];
  const write = vi.fn(
    (value: number) =>
      new Promise<void>((resolve, reject) => {
        calls.push({
          value,
          settle: (error) => {
            if (error === undefined) resolve();
            else reject(error);
          }
        });
      })
  );
  return { calls, write };
}

/** Let the writer's promise chain run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('createLatestWriter', () => {
  it('writes a lone value at once', async () => {
    const { calls, write } = controlledWrite();
    const submit = createLatestWriter(write, vi.fn());
    submit(1);
    await flush();
    expect(calls.map((call) => call.value)).toEqual([1]);
  });

  it('collapses a burst into the newest value, written after the one in flight', async () => {
    const { calls, write } = controlledWrite();
    const submit = createLatestWriter(write, vi.fn());
    submit(1);
    await flush();
    submit(2);
    submit(3);
    submit(4);
    await flush();
    expect(calls.map((call) => call.value)).toEqual([1]);
    calls[0]?.settle();
    await flush();
    expect(calls.map((call) => call.value)).toEqual([1, 4]);
    calls[1]?.settle();
    await flush();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('reports a failed write with its value and still writes the pending one', async () => {
    const { calls, write } = controlledWrite();
    const onError = vi.fn();
    const submit = createLatestWriter(write, onError);
    submit(1);
    await flush();
    submit(2);
    const failure = new Error('quota');
    calls[0]?.settle(failure);
    await flush();
    expect(onError).toHaveBeenCalledWith(failure, 1);
    expect(calls.map((call) => call.value)).toEqual([1, 2]);
  });

  it('treats a synchronous throw as a failed write and stays usable', async () => {
    const onError = vi.fn();
    const write = vi.fn((value: number): Promise<void> => {
      if (value === 1) throw new Error('sync');
      return Promise.resolve();
    });
    const submit = createLatestWriter(write, onError);
    submit(1);
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'sync' }), 1);
    submit(2);
    await flush();
    expect(write).toHaveBeenLastCalledWith(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
