/**
 * The panel's tooltip — attribution for icon-only controls and live-state
 * hints, including the disabled-but-explained case (e.g. reserved nav rows
 * render disabled and explain themselves on hover instead of dead-ending).
 *
 * Wraps Kobalte's APG tooltip: `role="tooltip"` content, `aria-describedby`
 * linkage from the trigger, hover + keyboard-focus opening, open/close
 * delays, and Escape dismissal.
 */
import type { ComponentProps, JSX } from 'solid-js';
import { Tooltip as KobalteTooltip } from '@kobalte/core';
import { cn } from '../../utils/cn';
import { FOCUS_RING } from './classes';

/** Where the tooltip floats — derived from Kobalte's own placement vocabulary. */
export type TooltipPlacement = NonNullable<ComponentProps<typeof KobalteTooltip.Root>['placement']>;

export type TooltipProps = {
  /** The tooltip content — short text or a small two-line block. */
  content: JSX.Element;
  /** Where to float relative to the trigger (default `top`). */
  placement?: TooltipPlacement;
  /** Ms of rest before the tooltip opens (default 350 — unobtrusive for hover-heavy toolbars). */
  openDelay?: number;
  /**
   * Ms to suppress the open warm-up after another tooltip close (default 300
   * — Kobalte's own cross-tooltip grace). `0` opts a surface out of the
   * shared skip-delay window entirely — which also removes Kobalte's
   * module-level timer handoff between closes, the mechanism behind
   * cross-test isolation needs. Careful surfaces set their own feel here.
   */
  skipDelayDuration?: number;
  /**
   * Disable the trigger (native `disabled` attribute). The disabled control
   * keeps its pointer *hover*, so its tooltip still opens — that is the
   * disabled-but-explained pattern (e.g. reserved nav rows); keyboard-focus
   * opening does not apply since a disabled control is not focusable.
   */
  disabled?: boolean;
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
 * `aria-describedby` and never steals focus. A disabled trigger stays
 * hoverable (its tooltip explains the disabled state) but is not
 * focusable.
 *
 * @param props.content The tooltip content.
 * @param props.placement Where to float (default `top`).
 * @param props.openDelay Rest time before opening (default 350ms).
 * @param props.skipDelayDuration Post-close suppression window (see above).
 * @param props.disabled Disable the trigger (tooltip still opens on hover).
 * @param props.class Extra classes on the trigger element.
 * @param props.children The trigger's content.
 */
export function Tooltip(props: TooltipProps): JSX.Element {
  return (
    <KobalteTooltip.Root
      placement={props.placement ?? 'top'}
      openDelay={props.openDelay ?? 350}
      skipDelayDuration={props.skipDelayDuration ?? 300}
      gutter={4}
    >
      <KobalteTooltip.Trigger
        data-fdt="tooltip-trigger"
        disabled={props.disabled || undefined}
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
