/**
 * The detection widget's drag machine: a pure state machine (grab → bounded
 * follow → settle/cancel) over injected seams, so the pointer semantics are
 * unit-pinned without a DOM and the runtime wiring stays thin.
 *
 * Persistence (`SB-D12`): the machine stays storage-free. A settle that
 * ended a moved drag hands back the committed translate (the wiring stores
 * it per origin — one write per drop); cancels hand back nothing, so a
 * restored pre-drag position is never stored. A stored translate re-enters
 * through `restore`, after which the wiring re-clamps it like any resting
 * position (the stored value is a hint, never a promise of fit).
 *
 * Owner binding (P12A feedback round, 2026-10-14): the chrome is FULLY
 * contained in the viewport, in both states, at rest and during a drag — no
 * strip of anything may sit offscreen. Hiding is the context-menu toggle's
 * (and the coming shortcut's) job; nothing needs to be parked past the edge.
 * The clamp therefore holds the whole box `containmentMarginPx` px inside
 * every edge, and the machine re-clamps at rest (`reclamp`) — the wiring
 * calls it when the viewport or the box changes and renders the move
 * smoothly, never during active manipulation.
 *
 * Position model: the chrome carries the drag as a translate. The machine
 * tracks the translate it applied itself (`applied`); the live box read is
 * translated, so its untranslated origin is `rect − applied` — every move
 * re-derives against the LIVE box, which keeps the follow exact when the
 * card grows mid-drag (rows arriving) and keeps the clamp honest.
 *
 * Two shape reads separate two truths: the live box (the animated
 * presentation — the drag's source, since 1:1 pointer follow is the drag's
 * own contract) and the resting box (the transform-invariant layout — the
 * `reclamp` source, since a clamp must target the choreography's end
 * geometry, not the pose a mid-entrance sample happens to present).
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
  /**
   * Full-visibility air margin (px): the whole box stays this far inside
   * every viewport edge, always. Full visibility is the owner binding ("not
   * outside at all"); the small air keeps the chrome's elevation shadow and
   * its grab affordances off the viewport's own hem, and it is exactly the
   * brief's "clamped 4 px inside the viewport" (SB-D12) — with the strip
   * figure gone, the drag-time clamp and the brief's drop clamp are one
   * geometry.
   */
  containmentMarginPx: 4,
  /**
   * The re-clamp's measurement quantum (px): a computed {@link DragController.reclamp}
   * delta under this figure is the resting read's integer quantization
   * (CSSOM-View serves `offset*` as longs, ≤ ½ px per value), never intent —
   * masked, so an already-settled pose stays idempotent across repeated
   * triggers instead of micro-jittering < 1 px on every one. One px is the
   * plus of a position/size quantization pair (≤ ½ px each). The mask keeps
   * the pose it read, so it can hold a pose whose REAL position sits up to
   * the edge read's whole quantization budget past the margin it seems to
   * satisfy (each edge air combines independently rounded reads: position
   * `offset*` + size `offset*` + the viewport's own integer rounding — ≤
   * ~1–1.5 px per edge): a fully masked pose's reachable worst-case air is
   * ≈ 2 px (vertical) / ~2.5 px (horizontal), always ≥ 0 — so the owner's
   * no-part-offscreen binding never yields to the mask.
   */
  reclampQuantumPx: 1
});

/**
 * Clamp a desired position so the WHOLE box stays inside the viewport with
 * `margin` px of air on each side (full containment — the owner binding:
 * never any part offscreen). When a viewport cannot contain the shape at
 * all (smaller than shape + 2·margin), the range inverts; the lower (left/
 * top) bound then wins one-sided — a deterministic, never-NaN answer that
 * parks the box at the left/top margin rather than fabricating a fit.
 *
 * @param desired The shape's desired viewport top-left.
 * @param size The shape's extent (translate-invariant).
 * @param viewport The live viewport.
 * @param margin The per-axis full-visibility air margin.
 * @returns The clamped viewport top-left.
 */
export function clampDragPosition(
  desired: { readonly left: number; readonly top: number },
  size: { readonly width: number; readonly height: number },
  viewport: ViewportSize,
  margin: number
): { left: number; top: number } {
  const leftRange: [number, number] = [margin, viewport.width - margin - size.width];
  const topRange: [number, number] = [margin, viewport.height - margin - size.height];
  return {
    left: Math.max(leftRange[0], Math.min(desired.left, leftRange[1])),
    top: Math.max(topRange[0], Math.min(desired.top, topRange[1]))
  };
}

/** The seams the runtime satisfies with the real chrome/window; tests record. */
export interface DragMachineDeps {
  /** The live viewport, read per call (each move re-clamps against it). */
  readViewport(): ViewportSize;
  /**
   * The VISIBLE chrome shape's live box (getBoundingClientRect's shape) —
   * the pill while the card is closed, the open card itself; null once its
   * element is gone (dead chrome). The drag path's truth: each follow move
   * re-derives against it, so the dragged shape tracks the pointer 1:1 in
   * whatever pose it currently presents.
   */
  readBox(): DragBox | null;
  /**
   * The VISIBLE chrome shape's RESTING box: the post-choreography layout
   * geometry in viewport coordinates, transform-invariant — the read
   * `reclamp` clamps. The live {@link readBox} presents however a running
   * entrance/exit poses it (scale, translate), which a settle-time clamp
   * must not treat as truth; the resting box is the layout the choreography
   * ends at. Null once either the shape or the chrome is missing — no
   * fallback to the live read: an unavailable resting box simply disables
   * the re-clamp (the same degradation the machine takes on a dead chrome).
   */
  readRestingBox(): DragBox | null;
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
   * The drag's own pointer ended: settle. The applied translate stays — the
   * dragged position is the one the wiring persists.
   * Two wired enders route here: the pointerup release, and a MID-DRAG
   * capture loss (some engines drop the capture — the pointer leaving the
   * window during a quick release on macOS trackpads/Magic Mice is the
   * verified live shape — with neither release nor OS cancel; the loss
   * carries the drag's pointer id, and settling keeps the follow's clamped
   * commit instead of restoring, so a late straggler release finds the drag
   * already ended and stays a no-op). A pointer id that is not the drag's
   * own is a stray release and settles nothing.
   *
   * @returns The committed translate when this settle ended a drag that
   *   moved past the slop — the one value to persist, exactly once per drop
   *   (a release followed by its capture loss settles once) — else null: a
   *   click-length press, a stray pointer, no live drag, or a dead chrome
   *   that never received a translate.
   */
  settle(pointerId: number): { x: number; y: number } | null;
  /**
   * Restore the pre-drag position — the GENUINELY canceling ends only (all
   * restore-shaped, never the capture path): Escape, the right-press
   * nicety (contextmenu), a second pointer's press, and the OS
   * pointercancel (touch arbitration). */
  cancel(): void;
  /** Whether a drag is live (the wiring's Escape/capture decisions read it). */
  isDragging(): boolean;
  /**
   * Adopt a stored translate as this mount's resting position (the restore
   * leg): applied through the same seam a drag writes, so the wiring's
   * re-clamp then holds it inside the current viewport and shape. Refused
   * (false, no write — never deferred) while a press is live or once a moved
   * drag of this mount settled: the user's own placement outranks a stored
   * hint that arrived late. A canceled drag placed nothing (it restored its
   * pre-drag pose), so it never blocks a later restore.
   *
   * @param position The stored translate (finite CSS px, validated by its store).
   * @returns Whether the position was applied.
   */
  restore(position: { x: number; y: number }): boolean;
  /**
   * Re-clamp the RESTING chrome against the live viewport (full containment
   * at rest — the wiring calls it when the viewport changed or the visible
   * box grew/shrank outside a drag). No-op while a drag is live (the moves
   * re-clamp themselves — reconciliation here would fight the pointer) and
   * on a dead chrome; idempotent when the box already sits inside. The
   * untouched stylesheet anchor answers as the identity translate and is
   * never rewritten into one.
   *
   * @returns Whether a position write landed — the wiring's signal to run
   *   the smooth re-settle leg (the movement is the chrome's own, so the
   *   class can ride it).
   */
  reclamp(): boolean;
  /** Read-and-clear the trailing-click suppression: true exactly once after a
   * drag actually moved (the press belonged to the drag, not to the pill).
   * A live moved drag suppresses too: the press's compat click can run
   * BEFORE its release (the right-press interleave dispatches `click` in the
   * middle of the held gesture — the machine's flag is not set yet). */
  consumeClickSuppression(): boolean;
}

/**
 * Whether a click event belongs to the pointer path — the suppression's only
 * audience. The discriminator is the click's `detail`: keyboard activations
 * (Enter on the focused pill) dispatch with `detail === 0`, pointer clicks
 * count their presses — verified against this Chromium's real input pipeline
 * (a trusted keyboard click and its untrusted synthetic replay both carry
 * `detail === 0`; the replay is separately gated on `isTrusted`). A keyboard
 * activation therefore never reads the drag path's suppression state.
 *
 * @param detail The click event's `detail` count.
 */
export function isPointerInitiatedClick(detail: number): boolean {
  return detail > 0;
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
  /** Whether a moved drag of this mount settled (the user placed it; a restore then yields). */
  let userPlaced = false;

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
        DRAG_TUNING.containmentMarginPx
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
      if (drag === null || drag.pointerId !== pointerId) return null; // A stray release never settles another drag.
      const moved = drag.moved;
      clickSuppression = moved;
      drag = null;
      // The applied translate stays: the dragged position is the commit.
      applyAffordance(false);
      if (!moved) return null;
      userPlaced = true;
      return applied !== null ? { ...applied } : null;
    },

    cancel() {
      // The restore-shaped end: only the wiring's genuinely canceling arms
      // arrive here (Escape, right-press, OS pointercancel, a second
      // pointer's press). Capture loss does NOT — it settles (the release
      // path), because a mid-gesture capture loss with no cancel reason
      // would otherwise turn an in-flight commit into a snap-back.
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

    restore(position) {
      if (drag !== null || userPlaced) return false;
      applied = { x: position.x, y: position.y };
      deps.applyPosition(applied);
      return true;
    },

    reclamp() {
      if (drag !== null) return false; // A live drag owns the position; its moves re-clamp.
      // The resting layout box is the authority here: the re-clamp targets
      // the choreography's END geometry, never the mid-flight pose the live
      // rect happens to present at the sample (an entrance's scale/translate
      // would distort both the clamp and its effect by whole px).
      const box = deps.readRestingBox();
      if (box === null) return false; // No honest layout read: no clamp (never a live fallback).
      const clamped = clampDragPosition(
        { left: box.left, top: box.top },
        box,
        deps.readViewport(),
        DRAG_TUNING.containmentMarginPx
      );
      // Same derivation as the follow: translate the clamped top-left back
      // into the chrome's drag translate over the box's untranslated origin.
      const next = {
        x: clamped.left - (box.left - (applied?.x ?? 0)),
        y: clamped.top - (box.top - (applied?.y ?? 0))
      };
      // Identity answers are not writes — the exact fast path. The untouched
      // anchor answers as the zero translate: the stylesheet bottom-right
      // anchor IS position {0, 0} (custom properties unset), and a
      // settled-at-rest position is already tracked in `applied`. Zero
      // results on a translated chrome restore the anchor as unset — the
      // stylesheet anchor stays the one resting truth.
      const isAnchor = next.x === 0 && next.y === 0;
      if (applied === null) {
        if (isAnchor) return false;
      } else if (applied.x === next.x && applied.y === next.y) {
        return false;
      }
      // Under the exact answer, a sub-quantum target is measurement residue,
      // not intent: the resting read serves whole px (offset* are CSSOM
      // longs) while the machine's translate is float, so a box already
      // settled at a bound re-reads up to ~1 px past it and would otherwise
      // micro-jitter a fresh position write on every trigger. Mask each
      // axis against the current pose (the untouched anchor is numerically
      // translate {0, 0}) — the mask only holds poses whose READS place
      // them at the margin; its reach ends at the edge read's quantization
      // budget, so a fully masked pose's worst-case air is ≈ 2 px (never
      // 0 — the owner's no-part-offscreen binding never yields to it).
      const epsilon = DRAG_TUNING.reclampQuantumPx;
      const base = applied ?? { x: 0, y: 0 };
      const maskedX = Math.abs(next.x - base.x) < epsilon ? base.x : next.x;
      const maskedY = Math.abs(next.y - base.y) < epsilon ? base.y : next.y;
      const maskedIsAnchor = maskedX === 0 && maskedY === 0;
      if (applied === null) {
        if (maskedIsAnchor) return false; // the masked residue kept the anchor
      } else if (applied.x === maskedX && applied.y === maskedY) {
        return false; // every axis was residue: nothing to write
      }
      applied = maskedIsAnchor ? null : { x: maskedX, y: maskedY };
      deps.applyPosition(applied);
      return true;
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
