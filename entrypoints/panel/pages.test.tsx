/**
 * Wiring tests for the route-body table and the shared placeholder: the five
 * page folders are mapped to their routes, every other route falls back to
 * the placeholder, and every body still renders the honest placeholder page.
 */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { PAGE_BODIES, PAGES } from './pages';
import { DetectionsPage } from './pages/detections/page';
import { JavaScriptPage } from './pages/javascript/page';
import { LazyloadPage } from './pages/lazyload/page';
import { placeholderPage } from './pages/placeholder';
import { PreloadedResourcesPage } from './pages/preloaded-resources/page';
import { UndefinedReferencesPage } from './pages/undefined-references/page';
import { NAV_ROUTES, type RouteId } from './routes';

afterEach(() => {
  cleanup();
});

describe('PAGES wiring', () => {
  it('maps the five page folders to their routes', () => {
    expect(PAGES.detections).toBe(DetectionsPage);
    expect(PAGES.javascript).toBe(JavaScriptPage);
    expect(PAGES.lazyload).toBe(LazyloadPage);
    expect(PAGES['preloaded-resources']).toBe(PreloadedResourcesPage);
    expect(PAGES['undefined-references']).toBe(UndefinedReferencesPage);
  });

  it('falls back to a placeholder for routes without a page folder', () => {
    expect(PAGE_BODIES.diagnoser).toBeUndefined();
    expect(typeof PAGES.diagnoser).toBe('function');
  });

  it.each(NAV_ROUTES.map((row) => [row.id, row.label] as const))(
    '%s still renders the placeholder body (no visible change yet)',
    (id, label) => {
      const Body = PAGES[id];
      render(() => <Body />);
      const root = document.querySelector(`[data-fdt-page="${id}"]`);
      expect(root?.classList).toContain('fdt-page');
      expect(document.querySelectorAll('h1')).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1, name: label })).toBeTruthy();
      expect(screen.getByText(/arrives in a later pass/)).toBeTruthy();
    }
  );
});

describe('placeholderPage', () => {
  it('renders a focusable h1 for the route label', () => {
    const Body = placeholderPage('diagnoser');
    render(() => <Body />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Diagnoser' });
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  it('fails fast, naming the id, when the registry has no row for it', () => {
    expect(() => placeholderPage('nope' as RouteId)).toThrow(
      'placeholderPage: no nav registry row for route "nope"'
    );
  });
});
