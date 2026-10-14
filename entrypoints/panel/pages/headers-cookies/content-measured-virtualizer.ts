/**
 * A virtualizer factory for `VirtualList` whose rows are measured by their
 * **content**, not by their positioned wrapper — so rows of any height
 * (wrapping values, hints) lay out without overlapping.
 *
 * Two facts of the list's row wrappers make the default measurement a no-op:
 * the wrapper's height is pinned to the virtualizer's current size for the
 * row (measuring it reads the estimate back), and its measuring `ref` runs
 * before its `data-index` exists (the row is never even registered). This
 * factory registers each row one microtask later, measures the wrapper's
 * first child (the rendered row, which keeps its natural height), and watches
 * those children with one shared `ResizeObserver`, so a row whose content
 * re-wraps or changes is re-measured even when the wrapper's box does not
 * move.
 */
import { createVirtualizer } from '@tanstack/solid-virtual';
import { mergeProps, onCleanup } from 'solid-js';
import type { VirtualizerFactory } from '../../../../components/ui/virtual-list';

/**
 * The height of one positioned row: its rendered content's height, or the
 * wrapper's own when it holds no element (nothing better to read).
 *
 * @param wrapper The row wrapper the list positions (`data-index` carrier).
 * @returns The height in whole CSS px.
 */
export function rowContentHeight(wrapper: Element): number {
  const content = wrapper.firstElementChild;
  if (content instanceof HTMLElement) return content.offsetHeight;
  return wrapper instanceof HTMLElement ? wrapper.offsetHeight : 0;
}

/** The two virtualizer calls a content resize feeds (narrowed for tests). */
export interface ContentResizeTarget {
  /** The row index a wrapper carries (`data-index`), or -1 when it has none. */
  indexFromElement: (node: Element) => number;
  /** Record a row's new size. */
  resizeItem: (index: number, size: number) => void;
}

/**
 * Handle one batch of content resizes: each still-connected row reports its
 * new height for its wrapper's index; rows that left the document (scrolled
 * out, list shrunk) stop being watched.
 *
 * @param entries The observer's entries (targets are row contents).
 * @param target The virtualizer to feed.
 * @param unobserve Stops watching a departed row.
 */
export function applyContentResizes(
  entries: readonly Pick<ResizeObserverEntry, 'target'>[],
  target: ContentResizeTarget,
  unobserve: (node: Element) => void
): void {
  for (const entry of entries) {
    const wrapper = entry.target.parentElement;
    if (!entry.target.isConnected || wrapper === null) {
      unobserve(entry.target);
      continue;
    }
    const index = target.indexFromElement(wrapper);
    if (index < 0) continue;
    target.resizeItem(index, rowContentHeight(wrapper));
  }
}

/**
 * Build the factory. Must run inside the list's owner (it is called by
 * `VirtualList` during its setup), which disconnects the shared observer
 * when the list unmounts.
 *
 * @returns A {@link VirtualizerFactory} for `VirtualList`'s `createVirtualizer` prop.
 */
export function contentMeasuredVirtualizer(): VirtualizerFactory {
  return (options) => {
    // The observer's callback outlives this setup; it reaches the
    // virtualizer through this holder (assigned right below).
    const target: { current: ContentResizeTarget | null } = { current: null };
    const watcher =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver((entries) => {
            if (target.current === null) return;
            applyContentResizes(entries, target.current, (node) => {
              watcher?.unobserve(node);
            });
          })
        : null;
    onCleanup(() => {
      watcher?.disconnect();
    });
    // mergeProps keeps the list's option getters live (count, keys…).
    const instance = createVirtualizer(
      mergeProps(options, {
        measureElement: (element: Element): number => {
          const content = element.firstElementChild;
          if (content !== null) watcher?.observe(content);
          return rowContentHeight(element);
        }
      })
    );
    target.current = instance;
    return {
      getVirtualItems: () => instance.getVirtualItems(),
      getTotalSize: () => instance.getTotalSize(),
      // The list binds this as each row wrapper's `ref`, which Solid runs
      // before the wrapper's `data-index` attribute is applied — measured
      // then, the virtualizer cannot resolve the row and drops it for good
      // (never observed, the estimate kept forever). One microtask later the
      // attribute is in place and the row is in the document.
      measureElement: (node) => {
        if (node === null) {
          instance.measureElement(null);
          return;
        }
        // eslint-disable-next-line solid/reactivity -- a DOM registration, not a reactive read
        queueMicrotask(() => {
          instance.measureElement(node);
        });
      }
    };
  };
}
