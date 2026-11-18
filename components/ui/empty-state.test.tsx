/**
 * Render tests for the empty view: icon/title/description/action slots and
 * their clean omission.
 */
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { EmptyState } from './empty-state';
import Search from 'lucide-solid/icons/search';

afterEach(() => {
  cleanup();
});

/**
 * A slot probe that counts its own creations, to prove each slot is built once.
 *
 * @returns The probe and a reader of how many times it was created.
 */
function creationProbe(): { Probe: () => JSX.Element; count: () => number } {
  let created = 0;
  return {
    Probe: () => {
      created += 1;
      return <span data-probe />;
    },
    count: () => created
  };
}

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

  it('builds the icon and action slots exactly once', () => {
    const header = creationProbe();
    const footer = creationProbe();
    render(() => (
      <EmptyState icon={<header.Probe />} title="Nothing to show" action={<footer.Probe />} />
    ));
    expect(header.count()).toBe(1);
    expect(footer.count()).toBe(1);
    expect(document.querySelectorAll('[data-probe]')).toHaveLength(2);
  });
});
