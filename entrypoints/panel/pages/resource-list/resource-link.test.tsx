import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyLabel, gridTemplate, ResourceLink } from './resource-link';

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
    const { container } = render(() => <ResourceLink href={url} copyNoun="Image URL" />);
    const name = container.querySelector('[data-fdt="resource-name"]');
    expect(name?.textContent).toBe('hero.webp');
    expect(name?.getAttribute('title')).toBe('hero.webp');
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe(url);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByRole('button', { name: 'Image URL (hero.webp) — copy' })).toBeTruthy();
    expect(link.className).toContain('text-fg-secondary');
    expect(link.className).toContain('hover:text-accent');
  });

  it('shows a relative URL as plain text (nothing to resolve it against), still copyable', () => {
    render(() => <ResourceLink href="/uploads/a.jpg" copyNoun="URL" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('/uploads/a.jpg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'URL (a.jpg) — copy' })).toBeTruthy();
  });

  it('never links a scripted URL', () => {
    render(() => <ResourceLink href={scriptedUrl()} copyNoun="URL" />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('says "No URL captured" with no copy and no link when the URL is empty or blank', () => {
    for (const href of ['', '   ']) {
      const { unmount } = render(() => <ResourceLink href={href} copyNoun="URL" />);
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
        copyNoun="URL"
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
        copyNoun="URL"
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
      <ResourceLink href="https://cdn.example/a.png" copyNoun="URL" />
    ));
    expect(container.querySelector('[data-fdt="resource-meta"]')?.children).toHaveLength(0);
  });

  it('shows a clipped URL as flagged plain text, copied under a warning name', () => {
    const url = `https://cdn.example/${'a'.repeat(5000)}`;
    const { container } = render(() => <ResourceLink href={url} copyNoun="Image URL" clipped />);
    expect(screen.queryByRole('link')).toBeNull();
    const line = container.querySelector('[data-fdt="resource-url-clipped"]');
    expect(line?.textContent).toContain('Clipped');
    const text = line?.querySelector('[title]');
    expect(text?.getAttribute('title')?.endsWith('…')).toBe(true);
    expect(screen.getByRole('button', { name: /^Image URL \(.*, clipped\) — copy$/ })).toBeTruthy();
  });

  it('caps the name title', () => {
    const name = 'n'.repeat(400);
    const { container } = render(() => (
      <ResourceLink href={`https://cdn.example/${name}`} copyNoun="URL" />
    ));
    const title = container.querySelector('[data-fdt="resource-name"]')?.getAttribute('title');
    expect(title?.length).toBe(301);
  });

  it("uses the caller's missing-URL wording and keeps the copy column", () => {
    const { container } = render(() => (
      <ResourceLink href="" copyNoun="URL" missingLabel="No URL (srcset only)" />
    ));
    expect(screen.getByText('No URL (srcset only)')).toBeTruthy();
    expect(container.querySelector('[data-fdt="resource-copy-placeholder"]')).not.toBeNull();
  });
});

describe('ResourceLink copy options', () => {
  it('names the copy by the noun alone when the row name is off (established list names)', () => {
    render(() => (
      <ResourceLink
        href="https://cdn.example/wp-includes/js/jquery/jquery.min.js?ver=3.7.1"
        copyNoun="Script URL"
        copyNamesRow={false}
      />
    ));
    expect(screen.getByRole('button', { name: 'Script URL — copy' })).toBeTruthy();
  });

  it('reads the complete text through the loader on copy (the shown URL may be bounded)', async () => {
    const loadCopyText = vi.fn(() => Promise.resolve('https://cdn.example/full.js'));
    render(() => (
      <ResourceLink
        href="https://cdn.example/clipped"
        copyNoun="Script URL"
        copyNamesRow={false}
        loadCopyText={loadCopyText}
        copyLoadFailure="Refresh the panel and try copying again."
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Script URL — copy' }));
    await vi.waitFor(() => {
      expect(loadCopyText).toHaveBeenCalledTimes(1);
    });
  });

  it('caps the state track so many chips wrap instead of squeezing the name out', () => {
    const { container } = render(() => (
      <ResourceLink href="https://cdn.example/a.js" copyNoun="URL" state={<span>Delayed</span>} />
    ));
    const grid = container.querySelector('[data-fdt="resource-link"]');
    expect(grid?.className).toContain('@regular:grid-cols-[minmax(0,1fr)_fit-content(50%)_auto]');
  });
});

describe('copyLabel', () => {
  it('names the row and warns for a clipped URL', () => {
    expect(copyLabel('Image URL', 'hero.webp', false)).toBe('Image URL (hero.webp)');
    expect(copyLabel('Image URL', 'hero.webp', true)).toBe('Image URL (hero.webp, clipped)');
  });

  it('caps the name inside the label (a clipped 4 KB URL stays a short name)', () => {
    const label = copyLabel('Image URL', 'a'.repeat(4096), true);
    expect(label).toBe(`Image URL (${'a'.repeat(60)}…, clipped)`);
    expect(copyLabel('URL', 'b'.repeat(60), false)).toBe(`URL (${'b'.repeat(60)})`);
  });
});
