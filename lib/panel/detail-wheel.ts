/**
 * Who scrolls when the wheel turns over a scroll box nested in a detail view
 * (a capped code block in the side pane or the drill-in body): the box's
 * clipping scrollers first, until the box is on screen on the side the wheel
 * moves toward; then the box itself. Without this, a tall block half below
 * the visible edge catches every tick and scrolls its own thousands of pixels
 * while the rest of it — and its scrollbar's end — stays out of sight.
 *
 * "On screen" is the intersection of every clipping ancestor (the view, the
 * panel's content scroller, …) and the viewport: on a short dock the view
 * itself can reach below the panel, so a box whole inside the view can still
 * be cut off.
 */

/** `WheelEvent.deltaMode` values (DOM `WheelEvent.DOM_DELTA_*`). */
const DELTA_LINE = 1;
const DELTA_PAGE = 2;

/** One wheel "line" in px (Firefox can report lines; browsers scroll ≈ 3 × 16 px a notch). */
export const WHEEL_LINE_PX = 16;

/** Sub-pixel slack: a box this close to a visible edge counts as on screen. */
const EDGE_SLACK_PX = 1;

/**
 * A wheel's vertical delta in px, whatever unit the browser reported.
 *
 * @param deltaY The event's `deltaY`.
 * @param deltaMode The event's `deltaMode` (0 px, 1 lines, 2 pages).
 * @param pageHeight The view's visible height (one "page").
 * @returns The delta in px (positive = down); `0` for a non-finite delta.
 */
export function wheelDeltaPx(deltaY: number, deltaMode: number, pageHeight: number): number {
  if (!Number.isFinite(deltaY)) return 0;
  if (deltaMode === DELTA_LINE) return deltaY * WHEEL_LINE_PX;
  if (deltaMode === DELTA_PAGE) return deltaY * pageHeight;
  return deltaY;
}

/** A vertical extent in viewport px (`getBoundingClientRect` top/bottom). */
export interface VerticalSpan {
  readonly top: number;
  readonly bottom: number;
}

/** A scroller's state: `scrollTop`, `clientHeight`, `scrollHeight`. */
export interface ScrollState {
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
}

/** One clipping layer around the box. */
export interface ClipLayer {
  /** Its visible client area (viewport px). */
  readonly span: VerticalSpan;
  /** Its scroll state; `null` when it clips but the user cannot scroll it (the viewport, `overflow: hidden`). */
  readonly scroll: ScrollState | null;
}

/** What the layers and the box do for one wheel tick (see {@link planReveal}). */
export interface RevealPlan {
  /** The scroll step per layer (px, signed; the layers' order, 0 = untouched). */
  readonly steps: readonly number[];
  /**
   * The tick's remainder, for the box itself (px, signed): once the box is on
   * screen the rest of the same tick scrolls it, so a large flick is not cut
   * short at the reveal stop.
   */
  readonly rest: number;
}

/** Bound on planning passes per layer (each pass exhausts a layer's room, the delta, or the hiding edge). */
const MAX_PASSES_PER_LAYER = 2;

/**
 * Plan one wheel tick over a nested box: which clipping layers scroll, and by
 * how much, so the box comes on screen on the side the wheel moves toward —
 * never past that point nor past a layer's own ends.
 *
 * Each pass finds the visible edge that hides the box (the innermost layer
 * among equal edges) and scrolls the **outermost** layer at or inside it that
 * can still move: an outer layer brings the whole view on screen first (a
 * short dock's panel scroller before the view), and a layer outside the
 * hiding edge moves that edge with the box, so it cannot help. What is left
 * of the delta once the box is on screen (or nothing can move further) is
 * {@link RevealPlan.rest}.
 *
 * @param delta The wheel's delta in px (positive = down).
 * @param box The nested box's border box (viewport px).
 * @param layers The box's clipping layers, innermost (the view) first.
 * @returns The plan, or `null` to leave the tick to the browser (no delta,
 *   the box is already on screen that way, or no layer can bring it closer).
 */
export function planReveal(
  delta: number,
  box: VerticalSpan,
  layers: readonly ClipLayer[]
): RevealPlan | null {
  if (delta === 0 || !Number.isFinite(delta) || layers.length === 0) return null;
  const down = delta > 0;
  // Mirror an upward tick into a downward one: edges and the box's leading
  // edge become "how far down", room is what is left that way.
  const tracks: Track[] = layers.map((layer) => ({
    edge: down ? layer.span.bottom : -layer.span.top,
    room: roomToward(layer.scroll, down),
    step: 0
  }));
  let lead = down ? box.bottom : -box.top;
  let remaining = Math.abs(delta);
  for (let pass = 0; pass < tracks.length * MAX_PASSES_PER_LAYER && remaining > 0; pass++) {
    const hiding = hidingTrack(tracks);
    const hidden = lead - hiding.edge;
    if (hidden <= EDGE_SLACK_PX) break;
    const mover = outermostMovable(tracks, hiding);
    if (mover === undefined) break;
    const step = Math.min(remaining, hidden, mover.room);
    // A layer's scroll moves its content (the box, every inner edge), never its own edge.
    lead -= step;
    for (const track of tracks) {
      if (track === mover) break;
      track.edge -= step;
    }
    mover.room -= step;
    mover.step += step;
    remaining -= step;
  }
  if (tracks.every((track) => track.step === 0)) return null;
  // `0`, never `-0`, for untouched layers and a used-up tick.
  const signed = (px: number): number => (px === 0 || down ? px : -px);
  return { steps: tracks.map((track) => signed(track.step)), rest: signed(remaining) };
}

/** One layer while a tick is planned (mirrored to "down"). */
interface Track {
  /** The layer's visible edge on the wheel's side. */
  edge: number;
  /** How far it can still scroll that way. */
  room: number;
  /** How far the plan scrolls it. */
  step: number;
}

/**
 * How far a layer can still scroll the wheel's way.
 *
 * @param scroll The layer's scroll state (`null`: not user-scrollable).
 * @param down The wheel moves down.
 * @returns Room in px (≥ 0).
 */
function roomToward(scroll: ScrollState | null, down: boolean): number {
  if (scroll === null) return 0;
  const room = down
    ? scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop
    : scroll.scrollTop;
  return Math.max(0, room);
}

/**
 * The layer whose visible edge cuts the box off: the smallest mirrored edge,
 * the innermost among equals (an outer layer with the same edge cannot help).
 *
 * @param tracks The layers, innermost first (non-empty).
 * @returns That layer.
 */
function hidingTrack(tracks: readonly Track[]): Track {
  return tracks.reduce((hiding, track) => (track.edge < hiding.edge ? track : hiding));
}

/**
 * The outermost layer at or inside `limit` with room left.
 *
 * @param tracks The layers, innermost first.
 * @param limit The hiding layer.
 * @returns That layer, or `undefined` when none can move.
 */
function outermostMovable(tracks: readonly Track[], limit: Track): Track | undefined {
  let movable: Track | undefined;
  for (const track of tracks) {
    if (track.room > EDGE_SLACK_PX) movable = track;
    if (track === limit) break;
  }
  return movable;
}
