/**
 * Every time bound of one RUCSS test, single-sourced so each waiting side
 * outlasts the side it waits on: the background's request budget, then the
 * content script's wait on the background, then the panel's wait on the
 * content script — each with a grace for the message hops.
 */

/**
 * The service request's budget (ms), body read included. The service
 * answers slowly: 5–54 s per request measured (54 s for a page it could not
 * reach). Chromium ends an extension service worker whose `fetch` response
 * takes longer than 30 s unless an extension API call resets that timer, so
 * the background keeps itself alive while a request waits
 * ({@link RUCSS_KEEP_ALIVE_INTERVAL_MS}).
 */
export const RUCSS_FETCH_TIMEOUT_MS = 90_000;

/**
 * How often (ms) the background calls a trivial extension API while a
 * service request waits: under Chromium's 30 s limits (idle, and a `fetch`
 * waiting for its response), which each such call resets.
 */
export const RUCSS_KEEP_ALIVE_INTERVAL_MS = 20_000;

/** Slack (ms) each waiting side adds for the message hops in between. */
export const RUCSS_HOP_GRACE_MS = 5_000;

/** The content script's wait (ms) on the background's request. */
export const RUCSS_FETCH_ASK_DEADLINE_MS = RUCSS_FETCH_TIMEOUT_MS + RUCSS_HOP_GRACE_MS;

/**
 * The page-thread budget (ms) of judging the page's inline styles against
 * the preserve markers (substring checks: markers × inline CSS — thousands
 * of markers over megabytes of inline CSS take minutes). Past it the start
 * fails, the page untouched.
 */
export const RUCSS_INLINE_CHECK_BUDGET_MS = 5_000;

/**
 * The longest stretch (ms) of that judging before the page gets its thread
 * back (one marker check over one style may run past it).
 */
export const RUCSS_INLINE_CHECK_SLICE_MS = 10;

/**
 * The longest wait (ms) for one hand-back of the page's thread: a turn that
 * never comes (a message port that never delivers) ends on this timer.
 */
export const RUCSS_INLINE_CHECK_YIELD_FALLBACK_MS = 50;

/** The panel's wait (ms) on a start (the request, then the style snapshot). */
export const RUCSS_START_DEADLINE_MS =
  RUCSS_FETCH_ASK_DEADLINE_MS + RUCSS_INLINE_CHECK_BUDGET_MS + RUCSS_HOP_GRACE_MS;

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

/**
 * The panel's longest wait on one run (ms): its sequential bounds — the
 * start (service request + style snapshot), the build, then the apply. The
 * settings read before them is a local storage read, not a bounded wait.
 */
export const RUCSS_RUN_WORST_CASE_MS =
  RUCSS_START_DEADLINE_MS + RUCSS_BUILD_TIMEOUT_MS + RUCSS_APPLY_DEADLINE_MS;
