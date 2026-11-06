/** The save line: each writer state's words, failures in their own message and error color. */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConfigSaveState } from './config-writer';
import { SAVE_COPY, SaveLine } from './save-line';

afterEach(() => {
  cleanup();
});

/** The rendered line. */
function line(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-fdt-save]');
  if (element === null) throw new Error('no save line');
  return element;
}

describe('SaveLine', () => {
  it.each(['saved', 'pending', 'saving'] as const)('says %s in muted words', (status) => {
    render(() => <SaveLine state={{ status }} />);
    expect(line().getAttribute('data-fdt-save')).toBe(status);
    expect(line().textContent).toBe(SAVE_COPY[status]);
    expect(line().className).toContain('text-fg-muted');
  });

  it.each<ConfigSaveState>([
    { status: 'refused', message: 'Too large.' },
    { status: 'failed', message: "Couldn't save." }
  ])('shows a $status save with its own message', (state) => {
    render(() => <SaveLine state={state} />);
    expect(line().getAttribute('data-fdt-save')).toBe('failed');
    expect(line().textContent).toBe('message' in state ? state.message : '');
    expect(line().className).not.toContain('text-fg-muted');
  });
});
