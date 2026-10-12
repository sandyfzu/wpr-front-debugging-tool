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
 * The thin scrollbar treatment: hairline-width thumb in the line-2 token,
 * Firefox via the standard properties, Chrome via the webkit pseudo-elements;
 * `scrollbar-gutter: stable` prevents layout shift when content grows.
 */
const SCROLLBAR_CLASSES =
  '[scrollbar-width:thin] [scrollbar-color:var(--line-2)_transparent] ' +
  '[&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar]:h-2.5 ' +
  '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-clip-content [&::-webkit-scrollbar-thumb]:bg-[var(--line-2)] ' +
  // Hover deepens the thumb; the transparent padding border stays (no size jump).
  '[&::-webkit-scrollbar-thumb:hover]:bg-[var(--line-3)] ' +
  '[&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-corner]:bg-transparent';

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
        SCROLLBAR_CLASSES,
        own.class
      )}
      {...rest}
    >
      {own.children}
    </div>
  );
}
