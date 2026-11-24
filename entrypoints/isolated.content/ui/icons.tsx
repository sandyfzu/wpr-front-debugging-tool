/**
 * The stroke-icon factory shared by every injected UI this entrypoint mounts,
 * plus the glyphs two or more surfaces share (inline SVG path data — the
 * content script must stay inside a hard bundle budget, and stroke icons do
 * not justify an icon-package runtime; the icon package remains available to
 * the panel surfaces, which have a much larger budget).
 *
 * Geometry is the lucide package's own path data (verified against the
 * installed version), 24 viewBox, `currentColor` strokes with round caps and
 * joins so an icon inherits its container's text color. Feature glyphs live
 * beside the feature that renders them (e.g. `known-conflicts/icons`,
 * `detection-widget/icons`); this file owns the factory and the shared set.
 */

import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';

/** One optional non-path shape: the lucide circle icons carry a `<circle>` node. */
export interface IconCircle {
  /** Center X, viewBox 24. */
  cx: number;
  /** Center Y, viewBox 24. */
  cy: number;
  /** Radius. */
  r: number;
}

/** One optional ellipse node (lucide renders some glyphs with one, e.g. `database`). */
export interface IconEllipse {
  /** Center X, viewBox 24. */
  cx: number;
  /** Center Y, viewBox 24. */
  cy: number;
  /** Horizontal radius. */
  rx: number;
  /** Vertical radius. */
  ry: number;
}

/** Shared: close (lucide `x`) — every report widget's card dismissal. */
export const CLOSE_ICON_PATHS = ['M18 6 6 18', 'm6 6 12 12'] as const;

/**
 * Shared: the alert triangle (lucide `triangle-exclamation-point`) — the Known Conflicts
 * marker and the detection strip's "applied despite the bypass" warning.
 */
export const ALERT_ICON_PATHS = [
  'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
  'M12 9v4',
  'M12 17h.01'
] as const;

/** Props of the shared stroke-icon component. */
export interface StrokeIconProps {
  /** Stroke path data, viewBox 24. */
  paths: readonly string[];
  /** Optional surrounding circle (lucide's ringed icons pair one with paths). */
  circle?: IconCircle | null;
  /** Optional ellipse node (lucide's database-family glyphs pair one). */
  ellipse?: IconEllipse | null;
  /** Stroke width — lucide's own default is 2; thin-stroke callers pass 1.5. */
  strokeWidth?: number;
}

/**
 * Render path (and optional node) stroke geometry as one inline SVG that
 * inherits `currentColor`; callers size via CSS.
 *
 * @param props The icon's geometry.
 * @returns The SVG element.
 */
export function StrokeIcon(props: StrokeIconProps): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke-width={props.strokeWidth ?? 2}
      stroke="currentColor"
      aria-hidden="true"
    >
      <Show when={props.circle != null}>
        <circle
          cx={props.circle?.cx}
          cy={props.circle?.cy}
          r={props.circle?.r}
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </Show>
      <Show when={props.ellipse != null}>
        <ellipse
          cx={props.ellipse?.cx}
          cy={props.ellipse?.cy}
          rx={props.ellipse?.rx}
          ry={props.ellipse?.ry}
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </Show>
      <For each={props.paths}>
        {(path) => <path d={path} stroke-linecap="round" stroke-linejoin="round" />}
      </For>
    </svg>
  );
}
