/**
 * The URL a script was served with, whether or not WP Rocket's Delay JS
 * rewrote its tag.
 *
 * Delay JS moves an external script's `src` verbatim to `data-rocket-src`
 * (its runtime copies it back on the first user interaction), so on a
 * Delay-on page the plain `src` reads empty for every delayed script. Checks
 * that recognize WP Rocket's own scripts by URL (minified cache files, the
 * lazyload library, the beacon) read through these element helpers so a
 * delayed script still names the URL the page actually loads — the one
 * served-URL rule, applied to live elements.
 */

import { DELAY_JS_SRC } from '../wp-rocket/constants';
import { delayedSrcOf } from '../wp-rocket/delayed-script';

/**
 * The delayed URL of a live element.
 *
 * @param script The script element.
 * @returns A non-empty `data-rocket-src` on a delayed tag, else `null`.
 */
function delayedSrc(script: Element): string | null {
  return delayedSrcOf(script.getAttribute('type'), script.getAttribute(DELAY_JS_SRC));
}

/**
 * The served URL attribute's raw value — what each check's empty-URL gate
 * reads (an empty value would otherwise resolve to the document's own URL).
 *
 * @param script The script element.
 * @returns A delayed tag's non-empty `data-rocket-src`, else the `src` attribute as written
 *   (`''` when valueless), else `null` when the script names no URL at all.
 */
export function servedScriptSrcAttribute(script: Element): string | null {
  return delayedSrc(script) ?? script.getAttribute('src');
}

/**
 * The served URL, resolved against the document base exactly as the `src`
 * property resolves it.
 *
 * @param script The script element.
 * @returns The absolute served URL; the raw value when it does not parse
 *   (the `src` property's own rule); `''` when the script names no URL.
 */
export function servedScriptSrc(script: HTMLScriptElement): string {
  const delayed = delayedSrc(script);
  if (delayed === null) return script.src;
  return URL.parse(delayed, script.baseURI)?.href ?? delayed;
}
