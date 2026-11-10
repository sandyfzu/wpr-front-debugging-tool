/**
 * A listed style's identity line, shared by the two pages that list the
 * page's styles (both lazily loaded, so the panel's start never pays for it).
 */
import type { PageStyleEntry } from '../messaging/page-styles';

/**
 * One style's identity as a selector: `#id`, then its `.class` tokens.
 *
 * @param style The style's id and class attribute.
 * @returns E.g. `#a.x.y`, or `''` when it has neither.
 */
export function styleIdentity(style: Pick<PageStyleEntry, 'id' | 'className'>): string {
  const id = style.id === '' ? '' : `#${style.id}`;
  const classes = style.className
    .split(/\s+/)
    .filter((token) => token !== '')
    .map((token) => `.${token}`)
    .join('');
  return `${id}${classes}`;
}
