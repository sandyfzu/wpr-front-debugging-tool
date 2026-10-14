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
 *   searches.)
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
import type { DeviceSimState, DeviceSimUpdate } from '../device-simulation/state';
import type { DbUpdateResult, DetectionSummary } from './validate';

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
}
