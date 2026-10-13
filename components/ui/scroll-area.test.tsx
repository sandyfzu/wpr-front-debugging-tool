/**
 * Render tests for the scroll surface: per-axis overflow mapping and the thin
 * token-colored scrollbar classes. No JS scrolling to test — that's the point.
 */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { ScrollArea } from './scroll-area';

afterEach(() => {
  cleanup();
});

describe('ScrollArea', () => {
  it('scrolls vertically by default and never sideways', () => {
    render(() => (
      <ScrollArea>
        <p>content</p>
      </ScrollArea>
    ));
    const area = screen.getByText('content').parentElement;
    expect(area?.dataset.fdt).toBe('scroll-area');
    expect(area?.className).toContain('overflow-y-auto');
    expect(area?.className).toContain('overflow-x-hidden');
    expect(area?.className).toContain('overscroll-contain');
  });

  it('maps the axis to the overflow pair', () => {
    render(() => (
      <div>
        <ScrollArea axis="x">
          <p>sideways</p>
        </ScrollArea>
        <ScrollArea axis="both">
          <p>anywhere</p>
        </ScrollArea>
      </div>
    ));
    expect(screen.getByText('sideways').parentElement?.className).toContain('overflow-x-auto');
    expect(screen.getByText('sideways').parentElement?.className).toContain('overflow-y-hidden');
    expect(screen.getByText('anywhere').parentElement?.className).toContain('overflow-auto');
  });

  it('applies the thin token scrollbar treatment', () => {
    render(() => (
      <ScrollArea>
        <p>content</p>
      </ScrollArea>
    ));
    const area = screen.getByText('content').parentElement;
    expect(area?.className).toContain('[scrollbar-width:thin]');
    // Both engines read the same standard-property treatment (no webkit
    // pseudo styling: Chromium overrides it whenever these are computed).
    expect(area?.className).toContain('[scrollbar-color:var(--line-2)_transparent]');
    expect(area?.className).not.toContain('-webkit-scrollbar');
  });
});
