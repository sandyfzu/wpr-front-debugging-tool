/**
 * Which scripts Delay JS's runtime loads, and the URL a script is served
 * with. WP Rocket writes exactly `rocketlazyloadscript` or
 * `text/rocketlazyloadscript` as a delayed tag's `type` and moves an
 * external script's `src` verbatim to `data-rocket-src`; its runtime then
 * loads `script[type$=rocketlazyloadscript]` (suffix match — and `type`
 * values match case-insensitively in HTML selectors), copying
 * `data-rocket-src` back to `src`. One rule for every reader of a live or
 * copied-out tag: on a delayed tag a non-empty `data-rocket-src` wins,
 * otherwise `src`.
 */

import { DELAY_JS_TYPE_OLD } from './constants';

/** The three attribute values the served-URL rule reads, as written (null when absent). */
export interface ScriptSrcAttributes {
  /** `type`. */
  readonly type: string | null;
  /** `data-rocket-src`. */
  readonly delayedSrc: string | null;
  /** `src`. */
  readonly src: string | null;
}

/**
 * Whether Delay JS's runtime loads a tag with this `type` — the same test as
 * its `script[type$=rocketlazyloadscript]` selector.
 *
 * @param type The `type` attribute, or null/undefined when absent.
 * @returns `true` when the value ends with the delay marker, in any case.
 */
export function isDelayedScriptType(type: string | null | undefined): boolean {
  return type?.toLowerCase().endsWith(DELAY_JS_TYPE_OLD) ?? false;
}

/**
 * The delayed URL, when the tag is delayed and carries one. A
 * `data-rocket-src` on any other tag is never loaded from there, so it is not
 * the served URL. Positional (not an attribute record) so the always-loaded
 * element readers stay small.
 *
 * @param type The `type` attribute, or null.
 * @param delayedSrc The `data-rocket-src` attribute, or null.
 * @returns A non-empty `data-rocket-src` on a delayed tag, else `null` — an
 *   undelayed tag, or a valueless/empty value, names nothing, so the caller
 *   falls back to `src`.
 */
export function delayedSrcOf(type: string | null, delayedSrc: string | null): string | null {
  return isDelayedScriptType(type) && delayedSrc !== '' ? delayedSrc : null;
}

/**
 * The served URL on plain attribute values — for readers that copied them out
 * of the DOM first.
 *
 * @param attributes The tag's attribute values.
 * @returns A delayed tag's non-empty `data-rocket-src`, else `src` as written
 *   (`''` when valueless), else `null` when the script names no URL at all.
 */
export function servedSrcOf(attributes: ScriptSrcAttributes): string | null {
  return delayedSrcOf(attributes.type, attributes.delayedSrc) ?? attributes.src;
}
