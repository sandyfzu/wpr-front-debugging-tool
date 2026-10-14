/**
 * The drag machine: the slop→drag boundary, the bounded follow (clamped
 * edges, exact 1:1 offsets, live re-basing on shape growth and viewport
 * shrink), the settle/cancel/restore paths, the click suppression, the
 * wrong-pointer/wrong-button immunity, and the at-rest `reclamp` over the
 * resting layout box — over recording seams, no DOM.
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
/** The air margin the full-visibility clamp keeps (DRAG_TUNING's figure). */
const MARGIN = DRAG_TUNING.containmentMarginPx;

/**
 * Recording seams over a font-accurate stand-in for the chrome: the shape
 * hangs off the bottom-right resting anchor (an un-translated origin that
 * moves when the shape grows, like the real anchored card), the applied
 * translate moves the live box (getBoundingClientRect includes transforms),
 * and the viewport is settable per test.
 *
 * Two shape reads model the machine's two geometric truths independently:
 * `readBox` is the LIVE rect (the animated presentation — a test may bend it
 * away from the layout with `setLiveDistortion`, a mid-choreography pose),
 * and `readRestingBox` is the offset-derived layout truth — sizes rounded
 * to whole px like the CSSOM fixed `offset*` longs, position carrying the
 * fixed per-pose quantization residual `setRestingOffset` models. Killing
 * the resting read alone (`setRestingUnavailable`) models a vanished chrome
 * while the live rect still answers.
 */
function recordingSeams(initialSize: { width: number; height: number }): {
  deps: DragMachineDeps;
  /** Every applied translate (nulls included, in order). */
  applied: Array<{ x: number; y: number } | null>;
  /** Every affordance flip, in order. */
  affordances: boolean[];
  /** The DOM-honest live box (the shape + its translate). */
  liveBox(): DragBox;
  /** The DOM-honest resting box (the settled pose; nulls included). */
  restingBox(): DragBox | null;
  /** Set the shape's extent (the card grows when its rows arrive mid-drag). */
  growShape(width: number, height: number): void;
  /** Set the live viewport (a resize mid-drag re-clamps). */
  setViewport(viewport: ViewportSize): void;
  /** Detach the shape (a disable mid-drag: reads answer null). */
  setShapeDetached(detached: boolean): void;
  /** Bend the live rect away from the layout (a mid-choreography pose). */
  setLiveDistortion(distortion: { x: number; y: number }): void;
  /** The resting read's constant offset-quantization residual per pose. */
  setRestingOffset(offset: { left: number; top: number }): void;
  /** Make only the resting read answer null (the chrome's reads are gone). */
  setRestingUnavailable(unavailable: boolean): void;
} {
  let shape = { ...initialSize };
  let viewport = REST_VIEWPORT;
  let translate: { x: number; y: number } | null = null;
  let detached = false;
  let restingUnavailable = false;
  let distortion = { x: 0, y: 0 };
  let restingOffset = { left: 0, top: 0 };
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
        return {
          left: untrans.left + offset.x + distortion.x,
          top: untrans.top + offset.y + distortion.y,
          ...shape
        };
      },
      readRestingBox: () => {
        if (detached || restingUnavailable) return null;
        const offset = translate ?? { x: 0, y: 0 };
        const untrans = {
          left: viewport.width - ANCHOR_PX - shape.width,
          top: viewport.height - ANCHOR_PX - shape.height
        };
        return {
          left: untrans.left + offset.x + restingOffset.left,
          top: untrans.top + offset.y + restingOffset.top,
          width: Math.round(shape.width),
          height: Math.round(shape.height)
        };
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
        left: viewport.width - ANCHOR_PX - shape.width + offset.x + distortion.x,
        top: viewport.height - ANCHOR_PX - shape.height + offset.y + distortion.y,
        ...shape
      };
    },
    restingBox: () => {
      // Mirrors readRestingBox exactly (nulls included).
      if (detached || restingUnavailable) return null;
      const offset = translate ?? { x: 0, y: 0 };
      return {
        left: viewport.width - ANCHOR_PX - shape.width + offset.x + restingOffset.left,
        top: viewport.height - ANCHOR_PX - shape.height + offset.y + restingOffset.top,
        width: Math.round(shape.width),
        height: Math.round(shape.height)
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
    },
    setLiveDistortion: (next) => {
      distortion = next;
    },
    setRestingOffset: (next) => {
      restingOffset = next;
    },
    setRestingUnavailable: (value) => {
      restingUnavailable = value;
    }
  };
}

/** The center point of one box. */
const centerOf = (box: DragBox): DragPoint => ({
  x: box.left + box.width / 2,
  y: box.top + box.height / 2
});

describe('clampDragPosition (full containment — the owner binding)', () => {
  const shape = { width: 200, height: 40 };

  it('keeps an interior position untouched', () => {
    expect(clampDragPosition({ left: 100, top: 100 }, shape, REST_VIEWPORT, MARGIN)).toEqual({
      left: 100,
      top: 100
    });
  });

  it('contains the whole box against the left/top edge, MARGIN px inside', () => {
    const parked = clampDragPosition({ left: -1000, top: -1000 }, shape, REST_VIEWPORT, MARGIN);
    expect(parked.left).toBe(MARGIN);
    expect(parked.top).toBe(MARGIN);
    expect(parked.left + shape.width).toBeLessThanOrEqual(REST_VIEWPORT.width);
    expect(parked.top + shape.height).toBeLessThanOrEqual(REST_VIEWPORT.height);
  });

  it('contains the whole box against the right/bottom edge, MARGIN px inside', () => {
    const parked = clampDragPosition({ left: 2000, top: 2000 }, shape, REST_VIEWPORT, MARGIN);
    expect(parked.left).toBe(REST_VIEWPORT.width - MARGIN - shape.width);
    expect(parked.top).toBe(REST_VIEWPORT.height - MARGIN - shape.height);
  });

  it('is drift-free: clamping again changes nothing', () => {
    const first = clampDragPosition({ left: -500, top: 3000 }, shape, REST_VIEWPORT, MARGIN);
    expect(clampDragPosition(first, shape, REST_VIEWPORT, MARGIN)).toEqual(first);
  });

  it('a viewport too small for the shape one-sides to the left/top margin (never NaN)', () => {
    const tiny: ViewportSize = { width: 60, height: 60 };
    const narrow = clampDragPosition(
      { left: 1000, top: 1000 },
      { width: 100, height: 100 },
      tiny,
      MARGIN
    );
    // The inverted range [MARGIN, tiny.width − MARGIN − width] collapses to
    // its lower bound for any desired value: deterministic, finite, parked
    // at the left/top margin.
    expect(narrow.left).toBe(MARGIN);
    expect(Number.isNaN(narrow.left + narrow.top)).toBe(false);
    const shifted = clampDragPosition(
      { left: -1000, top: -1000 },
      { width: 100, height: 100 },
      tiny,
      MARGIN
    );
    expect(shifted.left).toBe(MARGIN);
    expect(shifted.top).toBe(MARGIN);
  });

  it('resolves the negative available range deterministically (never NaN)', () => {
    const shape100 = { width: 100, height: 100 };
    const free = clampDragPosition(
      { left: 0, top: 0 },
      shape100,
      { width: 10, height: 10 },
      MARGIN
    );
    // Range [MARGIN, 10−MARGIN−100] = [4, −94] is inverted: the lower (left/
    // top) bound wins, always finite.
    expect(free.left).toBe(MARGIN);
    expect(free.top).toBe(MARGIN);
    expect(Number.isNaN(free.left + free.top)).toBe(false);
    const lower = clampDragPosition(
      { left: -1000, top: -1000 },
      shape100,
      { width: 10, height: 10 },
      MARGIN
    );
    expect(lower.left).toBe(MARGIN);
    expect(lower.top).toBe(MARGIN);
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

  it('clamps all four edges while following, keeping the whole box inside', () => {
    const seams = recordingSeams({ width: 200, height: 40 });
    const drag = createDragController(seams.deps);
    drag.beginGrab({ point: centerOf(seams.liveBox()), pointerId: 1 });
    drag.trackMove({ point: { x: -5000, y: -5000 }, pointerId: 1 });
    const upper = seams.applied.at(-1);
    // The box parks fully inside, MARGIN px off the anchored edge pair.
    expect(upper?.x).toBe(MARGIN - (REST_VIEWPORT.width - ANCHOR_PX - 200));
    expect(upper?.y).toBe(MARGIN - (REST_VIEWPORT.height - ANCHOR_PX - 40));
    drag.trackMove({ point: { x: 5000, y: 5000 }, pointerId: 1 });
    const box = seams.liveBox();
    expect(box.left).toBe(REST_VIEWPORT.width - MARGIN - 200);
    expect(box.top).toBe(REST_VIEWPORT.height - MARGIN - 40);
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

  it('settle by the drag\u2019s own pointer is the capture-loss ender: the clamped commit stays', () => {
    // The wiring's trusted lostpointercapture arm routes here (the event
    // carries the losing pointer's id): an engine may drop the capture
    // mid-gesture with neither pointercancel nor a release event (the
    // pointer leaving the window during a quick release does this). Ending
    // by settle keeps the follow's clamped commit — restoring the grab-time
    // state there would snap a mid-flight chrome back to its start and eat
    // the moves' writes; the genuinely canceling paths keep their own arms.
    const seams = recordingSeams({ width: 200, height: 40 });
    const drag = createDragController(seams.deps);
    const start = centerOf(seams.liveBox());
    drag.beginGrab({ point: start, pointerId: 1 });
    // One far out-of-bounds follow: the clamp parked the box at the margins.
    drag.trackMove({ point: { x: -5000, y: -5000 }, pointerId: 1 });
    const parked = seams.applied.at(-1);
    expect(parked, 'the out-of-bounds follow clamped to the containment bound').toEqual({
      x: MARGIN - (REST_VIEWPORT.width - ANCHOR_PX - 200),
      y: MARGIN - (REST_VIEWPORT.height - ANCHOR_PX - 40)
    });
    // The capture is lost before any release: settle by the losing pointer.
    drag.settle(1);
    expect(drag.isDragging()).toBe(false);
    expect(seams.applied.at(-1)).toEqual(parked); // the clamped commit stayed
    expect(seams.affordances).toEqual([true, false]);
    // A straggler release afterwards finds no drag: no position change.
    drag.settle(1);
    expect(seams.applied.at(-1)).toEqual(parked);
    // The lost gesture's trailing compat click is suppressed once.
    expect(drag.consumeClickSuppression()).toBe(true);
    expect(drag.consumeClickSuppression()).toBe(false);
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

  it('re-bases on the live box when the card grows mid-drag, keeping the grabbed point', () => {
    const seams = recordingSeams({ width: 224, height: 40 });
    const drag = createDragController(seams.deps);
    const start = centerOf(seams.liveBox());
    drag.beginGrab({ point: start, pointerId: 1 });
    const pointer = { x: start.x - 100, y: start.y - 60 };
    drag.trackMove({ point: pointer, pointerId: 1 });
    seams.growShape(224, 100); // rows arrive under the held pointer
    // One more move; the machine re-derives the offset from the honest live
    // box, so the grabbed point (offset-glued to the box's top edge) returns
    // under the stationary pointer instead of sliding with the growth.
    drag.trackMove({ point: pointer, pointerId: 1 });
    const relocated = seams.liveBox();
    expect(relocated.width).toBe(224);
    expect(relocated.height).toBe(100);
    // The grabbed point came from the center grab: pointer == box's top-left + (112, 20).
    expect(Math.abs(relocated.left + 112 - pointer.x)).toBeLessThan(1e-9);
    expect(Math.abs(relocated.top + 20 - pointer.y)).toBeLessThan(1e-9);
  });

  it('a growth that cannot keep the grab point clamps instead: containment wins over the pointer', () => {
    const seams = recordingSeams({ width: 224, height: 40 });
    const drag = createDragController(seams.deps);
    const start = centerOf(seams.liveBox());
    drag.beginGrab({ point: start, pointerId: 1 });
    const pointer = { x: start.x - 100, y: start.y - 60 };
    drag.trackMove({ point: pointer, pointerId: 1 });
    // The card grew to a size whose desired top (pointer − offset) sits past
    // the containment bound: the follow can no longer pin the grab point.
    seams.growShape(224, 200);
    drag.trackMove({ point: pointer, pointerId: 1 });
    const relocated = seams.liveBox();
    expect(relocated.height).toBe(200);
    // The bottom edge parks exactly at the containment margin; the box rose
    // as high as full visibility allows.
    expect(relocated.top + relocated.height).toBe(REST_VIEWPORT.height - MARGIN);
    expect(relocated.top).toBeLessThan(pointer.y); // the grab point left the pointer
    expect(relocated.left).toBe(seams.liveBox().left); // the horizontal follow was in bounds
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
    expect(box.left).toBe(640 - MARGIN - 200);
    expect(box.top).toBe(480 - MARGIN - 40);
  });

  describe('reclamp (the resting containment leg)', () => {
    it('a mount inside the viewport writes nothing and answers false', () => {
      const seams = recordingSeams({ width: 200, height: 40 });
      const drag = createDragController(seams.deps);
      expect(drag.reclamp()).toBe(false);
      expect(seams.applied).toEqual([]);
    });

    it('an outside resting position re-clamps with one write, fully inside where it fits', () => {
      const seams = recordingSeams({ width: 200, height: 40 });
      const drag = createDragController(seams.deps);
      // A real violation: the shape grows past what the viewport+anchor can
      // contain (the card grew past the visible height).
      seams.growShape(200, 800);
      expect(drag.reclamp()).toBe(true);
      const box = seams.liveBox();
      // The horizontal anchor position was inside and stayed untouched;
      // the vertical one clamps back to the top margin.
      expect(box.left).toBe(REST_VIEWPORT.width - ANCHOR_PX - 200);
      expect(box.top).toBe(MARGIN);
      expect(seams.applied).toEqual([{ x: 0, y: 20 }]);
      // Idempotent: the re-clamped box reclamps nothing again.
      expect(drag.reclamp()).toBe(false);
      expect(seams.applied).toHaveLength(1);
    });

    it('a shrunk viewport re-clamps a committed position against its own bounds', () => {
      const seams = recordingSeams({ width: 200, height: 40 });
      const drag = createDragController(seams.deps);
      const start = centerOf(seams.liveBox());
      drag.beginGrab({ point: start, pointerId: 1 });
      drag.trackMove({ point: { x: start.x - 300, y: start.y - 30 }, pointerId: 1 });
      drag.settle(1);
      expect(seams.applied.at(-1)).toEqual({ x: -300, y: -30 });
      seams.setViewport({ width: 100, height: 60 });
      // The live box (live anchor + the committed translate) now violates
      // the left/top containment of its 100×60 window.
      expect(seams.liveBox().left).toBeLessThan(MARGIN);
      expect(drag.reclamp()).toBe(true);
      const box = seams.liveBox();
      // A 200-wide shape cannot fully fit a 100-px viewport: the clamp
      // degrades one-sided to the left/top margins (both reachable, tested
      // in clampDragPosition's inverted-range pins).
      expect(box.left).toBe(MARGIN);
      expect(box.top).toBe(MARGIN);
      expect(drag.reclamp()).toBe(false);
      expect(seams.applied).toHaveLength(2);
    });

    it('a live drag defers to its moves (reclamp is a no-op while grabbing)', () => {
      const seams = recordingSeams({ width: 200, height: 40 });
      const drag = createDragController(seams.deps);
      const start = centerOf(seams.liveBox());
      drag.beginGrab({ point: start, pointerId: 1 });
      drag.trackMove({ point: { x: start.x - 40, y: start.y - 20 }, pointerId: 1 });
      seams.setViewport({ width: 100, height: 100 });
      expect(drag.reclamp()).toBe(false);
      expect(seams.applied).toHaveLength(1); // the drag's own write only
      expect(drag.isDragging()).toBe(true);
    });

    it('a dead shape answers false with no write', () => {
      const seams = recordingSeams({ width: 200, height: 40 });
      const drag = createDragController(seams.deps);
      seams.setShapeDetached(true);
      expect(drag.reclamp()).toBe(false);
      expect(seams.applied).toEqual([]);
    });

    it('the untouched anchor is not rewritten when it already sits inside', () => {
      const seams = recordingSeams({ width: 224, height: 40 });
      const drag = createDragController(seams.deps);
      // Identity read first (no write), a violation read second (one write).
      expect(drag.reclamp()).toBe(false);
      seams.setViewport({ width: 100, height: 60 });
      expect(drag.reclamp()).toBe(true);
      expect(seams.applied).toHaveLength(1);
      const box = seams.liveBox();
      // Same one-sided degradation as the shrink re-clamp: the shape outgrew
      // this viewport, the box parks at the left/top margins.
      expect(box.left).toBe(MARGIN);
      expect(box.top).toBe(MARGIN);
    });

    it('a mid-choreography live breach moves nothing when the resting pose is inside', () => {
      // The resting seam's whole point: clamping targets the choreography's
      // END geometry. A live rect read mid-entrance (distorted far past the
      // edges) is not the chrome's settled truth — the settled box sits
      // inside, so the re-clamp answers false and writes nothing.
      const seams = recordingSeams({ width: 224, height: 40 });
      const drag = createDragController(seams.deps);
      seams.setLiveDistortion({ x: -1500, y: -900 });
      expect(seams.liveBox().left, 'the live rect reads breached').toBeLessThan(0);
      expect(drag.reclamp()).toBe(false);
      expect(seams.applied).toEqual([]);
    });

    it('reclamp clamps the settled geometry: applyPosition gets the resting-derived translate', () => {
      // The owner scenario: the card opens beyond the top edge while its
      // entrance still poses the LIVE rect inside. The re-clamp must target
      // the resting box's containment — its translate, computed from the
      // settled geometry only.
      const seams = recordingSeams({ width: 224, height: 40 });
      const drag = createDragController(seams.deps);
      // A real drag parked the pill at the top margin, released.
      const start = centerOf(seams.liveBox());
      drag.beginGrab({ point: start, pointerId: 1 });
      drag.trackMove({ point: { x: start.x - 300, y: start.y - 5000 }, pointerId: 1 });
      drag.settle(1);
      // Parked: the box's top sits at the margin, the anchor's right corner intact.
      expect(seams.liveBox().top).toBe(MARGIN);
      // The card opens (rows landed): the resting box (bottom-anchored)
      // now breaches the top edge — and the mid-entrance pose shows the
      // LIVE rect safely inside.
      seams.growShape(224, 420);
      seams.setLiveDistortion({ x: 0, y: 430 });
      expect(seams.liveBox().top, 'the animated pose reads inside').toBeGreaterThan(0);
      // The parked pose IS the resting one here (resting = live minus distortion).
      expect(drag.reclamp()).toBe(true);
      // The resting-derived translate: the settled card's top (breaching at
      // the parked pose's 376-px offset) parks exactly at the margin — its
      // y = 4 − ((364 − 740) − (−740)) = −360. Nothing LIVE entered the
      // math: the animated pose read inside, so a live-derived clamp would
      // not have written at all.
      expect(seams.applied.at(-1)).toEqual({ x: -300, y: -360 });
      // The SETTLED card is held at the margin now; idempotent at rest with
      // exact reads: the second call writes nothing.
      expect(seams.restingBox()?.top).toBe(MARGIN);
      expect(drag.reclamp()).toBe(false);
      expect(seams.applied).toHaveLength(2);
    });

    it('a live drag keeps the live-box follow even while the resting box deviates', () => {
      // The drag's own truth is 1:1 pointer follow — every move clamps the
      // LIVE box (the animated presentation is what the user manipulates);
      // the resting seam serves the at-rest re-clamp only.
      const seams = recordingSeams({ width: 224, height: 40 });
      const drag = createDragController(seams.deps);
      const start = centerOf(seams.liveBox());
      drag.beginGrab({ point: start, pointerId: 1 });
      drag.trackMove({ point: { x: start.x - 300, y: start.y - 5000 }, pointerId: 1 });
      drag.settle(1);
      seams.growShape(224, 420);
      seams.setLiveDistortion({ x: -80, y: 430 });
      drag.beginGrab({ point: centerOf(seams.liveBox()), pointerId: 2 });
      drag.trackMove({ point: { x: -5000, y: -5000 }, pointerId: 2 });
      // The landed translate pins the distorted LIVE box at the margins
      // (its y −790 = 4 − (54 + 740); a resting-derived write would land
      // −360, its x −1036 against the live −956 — straight from the live
      // box math).
      expect(seams.applied.at(-1)).toEqual({ x: -956, y: -790 });
      expect(seams.liveBox().left).toBe(MARGIN);
      expect(seams.liveBox().top).toBe(MARGIN);
    });

    it('a null resting read is no clamp; the live drag path stays fully alive', () => {
      // Deliberate fallback: the resting read is the re-clamp's sole
      // authority — null (no honest layout read) means no clamp, never a
      // fallback to the live rect; the draggable paths read the live box
      // either way.
      const seams = recordingSeams({ width: 224, height: 40 });
      const drag = createDragController(seams.deps);
      seams.setRestingUnavailable(true);
      seams.setLiveDistortion({ x: -1500, y: -900 });
      expect(seams.liveBox().left, 'the live rect would clamp').toBeLessThan(0);
      expect(drag.reclamp()).toBe(false);
      expect(seams.applied).toEqual([]);
      // The drag itself runs on the live box as always: grab, far move —
      // one clamp write derived from the live rect; then at rest the
      // re-clamp is the honest no-op it is (the resting read is gone).
      seams.setLiveDistortion({ x: 0, y: 0 });
      const start = centerOf(seams.liveBox());
      drag.beginGrab({ point: start, pointerId: 1 });
      drag.trackMove({ point: { x: -5000, y: -5000 }, pointerId: 1 });
      expect(seams.applied).toHaveLength(1);
      expect(seams.liveBox().left).toBe(MARGIN);
      drag.settle(1);
      expect(drag.reclamp()).toBe(false);
      expect(seams.applied).toHaveLength(1);
    });

    it('a sub-quantum reclamp delta is offset residue, not movement (idempotence under quantization)', () => {
      const epsilon = DRAG_TUNING.reclampQuantumPx;
      // A parked pose flush against the containment margin, then the
      // resting read gains its constant offset-quantization residual: the
      // rounded offset* values put the box a hair past the margin bound, so
      // every naive re-clamp "moves" sub-quantum — a spurious position
      // write on every trigger. The mask answers residue, not movement.
      const seams = recordingSeams({ width: 224, height: 40 });
      const drag = createDragController(seams.deps);
      const start = centerOf(seams.liveBox());
      drag.beginGrab({ point: start, pointerId: 1 });
      drag.trackMove({ point: { x: start.x - 300, y: start.y - 5000 }, pointerId: 1 });
      drag.settle(1);
      // The card grew: its resting box breaches the top edge — a real
      // re-clamp (one write), whose pose the quantized trigger then reads.
      seams.growShape(224, 420);
      seams.setLiveDistortion({ x: 0, y: 430 });
      expect(drag.reclamp()).toBe(true);
      const appliedCount = seams.applied.length;
      // Just UNDER the quantum: masked, twice — no writes at all.
      seams.setRestingOffset({ left: 0, top: -(epsilon - 0.1) });
      expect(drag.reclamp()).toBe(false);
      expect(drag.reclamp()).toBe(false);
      expect(seams.applied).toHaveLength(appliedCount);
      // Just OVER it: a real movement, written exactly once — and the
      // follow-up read converges (the quantized value then sits inside the
      // bound), so the second call writes nothing more.
      seams.setRestingOffset({ left: 0, top: -(epsilon + 0.1) });
      expect(drag.reclamp()).toBe(true);
      expect(seams.applied).toHaveLength(appliedCount + 1);
      expect(drag.reclamp()).toBe(false);
      expect(seams.applied).toHaveLength(appliedCount + 1);
    });
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
