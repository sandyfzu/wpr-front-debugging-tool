/**
 * Render tests for the page header: the single `h1` with its `tabindex="-1"`
 * focus contract (the shell's route-switch focus target), the subtitle slot
 * and the actions slot.
 */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from './button';
import { PageHeader } from './page-header';

afterEach(() => {
  cleanup();
});

describe('PageHeader', () => {
  it('renders the title as the focusable h1 and the subtitle', () => {
    render(() => (
      <PageHeader
        title="JavaScript"
        subtitle="Scripts the page shipped, and how they are treated"
      />
    ));
    const heading = screen.getByRole('heading', { name: 'JavaScript', level: 1 });
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(heading.getAttribute('data-fdt-page-title')).toBe('');
    expect(screen.getByText('Scripts the page shipped, and how they are treated')).toBeTruthy();
  });

  it('omits the subtitle without one and renders the trailing actions', () => {
    render(() => (
      <PageHeader title="Overview" actions={<Button variant="secondary">Reload data</Button>} />
    ));
    expect(document.querySelector('[data-fdt-page-subtitle]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reload data' })).toBeTruthy();
  });

  it('renders subtitle and actions together', () => {
    render(() => (
      <PageHeader
        title="Lazyload"
        subtitle="Images, iframes and backgrounds"
        actions={<span data-testid-slot-note>slot</span>}
      />
    ));
    expect(screen.getByText('Images, iframes and backgrounds')).toBeTruthy();
    expect(screen.getByText('slot')).toBeTruthy();
  });
});
