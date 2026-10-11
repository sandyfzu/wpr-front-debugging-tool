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
import { extractDiagnoserData } from '../../lib/diagnostics/extract';
import { createLogger } from '../../lib/logger';

const log = createLogger('');

/** The window event WP Rocket dispatches when all its scripts finished loading. */
const ALL_SCRIPTS_LOADED_EVENT = 'rocket-allScriptsLoaded';

/** One full page-processing result, immutable after the single pass. */
interface PageData {
  detections: WprDetections;
  preloadedResources: PreloadedResources;
  diagnoserData: DiagnoserDocData | null;
}

/**
 * Run the whole page pass over serialized HTML: detection engine, preloaded
 * resources, diagnoser report.
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
  const diagnoserData = await extractDiagnoserData(page.document);
  return { detections, preloadedResources, diagnoserData };
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
  const onParserReady = (): void => {
    capture();
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
