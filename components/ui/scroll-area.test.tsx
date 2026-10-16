/**
 * Render tests for per-axis overflow mapping and the stable gutter. Shared
 * native scrollbar appearance and scrolling are verified in the browser tier.
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

  it('reserves a stable gutter without overriding shared scrollbar accessibility styles', () => {
    render(() => (
      <ScrollArea>
        <p>content</p>
      </ScrollArea>
    ));
    const area = screen.getByText('content').parentElement;
    expect(area?.className).toContain('[scrollbar-gutter:stable]');
    expect(area?.className).not.toContain('scrollbar-width:');
    expect(area?.className).not.toContain('scrollbar-color:');
  });
});
