/**
 * What a Delay JS simulation cannot reproduce on a page, named so the UI
 * can say it. `combined-js`: the page serves WP Rocket's combined JS
 * bundles — with Delay JS on, WP Rocket turns Combine JS off, so the real
 * page would serve those scripts uncombined; the simulation cannot
 * un-combine them.
 */
import type { ScannedTag } from '../exclusion-builder/html-scan';
import { recoverOriginalScript } from '../wp-rocket/minify-url-recovery';

/** A limit of the simulation on one page. */
export type SimulationCaveat = 'combined-js';

/** The base relative script URLs resolve against: only their path is classified. */
const PLACEHOLDER_BASE = 'http://document.invalid/';

/**
 * Whether a script URL is a WP Rocket combined bundle (`cache/min/<n>/<md5>.js`).
 *
 * @param src The `src` value as served (relative or absolute).
 */
export function isCombinedScriptUrl(src: string): boolean {
  let url: string;
  try {
    url = new URL(src.trim(), PLACEHOLDER_BASE).href;
  } catch {
    // Not a URL at all: no bundle.
    return false;
  }
  return recoverOriginalScript(url).kind === 'combined';
}

/**
 * The caveats of simulating Delay JS on a page.
 *
 * @param tags The page's opening tags (`scanTags`).
 * @returns The caveats, each once, in a stable order.
 */
export function delayJsCaveats(tags: readonly ScannedTag[]): SimulationCaveat[] {
  const combined = tags.some(
    (tag) =>
      tag.name === 'script' &&
      tag.attrs.some(
        (attr) => attr.name === 'src' && attr.value !== null && isCombinedScriptUrl(attr.value)
      )
  );
  return combined ? ['combined-js'] : [];
}
