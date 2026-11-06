/**
 * Wiring tests for the route-body table and the shared placeholder: the six
 * page folders are mapped to their routes, the Beacon Tester loads lazily
 * (`pages/lazy-page.test.tsx`), and every other route falls back to the
 * placeholder. Page bodies are tested in their
 * own folders (the placeholder in `pages/placeholder.test.tsx`), never here.
 */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { PAGE_BODIES, PAGES } from './pages';
import { DetectionsPage } from './pages/detections/page';
import { HeadersCookiesPage } from './pages/headers-cookies/page';
import { JavaScriptPage } from './pages/javascript/page';
import { LazyloadPage } from './pages/lazyload/page';
import { PreloadedResourcesPage } from './pages/preloaded-resources/page';
import { UndefinedReferencesPage } from './pages/undefined-references/page';
import { NAV_ROUTES } from './routes';

afterEach(() => {
  cleanup();
});

describe('PAGES wiring', () => {
  it('maps the six page folders to their routes', () => {
    expect(PAGES.detections).toBe(DetectionsPage);
    expect(PAGES.javascript).toBe(JavaScriptPage);
    expect(PAGES.lazyload).toBe(LazyloadPage);
    expect(PAGES['preloaded-resources']).toBe(PreloadedResourcesPage);
    expect(PAGES['undefined-references']).toBe(UndefinedReferencesPage);
    expect(PAGES['headers-cookies']).toBe(HeadersCookiesPage);
  });

  it('falls back to a placeholder for routes without a page folder', () => {
    expect(PAGE_BODIES.diagnoser).toBeUndefined();
    expect(typeof PAGES.diagnoser).toBe('function');
  });

  it('renders the placeholder for every route without a page folder', () => {
    // Routes WITH a folder are their page's own tests (in that folder) — this
    // file pins only the wiring, so page work never edits it.
    const unshipped = NAV_ROUTES.filter((row) => PAGE_BODIES[row.id] === undefined);
    for (const row of unshipped) {
      const Body = PAGES[row.id];
      render(() => <Body />);
      expect(document.querySelector(`[data-fdt-page="${row.id}"]`)).not.toBeNull();
      expect(screen.getByRole('heading', { level: 1, name: row.label })).toBeTruthy();
      cleanup();
    }
  });
});

describe('lazily loaded routes', () => {
  it('maps the Beacon Tester route to a lazily loaded body', () => {
    expect(typeof PAGE_BODIES['beacon-tester']).toBe('function');
  });
});
