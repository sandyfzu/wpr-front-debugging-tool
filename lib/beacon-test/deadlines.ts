/**
 * Every time bound of one beacon test, single-sourced so each waiting side
 * outlasts the side it waits on: the runner load and the run itself (both
 * bounded by the page), then the panel's wait on the page.
 */

/**
 * The run's outer bound (ms). Past it the page answers `timed-out` with what
 * the beacon collected so far and stops the beacon's own watchdog (its
 * synchronous scans cannot be interrupted). Above the beacon's own 10 s
 * watchdog, so a run the watchdog ends still ends on its own.
 */
export const BEACON_RUN_TIMEOUT_MS = 15_000;

/** The page's wait (ms) on the background injecting the runner. */
export const BEACON_RUNNER_LOAD_DEADLINE_MS = 10_000;

/** Slack (ms) the panel adds for the message hops. */
export const BEACON_HOP_GRACE_MS = 5_000;

/** The panel's wait (ms) on a run: the runner load, the run, and the hops. */
export const BEACON_TEST_ASK_DEADLINE_MS =
  BEACON_RUNNER_LOAD_DEADLINE_MS + BEACON_RUN_TIMEOUT_MS + BEACON_HOP_GRACE_MS;
