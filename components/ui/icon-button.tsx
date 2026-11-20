/**
 * The icon-only button — a square `Button` variant for toolbars and header
 * actions. The accessible name is required by the type system (an icon-only
 * control has no text content to read), and the square sizing keeps every
 * variant at or above the WCAG 2.5.8 24×24 px hit-area floor.
 */
import type { ComponentProps, JSX } from 'solid-js';
import { splitProps } from 'solid-js';
import { cn } from '../../utils/cn';
import { DISABLED, FOCUS_RING } from './classes';
import type { ButtonVariant } from './button';
import { buttonVariantClasses, isHeld } from './button';

export type IconButtonProps = {
  /** The accessible name (rendered as `aria-label`, never visible text). */
  label: string;
  /** Visual weight, same variants as `Button` (default `ghost`). */
  variant?: ButtonVariant;
  /** Square density: 24px (`sm`) or 28px (`md`, default). */
  size?: 'sm' | 'md';
  /** Extra classes, merged last so callers win. */
  class?: string;
  /** The icon itself (a lucide icon element, sized for the density). */
  children: ComponentProps<'button'>['children'];
} & Omit<ComponentProps<'button'>, 'class' | 'children'>;

/** Class per square size — the hit-area floor made literal. */
const ICON_BUTTON_SIZE_CLASSES = {
  sm: 'size-6',
  md: 'size-7'
} as const;

/**
 * Render an icon-only button.
 *
 * Square, content-centered; the icon stays a pixel-perfect glyph while the
 * padded square guarantees the minimum target size. For discoverability add a
 * `Tooltip` with the same icon as the tooltip's own trigger — nesting an
 * icon-button inside a tooltip trigger would nest interactive elements.
 * Held (`disabled` or `aria-disabled`), it keeps its resting look under the
 * pointer, like `Button`.
 *
 * @param props.label Required accessible name (icon-only controls carry none).
 * @param props.variant See {@link ButtonVariant} (default `ghost`).
 * @param props.size Square density (default `md`).
 * @param props.class Extra classes, merged last so callers win.
 * @param props.children The icon element.
 */
export function IconButton(props: IconButtonProps): JSX.Element {
  const [own, rest] = splitProps(props, ['label', 'variant', 'size', 'class']);
  return (
    <button
      type="button"
      data-fdt="icon-button"
      aria-label={own.label}
      class={cn(
        'inline-grid shrink-0 place-items-center rounded-control border',
        FOCUS_RING,
        DISABLED,
        buttonVariantClasses(own.variant ?? 'ghost', isHeld(rest.disabled, rest['aria-disabled'])),
        ICON_BUTTON_SIZE_CLASSES[own.size ?? 'md'],
        own.class
      )}
      {...rest}
    >
      {rest.children}
    </button>
  );
}
