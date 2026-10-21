/**
 * A per-key serial task queue: tasks for one key run one after another, in
 * submission order; keys are independent; an idle key holds no memory. A
 * failing task rejects its own caller only — the next task of the key
 * still runs.
 */
export type KeyedQueue = <T>(key: number, task: () => Promise<T>) => Promise<T>;

/**
 * Create a queue.
 *
 * @returns The enqueue function: runs `task` once every earlier task of
 *   `key` settled, and settles as `task` does.
 */
export function createKeyedQueue(): KeyedQueue {
  const tails = new Map<number, Promise<unknown>>();
  return <T>(key: number, task: () => Promise<T>): Promise<T> => {
    const run = (tails.get(key) ?? Promise.resolve()).then(task);
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
}
