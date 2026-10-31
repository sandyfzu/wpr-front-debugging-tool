/**
 * Whether WP Rocket's LazyLoad skips a request by its URL alone: it never
 * lazy loads when `is_preview()` or `is_search()` holds or the request
 * names `fl_builder`, `et_fb` or `ct_builder` in `$_GET`. All are read off
 * the URL's query as PHP parses it into `$_GET` (`+` and `%XX` decoded,
 * leading spaces dropped, `.` and space turned `_` before a `[`, an array
 * key named by its base, the last pair winning). `is_preview()` is
 * WordPress query state: a non-empty `preview` query variable (a POSTed one
 * is not seen). `is_search()` too: the `s` query variable makes a request a
 * search unless it also names a single post or page (a rare combination,
 * read as search here), and a pretty search URL (`/search/term/`) is not
 * read. Pure and dependency-free: the simulation step and the overlay's
 * mode control read the same verdict.
 */

/** Why WP Rocket never lazy loads a request, by its URL. */
export type LazyloadUrlSkip = 'preview' | 'search' | 'page-builder-editor';

/** The `$_GET` keys that mark a page-builder editor request (WP Rocket never lazy loads there). */
export const PAGE_BUILDER_EDITOR_PARAMETERS: readonly string[] = [
  'fl_builder',
  'et_fb',
  'ct_builder'
];

/** WordPress's search query variable. */
const SEARCH_QUERY_VARIABLE = 's';

/** WordPress's preview query variable. */
const PREVIEW_QUERY_VARIABLE = 'preview';

/**
 * PHP's `urldecode` on ASCII-relevant terms: `+` → space, each `%XX` → its
 * byte (as one code unit); a malformed `%` stays.
 *
 * @param text A raw query part.
 */
function phpUrlDecode(text: string): string {
  return text
    .replaceAll('+', ' ')
    .replace(/%([0-9a-fA-F]{2})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    );
}

/**
 * The `$_GET` key PHP registers for a decoded query name: cut at a NUL,
 * leading spaces dropped; before the first `[`, `.` and space become `_`;
 * a `[` with a later `]` makes an array under the base name, an unclosed
 * one becomes `_` (the rest kept as is).
 *
 * @param name The decoded name.
 * @returns The key ('' when PHP registers none).
 */
export function phpGetKey(name: string): string {
  return phpGetName(name).key;
}

/**
 * {@link phpGetKey}, and whether PHP registers an array under it.
 *
 * @param name The decoded name.
 */
function phpGetName(name: string): { readonly key: string; readonly array: boolean } {
  const nul = name.indexOf('\0');
  const cut = (nul < 0 ? name : name.slice(0, nul)).replace(/^ +/, '');
  const bracket = cut.indexOf('[');
  const base = (bracket < 0 ? cut : cut.slice(0, bracket)).replace(/[ .]/g, '_');
  if (bracket < 0 || base === '') return { key: base, array: false };
  return cut.includes(']', bracket + 1)
    ? { key: base, array: true }
    : { key: `${base}_${cut.slice(bracket + 1)}`, array: false };
}

/**
 * The `$_GET` entries of a URL's query, as PHP registers them: each key
 * with its last value (`null` for an array), a later pair overwriting an
 * earlier one.
 *
 * @param search The URL's `search` (`?…`, or '').
 */
export function phpGetEntries(search: string): ReadonlyMap<string, string | null> {
  const entries = new Map<string, string | null>();
  for (const pair of search.replace(/^\?/, '').split('&')) {
    const equals = pair.indexOf('=');
    const { key, array } = phpGetName(phpUrlDecode(equals < 0 ? pair : pair.slice(0, equals)));
    if (key === '') continue;
    entries.set(key, array ? null : phpUrlDecode(equals < 0 ? '' : pair.slice(equals + 1)));
  }
  return entries;
}

/**
 * The `$_GET` keys of a URL's query, as PHP registers them.
 *
 * @param search The URL's `search` (`?…`, or '').
 */
export function phpGetKeys(search: string): ReadonlySet<string> {
  return new Set(phpGetEntries(search).keys());
}

/**
 * Why WP Rocket would not lazy load a request by its URL, or null — in its
 * own order: a preview (WordPress's `preview` query variable set to a
 * non-empty value, or an array: `is_preview()`), a search (`is_search()`),
 * a page-builder editor.
 *
 * @param pageUrl The document's URL.
 * @throws {@link TypeError} when `pageUrl` is not a URL (the input guard refuses one).
 */
export function lazyloadUrlSkip(pageUrl: string): LazyloadUrlSkip | null {
  const entries = phpGetEntries(new URL(pageUrl).search);
  const preview = entries.get(PREVIEW_QUERY_VARIABLE);
  if (preview !== undefined && preview !== '') return 'preview';
  if (entries.has(SEARCH_QUERY_VARIABLE)) return 'search';
  return PAGE_BUILDER_EDITOR_PARAMETERS.some((key) => entries.has(key))
    ? 'page-builder-editor'
    : null;
}
