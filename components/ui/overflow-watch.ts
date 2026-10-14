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
 * What a watch measures on every size change of its two elements: `box`
 * (the outer element) against `content` (its child sized to its content).
 */
export type OverflowMeasure = (box: HTMLElement, content: HTMLElement) => boolean;

/**
 * A watcher seam: observe `box` (a scroller or a clamp) and `content` (its
 * sized child), call `onChange` with the measured state — by default
 * {@link isOverflowing} on `box`.
 */
export type OverflowWatcher = (
  box: HTMLElement,
  content: HTMLElement,
  onChange: (state: boolean) => void,
  measure?: OverflowMeasure
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

/**
 * Whether a clamp hides part of its content vertically: the content box is
 * taller than the clamp's own box. Unlike {@link isOverflowing} this ignores
 * the overflow style — it answers "is anything cut off?", e.g. to show a
 * fade only when there is more below.
 *
 * @param box The clamping element.
 * @param content Its child, sized to its content.
 * @returns `true` while content extends below the clamp.
 */
export function isClippedVertically(box: HTMLElement, content: HTMLElement): boolean {
  return content.offsetHeight > box.clientHeight;
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
 * Both elements are observed: the outer box changes with the layout
 * (panel resize, docking), the content's box changes with the content (text,
 * highlighting, the wrap toggle — the content must size to its content, e.g.
 * `w-fit min-w-full`). Each notification re-measures the owning region and
 * reports only actual state changes. One element may belong to several
 * watches (a code block's content box is measured against its scroller and
 * its clamp); it stays observed until the last of them stops. The observer
 * delivers an initial
 * notification for every newly observed element, so no measuring is needed
 * at watch time.
 *
 * @param createObserver The observer factory (tests inject a manual double).
 * @returns The watcher.
 */
export function createOverflowWatcher(
  createObserver: ResizeObserverFactory = (callback) => new ResizeObserver(callback)
): OverflowWatcher {
  /** The watches' re-measure callbacks per observed element. */
  const regions = new Map<Element, Set<() => void>>();
  let observer: ResizeObserverLike | undefined;

  return (box, content, onChange, measure = (scroller) => isOverflowing(scroller)) => {
    observer ??= createObserver((entries) => {
      // Two entries of one watch re-measure it once (a Set dedupes).
      const due = new Set<() => void>();
      for (const entry of entries) {
        for (const remeasure of regions.get(entry.target) ?? []) due.add(remeasure);
      }
      for (const remeasure of due) remeasure();
    });
    const shared = observer;
    let last: boolean | undefined;
    const remeasure = (): void => {
      const next = measure(box, content);
      if (next === last) return;
      last = next;
      onChange(next);
    };
    for (const element of [box, content]) {
      const watches = regions.get(element) ?? new Set<() => void>();
      if (watches.size === 0) shared.observe(element);
      watches.add(remeasure);
      regions.set(element, watches);
    }
    return () => {
      for (const element of [box, content]) {
        const watches = regions.get(element);
        if (watches === undefined) continue;
        watches.delete(remeasure);
        if (watches.size === 0) {
          regions.delete(element);
          shared.unobserve(element);
        }
      }
    };
  };
}

/** The process-wide watcher (one observer for every region on the page). */
let sharedWatcher: OverflowWatcher | undefined;

/**
 * Watch a region with the process-wide shared observer.
 *
 * @param box The scroller (or clamp) element.
 * @param content Its child, sized to its content.
 * @param onChange Called with the measured state on every change (and once initially).
 * @param measure What to measure (default: {@link isOverflowing} on `box`).
 * @returns The stop function — call it on unmount.
 */
export const watchOverflow: OverflowWatcher = (box, content, onChange, measure) => {
  sharedWatcher ??= createOverflowWatcher();
  return sharedWatcher(box, content, onChange, measure);
};
