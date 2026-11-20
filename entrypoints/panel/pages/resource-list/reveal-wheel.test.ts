/**
 * The detail views' wheel binding: which nested box the wheel is over, and
 * when the view takes the tick (prevented + scrolled) or leaves it to the
 * browser. Geometry is stubbed (happy-dom has no layout).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { bindRevealWheel, clipLayers, nestedScroller } from './reveal-wheel';

/** Unbind of the current test. */
let unbind: (() => void) | undefined;

afterEach(() => {
  unbind?.();
  unbind = undefined;
  document.body.innerHTML = '';
});

/** Stub an element's scroll metrics and box. */
function stub(
  element: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number; top: number; scrollTop?: number }
): void {
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: metrics.scrollHeight
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: metrics.clientHeight
  });
  element.scrollTop = metrics.scrollTop ?? 0;
  element.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: 0, y: metrics.top, width: 300, height: metrics.clientHeight });
}

/**
 * A 400 px view (scrollable to 600) holding a 360 px code box (4 000 px of
 * content) at `boxTop`, with a line span inside it.
 */
function build(boxTop: number, viewScrollTop = 0) {
  document.body.innerHTML = `<aside id="view" style="overflow-y:auto"><p id="text">facts</p><div id="box" style="overflow-y:auto"><pre><span id="line">code</span></pre></div></aside>`;
  const view = document.getElementById('view') as HTMLElement;
  const box = document.getElementById('box') as HTMLElement;
  stub(view, { scrollHeight: 1_000, clientHeight: 400, top: 0, scrollTop: viewScrollTop });
  stub(box, { scrollHeight: 4_000, clientHeight: 360, top: boxTop });
  unbind = bindRevealWheel(view);
  return {
    view,
    box,
    line: document.getElementById('line') as HTMLElement,
    text: document.getElementById('text') as HTMLElement
  };
}

/**
 * Dispatch a cancelable wheel on a target; returns the event. The modifier
 * keys are set on the event itself (happy-dom's `WheelEvent` drops them).
 */
function wheel(target: HTMLElement, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  for (const key of ['ctrlKey', 'shiftKey'] as const) {
    Object.defineProperty(event, key, { value: init[key] === true });
  }
  target.dispatchEvent(event);
  return event;
}

describe('nestedScroller', () => {
  it('finds the nearest vertical scroller between the target and the view', () => {
    const { view, box, line, text } = build(300);
    expect(nestedScroller(line, view, true)).toBe(box);
    expect(nestedScroller(text, view, true)).toBeNull();
    expect(nestedScroller(null, view, true)).toBeNull();
    expect(nestedScroller(document.body, view, true)).toBeNull();
  });

  it('is null when that scroller is at its end the wheel moves toward (the browser hands on)', () => {
    const { view, box, line } = build(300);
    expect(nestedScroller(line, view, false)).toBeNull();
    box.scrollTop = 3_640;
    expect(nestedScroller(line, view, true)).toBeNull();
    expect(nestedScroller(line, view, false)).toBe(box);
  });

  it('skips boxes that only clip (overflow hidden) or do not overflow', () => {
    const { view, box, line } = build(300);
    box.style.overflowY = 'hidden';
    expect(nestedScroller(line, view, true)).toBeNull();
    box.style.overflowY = 'auto';
    stub(box, { scrollHeight: 100, clientHeight: 100, top: 300 });
    expect(nestedScroller(line, view, true)).toBeNull();
  });
});

describe('clipLayers', () => {
  it('lists the view, its clipping ancestors (scrollable or not) and the viewport, innermost first', () => {
    // `#plain` spells out `visible`: happy-dom computes an unset overflow as ''.
    document.body.innerHTML = `<div id="clip" style="overflow-y:hidden"><div id="plain" style="overflow-y:visible"><main id="outer" style="overflow-y:scroll"><aside id="view" style="overflow-y:auto"></aside></main></div></div>`;
    const view = document.getElementById('view') as HTMLElement;
    const outer = document.getElementById('outer') as HTMLElement;
    stub(view, { scrollHeight: 900, clientHeight: 300, top: 50, scrollTop: 20 });
    stub(outer, { scrollHeight: 500, clientHeight: 400, top: 10 });
    stub(document.getElementById('clip') as HTMLElement, {
      scrollHeight: 400,
      clientHeight: 400,
      top: 0
    });
    const { layers, elements } = clipLayers(view);
    expect(elements).toEqual([view, outer, null, document.scrollingElement]);
    expect(layers[0]).toEqual({
      span: { top: 50, bottom: 350 },
      scroll: { scrollTop: 20, clientHeight: 300, scrollHeight: 900 }
    });
    expect(layers[1]?.span).toEqual({ top: 10, bottom: 410 });
    expect(layers[2]).toEqual({ span: { top: 0, bottom: 400 }, scroll: null });
    expect(layers[3]?.span).toEqual({ top: 0, bottom: window.innerHeight });
  });
});

describe('bindRevealWheel', () => {
  it('scrolls the view (not the box) while the box is cut off below', () => {
    const { view, box, line } = build(300);
    const event = wheel(line, { deltaY: 120 });
    expect(event.defaultPrevented).toBe(true);
    expect(view.scrollTop).toBe(120);
    expect(box.scrollTop).toBe(0);
  });

  it('stops the view where the box is whole, hands the rest of the tick to the box, then leaves the wheel to it', () => {
    // Box 300…660 in a 0…400 view: 260 px hidden.
    const { view, line, box } = build(300);
    wheel(line, { deltaY: 200 });
    expect(view.scrollTop).toBe(200);
    expect(box.scrollTop).toBe(0);
    stub(box, { scrollHeight: 4_000, clientHeight: 360, top: 100 });
    wheel(line, { deltaY: 200 });
    expect(view.scrollTop).toBe(260);
    expect(box.scrollTop).toBe(140);
    stub(box, { scrollHeight: 4_000, clientHeight: 360, top: 40, scrollTop: 140 });
    const event = wheel(line, { deltaY: 200 });
    expect(event.defaultPrevented).toBe(false);
    expect(view.scrollTop).toBe(260);
  });

  it('never acts on a non-cancelable wheel (the browser scrolls it anyway: no double scroll)', () => {
    const { view, box, line } = build(300);
    const event = wheel(line, { deltaY: 120, cancelable: false });
    expect(event.defaultPrevented).toBe(false);
    expect(view.scrollTop).toBe(0);
    expect(box.scrollTop).toBe(0);
  });

  it('keeps no state across a gesture that turns non-cancelable midway', () => {
    const { view, line } = build(300);
    wheel(line, { deltaY: 100 });
    expect(view.scrollTop).toBe(100);
    // The browser's own scroll of the latched rest is not ours to repeat.
    wheel(line, { deltaY: 100, cancelable: false });
    wheel(line, { deltaY: 100, cancelable: false });
    expect(view.scrollTop).toBe(100);
    // The next gesture starts fresh.
    expect(wheel(line, { deltaY: 100 }).defaultPrevented).toBe(true);
    expect(view.scrollTop).toBe(200);
  });

  it('scrolls the panel around a view that reaches below it first (short docks)', () => {
    // Panel 0…260 (100 px left to scroll) holding a 0…400 view whose box (250…398) is whole in the view.
    document.body.innerHTML = `<main id="outer" style="overflow-y:auto"><aside id="view" style="overflow-y:auto"><div id="box" style="overflow-y:auto"><pre><span id="line">code</span></pre></div></aside></main>`;
    const outer = document.getElementById('outer') as HTMLElement;
    const view = document.getElementById('view') as HTMLElement;
    const box = document.getElementById('box') as HTMLElement;
    stub(outer, { scrollHeight: 360, clientHeight: 260, top: 0 });
    stub(view, { scrollHeight: 600, clientHeight: 400, top: 0 });
    stub(box, { scrollHeight: 4_000, clientHeight: 148, top: 250 });
    unbind = bindRevealWheel(view);
    const event = wheel(document.getElementById('line') as HTMLElement, { deltaY: 160 });
    expect(event.defaultPrevented).toBe(true);
    // 138 px hidden below the panel: its 100 px first, then the view's 38, the last 22 to the box.
    expect(outer.scrollTop).toBe(100);
    expect(view.scrollTop).toBe(38);
    expect(box.scrollTop).toBe(22);
  });

  it('converts line deltas (Firefox) to px', () => {
    const { view, line } = build(300);
    wheel(line, { deltaY: 3, deltaMode: 1 });
    expect(view.scrollTop).toBe(48);
  });

  it('leaves pinch-zoom, Shift + wheel, sideways and handled wheels alone', () => {
    const { view, line } = build(300);
    for (const init of [
      { deltaY: 120, ctrlKey: true },
      { deltaY: 120, shiftKey: true },
      { deltaY: 10, deltaX: 120 },
      { deltaY: 0 }
    ]) {
      expect(wheel(line, init).defaultPrevented).toBe(false);
    }
    line.addEventListener('wheel', (event) => {
      event.preventDefault();
    });
    wheel(line, { deltaY: 120 });
    expect(view.scrollTop).toBe(0);
  });

  it('leaves wheels outside a nested box to the browser', () => {
    const { view, text } = build(300);
    expect(wheel(text, { deltaY: 120 }).defaultPrevented).toBe(false);
    expect(view.scrollTop).toBe(0);
  });

  it('reveals the box top first on the way up', () => {
    const { view, box, line } = build(-200, 300);
    box.scrollTop = 500;
    const event = wheel(line, { deltaY: -120 });
    expect(event.defaultPrevented).toBe(true);
    expect(view.scrollTop).toBe(180);
    expect(box.scrollTop).toBe(500);
  });

  it('unbinds', () => {
    const { view, line } = build(300);
    unbind?.();
    unbind = undefined;
    expect(wheel(line, { deltaY: 120 }).defaultPrevented).toBe(false);
    expect(view.scrollTop).toBe(0);
  });
});
