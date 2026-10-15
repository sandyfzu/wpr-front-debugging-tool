/**
 * The Elements sidebar's object view of the user's current selection.
 *
 * The value comes from `browser.devtools.inspectedWindow.eval`, which runs
 * the expression string inside the inspected page's MAIN world (where `$0`
 * is the user's selection) and hands one JSON-able object back. That
 * boundary forces the page-side logic to exist twice: the builders here are
 * the authored source, and the string they produce is the runtime copy
 * devtools executes. The string embeds only our own constants — `JSON.stringify`
 * of the exclusion list and of every attribute-name literal — page data
 * never flows into it, so nothing untrusted can change what the eval runs.
 * What the eval returns is still inspected-page data: it is only ever passed
 * to `setObject`, never interpreted by our code beyond the shape check below.
 */

import type { Browser } from 'wxt/browser';
import { isRecord } from '../../utils/is-record';
import {
  DATA_LAZY_SRC,
  DATA_LAZY_SRCSET,
  DELAY_JS_SRC,
  DELAY_JS_TYPE_OLD,
  FDT_EXCLUDED_RESOURCE,
  LAZYLOAD_EXCLUSIONS_LIST,
  LAZY_RENDER_ATTRIBUTE,
  WPR_DEFER_ATTRIBUTE
} from '../../lib/wp-rocket/constants';

/**
 * Lazyload's load-state marker written back onto the `<img>` itself by the
 * lazyload runtime (`loaded`, `loading`, …) — single-use here, so it stays
 * local to the pane instead of entering the detection-engine vocabulary.
 */
const LAZYLOAD_STATUS_ATTRIBUTE = 'data-ll-status';

/**
 * Build the eval expression the pane keeps re-running against `$0`.
 *
 * IMG selections (parity shape, in display order): `{ lazyloadDetected }`,
 * then either `imageLoaded` (stamped) or `excludedReasonsFound` (matched
 * against the exclusion list by substring on the serialized HTML), then
 * `src`. Unsupported selections answer `{ please: 'Select an img element' }`.
 * Any other element reports its WP Rocket attribute inventory (see
 * {@link buildAttributeInventoryExpression}) instead of a dead end.
 *
 * @param exclusions The exclusion substrings embedded as the JSON runtime
 *   copy — always the real {@link LAZYLOAD_EXCLUSIONS_LIST} in production;
 *   a parameter so tests can pin the embedding with small fixtures.
 * @returns The self-contained IIFE string; it reads `$0` and nothing else.
 */
export function buildLazyloadSidebarExpression(exclusions: readonly string[]): string {
  // Every interpolated constant is embedded through `JSON.stringify` — the
  // same quoting discipline as the array above: a standalone, correctly
  // escaped double-quoted literal for any future rename (all names are
  // quote-free today and pinned by the constants tests).
  return `
(() => {
  const EXCLUSIONS = ${JSON.stringify(exclusions)};
  const el = $0;
  const isElement = el?.nodeType === 1;
  if (isElement && el.tagName === 'IMG') {
    const objectToShow = {};
    objectToShow.lazyloadDetected =
      el.hasAttribute(${JSON.stringify(DATA_LAZY_SRC)}) ||
      el.hasAttribute(${JSON.stringify(DATA_LAZY_SRCSET)});
    if (objectToShow.lazyloadDetected) {
      objectToShow.imageLoaded =
        el.getAttribute(${JSON.stringify(LAZYLOAD_STATUS_ATTRIBUTE)}) === 'loaded';
    } else {
      objectToShow.excludedReasonsFound = EXCLUSIONS.filter((exclusion) =>
        el.outerHTML.includes(exclusion)
      );
    }
    objectToShow.src = el.getAttribute('src');
    return objectToShow;
  }
  if (isElement) {
    const rocketAttributes = [];
    if (el.hasAttribute(${JSON.stringify(DELAY_JS_SRC)})) rocketAttributes.push(${JSON.stringify(DELAY_JS_SRC)});
    if (el.hasAttribute(${JSON.stringify(WPR_DEFER_ATTRIBUTE)}))
      rocketAttributes.push(${JSON.stringify(WPR_DEFER_ATTRIBUTE)});
    const typeValue = el.getAttribute('type');
    if (typeValue !== null && typeValue.includes(${JSON.stringify(DELAY_JS_TYPE_OLD)})) {
      rocketAttributes.push('type=' + typeValue);
    }
    if (el.hasAttribute(${JSON.stringify(LAZY_RENDER_ATTRIBUTE)}))
      rocketAttributes.push(${JSON.stringify(LAZY_RENDER_ATTRIBUTE)});
    if (el.hasAttribute(${JSON.stringify(FDT_EXCLUDED_RESOURCE)}))
      rocketAttributes.push(${JSON.stringify(FDT_EXCLUDED_RESOURCE)});
    if (el.hasAttribute(${JSON.stringify(DATA_LAZY_SRC)})) rocketAttributes.push(${JSON.stringify(DATA_LAZY_SRC)});
    if (el.hasAttribute(${JSON.stringify(DATA_LAZY_SRCSET)}))
      rocketAttributes.push(${JSON.stringify(DATA_LAZY_SRCSET)});
    if (rocketAttributes.length > 0) return { rocketAttributes };
  }
  return { please: 'Select an img element' };
})()`;
}

/**
 * The shipped expression, built once from the real exclusion list — the
 * embedded array is the one unavoidable runtime copy (devtools serializes
 * the string, it cannot close over our module scope).
 */
export const LAZYLOAD_SIDEBAR_EXPRESSION = buildLazyloadSidebarExpression(LAZYLOAD_EXCLUSIONS_LIST);

/** The eval callback's failure argument shape (`undefined` on success). */
type EvalExceptionInfo = Browser.devtools.inspectedWindow.EvaluationExceptionInfo;

/**
 * What one eval outcome contributes to the pane: the object to display
 * always, plus the failure description when the eval itself failed (log
 * context for the wiring; the same text is shown inside the pane's
 * `{ evalError }` object).
 */
export interface SidebarEvalOutcome {
  /** The argument for `setObject` — the eval's object, or an error object. */
  object: Record<string, unknown>;
  /** Why the eval failed; `undefined` on a successful object result. */
  failure?: string;
}

/** Error-object text for an eval that produced no object at all. */
const NO_OBJECT_FAILURE = 'Eval did not return an object';

/**
 * Map the eval callback's arguments to the pane's next object, guaranteeing
 * the pane always receives a displayable object (a failed eval must not
 * blank it with `undefined`).
 *
 * Chrome's contract: on failure the result is `undefined` and the exception
 * argument is set — either a DevTools-side failure (`isError`, `code`,
 * `description`) or an in-page exception (`isException`, the thrown value as
 * a string). Both become one `{ evalError }` object; so does a result that
 * is not an object at all. A record-shaped result passes through unchanged,
 * keeping the display shape the expression itself defines.
 *
 * @param result The eval callback's result argument.
 * @param exceptionInfo The eval callback's exception argument (absent on
 *   success).
 * @returns The object to display plus the failure text, if any.
 */
export function sidebarEvalOutcome(
  result: unknown,
  exceptionInfo: EvalExceptionInfo | undefined
): SidebarEvalOutcome {
  if (exceptionInfo !== undefined) {
    // Exactly one of the two variants is set per the union; reading both
    // optional shapes covers either at runtime without narrowing gymnastics.
    const failure =
      exceptionInfo.isError === true
        ? `${exceptionInfo.code}${exceptionInfo.description ? `: ${exceptionInfo.description}` : ''}`
        : exceptionInfo.value;
    return { object: { evalError: failure }, failure };
  }
  if (!isRecord(result)) {
    return { object: { evalError: NO_OBJECT_FAILURE }, failure: NO_OBJECT_FAILURE };
  }
  return { object: result };
}
