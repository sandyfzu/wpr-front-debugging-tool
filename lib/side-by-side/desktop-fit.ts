/**
 * The desktop-width presentation math: give a half's frames a real
 * desktop-width content box behind a CSS transform. Below the floor, the
 * frame's element width is the floor — its media queries resolve at a desktop
 * width — scaled down to fill the half's column; at or above the floor the
 * frame is the page's natural full-width box at `scale(1)`, which is
 * visually the fluid dress. Width is the simulation, height deliberately
 * fluid (the column height divided by the scale): desktop-ness is a width
 * decision, and a height that shrinks with the scale is exactly what a real
 * browser at that zoom shows.
 */

/**
 * The canonical desktop width: the largest common laptop breakpoint class
 * (1200/1280 CSS-px viewports), so every desktop media query a real theme
 * writes resolves. A constant, not a setting — changing it is a deliberate,
 * recorded edit.
 */
export const DESKTOP_WIDTH_FLOOR = 1280;

/** What a half renders at in the desktop dress: the frame's own box, its scale, and the wrapper it lands in. */
export interface DesktopFrameFit {
  /** The frame's own width in CSS px: `max(column.width, floor)`. */
  frameWidth: number;
  /** The frame's own height in CSS px: `column.height / scale`, so the scaled frame fills the column exactly. */
  frameHeight: number;
  /** The transform's scale: `column.width / frameWidth` — `≤ 1` by construction, exactly `1` at or above the floor. */
  scale: number;
  /** The wrapper's layout-box width in CSS px (the column's width; the transform never touches layout). */
  boxWidth: number;
  /** The wrapper's layout-box height in CSS px (the column's height). */
  boxHeight: number;
}

/**
 * Fit the desktop-width dress into a half-column. Pure — the caller re-runs
 * it on every column resize and applies the numbers as inline styles. The
 * boundary is continuous by construction: at `column.width = floor` both
 * regimes give `scale(1)`, so a live resize never jumps or oscillates.
 *
 * @param column The half's content-box size in CSS px (as the ResizeObserver measures it).
 * @returns The fit, or null when the column holds no space (a hidden or zero box — an expected observer transient rendering as nothing).
 * @throws {@link Error} when the column is negative or non-finite — impossible for a real measurement, so it is a bug.
 */
export function desktopFit(column: { width: number; height: number }): DesktopFrameFit | null {
  const { width, height } = column;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
    throw new Error(
      `desktopFit needs a real column size, got { width: ${String(width)}, height: ${String(height)} }`
    );
  }
  if (width <= 0 || height <= 0) return null;
  const frameWidth = Math.max(width, DESKTOP_WIDTH_FLOOR);
  const scale = width / frameWidth;
  return {
    frameWidth,
    frameHeight: height / scale,
    scale,
    boxWidth: width,
    boxHeight: height
  };
}
