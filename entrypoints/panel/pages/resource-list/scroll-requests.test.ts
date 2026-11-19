/** The merged find + list scroll request. */
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { VirtualScrollRequest } from '../../../../components/ui/virtual-list';
import { mergeScrollRequests } from './scroll-requests';

/** A merge over a controllable find source, disposed after the test body. */
function withMerge(
  initial: VirtualScrollRequest | null,
  body: (
    merged: ReturnType<typeof mergeScrollRequests>,
    setFind: (next: VirtualScrollRequest | null) => void
  ) => void
): void {
  createRoot((dispose) => {
    const [find, setFind] = createSignal<VirtualScrollRequest | null>(initial);
    // eslint-disable-next-line solid/reactivity -- the merge reads its source reactively itself
    body(mergeScrollRequests(find), (next) => setFind(() => next));
    dispose();
  });
}

describe('mergeScrollRequests', () => {
  it('seeds with the find’s request at creation, unchanged', () => {
    const seed = { index: 4 };
    withMerge(seed, (merged) => {
      expect(merged.request()).toBe(seed);
    });
  });

  it('follows each later find request, and its clearing', () => {
    withMerge(null, (merged, setFind) => {
      const next = { index: 2 };
      setFind(next);
      expect(merged.request()).toBe(next);
      setFind(null);
      expect(merged.request()).toBeNull();
    });
  });

  it('lets the list’s own request win until the next find event (latest wins)', () => {
    withMerge(null, (merged, setFind) => {
      setFind({ index: 1 });
      merged.scrollTo(7);
      expect(merged.request()).toEqual({ index: 7 });
      const find = { index: 3 };
      setFind(find);
      expect(merged.request()).toBe(find);
      merged.scrollTo(0);
      expect(merged.request()).toEqual({ index: 0 });
    });
  });

  it('issues a fresh object per own request, even for the same index', () => {
    withMerge(null, (merged) => {
      merged.scrollTo(5);
      const first = merged.request();
      merged.scrollTo(5);
      expect(merged.request()).toEqual(first);
      expect(merged.request()).not.toBe(first);
    });
  });

  it('asks nothing for a row not in the list (negative index)', () => {
    withMerge(null, (merged) => {
      merged.scrollTo(2);
      const kept = merged.request();
      merged.scrollTo(-1);
      expect(merged.request()).toBe(kept);
    });
  });
});
