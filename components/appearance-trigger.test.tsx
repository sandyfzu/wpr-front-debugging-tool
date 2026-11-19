/** The appearance trigger's face: the resolved palette, its name, its icon, and its frame. */
import { cleanup, render } from '@solidjs/testing-library';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import type { Appearance, Theme } from '../utils/theme';
import { AppearanceFrame, AppearanceIcon, createAppearanceTrigger } from './appearance-trigger';
import { fakeScheme } from './system-dark.fake';

afterEach(cleanup);

describe('createAppearanceTrigger', () => {
  it('resolves an explicit choice regardless of the OS', () => {
    createRoot((dispose) => {
      const state = createAppearanceTrigger(() => 'light', fakeScheme(true));
      expect(state.resolved()).toBe('light');
      expect(state.label()).toBe('Appearance: Light');
      dispose();
    });
  });

  it('follows the OS live for System, and the stored choice as it changes', () => {
    createRoot((dispose) => {
      const scheme = fakeScheme(false);
      const [value, setValue] = createSignal<Appearance>('system');
      const state = createAppearanceTrigger(value, scheme);
      expect(state.label()).toBe('Appearance: System (Light)');
      scheme.flip(true);
      expect(state.resolved()).toBe('dark');
      expect(state.label()).toBe('Appearance: System (Dark)');
      setValue('dark');
      expect(state.label()).toBe('Appearance: Dark');
      dispose();
      // The OS listener leaves with its owner.
      expect(scheme.listeners()).toBe(0);
    });
  });

  it('answers light without a preference query', () => {
    createRoot((dispose) => {
      const state = createAppearanceTrigger(() => 'system', null);
      expect(state.resolved()).toBe('light');
      dispose();
    });
  });
});

describe('AppearanceIcon', () => {
  it('shows the moon for dark and the sun for light, hidden from assistive tech', () => {
    const [theme, setTheme] = createSignal<Theme>('dark');
    const { container } = render(() => <AppearanceIcon resolved={theme()} />);
    const icon = (): SVGElement | null => container.querySelector('svg');
    expect(icon()?.classList.contains('lucide-moon')).toBe(true);
    expect(icon()?.getAttribute('aria-hidden')).toBe('true');
    setTheme('light');
    expect(icon()?.classList.contains('lucide-sun')).toBe(true);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });
});

describe('AppearanceFrame', () => {
  it('wraps the trigger in the control hook, publishing the resolved palette live', () => {
    const [theme, setTheme] = createSignal<Theme>('dark');
    const { container } = render(() => (
      <AppearanceFrame resolved={theme()}>
        <button type="button">trigger</button>
      </AppearanceFrame>
    ));
    const frame = container.firstElementChild as HTMLElement;
    expect(frame.dataset['fdt']).toBe('appearance-menu');
    expect(frame.dataset['fdtResolved']).toBe('dark');
    expect(frame.className).toBe('inline-flex shrink-0');
    expect(frame.hasAttribute('data-fdt-pending')).toBe(false);
    expect(frame.querySelector('button')?.textContent).toBe('trigger');
    setTheme('light');
    expect(frame.dataset['fdtResolved']).toBe('light');
  });

  it('marks a waiting stand-in as pending', () => {
    const { container } = render(() => (
      <AppearanceFrame resolved="light" pending>
        <span />
      </AppearanceFrame>
    ));
    expect((container.firstElementChild as HTMLElement).getAttribute('data-fdt-pending')).toBe('');
  });
});
