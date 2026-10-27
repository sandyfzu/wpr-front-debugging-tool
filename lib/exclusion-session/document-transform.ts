/**
 * The document step every interception backend runs on an intercepted
 * top-level document: bytes → text (the document's own charset) → the
 * exclusion pipeline under a wall-time budget → bytes, with the outcome the
 * session records. Any failure serves the original bytes unmodified — a
 * document is never lost, half-rewritten, or held hostage by the engine.
 *
 * The engine is pure and unbounded by design (rows are operator-provided
 * regexes); the budget lives here. Running in-process, the budget is
 * checked between pipeline steps — it detects, never interrupts: a slow
 * step runs to completion (blocking the thread) before it is reported and
 * its output discarded. A backend that can host a worker plugs in a runner
 * that preempts a runaway step (`./transform-worker`). Both name the
 * overrunning feature.
 */
import { runExclusionPipeline } from '../exclusion-builder/pipeline';
import type { DocumentBytes } from '../exclusion-builder/libxml/charset';
import {
  EXCLUSION_FEATURES,
  type ExclusionFeatureId,
  type ExclusionSet
} from '../exclusion-builder/set';
import type { ExclusionDocumentOutcome } from '../messaging/exclusion-session';
import { decodeDocument, encodeDocument, extractMimeType } from './charset';
import { removeSpeculationRules } from './speculation-rules';

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
  /** The wall-time budget (ms, positive). */
  readonly budgetMs: number;
  /** How the text was decoded from the served bytes, when known. */
  readonly bytes?: DocumentBytes;
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

/** The `engine-failed` result, carrying its cause for the log (every runner's one builder). */
export function engineFailed(cause: unknown): DocumentTransformResult {
  return { ok: false, outcome: { outcome: 'failed', reason: 'engine-failed' }, cause };
}

/**
 * Run the exclusion pipeline (`runExclusionPipeline`), checking the cumulative wall
 * time after each step: the step that crosses the budget is the overrun
 * (its output is discarded, nothing is served rewritten). A run within the
 * budget ends with the builder marker step.
 *
 * @param request The text, set, budget and decoding facts.
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
    // An invalid set throws (the apply gate should have refused it): engine-failed below.
    const run = runExclusionPipeline(request.html, request.set, {
      ...(request.bytes === undefined ? {} : { bytes: request.bytes }),
      ...(onStepStart === undefined ? {} : { onStepStart }),
      stopAfter: () => now() - started > request.budgetMs
    });
    if (!run.completed) {
      return {
        ok: false,
        outcome: overBudgetOutcome(request.set, run.stoppedAt, request.budgetMs)
      };
    }
    // The marker step ran after the last budget check, unbudgeted: one
    // linear scan; only a preempting runner's deadline bounds it.
    return { ok: true, html: run.html, outcome: { outcome: 'rewritten', reports: run.reports } };
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
}

/**
 * The document step's result: what to record, and the bytes to serve —
 * `body: null` means serve the original bytes exactly as received (nothing
 * changed: no exclusion applied and no speculation rule to remove, or the
 * body could not be decoded).
 */
export interface DocumentRewrite {
  readonly outcome: ExclusionDocumentOutcome;
  readonly body: Uint8Array | null;
  /** Speculation-rule scripts removed from the served bytes (absent when none). */
  readonly speculationRulesRemoved?: number;
  /**
   * Present (true) when the bytes differ from the original only by the
   * removed rule scripts — the exclusions changed nothing (a backend that
   * serves a substituted copy then serves the original instead).
   */
  readonly rulesOnly?: true;
  /** The unexpected cause behind an `engine-failed` outcome, for the caller's log. */
  readonly cause?: unknown;
}

/** The `decode-failed` rewrite (the body cannot be decoded in its charset). */
const DECODE_FAILED: DocumentRewrite = {
  outcome: { outcome: 'failed', reason: 'decode-failed' },
  body: null
};

/** The `encode-failed` rewrite (the rewritten text cannot be encoded back into that charset). */
const ENCODE_FAILED: DocumentRewrite = {
  outcome: { outcome: 'failed', reason: 'encode-failed' },
  body: null
};

/** The response facts the rewrite eligibility policy reads. */
export interface InterceptedResponseFacts {
  /** The final HTTP status code. */
  readonly status: number;
  /** The request method (e.g. `GET`). */
  readonly method: string;
  /** The response's `Content-Type` value (several headers joined with `, `), or null. */
  readonly contentType: string | null;
}

/**
 * Final statuses whose body is not a whole document to rewrite: 204/205/304
 * carry none (RFC 9110 §15.3.5, §15.3.6, §15.4.5); 206 carries a fragment
 * whose `Content-Range` a rewrite would break (§15.3.7).
 */
const NON_DOCUMENT_STATUSES: ReadonlySet<number> = new Set([204, 205, 206, 304]);

/**
 * Whether an intercepted top-level response is one the engine may rewrite —
 * the one policy every backend and the host apply before any body is read
 * or decoded. Everything else passes through untouched and unrecorded.
 *
 * - MIME essence (Fetch "extract a MIME type", case-insensitive) exactly
 *   `text/html`. Not `application/xhtml+xml`: the engine is an HTML-
 *   tokenizer string transformer, and an XML document is parsed
 *   draconianly — one edit that is fine as HTML (an unquoted attribute, a
 *   void tag) turns the whole page into a parse error. A missing or
 *   unparsable type is not rewritten (the browser sniffs it; guessing HTML
 *   could corrupt a non-HTML body).
 * - A final status with a whole body: 200–599 minus 204/205/206/304 and every 3xx
 *   (a redirect's body is never rendered). 4xx/5xx HTML is rewritten: it is
 *   the page the site really renders (e.g. a themed 404), with the same
 *   optimized markup a session tests.
 * - Not `HEAD` (no body; methods compared ASCII-case-insensitively, as
 *   Fetch normalizes them).
 *
 * @param response The status, method and content type.
 */
export function isRewritableResponse(response: InterceptedResponseFacts): boolean {
  const { status, method, contentType } = response;
  if (!Number.isInteger(status) || status < 200 || status > 599) return false;
  if ((status >= 300 && status <= 399) || NON_DOCUMENT_STATUSES.has(status)) return false;
  if (method.toUpperCase() === 'HEAD') return false;
  return extractMimeType(contentType)?.essence === 'text/html';
}

/** The text served for a run, its rules removed, encoded — or null when it equals the original. */
function servedBytes(
  text: string,
  original: string,
  codec: Parameters<typeof encodeDocument>[1]
): { readonly body: Uint8Array | null; readonly removed: number; readonly unencodable: boolean } {
  const rules = removeSpeculationRules(text);
  if (rules.html === original) return { body: null, removed: 0, unencodable: false };
  const body = encodeDocument(rules.html, codec);
  return body === null
    ? { body: null, removed: 0, unencodable: true }
    : { body, removed: rules.removed, unencodable: false };
}

/**
 * Rewrite one intercepted document: guard the size, decode in its charset,
 * run the engine through `runner`, remove the document's speculation rules
 * (a session effect, applied whatever the engine did — see
 * `./speculation-rules`), re-encode in the same charset.
 *
 * @param document The intercepted body and its content type.
 * @param set The session's exclusion set.
 * @param runner The engine runner (in-process or preempting).
 * @param budgetMs The engine budget; defaults to {@link DOCUMENT_TRANSFORM_BUDGET_MS}.
 * @returns The outcome and the bytes to serve. Never rejects: an oversized
 *   body is `body-unavailable` and a body that cannot be decoded in its
 *   charset (unsupported encoding, malformed bytes) `decode-failed` — both
 *   served exactly as received; an engine overrun is `over-budget`,
 *   anything else the engine or runner throws `engine-failed`, and a
 *   rewrite that cannot be encoded back into the charset `encode-failed` —
 *   each served without exclusions (the original text, minus its
 *   speculation rules). Eligibility ({@link isRewritableResponse}) is the
 *   caller's, checked before.
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
    const bytes = { encoding: decoded.codec.encoding, bom: decoded.codec.bom.length > 0 };
    result = await runner({
      html: decoded.text,
      set,
      budgetMs,
      bytes
    });
  } catch (cause) {
    // A runner must never reject; one that does is an engine failure.
    result = engineFailed(cause);
  }
  let outcome: ExclusionDocumentOutcome = result.outcome;
  let served = {
    ...servedBytes(result.ok ? result.html : decoded.text, decoded.text, decoded.codec),
    fellBack: false
  };
  if (served.unencodable) {
    // The engine's text holds what the charset cannot encode: serve the
    // original (every char of it round-trips) without its rules.
    outcome = ENCODE_FAILED.outcome;
    served = { ...servedBytes(decoded.text, decoded.text, decoded.codec), fellBack: true };
  }
  const exclusionsChanged = result.ok && !served.fellBack && result.html !== decoded.text;
  return {
    outcome,
    body: served.body,
    ...(served.removed > 0 && { speculationRulesRemoved: served.removed }),
    ...(served.body !== null && !exclusionsChanged && { rulesOnly: true as const }),
    ...(!result.ok && result.cause !== undefined && { cause: result.cause })
  };
}
