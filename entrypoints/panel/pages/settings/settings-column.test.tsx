/** The shared settings column: heading + save indicator, skeleton, failure with Retry, form once ready. */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OverflowWatcher } from '../../../../components/ui/overflow-watch';
import type { ConfigSaveState } from './config-writer';
import { LOAD_FAILED_COPY, LOAD_FAILED_TITLE, SettingsColumn } from './settings-column';
import type { SettingsLoadState } from './stored-settings';

afterEach(() => {
  cleanup();
});

/** A watcher that never reports overflow. */
const still: OverflowWatcher = () => () => undefined;

/** Render the column on a load signal; counts how often the form is built. */
function renderColumn(initial: SettingsLoadState['status']) {
  const [load, setLoad] = createSignal(initial);
  const [save] = createSignal<ConfigSaveState>({ status: 'saved' });
  const onRetry = vi.fn();
  let built = 0;
  /** The form stand-in. */
  const Form = () => {
    built++;
    return <p data-testid="form">form</p>;
  };
  render(() => (
    <SettingsColumn
      page="tool"
      load={load()}
      save={save()}
      onRetry={onRetry}
      sections={3}
      watchOverflow={still}
    >
      <Form />
    </SettingsColumn>
  ));
  return { setLoad, onRetry, built: () => built };
}

describe('SettingsColumn', () => {
  it('is the settings area, named by its Settings h2', () => {
    renderColumn('ready');
    const column = document.querySelector('[data-fdt="tool-settings"]');
    const heading = screen.getByRole('heading', { level: 2, name: 'Settings' });
    expect(column?.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(heading.id).toBe('tool-settings-title');
    expect(column?.className).toContain('@wide:[grid-area:settings]');
  });

  it('holds a skeleton per section and no save state while loading, then builds the form once', () => {
    const { setLoad, built } = renderColumn('loading');
    expect(document.querySelector('[data-fdt-tool-form-loading]')?.children).toHaveLength(3);
    expect(document.querySelector('[data-fdt-save]')).toBeNull();
    expect(built()).toBe(0);
    setLoad('ready');
    expect(screen.getByTestId('form')).toBeTruthy();
    expect(built()).toBe(1);
    const save = document.querySelector('[data-fdt-save]');
    expect(save?.textContent).toBe('Saved');
    // Beside the heading, in its row.
    expect(save?.closest('div')?.parentElement).toBe(
      screen.getByRole('heading', { level: 2 }).parentElement
    );
  });

  it('shows the failure with Retry, without the form or a save state', () => {
    const { onRetry } = renderColumn('failed');
    expect(screen.getByText(LOAD_FAILED_TITLE)).toBeTruthy();
    expect(screen.getByText(LOAD_FAILED_COPY)).toBeTruthy();
    expect(screen.queryByTestId('form')).toBeNull();
    expect(document.querySelector('[data-fdt-save]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
