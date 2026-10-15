/**
 * What the payload's size caps did to the Delay JS inventory, read back on
 * the panel side: whether the script list itself was cut at its count cap,
 * and per inline script whether its text arrived whole, clipped, or not at
 * all. The producer marks only the list (`truncated: true`); the per-script
 * answer is recomputed from the same caps the producer applied, in the same
 * document order, so it needs no per-row field.
 */
import { PAYLOAD_LIMITS } from '../../../../lib/messaging/payload-bounds';
import type { WprDetections } from '../../../../lib/wp-rocket/types';
import type { ContentCapture } from './script-view';

/**
 * Whether the script list was cut: the mark alone also covers clipped
 * strings, so only a marked list sitting at its count cap lost entries (the
 * nav's rule for the same list).
 *
 * @param delayJs The Delay JS detection row.
 */
export function scriptListCut(delayJs: WprDetections['delay_js']): boolean {
  return delayJs.truncated === true && delayJs.scripts.length >= PAYLOAD_LIMITS.delayScripts.count;
}

/**
 * Each script's text capture, by document position. Unmarked rows are
 * complete. In a marked row each inline script was given
 * `min(per-script cap, budget left)` chars: a script that got nothing
 * because the list-wide budget was spent was **not captured**; one whose
 * text fills its allowance was **clipped** (a text exactly that long reads
 * as clipped too — the producer leaves no way to tell, and "clipped" is the
 * safe claim). External scripts are always `complete`.
 *
 * @param delayJs The Delay JS detection row.
 * @returns One capture state per script, in document order.
 */
export function contentCaptures(delayJs: WprDetections['delay_js']): ContentCapture[] {
  const caps = PAYLOAD_LIMITS.delayScripts;
  let budget = caps.contentTotal;
  return delayJs.scripts.map((script): ContentCapture => {
    if (script.content === undefined || delayJs.truncated !== true) return 'complete';
    const allowance = Math.min(caps.content, budget);
    budget -= script.content.length;
    if (allowance <= 0) return 'not-captured';
    return script.content.length >= allowance ? 'clipped' : 'complete';
  });
}
