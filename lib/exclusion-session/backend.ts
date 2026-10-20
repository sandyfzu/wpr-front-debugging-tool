/**
 * The interception-backend seam: what a per-browser backend (one that can
 * rewrite a tab's top-level documents before parse) implements, what the
 * session controller hands it back ({@link InterceptionHost}), and the
 * registry row the background selects one by. Session semantics (the
 * state machine, stores, pushes, the document step, charsets, budgets)
 * are backend-agnostic and live outside the backend; a backend only arms,
 * disarms, resumes, intercepts, and reports.
 */
import type { InterceptionUnavailableCause } from '../messaging/exclusion-session';
import type { DocumentTransformRunner, InterceptedDocumentBody } from './document-transform';

/** Why arming failed — every cause but the live-session cap (the controller's own check). */
export type ArmUnavailableCause = Exclude<InterceptionUnavailableCause, 'session-limit'>;

/** What arming a tab produced. */
export type ArmResult =
  { readonly armed: true } | { readonly armed: false; readonly cause: ArmUnavailableCause };

/**
 * Why the browser ended a live interception under its session — e.g.
 * `infobar-cancelled` (the user cancelled the debugging infobar),
 * `detached` (the target went away: renderer crash, another client took
 * over), `unsupported-page` (the tab left http(s)).
 */
export type InterceptionEndCause = Exclude<
  InterceptionUnavailableCause,
  'session-limit' | 'unsupported-browser'
>;

/** One intercepted top-level document of a tab. */
export interface InterceptedDocument extends InterceptedDocumentBody {
  readonly tabId: number;
  /** The document's absolute URL (the session's origin gate reads it). */
  readonly documentUrl: string;
}

/**
 * The controller side a backend calls. Every method resolves (never
 * rejects) and is safe to call for any tab — a tab without an active
 * session is answered "do nothing". A backend must not await these from
 * inside {@link InterceptionBackend.resume} (the host waits for the wake
 * re-validation that `resume` is part of).
 */
export interface InterceptionHost {
  /**
   * Whether the tab's next top-level document should be intercepted: an
   * active session whose origin is the document's. The per-navigation gate
   * for backends that choose per request (e.g. a streaming filter).
   */
  shouldIntercept(tabId: number, documentUrl: string): Promise<boolean>;
  /**
   * Rewrite one intercepted top-level document and record its outcome.
   *
   * @returns The bytes to serve, or null to serve the original bytes
   *   unmodified (no active session for the tab, another origin, nothing
   *   changed, or any failure — all recorded where a session exists).
   *   Headers are the backend's: the body is in the response's own
   *   charset (never transcoded), so only `Content-Length` (and any
   *   `Content-Encoding` the backend already removed) needs fixing.
   */
  rewriteDocument(document: InterceptedDocument): Promise<Uint8Array | null>;
  /** A top-level document's body could not be read (served unmodified) — recorded. */
  documentBodyUnavailable(tabId: number, documentUrl: string): Promise<void>;
  /** The browser ended interception for the tab while the session was live. */
  interceptionEnded(tabId: number, cause: InterceptionEndCause): Promise<void>;
}

/**
 * One browser's interception mechanism. All methods are failure-aware: an
 * expected failure is a result, never a rejection (a rejection is treated
 * as an unexpected fault — logged, and the session degrades safely).
 */
export interface InterceptionBackend {
  /**
   * Arm interception for the tab's top-level documents. The mode is
   * decided by attempting (never assumed): armed, or why not. Idempotent:
   * arming an armed tab confirms it (re-establishing a dead attachment).
   */
  arm(tabId: number): Promise<ArmResult>;
  /** Drop the tab's interception and any bookkeeping; a no-op when unarmed. */
  disarm(tabId: number): Promise<void>;
  /**
   * Wake re-validation of a stored active session (the stored record is a
   * hint): confirm or re-establish interception for the tab. False = stale
   * (the session is cleared and the tab served unmodified).
   */
  resume(tabId: number): Promise<boolean>;
  /** A preempting engine runner (e.g. worker-hosted); absent → in-process. */
  readonly runner?: DocumentTransformRunner;
}

/** One registry row: a backend and the feature detection that selects it. */
export interface InterceptionBackendRow {
  /** Stable id for logs (e.g. the mechanism's name). */
  readonly id: string;
  /** Feature detection of the mechanism (`'x' in api` — never user-agent sniffing). */
  isSupported(): boolean;
  /** Create the backend, wiring its callbacks to the host. */
  create(host: InterceptionHost): InterceptionBackend;
}

/**
 * The first registry row whose feature detection passes (a throwing
 * detection counts as unsupported).
 *
 * @param rows The registry, in preference order.
 * @returns The row, or null when this browser supports none.
 */
export function selectInterceptionBackend(
  rows: readonly InterceptionBackendRow[]
): InterceptionBackendRow | null {
  return (
    rows.find((row) => {
      try {
        return row.isSupported();
      } catch {
        // A detection that throws cannot vouch for its mechanism.
        return false;
      }
    }) ?? null
  );
}
