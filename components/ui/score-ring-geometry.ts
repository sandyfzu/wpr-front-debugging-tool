/**
 * Pure geometry of the score ring: turns counts into SVG dash arcs on one
 * circle, so the component only maps arcs to `<circle>` attributes.
 *
 * Every arc owns a **slot** on the circle proportional to its value. The
 * painted part of a slot is the slot minus half the gap at each end, so two
 * neighbours (and the last and first arc, when the slots fill the circle) are
 * always exactly `gap` apart along the centerline. A round line cap paints past
 * the dash end, so a round arc's dash is shortened by the cap's extent at both
 * ends: its paint, caps included, stays inside its slot and never overlaps a
 * neighbour.
 */

/** One counted part of the ring (e.g. active features), drawn in its `kind`. */
export interface RingSegment<K extends string> {
  /** The count; a negative count is drawn as zero. */
  readonly value: number;
  /** What the arc represents; passed through untouched (the color key). */
  readonly kind: K;
}

/**
 * The line cap an arc is drawn with: `round` when the dash is long enough to
 * hold both caps inside its slot, otherwise `butt` (square ends stop exactly
 * at the dash), so a sliver never spills onto its neighbours.
 */
export type RingCap = 'round' | 'butt';

/** One drawable arc: the values for `stroke-dasharray`/`stroke-dashoffset`. */
export interface RingArc<K extends string> {
  /** Dash length along the circle; equals the circumference for a full ring. */
  readonly dash: number;
  /** `stroke-dashoffset` value: the negated start position on the circle. */
  readonly offset: number;
  /** The segment's kind. */
  readonly kind: K;
  /** The cap to draw the dash with. */
  readonly cap: RingCap;
}

/** Spacing between arcs, in the circumference's units. */
export interface RingSpacing {
  /** Visible gap between neighbouring arcs along the centerline (≥ 0). */
  readonly gap: number;
  /**
   * How far a round cap paints beyond a dash end along the centerline (≥ 0;
   * {@link roundCapExtent}). `0` = the caller draws square ends only.
   */
  readonly capExtent: number;
}

/** No gap, square ends: arcs touch edge to edge. */
const TOUCHING: RingSpacing = { gap: 0, capExtent: 0 };

/**
 * Throw unless `value` is a finite number at or above `min`.
 *
 * Inputs here are computed counts and geometry constants, never untrusted
 * data: a `NaN` or `Infinity` means a caller bug, so it fails fast instead of
 * drawing a silently wrong ring.
 *
 * @param name The input's name for the message.
 * @param value The input to check.
 * @param min The lowest accepted value.
 * @param exclusive Whether `min` itself is refused.
 * @throws {@link RangeError} When the value is not finite or out of range.
 */
function assertFinite(name: string, value: number, min: number, exclusive = false): void {
  const outOfRange = exclusive ? value <= min : value < min;
  if (!Number.isFinite(value) || outOfRange) {
    throw new RangeError(
      `score ring: ${name} must be a finite number ${exclusive ? '>' : '≥'} ${String(min)}, got ${String(value)}`
    );
  }
}

/**
 * The extent a round cap paints beyond a dash end, measured along the ring's
 * centerline.
 *
 * The cap is a disc of radius `strokeWidth / 2` centred on the dash end; seen
 * from the ring's centre it spans `asin(half / radius)` radians, slightly more
 * than `half` in arc length. Using this exact extent (not `half`) keeps the
 * gap between arcs true at the stroke's inner and outer edges too.
 *
 * @param radius The circle's radius (> 0).
 * @param strokeWidth The stroke width (0 ≤ width ≤ 2 × radius).
 * @returns The cap's extent in the radius's units.
 * @throws {@link RangeError} When an input is not finite or out of range.
 */
export function roundCapExtent(radius: number, strokeWidth: number): number {
  assertFinite('radius', radius, 0, true);
  assertFinite('strokeWidth', strokeWidth, 0);
  if (strokeWidth > 2 * radius) {
    throw new RangeError(
      `score ring: strokeWidth ${String(strokeWidth)} exceeds the diameter ${String(2 * radius)}`
    );
  }
  return radius * Math.asin(strokeWidth / 2 / radius);
}

/**
 * Lay counted segments out as arcs on a ring, in order from the ring's start.
 *
 * - `total ≤ 0` → no arcs (nothing to measure against).
 * - Negative values count as zero; zero-value segments draw nothing.
 * - Values summing above `total` are scaled down to fill the circle exactly.
 * - The circle's uncounted rest stays empty (the caller's track shows it).
 * - A lone segment filling the whole circle is one full ring: no gap, square
 *   ends (nothing to separate, and round caps would meet at the seam).
 * - A slot no longer than `gap` draws nothing (too thin to be seen apart from
 *   its gaps); one too short for both round caps is drawn with square ends.
 *
 * @param segments The counts, in drawing order.
 * @param total What a full circle stands for (e.g. all optimizations).
 * @param circumference The circle's length in the drawing's units (> 0).
 * @param spacing Gap and round-cap extent (default: touching, square ends).
 * @returns The visible arcs, in segment order.
 * @throws {@link RangeError} When a value, `total`, the circumference or a
 *   spacing field is not finite, or a geometry input is out of range.
 */
export function ringArcs<K extends string>(
  segments: readonly RingSegment<K>[],
  total: number,
  circumference: number,
  spacing: RingSpacing = TOUCHING
): RingArc<K>[] {
  assertFinite('circumference', circumference, 0, true);
  assertFinite('gap', spacing.gap, 0);
  assertFinite('capExtent', spacing.capExtent, 0);
  assertFinite('total', total, -Infinity);
  const values = segments.map((segment, index) => {
    assertFinite(`segments[${String(index)}].value`, segment.value, -Infinity);
    return Math.max(0, segment.value);
  });
  if (total <= 0) return [];
  const sum = values.reduce((acc, value) => acc + value, 0);
  // Over-full input shrinks to the circle; under-full leaves the rest empty.
  const scale = circumference / Math.max(total, sum);
  const visible = values.filter((value) => value > 0).length;
  const arcs: RingArc<K>[] = [];
  let before = 0;
  segments.forEach((segment, index) => {
    const value = values[index] ?? 0;
    // Positions come from cumulative values (not summed floats) so the last
    // slot ends exactly on the circle's end.
    const start = before * scale;
    before += value;
    if (value <= 0) return;
    // A lone segment fills the circle exactly when it reaches the total
    // (compared on counts: `value * (C / value)` can miss C by a rounding).
    if (visible === 1 && value >= total) {
      arcs.push({ dash: circumference, offset: 0, kind: segment.kind, cap: 'butt' });
      return;
    }
    const painted = before * scale - start - spacing.gap;
    if (painted <= 0) return;
    const roundFits = spacing.capExtent > 0 && painted > 2 * spacing.capExtent;
    const inset = spacing.gap / 2 + (roundFits ? spacing.capExtent : 0);
    arcs.push({
      dash: roundFits ? painted - 2 * spacing.capExtent : painted,
      // `0 -` (not unary minus) so an arc at the very start reads +0, not -0.
      offset: 0 - (start + inset),
      kind: segment.kind,
      cap: roundFits ? 'round' : 'butt'
    });
  });
  return arcs;
}
