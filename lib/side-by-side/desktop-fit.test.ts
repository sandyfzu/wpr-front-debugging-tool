/**
 * The desktop-fit math, pinned on both regimes and the seam: the floor
 * regime renders a true desktop-width frame scaled into the column, the
 * fluid regime is the page's natural full-width box, the boundary is
 * continuous, and impossible measurements fail the same honest way the
 * phone fit does.
 */
import { describe, expect, it } from 'vitest';
import { DESKTOP_WIDTH_FLOOR, desktopFit, type DesktopFrameFit } from './desktop-fit';

/**
 * A preferred-column fit must never be null (the pinned columns are real):
 * narrowing guard for the row bodies.
 *
 * @param fit The fit under assertion.
 * @returns The non-null fit.
 * @throws {@link Error} when the pure math surprisingly reported no space.
 */
function real(fit: DesktopFrameFit | null): DesktopFrameFit {
  expect(fit).not.toBeNull();
  if (fit === null) throw new Error('desktopFit reported no fit for a real column');
  return fit;
}

describe('desktopFit', () => {
  it('below the floor renders a desktop-width frame scaled down to fill the column', () => {
    const fit = desktopFit({ width: 800, height: 600 });
    expect(fit).toEqual({
      frameWidth: DESKTOP_WIDTH_FLOOR,
      frameHeight: 600 / (800 / DESKTOP_WIDTH_FLOOR),
      scale: 800 / DESKTOP_WIDTH_FLOOR,
      boxWidth: 800,
      boxHeight: 600
    });
    // The scaled frame fills the wrapper box exactly — the column shows the
    // desktop-width document without a dead strip.
    const narrow = real(fit);
    expect(narrow.frameWidth * narrow.scale).toBeCloseTo(narrow.boxWidth);
    expect(narrow.frameHeight * narrow.scale).toBeCloseTo(narrow.boxHeight);
  });

  it("at or above the floor the frame is the column's own full-width box at scale(1)", () => {
    const fit = desktopFit({ width: 1600, height: 900 });
    expect(fit).toEqual({
      frameWidth: 1600,
      frameHeight: 900,
      scale: 1,
      boxWidth: 1600,
      boxHeight: 900
    });
  });

  it('the boundary is continuous: meeting the floor from below changes nothing', () => {
    // The same column from both sides of the floor gets the same fit — a
    // live resize across 1280 reflows nothing and can never oscillate.
    const below = desktopFit({ width: 1200, height: 700 });
    const at = desktopFit({ width: DESKTOP_WIDTH_FLOOR, height: 700 });
    expect(below).not.toBeNull();
    expect(at).toEqual({
      frameWidth: DESKTOP_WIDTH_FLOOR,
      frameHeight: 700,
      scale: 1,
      boxWidth: DESKTOP_WIDTH_FLOOR,
      boxHeight: 700
    });
    // Continuity in the limit: as the width approaches the floor the scale
    // approaches 1 and the frame height approaches the column's height.
    const near = real(desktopFit({ width: DESKTOP_WIDTH_FLOOR - 1, height: 700 }));
    expect(near.scale).toBeGreaterThan(0.998);
    expect(near.frameHeight).toBeGreaterThan(700);
    expect(near.frameHeight).toBeLessThan(701.5);
  });

  it('a spaceless column reports no fit instead of inventing one', () => {
    expect(desktopFit({ width: 0, height: 400 })).toBeNull();
    expect(desktopFit({ width: 400, height: 0 })).toBeNull();
  });

  it('a broken layout measurement throws naming the offending numbers', () => {
    expect(() => desktopFit({ width: -1, height: 400 })).toThrow(/real column size/);
    expect(() => desktopFit({ width: Number.NaN, height: 400 })).toThrow(/NaN/);
  });
});
