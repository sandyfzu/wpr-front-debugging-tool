/**
 * The extension message protocol: one typed row per channel, owned here.
 *
 * Body rules (any new row, and any consumer, must respect them):
 * - Rows are named intent-first; the map is extended additively — later phases
 *   add rows with their validators + tests in their owning phase, they do not
 *   edit established rows.
 * - Payloads and returns are validated at the receiving boundary with the
 *   guards in `lib/messaging/validate` whenever they originate from the page.
 * - **tabId never appears in a payload.** Content scripts, devtools, popup and
 *   options send *without* tab targeting: the background resolves the sender
 *   from its runtime `sender` (`onMessage` exposes it). Senders that must
 *   reach one specific tab (devtools/popup/background → content script) pass
 *   the tab id as `sendMessage`'s third argument, never inside the data.
 *   (`panelSearch` is the one exception: devtools→panel is an extension-
 *   internal send with no runtime sender tab, so its payload carries the
 *   relaying devtools page's inspected tab id — the receiver's only scoping
 *   basis; without it every open DevTools window would act on every other's
 *   searches. The exclusion-session panel rows share the reason: the
 *   background has no runtime tab when it pushes to the panel, and the
 *   panel has none when it asks — both carry the inspected tab id, and the
 *   background answers the ask only for senders without a runtime tab. The
 *   tab relay row `relayTabAsk` is the same case: it names the tab to
 *   forward to, answered for those senders only.)
 * - Push channels are typed to return `true`: the typed acknowledgement
 *   forces every push handler to mark itself as handled on purpose (the
 *   library resolves the sender's promise with whatever the handler returns —
 *   including `undefined` — so the type documents intent and keeps undefined
 *   returns from looking like forgotten responses). Extension sends reject
 *   when no listener exists yet (receiver not mounted / content script not
 *   injected): Chromium's runtime bridge rejects with "Could not establish
 *   connection. Receiving end does not exist.", the transport folds an
 *   unanswered tab-targeted send into its own "No response" error, and the
 *   unit-test double rejects with "No listeners available". Push senders
 *   `.catch` that expected case (see `./no-receiver`). **Window-bridge sends
 *   behave differently: with no receiver they never settle** — P4's
 *   bootstrap owns that (listen before the page sends; the isolated side
 *   acknowledges).
 * - **Pushes from content scripts must be checked by the receiving tab on
 *   arrival:** the devtools page ignores pushes whose runtime `sender.tabId`
 *   differs from its inspected tab — with two devtools windows open, an
 *   un-scoped push could otherwise act on the wrong panel.
 */

import type {
  FdtData,
  PageHeaderCapture,
  PanelSearchAction,
  WprDetections
} from '../wp-rocket/types';
import type { KnownConflict } from '../storage/known-conflicts';
import type { ChordPlatform } from '../storage/palette-chord-platform';
import type { DeviceSimState, DeviceSimUpdate } from '../device-simulation/state';
import type { ScriptSourceRequest, ScriptSourceReply } from './script-source';
import type { DbUpdateResult, DetectionSummary } from './validate';
import type {
  ExclusionApplyReply,
  ExclusionOverlayPresentation,
  ExclusionSaveReply,
  ExclusionSessionStatus,
  ExclusionSessionTabQuery,
  ExclusionSessionTabStatus,
  ExclusionSetPayload,
  SavedExclusionSetReply
} from './exclusion-session';
import type { ExclusionOverlayOpenOutcome } from './exclusion-panel';
import type { SimulationMarkerQuery, SimulationMarkerVerdict } from './exclusion-simulation';
import type { TabRelayReply, TabRelayRequest } from './tab-relay';
import type { PageStylesReply } from './page-styles';
import type {
  RucssApplyReply,
  RucssApplyRequest,
  RucssFetchReply,
  RucssFetchRequest,
  RucssStartReply,
  RucssStartRequest
} from './rucss-test';
import type { BeaconTestReply, BeaconTestRequest } from './beacon-test';
import type { LcpAnalysisReply, LcpAnalysisRequest } from './lcp-analysis';
import type { ScriptRuntimeReply } from './script-runtime';
import type { CurrentVisitVitalsReply } from './current-visit-vitals';

export interface ProtocolMap {
  /**
   * Content script → background: the sender's main-frame header capture
   * (bounded rows + truncation mark). Both ends ship in one build and nothing
   * persists the reply, so its shape moved from the bare row list to the
   * capture object to carry the list-level mark.
   */
  getPageHeaders(): PageHeaderCapture | null;
  /** Devtools → tab content script: warm up processing (idempotent). */
  processPageData(): boolean;
  /** Devtools → tab content script: everything the panel renders. */
  getFdtData(): FdtData | null;
  /** Panel → tab: bounded read from the exact immutable script capture. */
  getScriptSourceChunk(data: ScriptSourceRequest): ScriptSourceReply;
  /** Popup → tab content script: detections only. */
  getWprDetections(): WprDetections | null;
  /** Content script → devtools (push, sender-tab checked): reload the panel. */
  notifyPanelReload(): true;
  /** Content script → devtools (push, sender-tab checked): refreshed word list. */
  undefinedReferencesUpdated(data: string[]): true;
  /** Content script → devtools (push, sender-tab checked): page scripts all loaded. */
  allScriptsLoaded(data: boolean): true;
  /**
   * Devtools → panel: DevTools search action relay. The payload carries the
   * relaying devtools page's `devtools.inspectedWindow.tabId`: extension
   * senders have no runtime tab, so this field is how the panel scopes the
   * stream to its own window (the tabId-payload rule's one exception).
   */
  panelSearch(data: PanelSearchAction): true;
  /** Background → tab content script: open the side-by-side compare view. */
  openSideBySide(): true;
  /** Background → tab content script: open the PSI side-by-side flow. */
  openSideBySidePerformance(): true;
  /**
   * Background → tab content script (tab-targeted, no payload): open the
   * on-page command palette. Its receiver answers only in the top frame and
   * only while the on-page UI gate is on; a tab without a live receiver
   * rejects like every push (the expected no-receiver case). The handler is
   * registered by the top-frame palette module only and torn down with it
   * on gate-off, so a send racing a gate-off write reads as no-receiver —
   * acceptable, since the menu disables its row while the gate is off.
   */
  openCommandPalette(): true;
  /**
   * Palette module (top frame) → background (sender-resolved, no payload):
   * inject the palette's view — a runtime content script, so pages carry
   * none of its code until the first open — into the sender tab's top
   * frame. Only a top-frame http(s) sender is answered (anything else is
   * refused); resolves once the script ran, rejects when the injection
   * failed (the module surfaces it).
   */
  loadCommandPaletteView(): true;
  /**
   * Palette module (top frame) → background (sender-resolved, no payload):
   * open the exclusion builder overlay on the sender's own tab (the menu
   * entry's opener: a live overlay is revealed, never replaced). Only a
   * top-frame http(s) sender is answered; a content script can never name
   * another tab.
   */
  openExclusionOverlayOnSenderTab(): ExclusionOverlayOpenOutcome;
  /**
   * Content script / DevTools panel → background (no payload): the palette
   * chord's keyboard convention. Neither can call `runtime.getPlatformInfo`
   * (Firefox gives DevTools pages none), so the background answers from it; the reply is a closed literal, and a
   * platform-info failure answers `'other'` (logged) rather than rejecting.
   */
  getChordPlatform(): ChordPlatform;
  /** Content script → background: known-conflicts rows (storage or seed fallback). */
  getKnownConflictsDb(): KnownConflict[];
  /** Content script → background (push): toolbar badge input, per sender tab. */
  reportDetectionSummary(data: DetectionSummary): true;
  /** Options → background: refresh the conflicts DB now. */
  updateKnownConflictsDb(): DbUpdateResult | null;
  /** Content script → background (sender-resolved): the tab's simulation state. */
  getDeviceSimulation(): DeviceSimState;
  /** Content script → background (sender-resolved): switch a tab's simulation and learn the result. */
  setDeviceSimulation(data: DeviceSimUpdate): DeviceSimState;
  /** Background → tab (push): the state the tab's requests carry after a transition. */
  deviceSimulationChanged(data: DeviceSimState): true;
  /** Background → tab (probe, sweep): ack coming from a live isolated world. */
  reportDeviceSimulationLiveness(): true;
  /**
   * Builder overlay → background. Every overlay row resolves its tab and
   * origin with `resolveTopFrameSender` (top frame only; anything else is
   * refused) and is asked through `boundedAsk` with its
   * `EXCLUSION_SESSION_DEADLINES_MS` entry — an internal background failure
   * surfaces to the sender as the `failed` outcome.
   *
   * Apply the set — arm interception, then reload the tab; saves the set
   * for the origin only when answering `applying`.
   */
  applyExclusionSession(data: ExclusionSetPayload): ExclusionApplyReply;
  /** Builder overlay → background (sender-resolved): end the tab's session; answers the new status. */
  stopExclusionSession(): ExclusionSessionStatus;
  /** Builder overlay → background (sender-resolved): the tab's session status. */
  getExclusionSession(): ExclusionSessionStatus;
  /**
   * Builder overlay → background (sender-resolved): the origin's saved set —
   * the editor's restore source, readable before any session exists.
   */
  getSavedExclusionSet(): SavedExclusionSetReply;
  /**
   * Builder overlay → background (sender-resolved): save the set for the
   * origin (the background is the only writer of the saved sets).
   */
  saveExclusionSet(data: ExclusionSetPayload): ExclusionSaveReply;
  /**
   * Background → tab (push, sent with `frameId: 0` — the overlay lives in
   * the top frame only): the tab's session status changed (e.g.
   * interception ended).
   */
  exclusionSessionChanged(data: ExclusionSessionStatus): true;
  /**
   * Panel → background: one tab's session status. Carries the inspected tab
   * id (the panel has no runtime tab — see the tabId rule's exceptions);
   * answered only for `isExtensionPageSender` senders.
   */
  getExclusionSessionForTab(data: ExclusionSessionTabQuery): ExclusionSessionStatus;
  /**
   * Background → panel (push): a tab's session status changed — the
   * builder-active signal. Carries the tab id it describes; the panel drops
   * it from senders with a runtime tab and acts only for its inspected tab.
   */
  exclusionSessionUpdated(data: ExclusionSessionTabStatus): true;
  /**
   * Panel → background: open the builder overlay on the inspected tab's
   * page. Carries the inspected tab id like `getExclusionSessionForTab`
   * (answered only for `isExtensionPageSender` senders).
   */
  openExclusionOverlay(data: ExclusionSessionTabQuery): ExclusionOverlayOpenOutcome;
  /**
   * Builder overlay → background (push, sender-resolved top frame): how the
   * user left the overlay, so the session tab's next pages bring it back
   * the same way.
   */
  exclusionOverlayPresented(data: ExclusionOverlayPresentation): true;
  /**
   * Content script (data hub, top frame) → background (sender-resolved top
   * frame, `boundedAsk` with `EXCLUSION_SESSION_DEADLINES_MS.verifyMarker`):
   * is the page's simulation marker one this tab's session wrote for this
   * origin? Answers the features it vouches for; `[]` = unverified (unknown
   * id, another tab or origin). Asked only when the page carries a
   * well-formed marker.
   */
  verifySimulationMarker(data: SimulationMarkerQuery): SimulationMarkerVerdict;
  /**
   * Panel/devtools page → background: forward one registry-listed tab ask
   * (`./tab-relay`) for a context without the `tabs` API. Carries the
   * target tab id (the asking page has no runtime tab — see the tabId
   * rule's exceptions); answered only for this extension's tab-less pages,
   * every failure as a typed reply.
   */
  relayTabAsk(data: TabRelayRequest): TabRelayReply;
  /**
   * Panel → tab (top frame, `frameId: 0`; relayable): start a RUCSS test —
   * ask the service through `fetchRucssShakenCss`, then snapshot the
   * page's styles. Never changes the page; every failure is a typed reply.
   */
  startRucssTest(data: RucssStartRequest): RucssStartReply;
  /**
   * Panel → tab (top frame; relayable): apply a started RUCSS test — remove
   * the snapshot's styles that are not kept, inject the built CSS.
   */
  applyRucssTest(data: RucssApplyRequest): RucssApplyReply;
  /**
   * Content script (top frame) → background (sender-resolved): send one
   * request to the fixed RUCSS service for the sender's own page. Only a
   * top-frame http(s) sender asking for a page on its own origin is
   * answered (`refused` otherwise, nothing sent); never rejects.
   */
  fetchRucssShakenCss(data: RucssFetchRequest): RucssFetchReply;
  /**
   * Panel → tab (top frame, `frameId: 0`; relayable): run one beacon test
   * with the given configuration — the beacon's measurement only, nothing
   * written to the page or sent to the site; every outcome is a typed reply.
   */
  runBeaconTest(data: BeaconTestRequest): BeaconTestReply;
  /**
   * Beacon executor (top frame) → background (sender-resolved, no payload):
   * inject the beacon runner (an unlisted script) into the sender tab's top
   * frame. Only a top-frame http(s) sender is answered (anything else is
   * refused); resolves once the script ran, rejects when the injection failed.
   */
  loadBeaconRunner(): true;
  /**
   * Panel → tab (top frame; relayable): the page's LCP facts (candidates,
   * navigation and resource timing); optionally frames the LCP element for
   * a few seconds.
   */
  runLcpAnalysis(data: LcpAnalysisRequest): LcpAnalysisReply;
  /** Panel → tab (top frame; relayable): the live `<script>` elements' raw attributes. */
  getScriptRuntimeStatuses(): ScriptRuntimeReply;
  /** Panel → tab (top frame; relayable): this visit's Core Web Vitals entries. */
  getCurrentVisitVitals(): CurrentVisitVitalsReply;
  /**
   * Panel → tab (top frame, `frameId: 0`; relayable): list the page's
   * styles as they are now (the RUCSS tester's inventory). Read-only.
   */
  listPageStyles(): PageStylesReply;
}
