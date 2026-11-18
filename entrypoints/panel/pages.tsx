/**
 * The panel's route bodies, keyed by the nav registry — one component per
 * route id. Each shipped page lives in its own `pages/<route-id>/page.tsx`
 * folder and is mapped here once. The table is a full `Record` over the
 * route ids, so a route without a body fails the type check — a deep link
 * can never resolve to nothing.
 *
 * Pages that only some sessions open (tools) load on first visit, from their
 * own chunk (`./pages/lazy-page`); the panel's start pays nothing for them.
 *
 * Heading discipline: each body renders exactly one `<h1>` (the page's name)
 * and skips no heading levels — the shell guarantees the page is the only
 * heading surface on the screen.
 */
import type { Component } from 'solid-js';
import { DetectionsPage } from './pages/detections/page';
import { HeadersCookiesPage } from './pages/headers-cookies/page';
import { JavaScriptPage } from './pages/javascript/page';
import { LazyloadPage } from './pages/lazyload/page';
import { PreloadedResourcesPage } from './pages/preloaded-resources/page';
import { RucssTesterPage } from './pages/rucss-tester/page';
import { UndefinedReferencesPage } from './pages/undefined-references/page';
import { lazyPage } from './pages/lazy-page';
import type { RouteId } from './routes';

/** One route body: renders the page's content (no props — real pages read the shell's store context). */
export type PageBody = Component;

/** The route-body table: one body per route id, each from its page folder. */
export const PAGES: Record<RouteId, PageBody> = {
  detections: DetectionsPage,
  javascript: JavaScriptPage,
  stylesheets: lazyPage('stylesheets', async () => {
    const { StylesheetsPage } = await import('./pages/stylesheets/stylesheets');
    return StylesheetsPage;
  }),
  lazyload: LazyloadPage,
  'preloaded-resources': PreloadedResourcesPage,
  'headers-cookies': HeadersCookiesPage,
  'undefined-references': UndefinedReferencesPage,
  'rucss-tester': RucssTesterPage,
  'beacon-tester': lazyPage('beacon-tester', async () => {
    const { BeaconTesterPage } = await import('./pages/beacon-tester/beacon-tester');
    return BeaconTesterPage;
  }),
  'lcp-vitals': lazyPage('lcp-vitals', async () => {
    const { LcpVitalsPage } = await import('./pages/lcp-vitals/lcp-vitals');
    return LcpVitalsPage;
  })
};
