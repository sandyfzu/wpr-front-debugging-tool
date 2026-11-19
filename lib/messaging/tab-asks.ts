/**
 * The DevTools surfaces' asks to the inspected tab's content script — the
 * page-data warm-up, the full page data, one script-source chunk, one
 * script's served tag, the
 * RUCSS test's two steps, the page-style inventory, and the live analysis
 * tools (beacon test, LCP analysis, live script states, current-visit
 * vitals) — behind one transport choice.
 *
 * Where the context has the `tabs` API (Chromium), the asks go to the tab
 * directly. Where it does not (Firefox DevTools pages), the same asks go
 * through the background relay (`./tab-relay`), which forwards them with
 * this module's direct transport. {@link selectTabAsks} is the only place
 * that choice is made.
 */
import { sendMessage } from './index';
import type { BeaconTestRequest } from './beacon-test';
import type { LcpAnalysisRequest } from './lcp-analysis';
import type { RucssApplyRequest, RucssStartRequest } from './rucss-test';
import type { ScriptSourceRequest } from './script-source';
import type { ServedScriptTagRequest } from './served-script-tag';
import type { StyleSourceRequest } from './style-source';
import { canMessageRuntime, canMessageTabs } from './tab-messaging';
import { relayTabAsks } from './tab-relay-client';

/**
 * Every panel→tab ask, each resolving with the content script's untrusted
 * answer (the caller validates it) or rejecting with the transport's
 * failure (`isNoReceiverError` tells the expected misses apart).
 */
export interface TabAsks {
  /**
   * Warm up the tab's page processing. `undefined` targets no tab — the ask
   * then fails as the expected no-receiver case.
   */
  readonly processPageData: (tabId: number | undefined) => Promise<unknown>;
  /** Everything the panel renders; `undefined` behaves as for `processPageData`. */
  readonly getFdtData: (tabId: number | undefined) => Promise<unknown>;
  /** One bounded script-source read, from the tab's top frame only. */
  readonly getScriptSourceChunk: (tabId: number, request: ScriptSourceRequest) => Promise<unknown>;
  /** One captured script's served opening tag, from the tab's top frame only. */
  readonly getServedScriptTag: (tabId: number, request: ServedScriptTagRequest) => Promise<unknown>;
  /** Start a RUCSS test, in the top frame only. */
  readonly startRucssTest: (tabId: number, request: RucssStartRequest) => Promise<unknown>;
  /** Apply a started RUCSS test, in the top frame only. */
  readonly applyRucssTest: (tabId: number, request: RucssApplyRequest) => Promise<unknown>;
  /** Run one beacon test, in the top frame only. */
  readonly runBeaconTest: (tabId: number, request: BeaconTestRequest) => Promise<unknown>;
  /** Read the page's LCP facts, in the top frame only. */
  readonly runLcpAnalysis: (tabId: number, request: LcpAnalysisRequest) => Promise<unknown>;
  /** Read the live scripts' attributes, in the top frame only. */
  readonly getScriptRuntimeStatuses: (tabId: number) => Promise<unknown>;
  /** Read this visit's vitals entries, in the top frame only. */
  readonly getCurrentVisitVitals: (tabId: number) => Promise<unknown>;
  /** List the page's styles, from the top frame only. */
  readonly listPageStyles: (tabId: number) => Promise<unknown>;
  /** List the page's styles with their WP Rocket stamps, from the top frame only. */
  readonly listPageStylesheets: (tabId: number) => Promise<unknown>;
  /** One chunk of an inline style's CSS from the latest stylesheet list, top frame only. */
  readonly getStyleSourceChunk: (tabId: number, request: StyleSourceRequest) => Promise<unknown>;
}

/** The direct transport: the extension's tab send, one typed call per ask. */
export const DIRECT_TAB_ASKS: TabAsks = {
  processPageData: (tabId) => sendMessage('processPageData', undefined, tabId),
  getFdtData: (tabId) => sendMessage('getFdtData', undefined, tabId),
  getScriptSourceChunk: (tabId, request) =>
    sendMessage('getScriptSourceChunk', request, { tabId, frameId: 0 }),
  getServedScriptTag: (tabId, request) =>
    sendMessage('getServedScriptTag', request, { tabId, frameId: 0 }),
  startRucssTest: (tabId, request) => sendMessage('startRucssTest', request, { tabId, frameId: 0 }),
  applyRucssTest: (tabId, request) => sendMessage('applyRucssTest', request, { tabId, frameId: 0 }),
  runBeaconTest: (tabId, request) => sendMessage('runBeaconTest', request, { tabId, frameId: 0 }),
  runLcpAnalysis: (tabId, request) => sendMessage('runLcpAnalysis', request, { tabId, frameId: 0 }),
  getScriptRuntimeStatuses: (tabId) =>
    sendMessage('getScriptRuntimeStatuses', undefined, { tabId, frameId: 0 }),
  getCurrentVisitVitals: (tabId) =>
    sendMessage('getCurrentVisitVitals', undefined, { tabId, frameId: 0 }),
  listPageStyles: (tabId) => sendMessage('listPageStyles', undefined, { tabId, frameId: 0 }),
  listPageStylesheets: (tabId) =>
    sendMessage('listPageStylesheets', undefined, { tabId, frameId: 0 }),
  getStyleSourceChunk: (tabId, request) =>
    sendMessage('getStyleSourceChunk', request, { tabId, frameId: 0 })
};

/** The transports {@link selectTabAsks} picks from (tests inject doubles). */
export interface TabAskTransports {
  /** Used whenever the context can message tabs itself. */
  readonly direct: TabAsks;
  /** Built only when the context cannot, but can message the background. */
  readonly relay: () => TabAsks;
}

/** Production transports: the direct sends, and the relay over the runtime send. */
const DEFAULT_TRANSPORTS: TabAskTransports = {
  direct: DIRECT_TAB_ASKS,
  relay: () => relayTabAsks((request) => sendMessage('relayTabAsk', request))
};

/**
 * Pick how this context asks tabs: directly when it has `tabs.sendMessage`
 * (always preferred), through the background relay when it has only
 * `runtime.sendMessage`, and not at all otherwise.
 *
 * @param api The extension API object (`browser`), probed structurally.
 * @param transports The transports to pick from; defaults to production.
 * @returns The asks, or null when this context cannot reach a tab at all.
 */
export function selectTabAsks(
  api: unknown,
  transports: TabAskTransports = DEFAULT_TRANSPORTS
): TabAsks | null {
  if (canMessageTabs(api)) return transports.direct;
  if (canMessageRuntime(api)) return transports.relay();
  return null;
}
