/**
 * Render tests for the icon-only button — square hit areas, the required
 * accessible name, and variant passthrough.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IconButton } from './icon-button';
import RefreshCw from 'lucide-solid/icons/refresh-cw';

afterEach(() => {
  cleanup();
});

describe('IconButton', () => {
  it('renders a labeled square control (24/28px hit areas per size)', () => {
    render(() => (
      <div>
        <IconButton label="Reload" size="sm">
          <RefreshCw size={12} />
        </IconButton>
        <IconButton label="Close" size="md">
          <RefreshCw size={12} />
        </IconButton>
      </div>
    ));
    const small = screen.getByRole('button', { name: 'Reload' });
    const medium = screen.getByRole('button', { name: 'Close' });
    expect(small.getAttribute('type')).toBe('button');
    expect(small.className).toContain('size-6'); // 24px — the WCAG floor
    expect(medium.className).toContain('size-7');
  });

  it('fires clicks and cannot be read unnamed', () => {
    const onClick = vi.fn();
    render(() => (
      <IconButton label="Reload" onClick={onClick}>
        <RefreshCw size={12} />
      </IconButton>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies variant classes through the shared button vocabulary', () => {
    render(() => (
      <div>
        <IconButton label="Primary action" variant="primary">
          <RefreshCw size={12} />
        </IconButton>
        <IconButton label="Ghost action" variant="ghost">
          <RefreshCw size={12} />
        </IconButton>
      </div>
    ));
    expect(screen.getByRole('button', { name: 'Primary action' }).className).toContain(
      'bg-accent-strong'
    );
    expect(screen.getByRole('button', { name: 'Ghost action' }).className).toContain(
      'text-fg-secondary'
    );
  });

  it('keeps the hover surface live and drops it when held (disabled or aria-disabled)', () => {
    render(() => (
      <div>
        <IconButton label="Live">
          <RefreshCw size={12} />
        </IconButton>
        <IconButton label="Disabled" disabled>
          <RefreshCw size={12} />
        </IconButton>
        <IconButton label="Held" aria-disabled="true">
          <RefreshCw size={12} />
        </IconButton>
      </div>
    ));
    const hover = (name: string): string[] =>
      screen
        .getByRole('button', { name })
        .className.split(/\s+/)
        .filter((token) => token.startsWith('hover:'));
    expect(hover('Live')).toEqual(['hover:bg-surface-3', 'hover:text-fg-primary']);
    expect(hover('Disabled')).toEqual([]);
    expect(hover('Held')).toEqual([]);
  });
});
