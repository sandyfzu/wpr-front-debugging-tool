/**
 * The floating menu — the design system's APG menu surface, introduced for
 * the panel nav rail's overflow affordance (the "More pages" trigger
 * revealing the hidden rows). Kobalte's dropdown-menu under this design
 * system's floating chrome; the surface's behavior is the installed
 * 0.13.14 library's, verified against its source: the trigger owns the
 * keyboard-open behaviors (Enter/Space open at the first item, ArrowDown/
 * ArrowUp at the first/last), the content owns the APG menu keyboard
 * (arrows with wrap, typeahead, Home/End through the roving list), Escape
 * and outside interaction dismiss, and a selection closes when
 * `closeOnSelect` is set. The menu is non-modal, so the shell around it
 * keeps receiving pointer events and stays in the accessibility tree — a
 * nav flyout, never a blocking overlay.
 *
 * Positioning is Kobalte's popper with its own collision handling
 * (flip + slide + viewport padding), which is what keeps a rail-bottom
 * trigger's menu — anchored where there is barely any room to grow —
 * inside the window; the same middleware clamps the plate's height at
 * window sizes too small for all its rows.
 *
 * One APG nuance, recorded so it is never mistaken for a bug: a disabled
 * menu item is *skipped* by the items' arrow navigation — Kobalte's
 * collection skips disabled keys while strict APG would keep disabled items
 * focusable; a consumer that disables an item must explain it elsewhere.
 *
 * The chrome is declared here (the one surface all menus of the design
 * system share); the row anatomy and data binding live with the consumer —
 * the same split the dialog primitive takes. Single-choice menus (the
 * appearance menu) compose `RadioGroup` + `RadioItem` + `ItemIndicator`;
 * a radio row keeps Kobalte's default of staying open on select unless the
 * consumer sets `closeOnSelect`.
 */
import type { ComponentProps, JSX } from 'solid-js';
import { DropdownMenu as KobalteMenu } from '@kobalte/core';
import { cn } from '../../utils/cn';

/**
 * Where a menu content's chrome lives (the dialog plate's language,
 * tooltip-scaled).
 *
 * The plate is a *scrolling* surface, designed: the popper middleware
 * clamps its height to what the window offers (`max-h` over Kobalte's
 * available-height variable), and `overflow-y: auto` makes that clamp an
 * internal scroll instead of items painting past the plate — the menu's
 * own overflow, not the shell's (the rail itself never scrolls or gains a
 * scrollbar; its scroll-free invariant is separate and pinned). The
 * native scrollbar treatment comes from the shared token stylesheet; it
 * exists only while the clamp actually bites (`scrollbar-gutter` stays at
 * its `auto` default — deliberately *not* `stable`, which would reserve a
 * phantom right gutter on every plate at every height, shifting the
 * labels/chips even when nothing scrolls), and `overscroll-contain` keeps
 * a fast wheel from bouncing the DevTools host through the flyout.
 */
export const MENU_CONTENT_CLASSES = cn(
  'z-50 max-h-[var(--kb-popper-content-available-height)] w-max min-w-40 max-w-72 overflow-y-auto overscroll-contain rounded-md border border-line-2 bg-surface-2 p-1 shadow-elev-2 outline-none'
);

/**
 * One menu item: the 32px row pitch the rail's rows use (well above the
 * 24px hit floor). Kobalte's highlight state (`data-highlighted` — pointer
 * hover and keyboard focus are the same state on a menu) carries the hover
 * surface; a disabled item reads muted.
 */
export const MENU_ITEM_CLASSES =
  'mx-1 flex h-8 min-w-0 cursor-default items-center gap-2 rounded px-2 text-2xs font-medium no-underline outline-none data-highlighted:bg-surface-3 data-disabled:cursor-not-allowed data-disabled:text-fg-muted';

/** The item's inner label slot (what Kobalte wires as the item's accessible name). */
export const MENU_ITEM_LABEL_CLASSES = 'flex min-w-0 flex-1 items-center gap-2 font-medium';

/**
 * The icon trigger's 28px square on its own, so a box reserved for a trigger
 * not mounted yet keeps exactly its size (no shift when it arrives).
 */
export const MENU_ICON_TRIGGER_SIZE = 'size-7';

/**
 * An icon-only menu trigger in a toolbar (the top bar's "⋯" and appearance
 * menus): the 28px ghost square; the tooltip trigger adds the focus ring.
 */
export const MENU_ICON_TRIGGER_CLASSES = `${MENU_ICON_TRIGGER_SIZE} rounded-control text-fg-secondary hover:bg-surface-3 hover:text-fg-primary`;

/** The separator between the menu's groups (the rail's hairline grammar). */
export const MENU_SEPARATOR_CLASSES = 'mx-1 my-1 border-t border-line-2';

/** A group's caption above its rows (the caps-label grammar; not an item, never focused). */
export const MENU_GROUP_LABEL_CLASSES =
  'mx-1 px-2 pt-1 pb-0.5 text-2xs font-medium tracking-wide text-fg-muted uppercase';

/**
 * The checked-state slot at a radio row's end: a fixed box, so the labels
 * line up whether or not the row holds the indicator (Kobalte unmounts it
 * on unchecked rows).
 */
export const MENU_INDICATOR_SLOT_CLASSES = 'ml-auto inline-flex size-3.5 shrink-0 text-accent';

/**
 * Trigger attributes for the tooltip-composed menu trigger.
 *
 * The overflow trigger is *one* physical element carrying two trigger
 * contracts: the shared tooltip's (hover/focus axis, `aria-describedby`
 * wiring — the rail's attribution surface) and Kobalte's menu trigger's
 * (keyboard open, collision-aware popper anchor, `aria-haspopup` /
 * `aria-expanded` / `aria-controls`). The composition rides Kobalte's own
 * polymorphic `as`-a-component path, so `MenuTrigger forwarded` is what
 * the shared tooltip mounts as its `as` value.
 */
export function MenuTooltipTrigger(props: ComponentProps<typeof KobalteMenu.Trigger>): JSX.Element {
  // Props flow through Solid's Dynamic as one plain spread (the tooltip's
  // shared attribution attrs + its trigger handlers + the ref chain are
  // all this shape's members); Kobalte's merge keeps its own attrs ahead
  // of the spread, so the tooltip's values win where both sides carry one
  // (aria-haspopup/aria-expanded).
  return <KobalteMenu.Trigger {...props} />;
}

/**
 * The design system's menu surface: the Kobalte APG parts re-exported
 * under one namespace (Kobalte itself never leaves `components/ui/`), so
 * consumers compose rows and state from the same vocabulary the chrome
 * constants name. The Trigger renders through {@link MenuTooltipTrigger}
 * when a shared tooltip wraps it (the rail's overflow case); standalone
 * menu openings would reach for the re-exported part — keep the trigger's
 * semantics from drifting per surface either way.
 */
export const Menu = {
  Root: KobalteMenu.Root,
  Portal: KobalteMenu.Portal,
  Content: KobalteMenu.Content,
  Item: KobalteMenu.Item,
  ItemLabel: KobalteMenu.ItemLabel,
  Separator: KobalteMenu.Separator,
  /** A group's caption (wires the enclosing group's `aria-labelledby`). */
  GroupLabel: KobalteMenu.GroupLabel,
  /**
   * A single-choice group: controlled through `value` + `onChange`; Kobalte
   * calls `onChange` only when the pick differs from the current value.
   */
  RadioGroup: KobalteMenu.RadioGroup,
  /** One choice (`role="menuitemradio"`, `aria-checked` from the group's value). */
  RadioItem: KobalteMenu.RadioItem,
  /** Renders its children only while its item is checked (the check mark). */
  ItemIndicator: KobalteMenu.ItemIndicator
} as const;
