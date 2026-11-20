/**
 * Render tests for the shared tabs — the one sub-navigation pattern. The
 * stateful core is Kobalte's APG behavior driven through our wrapper: control
 * (click/controlled), automatic activation (arrows move focus AND selection),
 * and disabled-tab skipping, with our vocabulary hooks present.
 *
 * Portability note: happy-dom's `getComputedStyle().animationName` is `""`
 * (not `"none"`), so solid-presence cannot decide an exit has finished and
 * keeps unselected panels mounted here. In Chromium — the target — panels
 * unmount; tests therefore assert the *selected* hooks, not DOM removal.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tabs, TabPanel } from './tabs';
import type { TabItem } from './tabs';

const ITEMS: TabItem[] = [
  { value: 'general', label: 'General' },
  { value: 'optimizations', label: 'Optimizations', badge: '12' },
  { value: 'reserved', label: 'Reserved', disabled: true }
];

const BILL = () => (
  <>
    <TabPanel value="general">
      <p data-fdt-panel="general">general panel</p>
    </TabPanel>
    <TabPanel value="optimizations">
      <p data-fdt-panel="optimizations">optimizations panel</p>
    </TabPanel>
    <TabPanel value="reserved">
      <p data-fdt-panel="reserved">reserved panel</p>
    </TabPanel>
  </>
);

afterEach(() => {
  cleanup();
});

describe('Tabs', () => {
  it('renders the APG semantics and marks the first enabled tab selected', () => {
    render(() => (
      <Tabs items={ITEMS} label="Report views">
        <BILL />
      </Tabs>
    ));
    const list = screen.getByRole('tablist');
    expect(list.getAttribute('aria-label')).toBe('Report views');
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[2]?.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('general panel')).toBeTruthy();
    // The badge renders next to its trigger's label.
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('puts the root classes on the wrapper around the bar and the panels', () => {
    render(() => (
      <Tabs items={ITEMS} label="Views" rootClass="flex flex-1 flex-col" class="bar">
        <BILL />
      </Tabs>
    ));
    const list = screen.getByRole('tablist');
    const root = list.parentElement;
    expect(list.classList.contains('bar')).toBe(true);
    expect(root?.className).toBe('flex flex-1 flex-col');
    expect(root?.contains(screen.getByText('general panel'))).toBe(true);
  });

  it('switches on click and reports the change', () => {
    const onChange = vi.fn();
    render(() => (
      <Tabs items={ITEMS} onChange={onChange}>
        <BILL />
      </Tabs>
    ));
    fireEvent.click(screen.getByRole('tab', { name: /Optimizations/ }));
    expect(onChange).toHaveBeenCalledWith('optimizations');
    const optimized = screen.getByRole('tab', { name: /Optimizations/ });
    expect(optimized.getAttribute('aria-selected')).toBe('true');
    expect(optimized.getAttribute('data-fdt-tab')).toBe('optimizations');
    expect(screen.getByText('optimizations panel')).toBeTruthy();
  });

  it('follows the controlled value loop', () => {
    // Controlled usage in Solid: the parent owns the value signal, passes it
    // as `value`, and takes the change back through `onChange`.
    const [value, setValue] = createSignal('general');
    render(() => (
      <Tabs items={ITEMS} value={value()} onChange={setValue}>
        <BILL />
      </Tabs>
    ));
    expect(screen.getByRole('tab', { name: /General/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: /Optimizations/ }));
    // The signal took the change (fed back through the controlled loop) and
    // the selection moved with it — pinned on the rendered attributes.
    expect(screen.getByRole('tab', { name: /Optimizations/ }).getAttribute('aria-selected')).toBe(
      'true'
    );
  });

  it('activates automatically on arrow navigation (APG automatic mode)', () => {
    render(() => (
      <Tabs items={ITEMS}>
        <BILL />
      </Tabs>
    ));
    screen.getByRole('tab', { name: /General/ }).focus();
    const list = screen.getByRole('tablist');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    const next = screen.getByRole('tab', { name: /Optimizations/ });
    // Selection moved with the focus, without a click (automatic activation).
    expect(next.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('optimizations panel')).toBeTruthy();
  });

  it('navigates with wrapping and skips disabled tabs', () => {
    render(() => (
      <Tabs items={ITEMS}>
        <BILL />
      </Tabs>
    ));
    // Start on the last enabled tab; ArrowRight skips the disabled trigger
    // and wraps around to the first tab.
    fireEvent.click(screen.getByRole('tab', { name: /Optimizations/ }));
    const list = screen.getByRole('tablist');
    screen.getAllByRole('tab')[2]?.focus();
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /General/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('navigates backwards from the second tab to the first', () => {
    render(() => (
      <Tabs items={ITEMS}>
        <BILL />
      </Tabs>
    ));
    fireEvent.click(screen.getByRole('tab', { name: /Optimizations/ }));
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: /General/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('jumps Home to the first tab and End to the last enabled one, activating both', () => {
    // APG roving focus: Home/End belong to the keyboard map Kobalte's tabs
    // implement — pin both ends with the automatic activation consequence.
    render(() => (
      <Tabs items={ITEMS}>
        <BILL />
      </Tabs>
    ));
    fireEvent.click(screen.getByRole('tab', { name: /General/ }));
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });
    const lastEnabled = screen.getByRole('tab', { name: /Optimizations/ });
    expect(lastEnabled.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(lastEnabled);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Home' });
    const first = screen.getByRole('tab', { name: /General/ });
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(first);
    // The disabled tab is never the Home/End landing spot at either end.
    expect(screen.getByRole('tab', { name: /Reserved/ }).getAttribute('aria-selected')).toBe(
      'false'
    );
  });

  it('never selects the disabled tab from clicks or keyboard', () => {
    render(() => (
      <Tabs items={ITEMS}>
        <BILL />
      </Tabs>
    ));
    const disabledTab = screen.getByRole('tab', { name: /Reserved/ });
    fireEvent.click(disabledTab);
    expect(disabledTab.getAttribute('aria-selected')).toBe('false');
    // Keyboard navigation from the first tab backwards (wrapping) never rests
    // on the disabled trigger in the middle.
    const list = screen.getByRole('tablist');
    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    expect(disabledTab.getAttribute('aria-selected')).toBe('false');
  });

  it('fragments the disabled treatment from the hover treatment (disabled-but-explained tooltips)', () => {
    // The disabled row keeps hover reachable (no pointer-events kill) so a
    // tooltip can explain it, while the hover tint stays enabled-only —
    // pinned as class composition: the two fragments never share classes.
    render(() => (
      <Tabs items={ITEMS}>
        <BILL />
      </Tabs>
    ));
    const enabled = screen.getByRole('tab', { name: /General/ });
    const disabled = screen.getByRole('tab', { name: /Reserved/ });
    expect(disabled.className).toContain('opacity-60');
    expect(disabled.className).toContain('text-fg-muted');
    expect(disabled.className).not.toContain('pointer-events-none');
    expect(disabled.className).not.toContain('hover:text-fg-primary');
    expect(enabled.className).toContain('hover:text-fg-primary');
    expect(enabled.className).not.toContain('opacity-60');
  });

  it('draws underline tabs: text on one quiet hairline, the accent rule only on the selected one', () => {
    render(() => (
      <Tabs items={ITEMS} label="Views">
        <BILL />
      </Tabs>
    ));
    const list = screen.getByRole('tablist').className.split(/\s+/);
    expect(list).toEqual(expect.arrayContaining(['gap-4', 'border-b', 'border-line-1']));
    expect(list).not.toContain('border-line-2');
    for (const tab of screen.getAllByRole('tab')) {
      const tokens = tab.className.split(/\s+/);
      expect(tokens).toEqual(
        expect.arrayContaining([
          'h-8',
          'px-0.5',
          '-mb-px',
          'border-b-2',
          'border-transparent',
          'data-selected:border-accent',
          'data-selected:text-fg-primary',
          'text-fg-muted'
        ])
      );
      // No fill on hover or selection: the underline is the only emphasis.
      expect(tokens.filter((token) => token.includes('bg-'))).toEqual([]);
    }
    const selected = screen.getByRole('tab', { selected: true });
    expect(selected.hasAttribute('data-selected')).toBe(true);
    expect(screen.getByRole('tab', { name: /Optimizations/ }).hasAttribute('data-selected')).toBe(
      false
    );
  });
});
