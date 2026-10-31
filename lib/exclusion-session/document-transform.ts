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
import type {
  DocumentSimulationInput,
  SimulationCspHeader
} from '../messaging/exclusion-simulation';
import {
  SIMULATED_FEATURES,
  type SimulatedFeatureId,
  type SimulationStage
} from '../wp-rocket-simulation/spec';
import { decodeDocument, encodeDocument, extractMimeType } from './charset';
import type { MarkerSettler, SimulationPreparer } from './simulation-sources';
import { simulationStage } from './simulation-stage';
import { removeSpeculationRules } from './speculation-rules';
import { DOCUMENT_TRANSFORM_BUDGET_MS } from './engine-budget';

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
  /** What to simulate before the exclusions, with its packaged inputs (absent: nothing). */
  readonly simulate?: DocumentSimulationInput;
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
 * @param stage `simulate` when the overrun was the feature's simulation
 *   step — feature-wide, so it names no row.
 */
export function overBudgetOutcome(
  set: ExclusionSet,
  feature: ExclusionFeatureId,
  budgetMs: number,
  stage?: SimulationStage
): UnmodifiedDocumentOutcome {
  return stage === undefined
    ? { outcome: 'over-budget', feature, row: overrunRow(set, feature), budgetMs }
    : { outcome: 'over-budget', feature, row: null, budgetMs, stage };
}

/** The `engine-failed` result, carrying its cause for the log (every runner's one builder). */
export function engineFailed(cause: unknown): DocumentTransformResult {
  return { ok: false, outcome: { outcome: 'failed', reason: 'engine-failed' }, cause };
}

/** Called as each step starts: its feature, and `stage` for a simulation step. */
export type StepStartListener = (feature: ExclusionFeatureId, stage?: SimulationStage) => void;

/**
 * Run the exclusion pipeline (`runExclusionPipeline`) — after the
 * request's simulation steps when it simulates — checking the cumulative
 * wall time after each step: the step that crosses the budget is the
 * overrun (its output is discarded, nothing is served rewritten; a
 * simulation step's overrun names `stage: 'simulate'`). A run within the
 * budget ends with the marker steps.
 *
 * @param request The text, set, budget, decoding facts and simulation input.
 * @param now A monotonic clock (ms).
 * @param onStepStart Called with each feature (and stage) as its step
 *   starts (lets a preempting host know which step a killed run was in).
 * @returns The rewritten text and reports (with the simulation's report
 *   when the request simulates), or the unmodified outcome: `over-budget`,
 *   or `engine-failed` (an invalid set — the apply gate should have
 *   refused it — or an engine throw).
 */
export function runDocumentPipeline(
  request: DocumentTransformRequest,
  now: () => number,
  onStepStart?: StepStartListener
): DocumentTransformResult {
  try {
    const started = now();
    // An invalid set throws (the apply gate should have refused it): engine-failed below.
    const run = runExclusionPipeline(request.html, request.set, {
      ...(request.bytes === undefined ? {} : { bytes: request.bytes }),
      ...(onStepStart === undefined ? {} : { onStepStart }),
      stopAfter: () => now() - started > request.budgetMs,
      ...(request.simulate === undefined
        ? {}
        : { pre: simulationStage(request.simulate, request.bytes, request.set.rows.deferJs) })
    });
    if (!run.completed) {
      return {
        ok: false,
        outcome: overBudgetOutcome(request.set, run.stoppedAt, request.budgetMs, run.stage)
      };
    }
    // One report per simulated feature, each in its own outcome field.
    const simulation = run.simulation?.find((report) => report.feature === 'delay_js');
    const deferSimulation = run.simulation?.find((report) => report.feature === 'defer_all_js');
    const lazyloadSimulation = run.simulation?.find((report) => report.feature === 'lazyload');
    // The marker steps ran after the last budget check, unbudgeted: linear
    // scans; only a preempting runner's deadline bounds them.
    return {
      ok: true,
      html: run.html,
      outcome: {
        outcome: 'rewritten',
        reports: run.reports,
        ...(simulation === undefined ? {} : { simulation }),
        ...(deferSimulation === undefined ? {} : { deferSimulation }),
        ...(lazyloadSimulation === undefined ? {} : { lazyloadSimulation })
      }
    };
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
  /**
   * The response's Content Security Policy header lines (enforcing and
   * report-only), as received — absent when it has none (every backend
   * reads the response headers).
   */
  readonly cspHeaders?: readonly SimulationCspHeader[];
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

/** Media types (essences) a browser renders in the tab rather than downloading. */
const INLINE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'application/xhtml+xml',
  'application/xml',
  'application/json',
  'application/pdf'
]);

/**
 * `+xml` types a browser may download instead of rendering: Firefox hands
 * feeds (e.g. WordPress `/feed/`) to the download manager, so following a
 * feed link must never record against the page still shown.
 */
const DOWNLOADED_XML_TYPES: ReadonlySet<string> = new Set([
  'application/rss+xml',
  'application/atom+xml'
]);

/** Top-level types a browser renders in the tab (`text/*`, `image/*`, …). */
const INLINE_TOP_LEVEL_TYPES: ReadonlySet<string> = new Set(['text', 'image', 'audio', 'video']);

/**
 * Whether a `Content-Type` value names a type the browser renders in the
 * tab: `text/*`, `image/*`, `audio/*`, `video/*`, `+xml` (feeds excepted),
 * XML, JSON or PDF. A missing or unparsable type is not counted: the browser sniffs the
 * bytes then (an archive becomes a download), and nothing else known before
 * the release tells which — an unrecorded page reads "no result", a wrong
 * record would overwrite the visible page's.
 *
 * @param contentType The header value, or null when absent.
 */
export function rendersInline(contentType: string | null): boolean {
  const essence = extractMimeType(contentType)?.essence;
  if (essence === undefined) return false;
  if (DOWNLOADED_XML_TYPES.has(essence)) return false;
  if (INLINE_MEDIA_TYPES.has(essence) || essence.endsWith('+xml')) return true;
  return INLINE_TOP_LEVEL_TYPES.has(essence.slice(0, essence.indexOf('/')));
}

/**
 * Whether a top-level response the engine does not rewrite still becomes
 * the tab's page when served as it is — so a session records it (the
 * page's overlay would otherwise wait for a record that never comes). Not:
 * a 1xx or 3xx (a redirect's next hop is the page), 204/205 (the current
 * page stays), `HEAD`, a download (`Content-Disposition: attachment`), or
 * a type the browser does not render inline ({@link rendersInline} — e.g. a
 * zip, which the browser downloads without any disposition).
 * A 304 never reaches here alone (the cached response is what is paused).
 *
 * @param response The final status, the method, the response's
 *   `Content-Disposition` and `Content-Type` (null when absent).
 */
export function rendersAsPage(response: {
  readonly status: number;
  readonly method: string;
  readonly disposition: string | null;
  readonly contentType: string | null;
}): boolean {
  const { status, method, disposition, contentType } = response;
  if (!Number.isInteger(status) || status < 200 || status > 599) return false;
  if ((status >= 300 && status <= 399) || status === 204 || status === 205) return false;
  if (method.toUpperCase() === 'HEAD') return false;
  // RFC 6266: the disposition type comes first, case-insensitive.
  if (disposition !== null && /^\s*attachment\s*(?:;|$)/i.test(disposition)) return false;
  return rendersInline(contentType);
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
 * The features whose report names the marker the run wrote, in registry
 * order (empty: no marker written).
 *
 * @param outcome The run's `rewritten` outcome.
 */
export function markedFeatures(outcome: RewrittenDocumentOutcome): SimulatedFeatureId[] {
  const reports = [outcome.lazyloadSimulation, outcome.deferSimulation, outcome.simulation];
  return SIMULATED_FEATURES.map(({ id }) => id).filter((id) =>
    reports.some((report) => report?.feature === id && report.markerId !== undefined)
  );
}

/**
 * After a run that wrote a marker, narrow its memo entry to the features
 * that simulated (only when they differ from the requested ones).
 *
 * @param input The run's simulation input.
 * @param result The run's result.
 * @param settle The session's marker settler.
 * @throws Whatever the settler rejects with.
 */
async function settleMarker(
  input: DocumentSimulationInput,
  result: DocumentTransformResult,
  settle: MarkerSettler
): Promise<void> {
  if (!result.ok || input.markerId === undefined) return;
  const marked = markedFeatures(result.outcome);
  const requested = new Set(input.features);
  const narrowed = marked.length < requested.size || marked.some((id) => !requested.has(id));
  if (marked.length > 0 && narrowed) await settle(input.markerId, marked);
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
 * @param simulate The session's simulation preparer (absent: nothing
 *   simulated). A document it cannot give a runtime for is
 *   `runtime-unavailable` (served without exclusions, never simulated
 *   without one); a preparer that throws is `engine-failed`.
 * @param settle The session's marker settler, run after a simulating run
 *   whose marker names fewer features than requested, before the document
 *   is released; one that rejects is `engine-failed`.
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
  budgetMs: number = DOCUMENT_TRANSFORM_BUDGET_MS,
  simulate?: SimulationPreparer,
  settle?: MarkerSettler
): Promise<DocumentRewrite> {
  if (document.body.length > DOCUMENT_BODY_BYTE_LIMIT) {
    return { outcome: { outcome: 'failed', reason: 'body-unavailable' }, body: null };
  }
  const decoded = decodeDocument(document.body, document.contentType);
  if (!decoded.ok) return DECODE_FAILED;
  let result: DocumentTransformResult;
  try {
    const bytes = { encoding: decoded.codec.encoding, bom: decoded.codec.bom.length > 0 };
    const prepared = simulate === undefined ? undefined : await simulate(decoded.text);
    result =
      prepared?.ok === false
        ? { ok: false, outcome: { outcome: 'runtime-unavailable', cause: prepared.cause } }
        : await runner({
            html: decoded.text,
            set,
            budgetMs,
            bytes,
            ...(prepared === undefined ? {} : { simulate: prepared.input })
          });
    if (prepared?.ok === true && settle !== undefined) {
      await settleMarker(prepared.input, result, settle);
    }
  } catch (cause) {
    // A runner (or preparer) must never reject; one that does is an engine failure.
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
