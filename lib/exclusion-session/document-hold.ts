/**
 * How long a session document can be held and its record still land, in a
 * module of its own: the background's time table (`timeouts`) builds on
 * these values, and the in-page overlay reads {@link documentRecordWaitMs}
 * without pulling that table's imports (set limits, regex analysis) in.
 */
import { DOCUMENT_TRANSFORM_BUDGET_MS } from './engine-budget';

/** One wait on the wake re-validation before an ask or document proceeds (ms). */
export const READY_WAIT_MS = 1_000;

/** One session-store or saved-set read/write (ms). */
export const STORE_STEP_MS = 500;

/** A runner's overhead past the engine budget (ms): messaging, a worker spawn. */
export const RUNNER_OVERHEAD_MS = 1_000;

/** How long a recording host call waits for its record (ms; it still lands after). */
export const RECORD_STEP_MS = 2_000;

/**
 * The packaged simulation data's first read in a background lifetime (a
 * ~20 KB extension file: fetch, parse, hash — milliseconds), then a memory
 * read (ms).
 */
export const SIMULATION_RUNTIME_READ_MS = 1_000;

/**
 * The synchronous CPU a document's simulation preparation spends outside
 * its sources (version selection, contract checks — a linear scan; ~58 ms
 * measured on a 4 MiB page), with ≥ 10× headroom for slower machines — a
 * bound, not a timeout.
 */
export const SIMULATION_PREPARATION_CPU_BOUND_MS = 600;

/**
 * The longest a document's simulation host work takes (ms): every source
 * deadline — the runtime read, then the list, the marker id and the
 * marker's settling (one store step each) — + its CPU.
 */
export const SIMULATION_PREPARATION_BOUND_MS =
  SIMULATION_RUNTIME_READ_MS + 3 * STORE_STEP_MS + SIMULATION_PREPARATION_CPU_BOUND_MS;

/**
 * The host's rewrite bound for a session that does not simulate (ms): wake
 * wait + session read + engine budget + runner overhead + the post-run
 * session re-check.
 */
export const REWRITE_DOCUMENT_BOUND_MS =
  READY_WAIT_MS + 2 * STORE_STEP_MS + DOCUMENT_TRANSFORM_BUDGET_MS + RUNNER_OVERHEAD_MS;

/**
 * The bound (ms) a document's `rewriteDocument` resolves within: the
 * declared host bound, plus the simulation preparation only for a session
 * that simulates — a session that does not keeps the exclusions-only bound.
 *
 * @param simulates Whether the document's session simulates WP Rocket.
 */
export function rewriteDocumentBoundMs(simulates: boolean): number {
  return simulates
    ? REWRITE_DOCUMENT_BOUND_MS + SIMULATION_PREPARATION_BOUND_MS
    : REWRITE_DOCUMENT_BOUND_MS;
}

/**
 * Streaming backends: how long a complete body waits for a final status in
 * the response facts (ms) before it is written through — the facts hook
 * normally runs before the body starts (verified in Firefox with a blocking
 * headers listener).
 */
export const STREAM_FACTS_WAIT_MS = 1_000;

/**
 * Streaming backends: how long a complete body waits for its request's
 * network completion (or failure) before it is trusted anyway (ms). The
 * completion normally lands within milliseconds of the body's end (or
 * before it); late arrivals were observed at a cold start (completion
 * 238 ms after) and under load (a truncation's failure 60 ms after) — the
 * wait costs latency only when the signal is late.
 */
export const STREAM_SETTLE_WAIT_MS = 1_000;

/**
 * Streaming backends: how far a stream's own release deadline sits past
 * the host's rewrite bound (ms) — past it the original bytes are served
 * whatever the host still does.
 */
export const STREAM_RELEASE_MARGIN_MS = 500;

/**
 * Streaming backends: the longest a top-level document is held (ms) —
 * settle wait, then the late-facts wait, then the release deadline (armed
 * only once the body is settled, so settling never eats into the host's
 * rewrite bound).
 *
 * @param rewriteBoundMs The document's host rewrite bound ({@link rewriteDocumentBoundMs}).
 */
export function streamHoldWorstCaseMs(rewriteBoundMs: number): number {
  return STREAM_SETTLE_WAIT_MS + STREAM_FACTS_WAIT_MS + rewriteBoundMs + STREAM_RELEASE_MARGIN_MS;
}

/**
 * The Chromium backend: how far a document's release deadline sits past the
 * host's rewrite bound (ms) — past it, the original is served.
 */
export const CHROMIUM_RELEASE_MARGIN_MS = 1_000;

/**
 * The Chromium backend's release deadline (ms) of one document's host
 * rewrite: its gate's granted bound plus {@link CHROMIUM_RELEASE_MARGIN_MS}
 * — so a session that does not simulate keeps the exclusions-only deadline.
 *
 * @param rewriteBoundMs The host's rewrite bound for the document (its grant).
 */
export function chromiumReleaseMs(rewriteBoundMs: number): number {
  return rewriteBoundMs + CHROMIUM_RELEASE_MARGIN_MS;
}

/**
 * How long a session page's record may still land after the page loaded
 * (ms): the longer backend hold (Chromium's release deadline or a stream's
 * worst case) over its rewrite bound, then the record's own write (a page
 * served past its bound is recorded once the host's work ends). Past it, a
 * page loaded through the session without a record never gets one — its
 * overlay says so instead of waiting.
 *
 * @param simulates Whether the session simulates WP Rocket (a longer bound).
 */
export function documentRecordWaitMs(simulates: boolean): number {
  const bound = rewriteDocumentBoundMs(simulates);
  return Math.max(chromiumReleaseMs(bound), streamHoldWorstCaseMs(bound)) + RECORD_STEP_MS;
}
