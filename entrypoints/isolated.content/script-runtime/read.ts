/**
 * Read the page's live `<script>` elements on demand: their raw attribute
 * values as they are now (Delay JS rewrites `type`, `src` and the status
 * attribute while it runs), in document order — never the snapshot
 * detection parsed, and never written to (no attribute, no property).
 * The panel classifies the answer.
 */
import {
  SCRIPT_RUNTIME_LIMITS,
  type LiveScriptFacts,
  type ScriptRuntimeReply
} from '../../../lib/messaging/script-runtime';
import {
  CLASSES_MAX,
  FIELD_MAX,
  FULL_TEXT_MAX,
  PREVIEW_MAX
} from '../../../lib/script-runtime/classify';
import { DATA_ROCKET_STATUS, DELAY_JS_SRC } from '../../../lib/wp-rocket/constants';
import { capText } from '../../../utils/cap-text';

/**
 * An attribute's value, capped at the classifier's field cap.
 *
 * @param element The script.
 * @param name The attribute.
 * @returns The capped value, or null when absent.
 */
function attribute(element: Element, name: string): string | null {
  const value = element.getAttribute(name);
  return value === null ? null : capText(value, FIELD_MAX);
}

/**
 * The leading part of `raw.trim()` a cap at `points` code points can need:
 * the whole trimmed text when it fits in `2 × points + 2` UTF-16 units (one
 * code point past the cap, so a cut is still seen), else a prefix of it of
 * exactly that length — so a large script is never copied or trimmed whole.
 * `\s` is exactly the set `trim` strips (white space and line terminators).
 *
 * @param raw The script's text.
 * @param points The code-point cap the result will be capped at.
 * @returns The trimmed text, or a prefix of it longer than the cap.
 */
export function trimmedPrefix(raw: string, points: number): string {
  const nonSpace = /\S/g;
  if (!nonSpace.test(raw)) return '';
  const start = nonSpace.lastIndex - 1;
  const end = start + 2 * points + 2;
  if (end >= raw.length) return raw.slice(start).trimEnd();
  // Content past the window: the window is a prefix of the trimmed text;
  // only white space past it: the window holds all of it.
  nonSpace.lastIndex = end;
  const window = raw.slice(start, end);
  return nonSpace.test(raw) ? window : window.trimEnd();
}

/**
 * One script's facts.
 *
 * @param element The script (HTML or SVG).
 * @param textCap The code points of text this script may carry.
 */
export function scriptFacts(element: Element, textCap: number): LiveScriptFacts {
  // `textContent` covers SVG scripts too (they have no `text` property); it
  // equals an HTML script's `text` (its child text, never markup).
  const trimmed = trimmedPrefix(element.textContent, textCap);
  const text = capText(trimmed, textCap);
  return {
    type: attribute(element, 'type'),
    delayedSrc: attribute(element, DELAY_JS_SRC),
    src: attribute(element, 'src'),
    status: attribute(element, DATA_ROCKET_STATUS),
    id: capText(element.id, FIELD_MAX),
    classes: [...element.classList].slice(0, CLASSES_MAX).map((name) => capText(name, FIELD_MAX)),
    text,
    // Cut below the full cap by the answer's budget (the classifier marks its own cap).
    textCut: textCap < FULL_TEXT_MAX && text !== trimmed
  };
}

/**
 * Read the live scripts.
 *
 * @param doc The page's document.
 * @returns The first {@link SCRIPT_RUNTIME_LIMITS}`.scripts` scripts and the page's total.
 */
export function readLiveScripts(doc: Document): ScriptRuntimeReply {
  const all = doc.querySelectorAll('script');
  const scripts: LiveScriptFacts[] = [];
  let budget: number = SCRIPT_RUNTIME_LIMITS.textBudgetUnits;
  for (const element of all) {
    if (scripts.length === SCRIPT_RUNTIME_LIMITS.scripts) break;
    // The full text while the budget lasts, the preview after it.
    const facts = scriptFacts(element, budget > 0 ? FULL_TEXT_MAX : PREVIEW_MAX);
    budget -= facts.text.length;
    scripts.push(facts);
  }
  return { scripts, total: all.length };
}
