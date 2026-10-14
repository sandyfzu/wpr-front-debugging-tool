import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { gridTemplate, ResourceLink } from './resource-link';

afterEach(() => {
  cleanup();
});

/**
 * A `javascript:` URL built at runtime — as page-captured data arrives; a
 * literal would trip the JSX script-URL lint this test exercises.
 */
function scriptedUrl(): string {
  return ['javascript', 'alert(1)'].join(':');
}

describe('gridTemplate', () => {
  it.each([
    [false, false, 'none'],
    [true, false, 'chip'],
    [false, true, 'state'],
    [true, true, 'both']
  ] as const)('chip=%s state=%s → %s', (chip, state, expected) => {
    expect(gridTemplate(chip, state)).toBe(expected);
  });
});

describe('ResourceLink', () => {
  it('leads with the name, links the full URL in a new tab, and offers the copy', () => {
    const url = 'https://cdn.example/wp-content/uploads/hero.webp';
    const { container } = render(() => <ResourceLink href={url} copyLabel="Image URL" />);
    const name = container.querySelector('[data-fdt="resource-name"]');
    expect(name?.textContent).toBe('hero.webp');
    expect(name?.getAttribute('title')).toBe('hero.webp');
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe(url);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByRole('button', { name: 'Image URL — copy' })).toBeTruthy();
  });

  it('shows a relative URL as plain text (nothing to resolve it against), still copyable', () => {
    render(() => <ResourceLink href="/uploads/a.jpg" copyLabel="URL" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('/uploads/a.jpg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'URL — copy' })).toBeTruthy();
  });

  it('never links a scripted URL', () => {
    render(() => <ResourceLink href={scriptedUrl()} copyLabel="URL" />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('says "No URL captured" with no copy and no link when the URL is empty or blank', () => {
    for (const href of ['', '   ']) {
      const { unmount } = render(() => <ResourceLink href={href} copyLabel="URL" />);
      expect(screen.getByText('No URL captured')).toBeTruthy();
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByRole('link')).toBeNull();
      unmount();
    }
  });

  it('renders each slot exactly once and picks the matching grid template', () => {
    const { container } = render(() => (
      <ResourceLink
        href="https://cdn.example/a.png"
        copyLabel="URL"
        chip={<span data-testid="chip">image</span>}
        state={<span data-testid="state">Lazyloaded</span>}
      >
        <span data-testid="meta">reason</span>
      </ResourceLink>
    ));
    expect(screen.getAllByTestId('chip')).toHaveLength(1);
    expect(screen.getAllByTestId('state')).toHaveLength(1);
    expect(screen.getAllByTestId('meta')).toHaveLength(1);
    const grid = container.querySelector('[data-fdt="resource-link"]');
    expect(grid?.className).toContain('chip_name_state_copy');
  });

  it('orders the DOM name → state → meta → copy → link (reading order before controls)', () => {
    const { container } = render(() => (
      <ResourceLink
        href="https://cdn.example/a.png"
        copyLabel="URL"
        state={<span data-testid="state">Not lazyloaded</span>}
      >
        <span data-testid="meta">data-src</span>
      </ResourceLink>
    ));
    const order = [
      container.querySelector('[data-fdt="resource-name"]'),
      screen.getByTestId('state'),
      screen.getByTestId('meta'),
      screen.getByRole('button'),
      screen.getByRole('link')
    ];
    for (let index = 1; index < order.length; index += 1) {
      const before = order[index - 1];
      const after = order[index];
      if (!before || !after) throw new Error('missing node');
      expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('leaves the meta line empty (hidden) without state or meta content', () => {
    const { container } = render(() => (
      <ResourceLink href="https://cdn.example/a.png" copyLabel="URL" />
    ));
    expect(container.querySelector('[data-fdt="resource-meta"]')?.children).toHaveLength(0);
  });
});
