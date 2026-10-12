/**
 * The presentation math contract: the never-clips fit invariant (swept, not
 * claimed), the cap in oversized columns, fit-by-the-binding-dimension,
 * monotone shrinking, the null for spaceless columns and the throw for
 * broken measurements.
 */
import { describe, expect, it } from 'vitest';
import { DEVICE_SIMULATION_PROFILE } from './profiles';
import { scaleFit } from './scale-fit';

const VW = DEVICE_SIMULATION_PROFILE.viewport.width;
const VH = DEVICE_SIMULATION_PROFILE.viewport.height;

describe('scaleFit', () => {
  it('never clips: the scaled phone stays inside every real column, growth capped at 2', () => {
    for (let w = 1; w <= 2000; w += 137) {
      for (let h = 1; h <= 4000; h += 259) {
        const fit = scaleFit({ width: w, height: h });
        if (fit === null) throw new Error(`unreachable: real column ${String(w)}x${String(h)}`);
        const { scale, boxWidth, boxHeight } = fit;
        expect(boxWidth).toBe(VW * scale);
        expect(boxHeight).toBe(VH * scale);
        // One ulp of tolerance: FP division/multiplication can overshoot hair-thin.
        expect(VW * scale).toBeLessThanOrEqual(w + 1e-9);
        expect(VH * scale).toBeLessThanOrEqual(h + 1e-9);
        expect(scale).toBeGreaterThan(0);
        expect(scale).toBeLessThanOrEqual(2);
      }
    }
  });

  it('caps at 2.0 and letterboxes oversized columns', () => {
    expect(scaleFit({ width: 824, height: 2000 })).toEqual({
      scale: 2,
      boxWidth: 824,
      boxHeight: 1784
    });
    expect(scaleFit({ width: 9999, height: 1784 })).toEqual({
      scale: 2,
      boxWidth: 824,
      boxHeight: 1784
    });
  });

  it('fits the binding dimension', () => {
    const widthBound = scaleFit({ width: 300, height: 900 });
    expect(widthBound).toEqual({ scale: 300 / VW, boxWidth: 300, boxHeight: VH * (300 / VW) });
    const heightBound = scaleFit({ width: 6000, height: 900 });
    expect(heightBound).toEqual({
      scale: 900 / VH,
      boxWidth: VW * (900 / VH),
      boxHeight: 900
    });
  });

  it('keeps proportion under a custom viewport (the math is the parameter, the profile is the default)', () => {
    expect(scaleFit({ width: 1000, height: 3000 }, { width: 100, height: 100 })).toEqual({
      scale: 2,
      boxWidth: 200,
      boxHeight: 200
    });
    expect(scaleFit({ width: 50, height: 3000 }, { width: 100, height: 100 })).toEqual({
      scale: 0.5,
      boxWidth: 50,
      boxHeight: 50
    });
  });

  it('shrinks monotonically as the column shrinks', () => {
    let previous = scaleFit({ width: 2000, height: 2000 });
    if (previous === null) throw new Error('unreachable');
    for (let size = 1900; size >= 220; size -= 100) {
      const fit = scaleFit({ width: size, height: size });
      if (fit === null) throw new Error(`unreachable: real column ${String(size)}`);
      expect(fit.scale).toBeLessThanOrEqual(previous.scale);
      previous = fit;
    }
  });

  it('returns null for a spaceless column, throws for a broken measurement', () => {
    expect(scaleFit({ width: 0, height: 892 })).toBeNull();
    expect(scaleFit({ width: 412, height: 0 })).toBeNull();
    expect(() => scaleFit({ width: -1, height: 892 })).toThrow(/real column size/);
    expect(() => scaleFit({ width: 412, height: Number.NaN })).toThrow(/real column size/);
    expect(() => scaleFit({ width: Number.POSITIVE_INFINITY, height: 892 })).toThrow(
      /real column size/
    );
  });
});
