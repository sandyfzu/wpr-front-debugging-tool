/** The save indicator: each writer state's words, the saved check + title, failures in their own message and error color. */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConfigSaveState } from './config-writer';
import { SAVE_COPY, SAVED_TITLE, SaveLine } from './save-line';

afterEach(() => {
  cleanup();
});

/** The rendered indicator. */
function line(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-fdt-save]');
  if (element === null) throw new Error('no save indicator');
  return element;
}

describe('SaveLine', () => {
  it('says Saved with a check, the full sentence in its title', () => {
    render(() => <SaveLine state={{ status: 'saved' }} />);
    expect(line().getAttribute('data-fdt-save')).toBe('saved');
    expect(line().textContent).toBe('Saved');
    expect(SAVE_COPY.saved).toBe('Saved');
    expect(line().getAttribute('title')).toBe(SAVED_TITLE);
    expect(SAVED_TITLE).toBe('Settings saved for every site.');
    expect(line().querySelector('svg')?.getAttribute('class')).toContain('text-status-ok');
    expect(line().className).toContain('text-fg-muted');
  });

  it.each(['pending', 'saving'] as const)('says %s in muted words, no check or title', (status) => {
    render(() => <SaveLine state={{ status }} />);
    expect(line().getAttribute('data-fdt-save')).toBe(status);
    expect(line().textContent).toBe(SAVE_COPY[status]);
    expect(line().className).toContain('text-fg-muted');
    expect(line().querySelector('svg')).toBeNull();
    expect(line().hasAttribute('title')).toBe(false);
  });

  it('keeps the pending and saving words', () => {
    expect(SAVE_COPY.pending).toBe('Unsaved changes…');
    expect(SAVE_COPY.saving).toBe('Saving…');
  });

  it.each<ConfigSaveState>([
    { status: 'refused', message: 'Too large.' },
    { status: 'failed', message: "Couldn't save." }
  ])('shows a $status save with its own message in the error color', (state) => {
    render(() => <SaveLine state={state} />);
    expect(line().getAttribute('data-fdt-save')).toBe('failed');
    expect(line().textContent).toBe('message' in state ? state.message : '');
    expect(line().className).not.toContain('text-fg-muted');
    expect(line().className).toContain('text-status-error');
  });
});
