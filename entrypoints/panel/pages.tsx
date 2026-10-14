/**
 * The panel's route bodies, keyed by the nav registry — one component per
 * route id. Each shipped page lives in its own `pages/<route-id>/page.tsx`
 * folder and is mapped here once; routes without a page folder render the
 * shared honest placeholder, so a deep link never dead-ends.
 *
 * Heading discipline: each body renders exactly one `<h1>` (the page's name)
 * and skips no heading levels — the shell guarantees the page is the only
 * heading surface on the screen.
 */
import type { Component } from 'solid-js';
import { DetectionsPage } from './pages/detections/page';
import { JavaScriptPage } from './pages/javascript/page';
import { LazyloadPage } from './pages/lazyload/page';
import { placeholderPage } from './pages/placeholder';
import { PreloadedResourcesPage } from './pages/preloaded-resources/page';
import { UndefinedReferencesPage } from './pages/undefined-references/page';
import { NAV_ROUTES, type RouteId } from './routes';

/** One route body: renders the page's content (no props — real pages read the shell's store context). */
export type PageBody = Component;

/** The routes that own a page folder; every other route gets the placeholder. */
export const PAGE_BODIES: Partial<Record<RouteId, PageBody>> = {
  detections: DetectionsPage,
  javascript: JavaScriptPage,
  lazyload: LazyloadPage,
  'preloaded-resources': PreloadedResourcesPage,
  'undefined-references': UndefinedReferencesPage
};

/** The route-body table, generated from the registry — the two cannot drift apart. */
export const PAGES: Record<RouteId, PageBody> = Object.fromEntries(
  NAV_ROUTES.map((row) => [row.id, PAGE_BODIES[row.id] ?? placeholderPage(row.id)])
) as Record<RouteId, PageBody>;
