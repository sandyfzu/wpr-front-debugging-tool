/** The shared outcome block: tone icon + tint, title, message, children, root attributes. */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { STATUS_SOFT_CLASSES } from '../../../components/ui/status-badge';
import { OutcomeNotice } from './outcome-notice';

afterEach(() => {
  cleanup();
});

describe('OutcomeNotice', () => {
  it('renders the tone, words, children and the caller’s test hooks on its root', () => {
    render(() => (
      <OutcomeNotice data-fdt="tool-outcome" kind="warn" title="Ran out of time" message="Partial.">
        <button type="button">Run again</button>
      </OutcomeNotice>
    ));
    const root = document.querySelector<HTMLElement>('[data-fdt="tool-outcome"]');
    expect(root).not.toBeNull();
    for (const token of STATUS_SOFT_CLASSES.warn.split(' '))
      expect(root?.classList).toContain(token);
    expect(screen.getByText('Ran out of time').className).toContain('font-semibold');
    expect(screen.getByText('Partial.')).toBeTruthy();
    expect(root?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Run again' })).toBeTruthy();
  });
});
