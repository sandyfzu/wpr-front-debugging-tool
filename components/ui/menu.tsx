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
 * inside the window.
 *
 * The chrome is declared here (the one surface all menus of the design
 * system share); the row anatomy and data binding live with the consumer —
 * the same split the dialog primitive takes.
 */
import type { JSX } from 'solid-js';
import { DropdownMenu as KobalteMenu } from '@kobalte/core';

/** Where a menu content's chrome lives (the dialog plate's language, tooltip-scaled). */
export const MENU_CONTENT_CLASSES =
  'z-50 max-h-[var(--kb-popper-content-available-height)] w-max min-w-40 max-w-72 rounded-md border border-line-2 bg-surface-2 p-1 shadow-elev-2 outline-none';

/**
 * One menu item: the 32px row pitch the rail's rows use (well above the
 * 24px hit floor). Kobalte's highlight state (`data-highlighted` — pointer
 * hover and keyboard focus are the same state on a menu) carries the hover
 * surface; the disabled state is the reserved row's muted treatment (the
 * row's description line carries the explaining words).
 */
export const MENU_ITEM_CLASSES =
  'mx-1 flex h-8 min-w-0 cursor-default items-center gap-2 rounded px-2 text-2xs font-medium no-underline outline-none data-highlighted:bg-surface-3 data-disabled:cursor-not-allowed data-disabled:text-fg-muted';

/**
 * A taller variant for items with an inline description line (the
 * reserved row's note reads under its label): same outside anatomy, the
 * note inherits the description slot's own type.
 */
export const MENU_ITEM_WITH_NOTE_CLASSES = 'min-h-8 h-auto flex-col items-start py-1.5';

/** The item's inner label slot (what Kobalte wires as the item's accessible name). */
export const MENU_ITEM_LABEL_CLASSES = 'flex min-w-0 flex-1 items-center gap-2 font-medium';

/** The item's description line (always visible, below the label). */
export const MENU_ITEM_NOTE_CLASSES = 'text-[11px] leading-tight text-fg-muted';

/** The separator between the menu's groups (the rail's hairline grammar). */
export const MENU_SEPARATOR_CLASSES = 'mx-1 my-1 border-t border-line-2';

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
export function MenuTooltipTrigger(props: Record<string, unknown>): JSX.Element {
  // Props flow through Solid's Dynamic as a plain spread; Kobalte's merge
  // keeps its own attrs ahead of the spread, so the tooltip's values win
  // where both sides carry one (aria-haspopup/aria-expanded).
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
  ItemDescription: KobalteMenu.ItemDescription,
  Separator: KobalteMenu.Separator
} as const;
