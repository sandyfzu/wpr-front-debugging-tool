/**
 * The detection widget's drag machine: a pure state machine (grab → bounded
 * follow → settle/cancel) over injected seams, so the pointer semantics are
 * unit-pinned without a DOM and the runtime wiring stays thin.
 *
 * Owner decision (P12A.5, 2026-10-13): dragging joins the early start with
 * the position SESSION-LOCAL only — no storage write, no per-origin state;
 * a fresh mount starts at the stylesheet anchor (bottom-right 16/16), so
 * navigation/reload resets it by construction. `SB-D12`'s persisted-position
 * half stays full P12.
 *
 * Position model: the chrome carries the drag as a translate. The machine
 * tracks the translate it applied itself (`applied`); the live box read is
 * translated, so its untranslated origin is `rect − applied` — every move
 * re-derives against the LIVE box, which keeps the follow exact when the
 * card grows mid-drag (rows arriving) and keeps the clamp honest.
 *
 * Scroll stance (`SB-D16`): positions are viewport numbers re-clamped
 * against the live viewport on every move — a wheel/scroll during a drag
 * needs no handling at all (clamp-and-follow; the fixed chrome holds its
 * viewport position), and the machine never calls `preventDefault`.
 */

/** A viewport-coordinate pointer sample (`clientX`/`clientY`). */
export interface DragPoint {
  readonly x: number;
  readonly y: number;
}

/** The dragged shape's live box (`getBoundingClientRect`'s shape). */
export interface DragBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The live viewport extent the clamp is honest against. */
export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The drag tuning this module owns: one data table the machine and the
 * tests read; the wiring never hardcodes either number.
 */
export const DRAG_TUNING = Object.freeze({
  /** Pointer travel that turns a press into a drag (a shorter release stays a click). */
  moveSlopPx: 5,
  /** Smallest on-screen strip (px) kept visible on each axis, both directions. */
  minVisiblePx: 32
});

/**
 * Clamp a desired position so the box keeps `minVisible` px visible on each
 * axis in both directions (an edge-parked shape stays grabbable; nothing is
 * dragged fully off). When the clamp range inverts (a viewport smaller than
 * the shape plus the two margins), the range's left/top value wins — a
 * deterministic, never-NaN answer.
 *
 * @param desired The shape's desired viewport top-left.
 * @param size The shape's extent (translate-invariant).
 * @param viewport The live viewport.
 * @param minVisible The per-axis minimum visible strip.
 * @returns The clamped viewport top-left.
 */
export function clampDragPosition(
  desired: { readonly left: number; readonly top: number },
  size: { readonly width: number; readonly height: number },
  viewport: ViewportSize,
  minVisible: number
): { left: number; top: number } {
  const leftRange: [number, number] = [minVisible - size.width, viewport.width - minVisible];
  const topRange: [number, number] = [minVisible - size.height, viewport.height - minVisible];
  return {
    left: Math.max(leftRange[0], Math.min(desired.left, leftRange[1])),
    top: Math.max(topRange[0], Math.min(desired.top, topRange[1]))
  };
}

/** The seams the runtime satisfies with the real chrome/window; tests record. */
export interface DragMachineDeps {
  /** The live viewport, read per call (each move re-clamps against it). */
  readViewport(): ViewportSize;
  /** The dragged shape's live box; null once its element is gone (dead chrome). */
  readBox(): DragBox | null;
  /**
   * Apply the chrome's drag translate (px). `null` means "no translate":
   * the untouched stylesheet anchor — exactly what a first-drag cancel
   * restores.
   */
  applyPosition(position: { x: number; y: number } | null): void;
  /** Flip the chrome's dragging affordance (the grabbing-cursor state). */
  applyDragging(dragging: boolean): void;
}

/** The one instance per mount; every method below is idempotent per state. */
export interface DragController {
  /**
   * A pointer pressed a grab handle. While a drag is live, ANY press cancels
   * it (a right-press = `SB-D12`'s cancel nicety; a second pointer = the
   * multi-touch conflict) and never regrabs — a new drag needs a fresh press.
   * No-op on a dead chrome (null box).
   */
  beginGrab(input: { point: DragPoint; pointerId: number }): void;
  /** A pointermove; the drag's own pointer follows 1:1 (clamped), others are ignored. */
  trackMove(input: { point: DragPoint; pointerId: number }): void;
  /**
   * The drag's own pointer released: settle. The applied translate stays —
   * the dragged position is the session's (nothing persists anywhere else).
   */
  settle(pointerId: number): void;
  /** Restore the pre-drag position (Escape, pointercancel, lost pointer capture). */
  cancel(): void;
  /** Whether a drag is live (the wiring's Escape/capture decisions read it). */
  isDragging(): boolean;
  /** Read-and-clear the trailing-click suppression: true exactly once after a
   * drag actually moved (the press belonged to the drag, not to the pill).
   * A live moved drag suppresses too: the press's compat click can run
   * BEFORE its release (the right-press interleave dispatches `click` in the
   * middle of the held gesture — the machine's flag is not set yet). */
  consumeClickSuppression(): boolean;
}

/** The machine's internal live-drag state. */
interface ActiveDrag {
  /** The pointer the drag tracks (all other pointers are ignored mid-drag). */
  readonly pointerId: number;
  /** The press point (the slop's measuring origin). */
  readonly grabPoint: DragPoint;
  /** The pointer→shape-top-left offset fixed at grab (the 1:1 follow's basis). */
  readonly offset: DragPoint;
  /** The translate captured at grab (what a cancel restores). */
  readonly start: { x: number; y: number } | null;
  /** Whether the pointer crossed the slop (this drag repositioned). */
  moved: boolean;
}

/**
 * Build the drag controller. Pure over the injected seams: one instance
 * belongs to one mount, and its position/affordance writes are the only
 * writers of that mount's drag translate — a canceled drag restores to the
 * grab-time value by construction.
 *
 * @param deps The runtime seams (or the tests' recordings).
 */
export function createDragController(deps: DragMachineDeps): DragController {
  /** The chrome's current translate (the machine's own, not a DOM re-read). */
  let applied: { x: number; y: number } | null = null;
  /** Whether the grabbing affordance is on (flipped only while a drag follows). */
  let affordanceOn = false;
  /** The trailing-click suppression flag (read-and-clear by the pill's click). */
  let clickSuppression = false;
  /** The live drag, or null at rest. */
  let drag: ActiveDrag | null = null;

  const applyAffordance = (value: boolean): void => {
    if (affordanceOn === value) return;
    affordanceOn = value;
    deps.applyDragging(value);
  };

  return {
    beginGrab({ point, pointerId }) {
      if (drag !== null) {
        // Any press mid-drag cancels the drag (right-click nicety, second
        // pointer); the press itself never becomes a grab in the same beat.
        this.cancel();
        return;
      }
      const box = deps.readBox();
      if (box === null) return; // A dead chrome has nothing to drag.
      // A fresh press re-arms the pill's click: leftover suppression from a
      // drag whose click never landed must not eat an innocent follow-up tap.
      clickSuppression = false;
      drag = {
        pointerId,
        grabPoint: { ...point },
        offset: { x: point.x - box.left, y: point.y - box.top },
        start: applied,
        moved: false
      };
    },

    trackMove({ point, pointerId }) {
      if (drag === null || drag.pointerId !== pointerId) return;
      if (!drag.moved) {
        const dx = point.x - drag.grabPoint.x;
        const dy = point.y - drag.grabPoint.y;
        if (Math.hypot(dx, dy) < DRAG_TUNING.moveSlopPx) return;
        // The press became a drag past the slop: only now is it one.
        drag.moved = true;
        applyAffordance(true);
      }
      const box = deps.readBox();
      if (box === null) return; // Dead chrome mid-drag: freeze; settle/cancel cleans up.
      // The live box already carries the applied translate; subtract it to
      // re-base on the chrome's untranslated origin, even when the shape
      // resized under the pointer mid-drag.
      const clamped = clampDragPosition(
        { left: point.x - drag.offset.x, top: point.y - drag.offset.y },
        { width: box.width, height: box.height },
        deps.readViewport(),
        DRAG_TUNING.minVisiblePx
      );
      const next = {
        x: clamped.left - (box.left - (applied?.x ?? 0)),
        y: clamped.top - (box.top - (applied?.y ?? 0))
      };
      if (applied === null || applied.x !== next.x || applied.y !== next.y) {
        applied = next;
        deps.applyPosition(next);
      }
    },

    settle(pointerId) {
      if (drag === null || drag.pointerId !== pointerId) return; // A stray release never settles another drag.
      clickSuppression = drag.moved;
      drag = null;
      // The applied translate stays: the dragged position is the session's.
      applyAffordance(false);
    },

    cancel() {
      if (drag === null) return;
      const previous = drag;
      drag = null;
      applied = previous.start;
      if (previous.moved) clickSuppression = true;
      applyAffordance(false);
      deps.applyPosition(previous.start);
    },

    isDragging() {
      return drag !== null;
    },

    consumeClickSuppression() {
      // Two writers feed one answer: the settled drags' flag, and a live
      // moved drag (whose release has not landed — the interleave's click).
      if (drag?.moved === true) return true;
      const value = clickSuppression;
      clickSuppression = false;
      return value;
    }
  };
}
