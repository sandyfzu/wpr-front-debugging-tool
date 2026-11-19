/**
 * Render tests for the page-state frame: one raised card, centered at a
 * reading width, holding the state view.
 */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { PAGE_STATE_CARD_CLASSES, PageStateCard } from './page-state-card';

afterEach(() => {
  cleanup();
});

describe('PageStateCard', () => {
  it('frames the state in one raised card, centered and width-capped', () => {
    render(() => (
      <PageStateCard>
        <p>State words</p>
      </PageStateCard>
    ));
    const frame = document.querySelector('[data-fdt="page-state-card"]');
    // A layout-free hook: the card is the column's own item.
    expect(frame?.className).toBe('contents');
    const card = frame?.querySelector('[data-fdt="card"]');
    for (const token of [...PAGE_STATE_CARD_CLASSES.split(' '), 'shadow-elev-1', 'bg-surface-2']) {
      expect(card?.classList).toContain(token);
    }
    expect(card?.contains(screen.getByText('State words'))).toBe(true);
  });
});
