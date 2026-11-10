/** The state-chip renderer: visible chips with marks and titles, the "+N" chip, no tab stops. */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { StateChips } from './state-chip-list';
import { NO_STATE_CHIPS, splitStateChips, type StateChip } from './state-chips';

afterEach(cleanup);

const CHIPS: StateChip[] = [
  { id: 'excluded', label: 'Excluded', kind: 'warn', title: 'Excluded by FDT from X' },
  { id: 'deferred', label: 'Deferred', kind: 'info', mark: 'WP Rocket' },
  { id: 'a', label: 'A', kind: 'info' },
  { id: 'b', label: 'B', kind: 'info' },
  { id: 'c', label: 'C', kind: 'info', mark: 'M' }
];

describe('StateChips', () => {
  it('renders nothing for a row without states', () => {
    const { container } = render(() => <StateChips chips={NO_STATE_CHIPS} />);
    expect(container.textContent).toBe('');
  });

  it('renders the visible chips in order with their kind, mark and title, then "+N"', () => {
    const { container } = render(() => <StateChips chips={splitStateChips(CHIPS)} />);
    const chips = [...container.querySelectorAll<HTMLElement>('[data-fdt="state-chip"]')];
    expect(chips.map((chip) => chip.dataset.fdtState)).toEqual(['excluded', 'deferred', 'a']);
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'Excluded',
      'Deferred (WP Rocket)',
      'A'
    ]);
    const excluded = chips[0]?.querySelector('[data-fdt="status-badge"]');
    expect(excluded?.className).toContain('text-status-warn');
    expect(excluded?.getAttribute('title')).toBe('Excluded by FDT from X');
    expect(chips[2]?.querySelector('[data-fdt="status-badge"]')?.hasAttribute('title')).toBe(false);
    const overflow = container.querySelector('[data-fdt="state-chip-overflow"] [data-fdt="badge"]');
    expect(overflow?.textContent).toBe('+2');
    expect(overflow?.getAttribute('title')).toBe('Also: B, C (M)');
  });

  it('is non-interactive: no button, no tab stop', () => {
    const { container } = render(() => <StateChips chips={splitStateChips(CHIPS)} />);
    expect(container.querySelector('button, [tabindex]')).toBeNull();
  });
});
