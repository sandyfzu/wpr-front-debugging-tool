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

// The chrome's class constants live in a Kobalte-free module (a surface can
// style a stand-in trigger without loading the menu); re-exported here so the
// menu's vocabulary stays one import.
export {
  MENU_CONTENT_CLASSES,
  MENU_GROUP_LABEL_CLASSES,
  MENU_ICON_TRIGGER_CLASSES,
  MENU_ICON_TRIGGER_SIZE,
  MENU_INDICATOR_SLOT_CLASSES,
  MENU_ITEM_CLASSES,
  MENU_ITEM_LABEL_CLASSES,
  MENU_SEPARATOR_CLASSES
} from './menu-classes';

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
