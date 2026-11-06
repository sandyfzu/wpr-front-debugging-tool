/**
 * The LCP analysis's time bounds, single-sourced: the page's wait for the
 * buffered entries, the highlight's life, and the panel's wait on the page.
 */

/**
 * How long (ms) the page waits for buffered LCP entries the observer did not
 * hand over at once. Chromium hands them over synchronously; an engine that
 * delivers them in a later task gets this long — a page with no LCP entry
 * at all answers no candidates after it.
 */
export const LCP_BUFFER_WAIT_MS = 500;

/** How long (ms) an asked highlight frames the LCP element. */
export const LCP_HIGHLIGHT_MS = 5_000;

/** The panel's wait (ms) on an analysis: the buffer wait, the highlight's mount, the hops. */
export const LCP_ANALYSIS_ASK_DEADLINE_MS = 5_000;
