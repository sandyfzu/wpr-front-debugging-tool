/**
 * The page-data hub the devtools panel consumes: everything the panel asks
 * about the page flows through here.
 *
 * Capture: the isolated world serializes the document once at
 * `DOMContentLoaded` (plus a `readyState` guard so late injections still
 * capture) — snapshot semantics are the feature, because late DOM mutations
 * must stay invisible to the panel. Processing: exactly one pass, started
 * eagerly at the capture moment and cached for the page lifetime — the
 * toolbar badge and the timing log must work with no devtools panel ever
 * opened (owner decision, 2026-10-08), and panel requests read the cached
 * result.
 *
 * Memory contract: the multi-megabyte snapshot is released as soon as the
 * eager processing pass completes — callers read the results, never the
 * source HTML.
 *
 * Anything crossing a boundary is validated (`parseErrorWords` for the
 * window bridge; detection results are our own engine output); every push to
 * devtools is best-effort — no receiver (panel not open, extension reloaded,
 * transport refused) is an expected branch logged at debug level, not a
 * failure of the page work.
 */

import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { onMessage, sendMessage } from '../../lib/messaging/index';
import { windowMessenger } from '../../lib/messaging/window-bridge';
import { ERROR_WORD_LIMIT, parseErrorWords } from '../../lib/messaging/validate';
import type {
  DiagnoserDocData,
  FdtData,
  PageHeaders,
  PreloadedResources,
  WprDetections
} from '../../lib/wp-rocket/types';
import { parsePage } from '../../lib/detection/parse-page';
import { applyPresencePropagation, runChecks } from '../../lib/detection/run-detection';
import { describeDetections } from '../../lib/detection/describe';
import { detectPreloadedResources } from '../../lib/detection/detect-optimizations';
import { detectWordPressVersion } from '../../lib/detection/wordpress-version';
import { extractDiagnoserData } from '../../lib/diagnostics/extract';
import { createLogger } from '../../lib/logger';

const log = createLogger('');

/** The window event WP Rocket dispatches when all its scripts finished loading. */
const ALL_SCRIPTS_LOADED_EVENT = 'rocket-allScriptsLoaded';

/**
 * The page-data pass's capture wait point: the one moment the serialized page
 * becomes the pass's source, held as a promise so the same-context reader can
 * join it later. Pure over injected seams, so its two rules are pinned by
 * unit test:
 *
 * - an already-past parser-ready moment settles immediately (a boot-time
 *   reader answers from a captured page);
 * - an invalidation before the caller completed the capture releases the
 *   waiter — the resolution belongs to the caller's own capture sequence
 *   (`resolve()` after its serialization step), never to an independent
 *   listener racing it: a waiter released before the source exists reads
 *   "no data" and locks a presentation state behind a failed boot. (The
 *   audit round's no-hang pin stays: an invalidated-before-capture context
 *   resolves through the teardown trigger.)
 */

/** The wait point's context seams (the real `ctx` satisfies them). */
export interface CaptureWaitPointDeps {
  /** Whether the parser-ready moment already happened at setup time. */
  pastParserReady(): boolean;
  /** Register the teardown trigger (fires whenever the context dies). */
  registerInvalidated(callback: () => void): void;
}

/** The capture's wait point, handed to the same-context readers. */
export interface CaptureWaitPoint {
  /** Resolves once the pass's source exists (or the context died). */
  readonly settled: Promise<void>;
  /** The capture moment fired — release any waiter (idempotent). */
  resolve(): void;
}

/**
 * Build the capture wait point. Arm-first: the invalidation trigger is
 * registered immediately, so a context whose world ends between setup and the
 * capture still releases its waiter — the exact no-hang pin the audit round
 * demanded. The open waiter's only other release is the caller's `resolve()`,
 * which must be called after the capture step completed (ordering by
 * construction: no second listener can outrun it).
 *
 * @param deps The context seams.
 */
export function createCaptureWaitPoint(
  deps: Pick<CaptureWaitPointDeps, 'pastParserReady' | 'registerInvalidated'>
): CaptureWaitPoint {
  let settleCapture!: () => void;
  const settled = new Promise<void>((resolve) => {
    settleCapture = resolve;
  });
  // Registration order is the no-hang contract: the teardown trigger
  // resolves like the capture's own would.
  deps.registerInvalidated(() => {
    settleCapture();
  });
  if (deps.pastParserReady()) {
    settleCapture();
  }
  return {
    settled,
    resolve: () => {
      settleCapture();
    }
  };
}

/**
 * One full page-processing result, immutable after the single pass. Read by
 * same-context consumers through {@link pageDataFor}; the messaging
 * contracts are untouched by this shape.
 */
export interface PageData {
  detections: WprDetections;
  preloadedResources: PreloadedResources;
  diagnoserData: DiagnoserDocData | null;
  /** The WordPress core version the generator meta declared, or null. */
  wordpressVersion: string | null;
}

/** The same-context read the hub hands out (null when the pass failed). */
export type PageDataRead = () => Promise<PageData | null>;

/** Same-context readers, keyed by the context they belong to. */
const pageDataReaders = new WeakMap<ContentScriptContext, PageDataRead>();

/**
 * The hub's cached single-pass result for a same-context consumer (the
 * widget reads what the panel reads). Setup order does not matter here: the
 * consumer receives null when its context's hub has not wired a reader.
 *
 * @param ctx The consumer's own content-script context.
 */
export function pageDataFor(ctx: ContentScriptContext): PageDataRead | null {
  return pageDataReaders.get(ctx) ?? null;
}

/**
 * Run the whole page pass over serialized HTML: detection engine, preloaded
 * resources, diagnoser report, the WordPress generator version.
 *
 * The page parses once (`parsePage`) and every consumer reads that same tree —
 * the single-`DOMParser` shape of the pass minus the engine's repeated document
 * scans. Near-pure (string in → results out, no extension APIs) so tests run
 * it against fixtures with the real engine; the wall time the caller logs
 * covers this whole body, which is the honest comparison baseline.
 *
 * @param pageHTML The serialized document.
 * @returns The results; diagnoser data nulls per element when its content is
 *   unreliable. Throws only for impossible callers (engine checks branch on
 *   anything a page can contain).
 */
export async function processSerializedPage(pageHTML: string): Promise<PageData> {
  const page = parsePage(pageHTML);
  const detections = runChecks(page);
  const preloadedResources = detectPreloadedResources(page);
  applyPresencePropagation(detections);
  const wordpressVersion = detectWordPressVersion(page.document);
  const diagnoserData = await extractDiagnoserData(page.document);
  return { detections, preloadedResources, diagnoserData, wordpressVersion };
}

/**
 * Merge a validated word batch into the accumulated list: first-occurrence
 * order preserved, duplicates dropped, total capped so a long-lived SPA can
 * never grow the list without bound.
 *
 * @param existing The words collected so far.
 * @param incoming A batch that came back valid from `parseErrorWords`.
 * @returns The merged list (never more than {@link ERROR_WORD_LIMIT} words).
 */
export function mergeErrorWords(existing: string[], incoming: string[]): string[] {
  const merged = [...existing];
  for (const word of incoming) if (!merged.includes(word)) merged.push(word);
  return merged.slice(0, ERROR_WORD_LIMIT);
}

/**
 * Wire the data hub into this content script: capture, message serving and
 * window-bridge relays. Thin by design — the logic above and the P1 engine
 * carry the tested weight.
 *
 * @param ctx The content script's context; every listener is cleaned up
 *   through it.
 */
export function setupDataHub(ctx: ContentScriptContext): void {
  let pageHeaders: PageHeaders | null = null;
  let undefinedReferences: string[] = [];
  let allScriptsLoaded = false;
  let pageHTML: string | null = null;
  let data: PageData | null = null;
  /** The single-flight processing promise; null while idle or already done. */
  let processing: Promise<void> | null = null;
  /** The once-flight headers fetch, awaited by every serve path that renders it. */
  let headersFetched: Promise<void> | null = null;

  /** Serialize the document once (the snapshot; later calls are no-ops). */
  const capture = (): void => {
    if (pageHTML !== null) return;
    pageHTML = new XMLSerializer().serializeToString(document);
  };

  const fetchHeaders = async (): Promise<void> => {
    try {
      const headers = await sendMessage('getPageHeaders');
      if (ctx.isInvalid) return;
      pageHeaders = headers;
    } catch (error) {
      // Background missing or failing is not a page problem; the panel
      // renders "no headers" for null, so this degrades explicitly.
      if (ctx.isInvalid) return;
      log.warn('Fetching the page headers failed', error instanceof Error ? error.message : error);
    }
  };

  const notifyPanel = (): void => {
    sendMessage('notifyPanelReload').catch((error: unknown) => {
      // Expected whenever devtools is not open (or is busy reloading).
      if (ctx.isInvalid) return;
      log.debug(
        'Panel reload notification skipped',
        error instanceof Error ? error.message : error
      );
    });
  };

  /**
   * Ensure the page's (already captured) main-frame headers are fetched,
   * exactly once per page. The ask is idempotent against the background's
   * per-tab cache (a read never consumes the rows), so a late ensure simply
   * re-asks and receives the same set — without it, a panel request racing
   * the fetch would serve null and lose the Server card for the page.
   *
   * @returns The fetch's settlement (errors caught inside).
   */
  const ensureHeaders = (): Promise<void> => {
    if (headersFetched === null) headersFetched = fetchHeaders();
    return headersFetched;
  };

  // The single capture moment: serialize, ask for the page's (already
  // captured) main-frame headers, then tell devtools to reload its panel.
  /**
   * The capture's one wait point ({@link createCaptureWaitPoint}): the pass's
   * source exists from here on, and an invalidated-before-DCL context still
   * releases its waiter — the context-owned DCL listener disappears with it,
   * so the machine's invalidation trigger carries the resolution.
   */
  const captureWatchPoint = createCaptureWaitPoint({
    pastParserReady: () => document.readyState !== 'loading',
    registerInvalidated: (callback) => {
      ctx.onInvalidated(callback);
    }
  });
  const onParserReady = (): void => {
    capture();
    // Release the wait point after the capture (and its resolution belongs to
    // this sequence — no second listener may outrun the source's existence):
    // a same-context reader joins the pass's source from here on (idempotent).
    captureWatchPoint.resolve();
    void ensureHeaders().then(() => {
      notifyPanel();
    });
    // The pass feeds the toolbar badge and prints the timing log — both must
    // work with no devtools panel ever opened (owner decision, 2026-10-08).
    // Starting it here also releases the snapshot immediately instead of
    // holding it for the page lifetime; panel requests then read the cached
    // result (single-flight, no second parse).
    void processData();
  };

  if (document.readyState === 'loading') {
    // The hub's capture work rides its own context-owned DCL listener (the
    // machine's is the resolution-only leg); the readyState guard stays the
    // one decision above the machine.
    ctx.addEventListener(document, 'DOMContentLoaded', onParserReady);
  } else {
    // Late injection (extension reloaded onto an open page): the capture
    // moment would never fire again — serialize now, same snapshot semantics.
    onParserReady();
  }

  /**
   * Process the serialized page exactly once, single-flight. On failure the
   * cached result stays null (logged; the panel shows its error state) and no
   * retry runs — the pass is deterministic, and the snapshot is released
   * either way.
   */
  const processData = (): Promise<void> => {
    if (processing !== null) return processing;
    if (data !== null || pageHTML === null) return Promise.resolve();
    processing = (async () => {
      const source = pageHTML;
      const started = performance.now();
      try {
        const result = await processSerializedPage(source);
        if (ctx.isInvalid) return;
        data = result;
      } catch (error) {
        if (ctx.isInvalid) return;
        log.error(
          'Processing the page data failed — the panel will show its error state',
          error instanceof Error ? error.message : error
        );
      } finally {
        // Release the multi-megabyte snapshot in every branch: results get
        // cached, not the source, and a failed pass must not retry on a
        // dropped-over multi-MB string.
        pageHTML = null;
        processing = null;
      }
      if (data !== null) {
        log.info(`Page data processed in ${(performance.now() - started).toFixed(1)} ms`);
        // The badge push first: the at-a-glance surface answers before any
        // presentation can fail. The organized analysis print (owner
        // decision, 2026-10-08) is presentation — a view-model bug there must
        // kill neither the badge nor the panel responses, so it rides its own
        // guard and reports itself.
        pushDetectionSummary();
        try {
          log.info('Page analysis', describeDetections(data.detections));
        } catch (error) {
          log.error(
            'Building the page analysis report failed',
            error instanceof Error ? error.message : error
          );
        }
      } else {
        log.info(
          `Page data processing failed after ${(performance.now() - started).toFixed(1)} ms`
        );
      }
    })();
    return processing;
  };

  const pushDetectionSummary = (): void => {
    if (data === null) return;
    const summary = {
      wprPresent: data.detections.wpr.present,
      cached: data.detections.wpr.cached
    };
    sendMessage('reportDetectionSummary', summary).catch((error: unknown) => {
      // Powers the background's toolbar badge; its absence is not page work.
      // A live context failing to deliver is abnormal — the background owns
      // this listener from boot — so it must not vanish at debug level.
      if (ctx.isInvalid) return;
      log.warn('Detection summary push failed', error instanceof Error ? error.message : error);
    });
  };

  /** The panel payload; null when processing failed or nothing was captured. */
  const fdtData = (): FdtData | null => {
    if (data === null) return null;
    return {
      allScriptsLoaded,
      pageHeaders,
      undefinedReferencesOnPage: undefinedReferences,
      wprDetections: data.detections,
      preloadedResources: data.preloadedResources,
      diagnoserData: data.diagnoserData
    };
  };

  ctx.onInvalidated(
    onMessage('processPageData', async () => {
      await processData();
      return true;
    })
  );
  ctx.onInvalidated(
    onMessage('getFdtData', async () => {
      await processData();
      await ensureHeaders();
      return fdtData();
    })
  );
  ctx.onInvalidated(
    onMessage('getWprDetections', async () => {
      await processData();
      return data?.detections ?? null;
    })
  );

  // The same-context read (the widget consumes the pass result directly, per
  // the hub's rules: one pass, no second parse — the reader joins whichever
  // state the pass is in and never re-runs it). The wait point first: a
  // boot-time read must answer after the capture exists, not with "no source
  // yet" (the pass's honest null is a failure, not a pending page). An
  // invalidated-before-capture world resolves through the machine's teardown
  // trigger and answers null — never a hang.
  const readPageData = async (): Promise<PageData | null> => {
    await captureWatchPoint.settled;
    await processData();
    return data;
  };
  pageDataReaders.set(ctx, readPageData);

  // Both pushes are sender-tab-checked on the devtools side; from here they
  // are fire-and-forget with logged, expected-failure catches.
  const pushUndefinedReferences = (): void => {
    sendMessage('undefinedReferencesUpdated', undefinedReferences).catch((error: unknown) => {
      if (ctx.isInvalid) return;
      log.debug(
        'Undefined-references push skipped',
        error instanceof Error ? error.message : error
      );
    });
  };

  ctx.addEventListener(window, ALL_SCRIPTS_LOADED_EVENT, () => {
    allScriptsLoaded = true;
    sendMessage('allScriptsLoaded', allScriptsLoaded).catch((error: unknown) => {
      if (ctx.isInvalid) return;
      log.debug('All-scripts-loaded push skipped', error instanceof Error ? error.message : error);
    });
  });

  // Error batches from the page's world: validated at this boundary (the MAIN
  // world is the page's world), merged, then relayed wholesale.
  ctx.onInvalidated(
    windowMessenger.onMessage('undefinedReferenceBatch', ({ data: batch }) => {
      const words = parseErrorWords(batch);
      if (words === null) {
        log.warn('Rejected an invalid undefined-references batch from the page');
        return true;
      }
      undefinedReferences = mergeErrorWords(undefinedReferences, words);
      pushUndefinedReferences();
      return true;
    })
  );
}
