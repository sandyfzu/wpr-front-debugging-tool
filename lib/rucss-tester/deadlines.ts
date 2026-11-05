/**
 * Every time bound of one RUCSS test, single-sourced so each waiting side
 * outlasts the side it waits on: the background's request budget, then the
 * content script's wait on the background, then the panel's wait on the
 * content script — each with a grace for the message hops.
 */

/**
 * The service request's budget (ms), body read included. Below 30 s on
 * purpose: Chromium ends an extension service worker whose `fetch` response
 * takes longer than that, which would surface as a lost answer instead of a
 * typed `timeout`.
 */
export const RUCSS_FETCH_TIMEOUT_MS = 25_000;

/** Slack (ms) each waiting side adds for the message hops in between. */
export const RUCSS_HOP_GRACE_MS = 5_000;

/** The content script's wait (ms) on the background's request. */
export const RUCSS_FETCH_ASK_DEADLINE_MS = RUCSS_FETCH_TIMEOUT_MS + RUCSS_HOP_GRACE_MS;

/** The panel's wait (ms) on a start (the request plus the style snapshot). */
export const RUCSS_START_DEADLINE_MS = RUCSS_FETCH_ASK_DEADLINE_MS + RUCSS_HOP_GRACE_MS;

/** The panel's wait (ms) on an apply (style removal and injection: synchronous DOM work). */
export const RUCSS_APPLY_DEADLINE_MS = 10_000;

/**
 * The budget (ms) of judging the stylesheet URLs and building the CSS with
 * the user's patterns. Past it the work is stopped (its worker terminated)
 * and the run fails with the page untouched: a catastrophic pattern can
 * otherwise run for minutes.
 */
export const RUCSS_BUILD_TIMEOUT_MS = 10_000;

/**
 * How long (ms) a start's style snapshot waits for its apply: the build's
 * budget, the panel's apply wait and the hop grace — so it outlasts every
 * apply the panel still waits on. Past it the snapshot (live references to
 * page elements) is dropped and a late apply answers `stale-run`.
 */
export const RUCSS_SNAPSHOT_TTL_MS =
  RUCSS_BUILD_TIMEOUT_MS + RUCSS_APPLY_DEADLINE_MS + RUCSS_HOP_GRACE_MS;
