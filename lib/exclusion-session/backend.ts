/**
 * The interception-backend seam: what a per-browser backend (one that can
 * rewrite a tab's top-level documents before parse) implements, what the
 * session controller hands it back ({@link InterceptionHost}), and the
 * registry row the background selects one by. Session semantics (the
 * state machine, stores, pushes, the document step, charsets, budgets)
 * are backend-agnostic and live outside the backend; a backend only arms,
 * disarms, resumes, intercepts, and reports.
 *
 * **Generations.** Every arm and resume hands the backend the session's
 * generation (its start time — strictly increasing per tab, opaque to the
 * backend). The backend tags the interception it confirms or establishes
 * with it, and reports an end with the generation of the interception that
 * actually ended (read when the browser signals it, never "the latest") —
 * so a late end of a replaced interception never kills a re-armed session.
 *
 * **Time bounds.** The controller time-boxes every backend call (a timed-
 * out `arm` answers `attach-denied`; a timed-out `resume` is stale; a
 * timed-out `disarm` is logged), and every host method resolves within
 * `INTERCEPTION_HOST_BOUNDS_MS` (`./timeouts`) — `rewriteDocument` within
 * the bound its gate granted ({@link InterceptionGrant}: longer only for a
 * session that simulates). A backend still never trusts the host with a
 * paused response: it arms its own release deadline above that bound and,
 * when it passes, serves the response unmodified
 * (CDP: continue; stream filter: write the buffered bytes through). An
 * `arm` or `resume` that settles after its timeout — or after a `disarm` —
 * must not leave interception behind: per tab, the latest of
 * arm/resume/disarm wins (the controller follows every timed-out arm or
 * resume with a `disarm`, which a late success must not outlive).
 *
 * **Eligibility.** Before reading or decoding any body, a backend passes
 * only `isRewritableResponse` (`./document-transform`) responses to the host; every other
 * response is passed through (continued) — never reported via
 * `documentBodyUnavailable`. The host re-checks it. A passed top-level
 * response that still becomes the tab's page (`rendersAsPage`), or a
 * network failure of one, is reported via `documentPassed`.
 *
 * **One record per session page.** Every top-level document of a session
 * tab on the session's origin that reaches a backend while the session is
 * live ends in exactly one record: the host records the outcome of every
 * document it is asked to rewrite (served, unmodified, past its bound,
 * abandoned); the backend reports what it passed without asking. Left
 * unrecorded, by design: a page whose session read fails (the overlay's
 * bounded wait names it), and a document arriving while the session stops.
 */
import type {
  InterceptionUnavailableCause,
  PassedDocumentFailure
} from '../messaging/exclusion-session';
import type {
  DocumentTransformRunner,
  InterceptedDocumentBody,
  InterceptedResponseFacts
} from './document-transform';
import type { PackagedRuntimeFile } from './simulation-sources';
import type { SimulateSpec } from '../wp-rocket-simulation/spec';

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

/**
 * A backend's identity of one intercepted response — optional: without it
 * the host records no served identity (and no ordering) for the document.
 */
export interface InterceptedResponseIdentity {
  /** Opaque, unique per intercepted response (printable, ≤ `SERVED_DOCUMENT_LIMITS.tokenChars`). */
  readonly token: string;
  /**
   * Epoch ms the response reached the backend, by a monotonic clock
   * (strictly increasing per backend — it orders the tab's documents; the
   * host keeps the order increasing across background restarts).
   */
  readonly receivedAt: number;
  /**
   * Wall-clock epoch ms (`Date.now()`) at the same instant as
   * {@link receivedAt}: the time a page's own (wall-anchored) navigation
   * window is compared with. Taken when the response arrives, so a record
   * written later (after a release, under load) still carries the arrival.
   * Absent: the host stamps the record when it writes it.
   */
  readonly wallAt?: number;
  /**
   * Whether the response carries a `Speculation-Rules` header the backend
   * drops from the document whatever the host answers (fulfilled or
   * continued) — false when the backend cannot drop headers.
   */
  readonly speculationRulesHeader: boolean;
  /**
   * Whether bytes the host returns reach the page as a substituted copy
   * (its security indicator and timing then describe the copy). The host
   * then returns bytes only when the exclusions changed the document;
   * otherwise (an in-place rewrite) also when only the session's
   * speculation-rule removal did.
   */
  readonly servedAsCopy: boolean;
  /** Whether the session's speculation-rules page guard runs in this document. */
  readonly speculationGuard: boolean;
  /** Whether the tab's service workers are bypassed while the session lasts. */
  readonly serviceWorkersBypassed: boolean;
}

/** One intercepted top-level document of a tab, with its response facts. */
export interface InterceptedDocument extends InterceptedDocumentBody, InterceptedResponseFacts {
  readonly tabId: number;
  /** The document's absolute URL (the session's origin gate reads it). */
  readonly documentUrl: string;
  /** The response's identity, when the backend has one. */
  readonly identity?: InterceptedResponseIdentity;
}

/**
 * The host's yes to intercepting one document: the bound (ms) its
 * `rewriteDocument` resolves within — the backend's release deadline sits
 * above it.
 */
export interface InterceptionGrant {
  readonly rewriteBoundMs: number;
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
   * Whether the tab's next top-level document should be intercepted (an
   * active session whose origin is the document's): its grant, or null.
   * The per-navigation gate for backends that choose per request (e.g. a
   * streaming filter).
   */
  shouldIntercept(tabId: number, documentUrl: string): Promise<InterceptionGrant | null>;
  /**
   * Rewrite one intercepted top-level document and record its outcome.
   *
   * @param document The document and its response facts.
   * @param abandoned Optional: whether the backend has stopped waiting for
   *   this answer (it already served the original — its own deadline passed,
   *   the stream failed or was withdrawn). Checked right before the outcome
   *   is recorded: an abandoned document answers null and is recorded as
   *   served unmodified (`not-served`; `timed-out` once the host's own
   *   bound passed), so the record never claims a rewrite that was not
   *   served.
   *
   * @returns The bytes to serve, or null to serve the original bytes
   *   (no active session for the tab, another origin, an ineligible
   *   response — those unrecorded — the exclusions changed nothing (and,
   *   for an in-place backend, no rule script to remove), an undecodable
   *   body, a session stopped or replaced while the engine ran — recorded
   *   where a session exists, unless a later document of the tab is
   *   already recorded). Bytes are the rewrite (without its speculation
   *   rules), or — for an in-place backend only — the document without
   *   its rules when that is the session's only change.
   *   Headers are the backend's: the body is in the response's own
   *   charset (never transcoded), so only `Content-Length` (and any
   *   `Content-Encoding` the backend already removed) needs fixing, and a
   *   session document's `Speculation-Rules` header is dropped whether
   *   bytes are served or not.
   */
  rewriteDocument(
    document: InterceptedDocument,
    abandoned?: () => boolean
  ): Promise<Uint8Array | null>;
  /**
   * An eligible top-level document's body could not be read (or exceeds
   * `DOCUMENT_BODY_BYTE_LIMIT`; served unmodified) — recorded, with the
   * response's identity when given.
   */
  documentBodyUnavailable(
    tabId: number,
    documentUrl: string,
    identity?: InterceptedResponseIdentity
  ): Promise<void>;
  /**
   * The rewrite the host answered for this response could not be delivered
   * — the browser had already dropped the response (its navigation
   * abandoned, the session ended first) — so the outcome recorded for it
   * is corrected to `not-served` (with the same identity, so a later
   * document's record is never touched).
   */
  documentNotServed(
    tabId: number,
    documentUrl: string,
    identity?: InterceptedResponseIdentity
  ): Promise<void>;
  /**
   * A top-level document the backend passed without asking for a rewrite,
   * though it becomes the tab's page: its response is one the session never
   * rewrites (`ineligible-response`), or it failed on the network
   * (`network-error`) — recorded as served unmodified (with the response's
   * identity when given), so the page's overlay never waits for a record.
   */
  documentPassed(
    tabId: number,
    documentUrl: string,
    reason: PassedDocumentFailure,
    identity?: InterceptedResponseIdentity
  ): Promise<void>;
  /**
   * The packaged file answering a script request of the tab's top-level
   * page for a simulated runtime — non-null only when `requestUrl` is the
   * runtime URL of the tab's latest recorded document's simulation (its
   * runtime simulated there) in the live session, and the requesting
   * document (`documentUrl`: the tab's top-level document as the browser
   * reports it) is that recorded document on the session's origin.
   * Nothing is answered once the session ends, the tab's next document is
   * recorded without it, or the tab shows another page; never for any
   * other URL: those requests go to the site as made.
   */
  simulatedRuntime(
    tabId: number,
    requestUrl: string,
    documentUrl: string
  ): Promise<PackagedRuntimeFile | null>;
  /**
   * The browser ended the tab's interception tagged `generation` (the
   * value the backend was armed or resumed with). An end whose generation
   * is not the live session's is dropped.
   */
  interceptionEnded(tabId: number, cause: InterceptionEndCause, generation: number): Promise<void>;
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
   * arming an armed tab confirms it (re-establishing a dead attachment)
   * and re-tags it with `generation` (see the module doc).
   *
   * @param origin Optional: the session's origin — scopes the backend's
   *   per-origin session effects (e.g. a page guard) to its documents.
   * @param simulate Optional: what the session simulates — lets a backend
   *   hold per-feature request hooks only for the tabs that need them.
   */
  arm(
    tabId: number,
    generation: number,
    origin?: string,
    simulate?: SimulateSpec
  ): Promise<ArmResult>;
  /** Drop the tab's interception and any bookkeeping; a no-op when unarmed. */
  disarm(tabId: number): Promise<void>;
  /**
   * Wake re-validation of a stored active session (the stored record is a
   * hint): confirm or re-establish interception for the tab, tagged with
   * the stored session's `generation`. False = stale (the session is
   * cleared and the tab served unmodified). Must not await host calls
   * (the host waits for the re-validation `resume` is part of).
   *
   * @param origin Optional: the stored session's origin (see {@link arm}).
   * @param simulate Optional: the stored session's simulation (see {@link arm}).
   */
  resume(
    tabId: number,
    generation: number,
    origin?: string,
    simulate?: SimulateSpec
  ): Promise<boolean>;
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
