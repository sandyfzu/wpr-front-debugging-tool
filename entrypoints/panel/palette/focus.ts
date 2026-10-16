/**
 * The route-switch focus rule — the one shared owner of "where focus lands
 * when the route changes" (nav click, palette navigation, deep link). The
 * move targets the route body's own `h1`, which announces the destination by
 * being a heading. Loading names the actual wait; a fallback outside a route
 * body is skipped rather than treating a failure title as the destination.
 */
import { createLogger } from '../../../lib/logger';

const log = createLogger('panel');

/** The page body's own single heading, as every route body renders it. */
export const ROUTE_HEADING_SELECTOR = '[data-fdt-page] h1';

/**
 * Move keyboard focus to the current route body's heading.
 *
 * The heading is made program-focusable on the spot (`tabindex="-1"`) when
 * the body did not declare it — the page-level convention is that it already
 * does (`PageHeader`, the placeholder bodies), and this keeps the rule total
 * even if a future body forgets.
 *
 * @param region The scope to search (the whole document in production).
 */
export function focusRouteHeading(region: ParentNode = document): void {
  const heading = region.querySelector<HTMLElement>(ROUTE_HEADING_SELECTOR);
  if (heading === null) {
    // A fallback outside a route body has no destination heading to land on.
    log.debug('Route heading focus skipped — the current body has no h1.');
    return;
  }
  if (heading.getAttribute('tabindex') !== '-1') {
    heading.setAttribute('tabindex', '-1');
  }
  heading.focus();
}
