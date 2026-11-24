/**
 * An element's live content-box width as a signal — the input of the list
 * kit's width rules (`listTier`, `detailLayout`). One `ResizeObserver` per
 * list, observing that list's own root (the `@container` its rows' tier
 * variants read, so script and styles agree), released with its owner.
 *
 * A root whose height follows its content (a list whose rows are measured as
 * they mount) binds the ref to a zero-height probe spanning its content box
 * instead: the probe's box changes only with the width, so a height change
 * made by a deeper observer's callback (the virtualizer measuring rows) never
 * re-notifies in the same frame — the browser's "ResizeObserver loop" error.
 */
import { createSignal, onCleanup, type Accessor } from 'solid-js';

/** What {@link createContentWidth} hands its component. */
export interface ContentWidth {
  /** Bind as the measured element's `ref`. */
  readonly ref: (element: HTMLElement) => void;
  /** The last measured content-box width in px (`0` before the first measure and while hidden). */
  readonly width: Accessor<number>;
}

/**
 * The width a resize entry reports: the content box (a list root carries no
 * padding, so it equals the box its container queries read).
 *
 * @param entry The observer entry.
 * @returns A finite, non-negative width in px.
 */
export function entryWidth(entry: ResizeObserverEntry): number {
  const width = entry.contentRect.width;
  return Number.isFinite(width) && width > 0 ? width : 0;
}

/**
 * Measure an element's content-box width for as long as the calling owner
 * lives. Must run inside a Solid owner. Without a `ResizeObserver` (no real
 * layout) the width stays `0` — the compact, drill-in layout, which works at
 * any width.
 *
 * @returns The ref to bind and the width signal.
 */
export function createContentWidth(): ContentWidth {
  const [width, setWidth] = createSignal(0);
  let observer: ResizeObserver | undefined;
  onCleanup(() => observer?.disconnect());
  return {
    width,
    ref(element) {
      observer?.disconnect();
      if (typeof ResizeObserver === 'undefined') return;
      observer = new ResizeObserver((entries) => {
        // The last entry is the newest measure of the one observed element.
        const entry = entries.at(-1);
        if (entry !== undefined) setWidth(entryWidth(entry));
      });
      observer.observe(element);
    }
  };
}
