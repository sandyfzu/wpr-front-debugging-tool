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
 * - Push channels are typed to return `true`: the typed acknowledgement
 *   forces every push handler to mark itself as handled on purpose (the
 *   library resolves the sender's promise with whatever the handler returns —
 *   including `undefined` — so the type documents intent and keeps undefined
 *   returns from looking like forgotten responses). Extension sends reject
 *   when no listener exists yet (receiver not mounted / content script not
 *   injected; "No listeners" / "Could not establish connection" in Chromium,
 *   "No response" for tab-targeted sends); push senders `.catch` that
 *   expected case. **Window-bridge sends behave differently: with no receiver
 *   they never settle** — P4's bootstrap owns that (listen before the page
 *   sends; the isolated side acknowledges).
 * - **Pushes from content scripts must be checked by the receiving tab on
 *   arrival:** the devtools page ignores pushes whose runtime `sender.tabId`
 *   differs from its inspected tab — with two devtools windows open, an
 *   un-scoped push could otherwise act on the wrong panel.
 */

import type { FdtData, PageHeaders, PanelSearchAction, WprDetections } from '../wp-rocket/types';
import type { KnownConflict } from '../storage/known-conflicts';
import type { DbUpdateResult, DetectionSummary } from './validate';

export interface ProtocolMap {
  /** Content script → background: response headers of the sender's main frame. */
  getPageHeaders(): PageHeaders | null;
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
  /** Devtools → panel: DevTools search action relay. */
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
}
