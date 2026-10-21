/**
 * The page's pickable elements: every live element some lane can exclude,
 * found with one selector query and classified by `./pick-target`. This
 * list is also the keyboard path to picking (and the only path to
 * scripts, which render nothing to point at). Reads the DOM, never writes
 * it; bounded, so a hostile page cannot make a scan unbounded.
 */
import {
  DATA_LAZY_SRC,
  DELAY_JS_SRC,
  DELAY_JS_TYPE_OLD,
  LAZY_RENDER_ATTRIBUTE,
  WPR_DEFER_ATTRIBUTE
} from '../../../lib/wp-rocket/constants';
import {
  DELAY_STATUS_ATTRIBUTE,
  DELAY_TYPE_ATTRIBUTE
} from '../../../lib/exclusion-builder/delay-js';
import { candidatesFor, type ElementSnapshot, type PickCandidate } from './pick-target';

/** Elements examined per scan at most. */
export const PAGE_SCAN_LIMIT = 5_000;

/** Characters of a script's text the classifier may read (it needs the first line only). */
const SCRIPT_TEXT_CHARS = 512;

/**
 * Every element some lane may act on — a superset the classifier narrows
 * (declared from the same vocabulary the classifier reads).
 */
export const PICKABLE_SELECTOR = [
  `script[type*="${DELAY_JS_TYPE_OLD}"]`,
  `script[${DELAY_STATUS_ATTRIBUTE}]`,
  `script[${DELAY_TYPE_ATTRIBUTE}]`,
  `script[${DELAY_JS_SRC}]`,
  `script[${WPR_DEFER_ATTRIBUTE}]`,
  `img[${DATA_LAZY_SRC}]`,
  `[${LAZY_RENDER_ATTRIBUTE}]`
].join(',');

/**
 * A live element seen through the classifier's snapshot interface.
 *
 * @param element The element.
 */
export function elementSnapshot(element: Element): ElementSnapshot {
  const tag = element.localName;
  return {
    tag,
    attribute: (name) => element.getAttribute(name),
    text:
      tag === 'script' && !element.hasAttribute('src')
        ? element.textContent.slice(0, SCRIPT_TEXT_CHARS)
        : null
  };
}

/** One pickable element of the page with one of its candidates. */
export interface PageCandidate extends PickCandidate {
  /** Stable for the element + lane while it lives (list key). */
  readonly key: string;
  /** The element (weakly meaningful: it may leave the page). */
  readonly element: Element;
}

/**
 * Scan a document (or subtree) for pickable elements.
 *
 * @param root Where to look.
 * @param pageUrl The page's URL (row naming).
 * @param keyOf Stable per-element key issuer (the caller keeps it across scans).
 * @returns One entry per element and lane, document order.
 */
export function scanPage(
  root: ParentNode,
  pageUrl: string,
  keyOf: (element: Element) => string
): PageCandidate[] {
  const found: PageCandidate[] = [];
  const elements = root.querySelectorAll(PICKABLE_SELECTOR);
  const count = Math.min(elements.length, PAGE_SCAN_LIMIT);
  for (let index = 0; index < count; index += 1) {
    const element = elements[index];
    if (element === undefined) continue;
    for (const candidate of candidatesFor(elementSnapshot(element), pageUrl)) {
      found.push({ ...candidate, key: `${keyOf(element)}:${candidate.lane}`, element });
    }
  }
  return found;
}

/**
 * A per-element key issuer backed by a WeakMap: the same element keeps its
 * key across scans, and a removed element is collectable.
 */
export function createElementKeys(): (element: Element) => string {
  const keys = new WeakMap<Element, string>();
  let next = 0;
  return (element) => {
    let key = keys.get(element);
    if (key === undefined) {
      next += 1;
      key = `el-${String(next)}`;
      keys.set(element, key);
    }
    return key;
  };
}
