/**
 * The overlay's read-only view of the host page: its address facts, its
 * pickable elements (rescanned on DOM churn and SPA navigations, debounced),
 * what lies under a point, and element geometry for the highlight. Never
 * writes to the page; every observer and listener is released by `dispose`
 * (and the listeners also ride the content-script context).
 */
import { createSignal, type Accessor } from 'solid-js';
import type { PageFacts } from './session/page-match';
import { resolvePointerPick, type PickCandidate } from './exclusions/pick-target';
import {
  createElementKeys,
  elementSnapshot,
  scanPage,
  type PageCandidate
} from './exclusions/page-scan';
import { debounce } from '../../utils/debounce';

/** Quiet time after DOM churn before the page is rescanned. */
export const RESCAN_DEBOUNCE_MS = 500;

/** Ancestors a pointer pick climbs at most (deep builder trees stay bounded). */
const POINTER_CHAIN_DEPTH = 24;

/** The attributes whose changes can change what is pickable. */
const WATCHED_ATTRIBUTES = [
  'type',
  'src',
  'id',
  'class',
  'data-rocket-src',
  'data-rocket-type',
  'data-rocket-status',
  'data-rocket-defer',
  'data-lazy-src',
  'data-wpr-lazyrender'
];

/** A pointer pick: the candidate and the element it is for. */
export interface PointedPick {
  readonly candidate: PickCandidate;
  readonly element: Element;
}

/** A viewport rectangle (px). */
export interface ViewportRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What the views read from the page. */
export interface PageTools {
  /** The page's pickable elements (current scan). */
  readonly candidates: Accessor<readonly PageCandidate[]>;
  /** This page's address facts (reactive to SPA address changes). */
  readonly pageFacts: Accessor<PageFacts>;
  /** What a pointer pick at a viewport point targets, if anything. */
  pointPick(x: number, y: number): PointedPick | null;
  /** Rescan now (e.g. when the candidate list opens). */
  rescan(): void;
  /** Disconnect the observer and cancel pending work. */
  dispose(): void;
}

/** The page seams the tools need. */
export interface PageToolsDeps {
  readonly doc: Document;
  readonly win: Window;
  /** The overlay's own shadow host (never picked). */
  readonly host: Element;
  /** Listen on a page target, released with the context. */
  readonly listen: (target: EventTarget, type: string, handler: () => void) => void;
  /**
   * Whether the extension context is gone (reading it also tears the
   * overlay down when it is): checked on page activity, so a reloaded
   * extension's overlay stops instead of observing a page it can no
   * longer serve.
   */
  readonly isInvalid: () => boolean;
}

/**
 * An element's viewport rectangle, or null when it is gone or renders
 * nothing (a script, a collapsed element).
 *
 * @param element The element.
 */
export function viewportRect(element: Element): ViewportRect | null {
  if (!element.isConnected) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

/**
 * Build the page tools for one overlay mount.
 *
 * @param deps The page seams.
 */
export function createPageTools(deps: PageToolsDeps): PageTools {
  const { doc, win, host } = deps;
  const keyOf = createElementKeys();
  const readFacts = (): PageFacts => {
    const navigation = win.performance.getEntriesByType('navigation')[0];
    return {
      href: win.location.href,
      documentUrl: navigation?.name ?? null,
      timeOrigin: win.performance.timeOrigin
    };
  };
  const [pageFacts, setPageFacts] = createSignal<PageFacts>(readFacts());
  const scan = (): readonly PageCandidate[] => scanPage(doc, win.location.href, keyOf);
  const [candidates, setCandidates] = createSignal<readonly PageCandidate[]>(scan());
  const rescan = (): void => {
    setCandidates(scan());
  };
  const rescanSoon = debounce(rescan, RESCAN_DEBOUNCE_MS);

  const observer = new MutationObserver(() => {
    if (deps.isInvalid()) {
      observer.disconnect();
      return;
    }
    rescanSoon();
  });
  observer.observe(doc.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: WATCHED_ATTRIBUTES
  });
  // History-API navigations (SPAs) change the address without a reload:
  // the facts and the candidates follow.
  // Returning to the tab (e.g. after reloading the extension elsewhere)
  // re-checks the context.
  deps.listen(doc, 'visibilitychange', () => {
    deps.isInvalid();
  });
  deps.listen(win, 'wxt:locationchange', () => {
    setPageFacts(readFacts());
    rescanSoon();
  });

  return {
    candidates,
    pageFacts,
    pointPick: (x, y) => {
      const pointed = doc.elementsFromPoint(x, y).find((element) => element !== host);
      if (pointed === undefined) return null;
      const chain: Element[] = [];
      for (
        let element: Element | null = pointed;
        element !== null && element !== doc.body && chain.length < POINTER_CHAIN_DEPTH;
        element = element.parentElement
      ) {
        chain.push(element);
      }
      const resolved = resolvePointerPick(chain.map(elementSnapshot), win.location.href);
      const element = resolved === null ? undefined : chain[resolved.depth];
      return resolved === null || element === undefined
        ? null
        : { candidate: resolved.candidate, element };
    },
    rescan,
    dispose: () => {
      observer.disconnect();
      rescanSoon.cancel();
    }
  };
}
