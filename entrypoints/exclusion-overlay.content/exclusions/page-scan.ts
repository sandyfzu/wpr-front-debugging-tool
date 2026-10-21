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
import {
  candidatesFor,
  lazyRenderPeerText,
  type ElementSnapshot,
  type PickCandidate,
  type PickContext
} from './pick-target';

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
    attributeNames: () => element.getAttributeNames(),
    // Serialized on demand (lazily rendered elements only): the shallow
    // clone's markup minus its end tag.
    get openingTag() {
      return openingTagOf(element);
    },
    // Read only when the classifier asks (an inline delayed script without
    // an id), and only its head: a page's inline bundles can be megabytes.
    get text() {
      return tag === 'script' && !element.hasAttribute('src') ? scriptHead(element) : null;
    }
  };
}

/**
 * An element's opening tag as the DOM serializes it (attribute order kept,
 * values double-quoted, `&` and quotes encoded).
 *
 * @param element The element.
 */
export function openingTagOf(element: Element): string {
  const markup = (element.cloneNode(false) as Element).outerHTML;
  const end = `</${element.localName}>`;
  return markup.endsWith(end) ? markup.slice(0, -end.length) : markup;
}

/**
 * The first {@link SCRIPT_TEXT_CHARS} characters of a script's text, copied
 * from its text nodes without materializing the whole source.
 *
 * @param script The script element.
 */
export function scriptHead(script: Element): string {
  let head = '';
  for (
    let node = script.firstChild;
    node !== null && head.length < SCRIPT_TEXT_CHARS;
    node = node.nextSibling
  ) {
    if (node instanceof Text) head += node.substringData(0, SCRIPT_TEXT_CHARS - head.length);
  }
  return head;
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
  const context = pickContextOf(root, pageUrl);
  const elements = root.querySelectorAll(PICKABLE_SELECTOR);
  const count = Math.min(elements.length, PAGE_SCAN_LIMIT);
  for (let index = 0; index < count; index += 1) {
    const element = elements[index];
    if (element !== undefined) classifyInto(found, element, context, keyOf);
  }
  return found;
}

/** Append one element's candidates. */
function classifyInto(
  found: PageCandidate[],
  element: Element,
  context: PickContext,
  keyOf: (element: Element) => string
): void {
  for (const candidate of candidatesFor(elementSnapshot(element), context)) {
    found.push({ ...candidate, key: `${keyOf(element)}:${candidate.lane}`, element });
  }
}

/** A finished sliced scan. */
export interface SlicedScan {
  readonly candidates: readonly PageCandidate[];
  readonly context: PickContext;
  /** More pickable elements exist than the scan limit (the list is partial). */
  readonly capped: boolean;
}

/** The clock and task seams of a sliced scan. */
export interface SliceDeps {
  /** A monotonic ms clock. */
  readonly now: () => number;
  /** Continue in a later task. */
  readonly later: (run: () => void) => void;
  /** Longest one slice may run. */
  readonly sliceMs: number;
}

/**
 * Scan like {@link scanPage}, but in slices of at most `sliceMs` each, one
 * per task — a big page's scan never becomes one long task.
 *
 * @param root Where to look.
 * @param pageUrl The page's URL.
 * @param keyOf Stable per-element key issuer.
 * @param deps Clock and task seams.
 * @param done Receives the finished scan (never called once cancelled).
 * @returns The cancel.
 */
export function scanPageInSlices(
  root: ParentNode,
  pageUrl: string,
  keyOf: (element: Element) => string,
  deps: SliceDeps,
  done: (scan: SlicedScan) => void
): () => void {
  let cancelled = false;
  const context = pickContextOf(root, pageUrl);
  const elements = root.querySelectorAll(PICKABLE_SELECTOR);
  const total = Math.min(elements.length, PAGE_SCAN_LIMIT);
  const found: PageCandidate[] = [];
  let index = 0;
  const step = (): void => {
    if (cancelled) return;
    const start = deps.now();
    do {
      const element = elements[index];
      if (element !== undefined) classifyInto(found, element, context, keyOf);
      index += 1;
    } while (index < total && deps.now() - start < deps.sliceMs);
    if (index < total) deps.later(step);
    else done({ candidates: found, context, capped: elements.length > PAGE_SCAN_LIMIT });
  };
  if (total === 0) done({ candidates: found, context, capped: false });
  else step();
  return () => {
    cancelled = true;
  };
}

/**
 * The pick context of a document: its URL and the peer texts of its lazily
 * rendered elements (bounded like the scan).
 *
 * @param root Where to look.
 * @param pageUrl The page's URL.
 */
export function pickContextOf(root: ParentNode, pageUrl: string): PickContext {
  const stamped = root.querySelectorAll(`[${LAZY_RENDER_ATTRIBUTE}]`);
  const peers: string[] = [];
  const count = Math.min(stamped.length, PAGE_SCAN_LIMIT);
  for (let index = 0; index < count; index += 1) {
    const element = stamped[index];
    if (element !== undefined) peers.push(lazyRenderPeerText(elementSnapshot(element)));
  }
  return { pageUrl, lazyRenderPeers: peers };
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
