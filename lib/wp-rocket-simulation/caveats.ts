/**
 * What a Delay JS simulation cannot reproduce on a page, named so the UI
 * can say it. `combined-js`: the page serves WP Rocket's combined JS
 * bundles — with Delay JS on, WP Rocket turns Combine JS off, so the real
 * page would serve those scripts uncombined; the simulation cannot
 * un-combine them.
 */
import type { ScannedTag } from '../exclusion-builder/html-scan';
import { recoverOriginalScript } from '../wp-rocket/minify-url-recovery';
import { PLACEHOLDER_BASE_URL } from '../../utils/urls';
import type { SimulationCaveat } from './spec';

/** Re-exported from its declaring site for this module's callers. */
export type { SimulationCaveat };

/**
 * Whether a script URL is a WP Rocket combined bundle (`cache/min/<n>/<md5>.js`).
 *
 * @param src The `src` value as served (relative or absolute).
 */
export function isCombinedScriptUrl(src: string): boolean {
  let url: string;
  try {
    url = new URL(src.trim(), PLACEHOLDER_BASE_URL).href;
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
