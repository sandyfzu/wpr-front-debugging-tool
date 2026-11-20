/** The detail wheel rule: delta units, and which clipping layers scroll before a nested box takes the wheel. */
import { describe, expect, it } from 'vitest';
import { planReveal, WHEEL_LINE_PX, wheelDeltaPx, type ClipLayer } from './detail-wheel';

describe('wheelDeltaPx', () => {
  it('keeps px, scales lines and pages', () => {
    expect(wheelDeltaPx(120, 0, 400)).toBe(120);
    expect(wheelDeltaPx(-3, 1, 400)).toBe(-3 * WHEEL_LINE_PX);
    expect(wheelDeltaPx(1, 2, 400)).toBe(400);
    expect(wheelDeltaPx(-1, 2, 250)).toBe(-250);
  });

  it('reads an unknown mode as px and a non-finite delta as none', () => {
    expect(wheelDeltaPx(40, 7, 400)).toBe(40);
    expect(wheelDeltaPx(Number.NaN, 0, 400)).toBe(0);
    expect(wheelDeltaPx(Number.POSITIVE_INFINITY, 1, 400)).toBe(0);
  });
});

/**
 * A layer whose client area is `top…bottom`, scrolled to `scrollTop` of
 * `scrollHeight` (`null` scroll: clips only).
 */
function layer(
  top: number,
  bottom: number,
  scroll?: { scrollTop: number; scrollHeight: number }
): ClipLayer {
  return {
    span: { top, bottom },
    scroll: scroll ? { ...scroll, clientHeight: bottom - top } : null
  };
}

/** A 0…400 view scrolled to `scrollTop` of 1 000 px, inside a tall viewport. */
function viewOnly(scrollTop = 100): ClipLayer[] {
  return [layer(0, 400, { scrollTop, scrollHeight: 1_000 }), layer(0, 2_000)];
}

describe('planReveal — the view alone', () => {
  it('scrolls the view down while the box is cut off at the bottom, never past it', () => {
    // 260 px of the box hidden below: the whole 120 px tick goes to the view.
    expect(planReveal(120, { top: 300, bottom: 660 }, viewOnly())).toEqual({
      steps: [120, 0],
      rest: 0
    });
  });

  it('hands the rest of the tick to the box once it is whole (a flick is not cut short)', () => {
    expect(planReveal(120, { top: 10, bottom: 430 }, viewOnly())).toEqual({
      steps: [30, 0],
      rest: 90
    });
    expect(planReveal(3_000, { top: 300, bottom: 660 }, viewOnly())).toEqual({
      steps: [260, 0],
      rest: 2_740
    });
  });

  it('never scrolls the view past its own end; the box takes the rest', () => {
    // 500 px hidden, but the view has only 40 px left to scroll.
    expect(planReveal(120, { top: 300, bottom: 900 }, viewOnly(560))).toEqual({
      steps: [40, 0],
      rest: 80
    });
  });

  it('leaves the tick to the browser once the box is on screen that way, or nothing can move', () => {
    expect(planReveal(120, { top: 40, bottom: 400 }, viewOnly())).toBeNull();
    // Within the 1 px slack.
    expect(planReveal(120, { top: 40, bottom: 400.6 }, viewOnly())).toBeNull();
    // At the view's end: the box takes it (it is as visible as it gets).
    expect(planReveal(120, { top: 300, bottom: 900 }, viewOnly(600))).toBeNull();
  });

  it('mirrors the rule upward: reveal the box top first, then the box', () => {
    expect(planReveal(-120, { top: -300, bottom: 200 }, viewOnly())).toEqual({
      steps: [-100, 0],
      rest: -20
    });
    expect(planReveal(-120, { top: -50, bottom: 200 }, viewOnly())).toEqual({
      steps: [-50, 0],
      rest: -70
    });
    expect(planReveal(-120, { top: -300, bottom: 200 }, viewOnly(30))).toEqual({
      steps: [-30, 0],
      rest: -90
    });
    expect(planReveal(-120, { top: 0, bottom: 200 }, viewOnly())).toBeNull();
    expect(planReveal(-120, { top: -300, bottom: 200 }, viewOnly(0))).toBeNull();
  });

  it('does nothing without a delta or layers', () => {
    expect(planReveal(0, { top: 300, bottom: 900 }, viewOnly())).toBeNull();
    expect(planReveal(Number.NaN, { top: 300, bottom: 900 }, viewOnly())).toBeNull();
    expect(planReveal(120, { top: 300, bottom: 900 }, [])).toBeNull();
  });
});

describe('planReveal — a view clipped by the panel (short docks)', () => {
  /**
   * A 760 × 260 drill-in: the drill body (100…437, scrollable 129) reaches
   * below the panel's content scroller (40…260, scrolled `outerTop` of a
   * 100 px range) and the 260 px viewport.
   */
  function shortDock(outerTop: number): ClipLayer[] {
    return [
      layer(100, 437, { scrollTop: 0, scrollHeight: 466 }),
      layer(40, 260, { scrollTop: outerTop, scrollHeight: 320 }),
      layer(0, 260)
    ];
  }

  it('scrolls the panel first to bring the view on screen, then the view', () => {
    // The box (250…398) is whole inside the view but its bottom is 138 px below the screen.
    // The panel's 100 px first, the tick's last 20 px to the view.
    expect(planReveal(120, { top: 250, bottom: 398 }, shortDock(0))).toEqual({
      steps: [20, 100, 0],
      rest: 0
    });
    expect(planReveal(160, { top: 250, bottom: 398 }, shortDock(0))).toEqual({
      steps: [38, 100, 0],
      rest: 22
    });
  });

  it('scrolls the view when the panel is at its end (the box then reaches the screen edge)', () => {
    expect(planReveal(120, { top: 250, bottom: 398 }, shortDock(100))).toEqual({
      steps: [120, 0, 0],
      rest: 0
    });
  });

  it('never moves a layer outside the edge that hides the box', () => {
    // The view's own bottom (400) hides the box; the panel (to 800) and the page could move but would carry that edge along.
    const layers = [
      layer(0, 400, { scrollTop: 0, scrollHeight: 1_000 }),
      layer(0, 800, { scrollTop: 0, scrollHeight: 2_000 }),
      layer(0, 900, { scrollTop: 0, scrollHeight: 3_000 })
    ];
    expect(planReveal(120, { top: 300, bottom: 660 }, layers)).toEqual({
      steps: [120, 0, 0],
      rest: 0
    });
  });

  it('on equal edges, moves the innermost (the outer one would move that edge too)', () => {
    const layers = [
      layer(0, 400, { scrollTop: 0, scrollHeight: 1_000 }),
      layer(0, 400, { scrollTop: 0, scrollHeight: 2_000 })
    ];
    expect(planReveal(120, { top: 300, bottom: 660 }, layers)?.steps).toEqual([120, 0]);
  });

  it('skips layers that only clip, and leaves the tick when none inside can move', () => {
    // The viewport hides the box; the panel between can move.
    const layers = [
      layer(0, 600, { scrollTop: 0, scrollHeight: 600 }),
      layer(0, 500, { scrollTop: 0, scrollHeight: 700 }),
      layer(0, 300)
    ];
    expect(planReveal(120, { top: 200, bottom: 450 }, layers)).toEqual({
      steps: [0, 120, 0],
      rest: 0
    });
    // Nothing inside the hiding edge has room: the browser keeps the tick.
    const stuck = [layer(0, 600, { scrollTop: 0, scrollHeight: 600 }), layer(0, 300)];
    expect(planReveal(120, { top: 200, bottom: 450 }, stuck)).toBeNull();
  });

  it('mirrors upward through the layers', () => {
    // The panel's top edge (40) hides the box top (20) more than the view's
    // (30): the panel scrolls up 20, which takes the view's edge to 50, so
    // the view then scrolls up 10; the rest goes to the box.
    const layers = [
      layer(30, 367, { scrollTop: 50, scrollHeight: 466 }),
      layer(40, 260, { scrollTop: 60, scrollHeight: 320 }),
      layer(0, 260)
    ];
    expect(planReveal(-120, { top: 20, bottom: 168 }, layers)).toEqual({
      steps: [-10, -20, 0],
      rest: -90
    });
  });
});
