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
import { Show } from 'solid-js';
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
  /**
   * The trigger element's tag — `button` (the default) or `a` for rows whose
   * primary control is a navigation link (Kobalte's polymorphic trigger
   * carries the same hover/focus wiring onto the anchor). The built-in
   * button treatments shrink to the hit-area floor: the anchor caller owns
   * its layout and must keep its own ≥ 24px hit area.
   */
  as?: 'button' | 'a';
  /** The anchor trigger's href (meaningful only with `as="a"`). */
  href?: string;
  /**
   * Marks the anchor trigger `aria-current="page"` (the active route of a
   * nav whose rows answer tooltips). Reads get tracked through the trigger,
   * so the marker follows the caller's state live.
   */
  ariaCurrent?: boolean;
  /**
   * The trigger's accessible name — how icon-only controls name themselves
   * (the tooltip content is a hover/focus affordance, not a name).
   */
  ariaLabel?: string;
  /**
   * The control the trigger opens, for `aria-haspopup` shells whose trigger
   * states the relationship (e.g. the palette's dialog its button opens).
   */
  ariaHasPopup?: 'dialog';
  /**
   * The opened state of the paired surface, riding the trigger as
   * `aria-expanded` reactively.
   */
  ariaExpanded?: boolean;
  /**
   * A click handler the trigger forwards (icon-buttons whose tooltip wraps
   * a real action — the palette's opener). Native click semantics stay the
   * platform's; the wrapper only adds the attribution surface.
   */
  onClick?: (event: MouseEvent) => void;
  /** Extra classes on the trigger element, merged last so callers win. */
  class?: string;
  /** The trigger's content — an icon, or a short label. */
  children: JSX.Element;
};

/**
 * Render a tooltip around its trigger.
 *
 * The default trigger is `<button type="button">` with a min 24×24 hit area
 * built in, so callers can pass any small lucide icon and stay above the
 * WCAG 2.5.8 floor; with `as="a"` the same wiring rides a real anchor and
 * the caller owns the link's layout. Pointer *and* keyboard focus both open
 * it; Escape and outside-interaction close it; the content links to the
 * trigger via `aria-describedby` and never steals focus. A disabled trigger
 * stays hoverable (its tooltip explains the disabled state) but is not
 * focusable.
 *
 * @param props.content The tooltip content.
 * @param props.placement Where to float (default `top`).
 * @param props.openDelay Rest time before opening (default 350ms).
 * @param props.skipDelayDuration Post-close suppression window (see above).
 * @param props.disabled Disable the trigger (tooltip still opens on hover; button form only).
 * @param props.as The trigger tag — `button` (default) or `a`.
 * @param props.href The anchor trigger's href (`as="a"` only).
 * @param props.ariaCurrent Whether the anchor trigger marks the active page.
 * @param props.class Extra classes on the trigger element.
 * @param props.children The trigger's content.
 */
export function Tooltip(props: TooltipProps): JSX.Element {
  const anchor = (): boolean => props.as === 'a';
  /** The classes + content both trigger forms share (the layout differs). */
  const shared = () => ({
    'data-fdt': 'tooltip-trigger',
    'aria-label': props.ariaLabel,
    'aria-haspopup': props.ariaHasPopup,
    'aria-expanded': props.ariaExpanded,
    onClick: props.onClick,
    class: cn(
      anchor()
        ? // Anchor trigger: only the hit-area floor is built in — the caller
          // owns the link's layout (e.g. nav rail rows).
          'min-h-6 min-w-6'
        : 'inline-grid min-h-6 min-w-6 place-items-center rounded',
      FOCUS_RING,
      props.class
    ),
    children: props.children
  });
  return (
    <KobalteTooltip.Root
      placement={props.placement ?? 'top'}
      openDelay={props.openDelay ?? 350}
      skipDelayDuration={props.skipDelayDuration ?? 300}
      gutter={4}
    >
      {/* Two literal-tag triggers (Kobalte's polymorphic typing resolves
          per-tag attrs only for literal tags): every anchor-specific attr
          stays fully typed on its own branch. Classes/content are shared;
          exactly one branch renders. */}
      <Show
        when={anchor()}
        fallback={
          <KobalteTooltip.Trigger
            as="button"
            type="button"
            disabled={props.disabled || undefined}
            {...shared()}
          />
        }
      >
        {/* Kobalte's built-in trigger is `<button type="button">`; the anchor
            must not inherit it. A present `null` removes the attribute (the
            merge order honours `null`, it skips `undefined` and falls
            through to the built-in), but the anchor's typed `type` is
            `string | undefined` — so that one value rides an untyped
            spread. */}
        <KobalteTooltip.Trigger
          as="a"
          href={props.href}
          aria-current={props.ariaCurrent === true ? 'page' : undefined}
          {...({ type: null } as Record<string, unknown>)}
          {...shared()}
        />
      </Show>
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
