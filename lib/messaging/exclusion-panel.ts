/**
 * The devtools panel's side of the exclusion-session contract: the open
 * outcomes of `openExclusionOverlay` and a summary parse of the session
 * status (its state and, when active, its origin). Kept apart from the
 * full contract (`./exclusion-session`: sets, reports, served identities)
 * so the panel validates exactly what it reads without bundling the rest —
 * a tolerant read: every other field of a status is ignored.
 */
import { numericTabId } from './sender';
import { isHttpOrigin } from '../../utils/urls';

/**
 * How opening the builder overlay on a tab ended (the background injects
 * it into the tab's top frame):
 * - `injected` — the overlay script was injected (it owns its states from there),
 * - `unsupported-page` — the browser does not let extensions script the page,
 * - `tab-gone` — the tab closed first,
 * - `failed` — anything else (logged by the background).
 */
export const EXCLUSION_OVERLAY_OPEN_OUTCOMES = [
  'injected',
  'unsupported-page',
  'tab-gone',
  'failed'
] as const;

/** One open outcome (see {@link EXCLUSION_OVERLAY_OPEN_OUTCOMES}). */
export type ExclusionOverlayOpenOutcome = (typeof EXCLUSION_OVERLAY_OPEN_OUTCOMES)[number];

/** A session's state, as a status display reads it. */
export type ExclusionSessionSummary =
  | { readonly state: 'inactive' }
  | { readonly state: 'active'; readonly origin: string }
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

/** A plain object (not an array). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An own property's value; inherited ones read as absent. */
function own(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * Summarize an untrusted session status.
 *
 * @param input A status (an ask's answer, or a push's `status`).
 * @returns The summary, or null when the state is unknown or an active
 *   session names no canonical http(s) origin.
 */
export function parseExclusionSessionSummary(input: unknown): ExclusionSessionSummary | null {
  if (!isObject(input)) return null;
  const state = own(input, 'state');
  if (state === 'inactive' || state === 'unavailable') return { state };
  if (state !== 'active') return null;
  const origin = own(input, 'origin');
  return typeof origin === 'string' && isHttpOrigin(origin) ? { state, origin } : null;
}

/**
 * Summarize an untrusted `exclusionSessionUpdated` push.
 *
 * @param input The push payload.
 * @returns The tab and its summary, or null on any violation.
 */
export function parseExclusionSessionTabSummary(input: unknown): ExclusionSessionTabSummary | null {
  if (!isObject(input)) return null;
  const tabId = numericTabId(own(input, 'tabId'));
  const summary = parseExclusionSessionSummary(own(input, 'status'));
  return tabId === null || summary === null ? null : { tabId, summary };
}
