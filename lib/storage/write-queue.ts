/**
 * Serialized read-modify-write for whole-shape storage items.
 *
 * Two unsynchronized read-modify-writes of one item interleave: the later
 * one's read sees the older stored value and writes it back, silently
 * reverting the earlier writer. A write queue chains the tasks so a queued
 * task's read only starts after the previous task's write settled. Scope is
 * one JS context (the queue is module state): items whose writers live in
 * several contexts need a single owning writer on top of this.
 */

/** Runs one task after every previously queued task settled. */
export type WriteQueue = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * Create one item's write queue.
 *
 * @returns The enqueue function: it resolves/rejects with the task's own
 *   outcome; a rejecting task never stalls the next one (the chain forgets
 *   outcomes — each caller branches on its own promise).
 */
export function createWriteQueue(): WriteQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}
