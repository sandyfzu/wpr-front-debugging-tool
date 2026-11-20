/**
 * Render tests for the score ring: decorative markup, one `<circle>` per
 * visible arc over the track, status-token colors, the empty and full states,
 * live redraws, and the size guard. Arc positions are pinned in the geometry
 * tests; here only the attribute wiring.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { SCORE_RING_CIRCUMFERENCE, ScoreRing, type ScoreRingSegment } from './score-ring';

afterEach(() => {
  cleanup();
});

/** The rendered ring's `<svg>`. */
function ring(): SVGSVGElement {
  const svg = document.querySelector<SVGSVGElement>('[data-fdt="score-ring"]');
  if (!svg) throw new Error('score ring missing');
  return svg;
}

/** The rendered arcs, in document order. */
function arcs(): SVGCircleElement[] {
  return [...document.querySelectorAll<SVGCircleElement>('[data-fdt="score-ring-arc"]')];
}

const ACTIVE_AND_COLLECTING: ScoreRingSegment[] = [
  { value: 4, kind: 'ok' },
  { value: 3, kind: 'warn' }
];

describe('ScoreRing', () => {
  it('is decorative, sized 52 px by default, and starts at 12 o’clock', () => {
    render(() => <ScoreRing segments={ACTIVE_AND_COLLECTING} total={18} />);
    const svg = ring();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('width')).toBe('52');
    expect(svg.getAttribute('height')).toBe('52');
    expect(svg.getAttribute('viewBox')).toBe('0 0 48 48');
    expect(svg.querySelector('g')?.getAttribute('transform')).toBe('rotate(-90 24 24)');
    // No motion: nothing transitions or animates.
    expect(svg.outerHTML).not.toMatch(/transition|animate/u);
  });

  it('draws the track plus one arc per non-zero segment, in the kind’s status token', () => {
    render(() => (
      <ScoreRing segments={[{ value: 0, kind: 'error' }, ...ACTIVE_AND_COLLECTING]} total={18} />
    ));
    const track = document.querySelector('[data-fdt="score-ring-track"]');
    expect(track?.getAttribute('class')).toBe('stroke-surface-4');
    expect(arcs().map((arc) => arc.dataset.fdtKind)).toEqual(['ok', 'warn']);
    const [ok, warn] = arcs();
    expect(ok?.getAttribute('class')).toBe('stroke-current text-status-ok');
    expect(warn?.getAttribute('class')).toBe('stroke-current text-status-warn');
    for (const arc of arcs()) {
      expect(arc.getAttribute('stroke-linecap')).toBe('round');
      expect(arc.getAttribute('stroke-dasharray')).toMatch(
        new RegExp(`^[\\d.]+ ${String(SCORE_RING_CIRCUMFERENCE)}$`, 'u')
      );
    }
    // Exact layout of the 4-of-18 arc: slot C·4/18 ≈ 27.925, minus the 1.5 gap,
    // minus a round cap 20·asin(2.5/20) ≈ 2.5066 at each end; it starts half a
    // gap plus one cap past 12 o'clock.
    expect(Number(ok?.getAttribute('stroke-dashoffset'))).toBeCloseTo(-3.2565, 3);
    expect(Number(ok?.getAttribute('stroke-dasharray')?.split(' ')[0])).toBeCloseTo(21.412, 3);
    // The second arc starts after the first one's slot (4 of 18 of the circle).
    expect(Number(warn?.getAttribute('stroke-dashoffset'))).toBeLessThan(
      -(4 / 18) * SCORE_RING_CIRCUMFERENCE
    );
  });

  it.each([
    ['a zero total', ACTIVE_AND_COLLECTING, 0],
    ['all-zero counts', [{ value: 0, kind: 'ok' }] as ScoreRingSegment[], 18],
    ['no segments', [] as ScoreRingSegment[], 18]
  ])('draws only the track for %s', (_case, segments, total) => {
    render(() => <ScoreRing segments={segments} total={total} />);
    expect(document.querySelector('[data-fdt="score-ring-track"]')).not.toBeNull();
    expect(arcs()).toHaveLength(0);
  });

  it('draws a full ring as a plain stroke with no dash pattern', () => {
    render(() => <ScoreRing segments={[{ value: 18, kind: 'ok' }]} total={18} />);
    const [full] = arcs();
    expect(full?.hasAttribute('stroke-dasharray')).toBe(false);
    expect(full?.getAttribute('stroke-linecap')).toBe('butt');
  });

  it('redraws when the counts change', () => {
    const [segments, setSegments] = createSignal<ScoreRingSegment[]>([{ value: 4, kind: 'ok' }]);
    render(() => <ScoreRing segments={segments()} total={18} />);
    expect(arcs()).toHaveLength(1);
    setSegments(ACTIVE_AND_COLLECTING);
    expect(arcs().map((arc) => arc.dataset.fdtKind)).toEqual(['ok', 'warn']);
    setSegments([]);
    expect(arcs()).toHaveLength(0);
  });

  it('takes a custom size and extra classes', () => {
    render(() => <ScoreRing segments={[]} total={0} size={44} class="self-center" />);
    expect(ring().getAttribute('width')).toBe('44');
    expect(ring().getAttribute('class')).toBe('shrink-0 self-center');
  });

  it.each([0, -1, Number.NaN, Infinity])('refuses size %s', (size) => {
    expect(() => render(() => <ScoreRing segments={[]} total={0} size={size} />)).toThrow(
      RangeError
    );
  });

  it('fails fast on a non-finite count', () => {
    expect(() =>
      render(() => <ScoreRing segments={[{ value: Number.NaN, kind: 'ok' }]} total={4} />)
    ).toThrow('segments[0].value');
  });
});
