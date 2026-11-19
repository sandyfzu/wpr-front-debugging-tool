/**
 * The appearance menu: the trigger names and shows the resolved palette
 * (System following the OS live), the menu offers the three choices in the
 * vocabulary's order with the check on the stored one, and a pick calls the
 * surface's writer once (never for the checked row).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Appearance } from '../utils/theme';
import { APPEARANCE_MENU_LABELS, AppearanceMenu, appearanceMenuLabel } from './appearance-menu';
import { fakeScheme, type FakeScheme } from './system-dark.fake';

afterEach(() => {
  cleanup();
});

/**
 * Render the menu over a controlled value.
 *
 * @param initial The stored choice.
 * @param scheme The OS preference double.
 * @returns The writer spy and the value setter.
 */
function renderMenu(
  initial: Appearance,
  scheme: FakeScheme = fakeScheme(false)
): { onChange: ReturnType<typeof vi.fn>; setValue: (next: Appearance) => void } {
  const [value, setValue] = createSignal<Appearance>(initial);
  const onChange = vi.fn();
  render(() => <AppearanceMenu value={value()} onChange={onChange} systemScheme={scheme} />);
  return { onChange, setValue };
}

/** The trigger (its name starts with "Appearance:"). */
function trigger(): HTMLElement {
  return screen.getByRole('button', { name: /^Appearance: / });
}

/** The icon the trigger shows: the lucide class of its one svg. */
function shownIcon(): string {
  const svgs = trigger().querySelectorAll('svg');
  expect(svgs).toHaveLength(1);
  const icon = [...(svgs[0]?.classList ?? [])].find((name) => /^lucide-(sun|moon)$/.test(name));
  return icon ?? 'none';
}

/** Open the menu and return it. */
async function openMenu(): Promise<HTMLElement> {
  fireEvent.pointerDown(trigger());
  return await screen.findByRole('menu');
}

describe('appearanceMenuLabel', () => {
  it.each([
    ['system', 'dark', 'Appearance: System (Dark)'],
    ['system', 'light', 'Appearance: System (Light)'],
    ['dark', 'dark', 'Appearance: Dark'],
    ['light', 'light', 'Appearance: Light']
  ] as const)('%s resolving to %s → "%s"', (value, resolved, label) => {
    expect(appearanceMenuLabel(value, resolved)).toBe(label);
  });
});

describe('AppearanceMenu', () => {
  it('shows the moon for dark and the sun for light, named and marked', () => {
    const { setValue } = renderMenu('dark');
    expect(shownIcon()).toBe('lucide-moon');
    expect(trigger().getAttribute('aria-label')).toBe('Appearance: Dark');
    expect(screen.getByRole('button').closest('[data-fdt="appearance-menu"]')).toBeTruthy();
    setValue('light');
    expect(shownIcon()).toBe('lucide-sun');
    expect(trigger().getAttribute('aria-label')).toBe('Appearance: Light');
  });

  it('follows the OS live while the choice is System', () => {
    const scheme = fakeScheme(true);
    renderMenu('system', scheme);
    expect(shownIcon()).toBe('lucide-moon');
    expect(trigger().getAttribute('aria-label')).toBe('Appearance: System (Dark)');
    scheme.flip(false);
    expect(shownIcon()).toBe('lucide-sun');
    expect(trigger().getAttribute('aria-label')).toBe('Appearance: System (Light)');
    expect(
      document.querySelector('[data-fdt="appearance-menu"]')?.getAttribute('data-fdt-resolved')
    ).toBe('light');
  });

  it('ignores the OS once a palette is pinned', () => {
    const scheme = fakeScheme(true);
    renderMenu('light', scheme);
    expect(shownIcon()).toBe('lucide-sun');
    scheme.flip(false);
    scheme.flip(true);
    expect(shownIcon()).toBe('lucide-sun');
  });

  it('drops its OS listener on unmount', () => {
    const scheme = fakeScheme(false);
    renderMenu('system', scheme);
    expect(scheme.listeners()).toBe(1);
    cleanup();
    expect(scheme.listeners()).toBe(0);
  });

  it('offers System, Dark and Light with the check on the stored choice', async () => {
    renderMenu('dark');
    const menu = await openMenu();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    const group = within(menu).getByRole('group', { name: 'Appearance' });
    const rows = within(group).getAllByRole('menuitemradio');
    expect(rows.map((row) => row.getAttribute('data-value'))).toEqual(['system', 'dark', 'light']);
    expect(rows.map((row) => row.textContent)).toEqual(['System', 'Dark', 'Light']);
    expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    // The check mark is on the checked row only.
    expect(rows.map((row) => row.querySelectorAll('svg').length)).toEqual([1, 2, 1]);
  });

  it('calls the writer once per pick of another choice, never for the checked one', async () => {
    const { onChange } = renderMenu('system');
    for (const [name, calls] of [
      ['System', []],
      ['Light', [['light']]],
      ['Dark', [['light'], ['dark']]]
    ] as const) {
      const menu = await openMenu();
      // Kobalte selects on a primary-button pointer up (or Enter/Space).
      fireEvent.pointerUp(within(menu).getByRole('menuitemradio', { name }), { button: 0 });
      expect(onChange.mock.calls).toEqual(calls);
      // Every pick closes the menu (Kobalte closes one tick after the select).
      await waitFor(() => {
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
      });
    }
  });

  it('keeps the check on the stored value until the surface stores the pick', async () => {
    const { setValue } = renderMenu('system');
    const menu = await openMenu();
    fireEvent.pointerUp(within(menu).getByRole('menuitemradio', { name: 'Dark' }), { button: 0 });
    // Controlled: nothing moved yet (the writer has not stored anything).
    expect(shownIcon()).toBe('lucide-sun');
    setValue('dark');
    expect(shownIcon()).toBe('lucide-moon');
  });

  it('labels every choice from one table', () => {
    expect(APPEARANCE_MENU_LABELS).toEqual({ system: 'System', dark: 'Dark', light: 'Light' });
  });
});
