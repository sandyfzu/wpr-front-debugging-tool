/**
 * The phone-frame presentation math: fit the profile's fixed viewport into
 * one half's column behind a CSS transform. The wrapper's layout box is
 * exactly viewport × scale (so layout matches visuals) and fit never clips —
 * by construction the scaled phone sits inside its column, so tiny windows
 * pay readability only. One layout, on purpose: the compare is two
 * side-by-side halves, and their scale ≥ a stacked variant's whenever the
 * window is no taller than the phone's own aspect (~2.16:1); a stacking
 * fallback would flip exactly there, oscillating under a live resize at the
 * boundary — the rare taller-portrait window accepts a smaller but complete
 * phone instead of a layout flip.
 */
import { DEVICE_SIMULATION_PROFILE, type DeviceProfile } from './profiles';

/**
 * Presentation growth cap: fit first; beyond 2× the presentation stops
 * growing — text renders crisp (live layout, not an image) and oversized
 * windows keep letterbox instead of a giant poster.
 */
const MAX_SCALE = 2;

/** What a half renders at: the transform's scale and its wrapper box in CSS px. */
export interface PhoneFrameFit {
  /** Suggested `transform: scale()` value, `0 < scale ≤ 2`. */
  scale: number;
  /** The wrapper's CSS-px width (`viewport.width × scale`). */
  boxWidth: number;
  /** The wrapper's CSS-px height (`viewport.height × scale`). */
  boxHeight: number;
}

/**
 * Fit the phone into a half-column. Pure — the caller re-runs it on every
 * column resize (any window resize, dock, zoom or display change is the same
 * element-size event) and applies the numbers as inline styles.
 *
 * @param column The half's content-box size in CSS px (as the ResizeObserver measures it).
 * @param viewport The device viewport to fit, defaulting to the profile's; a parameter so tests exercise the math independently of the constant.
 * @returns The fit, or null when the column holds no space (a hidden or zero box — an expected observer transient rendering as nothing).
 * @throws {@link Error} when the column is negative or non-finite — impossible for a real measurement, so it is a bug.
 */
export function scaleFit(
  column: { width: number; height: number },
  viewport: DeviceProfile['viewport'] = DEVICE_SIMULATION_PROFILE.viewport
): PhoneFrameFit | null {
  const { width, height } = column;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
    throw new Error(
      `scaleFit needs a real column size, got { width: ${String(width)}, height: ${String(height)} }`
    );
  }
  if (width <= 0 || height <= 0) return null;
  const scale = Math.min(width / viewport.width, height / viewport.height, MAX_SCALE);
  return { scale, boxWidth: viewport.width * scale, boxHeight: viewport.height * scale };
}
