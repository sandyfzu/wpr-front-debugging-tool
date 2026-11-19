/**
 * The appearance trigger's face, Kobalte-free: what the toolbar button
 * names and shows for a stored choice (the *resolved* palette's icon —
 * sun = light, moon = dark — and "Appearance: System (Dark)"). The menu
 * (`./appearance-menu`) renders it on its real trigger; a surface that
 * loads the menu later renders the same face on a stand-in first, so the
 * two never disagree and the swap shows no change.
 */
import { Show, createMemo, type Accessor, type JSX } from 'solid-js';
import Moon from 'lucide-solid/icons/moon';
import Sun from 'lucide-solid/icons/sun';
import { resolveTheme, type Appearance, type Theme } from '../utils/theme';
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

/** The trigger's live state: the palette in effect and the name it reads. */
export interface AppearanceTriggerState {
  /** The resolved palette (follows the OS live for a stored `system`). */
  readonly resolved: Accessor<Theme>;
  /** The trigger's name ({@link appearanceMenuLabel}). */
  readonly label: Accessor<string>;
}

/**
 * Track the trigger's state for a stored choice. Call inside a reactive
 * owner (the OS listener is removed with it).
 *
 * @param value The stored choice.
 * @param systemScheme The OS preference query (tests hand fakes; default: the window's).
 * @returns The resolved palette and the name.
 */
export function createAppearanceTrigger(
  value: Accessor<Appearance>,
  systemScheme?: ColorSchemeQuery | null
): AppearanceTriggerState {
  const systemDark = createSystemDark(systemScheme);
  const resolved = createMemo(() => resolveTheme(value(), systemDark()));
  const label = createMemo(() => appearanceMenuLabel(value(), resolved()));
  return { resolved, label };
}

/**
 * The trigger's icon: the palette in effect (decorative — the name says it).
 *
 * @param props.resolved The resolved palette.
 */
export function AppearanceIcon(props: { resolved: Theme }): JSX.Element {
  return (
    <Show when={props.resolved === 'dark'} fallback={<Sun size={16} aria-hidden="true" />}>
      <Moon size={16} aria-hidden="true" />
    </Show>
  );
}

/** Props of {@link AppearanceFrame}. */
export interface AppearanceFrameProps {
  /** The resolved palette (published for surfaces and tests). */
  readonly resolved: Theme;
  /** Set while a stand-in waits for the menu's code. */
  readonly pending?: boolean;
  /** The trigger: the menu's own, or a stand-in. */
  readonly children: JSX.Element;
}

/**
 * The control's frame: one element, whichever trigger it holds, so the
 * `appearance-menu` hook surfaces and tests find it by never moves and
 * the swap from a stand-in to the menu changes no box.
 *
 * @param props See {@link AppearanceFrameProps}.
 */
export function AppearanceFrame(props: AppearanceFrameProps): JSX.Element {
  return (
    <span
      data-fdt="appearance-menu"
      data-fdt-resolved={props.resolved}
      data-fdt-pending={props.pending === true ? '' : undefined}
      class="inline-flex shrink-0"
    >
      {props.children}
    </span>
  );
}
