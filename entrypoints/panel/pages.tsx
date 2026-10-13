/**
 * The panel's route bodies, keyed by the nav registry — one component per
 * route id. Every row today renders the placeholder: the real page work
 * lands per-feature in later phases, which swap their own component into
 * this table (one row edit, everything else unchanged).
 *
 * Heading discipline: each body renders exactly one `<h1>` (the page's name)
 * and skips no heading levels — the shell guarantees the page is the only
 * heading surface on the screen.
 */
import type { Component, JSX } from 'solid-js';
import { NAV_ROUTES, type NavRoute, type RouteId } from './routes';

/** One route body: renders the page's content (no props — real pages read the shell's store context). */
export type PageBody = Component;

/**
 * The placeholder body for one registry row: its name as the page's only
 * heading, plus one honest sentence about where the page's work stands.
 *
 * @param row The registry row the body stands in for.
 */
function placeholderPage(row: NavRoute): PageBody {
  return function PlaceholderPage(): JSX.Element {
    return (
      <section class="fdt-page p-3" data-fdt-page={row.id}>
        <h1 tabindex="-1" class="text-sm font-semibold text-fg-primary">
          {row.label}
        </h1>
        <p class="mt-1.5 max-w-96 text-2xs leading-snug text-fg-secondary">
          This page arrives in a later pass of the tool's panel work.
        </p>
      </section>
    );
  };
}

/** The route-body table, generated from the registry — the two cannot drift apart. */
export const PAGES: Record<RouteId, PageBody> = Object.fromEntries(
  NAV_ROUTES.map((row) => [row.id, placeholderPage(row)])
) as Record<RouteId, PageBody>;
