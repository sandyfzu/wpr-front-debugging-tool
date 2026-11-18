/**
 * Wiring tests for the route-body table: the eagerly loaded page folders are
 * mapped to their routes, the tool pages load lazily
 * (`pages/lazy-page.test.tsx`; one body per route is pinned in
 * `routes.test.ts`). Page bodies are tested in their own folders, never here.
 */
import { describe, expect, it } from 'vitest';
import { PAGES } from './pages';
import { DetectionsPage } from './pages/detections/page';
import { HeadersCookiesPage } from './pages/headers-cookies/page';
import { JavaScriptPage } from './pages/javascript/page';
import { LazyloadPage } from './pages/lazyload/page';
import { PreloadedResourcesPage } from './pages/preloaded-resources/page';
import { UndefinedReferencesPage } from './pages/undefined-references/page';
import { RucssTesterPage } from './pages/rucss-tester/page';

describe('PAGES wiring', () => {
  it('maps the eager page folders to their routes', () => {
    expect(PAGES.detections).toBe(DetectionsPage);
    expect(PAGES.javascript).toBe(JavaScriptPage);
    expect(PAGES.lazyload).toBe(LazyloadPage);
    expect(PAGES['preloaded-resources']).toBe(PreloadedResourcesPage);
    expect(PAGES['undefined-references']).toBe(UndefinedReferencesPage);
    expect(PAGES['headers-cookies']).toBe(HeadersCookiesPage);
    expect(PAGES['rucss-tester']).toBe(RucssTesterPage);
  });
});

describe('lazily loaded routes', () => {
  it('maps the Beacon Tester route to a lazily loaded body', () => {
    expect(typeof PAGES['beacon-tester']).toBe('function');
  });

  it('maps the Stylesheets route to a lazily loaded body', () => {
    expect(typeof PAGES.stylesheets).toBe('function');
  });

  it('maps the LCP & Vitals route to a lazily loaded body', () => {
    expect(typeof PAGES['lcp-vitals']).toBe('function');
  });
});
