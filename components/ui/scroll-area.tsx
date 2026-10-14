/**
 * The scroll surface — the devtools pane's scrolling container with a thin,
 * token-colored scrollbar. Pure CSS: native `overflow` plus scrollbar
 * styling, so platform scroll physics, speed and keyboard behavior stay the
 * devtools ones. No JS scrolling, no wheel listeners, ever.
 */
import type { JSX } from 'solid-js';
import { splitProps } from 'solid-js';
import { cn } from '../../utils/cn';

/** Which axes scroll. */
export type ScrollAxis = 'y' | 'x' | 'both';

export interface ScrollAreaProps {
  /** Which axes scroll (default `y` — a page body that never scrolls sideways). */
  axis?: ScrollAxis;
  /** Extra classes, merged last so callers win (`h-full`, `min-h-0`). */
  class?: string;
  /** The scrollable content. */
  children: JSX.Element;
}

/** Per-axis native overflow classes. */
const AXIS_CLASSES: Record<ScrollAxis, string> = {
  y: 'overflow-y-auto overflow-x-hidden',
  x: 'overflow-x-auto overflow-y-hidden',
  both: 'overflow-auto'
};

/**
 * The thin scrollbar treatment: hairline-width thumb in the line-2 token via
 * the standard `scrollbar-*` properties — which the Chromium primary target
 * honors itself (Chromium ≥ 121: computed `scrollbar-width`/`scrollbar-color`
 * override the webkit pseudo-elements entirely, so pseudo styling is dead
 * weight here and deliberately not written); `scrollbar-gutter: stable`
 * prevents layout shift when content grows.
 *
 * Exported as the design system's one declaring site: the menu plate's own
 * degenerate-case scroll consumes the same treatment, so no second surface
 * re-types the tokens.
 */
export const SCROLLBAR_THIN_CLASSES =
  '[scrollbar-width:thin] [scrollbar-color:var(--line-2)_transparent]';

/**
 * Render the scroll container.
 *
 * `overscroll-contain` keeps fast wheels from bouncing the devtools host; the
 * content is rendered as-is — this container only owns scrolling.
 *
 * @param props.axis Which axes scroll (default `y`).
 * @param props.class Extra classes, merged last so callers win.
 * @param props.children The content.
 */
export function ScrollArea(props: ScrollAreaProps): JSX.Element {
  const [own, rest] = splitProps(props, ['axis', 'class', 'children']);
  return (
    <div
      data-fdt="scroll-area"
      class={cn(
        'overscroll-contain [scrollbar-gutter:stable]',
        AXIS_CLASSES[own.axis ?? 'y'],
        SCROLLBAR_THIN_CLASSES,
        own.class
      )}
      {...rest}
    >
      {own.children}
    </div>
  );
}
