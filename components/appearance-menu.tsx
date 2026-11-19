/**
 * The appearance menu: a toolbar icon button naming the palette in effect
 * (sun = light, moon = dark — the *resolved* one, so a stored `system`
 * shows what the OS gives) that opens a System / Dark / Light radio menu
 * with the check on the stored choice.
 *
 * Controlled and writer-free: the surface hands the stored value and its
 * own writer (`onChange`), so each surface keeps its persistence path and
 * failure handling; the document restyles through its appearance follow,
 * never through this component.
 */
import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import type { LucideIcon } from 'lucide-solid';
import Check from 'lucide-solid/icons/check';
import Monitor from 'lucide-solid/icons/monitor';
import Moon from 'lucide-solid/icons/moon';
import Sun from 'lucide-solid/icons/sun';
import {
  MENU_CONTENT_CLASSES,
  MENU_GROUP_LABEL_CLASSES,
  MENU_ICON_TRIGGER_CLASSES,
  MENU_INDICATOR_SLOT_CLASSES,
  MENU_ITEM_CLASSES,
  MENU_ITEM_LABEL_CLASSES,
  Menu
} from './ui/menu';
import { Tooltip } from './ui/tooltip';
import {
  APPEARANCES,
  isAppearance,
  resolveTheme,
  type Appearance,
  type Theme
} from '../utils/theme';
import { cn } from '../utils/cn';
import { createSystemDark, type ColorSchemeQuery } from './system-dark';

/** Each choice's menu word (sentence case; "System" stays short in a menu row). */
export const APPEARANCE_MENU_LABELS: Readonly<Record<Appearance, string>> = Object.freeze({
  system: 'System',
  dark: 'Dark',
  light: 'Light'
});

/** Each palette's word in the trigger's name. */
const THEME_WORDS: Readonly<Record<Theme, string>> = Object.freeze({
  dark: 'Dark',
  light: 'Light'
});

/** Each choice's row icon (System = the OS's screen). */
const CHOICE_ICONS: Readonly<Record<Appearance, LucideIcon>> = Object.freeze({
  system: Monitor,
  dark: Moon,
  light: Sun
});

/**
 * The trigger's accessible name and tooltip: the stored choice, plus the
 * palette it resolves to when that is the OS's call.
 *
 * @param value The stored choice.
 * @param resolved The palette in effect.
 * @returns E.g. "Appearance: System (Dark)", "Appearance: Light".
 */
export function appearanceMenuLabel(value: Appearance, resolved: Theme): string {
  const choice = APPEARANCE_MENU_LABELS[value];
  return value === 'system'
    ? `Appearance: ${choice} (${THEME_WORDS[resolved]})`
    : `Appearance: ${choice}`;
}

/** Props of {@link AppearanceMenu}. */
export interface AppearanceMenuProps {
  /** The stored choice (the check mark and the icon follow it). */
  readonly value: Appearance;
  /**
   * The surface's writer: called once per pick of a *different* choice
   * (re-picking the checked row calls nothing).
   */
  readonly onChange: (next: Appearance) => void;
  /** The OS preference query (tests hand fakes; default: the window's). */
  readonly systemScheme?: ColorSchemeQuery | null;
}

/**
 * Render the appearance trigger and its menu.
 *
 * @param props See {@link AppearanceMenuProps}.
 */
export function AppearanceMenu(props: AppearanceMenuProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  // Read once: the query is a mount-time seam, never swapped while mounted.
  // eslint-disable-next-line solid/reactivity
  const systemDark = createSystemDark(props.systemScheme);
  const resolved = createMemo(() => resolveTheme(props.value, systemDark()));
  const label = createMemo(() => appearanceMenuLabel(props.value, resolved()));
  return (
    <span data-fdt="appearance-menu" data-fdt-resolved={resolved()} class="inline-flex shrink-0">
      <Menu.Root open={open()} onOpenChange={setOpen} modal={false} placement="bottom-end">
        <Tooltip
          as="menu-trigger"
          content={label()}
          placement="bottom"
          ariaLabel={label()}
          ariaHasPopup="menu"
          ariaExpanded={open()}
          class={MENU_ICON_TRIGGER_CLASSES}
        >
          <Show when={resolved() === 'dark'} fallback={<Sun size={16} aria-hidden="true" />}>
            <Moon size={16} aria-hidden="true" />
          </Show>
        </Tooltip>
        <Menu.Portal>
          <Menu.Content data-fdt="appearance-menu-content" class={MENU_CONTENT_CLASSES}>
            <Menu.RadioGroup
              value={props.value}
              onChange={(next: string) => {
                // Kobalte types the value as a string; only the rows below
                // can produce one, so the guard is a contract check.
                if (isAppearance(next)) props.onChange(next);
              }}
            >
              <Menu.GroupLabel class={cn('block', MENU_GROUP_LABEL_CLASSES)}>
                Appearance
              </Menu.GroupLabel>
              <For each={APPEARANCES}>
                {(choice) => {
                  const Icon = CHOICE_ICONS[choice];
                  return (
                    <Menu.RadioItem
                      value={choice}
                      closeOnSelect
                      data-fdt="appearance-menu-item"
                      data-value={choice}
                      class={MENU_ITEM_CLASSES}
                    >
                      <Icon size={14} class="shrink-0 text-fg-secondary" aria-hidden="true" />
                      <Menu.ItemLabel class={MENU_ITEM_LABEL_CLASSES}>
                        {APPEARANCE_MENU_LABELS[choice]}
                      </Menu.ItemLabel>
                      <span class={MENU_INDICATOR_SLOT_CLASSES}>
                        <Menu.ItemIndicator>
                          <Check size={14} aria-hidden="true" />
                        </Menu.ItemIndicator>
                      </span>
                    </Menu.RadioItem>
                  );
                }}
              </For>
            </Menu.RadioGroup>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </span>
  );
}
