/** The menu wrapper's single-choice parts: radio group, radio rows, check indicator, caption. */
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { createSignal, For } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MENU_GROUP_LABEL_CLASSES,
  MENU_ICON_TRIGGER_CLASSES,
  MENU_ICON_TRIGGER_SIZE,
  MENU_INDICATOR_SLOT_CLASSES,
  Menu,
  MenuTooltipTrigger
} from './menu';

afterEach(() => {
  cleanup();
});

/**
 * Render an open single-choice menu over a controlled value.
 *
 * @param onChange The group's change spy.
 * @param initial The checked value.
 * @returns The menu element and the value setter.
 */
async function openRadioMenu(
  onChange: (next: string) => void,
  initial = 'b'
): Promise<{ menu: HTMLElement; setValue: (next: string) => void }> {
  const [value, setValue] = createSignal(initial);
  render(() => (
    <Menu.Root modal={false}>
      <MenuTooltipTrigger>Open</MenuTooltipTrigger>
      <Menu.Portal>
        <Menu.Content>
          <Menu.RadioGroup value={value()} onChange={onChange}>
            <Menu.GroupLabel class={MENU_GROUP_LABEL_CLASSES}>Pick</Menu.GroupLabel>
            <For each={['a', 'b']}>
              {(id) => (
                <Menu.RadioItem value={id}>
                  <Menu.ItemLabel>{`Row ${id}`}</Menu.ItemLabel>
                  <span class={MENU_INDICATOR_SLOT_CLASSES}>
                    <Menu.ItemIndicator>
                      <span data-testid={`check-${id}`}>✓</span>
                    </Menu.ItemIndicator>
                  </span>
                </Menu.RadioItem>
              )}
            </For>
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  ));
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Open' }));
  return { menu: await screen.findByRole('menu'), setValue };
}

describe('MENU_ICON_TRIGGER_SIZE', () => {
  it("is the icon trigger's 28px square, declared once for the trigger and any reserved box", () => {
    expect(MENU_ICON_TRIGGER_SIZE).toBe('size-7');
    expect(MENU_ICON_TRIGGER_CLASSES.split(' ')).toContain(MENU_ICON_TRIGGER_SIZE);
  });
});

describe('Menu radio parts', () => {
  it('render a captioned group of radio rows checked from the value', async () => {
    const { menu } = await openRadioMenu(vi.fn());
    const group = within(menu).getByRole('group', { name: 'Pick' });
    const rows = within(group).getAllByRole('menuitemradio');
    expect(rows.map((row) => row.textContent)).toEqual(['Row a', 'Row b✓']);
    expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    // The indicator mounts only on the checked row.
    expect(screen.queryByTestId('check-a')).toBeNull();
    expect(screen.getByTestId('check-b')).toBeTruthy();
  });

  it('moves the check with the controlled value', async () => {
    const { setValue } = await openRadioMenu(vi.fn());
    setValue('a');
    expect(await screen.findByTestId('check-a')).toBeTruthy();
    expect(screen.queryByTestId('check-b')).toBeNull();
  });

  it('reports a different pick once and ignores the checked row', async () => {
    const onChange = vi.fn();
    const { menu } = await openRadioMenu(onChange);
    // Kobalte selects on a primary-button pointer up (or Enter/Space).
    fireEvent.pointerUp(within(menu).getByRole('menuitemradio', { name: 'Row b' }), { button: 0 });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(within(menu).getByRole('menuitemradio', { name: 'Row a' }), { button: 0 });
    expect(onChange.mock.calls).toEqual([['a']]);
  });
});
