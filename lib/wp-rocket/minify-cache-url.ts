/**
 * The served minified-asset URL footprint: `cache/min/<site-id>/` (the
 * minify cache directory), one word character, then — on the same line, at
 * least one character later — the extension (`css` / `js`). It reads live
 * page URLs of any length, so it runs in linear time: per line, only the
 * line's FIRST cache directory is tried. That loses no match: a later
 * directory on the same line ends later (none can start inside an earlier
 * one's `cache/min/<digits>/`), and an extension that follows a later
 * directory also follows the first.
 */

import { MINIFY_CACHE_HEAD_SOURCE } from './constants';

/** The extension a minified asset URL ends its footprint with. */
export type MinifiedAssetExtension = 'css' | 'js';

/** The URL head (global: searched from an offset). */
const CACHE_DIR_HEAD = new RegExp(MINIFY_CACHE_HEAD_SOURCE, 'g');

/** The line terminators a regex `.` never crosses (global: searched from an offset). */
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/g;

/**
 * The first line terminator at or after an offset.
 *
 * @param text The text.
 * @param from The offset.
 * @returns Its index, or `text.length` when the line runs to the end.
 */
function lineEndFrom(text: string, from: number): number {
  LINE_TERMINATOR.lastIndex = from;
  return LINE_TERMINATOR.exec(text)?.index ?? text.length;
}

/**
 * Whether a URL carries the minify-cache footprint for an extension —
 * exactly what `/cache\/min\/\d+\/[a-zA-Z0-9_].+?<ext>/.test(url)` answers
 * (no flags), in time linear in the URL's length.
 *
 * @param url The URL as the caller reads it (resolved or raw).
 * @param extension The asset extension.
 * @returns True when some line holds a cache directory followed, at least one
 *   character later on that line, by the extension.
 */
export function hasMinifiedCacheUrl(url: string, extension: MinifiedAssetExtension): boolean {
  // The next extension occurrence found so far: offsets only grow, so one
  // forward `indexOf` walk serves every line.
  let extensionAt = -1;
  let from = 0;
  while (from <= url.length) {
    CACHE_DIR_HEAD.lastIndex = from;
    const head = CACHE_DIR_HEAD.exec(url);
    if (head === null) return false;
    const headEnd = head.index + head[0].length;
    const lineEnd = lineEndFrom(url, headEnd);
    if (extensionAt < headEnd + 1) extensionAt = url.indexOf(extension, headEnd + 1);
    if (extensionAt === -1) return false;
    if (extensionAt + extension.length <= lineEnd) return true;
    from = lineEnd + 1;
  }
  return false;
}
