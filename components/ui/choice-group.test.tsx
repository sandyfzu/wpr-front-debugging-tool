/**
 * The choice group's render contract: the APG radio-group anatomy under the
 * tiles (role=radiogroup over label-linked hidden radios sharing one group
 * `name`, so keyboard arrows rove), the controlled selection loop, the
 * accessible name/description wiring, and the checked styling — with an
 * axe run pinning the component a11y floor.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChoiceGroup } from './choice-group';
import { describeAxeViolations, runAxeAudit } from './a11y-audit';

afterEach(() => {
  cleanup();
});

/** The test's appearance vocabulary, order unchanged from the real surface. */
const OPTIONS = [
  { value: 'system', label: 'System default' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' }
] as const;

/** The rendered group element (the role="radiogroup" node). */
function group(): HTMLElement {
  return screen.getByRole('radiogroup', { name: 'Color theme' });
}

/** The checked radio's value at this moment. */
function checkedValue(): string | null {
  const checked = group().querySelector<HTMLInputElement>('input:checked');
  return checked === null ? null : checked.value;
}

describe('ChoiceGroup', () => {
  it('renders the APG anatomy: role=radiogroup over label-linked hidden radios', () => {
    render(() => (
      <ChoiceGroup
        options={[...OPTIONS]}
        value="system"
        onChange={() => {}}
        aria-label="Color theme"
      />
    ));
    const inputs = [...group().querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(inputs).toHaveLength(3);
    // The keyboard-complete contract: the group's hidden radios share ONE
    // name — that is what lets native arrow keys rove selection. The name is
    // per-instance (never a hardcoded literal shared across documents).
    const names = new Set(inputs.map((input) => input.name));
    expect(names.size).toBe(1);
    expect([...names][0]).not.toBe('');
    // Each visible tile is the radio's `<label for>` — a click selects.
    for (const option of OPTIONS) {
      const radio = inputs.find((input) => input.value === option.value);
      const label = screen.getByText(option.label);
      expect(label.getAttribute('for')).toBe(radio?.getAttribute('id'));
    }
    // The verified focus ring rides the item wrapper, keyed on the hidden
    // input's focus (the FOCUS_RING pin's `has()` twist).
    expect(group().querySelector('[data-fdt="choice"]')?.className).toContain(
      'has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-1 has-[input:focus-visible]:outline-accent'
    );
    // The enabled state never carries the disabled data attribute.
    expect(group().querySelector('[data-fdt="choice"]')?.hasAttribute('data-disabled')).toBe(false);
  });

  it('starts with the controlled value checked and reports changes', () => {
    const onChange = vi.fn<(value: (typeof OPTIONS)[number]['value']) => void>();
    render(() => (
      <ChoiceGroup
        options={[...OPTIONS]}
        value="dark"
        onChange={onChange}
        aria-label="Color theme"
      />
    ));
    expect(checkedValue()).toBe('dark');
    fireEvent.click(screen.getByText('Light'));
    expect(onChange).toHaveBeenCalledWith('light');
    expect(checkedValue()).toBe('dark'); // controlled: selection moves only through the value prop
  });

  it('follows a controlled state loop (selection is never uncontrolled)', async () => {
    const [appearance, setAppearance] = createSignal<(typeof OPTIONS)[number]['value']>('system');
    render(() => (
      <ChoiceGroup
        options={[...OPTIONS]}
        value={appearance()}
        onChange={(value) => {
          setAppearance(value);
        }}
        aria-label="Color theme"
      />
    ));
    expect(checkedValue()).toBe('system');
    fireEvent.click(screen.getByText('Light'));
    await expect.poll(checkedValue, { timeout: 300 }).toBe('light');
    expect(
      screen.getByText('Light').closest('[data-fdt="choice"]')?.hasAttribute('data-checked')
    ).toBe(true);
  });

  it('carries the group name and the accessible description wiring', () => {
    render(() => (
      <ChoiceGroup
        options={[...OPTIONS]}
        value="system"
        onChange={() => {}}
        aria-label="Color theme"
        aria-describedby="appearance-hint"
      />
    ));
    expect(group().getAttribute('aria-label')).toBe('Color theme');
    // The description rides the hidden radio inputs (the accessible nodes),
    // aggregated by Kobalte from the group.
    const inputs = [...group().querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(
      inputs.every((input) => input.getAttribute('aria-describedby')?.includes('appearance-hint'))
    ).toBe(true);
  });

  it('keeps two groups in one document on disjoint input names (per-instance naming)', () => {
    render(() => (
      <div>
        <ChoiceGroup options={[...OPTIONS]} value="system" onChange={() => {}} aria-label="First" />
        <ChoiceGroup
          options={[...OPTIONS]}
          value="system"
          onChange={() => {}}
          aria-label="Second"
        />
      </div>
    ));
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(inputs).toHaveLength(6);
    // Two groups never share one name — that would merge their radio sets
    // (arrows roving across, selections clobbering); within each group the
    // three inputs still share that group's own single name.
    const names = new Set(inputs.map((input) => input.name));
    expect(names.size).toBe(2);
    for (const name of names) {
      expect(inputs.filter((input) => input.name === name)).toHaveLength(3);
    }
  });

  it('styles exactly the selected tile (checked idiom, no animation state)', () => {
    render(() => (
      <ChoiceGroup
        options={[...OPTIONS]}
        value="light"
        onChange={() => {}}
        aria-label="Color theme"
      />
    ));
    const tiles = [...group().querySelectorAll('[data-fdt="choice"] > label')];
    const light = tiles.find((tile) => tile.textContent === 'Light');
    expect(light?.className).toContain('bg-accent-strong');
    expect(tiles.filter((tile) => tile !== light)).toHaveLength(2);
    for (const unselected of tiles.filter((tile) => tile !== light)) {
      expect(unselected.className).not.toContain('bg-accent-strong');
    }
  });

  it('disables the whole group without hiding it (Kobalte exposes data-disabled)', () => {
    const onChange = vi.fn();
    render(() => (
      <ChoiceGroup
        options={[...OPTIONS]}
        value="system"
        onChange={onChange}
        aria-label="Color theme"
        disabled
      />
    ));
    // The disabled treatment rides the data attribute via the DOM (never a
    // `:disabled` pseudo-class — it cannot match a div/label): the item carries
    // the attribute, the label carries the variant classes it drives.
    const item = group().querySelector('[data-fdt="choice"]');
    expect(item?.hasAttribute('data-disabled')).toBe(true);
    const label = screen.getByText('Dark');
    expect(label.className).toContain('data-disabled:opacity-50');
    expect(label.className).toContain('data-disabled:cursor-not-allowed');
    fireEvent.click(label);
    expect(onChange).not.toHaveBeenCalled();
    const checked = group().querySelector('input:checked');
    expect(checkedValue()).toBe('system');
    expect(checked).toBeTruthy();
  });

  it('gives an unchecked tile hover feedback only while the group is enabled', () => {
    const hover = (): string[] =>
      screen
        .getByText('Dark')
        .className.split(/\s+/)
        .filter((token) => token.startsWith('hover:'));
    render(() => (
      <ChoiceGroup
        options={[...OPTIONS]}
        value="system"
        onChange={vi.fn()}
        aria-label="Color theme"
      />
    ));
    expect(hover()).toEqual(['hover:border-line-3', 'hover:bg-surface-3']);
    cleanup();
    render(() => (
      <ChoiceGroup
        options={[...OPTIONS]}
        value="system"
        onChange={vi.fn()}
        aria-label="Color theme"
        disabled
      />
    ));
    expect(hover()).toEqual([]);
  });

  it('throws when the group is named neither by label nor by reference', () => {
    expect(() =>
      render(() => (
        <ChoiceGroup
          options={[...OPTIONS]}
          // Both naming props intentionally undefined (the wiring bug).
          aria-label={undefined}
          value="system"
          onChange={() => {}}
        />
      ))
    ).toThrow(/aria-label|aria-labelledby/u);
  });

  it('raises zero a11y violations for the wired anatomy (axe, component tier)', async () => {
    render(() => (
      <div>
        <span id="appearance-hint">Pins one palette for every surface</span>
        <ChoiceGroup
          options={[...OPTIONS]}
          value="system"
          onChange={() => {}}
          aria-label="Color theme"
          aria-describedby="appearance-hint"
        />
      </div>
    ));
    const result = await runAxeAudit();
    expect(describeAxeViolations(result.violations)).toBe('');
  });
});
