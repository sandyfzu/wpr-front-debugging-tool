/**
 * The honest placeholder body for a route whose page has not shipped yet:
 * its name as the page's only heading, plus one sentence about where the
 * page's work stands. Deep links to such routes never dead-end.
 */
import type { Component, JSX } from 'solid-js';
import { navRoute, type RouteId } from '../routes';

/**
 * Build the placeholder body for one route.
 *
 * @param id The route the body stands in for.
 * @returns A component rendering the route's label as its `h1`.
 * @throws {@link Error} When `id` has no nav registry row (the registry and
 *   the route ids drifted apart — a build-time bug, not a runtime state).
 */
export function placeholderPage(id: RouteId): Component {
  const row = navRoute(id);
  if (!row) throw new Error(`placeholderPage: no nav registry row for route "${id}"`);
  const label = row.label;
  return function PlaceholderPage(): JSX.Element {
    return (
      <section class="fdt-page p-3" data-fdt-page={id}>
        <h1 tabindex="-1" class="text-sm font-semibold text-fg-primary">
          {label}
        </h1>
        <p class="mt-1.5 max-w-96 text-2xs leading-snug text-fg-secondary">
          This page arrives in a later pass of the tool's panel work.
        </p>
      </section>
    );
  };
}
