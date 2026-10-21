/**
 * Why the browser ended a session, in session terms. `onDetach` carries
 * one of two reasons (Chromium `DetachReason`): `canceled_by_user` — the
 * user cancelled the "started debugging this browser" infobar (every
 * session of the extension ends) — and `target_closed`, which covers both
 * a closed tab and a tab whose page may no longer be debugged (e.g. it
 * navigated to a `chrome://` page — observed on Chromium 156), told apart
 * by what the tab is now.
 */
import type { InterceptionEndCause } from '../backend';
import type { TabPresence } from './port';

/**
 * The end cause to report, or null when nothing should be reported (the
 * tab closed: its own cleanup ends the session).
 *
 * @param reason The `onDetach` reason (untrusted: any value).
 * @param presence What the tab is now.
 */
export function endCauseOfDetach(
  reason: unknown,
  presence: TabPresence
): InterceptionEndCause | null {
  if (reason === 'canceled_by_user') return 'infobar-cancelled';
  if (presence === 'gone') return null;
  if (presence === 'elsewhere') return 'unsupported-page';
  // The tab still shows a web page: the session went away for another
  // reason (a renderer crash, or a reason this build does not know).
  return 'detached';
}

/**
 * Whether the reason needs the tab's presence to be told apart (only
 * `canceled_by_user` is decided by the reason alone).
 *
 * @param reason The `onDetach` reason.
 */
export function needsTabPresence(reason: unknown): boolean {
  return reason !== 'canceled_by_user';
}
