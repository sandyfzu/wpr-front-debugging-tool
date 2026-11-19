/**
 * Pins the segmented look's state table (one text tone per state, the raise
 * only when selected, hover only on an idle available segment, never an
 * opacity) and the count formatter's validation.
 */
import { describe, expect, it } from 'vitest';
import {
  SEGMENT_BASE,
  SEGMENT_COUNT,
  SEGMENT_RAISED,
  SEGMENTED_CAPTION,
  SEGMENTED_TRAY,
  SEGMENTED_TRAY_STRETCH,
  SEGMENT_STRETCH,
  segmentCountText,
  segmentStateClass
} from './segmented';

/** The `text-*` color tokens in a class list (sizes like `text-xs` excluded). */
function textTones(classes: string): string[] {
  return classes.split(/\s+/u).filter((token) => /^text-fg-/u.test(token));
}

describe('segmentStateClass', () => {
  it.each([
    { selected: false, unavailable: false, tone: 'text-fg-secondary', raised: false, hover: true },
    { selected: true, unavailable: false, tone: 'text-fg-primary', raised: true, hover: false },
    { selected: false, unavailable: true, tone: 'text-fg-muted', raised: false, hover: false },
    { selected: true, unavailable: true, tone: 'text-fg-muted', raised: true, hover: false }
  ])(
    'selected=$selected unavailable=$unavailable → $tone',
    ({ selected, unavailable, tone, raised, hover }) => {
      const classes = segmentStateClass({ selected, unavailable });
      // Exactly one text tone: never two left for stylesheet order to decide.
      expect(textTones(classes)).toEqual([tone]);
      expect(classes.includes(SEGMENT_RAISED)).toBe(raised);
      expect(classes.includes('hover:')).toBe(hover);
      expect(classes).toContain(unavailable ? 'cursor-not-allowed' : 'cursor-pointer');
    }
  );

  it('never dims text through opacity, and carries no motion', () => {
    const all = [
      SEGMENTED_TRAY,
      SEGMENTED_CAPTION,
      SEGMENT_BASE,
      SEGMENT_COUNT,
      ...[true, false].flatMap((selected) =>
        [true, false].map((unavailable) => segmentStateClass({ selected, unavailable }))
      )
    ].join(' ');
    expect(all).not.toMatch(/opacity|transition|animate-|duration-/u);
  });

  it('keeps the geometry inside the bar: 24 px segments, a hugging, wrapping tray bounded by its container', () => {
    expect(SEGMENT_BASE.split(' ')).toContain('h-6');
    expect(SEGMENTED_TRAY.split(' ')).toEqual(
      expect.arrayContaining(['w-fit', 'flex-wrap', 'max-w-full', 'bg-surface-3', 'border-line-1'])
    );
    expect(SEGMENT_RAISED).toBe('bg-surface-2 shadow-elev-1');
    // The caption sits 8 px in from the tray edge, 6 px off the first segment.
    expect(SEGMENTED_CAPTION.split(' ')).toEqual(expect.arrayContaining(['ps-2', 'pe-1.5']));
    expect(SEGMENT_COUNT.split(' ')).toEqual(
      expect.arrayContaining(['tabular-nums', 'text-fg-muted'])
    );
  });

  it('stretches as the same fill at full width, never the hugging w-fit', () => {
    const hug = SEGMENTED_TRAY.split(' ');
    const stretch = SEGMENTED_TRAY_STRETCH.split(' ');
    expect(stretch).toEqual(expect.arrayContaining(['flex', 'w-full']));
    expect(stretch).not.toContain('w-fit');
    expect(stretch).not.toContain('inline-flex');
    // Everything but the box sizing is shared with the hugging tray.
    const sizing = new Set(['inline-flex', 'w-fit', 'flex', 'w-full']);
    expect(stretch.filter((t) => !sizing.has(t))).toEqual(hug.filter((t) => !sizing.has(t)));
    expect(SEGMENT_STRETCH).toBe('flex-1');
  });
});

describe('segmentCountText', () => {
  it('formats zero and grouped counts', () => {
    expect(segmentCountText(0, 'any')).toBe('0');
    expect(segmentCountText(7, 'any')).toBe('7');
    expect(segmentCountText(1204, 'any')).toBe('1,204');
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws on %s, naming the segment',
    (count) => {
      expect(() => segmentCountText(count, 'delayed')).toThrow(
        /Segment "delayed": count must be a non-negative integer/u
      );
    }
  );
});
