/**
 * The panel's route bodies, keyed by the nav registry — one component per
 * route id. Each shipped page lives in its own `pages/<route-id>/page.tsx`
 * folder and is mapped here once. The table is a full `Record` over the
 * route ids, so a route without a body fails the type check — a deep link
 * can never resolve to nothing.
 *
 * Only the default route (Detections, the page every session opens on) is in
 * the panel's start; every other page loads from its own chunk
 * (`./pages/lazy-page`), fetched at the first idle moment after boot or on
 * its first visit — so the start pays nothing for them (the list kit those
 * pages share included) and a visit rarely waits. Each import goes through
 * the page's one-line `<route>.ts` entry, so its chunk is named after the
 * route (`chunks/<route>-*.js`, its own budget row).
 *
 * Heading discipline: each body renders exactly one `<h1>` (the page's name)
 * and skips no heading levels — the shell guarantees the page is the only
 * heading surface on the screen.
 */
import type { Component } from 'solid-js';
import { DetectionsPage } from './pages/detections/page';
import { lazyPage } from './pages/lazy-page';
import type { RouteId } from './routes';

/** One route body: renders the page's content (no props — real pages read the shell's store context). */
export type PageBody = Component;

/** The routes whose body loads from its own chunk: every route but the default. */
export type LazyRouteId = Exclude<RouteId, 'detections'>;

/**
 * Each lazy route's import: the page module's body, picked from its entry.
 * Literal `import()` calls, so the bundler splits one chunk per route.
 */
export const LAZY_PAGE_LOADERS: Readonly<Record<LazyRouteId, () => Promise<PageBody>>> = {
  javascript: async () => (await import('./pages/javascript/javascript')).JavaScriptPage,
  stylesheets: async () => (await import('./pages/stylesheets/stylesheets')).StylesheetsPage,
  lazyload: async () => (await import('./pages/lazyload/lazyload')).LazyloadPage,
  'preloaded-resources': async () =>
    (await import('./pages/preloaded-resources/preloaded-resources')).PreloadedResourcesPage,
  'headers-cookies': async () =>
    (await import('./pages/headers-cookies/headers-cookies')).HeadersCookiesPage,
  'undefined-references': async () =>
    (await import('./pages/undefined-references/undefined-references')).UndefinedReferencesPage,
  'rucss-tester': async () => (await import('./pages/rucss-tester/rucss-tester')).RucssTesterPage,
  'beacon-tester': async () =>
    (await import('./pages/beacon-tester/beacon-tester')).BeaconTesterPage,
  'lcp-vitals': async () => (await import('./pages/lcp-vitals/lcp-vitals')).LcpVitalsPage
};

/**
 * Wrap every lazy route's loader as its route body.
 *
 * @param loaders Each lazy route's import.
 * @returns The lazy route bodies.
 */
function lazyBodies(
  loaders: Readonly<Record<LazyRouteId, () => Promise<PageBody>>>
): Record<LazyRouteId, PageBody> {
  const entries = (Object.keys(loaders) as LazyRouteId[]).map(
    (id) => [id, lazyPage(id, loaders[id])] as const
  );
  return Object.fromEntries(entries) as Record<LazyRouteId, PageBody>;
}

/** The route-body table: one body per route id, each from its page folder. */
export const PAGES: Record<RouteId, PageBody> = {
  detections: DetectionsPage,
  ...lazyBodies(LAZY_PAGE_LOADERS)
};
