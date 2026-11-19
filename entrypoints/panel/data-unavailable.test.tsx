/**
 * Render tests for the "no page data here" view: the page's one h1, the
 * reason, the info tile, and no retry (nothing retried changes the answer).
 */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { STATE_ICON_SIZE_CLASSES, STATE_ICON_TONE_CLASSES } from '../../components/ui/state-icon';
import { DATA_UNAVAILABLE_TITLE, DataUnavailable } from './data-unavailable';

afterEach(() => {
  cleanup();
});

describe('DataUnavailable', () => {
  it('names the state in the page h1 and the reason in one sentence, with no retry', () => {
    render(() => <DataUnavailable reason="This browser gives this panel no way to the page." />);
    const view = screen.getByRole('status');
    expect(view.getAttribute('data-fdt')).toBe('data-unavailable');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(DATA_UNAVAILABLE_TITLE);
    expect(screen.getByText('This browser gives this panel no way to the page.')).toBeTruthy();
    expect(view.querySelector('button')).toBeNull();
  });

  it('leads with the large info tile (the error view’s anatomy, the info tone)', () => {
    render(() => <DataUnavailable reason="Reopen DevTools." />);
    const tile = document.querySelector('[data-fdt="data-unavailable"] [data-fdt="state-icon"]');
    for (const token of [...STATE_ICON_TONE_CLASSES.info.split(' '), STATE_ICON_SIZE_CLASSES.lg]) {
      expect(tile?.classList).toContain(token);
    }
    expect(tile?.querySelector('svg')?.getAttribute('width')).toBe('22');
  });
});
