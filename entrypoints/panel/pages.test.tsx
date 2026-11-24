/**
 * Wiring tests for the route-body table: the default route is mapped eagerly,
 * every other route loads lazily from its page folder's entry (the lazy body
 * itself: `pages/lazy-page.test.tsx`; one body per route is pinned in
 * `routes.test.ts`). Page bodies are tested in their own folders, never here.
 */
import { describe, expect, it } from 'vitest';
import { LAZY_PAGE_LOADERS, PAGES, type LazyRouteId } from './pages';
import { BeaconTesterPage } from './pages/beacon-tester/page';
import { DetectionsPage } from './pages/detections/page';
import { HeadersCookiesPage } from './pages/headers-cookies/page';
import { JavaScriptPage } from './pages/javascript/page';
import { LazyloadPage } from './pages/lazyload/page';
import { LcpVitalsPage } from './pages/lcp-vitals/page';
import { PreloadedResourcesPage } from './pages/preloaded-resources/page';
import { RucssTesterPage } from './pages/rucss-tester/page';
import { StylesheetsPage } from './pages/stylesheets/page';
import { UndefinedReferencesPage } from './pages/undefined-references/page';
import { ROUTE_IDS, DEFAULT_ROUTE, type RouteId } from './routes';
import type { Component } from 'solid-js';

/** Each lazy route's expected page body (its folder's `page.tsx` export). */
const EXPECTED_BODIES: Record<LazyRouteId, Component> = {
  javascript: JavaScriptPage,
  stylesheets: StylesheetsPage,
  lazyload: LazyloadPage,
  'preloaded-resources': PreloadedResourcesPage,
  'headers-cookies': HeadersCookiesPage,
  'undefined-references': UndefinedReferencesPage,
  'rucss-tester': RucssTesterPage,
  'beacon-tester': BeaconTesterPage,
  'lcp-vitals': LcpVitalsPage
};

describe('PAGES wiring', () => {
  it('maps the default route to its page body eagerly', () => {
    expect(DEFAULT_ROUTE).toBe('detections');
    expect(PAGES.detections).toBe(DetectionsPage);
  });

  it('gives every other route a lazy body, never the page body itself', () => {
    const lazy = ROUTE_IDS.filter((id): id is LazyRouteId => id !== 'detections');
    expect(Object.keys(LAZY_PAGE_LOADERS).sort()).toEqual([...lazy].sort());
    for (const id of lazy) {
      expect(typeof PAGES[id], id).toBe('function');
      expect(PAGES[id], id).not.toBe(EXPECTED_BODIES[id]);
    }
  });

  it.each(Object.keys(EXPECTED_BODIES) as LazyRouteId[])(
    'loads the %s route from its own page folder',
    async (id) => {
      await expect(LAZY_PAGE_LOADERS[id]()).resolves.toBe(EXPECTED_BODIES[id]);
    }
  );

  it('maps every route id', () => {
    for (const id of ROUTE_IDS as readonly RouteId[]) expect(PAGES[id], id).toBeTypeOf('function');
  });
});
