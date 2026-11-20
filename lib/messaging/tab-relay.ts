/**
 * The tab-relay contract (`relayTabAsk`): a tab-less extension page that
 * cannot message tabs itself (Firefox gives DevTools pages no `tabs` API)
 * asks the background to forward one tab ask and hand back the answer.
 *
 * The relay is a closed registry, never a generic forwarder: only the asks
 * in {@link TAB_RELAY_ASKS} pass, each with its own payload check, and the
 * tab id must pass the shared tab-id guard. Every failure comes back as a
 * typed {@link TabRelayReply}, never as a silent drop.
 */
import { hasOnlyKeys, isRecord, ownValue } from '../../utils/is-record';
import {
  parseRucssApplyRequest,
  parseRucssStartRequest,
  type RucssApplyRequest,
  type RucssStartRequest
} from './rucss-test';
import { parseScriptSourceRequest, type ScriptSourceRequest } from './script-source';
import { parseServedScriptTagRequest, type ServedScriptTagRequest } from './served-script-tag';
import { parseStyleSourceRequest, type StyleSourceRequest } from './style-source';
import { parseBeaconTestRequest, type BeaconTestRequest } from './beacon-test';
import { parseLcpAnalysisRequest, type LcpAnalysisRequest } from './lcp-analysis';
import { numericTabId } from './sender';
import type { TabAsks } from './tab-asks';

/** The payload each relayable ask carries (`undefined`: none). */
export interface TabRelayPayloads {
  processPageData: undefined;
  getFdtData: undefined;
  getScriptSourceChunk: ScriptSourceRequest;
  getServedScriptTag: ServedScriptTagRequest;
  startRucssTest: RucssStartRequest;
  applyRucssTest: RucssApplyRequest;
  runBeaconTest: BeaconTestRequest;
  runLcpAnalysis: LcpAnalysisRequest;
  getScriptRuntimeStatuses: undefined;
  getCurrentVisitVitals: undefined;
  listPageStyles: undefined;
  listPageStylesheets: undefined;
  getStyleSourceChunk: StyleSourceRequest;
}

/** One relayable ask's name. */
export type TabRelayAsk = keyof TabRelayPayloads;

/** The wire request: the target tab, the ask, and its payload when it has one. */
export type TabRelayRequest = {
  [K in TabRelayAsk]: TabRelayPayloads[K] extends undefined
    ? { tabId: number; ask: K }
    : { tabId: number; ask: K; payload: TabRelayPayloads[K] };
}[TabRelayAsk];

/** One registry row: how an ask's payload is checked and how it is forwarded. */
interface TabRelayAskRow<K extends TabRelayAsk> {
  /**
   * Narrow the untrusted payload, rebuilt from known fields only.
   *
   * @returns The boxed value (a box, since `undefined` is a valid payload),
   *   or null when the payload breaks the ask's contract.
   */
  parsePayload(input: unknown): { readonly value: TabRelayPayloads[K] } | null;
  /** Send the validated ask to the tab over the given (direct) transport. */
  forward(asks: TabAsks, tabId: number, payload: TabRelayPayloads[K]): Promise<unknown>;
}

/** The check for asks without a payload: the field must be absent. */
function parseNoPayload(input: unknown): { readonly value: undefined } | null {
  return input === undefined ? { value: undefined } : null;
}

/**
 * Box a guard's result for a row's `parsePayload`.
 *
 * @param value The rebuilt payload, or null when the guard refused it.
 */
function box<T>(value: T | null): { readonly value: T } | null {
  return value === null ? null : { value };
}

/** The relayable asks — adding one is one row here plus its payload type. */
export const TAB_RELAY_ASKS: { readonly [K in TabRelayAsk]: TabRelayAskRow<K> } = {
  processPageData: {
    parsePayload: parseNoPayload,
    forward: (asks, tabId) => asks.processPageData(tabId)
  },
  getFdtData: {
    parsePayload: parseNoPayload,
    forward: (asks, tabId) => asks.getFdtData(tabId)
  },
  getScriptSourceChunk: {
    parsePayload: (input) => {
      const request = parseScriptSourceRequest(input);
      if (request === null) return null;
      // Rebuilt, so no extra field rides along to the content script.
      const { snapshotId, scriptIndex, offset } = request;
      return { value: { snapshotId, scriptIndex, offset } };
    },
    forward: (asks, tabId, request) => asks.getScriptSourceChunk(tabId, request)
  },
  // The guard rebuilds the request from its two fields only.
  getServedScriptTag: {
    parsePayload: (input) => box(parseServedScriptTagRequest(input)),
    forward: (asks, tabId, request) => asks.getServedScriptTag(tabId, request)
  },
  // Both guards rebuild their request from known fields only.
  startRucssTest: {
    parsePayload: (input) => box(parseRucssStartRequest(input)),
    forward: (asks, tabId, request) => asks.startRucssTest(tabId, request)
  },
  applyRucssTest: {
    parsePayload: (input) => box(parseRucssApplyRequest(input)),
    forward: (asks, tabId, request) => asks.applyRucssTest(tabId, request)
  },
  // The live analysis tools; both guards rebuild their request from known fields only.
  runBeaconTest: {
    parsePayload: (input) => box(parseBeaconTestRequest(input)),
    forward: (asks, tabId, request) => asks.runBeaconTest(tabId, request)
  },
  runLcpAnalysis: {
    parsePayload: (input) => box(parseLcpAnalysisRequest(input)),
    forward: (asks, tabId, request) => asks.runLcpAnalysis(tabId, request)
  },
  getScriptRuntimeStatuses: {
    parsePayload: parseNoPayload,
    forward: (asks, tabId) => asks.getScriptRuntimeStatuses(tabId)
  },
  getCurrentVisitVitals: {
    parsePayload: parseNoPayload,
    forward: (asks, tabId) => asks.getCurrentVisitVitals(tabId)
  },
  listPageStyles: {
    parsePayload: parseNoPayload,
    forward: (asks, tabId) => asks.listPageStyles(tabId)
  },
  listPageStylesheets: {
    parsePayload: parseNoPayload,
    forward: (asks, tabId) => asks.listPageStylesheets(tabId)
  },
  // The guard rebuilds the request from its three fields only.
  getStyleSourceChunk: {
    parsePayload: (input) => box(parseStyleSourceRequest(input)),
    forward: (asks, tabId, request) => asks.getStyleSourceChunk(tabId, request)
  }
};

/** Whether a value names a registry row (own keys only — never `toString` & co.). */
export function isTabRelayAsk(value: unknown): value is TabRelayAsk {
  return typeof value === 'string' && Object.hasOwn(TAB_RELAY_ASKS, value);
}

/** A request that passed the boundary, bound to its row's forward. */
export interface ValidTabRelayRequest {
  readonly tabId: number;
  readonly ask: TabRelayAsk;
  /** Forward the ask with its validated payload over `asks`. */
  forward(asks: TabAsks): Promise<unknown>;
}

/** The request's permitted keys (exact shape: anything else is refused). */
const REQUEST_KEYS = ['tabId', 'ask', 'payload'] as const;

/**
 * Bind one ask's row to its tab and checked payload.
 *
 * @param ask The registry row's name.
 * @param tabId The validated target tab.
 * @param rawPayload The untrusted payload.
 * @returns The bound request, or null when the payload breaks the row's check.
 */
function bindRow<K extends TabRelayAsk>(
  ask: K,
  tabId: number,
  rawPayload: unknown
): (ValidTabRelayRequest & { readonly ask: K }) | null {
  const row: TabRelayAskRow<K> = TAB_RELAY_ASKS[ask];
  const payload = row.parsePayload(rawPayload);
  if (payload === null) return null;
  return { tabId, ask, forward: (asks) => row.forward(asks, tabId, payload.value) };
}

/**
 * Validate an untrusted relay request.
 *
 * @param input The received payload.
 * @returns The bound request, or null for a non-record, an extra key, a
 *   junk tab id, an ask outside the registry, or a payload its row refuses.
 */
export function parseTabRelayRequest(input: unknown): ValidTabRelayRequest | null {
  if (!isRecord(input) || !hasOnlyKeys(input, REQUEST_KEYS)) return null;
  const tabId = numericTabId(ownValue(input, 'tabId'));
  const ask = ownValue(input, 'ask');
  if (tabId === null || !isTabRelayAsk(ask)) return null;
  return bindRow(ask, tabId, ownValue(input, 'payload'));
}

/** The reply side, re-exported (it lives apart so an asking page's bundle stays free of the request parsers). */
export {
  parseTabRelayReply,
  TAB_RELAY_FAILURES,
  type TabRelayFailure,
  type TabRelayReply
} from './tab-relay-reply';
