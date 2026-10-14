/**
 * Overflow watching for scroll regions: reports whether an element's content
 * overflows it, live, so a region can become keyboard-focusable exactly while
 * it scrolls (WCAG 2.1.1 — a scroll region must be operable without a
 * pointer; one that never scrolls must not cost a Tab stop).
 *
 * One `ResizeObserver` is shared by every watched region: a page rendering
 * many code blocks pays one observer, not one per block.
 */

/** Stop watching: unobserves both elements and drops the callback. */
export type StopWatching = () => void;

/**
 * A watcher seam: observe `scroller` (the overflow-clipping box) and
 * `content` (its sized child), call `onChange` with the overflow state.
 */
export type OverflowWatcher = (
  scroller: HTMLElement,
  content: HTMLElement,
  onChange: (overflowing: boolean) => void
) => StopWatching;

/** Overflow values that let a user scroll the axis (`hidden`/`clip` only clip). */
const SCROLLING_OVERFLOW = new Set(['auto', 'scroll']);

/**
 * Whether a scroll container has content to scroll to on an axis it lets
 * the user scroll. An axis that clips (`overflow: hidden`/`clip`, e.g. a
 * clamped preview) never counts: making such a box focusable would add a
 * Tab stop that cannot scroll.
 *
 * @param scroller The overflow-clipping element.
 * @returns `true` while a user-scrollable axis has hidden content.
 */
export function isOverflowing(scroller: HTMLElement): boolean {
  const style = getComputedStyle(scroller);
  return (
    (SCROLLING_OVERFLOW.has(style.overflowX) && scroller.scrollWidth > scroller.clientWidth) ||
    (SCROLLING_OVERFLOW.has(style.overflowY) && scroller.scrollHeight > scroller.clientHeight)
  );
}

/** The minimal `ResizeObserver` surface the watcher uses (a test seam). */
export interface ResizeObserverLike {
  /** Start observing an element's size. */
  observe: (target: Element) => void;
  /** Stop observing an element's size. */
  unobserve: (target: Element) => void;
}

/** Builds the shared observer around the callback dispatching to watched regions. */
export type ResizeObserverFactory = (
  callback: (entries: readonly { target: Element }[]) => void
) => ResizeObserverLike;

/**
 * Create an overflow watcher backed by one shared, lazily created observer.
 *
 * Both elements are observed: the scroller's box changes with the layout
 * (panel resize, docking), the content's box changes with the content (text,
 * highlighting, the wrap toggle — the content must size to its content, e.g.
 * `w-fit min-w-full`). Each notification re-measures the owning region and
 * reports only actual state changes. The observer delivers an initial
 * notification for every newly observed element, so no measuring is needed
 * at watch time.
 *
 * @param createObserver The observer factory (tests inject a manual double).
 * @returns The watcher.
 */
export function createOverflowWatcher(
  createObserver: ResizeObserverFactory = (callback) => new ResizeObserver(callback)
): OverflowWatcher {
  /** The measure callback of each observed element (two elements per region). */
  const regions = new Map<Element, () => void>();
  let observer: ResizeObserverLike | undefined;

  return (scroller, content, onChange) => {
    observer ??= createObserver((entries) => {
      // Two entries of one region measure it once; a measure per entry would be idempotent but wasteful.
      const measures = new Set<() => void>();
      for (const entry of entries) {
        const measure = regions.get(entry.target);
        if (measure !== undefined) measures.add(measure);
      }
      for (const measure of measures) measure();
    });
    const shared = observer;
    let last: boolean | undefined;
    const measure = (): void => {
      const next = isOverflowing(scroller);
      if (next === last) return;
      last = next;
      onChange(next);
    };
    regions.set(scroller, measure);
    regions.set(content, measure);
    shared.observe(scroller);
    shared.observe(content);
    return () => {
      shared.unobserve(scroller);
      shared.unobserve(content);
      regions.delete(scroller);
      regions.delete(content);
    };
  };
}

/** The process-wide watcher (one observer for every region on the page). */
let sharedWatcher: OverflowWatcher | undefined;

/**
 * Watch a region with the process-wide shared observer.
 *
 * @param scroller The overflow-clipping element.
 * @param content Its child, sized to its content.
 * @param onChange Called with the overflow state on every change (and once initially).
 * @returns The stop function — call it on unmount.
 */
export const watchOverflow: OverflowWatcher = (scroller, content, onChange) => {
  sharedWatcher ??= createOverflowWatcher();
  return sharedWatcher(scroller, content, onChange);
};
