/**
 * The score ring: a small decorative donut showing counted parts of a whole
 * (e.g. active and collecting optimizations out of all of them) over a quiet
 * track. Purely visual — `aria-hidden`; the tile beside it carries the numbers
 * as text, so status is never conveyed by color alone.
 */
import type { JSX } from 'solid-js';
import { createMemo, For } from 'solid-js';
import { cn } from '../../utils/cn';
import { ringArcs, type RingSegment, roundCapExtent } from './score-ring-geometry';
import { STATUS_TEXT_CLASSES, type StatusKind } from './status-badge';

/** One counted part of the ring, colored by its status kind. */
export type ScoreRingSegment = RingSegment<StatusKind>;

/** The drawing's viewBox side; every length below is in these units. */
const VIEWBOX = 48;
/** The circle's centre (both axes). */
const CENTER = VIEWBOX / 2;
/** Centerline radius: leaves room for half the stroke inside the viewBox. */
const RADIUS = 20;
/** Ring thickness. */
const STROKE_WIDTH = 5;
/** The centerline's length — the unit the arcs are laid out in. */
export const SCORE_RING_CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/**
 * Gap between neighbouring arcs, ≈ 4.3° — enough to read as two arcs at the
 * default size (≈ 1.6 CSS px) without breaking the ring's shape.
 */
const ARC_GAP = 1.5;
/** How far the round caps paint past each dash end. */
const CAP_EXTENT = roundCapExtent(RADIUS, STROKE_WIDTH);
/** Default rendered side in CSS px. */
const DEFAULT_SIZE = 52;

export interface ScoreRingProps {
  /** The counted parts, drawn clockwise from 12 o'clock in this order. */
  segments: readonly ScoreRingSegment[];
  /** What the full circle stands for; `≤ 0` draws the empty track only. */
  total: number;
  /** Rendered side in CSS px (default 52). */
  size?: number;
  /** Extra classes on the `<svg>` (layout context). */
  class?: string;
}

/**
 * Throw unless the requested size can be drawn.
 *
 * @param size The `size` prop.
 * @returns The size, unchanged.
 * @throws {@link RangeError} When the size is not a finite number above 0.
 */
function checkedSize(size: number): number {
  if (!Number.isFinite(size) || size <= 0) {
    throw new RangeError(`score ring: size must be a finite number > 0, got ${String(size)}`);
  }
  return size;
}

/**
 * Render the ring: the full track, then one arc per visible segment.
 *
 * Arcs are dashes on the same circle (rotated so they start at 12 o'clock);
 * their color is the segment kind's status token through `currentColor`, the
 * track the `surface-4` token. Nothing animates: a count change redraws the
 * dashes instantly.
 *
 * @param props.segments The counted parts.
 * @param props.total The whole the parts are measured against.
 * @param props.size Rendered side in CSS px.
 * @param props.class Extra classes on the `<svg>`.
 * @throws {@link RangeError} On a non-finite count or total, or a bad size.
 */
export function ScoreRing(props: ScoreRingProps): JSX.Element {
  const arcs = createMemo(() =>
    ringArcs(props.segments, props.total, SCORE_RING_CIRCUMFERENCE, {
      gap: ARC_GAP,
      capExtent: CAP_EXTENT
    })
  );
  const size = (): number => checkedSize(props.size ?? DEFAULT_SIZE);
  return (
    <svg
      data-fdt="score-ring"
      viewBox={`0 0 ${String(VIEWBOX)} ${String(VIEWBOX)}`}
      width={size()}
      height={size()}
      aria-hidden="true"
      class={cn('shrink-0', props.class)}
    >
      <g
        transform={`rotate(-90 ${String(CENTER)} ${String(CENTER)})`}
        fill="none"
        stroke-width={STROKE_WIDTH}
      >
        <circle
          data-fdt="score-ring-track"
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          class="stroke-surface-4"
        />
        <For each={arcs()}>
          {(arc) => (
            <circle
              data-fdt="score-ring-arc"
              data-fdt-kind={arc.kind}
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              class={cn('stroke-current', STATUS_TEXT_CLASSES[arc.kind])}
              stroke-linecap={arc.cap}
              // A full ring is a plain stroke: a dash pattern would leave a seam.
              stroke-dasharray={
                arc.dash >= SCORE_RING_CIRCUMFERENCE
                  ? undefined
                  : `${String(arc.dash)} ${String(SCORE_RING_CIRCUMFERENCE)}`
              }
              stroke-dashoffset={arc.offset}
            />
          )}
        </For>
      </g>
    </svg>
  );
}
