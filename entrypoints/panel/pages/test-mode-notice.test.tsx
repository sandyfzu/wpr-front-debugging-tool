/**
 * Render tests for the TEST MODE notice, state by state: no test fact (no
 * notice), a fact without a reload seam (words only), a fact with one (the
 * Reload page action) — in the shared notice frame and the warn tone.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STATUS_SOFT_CLASSES, STATUS_TEXT_CLASSES } from '../../../components/ui/status-badge';
import { RUCSS_TEST_MODE_SENTENCE, RUCSS_TEST_MODE_TAG } from '../../../lib/rucss-tester/test-mode';
import { NOTICE_FRAME, NOTICE_ICON_SIZE } from './outcome-notice';
import { TestModeNotice } from './test-mode-notice';

afterEach(() => {
  cleanup();
});

/** The rendered notice, or null. */
function notice(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-fdt="test-mode-notice"]');
}

describe('TestModeNotice', () => {
  it('renders nothing while no test changed the page', () => {
    render(() => <TestModeNotice fact={undefined} reloadInspectedPage={vi.fn()} />);
    expect(notice()).toBeNull();
  });

  it('names the test mode in the warn tone, in the shared notice frame', () => {
    render(() => <TestModeNotice fact={{ runs: 1 }} />);
    const root = notice();
    for (const token of [...NOTICE_FRAME.split(' '), ...STATUS_SOFT_CLASSES.warn.split(' ')]) {
      expect(root?.classList).toContain(token);
    }
    expect(screen.getByText(RUCSS_TEST_MODE_TAG).className).toContain('font-semibold');
    expect(root?.textContent).toContain(RUCSS_TEST_MODE_SENTENCE);
    const icon = root?.querySelector('svg');
    expect(icon?.getAttribute('width')).toBe(String(NOTICE_ICON_SIZE));
    expect(icon?.getAttribute('class')).toContain(STATUS_TEXT_CLASSES.warn);
    // No reload seam: no action.
    expect(root?.querySelector('button')).toBeNull();
  });

  it('offers Reload page when the context can reload, calling it once per click', () => {
    const reload = vi.fn();
    render(() => <TestModeNotice fact={{ runs: 2 }} reloadInspectedPage={reload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
