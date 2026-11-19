/** The save line: each writer state's words, failures in their own message and error color. */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConfigSaveState } from './config-writer';
import { SAVE_COPY, SAVE_INDICATOR_COPY, SaveLine } from './save-line';

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

describe('SaveLine — indicator', () => {
  it('says Saved with a check, the full sentence in its title', () => {
    render(() => <SaveLine state={{ status: 'saved' }} look="indicator" />);
    expect(line().getAttribute('data-fdt-save')).toBe('saved');
    expect(line().textContent).toBe(SAVE_INDICATOR_COPY.saved);
    expect(line().getAttribute('title')).toBe(SAVE_COPY.saved);
    expect(line().querySelector('svg')?.getAttribute('class')).toContain('text-status-ok');
    expect(line().className).toContain('text-fg-muted');
  });

  it.each(['pending', 'saving'] as const)(
    'says %s in the line words, no check or title',
    (status) => {
      render(() => <SaveLine state={{ status }} look="indicator" />);
      expect(line().textContent).toBe(SAVE_COPY[status]);
      expect(line().querySelector('svg')).toBeNull();
      expect(line().hasAttribute('title')).toBe(false);
    }
  );

  it('shows a failed save with its own message, as the line does', () => {
    render(() => <SaveLine state={{ status: 'failed', message: 'Quota.' }} look="indicator" />);
    expect(line().getAttribute('data-fdt-save')).toBe('failed');
    expect(line().textContent).toBe('Quota.');
    expect(line().className).toContain('text-status-error');
  });

  it('leaves the default line without the indicator parts', () => {
    render(() => <SaveLine state={{ status: 'saved' }} />);
    expect(line().querySelector('svg')).toBeNull();
    expect(line().hasAttribute('title')).toBe(false);
    expect(line().className).toBe('text-2xs text-fg-muted');
  });
});
