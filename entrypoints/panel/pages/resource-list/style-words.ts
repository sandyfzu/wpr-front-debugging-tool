/**
 * The words a listed page style shows, shared by the two pages that list
 * the page's styles (Stylesheets and the RUCSS Tester's inventory, both
 * lazily loaded): its name, its media words and the fallbacks for a link
 * without an address and an inline style without CSS. Pure.
 */
import type { PageStyleEntry } from '../../../../lib/messaging/page-styles';
import { styleIdentity } from '../../../../lib/panel/style-identity';
import { resourceName } from './resource-list-view';

/** A link without an address (its name). */
export const NO_HREF_NAME = 'No stylesheet address';

/** An inline style's preview when it holds no CSS. */
export const EMPTY_STYLE_PREVIEW = 'Empty';

/** What a style's name is read from. */
export type NamedStyle = Pick<PageStyleEntry, 'kind' | 'id' | 'className' | 'href'>;

/** A style's name and whether it is an identifier (`#id.class`, shown in mono). */
export interface StyleName {
  readonly name: string;
  readonly mono: boolean;
}

/**
 * A style's name: a link's file name (or {@link NO_HREF_NAME}), an inline
 * style's `#id.class`, else its ordinal among inline styles.
 *
 * @param style The style's kind, id, class and address.
 * @param inlineOrdinal Its 1-based position among inline styles (names an anonymous one).
 * @returns The name and whether it is mono.
 */
export function styleName(style: NamedStyle, inlineOrdinal: number): StyleName {
  if (style.kind === 'link') return { name: resourceName(style.href) || NO_HREF_NAME, mono: false };
  const identity = styleIdentity(style);
  if (identity !== '') return { name: identity, mono: true };
  return { name: `Inline style #${String(inlineOrdinal)}`, mono: false };
}

/**
 * The media words a style shows: none for no media or `all` (the default
 * every page writes — noise on most rows), the attribute's own words otherwise.
 *
 * @param media The element's media attribute.
 * @returns E.g. `media: print`, or null.
 */
export function mediaDetail(media: string): string | null {
  const value = media.trim();
  return value === '' || value.toLowerCase() === 'all' ? null : `media: ${value}`;
}
