/**
 * What the payload's size caps did to the Delay JS inventory, read back on
 * the panel side: whether the script list itself was cut at its count cap,
 * and per inline script whether its text arrived whole, clipped, or not at
 * all. The producer marks only the list (`truncated: true`); the per-script
 * answer is recomputed from the same caps the producer applied, in the same
 * document order, so it needs no per-row field.
 */
import { PAYLOAD_LIMITS } from '../../../../lib/messaging/payload-bounds';
import { listCapped } from '../../../../lib/panel/list-behavior';
import type { WprDetections } from '../../../../lib/wp-rocket/types';
import type { ContentCapture } from './script-view';

/**
 * Whether the script list was cut: the mark alone also covers clipped or
 * dropped per-script fields (text, URL, original type), so only a marked list sitting at its count cap may have lost entries
 * (the nav's rule for the same list). The mark cannot prove extra rows exist.
 *
 * @param delayJs The Delay JS detection row.
 */
export function scriptListCut(delayJs: WprDetections['delay_js']): boolean {
  return listCapped(delayJs.truncated, delayJs.scripts.length, PAYLOAD_LIMITS.delayScripts.count);
}

/**
 * Each script's text capture, by document position. Unmarked rows are
 * complete. The mark is row-wide (any cut field, a dropped original type
 * included), so in a marked row each inline script was given
 * `min(per-script cap, budget left)` chars: a script that got nothing
 * because the list-wide budget was spent was **not captured**; one whose
 * text fills its allowance was **clipped** (a text exactly that long reads
 * as clipped too — the producer leaves no way to tell, and "clipped" is the
 * safe claim). External URLs filling their cap (allowing for a split surrogate) are `clipped` too.
 *
 * @param delayJs The Delay JS detection row.
 * @returns One capture state per script, in document order.
 */
export function contentCaptures(delayJs: WprDetections['delay_js']): ContentCapture[] {
  const caps = PAYLOAD_LIMITS.delayScripts;
  let budget = caps.contentTotal;
  return delayJs.scripts.map((script): ContentCapture => {
    if (delayJs.truncated !== true) return 'complete';
    if (script.content === undefined)
      return (script.src?.length ?? 0) >= caps.src - 1 ? 'clipped' : 'complete';
    const allowance = Math.min(caps.content, budget);
    budget -= script.content.length;
    if (allowance <= 0) return 'not-captured';
    return script.content.length >= allowance - 1 ? 'clipped' : 'complete';
  });
}

/**
 * Whether the capture cut the page's inline script text: the list lost
 * entries at its count cap, or an inline script's text was clipped or left
 * out. Never the bare mark — it also covers cuts to non-inline fields (a
 * clipped URL, a dropped original type) that leave every inline text whole.
 *
 * @param delayJs The Delay JS detection row.
 */
export function inlineScriptsCut(delayJs: WprDetections['delay_js']): boolean {
  if (scriptListCut(delayJs)) return true;
  const captures = contentCaptures(delayJs);
  return delayJs.scripts.some(
    (script, index) => script.content !== undefined && captures[index] !== 'complete'
  );
}
