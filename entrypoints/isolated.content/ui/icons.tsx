/**
 * The stroke-icon factory shared by this entrypoint's injected UIs, as inline
 * SVG path data — the content script must stay inside a hard bundle budget,
 * and stroke icons do not justify an icon-package runtime (the icon package
 * remains available to the panel surfaces, which have a much larger budget).
 *
 * Geometry is the lucide package's own path data (verified against the
 * installed version), 24 viewBox, `currentColor` strokes with round caps and
 * joins so an icon inherits its container's text color.
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

/** Props of the shared stroke-icon component. */
export interface StrokeIconProps {
  /** Stroke path data, viewBox 24. */
  paths: readonly string[];
  /** Optional surrounding circle (lucide's ringed icons pair one with paths). */
  circle?: IconCircle | null;
  /** Stroke width — lucide's own default is 2; thin-stroke callers pass 1.5. */
  strokeWidth?: number;
}

/**
 * Render path (and optional circle) stroke geometry as one inline SVG that
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
      <For each={props.paths}>
        {(path) => <path d={path} stroke-linecap="round" stroke-linejoin="round" />}
      </For>
    </svg>
  );
}
