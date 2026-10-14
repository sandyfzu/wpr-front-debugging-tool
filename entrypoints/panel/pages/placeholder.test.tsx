/**
 * Render tests for the shared placeholder body: every registry route renders
 * its label as the single focusable `h1` plus the honest sentence; an id the
 * registry lacks fails fast.
 */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { NAV_ROUTES, type RouteId } from '../routes';
import { placeholderPage } from './placeholder';

afterEach(() => {
  cleanup();
});

describe('placeholderPage', () => {
  it.each(NAV_ROUTES.map((row) => [row.id, row.label] as const))(
    'renders %s as its label h1 + the honest sentence',
    (id, label) => {
      const Body = placeholderPage(id);
      render(() => <Body />);
      const root = document.querySelector(`[data-fdt-page="${id}"]`);
      expect(root?.classList).toContain('fdt-page');
      expect(document.querySelectorAll('h1')).toHaveLength(1);
      const heading = screen.getByRole('heading', { level: 1, name: label });
      expect(heading.getAttribute('tabindex')).toBe('-1');
      expect(screen.getByText(/arrives in a later pass/)).toBeTruthy();
    }
  );

  it('fails fast, naming the id, when the registry has no row for it', () => {
    expect(() => placeholderPage('nope' as RouteId)).toThrow(
      'placeholderPage: no nav registry row for route "nope"'
    );
  });
});
