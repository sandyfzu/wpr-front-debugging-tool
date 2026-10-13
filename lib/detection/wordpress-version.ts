/**
 * The page's WordPress version, read from the generator meta the engine
 * already knows about: `<meta name="generator" content="WordPress 6.8.1">`,
 * emitted by WordPress core on many installs and the same vocabulary the
 * WP Rocket row reads. Its only consumer today is the on-page strip's
 * footer stamp; the value rides the hub's pass result, never the engine's
 * `WprDetections` contract (an additive surface, not an engine row).
 */

import {
  GENERATOR_META_SELECTOR,
  WORDPRESS_NAME_PATTERN,
  extractWordPressVersion
} from '../wp-rocket/constants';

/**
 * The WordPress core version a page's generator meta declares, or null.
 *
 * The first meta whose content names WordPress wins (there is only one in
 * practice; a hostile page with several still answers with the first).
 * Absence is the honest answer: many sites strip this meta.
 *
 * @param document The parsed page document.
 */
export function detectWordPressVersion(document: Document): string | null {
  const meta = [...document.querySelectorAll<HTMLMetaElement>(GENERATOR_META_SELECTOR)].find(
    (tag) => WORDPRESS_NAME_PATTERN.test(tag.content)
  );
  if (meta === undefined) return null;
  return extractWordPressVersion(meta.content);
}
