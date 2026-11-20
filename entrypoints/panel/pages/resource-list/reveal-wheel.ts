/**
 * The detail views' wheel rule (side pane, drill-in body): a wheel over a
 * scroll box nested in the view (a capped code block) scrolls the view — or
 * the panel around it — first, until that box is on screen on the side the
 * wheel moves toward, then the box — `planReveal` decides, this binds it to
 * the DOM. Keys, the scrollbars, sideways wheels and pinch-zoom stay the
 * browser's.
 */
import {
  planReveal,
  wheelDeltaPx,
  type ClipLayer,
  type ScrollState,
  type VerticalSpan
} from '../../../../lib/panel/detail-wheel';

/** Overflow values that let the user scroll an axis. */
const SCROLLING_OVERFLOW = new Set(['auto', 'scroll']);

/**
 * The nested box the browser would scroll for this wheel: the nearest
 * vertical scroller between the target and the view (exclusive) — when it
 * can still move that way. `null`: none, or the nearest one is at its end
 * (the browser hands the wheel on by itself).
 *
 * @param target The wheel's target.
 * @param view The detail view.
 * @param down The wheel moves down.
 * @returns The box, or null.
 */
export function nestedScroller(
  target: EventTarget | null,
  view: HTMLElement,
  down: boolean
): HTMLElement | null {
  if (!(target instanceof Element) || !view.contains(target)) return null;
  for (
    let node: Element | null = target;
    node !== null && node !== view;
    node = node.parentElement
  ) {
    if (!(node instanceof HTMLElement) || node.scrollHeight <= node.clientHeight) continue;
    if (!SCROLLING_OVERFLOW.has(getComputedStyle(node).overflowY)) continue;
    const canMove = down
      ? node.scrollTop + node.clientHeight < node.scrollHeight - 1
      : node.scrollTop > 0;
    return canMove ? node : null;
  }
  return null;
}

/**
 * A scroller's visible client area in viewport px (inside its borders and
 * horizontal scrollbar).
 *
 * @param element The scroller.
 * @returns Its client span.
 */
function clientSpan(element: Element): VerticalSpan {
  const top = element.getBoundingClientRect().top + element.clientTop;
  return { top, bottom: top + element.clientHeight };
}

/**
 * A scroller's scroll state.
 *
 * @param element The scroller.
 * @returns Its `scrollTop` / `clientHeight` / `scrollHeight`.
 */
function scrollState(element: Element): ScrollState {
  return {
    scrollTop: element.scrollTop,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  };
}

/**
 * Every layer that clips a box inside `view`, innermost first: the view, its
 * clipping ancestors (any `overflow-y` but `visible`; user-scrollable only
 * when `auto`/`scroll`) up to the body, then the viewport (scrolled by the
 * document's scroller). On a short dock the view reaches below the panel's
 * content scroller, so the view alone cannot say what is on screen.
 *
 * @param view The detail view (a vertical scroller).
 * @returns The layers and their elements (`elements[i]` scrolls `layers[i]`;
 *   `null` for a layer the user cannot scroll).
 */
export function clipLayers(view: HTMLElement): {
  layers: ClipLayer[];
  elements: (Element | null)[];
} {
  const layers: ClipLayer[] = [{ span: clientSpan(view), scroll: scrollState(view) }];
  const elements: (Element | null)[] = [view];
  const page = view.ownerDocument;
  for (
    let node = view.parentElement;
    node !== null && node !== page.body && node !== page.documentElement;
    node = node.parentElement
  ) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'visible') continue;
    const scrolls = SCROLLING_OVERFLOW.has(overflow);
    layers.push({ span: clientSpan(node), scroll: scrolls ? scrollState(node) : null });
    elements.push(scrolls ? node : null);
  }
  const root = page.scrollingElement;
  const viewport = page.defaultView?.innerHeight ?? page.documentElement.clientHeight;
  layers.push({ span: { top: 0, bottom: viewport }, scroll: root ? scrollState(root) : null });
  elements.push(root);
  return { layers, elements };
}

/**
 * Bind the rule on a detail view. Only cancelable wheels are acted on: a
 * non-cancelable one (Chromium marks the rest of a gesture so once its first
 * event went unhandled, the scroll being latched to a scroller) is scrolled
 * by the browser whatever a listener does, so moving a scroller by hand too
 * would scroll twice. Stateless per event, so a gesture that turns
 * non-cancelable midway simply continues natively.
 *
 * @param view The view's scroller (it must scroll vertically itself).
 * @returns Unbind.
 */
export function bindRevealWheel(view: HTMLElement): () => void {
  const onWheel = (event: WheelEvent): void => {
    // Pinch-zoom, sideways (incl. Shift + wheel), handled and browser-owned wheels stay as they are.
    if (!event.cancelable || event.defaultPrevented || event.ctrlKey || event.shiftKey) return;
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const delta = wheelDeltaPx(event.deltaY, event.deltaMode, view.clientHeight);
    if (delta === 0) return;
    const box = nestedScroller(event.target, view, delta > 0);
    if (box === null) return;
    const { layers, elements } = clipLayers(view);
    const plan = planReveal(delta, box.getBoundingClientRect(), layers);
    if (plan === null) return;
    event.preventDefault();
    plan.steps.forEach((step, index) => {
      const element = elements[index];
      if (step !== 0 && element) element.scrollTop += step;
    });
    // The rest of this tick goes where the browser would have sent it: the box.
    if (plan.rest !== 0) box.scrollTop += plan.rest;
  };
  // Not passive: the rule must keep the box from taking the tick.
  view.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    view.removeEventListener('wheel', onWheel);
  };
}
