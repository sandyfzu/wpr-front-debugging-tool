/**
 * The floating menu's chrome as class strings — no Kobalte here, so a
 * surface can style a stand-in trigger (the options page's appearance
 * trigger before the menu's code lands) without loading the menu itself.
 * `./menu` re-exports every constant beside the menu parts.
 */
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
