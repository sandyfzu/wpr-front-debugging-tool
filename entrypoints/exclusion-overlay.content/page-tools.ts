/**
 * The overlay's read-only view of the host page: its address facts, its
 * pickable elements (rescanned on DOM churn and SPA navigations, debounced),
 * what lies under a point, and element geometry for the highlight. Never
 * writes to the page; every observer and listener is released by `dispose`
 * (and the listeners also ride the content-script context).
 */
import { batch, createSignal, type Accessor } from 'solid-js';
import type { PageFacts } from './session/page-match';
import { resolvePointerPick, type PickCandidate, type PickContext } from './exclusions/pick-target';
import {
  createElementKeys,
  elementSnapshot,
  pickContextOf,
  scanPageInSlices,
  type PageCandidate
} from './exclusions/page-scan';
import { debounce } from '../../utils/debounce';

/** Quiet time after DOM churn before the page is rescanned. */
export const RESCAN_DEBOUNCE_MS = 500;

/** Longest one scan slice runs before yielding the main thread. */
export const SCAN_SLICE_MS = 8;

/** Longest a rescan may wait under churn that never goes quiet (carousels, tickers). */
export const RESCAN_MAX_WAIT_MS = 2_000;

/** Embedded documents: pointer input over them never reaches this document. */
const FRAME_SELECTOR = 'iframe, frame, embed, object';

/** Frames guarded while picking at most. */
const MAX_FRAMES = 50;

/** Page layers under a point a pointer pick looks through (a caption or link over an image). */
const POINTER_LAYERS = 8;

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
  readonly pointPick: (x: number, y: number) => PointedPick | null;
  /** Whether the first scan has finished (absence is only true after it). */
  readonly scanned: Accessor<boolean>;
  /** Whether the last scan stopped at the scan limit (the list is partial). */
  readonly candidatesCapped: Accessor<boolean>;
  /**
   * Whether the page shows a modal dialog: everything outside it — the
   * overlay included — is inert until it closes.
   */
  readonly pageModal: Accessor<boolean>;
  /** Bumps each time the page opens something in its own top layer (a popover, a dialog). */
  readonly pageTopLayerOpened: Accessor<number>;
  /** The CSS zoom the page applies to the overlay's host (1 = none). */
  readonly zoom: Accessor<number>;
  /** The page's embedded frames (their content is another document: not pickable). */
  readonly frames: () => readonly Element[];
  /** Re-read whether a page modal dialog is shown (e.g. before reopening). */
  readonly refreshModal: () => void;
  /** Rescan now (e.g. when the candidate list opens). */
  readonly rescan: () => void;
  /** Disconnect the observer and cancel pending work. */
  readonly dispose: () => void;
}

/** The page seams the tools need. */
export interface PageToolsDeps {
  readonly doc: Document;
  readonly win: Window;
  /** The overlay's own shadow host (never picked). */
  readonly host: Element;
  /** Listen on a page target (capture phase), released with the context. */
  readonly listen: (target: EventTarget, type: string, handler: (event: Event) => void) => void;
  /**
   * Whether the extension context is gone (reading it also tears the
   * overlay down when it is): checked on page activity, so a reloaded
   * extension's overlay stops instead of observing a page it can no
   * longer serve.
   */
  readonly isInvalid: () => boolean;
  /** Continue work in a later task (scan slices). */
  readonly later: (run: () => void) => void;
  /** Wall-clock epoch ms (the session records' clock); defaults to `Date.now`. */
  readonly wallNow?: () => number;
  /** The navigation's wall start taken at `document_start`, or null (none recorded). */
  readonly navigationAnchor?: () => number | null;
}

/** The part of the page's window the facts are read from. */
export interface FactsSource {
  readonly location: { readonly href: string };
  readonly performance: Pick<Performance, 'now' | 'getEntriesByType'>;
}

/**
 * Read this page's facts, its navigation start anchored to the wall clock
 * at read time: `Date.now()` and `performance.now()` read together give
 * the wall time the navigation started, whatever offset the monotonic
 * timeline (and so `performance.timeOrigin`) has from the wall clock
 * after a system sleep or a clock adjustment.
 *
 * @param source The window (location + performance).
 * @param wallNow Wall-clock epoch ms.
 */
export function readPageFacts(
  source: FactsSource,
  wallNow: () => number,
  recorded: number | null = null
): PageFacts {
  const navigation = source.performance.getEntriesByType('navigation')[0];
  const timing = navigation as PerformanceNavigationTiming | undefined;
  // Read in one instant: the two clocks' difference is the anchor.
  const sinceStart = source.performance.now();
  const wall = wallNow();
  return {
    href: source.location.href,
    documentUrl: navigation?.name ?? null,
    // The document_start reading when there is one (no sleep moved it).
    navigationStart: recorded ?? wall - sinceStart,
    anchoredAtStart: recorded !== null,
    // 0 until the response ended (an overlay mounts after it): unknown then.
    responseEnd: timing !== undefined && timing.responseEnd > 0 ? timing.responseEnd : null
  };
}

/**
 * Whether a document shows a modal dialog (`:modal`; an engine without the
 * selector reads as none).
 *
 * @param doc The document.
 */
export function hasModal(doc: Document): boolean {
  try {
    return doc.querySelector(':modal') !== null;
  } catch {
    return false;
  }
}

/**
 * The effective CSS zoom on an element (`currentCSSZoom`; 1 where the
 * engine does not report it).
 *
 * @param element The element.
 */
export function cssZoom(element: Element): number {
  const zoom = (element as Element & { currentCSSZoom?: unknown }).currentCSSZoom;
  return typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
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
  const wallNow = deps.wallNow ?? (() => Date.now());
  /**
   * The navigation start: the `document_start` reading when the isolated
   * script recorded one, else anchored at the first read and kept for the
   * document (a later re-read after a system sleep would shift it by the
   * sleep — the monotonic timeline may not tick then; the page match then
   * never reads a record as too old to be this page's).
   */
  let anchor: number | null = null;
  const readFacts = (): PageFacts => {
    const facts = readPageFacts(win, wallNow, deps.navigationAnchor?.() ?? null);
    anchor ??= facts.navigationStart;
    return { ...facts, navigationStart: anchor };
  };
  const [pageFacts, setPageFacts] = createSignal<PageFacts>(readFacts());
  /** The last scan's pick context (pointer picks read it every frame). */
  let context: PickContext = pickContextOf(doc, win.location.href);
  const [candidates, setCandidates] = createSignal<readonly PageCandidate[]>([]);
  const [candidatesCapped, setCandidatesCapped] = createSignal(false);
  const [scanned, setScanned] = createSignal(false);
  let cancelScan: (() => void) | null = null;
  /** Scan in slices (a big page never blocks for one long task); a newer scan cancels an older one. */
  const rescan = (): void => {
    cancelScan?.();
    cancelScan = scanPageInSlices(
      doc,
      win.location.href,
      keyOf,
      { now: () => win.performance.now(), later: deps.later, sliceMs: SCAN_SLICE_MS },
      (scan) => {
        cancelScan = null;
        context = scan.context;
        batch(() => {
          setCandidates(scan.candidates);
          setCandidatesCapped(scan.capped);
          setScanned(true);
        });
      }
    );
  };
  const rescanSoon = debounce(rescan, RESCAN_DEBOUNCE_MS, { maxWaitMs: RESCAN_MAX_WAIT_MS });
  rescan();
  const [pageModal, setPageModal] = createSignal(hasModal(doc));
  const [pageTopLayerOpened, setPageTopLayerOpened] = createSignal(0);
  const [zoom, setZoom] = createSignal(cssZoom(host));

  /**
   * Resolve one pointed layer: its nearest pickable ancestor-or-self.
   *
   * @param pointed An element under the point.
   */
  const resolveLayer = (pointed: Element): PointedPick | null => {
    const chain: Element[] = [];
    for (
      let element: Element | null = pointed;
      element !== null && element !== doc.body && chain.length < POINTER_CHAIN_DEPTH;
      element = element.parentElement
    ) {
      chain.push(element);
    }
    const resolved = resolvePointerPick(chain.map(elementSnapshot), context);
    const element = resolved === null ? undefined : chain[resolved.depth];
    return resolved === null || element === undefined
      ? null
      : { candidate: resolved.candidate, element };
  };

  const observer = new MutationObserver(() => {
    if (deps.isInvalid()) {
      observer.disconnect();
      rootObserver.disconnect();
      return;
    }
    // A framework can unmount a modal dialog without closing it (no
    // `toggle`): any DOM change re-reads whether one is still shown.
    setPageModal(hasModal(doc));
    rescanSoon();
  });
  // The root's and body's own style/class changes can change the zoom (a
  // cheap read, kept off the subtree observer's attribute list).
  const rootObserver = new MutationObserver(() => {
    if (!deps.isInvalid()) setZoom(cssZoom(host));
  });
  observer.observe(doc.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: WATCHED_ATTRIBUTES
  });
  for (const root of [doc.documentElement, doc.body]) {
    rootObserver.observe(root, { attributes: true, attributeFilter: ['style', 'class'] });
  }
  // History-API navigations (SPAs) change the address without a reload:
  // the facts and the candidates follow.
  // Returning to the tab (e.g. after reloading the extension elsewhere)
  // re-checks the context.
  deps.listen(doc, 'visibilitychange', () => {
    deps.isInvalid();
  });
  // Dialogs and popovers announce opening and closing with `toggle` (it
  // does not bubble: listened in the capture phase).
  deps.listen(doc, 'toggle', (event) => {
    if (event.target === host) return;
    setPageModal(hasModal(doc));
    if ((event as Event & { newState?: unknown }).newState === 'open') {
      setPageTopLayerOpened((count) => count + 1);
    }
  });
  deps.listen(win, 'resize', () => {
    setZoom(cssZoom(host));
  });
  deps.listen(win, 'wxt:locationchange', () => {
    setPageFacts((facts) => ({ ...readFacts(), restored: facts.restored }));
    rescanSoon();
  });
  // Back from the back/forward cache: the session went on without this
  // document, so its record can no longer vouch against it.
  deps.listen(win, 'pageshow', (event) => {
    if ((event as PageTransitionEvent).persisted) setPageFacts({ ...readFacts(), restored: true });
  });

  return {
    candidates,
    candidatesCapped,
    scanned,
    pageModal,
    pageTopLayerOpened,
    zoom,
    pageFacts,
    pointPick: (x, y) => {
      // Every layer under the point, topmost first: an overlay caption or a
      // link wrapper above an image must not hide the image.
      const layers = doc
        .elementsFromPoint(x, y)
        .filter(
          (element) => element !== host && element !== doc.documentElement && element !== doc.body
        )
        .slice(0, POINTER_LAYERS);
      for (const layer of layers) {
        const pick = resolveLayer(layer);
        if (pick !== null) return pick;
      }
      return null;
    },
    frames: () => Array.from(doc.querySelectorAll(FRAME_SELECTOR)).slice(0, MAX_FRAMES),
    refreshModal: () => {
      setPageModal(hasModal(doc));
    },
    rescan,
    dispose: () => {
      observer.disconnect();
      rootObserver.disconnect();
      rescanSoon.cancel();
      cancelScan?.();
    }
  };
}
