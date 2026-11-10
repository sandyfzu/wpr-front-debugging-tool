/**
 * Which `<link>` elements count as the page's stylesheets, and which carry
 * the Load CSS asynchronously stamp — one reading for every check that
 * inspects stylesheet links (the async CSS row and the minify CSS row).
 *
 * Links inside `<noscript>` never count: they are the no-JavaScript fallback
 * (WP Rocket prints the original, un-swapped links there), and a live
 * capture serializes a scripting-on document, where `<noscript>` content is
 * plain text — only a raw-HTML parse (scripting off) exposes them as
 * elements, so skipping them keeps both readings identical.
 */

import { ASYNC_CSS_ATTRIBUTE, ASYNC_CSS_ATTRIBUTE_VALUE } from '../wp-rocket/constants';

/**
 * Whether an element sits inside a `<noscript>` (the no-JavaScript fallback).
 *
 * @param element Any element.
 */
export function insideNoscript(element: Element): boolean {
  return element.closest('noscript') !== null;
}

/**
 * Whether a link carries WP Rocket's async stamp, exact value only (any
 * other value is not WP Rocket's).
 *
 * @param link Any element.
 */
export function carriesAsyncCssAttribute(link: Element): boolean {
  return link.getAttribute(ASYNC_CSS_ATTRIBUTE) === ASYNC_CSS_ATTRIBUTE_VALUE;
}

/**
 * Whether a link is one of the page's stylesheets: `rel="stylesheet"`
 * (exact), or an async-swapped stylesheet still waiting for its load
 * (stamped, `rel="preload"` + `as="style"`, exact — the markup WP Rocket
 * writes; its `onload` flips `rel` to `stylesheet`, so either is seen).
 * Never one inside `<noscript>`.
 *
 * @param link A `<link>` element.
 */
export function isStylesheetLink(link: Element): boolean {
  const rel = link.getAttribute('rel');
  const stylesheet =
    rel === 'stylesheet' ||
    (rel === 'preload' && link.getAttribute('as') === 'style' && carriesAsyncCssAttribute(link));
  // The ancestor walk last: it is the only non-constant-time test.
  return stylesheet && !insideNoscript(link);
}

/**
 * Whether any link carries the async stamp outside `<noscript>`. Read by the
 * attribute, never by `rel`: the stamp stays when `onload` flips the link
 * to a stylesheet.
 *
 * @param links The page's `<link>` elements.
 */
export function hasAsyncCssLink(links: readonly Element[]): boolean {
  return links.some((link) => carriesAsyncCssAttribute(link) && !insideNoscript(link));
}
