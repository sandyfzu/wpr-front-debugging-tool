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

import { createScriptSnapshotId, readScriptSourceChunk } from '../../lib/messaging/script-source';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { onMessage, sendMessage } from '../../lib/messaging/index';
import { windowMessenger } from '../../lib/messaging/window-bridge';
import { ERROR_WORD_LIMIT, parseErrorWords } from '../../lib/messaging/validate';
import {
  boundPreloadedResources,
  boundWprDetections,
  servableWordPressVersion
} from '../../lib/messaging/payload-bounds';
import type {
  DiagnoserDocData,
  FdtData,
  PageCookies,
  PageHeaderCapture,
  PreloadedResources,
  WprDetections
} from '../../lib/wp-rocket/types';
import { sampleCookieNames } from '../../lib/wp-rocket/cookies';
import { parsePage } from '../../lib/detection/parse-page';
import { applyPresencePropagation, runChecks } from '../../lib/detection/run-detection';
import { describeDetections } from '../../lib/detection/describe';
import { cacheStateFromCapture } from '../../lib/detection/cache-context';
import type { CacheState } from '../../lib/detection/cache-context';
import { isCacheBypassUrl } from '../../lib/wp-rocket/constants';
import { detectPreloadedResources } from '../../lib/detection/detect-optimizations';
import { detectWordPressVersion } from '../../lib/detection/wordpress-version';
import { extractDiagnoserData } from '../../lib/diagnostics/extract';
import { createLogger } from '../../lib/logger';
import { rucssTestModeFor } from './rucss-test';
import {
  createSimulationMarkerVerifier,
  UNVERIFIED_MARKERS,
  type SimulationMarkerVerifier
} from '../../lib/messaging/simulation-marker-verifier';

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
  /** The WordPress core version the generator meta declared (within the version cap), or null. */
  wordpressVersion: string | null;
}

/**
 * The same-context read: the pass result plus the cache answer, which needs
 * the captured headers (panel-side facts) as well as the detections. The hub
 * awaits its own header fetch before answering, so a same-context consumer
 * never reads "headers unavailable" just because it raced the capture.
 */
export interface PageDataSnapshot {
  data: PageData;
  cacheState: CacheState;
}

/** The same-context read the hub hands out (null when the pass failed). */
export type PageDataRead = () => Promise<PageDataSnapshot | null>;

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
 * scans. Near-pure (string in → results out; the only extension call is the
 * injected marker verifier) so tests run it against fixtures with the real
 * engine; the wall time the caller logs covers this whole body, which is the
 * honest comparison baseline.
 *
 * @param pageHTML The serialized document.
 * @param verify Verifies the page's simulation marker — asked only when the
 *   page carries a well-formed one (default: vouches for nothing, so a
 *   marker reads as unverified and changes no verdict).
 * @returns The results; diagnoser data nulls per element when its content is
 *   unreliable. Throws only for impossible callers (engine checks branch on
 *   anything a page can contain).
 */
export async function processSerializedPage(
  pageHTML: string,
  verify: SimulationMarkerVerifier = UNVERIFIED_MARKERS
): Promise<PageData> {
  const page = parsePage(pageHTML);
  // No marker, or copies that disagree (no id): unverified, never asked.
  const markerId = page.simulationMarker?.markerId ?? null;
  const verified = markerId === null ? [] : await verify(markerId);
  const detections = runChecks(page, verified);
  const preloadedResources = detectPreloadedResources(page);
  applyPresencePropagation(detections);
  // Bounded once at collection: the strip (same-context read) and the panel
  // payload carry the same value — an over-cap version is dropped, not clipped.
  const wordpressVersion = servableWordPressVersion(detectWordPressVersion(page.document));
  const diagnoserData = await extractDiagnoserData(page.document);
  return { detections, preloadedResources, diagnoserData, wordpressVersion };
}

/**
 * The detections as served across the boundary (`getFdtData` and
 * `getWprDetections` alike): bounded to the payload caps.
 *
 * @param data The pass result.
 */
export function servedDetections(data: PageData): WprDetections {
  return boundWprDetections(data.detections);
}

/** The live page facts the hub tracks beside the single-pass result. */
export interface LivePageFacts {
  allScriptsLoaded: boolean;
  /** The background's (already bounded) header capture, or null. */
  headerCapture: PageHeaderCapture | null;
  undefinedReferences: string[];
  /** Null only if the capture invariant failed (the field is then omitted). */
  cookies: PageCookies | null;
  /** The captured URL carried WP Rocket's bypass parameter. */
  bypassAttested: boolean;
  /** RUCSS tests applied on this page since it loaded (0 when none). */
  rucssTestRuns: number;
}

/**
 * Compose the panel payload from the pass result and the live facts. The
 * page-derived rows are bounded to the boundary's caps here (cut rows carry
 * `truncated: true`), so a page with more data than the contract admits
 * still yields a payload the panel's guard accepts — never one it rejects
 * on every request.
 *
 * @param data The pass result (unbounded; same-context readers keep it whole).
 * @param live The live facts.
 * @returns The payload `getFdtData` serves.
 */
export function composeFdtData(data: PageData, live: LivePageFacts): FdtData {
  // Idempotent re-bound: a hand-built pass result can never make the guard
  // reject the whole payload over one envelope string.
  const wordpressVersion = servableWordPressVersion(data.wordpressVersion);
  const payload = {
    allScriptsLoaded: live.allScriptsLoaded,
    pageHeaders: live.headerCapture?.headers ?? null,
    undefinedReferencesOnPage: live.undefinedReferences,
    wprDetections: servedDetections(data),
    preloadedResources: boundPreloadedResources(data.preloadedResources),
    diagnoserData: data.diagnoserData,
    ...(live.headerCapture?.truncated === true ? { pageHeadersTruncated: true as const } : {}),
    ...(live.bypassAttested ? { bypassAttested: true as const } : {}),
    ...(wordpressVersion === null ? {} : { wordpressVersion }),
    ...(live.rucssTestRuns > 0 ? { rucssTestMode: { runs: live.rucssTestRuns } } : {})
  };
  // The capture (which redacts the values at the read) always runs before
  // processing can produce data, so the list is expected here; should that
  // invariant ever fail, the additive field's absence — never a forged
  // empty stamp — is the tolerated degradation consumers omit gracefully.
  return live.cookies === null ? payload : { ...payload, cookies: live.cookies };
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
 * Call `onRestore` each time the page is shown again from the back/forward
 * cache: the same document comes back without a load, so nothing else tells
 * an open panel (which went on to the next page, or lost its read to the
 * cache) to read this page again.
 *
 * @param target The page's window.
 * @param signal Removes the listener (the content script's context).
 * @param onRestore Called once per restore.
 */
export function onBackForwardRestore(
  target: Pick<Window, 'addEventListener'>,
  signal: AbortSignal,
  onRestore: () => void
): void {
  target.addEventListener(
    'pageshow',
    (event: PageTransitionEvent) => {
      if (event.persisted) onRestore();
    },
    { passive: true, signal }
  );
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
  const scriptSnapshotId = createScriptSnapshotId();
  let headerCapture: PageHeaderCapture | null = null;
  let undefinedReferences: string[] = [];
  let allScriptsLoaded = false;
  // The URL the page was loaded with is the only bypass evidence the capture
  // can attest; it never changes for this document's capture moment.
  const bypassAttested = isCacheBypassUrl(window.location.href);
  let pageHTML: string | null = null;
  /** The page's cookie names (values redacted), captured with the snapshot. */
  let pageCookies: PageCookies | null = null;
  let data: PageData | null = null;
  /** The single-flight processing promise; null while idle or already done. */
  let processing: Promise<void> | null = null;
  /** The once-flight headers fetch, awaited by every serve path that renders it. */
  let headersFetched: Promise<void> | null = null;

  /** Serialize the document once (the snapshot; later calls are no-ops). */
  const capture = (): void => {
    if (pageHTML !== null) return;
    pageHTML = new XMLSerializer().serializeToString(document);
    // The cookie names ride the same snapshot moment: `document.cookie` is
    // the live document's view (not the serialization's), so reading here is
    // the capture's "as of" instant, and the capture parser redacts the
    // values before they are ever in a variable of ours.
    // Hard-ordered by design, no `try`: the two preceding effects (the page
    // serialized, `document.cookie` read) have no throwing path — the getter
    // is specified to answer, never throw (WHATWG DOM) — so this step cannot
    // strand the pass with a never-resolving wait point below.
    pageCookies = { names: sampleCookieNames(document.cookie), capturedAt: Date.now() };
  };

  const fetchHeaders = async (): Promise<void> => {
    try {
      const capture = await sendMessage('getPageHeaders');
      if (ctx.isInvalid) return;
      headerCapture = capture;
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
   * exactly once per page. A late caller joins the same one-shot fetch
   * promise; without it, a panel request racing the fetch would serve null
   * and lose the Server card for the page.
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
  onBackForwardRestore(window, ctx.signal, notifyPanel);

  /** The live context's invalidation, read without control-flow narrowing. */
  const invalidated = (): boolean => ctx.isInvalid;

  /** The page's simulation marker, vouched for by the background only. */
  const verifyMarker = createSimulationMarkerVerifier({
    send: (markerId) => sendMessage('verifySimulationMarker', { markerId }),
    isInvalid: invalidated,
    log
  });

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
        const result = await processSerializedPage(source, verifyMarker);
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
        const result = data;
        log.info(`Page data processed in ${(performance.now() - started).toFixed(1)} ms`);
        // The badge push first: the at-a-glance surface answers before any
        // presentation can fail. The organized analysis print (owner
        // decision, 2026-10-08) is presentation — a view-model bug there must
        // kill neither the badge nor the panel responses, so it rides its own
        // guard and reports itself.
        pushDetectionSummary();
        // The analysis reads the same capture the panel does: join the
        // one-shot header fetch before building the cache answer.
        await ensureHeaders();
        if (invalidated()) return;
        try {
          log.info(
            'Page analysis',
            describeDetections(
              result.detections,
              cacheStateFromCapture(result.detections.wpr, headerCapture, bypassAttested)
            )
          );
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
      scriptSnapshotId,
      ...composeFdtData(data, {
        allScriptsLoaded,
        headerCapture,
        undefinedReferences,
        cookies: pageCookies,
        bypassAttested,
        // Read per serve: the test module sets up after the hub, and a test changes it live.
        rucssTestRuns: rucssTestModeFor(ctx)?.().runs ?? 0
      })
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
    onMessage('getScriptSourceChunk', ({ data: request }) =>
      data === null || ctx.isInvalid
        ? { status: 'unavailable' }
        : readScriptSourceChunk(data.detections.delay_js.scripts, scriptSnapshotId, request)
    )
  );
  ctx.onInvalidated(
    onMessage('getWprDetections', async () => {
      await processData();
      // Bounded like the panel payload: this row crosses the same boundary.
      return data === null ? null : servedDetections(data);
    })
  );

  // The same-context read (the widget consumes the pass result directly, per
  // the hub's rules: one pass, no second parse — the reader joins whichever
  // state the pass is in and never re-runs it). The wait point first: a
  // boot-time read must answer after the capture exists, not with "no source
  // yet" (the pass's honest null is a failure, not a pending page). An
  // invalidated-before-capture world resolves through the machine's teardown
  // trigger and answers null — never a hang.
  const readPageData = async (): Promise<PageDataSnapshot | null> => {
    await captureWatchPoint.settled;
    await processData();
    if (data === null) return null;
    // The cache vocabulary reads the headers too: await the same once-fetch
    // the panel's serve path awaits, so the strip's answer is never a race
    // artifact. A failed fetch degrades to null (headers unavailable).
    await ensureHeaders();
    return {
      data,
      cacheState: cacheStateFromCapture(data.detections.wpr, headerCapture, bypassAttested)
    };
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
