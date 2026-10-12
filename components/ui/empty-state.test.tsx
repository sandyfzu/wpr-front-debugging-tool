/**
 * Render tests for the empty view: icon/title/description/action slots and
 * their clean omission.
 */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { EmptyState } from './empty-state';
import { Search } from 'lucide-solid';

afterEach(() => {
  cleanup();
});

describe('EmptyState', () => {
  it('renders icon, title, description and optional action', () => {
    render(() => (
      <EmptyState
        icon={<Search size={16} />}
        title="No references watch"
        description="Add a monitor to see word matches here."
        action={<button type="button">Add monitor</button>}
      />
    ));
    expect(document.querySelector('[data-fdt="empty-state"] svg')).toBeTruthy();
    expect(screen.getByText('No references watch')).toBeTruthy();
    expect(screen.getByText('Add a monitor to see word matches here.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add monitor' })).toBeTruthy();
  });

  it('omits the optional slots cleanly', () => {
    render(() => <EmptyState title="Nothing to show" />);
    const empty = document.querySelector('[data-fdt="empty-state"]');
    expect(empty?.querySelector('p')).toBeNull();
    expect(empty?.querySelector('svg')).toBeNull();
    expect(empty?.querySelector('button')).toBeNull();
  });
});
