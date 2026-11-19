/**
 * The panel's tooltip — attribution for icon-only controls and live-state
 * hints, including the disabled-but-explained case (a disabled control
 * explains itself on hover instead of dead-ending).
 *
 * Wraps Kobalte's APG tooltip: `role="tooltip"` content, `aria-describedby`
 * linkage from the trigger, hover + keyboard-focus opening, open/close
 * delays, and Escape dismissal.
 */
import type { ComponentProps, JSX } from 'solid-js';
import { Match, Switch } from 'solid-js';
import { Tooltip as KobalteTooltip } from '@kobalte/core';
import { cn } from '../../utils/cn';
import { FOCUS_RING } from './classes';
import { MenuTooltipTrigger } from './menu';

/**
 * The floating label's look: a raised `surface-3` chip under the matching
 * line, so it stands apart from the `surface-2` cards and menus it floats
 * over in both palettes; the menu's 6 px corner (both are small floating
 * surfaces); 8 × 4 px padding keeps a one-line label light.
 */
const TOOLTIP_CONTENT_CLASSES =
  'z-50 max-w-64 rounded-md border border-line-3 bg-surface-3 px-2 py-1 text-2xs leading-snug text-fg-primary shadow-elev-2 break-words';

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
   * disabled-but-explained pattern; keyboard-focus
   * opening does not apply since a disabled control is not focusable.
   */
  disabled?: boolean;
  /**
   * The trigger element's tag/form:
   * - `button` (default) — the plain icon-button trigger;
   * - `a` — for rows whose primary control is a navigation link (Kobalte's
   *   polymorphic trigger carries the same hover/focus wiring onto the
   *   anchor). The built-in button treatments shrink to the hit-area
   *   floor: the anchor caller owns its layout and must keep its own ≥ 24px
   *   hit area;
   * - `menu-trigger` — the trigger of an APG menu: the *same* element
   *   carries the tooltip (attribution) and Kobalte's menu trigger
   *   (keyboard open, collision-aware anchor, `aria-haspopup="menu"`,
   *   `aria-expanded`, `aria-controls`) through the menu primitive's
   *   tooltip facade (`components/ui/menu.tsx`). Click handling stays the
   *   menu trigger's own — the click passthrough is not forwarded (the
   *   menu toggles itself); the palette's button-form trigger remains
   *   `button`.
   */
  as?: 'button' | 'a' | 'menu-trigger';
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
   * states the relationship (e.g. the palette's dialog, the rail's menu).
   */
  ariaHasPopup?: 'dialog' | 'menu';
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
  /**
   * A callback ref receiving the trigger element (every form) — for callers
   * that manage focus on the trigger itself.
   */
  ref?: (element: HTMLElement) => void;
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
 * @param props.as The trigger form — `button` (default), `a` (the anchor rows),
 *   or `menu-trigger` (the composed menu trigger; no click passthrough crosses).
 * @param props.href The anchor trigger's href (`as="a"` only).
 * @param props.ariaCurrent Whether the anchor trigger marks the active page.
 * @param props.ref A callback ref receiving the trigger element.
 * @param props.class Extra classes on the trigger element.
 * @param props.children The trigger's content.
 */
export function Tooltip(props: TooltipProps): JSX.Element {
  const anchor = (): boolean => props.as === 'a';
  /** The menu-trigger form: no click passthrough is forwarded — the menu trigger owns its clicks. */
  const menuTrigger = (): boolean => props.as === 'menu-trigger';
  /** The classes both trigger forms share (the layout differs per form). */
  const triggerClasses = () =>
    cn(
      anchor()
        ? // Anchor trigger: only the hit-area floor is built in — the caller
          // owns the link's layout (e.g. nav rail rows).
          'min-h-6 min-w-6'
        : 'inline-grid min-h-6 min-w-6 place-items-center rounded',
      FOCUS_RING,
      props.class
    );
  /** The trigger's shared attribution/state attrs (each branch spreads its own extras). */
  const shared = () => ({
    'data-fdt': 'tooltip-trigger',
    'aria-label': props.ariaLabel,
    'aria-haspopup': props.ariaHasPopup,
    'aria-expanded': props.ariaExpanded,
    ref: props.ref,
    children: props.children
  });
  return (
    <KobalteTooltip.Root
      placement={props.placement ?? 'top'}
      openDelay={props.openDelay ?? 350}
      skipDelayDuration={props.skipDelayDuration ?? 300}
      gutter={4}
    >
      {/* Literal-tag or composed triggers (Kobalte's polymorphic typing
          resolves per-tag attrs only for literal tags): every branch keeps
          its attrs fully typed on its own form; classes/content are shared
          and exactly one branch renders. */}
      <Switch>
        <Match when={anchor()}>
          {/* Kobalte's built-in trigger is `<button type="button">`; the
              anchor must not inherit it. A present `null` removes the
              attribute (the merge order honours `null`, it skips
              `undefined` and falls through to the built-in), but the
              anchor's typed `type` is `string | undefined` — so that one
              value rides an untyped spread. */}
          <KobalteTooltip.Trigger
            as="a"
            href={props.href}
            aria-current={props.ariaCurrent === true ? 'page' : undefined}
            {...({ type: null } as Record<string, unknown>)}
            {...shared()}
            onClick={props.onClick}
            class={triggerClasses()}
          />
        </Match>
        <Match when={menuTrigger()}>
          {/* The menu-trigger form mounts the tooltip's trigger contract
              onto the menu trigger itself (one element, two contracts) —
              and keeps the menu's own click semantics, so only the
              attribution attrs ride across. */}
          <KobalteTooltip.Trigger as={MenuTooltipTrigger} {...shared()} class={triggerClasses()} />
        </Match>
        <Match when={true}>
          <KobalteTooltip.Trigger
            as="button"
            type="button"
            disabled={props.disabled || undefined}
            {...shared()}
            onClick={props.onClick}
            class={triggerClasses()}
          />
        </Match>
      </Switch>
      <KobalteTooltip.Portal>
        <KobalteTooltip.Content data-fdt="tooltip" class={TOOLTIP_CONTENT_CLASSES}>
          {props.content}
        </KobalteTooltip.Content>
      </KobalteTooltip.Portal>
    </KobalteTooltip.Root>
  );
}
