/**
 * The panel's tooltip — attribution for icon-only controls and live-state
 * hints, including the disabled-but-explained case (e.g. reserved nav rows
 * render disabled and explain themselves on hover instead of dead-ending).
 *
 * Wraps Kobalte's APG tooltip: `role="tooltip"` content, `aria-describedby`
 * linkage from the trigger, hover + keyboard-focus opening, open/close
 * delays, and Escape dismissal.
 */
import type { JSX } from 'solid-js';
import { Tooltip as KobalteTooltip } from '@kobalte/core';
import { cn } from '../../utils/cn';
import { FOCUS_RING } from './classes';

/** Where the tooltip floats, matching Kobalte's placement vocabulary. */
export type TooltipPlacement =
  | 'top'
  | 'top-start'
  | 'top-end'
  | 'bottom'
  | 'bottom-start'
  | 'bottom-end'
  | 'left'
  | 'left-start'
  | 'left-end'
  | 'right'
  | 'right-start'
  | 'right-end';

export type TooltipProps = {
  /** The tooltip content — short text or a small two-line block. */
  content: JSX.Element;
  /** Where to float relative to the trigger (default `top`). */
  placement?: TooltipPlacement;
  /** Ms of rest before the tooltip opens (default 350 — unobtrusive for hover-heavy toolbars). */
  openDelay?: number;
  /** Extra classes on the trigger element, merged last so callers win. */
  class?: string;
  /** The trigger's content — an icon, or a short label. */
  children: JSX.Element;
};

/**
 * Render a tooltip around its trigger.
 *
 * The trigger is `<button type="button">` with a min 24×24 hit area built in,
 * so callers can pass any small lucide icon and stay above the WCAG 2.5.8
 * floor. Pointer *and* keyboard focus both open it; Escape and
 * outside-interaction close it; the content links to the trigger via
 * `aria-describedby` and never steals focus.
 *
 * @param props.content The tooltip content.
 * @param props.placement Where to float (default `top`).
 * @param props.openDelay Rest time before opening (default 350ms).
 * @param props.class Extra classes on the trigger element.
 * @param props.children The trigger's content.
 */
export function Tooltip(props: TooltipProps): JSX.Element {
  return (
    <KobalteTooltip.Root
      placement={props.placement ?? 'top'}
      openDelay={props.openDelay ?? 350}
      gutter={4}
    >
      <KobalteTooltip.Trigger
        data-fdt="tooltip-trigger"
        class={cn(
          'inline-grid min-h-6 min-w-6 place-items-center rounded',
          FOCUS_RING,
          props.class
        )}
      >
        {props.children}
      </KobalteTooltip.Trigger>
      <KobalteTooltip.Portal>
        <KobalteTooltip.Content
          data-fdt="tooltip"
          class={cn(
            'z-50 max-w-64 rounded border border-line-3 bg-surface-3 px-1.5 py-1 text-2xs leading-snug text-fg-primary shadow-elev-2 break-words'
          )}
        >
          {props.content}
        </KobalteTooltip.Content>
      </KobalteTooltip.Portal>
    </KobalteTooltip.Root>
  );
}
