/**
 * Render tests for the empty view: icon/title/description/action slots and
 * their clean omission.
 */
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_STATE_TILES, EmptyState } from './empty-state';
import { STATE_ICON_SIZE_CLASSES, STATE_ICON_TONE_CLASSES } from './state-icon';
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

  it('sets the icon on the quiet neutral tile by default, the title semibold', () => {
    render(() => <EmptyState icon={<Search size={16} />} title="Nothing to show" />);
    const tile = document.querySelector('[data-fdt="empty-state"] [data-fdt="state-icon"]');
    expect(tile?.querySelector('svg')).not.toBeNull();
    for (const token of [
      ...STATE_ICON_TONE_CLASSES.neutral.split(' '),
      STATE_ICON_SIZE_CLASSES.md
    ]) {
      expect(tile?.classList).toContain(token);
    }
    expect(screen.getByText('Nothing to show').className).toContain('font-semibold');
  });

  it('tool look: the larger accent tile a tool result leads with', () => {
    render(() => <EmptyState look="tool" icon={<Search size={22} />} title="No test run yet" />);
    const tile = document.querySelector('[data-fdt="state-icon"]');
    expect(EMPTY_STATE_TILES.tool).toEqual({ tone: 'accent', size: 'lg' });
    for (const token of [
      ...STATE_ICON_TONE_CLASSES.accent.split(' '),
      STATE_ICON_SIZE_CLASSES.lg
    ]) {
      expect(tile?.classList).toContain(token);
    }
  });

  it('renders no tile without an icon', () => {
    render(() => <EmptyState title="Nothing to show" />);
    expect(document.querySelector('[data-fdt="state-icon"]')).toBeNull();
  });
});
