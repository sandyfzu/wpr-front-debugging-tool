/**
 * The drag machine: the slop→drag boundary, the bounded follow (clamped
 * edges, exact 1:1 offsets, live re-basing on shape growth and viewport
 * shrink), the settle/cancel/restore paths, the click suppression, and the
 * wrong-pointer/wrong-button immunity — over recording seams, no DOM.
 */
import { describe, expect, it } from 'vitest';
import {
  clampDragPosition,
  createDragController,
  isPointerInitiatedClick,
  DRAG_TUNING,
  type DragBox,
  type DragMachineDeps,
  type DragPoint,
  type ViewportSize
} from './drag';

const REST_VIEWPORT: ViewportSize = { width: 1280, height: 800 };
/** The chrome's resting anchor inset (the stylesheet's bottom/right 16 px). */
const ANCHOR_PX = 16;
const MIN = DRAG_TUNING.minVisiblePx;

/**
 * Recording seams over a font-accurate stand-in for the chrome: the shape
 * hangs off the bottom-right resting anchor (an un-translated origin that
 * moves when the shape grows, like the real anchored card), the applied
 * translate moves the live box (getBoundingClientRect includes transforms),
 * and the viewport is settable per test.
 */
function recordingSeams(initialSize: { width: number; height: number }): {
  deps: DragMachineDeps;
  /** Every applied translate (nulls included, in order). */
  applied: Array<{ x: number; y: number } | null>;
  /** Every affordance flip, in order. */
  affordances: boolean[];
  /** The DOM-honest live box (the shape + its translate). */
  liveBox(): DragBox;
  /** Set the shape's extent (the card grows when its rows arrive mid-drag). */
  growShape(width: number, height: number): void;
  /** Set the live viewport (a resize mid-drag re-clamps). */
  setViewport(viewport: ViewportSize): void;
  /** Detach the shape (a disable mid-drag: reads answer null). */
  setShapeDetached(detached: boolean): void;
} {
  let shape = { ...initialSize };
  let viewport = REST_VIEWPORT;
  let translate: { x: number; y: number } | null = null;
  let detached = false;
  const applied: Array<{ x: number; y: number } | null> = [];
  const affordances: boolean[] = [];
  return {
    deps: {
      readViewport: () => viewport,
      readBox: () => {
        if (detached) return null;
        const offset = translate ?? { x: 0, y: 0 };
        const untrans = {
          left: viewport.width - ANCHOR_PX - shape.width,
          top: viewport.height - ANCHOR_PX - shape.height
        };
        return { left: untrans.left + offset.x, top: untrans.top + offset.y, ...shape };
      },
      applyPosition: (position) => {
        applied.push(position);
        translate = position;
      },
      applyDragging: (dragging) => {
        affordances.push(dragging);
      }
    },
    applied,
    affordances,
    liveBox: () => {
      // Mirrors readBox exactly — the tests read the DOM-honest truth only.
      const offset = translate ?? { x: 0, y: 0 };
      return {
        left: viewport.width - ANCHOR_PX - shape.width + offset.x,
        top: viewport.height - ANCHOR_PX - shape.height + offset.y,
        ...shape
      };
    },
    growShape: (width, height) => {
      shape = { width, height };
    },
    setViewport: (next) => {
      viewport = next;
    },
    setShapeDetached: (value) => {
      detached = value;
    }
  };
}

/** The center point of one box. */
const centerOf = (box: DragBox): DragPoint => ({
  x: box.left + box.width / 2,
  y: box.top + box.height / 2
});

describe('clampDragPosition', () => {
  const shape = { width: 200, height: 40 };

  it('keeps an interior position untouched', () => {
    expect(clampDragPosition({ left: 100, top: 100 }, shape, REST_VIEWPORT, MIN)).toEqual({
      left: 100,
      top: 100
    });
  });

  it('parks off the left/top edge keeping exactly the minimum visible strip', () => {
    const parked = clampDragPosition({ left: -1000, top: -1000 }, shape, REST_VIEWPORT, MIN);
    expect(parked.left).toBe(MIN - shape.width);
    expect(parked.top).toBe(MIN - shape.height);
  });

  it('parks off the right/bottom edge keeping exactly the minimum visible strip', () => {
    const parked = clampDragPosition({ left: 2000, top: 2000 }, shape, REST_VIEWPORT, MIN);
    expect(parked.left).toBe(REST_VIEWPORT.width - MIN);
    expect(parked.top).toBe(REST_VIEWPORT.height - MIN);
  });

  it('is drift-free: clamping again changes nothing', () => {
    const first = clampDragPosition({ left: -500, top: 3000 }, shape, REST_VIEWPORT, MIN);
    expect(clampDragPosition(first, shape, REST_VIEWPORT, MIN)).toEqual(first);
  });

  it('stays finite and strip-coherent when the range inverts (viewport smaller than the margins)', () => {
    const tiny: ViewportSize = { width: 60, height: 60 };
    const narrow = clampDragPosition(
      { left: 1000, top: 1000 },
      { width: 100, height: 100 },
      tiny,
      MIN
    );
    expect(narrow.left).toBe(tiny.width - MIN); // the right-edge strip survives
    expect(Number.isNaN(narrow.left + narrow.top)).toBe(false);
    const shifted = clampDragPosition(
      { left: -1000, top: -1000 },
      { width: 100, height: 100 },
      tiny,
      MIN
    );
    expect(shifted.left).toBe(MIN - 100); // the left-edge strip survives
  });

  it('resolves the negative available range deterministically (never NaN)', () => {
    const shape100 = { width: 100, height: 100 };
    const free = clampDragPosition({ left: 0, top: 0 }, shape100, { width: 10, height: 10 }, MIN);
    // Range [32−100, 10−32] = [−68, −22]: the desired value sits past the
    // upper bound → the boundary value wins (stable order, always finite).
    expect(free.left).toBe(10 - MIN);
    expect(free.top).toBe(10 - MIN);
    expect(Number.isNaN(free.left + free.top)).toBe(false);
    const lower = clampDragPosition(
      { left: -1000, top: -1000 },
      shape100,
      { width: 10, height: 10 },
      MIN
    );
    // A desired value below the range's lower bound → the lower boundary wins.
    expect(lower.left).toBe(MIN - 100);
    expect(lower.top).toBe(MIN - 100);
    expect(Number.isNaN(lower.left + lower.top)).toBe(false);
  });
});

describe('isPointerInitiatedClick', () => {
  it('keyboard activations count zero; pointer clicks count', () => {
    expect(isPointerInitiatedClick(0)).toBe(false);
    expect(isPointerInitiatedClick(1)).toBe(true);
    expect(isPointerInitiatedClick(2)).toBe(true);
  });
});

describe('createDragController', () => {
  it('a press on a live chrome repositions nothing and shows nothing', () => {
    const seams = recordingSeams({ width: 200, height: 40 });
    const drag = createDragController(seams.deps);
    drag.beginGrab({ point: centerOf(seams.liveBox()), pointerId: 1 });
    expect(drag.isDragging()).toBe(true);
    expect(seams.applied).toEqual([]);
    expect(seams.affordances).toEqual([]);
  });

  it('a press on a dead chrome (null box) never grabs', () => {
    const seams = recordingSeams({ width: 200, height: 40 });
    const drag = createDragController({ ...seams.deps, readBox: () => null });
    drag.beginGrab({ point: { x: 10, y: 10 }, pointerId: 1 });
    expect(drag.isDragging()).toBe(false);
  });

  it('travel inside the slop stays a click: no repositioning, no suppression', () => {
    const seams = recordingSeams({ width: 200, height: 40 });
    const drag = createDragController(seams.deps);
    const start = centerOf(seams.liveBox());
    drag.beginGrab({ point: start, pointerId: 1 });
    drag.trackMove({ point: { x: start.x + 3, y: start.y + 1 }, pointerId: 1 });
    drag.settle(1);
    expect(seams.applied).toEqual([]);
    expect(seams.affordances).toEqual([]);
    expect(drag.isDragging()).toBe(false);
    expect(drag.consumeClickSuppression()).toBe(false);
  });

  it('the (3, 4)-triangle boundary: travel below the slop holds, crossing it drags', () => {
    const seamsHold = recordingSeams({ width: 200, height: 40 });
    const hold = createDragController(seamsHold.deps);
    const holdStart = centerOf(seamsHold.liveBox());
    hold.beginGrab({ point: holdStart, pointerId: 1 });
    // hypot(2.99, 3.99) < 5: strictly inside → still a click.
    hold.trackMove({ point: { x: holdStart.x + 2.99, y: holdStart.y + 3.99 }, pointerId: 1 });
    hold.settle(1);
    expect(seamsHold.applied).toEqual([]);
    expect(hold.consumeClickSuppression()).toBe(false);

    const seamsExact = recordingSeams({ width: 200, height: 40 });
    const exact = createDragController(seamsExact.deps);
    const exactStart = centerOf(seamsExact.liveBox());
    exact.beginGrab({ point: exactStart, pointerId: 1 });
    // hypot(3, 4) = exactly 5: `travel < slop` is false, so the slop's
    // exclusive-inside semantics promote the press at this value (the
    // boundary probe pins the shipped `<` at drag.ts's guard).
    exact.trackMove({ point: { x: exactStart.x + 3, y: exactStart.y + 4 }, pointerId: 1 });
    expect(exact.isDragging()).toBe(true);
    expect(seamsExact.applied).toHaveLength(1);
    exact.settle(1);
    expect(exact.consumeClickSuppression()).toBe(true);
  });

  it('follows 1:1 past the slop, flipping the grabbing affordance once', () => {
    const seams = recordingSeams({ width: 200, height: 40 });
    const drag = createDragController(seams.deps);
    const start = centerOf(seams.liveBox());
    drag.beginGrab({ point: start, pointerId: 1 });
    drag.trackMove({ point: { x: start.x - 300, y: start.y - 120 }, pointerId: 1 });
    expect(seams.affordances).toEqual([true]);
    expect(seams.applied.at(-1)).toEqual({ x: -300, y: -120 });
    drag.trackMove({ point: { x: start.x - 298, y: start.y - 120 }, pointerId: 1 });
    expect(seams.applied.at(-1)).toEqual({ x: -298, y: -120 });
    expect(seams.affordances).toEqual([true]);
  });

  it('keeps the grabbed point under the pointer (grab at the box corner)', () => {
    const seams = recordingSeams({ width: 200, height: 40 });
    const drag = createDragController(seams.deps);
    const corner = { x: seams.liveBox().left, y: seams.liveBox().top };
    drag.beginGrab({ point: corner, pointerId: 1 });
    // The corner IS the grabbed point, so the translate is the pointer delta.
    drag.trackMove({ point: { x: corner.x, y: corner.y }, pointerId: 1 }); // inside-slop
    drag.trackMove({ point: { x: corner.x - 10, y: corner.y - 20 }, pointerId: 1 });
    expect(seams.applied.at(-1)).toEqual({ x: -10, y: -20 });
  });

  it('clamps all four edges while following', () => {
    const seams = recordingSeams({ width: 200, height: 40 });
    const drag = createDragController(seams.deps);
    drag.beginGrab({ point: centerOf(seams.liveBox()), pointerId: 1 });
    drag.trackMove({ point: { x: -5000, y: -5000 }, pointerId: 1 });
    const upper = seams.applied.at(-1);
    // The box parks at the min-visible strip: 32 px visible past each edge.
    expect(upper?.x).toBe(MIN - 200 - (REST_VIEWPORT.width - ANCHOR_PX - 200));
    expect(upper?.y).toBe(MIN - 40 - (REST_VIEWPORT.height - ANCHOR_PX - 40));
    drag.trackMove({ point: { x: 5000, y: 5000 }, pointerId: 1 });
    const box = seams.liveBox();
    expect(box.left).toBe(REST_VIEWPORT.width - MIN);
    expect(box.top).toBe(REST_VIEWPORT.height - MIN);
  });

  it('settle commits; a settled anchor is the next cancel restored pre-drag state', () => {
    const seams = recordingSeams({ width: 200, height: 40 });
    const drag = createDragController(seams.deps);
    const start = centerOf(seams.liveBox());
    drag.beginGrab({ point: start, pointerId: 1 });
    drag.trackMove({ point: { x: start.x - 200, y: start.y - 100 }, pointerId: 1 });
    drag.settle(1);
    expect(seams.affordances).toEqual([true, false]);
    expect(seams.applied.at(-1)).toEqual({ x: -200, y: -100 });
    expect(drag.isDragging()).toBe(false);
    // The next press starts from the committed anchor; cancel restores it.
    drag.beginGrab({ point: centerOf(seams.liveBox()), pointerId: 2 });
    drag.cancel();
    expect(seams.applied.at(-1)).toEqual({ x: -200, y: -100 });
  });

  it('cancel restores the first-drag resting anchor (null) exactly once', () => {
    const seams = recordingSeams({ width: 200, height: 40 });
    const drag = createDragController(seams.deps);
    const start = centerOf(seams.liveBox());
    drag.beginGrab({ point: start, pointerId: 1 });
    drag.trackMove({ point: { x: start.x - 200, y: start.y - 100 }, pointerId: 1 });
    drag.cancel();
    expect(seams.applied.at(-1)).toBeNull();
    expect(seams.affordances.at(-1)).toBe(false);
    const countAfterCancel = seams.applied.length;
    drag.cancel(); // cancel at rest is a no-op
    drag.settle(1); // release after cancel is a no-op
    expect(seams.applied).toHaveLength(countAfterCancel);
  });

  it('a canceled moved drag suppresses the trailing pill click, read-and-clear', () => {
    const seams = recordingSeams({ width: 200, height: 40 });
    const drag = createDragController(seams.deps);
    const start = centerOf(seams.liveBox());
    drag.beginGrab({ point: start, pointerId: 1 });
    drag.trackMove({ point: { x: start.x - 200, y: start.y }, pointerId: 1 });
    drag.cancel();
    expect(drag.consumeClickSuppression()).toBe(true);
    expect(drag.consumeClickSuppression()).toBe(false);
  });

  it('a moved drag suppresses a click racing its release (the right-press interleave)', () => {
    const seams = recordingSeams({ width: 200, height: 40 });
    const drag = createDragController(seams.deps);
    const start = centerOf(seams.liveBox());
    drag.beginGrab({ point: start, pointerId: 1 });
    drag.trackMove({ point: { x: start.x - 300, y: start.y - 100 }, pointerId: 1 });
    // The press's compat click dispatched WHILE the drag was still live (its
    // pointerup came later in the machine's real event order).
    expect(drag.consumeClickSuppression()).toBe(true);
    expect(drag.isDragging()).toBe(true);
    drag.settle(1); // the release lands after the click
    expect(drag.isDragging()).toBe(false);
    // The settle re-marks the moved drag (one writer: the release). The racing
    // click already ran on the live branch, so this leftover is unsent freight:
    // it is read once and cleared — no third click is pending in the platform.
    expect(drag.consumeClickSuppression()).toBe(true);
    expect(drag.consumeClickSuppression()).toBe(false);
    // A follow-up unmoved press works: the fresh press re-arms the flag.
    drag.beginGrab({ point: { x: start.x - 300, y: start.y - 100 }, pointerId: 2 });
    drag.settle(2);
    expect(drag.consumeClickSuppression()).toBe(false);
  });

  it('alien moves and alien releases never touch the live drag', () => {
    const seams = recordingSeams({ width: 200, height: 40 });
    const drag = createDragController(seams.deps);
    const start = centerOf(seams.liveBox());
    drag.beginGrab({ point: start, pointerId: 1 });
    drag.trackMove({ point: { x: start.x - 300, y: start.y - 100 }, pointerId: 9 });
    drag.settle(9);
    expect(drag.isDragging()).toBe(true);
    expect(seams.applied).toEqual([]);
    drag.settle(1);
    expect(drag.isDragging()).toBe(false);
  });

  it('any press mid-drag cancels it (right-press nicety, second pointer) and never regrabs', () => {
    const seams = recordingSeams({ width: 200, height: 40 });
    const drag = createDragController(seams.deps);
    const start = centerOf(seams.liveBox());
    drag.beginGrab({ point: start, pointerId: 1 });
    drag.trackMove({ point: { x: start.x - 300, y: start.y - 100 }, pointerId: 1 });
    drag.beginGrab({ point: { x: 40, y: 40 }, pointerId: 7 });
    expect(drag.isDragging()).toBe(false);
    expect(seams.applied.at(-1)).toBeNull();
    // The interrupting press slides (its move arrives with ITS id) — nothing grabs.
    drag.trackMove({ point: { x: 50, y: 50 }, pointerId: 7 });
    expect(seams.applied).toHaveLength(2);
  });

  it('re-bases on the live box when the card grows mid-drag, still keeping the grabbed point', () => {
    const seams = recordingSeams({ width: 224, height: 40 });
    const drag = createDragController(seams.deps);
    const start = centerOf(seams.liveBox());
    drag.beginGrab({ point: start, pointerId: 1 });
    const pointer = { x: start.x - 100, y: start.y - 60 };
    drag.trackMove({ point: pointer, pointerId: 1 });
    seams.growShape(224, 200); // rows arrived under the held pointer
    // One more move; the machine re-derives the offset from the honest live
    // box, so the grabbed point (offset-glued to the box's top edge) returns
    // under the stationary pointer instead of sliding with the growth.
    drag.trackMove({ point: pointer, pointerId: 1 });
    const relocated = seams.liveBox();
    expect(relocated.width).toBe(224);
    expect(relocated.height).toBe(200);
    // The grabbed point came from the center grab: pointer == box's top-left + (112, 20).
    expect(Math.abs(relocated.left + 112 - pointer.x)).toBeLessThan(1e-9);
    expect(Math.abs(relocated.top + 20 - pointer.y)).toBeLessThan(1e-9);
  });

  it('a viewport shrink re-clamps the next move against the live viewport', () => {
    const seams = recordingSeams({ width: 200, height: 40 });
    const drag = createDragController(seams.deps);
    const start = centerOf(seams.liveBox());
    drag.beginGrab({ point: start, pointerId: 1 });
    drag.trackMove({ point: { x: start.x - 400, y: start.y - 200 }, pointerId: 1 });
    seams.setViewport({ width: 640, height: 480 });
    drag.trackMove({ point: { x: 5000, y: 5000 }, pointerId: 1 });
    const box = seams.liveBox();
    expect(box.left).toBe(640 - MIN);
    expect(box.top).toBe(480 - MIN);
  });

  it('a dead chrome mid-drag freezes without throwing; the release cleans up', () => {
    const seams = recordingSeams({ width: 200, height: 40 });
    const drag = createDragController(seams.deps);
    const start = centerOf(seams.liveBox());
    drag.beginGrab({ point: start, pointerId: 1 });
    drag.trackMove({ point: { x: start.x - 100, y: start.y - 100 }, pointerId: 1 });
    seams.setShapeDetached(true); // the disable beat removes the chrome mid-drag
    expect(() => {
      drag.trackMove({ point: { x: 1, y: 1 }, pointerId: 1 });
    }).not.toThrow();
    expect(seams.applied).toHaveLength(1); // frozen: no further writes on a dead element
    expect(drag.isDragging()).toBe(true);
    expect(() => {
      drag.settle(1);
    }).not.toThrow();
    expect(drag.isDragging()).toBe(false);
    expect(seams.affordances.at(-1)).toBe(false);
  });
});
