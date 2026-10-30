/**
 * The devtools panel's side of the exclusion-session contract: the open
 * outcomes of `openExclusionOverlay` and a summary parse of the session
 * status (its state and, when active, its origin). Kept apart from the
 * full contract (`./exclusion-session`: sets, reports, served identities)
 * so the panel validates exactly what it reads without bundling the rest —
 * a tolerant read: every other field of a status is ignored.
 */
import { SIMULATED_FEATURES, type SimulatedFeatureId } from '../wp-rocket-simulation/spec';
import { numericTabId } from './sender';
import { isHttpOrigin } from '../../utils/urls';
import { isRecord, ownValue } from '../../utils/is-record';

/**
 * How opening the builder overlay on a tab ended (the background injects
 * it into the tab's top frame):
 * - `injected` — the overlay script was injected (it owns its states from there),
 * - `revealed` — an overlay already on the page was unfolded and focused
 *   (never replaced: that would drop its unsaved draft),
 * - `unsupported-page` — the browser does not let extensions script the page,
 * - `not-html` — the page is not an HTML page (an image, a feed, a file),
 * - `tab-gone` — the tab closed first,
 * - `page-ui-off` — the on-page UI gate is off: nothing is injected into
 *   pages until it is turned back on,
 * - `failed` — anything else (logged by the background).
 */
export const EXCLUSION_OVERLAY_OPEN_OUTCOMES = [
  'injected',
  'revealed',
  'unsupported-page',
  'not-html',
  'tab-gone',
  'page-ui-off',
  'failed'
] as const;

/** One open outcome (see {@link EXCLUSION_OVERLAY_OPEN_OUTCOMES}). */
export type ExclusionOverlayOpenOutcome = (typeof EXCLUSION_OVERLAY_OPEN_OUTCOMES)[number];

/** A session's state, as a status display reads it. */
export type ExclusionSessionSummary =
  | { readonly state: 'inactive' }
  | {
      readonly state: 'active';
      readonly origin: string;
      /**
       * The features the last intercepted document was simulated with
       * (absent: none — no document yet, a session that simulates nothing,
       * or a step that left the page as served).
       */
      readonly simulated?: readonly SimulatedFeatureId[];
    }
  | { readonly state: 'unavailable' };

/** A push about one tab, as a status display reads it. */
export interface ExclusionSessionTabSummary {
  readonly tabId: number;
  readonly summary: ExclusionSessionSummary;
}

/**
 * Parse the background's answer to an overlay open.
 *
 * @param input The untrusted answer.
 * @returns The outcome, or null when it is not one.
 */
export function parseExclusionOverlayOpenOutcome(
  input: unknown
): ExclusionOverlayOpenOutcome | null {
  return EXCLUSION_OVERLAY_OPEN_OUTCOMES.find((outcome) => outcome === input) ?? null;
}

/**
 * Summarize an untrusted session status.
 *
 * @param input A status (an ask's answer, or a push's `status`).
 * @returns The summary, or null when the state is unknown or an active
 *   session names no canonical http(s) origin.
 */
export function parseExclusionSessionSummary(input: unknown): ExclusionSessionSummary | null {
  if (!isRecord(input)) return null;
  const state = ownValue(input, 'state');
  if (state === 'inactive' || state === 'unavailable') return { state };
  if (state !== 'active') return null;
  const origin = ownValue(input, 'origin');
  if (typeof origin !== 'string' || !isHttpOrigin(origin)) return null;
  const simulated = simulatedFeatures(ownValue(input, 'document'));
  return simulated.length === 0 ? { state, origin } : { state, origin, simulated };
}

/** The document outcome's keys holding each feature's simulation report. */
const SIMULATION_REPORT_KEYS = ['lazyloadSimulation', 'deferSimulation', 'simulation'] as const;

/**
 * The known features an untrusted document outcome reports as simulated —
 * tolerant: a malformed outcome, an unknown feature or any other step state
 * (`already-served`, `csp-blocked`, `not-applicable`, an unmodified document)
 * reads as no simulation (the summary only words the session; the record's
 * own guard owns the outcome).
 *
 * @param input The status's `document` value.
 * @returns The simulated features (Defer JS's and Delay JS's reports), in
 *   registry order, or empty.
 */
function simulatedFeatures(input: unknown): SimulatedFeatureId[] {
  if (!isRecord(input)) return [];
  const simulated = new Set<unknown>();
  for (const key of SIMULATION_REPORT_KEYS) {
    const simulation = ownValue(input, key);
    if (isRecord(simulation) && ownValue(simulation, 'state') === 'simulated') {
      simulated.add(ownValue(simulation, 'feature'));
    }
  }
  return SIMULATED_FEATURES.filter((row) => simulated.has(row.id)).map((row) => row.id);
}

/**
 * Summarize an untrusted `exclusionSessionUpdated` push.
 *
 * @param input The push payload.
 * @returns The tab and its summary, or null on any violation.
 */
export function parseExclusionSessionTabSummary(input: unknown): ExclusionSessionTabSummary | null {
  if (!isRecord(input)) return null;
  const tabId = numericTabId(ownValue(input, 'tabId'));
  const summary = parseExclusionSessionSummary(ownValue(input, 'status'));
  return tabId === null || summary === null ? null : { tabId, summary };
}
