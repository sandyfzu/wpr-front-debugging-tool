/**
 * The document step every interception backend runs on an intercepted
 * top-level document: bytes → text (the document's own charset) → the
 * exclusion pipeline under a wall-time budget → bytes, with the outcome the
 * session records. Any failure serves the original bytes unmodified — a
 * document is never lost, half-rewritten, or held hostage by the engine.
 *
 * The engine is pure and unbounded by design (rows are operator-provided
 * regexes); the budget lives here. Running in-process, the budget is
 * enforced between pipeline steps (a step that overran is reported, its
 * output discarded); a backend that can host a worker plugs in a runner
 * that preempts a runaway step (`./transform-worker`). Both name the
 * overrunning feature.
 */
import { ExclusionValidationError } from '../exclusion-builder/errors';
import { exclusionPipelineSteps } from '../exclusion-builder/pipeline';
import type { TransformReport } from '../exclusion-builder/report';
import {
  EXCLUSION_FEATURES,
  type ExclusionFeatureId,
  type ExclusionSet
} from '../exclusion-builder/set';
import { prevalidateExclusionSet } from '../exclusion-builder/validate';
import type { ExclusionDocumentOutcome } from '../messaging/exclusion-session';
import { decodeDocument, encodeDocument } from './charset';

/**
 * The engine's wall-time budget per document (ms). Measured 2026-10-20 on
 * the local WP site's home page (84 KiB) repeated to size, five-feature
 * set: 84 KiB ≈ 1 ms, 844 KiB ≈ 14 ms, 4.1 MiB ≈ 270 ms — the budget keeps
 * ~7× headroom over a worst-case-sized document on a slower machine while
 * capping what a pathological row can add to a navigation.
 */
export const DOCUMENT_TRANSFORM_BUDGET_MS = 2_000;

/**
 * The largest body a backend buffers for rewriting (bytes). Larger bodies
 * are served unmodified as `body-unavailable` (not buffered whole) — far
 * above real HTML documents, and it bounds the background's memory.
 */
export const DOCUMENT_BODY_BYTE_LIMIT = 8 * 1024 * 1024;

/** The `rewritten` outcome. */
export type RewrittenDocumentOutcome = Extract<ExclusionDocumentOutcome, { outcome: 'rewritten' }>;

/** The outcomes that serve the document unmodified. */
export type UnmodifiedDocumentOutcome = Exclude<ExclusionDocumentOutcome, { outcome: 'rewritten' }>;

/** What one engine run over a document's text asks for. */
export interface DocumentTransformRequest {
  readonly html: string;
  readonly set: ExclusionSet;
  /** The document's absolute URL (lets URL-resolving rows match), or null. */
  readonly documentUrl: string | null;
  /** The wall-time budget (ms, positive). */
  readonly budgetMs: number;
}

/**
 * One engine run's result: the rewritten text with its reports, or the
 * unmodified outcome (with the unexpected cause, for the caller's log).
 */
export type DocumentTransformResult =
  | { readonly ok: true; readonly html: string; readonly outcome: RewrittenDocumentOutcome }
  | { readonly ok: false; readonly outcome: UnmodifiedDocumentOutcome; readonly cause?: unknown };

/**
 * Runs the engine over one document. Never rejects: every failure is a
 * `DocumentTransformResult` with `ok: false`.
 */
export type DocumentTransformRunner = (
  request: DocumentTransformRequest
) => Promise<DocumentTransformResult>;

/** The registry entry of a feature (registry-derived, never re-declared). */
function featureSpec(feature: ExclusionFeatureId) {
  return EXCLUSION_FEATURES.find((spec) => spec.id === feature);
}

/**
 * The row to blame for a feature's overrun: named only when it is
 * unambiguous — a pattern feature (regex rows are what can run away) run
 * by rows, holding exactly one row. Otherwise null (a feature-wide run,
 * several rows, or literal rows, whose matching is linear).
 *
 * @param set The set the run used.
 * @param feature The feature that overran.
 */
export function overrunRow(set: ExclusionSet, feature: ExclusionFeatureId): string | null {
  const spec = featureSpec(feature);
  if (spec === undefined || spec.rowKind !== 'pattern') return null;
  if (spec.toggleKey !== null && set.disable[spec.toggleKey]) return null;
  const rows = set.rows[spec.rowsKey];
  return rows.length === 1 ? (rows[0] ?? null) : null;
}

/**
 * The over-budget outcome for a feature.
 *
 * @param set The set the run used.
 * @param feature The feature that overran.
 * @param budgetMs The budget it overran.
 */
export function overBudgetOutcome(
  set: ExclusionSet,
  feature: ExclusionFeatureId,
  budgetMs: number
): UnmodifiedDocumentOutcome {
  return { outcome: 'over-budget', feature, row: overrunRow(set, feature), budgetMs };
}

/** The `engine-failed` outcome, carrying its cause for the log. */
function engineFailed(cause: unknown): DocumentTransformResult {
  return { ok: false, outcome: { outcome: 'failed', reason: 'engine-failed' }, cause };
}

/**
 * Run the exclusion pipeline step by step, checking the cumulative wall
 * time after each step: the step that crosses the budget is the overrun
 * (its output is discarded, nothing is served rewritten).
 *
 * @param request The text, set, document URL and budget.
 * @param now A monotonic clock (ms).
 * @param onStepStart Called with each feature as its step starts (lets a
 *   preempting host know which feature a killed run was in).
 * @returns The rewritten text and reports, or the unmodified outcome:
 *   `over-budget`, or `engine-failed` (an invalid set — the apply gate
 *   should have refused it — or an engine throw).
 */
export function runDocumentPipeline(
  request: DocumentTransformRequest,
  now: () => number,
  onStepStart?: (feature: ExclusionFeatureId) => void
): DocumentTransformResult {
  try {
    const started = now();
    const problems = prevalidateExclusionSet(request.set);
    if (!problems.valid) return engineFailed(new ExclusionValidationError(problems.invalid));
    let html = request.html;
    const reports: TransformReport[] = [];
    const steps = exclusionPipelineSteps(request.set, request.documentUrl ?? undefined);
    for (const step of steps) {
      onStepStart?.(step.id);
      const result = step.apply(html);
      if (now() - started > request.budgetMs) {
        return { ok: false, outcome: overBudgetOutcome(request.set, step.id, request.budgetMs) };
      }
      html = result.html;
      reports.push(result.report);
    }
    return { ok: true, html, outcome: { outcome: 'rewritten', reports } };
  } catch (cause) {
    return engineFailed(cause);
  }
}

/**
 * The in-process runner: {@link runDocumentPipeline} on the calling
 * thread (budget enforced between steps).
 *
 * @param now The monotonic clock; defaults to `performance.now`.
 */
export function createInProcessTransformRunner(
  now: () => number = () => performance.now()
): DocumentTransformRunner {
  return (request) => Promise.resolve(runDocumentPipeline(request, now));
}

/** One intercepted document, as a backend hands it over. */
export interface InterceptedDocumentBody {
  /** The body bytes (after any content-encoding was removed). */
  readonly body: Uint8Array;
  /** The response's `Content-Type` value (several headers joined with `, `), or null. */
  readonly contentType: string | null;
  /** The document's absolute URL, or null. */
  readonly documentUrl: string | null;
}

/**
 * The document step's result: what to record, and the bytes to serve —
 * `body: null` means serve the original bytes exactly as received (a
 * failure, or a run that changed nothing).
 */
export interface DocumentRewrite {
  readonly outcome: ExclusionDocumentOutcome;
  readonly body: Uint8Array | null;
  /** The unexpected cause behind an `engine-failed` outcome, for the caller's log. */
  readonly cause?: unknown;
}

/** The `decode-failed` rewrite (the body cannot round-trip its charset). */
const DECODE_FAILED: DocumentRewrite = {
  outcome: { outcome: 'failed', reason: 'decode-failed' },
  body: null
};

/**
 * Rewrite one intercepted document: guard the size, decode in its charset,
 * run the engine through `runner`, re-encode in the same charset.
 *
 * @param document The intercepted body, its content type and URL.
 * @param set The session's exclusion set.
 * @param runner The engine runner (in-process or preempting).
 * @param budgetMs The engine budget; defaults to {@link DOCUMENT_TRANSFORM_BUDGET_MS}.
 * @returns The outcome and the bytes to serve. Never rejects: an oversized
 *   body is `body-unavailable`, a body that cannot round-trip its charset
 *   (unsupported encoding, malformed bytes, an unencodable result) is
 *   `decode-failed`, an engine overrun `over-budget`, anything else the
 *   engine or runner throws `engine-failed` — all served unmodified.
 */
export async function rewriteDocument(
  document: InterceptedDocumentBody,
  set: ExclusionSet,
  runner: DocumentTransformRunner,
  budgetMs: number = DOCUMENT_TRANSFORM_BUDGET_MS
): Promise<DocumentRewrite> {
  if (document.body.length > DOCUMENT_BODY_BYTE_LIMIT) {
    return { outcome: { outcome: 'failed', reason: 'body-unavailable' }, body: null };
  }
  const decoded = decodeDocument(document.body, document.contentType);
  if (!decoded.ok) return DECODE_FAILED;
  let result: DocumentTransformResult;
  try {
    result = await runner({ html: decoded.text, set, documentUrl: document.documentUrl, budgetMs });
  } catch (cause) {
    // A runner must never reject; one that does is an engine failure.
    result = engineFailed(cause);
  }
  if (!result.ok) {
    return result.cause === undefined
      ? { outcome: result.outcome, body: null }
      : { outcome: result.outcome, body: null, cause: result.cause };
  }
  if (result.html === decoded.text) return { outcome: result.outcome, body: null };
  const encoded = encodeDocument(result.html, decoded.codec);
  return encoded === null ? DECODE_FAILED : { outcome: result.outcome, body: encoded };
}
