/**
 * The Chromium interception backend: the debugger protocol's `Fetch`
 * domain pauses each top-level document response of an armed tab after
 * its headers arrive; the backend reads the body, hands it to the host's
 * document step and serves the result (`fulfillRequest` — a substituted
 * copy, so only when the exclusions changed the document) or the original
 * (`continueRequest`, or `continueResponse` to drop a `Speculation-Rules`
 * header — the real response, connection and security state kept). Runs
 * over an injected {@link DebuggerPort}.
 *
 * Rules it owns (on top of the seam's, `../backend`):
 * - **Every paused request is released exactly once** — fulfilled or
 *   continued — on every path: malformed event, sub-frame, ineligible,
 *   unreadable body, host past its bound, fulfill refused (then
 *   continued), unexpected fault. A detach releases what is still paused
 *   (the browser continues it), so a release after one is a no-op.
 * - **Every debugger call is time-boxed** ({@link CHROMIUM_TIMEOUTS_MS}),
 *   and the host gets {@link chromiumReleaseMs} of its gate's grant — above
 *   its own bound — before the response is served unmodified. Each arm/resume/
 *   disarm runs inside one budget ({@link CHROMIUM_OPERATION_BUDGETS_MS},
 *   from the moment it is called, queue wait included) below the
 *   controller's deadline for it, so it always answers first.
 * - **Per tab, arm/resume/disarm run serialized**: the latest call wins by
 *   construction (a late arm is followed by the disarm queued after it).
 * - **Arming is attempted**: attach, then enable the session — `Fetch`
 *   interception, plus `Network` with service workers bypassed (a page a
 *   service worker controls would otherwise be served by it, never
 *   reaching interception; the domain is enabled with no payload buffers,
 *   its events ignored on arrival). The browser's refusal is mapped to a
 *   cause (`./debugger-errors`). An attach the browser answers "already
 *   attached" is this extension's own earlier session (e.g. kept across a
 *   background restart): it is detached and attached afresh, so no script
 *   of it lingers. The session installs the speculation-rules guard
 *   (`../speculation-rules`) for its origin in every new document of the
 *   tab — inline rules and rules a page's scripts insert — once, replaced
 *   when a re-apply changes the origin; it ends with the session (a
 *   detached session's new-document scripts go with it). The
 *   service-worker bypass is tab-wide (the protocol cannot scope it).
 * - **Top frame only**: a document response is a candidate only when its
 *   frame is the tab's page target (iframes are documents too); the page
 *   target id is cached per tab and re-read on any mismatch.
 * - **Identity**: each candidate is handed to the host with its request id,
 *   a monotonic arrival stamp (the host orders a tab's documents by it),
 *   whether it carries a `Speculation-Rules` header — dropped from every
 *   session document released, fulfilled or continued — whether the guard
 *   runs in it, and that bytes are served as a copy and service workers
 *   bypassed.
 * - **Ends are reported with the ended attachment's generation**; a closed
 *   tab reports nothing (its own cleanup ends the session); self-detach
 *   fires no browser signal.
 * - Failures are logged under the extension's prefix in the background
 *   only — the inspected page's console never sees them.
 */
import { createLogger, type Logger } from '../../logger';
import type { ScheduleTimer } from '../../messaging/bounded-ask';
import { isRecord } from '../../../utils/is-record';
import { createKeyedQueue } from '../../../utils/keyed-queue';
import type {
  ArmResult,
  ArmUnavailableCause,
  InterceptedResponseIdentity,
  InterceptionBackend,
  InterceptionGrant,
  InterceptionHost
} from '../backend';
import { DOCUMENT_BODY_BYTE_LIMIT, type InterceptedResponseFacts } from '../document-transform';
import { speculationRulesGuardSource } from '../speculation-rules';
import { createMonotonicStamp } from '../../../utils/monotonic-stamp';
import { parseUrl } from '../../../utils/urls';
import { DeadlineExceededError, SESSION_STEP_TIMEOUTS_MS, withinDeadline } from '../timeouts';
import {
  DETACHED,
  mayRewrite,
  transitionAttachment,
  type Attachment,
  type AttachmentEvent,
  type AttachmentTransition
} from './attachment';
import { classifyAttachError, errorMessage, isNotAttachedError } from './debugger-errors';
import { createPauseRelease, type PauseRelease } from './pause-release';
import { endCauseOfDetach, needsTabPresence } from './detach-causes';
import {
  classifyPause,
  fulfillParams,
  headerValue,
  parsePausedRequest,
  pausedRequestId,
  responseBodyBytes,
  SPECULATION_RULES_HEADER,
  type PausedRequest
} from './paused-request';
import type { DebuggerPort, DebuggerTarget, TabPresence } from './port';

/** The backend's time bounds (ms). */
export const CHROMIUM_TIMEOUTS_MS = {
  /**
   * One debugger call (attach, detach, a protocol command). Browser-side
   * calls answer in milliseconds; two of them (attach + enable) stay under
   * the controller's arm deadline.
   */
  command: 1_500,
  /**
   * Reading a paused document's body: the browser buffers it whole, so a
   * slow server holds the navigation; past this the document is served
   * unmodified (continuing mid-read is safe — the browser serves the body
   * once it is complete) and recorded as unreadable.
   */
  bodyRead: 10_000,
  /**
   * How far the release deadline sits past the host's rewrite bound
   * ({@link chromiumReleaseMs}): past it, the original is served.
   */
  releaseMargin: 1_000
} as const;

/**
 * The release deadline (ms) of one document's host rewrite: its gate's
 * granted bound plus {@link CHROMIUM_TIMEOUTS_MS.releaseMargin} — so a
 * session that does not simulate keeps the exclusions-only deadline.
 *
 * @param rewriteBoundMs The host's rewrite bound for the document (its grant).
 */
export function chromiumReleaseMs(rewriteBoundMs: number): number {
  return rewriteBoundMs + CHROMIUM_TIMEOUTS_MS.releaseMargin;
}

/** What each operation keeps free below the controller's deadline for it (ms). */
const OPERATION_MARGIN_MS = 100;

/**
 * Each operation's whole budget (ms), every call of it included: the
 * controller's deadline for the operation minus a margin — so a worst
 * case (e.g. a dead armed session: three enables, then attach and three
 * enables again) answers within it instead of outliving it.
 */
export const CHROMIUM_OPERATION_BUDGETS_MS = {
  arm: SESSION_STEP_TIMEOUTS_MS.arm - OPERATION_MARGIN_MS,
  resume: SESSION_STEP_TIMEOUTS_MS.resume - OPERATION_MARGIN_MS,
  disarm: SESSION_STEP_TIMEOUTS_MS.disarm - OPERATION_MARGIN_MS
} as const;

/** The interception patterns: every document response, paused once its headers arrive. */
const FETCH_PATTERNS = [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Response' }];

/**
 * The session's commands after attaching, in order, each idempotent:
 * interception; the `Network` domain (only to bypass service workers — it
 * must be enabled for the bypass to hold, verified on Chromium 156) with
 * every payload buffer off; the `Page` domain (its new-document scripts
 * run only while it is enabled, verified on Chromium 156).
 */
const SESSION_COMMANDS: readonly (readonly [string, Record<string, unknown>])[] = [
  ['Fetch.enable', { patterns: FETCH_PATTERNS }],
  ['Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0, maxPostDataSize: 0 }],
  ['Network.setBypassServiceWorker', { bypass: true }],
  ['Page.enable', {}]
];

/** One operation's shared deadline: every call gets what is left (capped per call). */
interface OperationBudget {
  /** Clock reading when the operation was called (before any queue wait). */
  readonly calledAt: number;
  call<T>(step: string, work: () => Promise<T>): Promise<T>;
}

/** The pause event this backend handles (others are ignored). */
const REQUEST_PAUSED = 'Fetch.requestPaused';

/** What the backend needs injected. */
export interface ChromiumBackendDeps {
  readonly port: DebuggerPort;
  readonly host: InterceptionHost;
  /** Defaults to the `interception` logger. */
  readonly log?: Logger;
  /** Timer seam for every deadline; defaults to `setTimeout`. */
  readonly schedule?: ScheduleTimer;
  /** Monotonic clock (ms) for operation budgets; defaults to `performance.now`. */
  readonly clock?: () => number;
  /** A response's arrival stamp (monotonic epoch ms, strictly increasing); defaults to the platform's. */
  readonly stamp?: () => number;
  /** Wall-clock epoch ms (the arrival's wall time); defaults to `Date.now`. */
  readonly wallNow?: () => number;
}

/** When a paused response arrived: its monotonic order stamp and its wall time. */
interface Arrival {
  readonly receivedAt: number;
  readonly wallAt: number;
}

/** A debugger event's source, validated: the tab (and child session) it came from. */
function parseSource(source: unknown): DebuggerTarget | null {
  if (!isRecord(source) || typeof source.tabId !== 'number') return null;
  return typeof source.sessionId === 'string'
    ? { tabId: source.tabId, sessionId: source.sessionId }
    : { tabId: source.tabId };
}

/** Whether a body announced by its headers is too large to buffer (unencoded bodies only). */
function declaredTooLarge(pause: PausedRequest): boolean {
  if (headerValue(pause.headers, 'content-encoding') !== null) return false;
  const length = Number(headerValue(pause.headers, 'content-length'));
  return Number.isFinite(length) && length > DOCUMENT_BODY_BYTE_LIMIT;
}

/** The session's page guard installed in a tab: its script id and the origin it serves. */
interface InstalledGuard {
  readonly identifier: string;
  readonly origin: string;
}

/**
 * Create the Chromium backend and register its debugger listeners
 * (synchronously).
 *
 * @param deps The port, the host, and the optional logger/timer seams.
 */
export function createChromiumInterceptionBackend(deps: ChromiumBackendDeps): InterceptionBackend {
  const { port, host } = deps;
  const log = deps.log ?? createLogger('interception');
  const serialize = createKeyedQueue();
  const clock = deps.clock ?? (() => performance.now());
  const stamp = deps.stamp ?? createMonotonicStamp();
  const wallNow = deps.wallNow ?? (() => Date.now());
  const attachments = new Map<number, Attachment>();
  /** Per tab, the cause of an arm whose attachment the browser ended mid-arm (held only during an operation). */
  const aborts = new Map<number, Promise<ArmUnavailableCause>>();
  /** Per tab, the last known page target id (its main frame's protocol frame id). */
  const pageTargets = new Map<number, string>();
  /** Per tab, the clock reading when its armed session was last established or confirmed. */
  const confirmedAt = new Map<number, number>();
  /** Per tab, the speculation-rules guard its session installed (one at a time). */
  const guards = new Map<number, InstalledGuard>();

  /** Run one debugger step under a deadline. */
  const bounded = <T>(step: string, ms: number, work: () => Promise<T>): Promise<T> =>
    withinDeadline(step, ms, work, deps.schedule);

  /** One debugger call under the command deadline. */
  const call = <T>(step: string, work: () => Promise<T>): Promise<T> =>
    bounded(step, CHROMIUM_TIMEOUTS_MS.command, work);

  /** A budget of `totalMs` from now, shared by one operation's calls. */
  const budget = (totalMs: number): OperationBudget => {
    const calledAt = clock();
    const end = calledAt + totalMs;
    return {
      calledAt,
      call: (step, work) => {
        const left = Math.min(CHROMIUM_TIMEOUTS_MS.command, end - clock());
        return left > 0
          ? bounded(step, left, work)
          : Promise.reject(new DeadlineExceededError(step, totalMs));
      }
    };
  };

  /**
   * Run one operation of a tab serialized, its budget started at the call
   * (queue wait included); the tab's mid-arm abort record never outlives it.
   */
  const operation = <T>(
    tabId: number,
    totalMs: number,
    work: (ops: OperationBudget) => Promise<T>
  ): Promise<T> => {
    const ops = budget(totalMs);
    return serialize(tabId, async () => {
      aborts.delete(tabId);
      try {
        return await work(ops);
      } finally {
        aborts.delete(tabId);
      }
    });
  };

  const attachmentOf = (tabId: number): Attachment => attachments.get(tabId) ?? DETACHED;

  /** Apply an event to the tab's attachment; null (nothing changed) when it is not accepted. */
  const apply = (tabId: number, event: AttachmentEvent): AttachmentTransition | null => {
    const step = transitionAttachment(attachmentOf(tabId), event);
    if (step === null) return null;
    if (step.next.phase !== 'armed') confirmedAt.delete(tabId);
    // A detached session's new-document scripts end with it.
    if (step.next.phase === 'detached') guards.delete(tabId);
    if (step.next.phase === 'detached') attachments.delete(tabId);
    else attachments.set(tabId, step.next);
    return step;
  };

  /** What the tab is now, bounded (an unanswered probe reads as a live web page). */
  const presenceOf = async (tabId: number): Promise<TabPresence> => {
    try {
      return await call('Tab presence', () => port.tabPresence(tabId));
    } catch (cause) {
      log.warn('Tab presence unknown after a detach — treated as still open', { tabId, cause });
      return 'web';
    }
  };

  /** The end cause of a browser detach (see `./detach-causes`). */
  const detachCause = async (tabId: number, reason: unknown) =>
    endCauseOfDetach(reason, needsTabPresence(reason) ? await presenceOf(tabId) : 'web');

  // ── Arming ─────────────────────────────────────────────────────────────

  /** Enable the session's domains (see {@link SESSION_COMMANDS}) — idempotent. */
  const enableSession = async (ops: OperationBudget, tabId: number): Promise<void> => {
    for (const [method, params] of SESSION_COMMANDS) {
      await ops.call(method, () => port.send({ tabId }, method, params));
    }
  };

  /**
   * Install the speculation-rules guard for the session's origin — once:
   * a guard for another origin (a re-apply from elsewhere) is replaced, one
   * for this origin kept (never stacked).
   *
   * @throws What the browser rejects with (the arm then fails like an enable).
   */
  const installGuard = async (
    ops: OperationBudget,
    tabId: number,
    origin: string | undefined
  ): Promise<void> => {
    if (origin === undefined) return;
    const current = guards.get(tabId);
    if (current?.origin === origin) return;
    if (current !== undefined) {
      await ops.call('Page.removeScriptToEvaluateOnNewDocument', () =>
        port.send({ tabId }, 'Page.removeScriptToEvaluateOnNewDocument', {
          identifier: current.identifier
        })
      );
      guards.delete(tabId);
    }
    const result = await ops.call('Page.addScriptToEvaluateOnNewDocument', () =>
      port.send({ tabId }, 'Page.addScriptToEvaluateOnNewDocument', {
        source: speculationRulesGuardSource(origin)
      })
    );
    const identifier = isRecord(result) ? result.identifier : undefined;
    if (typeof identifier !== 'string') throw new Error('Guard install answered no identifier');
    guards.set(tabId, { identifier, origin });
  };

  /** Learn the tab's page target id (best-effort: a miss is re-read on the first pause). */
  const learnPageTarget = async (ops: OperationBudget, tabId: number): Promise<void> => {
    try {
      const id = await ops.call('Page target', () => port.pageTargetId(tabId));
      if (id === null) pageTargets.delete(tabId);
      else pageTargets.set(tabId, id);
    } catch (cause) {
      log.debug('Page target not learned at arm — read on first pause', { tabId, cause });
    }
  };

  /**
   * Detach best-effort. A missing session is expected; so is any refusal
   * when no attachment is on record (e.g. the browser already ended it on
   * a page the debugger may not touch — Chromium then refuses the detach
   * itself with the attach-time page error).
   *
   * @param held Whether an attachment is on record for the tab.
   */
  const detachQuietly = async (
    ops: OperationBudget,
    tabId: number,
    held: boolean
  ): Promise<void> => {
    pageTargets.delete(tabId);
    try {
      await ops.call('Debugger detach', () => port.detach(tabId));
    } catch (cause) {
      const details = { tabId, cause: errorMessage(cause) };
      if (!held || isNotAttachedError(cause))
        log.debug('Detach found no session (expected)', details);
      else log.warn('Debugger detach failed', details);
    }
  };

  /** The cause of an arm the browser aborted (`detached` when it never said why). */
  const abortCause = async (tabId: number): Promise<ArmUnavailableCause> => {
    const pending = aborts.get(tabId);
    aborts.delete(tabId);
    return pending === undefined ? 'detached' : pending;
  };

  /** Confirm a live armed attachment (re-enabling the session); false when it is gone. */
  const confirmArmed = async (
    ops: OperationBudget,
    tabId: number,
    generation: number,
    origin: string | undefined
  ): Promise<boolean> => {
    try {
      await enableSession(ops, tabId);
      await installGuard(ops, tabId, origin);
    } catch (cause) {
      log.info('Armed tab’s session is gone — re-attaching', { tabId, cause: errorMessage(cause) });
      apply(tabId, { type: 'lost' });
      return false;
    }
    if (apply(tabId, { type: 'confirm', generation }) === null) return false;
    confirmedAt.set(tabId, clock());
    return true;
  };

  /**
   * Attach; an attach the browser answers "already attached" is this
   * extension's own session from before (its scripts unknown): detached and
   * attached afresh, so the new session starts clean (no stacked guard).
   *
   * @returns Null when attached, or the attach failure.
   */
  const attachClean = async (ops: OperationBudget, tabId: number) => {
    const attach = () => ops.call('Debugger attach', () => port.attach(tabId));
    try {
      await attach();
      return null;
    } catch (cause) {
      const failure = classifyAttachError(cause);
      if (failure.kind === 'unavailable') return { cause, failure };
      log.info('Replacing this extension’s earlier debugger session', { tabId });
    }
    await detachQuietly(ops, tabId, true);
    try {
      await attach();
      return null;
    } catch (cause) {
      const failure = classifyAttachError(cause);
      // Still attached after the detach: not ours to reuse — a refusal.
      return {
        cause,
        failure:
          failure.kind === 'unavailable'
            ? failure
            : ({ kind: 'unavailable', cause: 'attach-denied', known: false } as const)
      };
    }
  };

  /** Attach afresh and enable the session (interception, bypass, page guard). */
  const attachFresh = async (
    ops: OperationBudget,
    tabId: number,
    generation: number,
    origin: string | undefined
  ): Promise<ArmResult> => {
    apply(tabId, { type: 'attach', generation });
    const refused = await attachClean(ops, tabId);
    if (refused !== null) {
      const { cause, failure } = refused;
      apply(tabId, { type: 'lost' });
      const details = { tabId, cause: errorMessage(cause), mapped: failure.cause };
      if (failure.known) log.info('Interception unavailable — attach refused', details);
      else log.warn('Interception unavailable — unrecognized attach failure', details);
      return { armed: false, cause: failure.cause };
    }
    try {
      await enableSession(ops, tabId);
      await installGuard(ops, tabId, origin);
    } catch (cause) {
      const aborted = attachmentOf(tabId).phase !== 'attaching';
      apply(tabId, { type: 'lost' });
      // Detach left to the controller's follow-up disarm when the budget is spent.
      if (!aborted) await detachQuietly(ops, tabId, true);
      const reason = aborted ? await abortCause(tabId) : 'attach-denied';
      log.warn('Interception could not be enabled', { tabId, cause: errorMessage(cause), reason });
      return { armed: false, cause: reason };
    }
    if (apply(tabId, { type: 'enabled' }) === null) {
      return { armed: false, cause: await abortCause(tabId) };
    }
    confirmedAt.set(tabId, clock());
    await learnPageTarget(ops, tabId);
    return { armed: true };
  };

  /** Establish interception for the tab, tagged `generation` (arm and resume share it). */
  const establish = async (
    ops: OperationBudget,
    tabId: number,
    generation: number,
    origin: string | undefined
  ): Promise<ArmResult> => {
    const current = attachmentOf(tabId);
    // Armed for this very generation by an operation that finished while
    // this one waited in the queue: nothing to confirm (it just was).
    if (
      current.phase === 'armed' &&
      current.generation === generation &&
      (confirmedAt.get(tabId) ?? -Infinity) >= ops.calledAt &&
      (origin === undefined || guards.get(tabId)?.origin === origin)
    ) {
      return { armed: true };
    }
    if (current.phase === 'armed' && (await confirmArmed(ops, tabId, generation, origin))) {
      return { armed: true };
    }
    return attachFresh(ops, tabId, generation, origin);
  };

  // ── Paused requests ────────────────────────────────────────────────────

  /** The release of one paused request (see `./pause-release`). */
  const createRelease = (target: DebuggerTarget, requestId: string): PauseRelease =>
    createPauseRelease({
      requestId,
      tabId: target.tabId,
      log,
      send: (method, params) => call(method, () => port.send(target, method, params))
    });

  /**
   * Whether a paused document is the tab's top-level one: the cached page
   * target id first; on a mismatch (an iframe, or the tab's page target
   * changed) it is re-read once.
   */
  const isTopFrame = async (target: DebuggerTarget, frameId: string): Promise<boolean> => {
    // A child session is never the tab's page.
    if (target.sessionId !== undefined) return false;
    if (pageTargets.get(target.tabId) === frameId) return true;
    try {
      const id = await call('Page target', () => port.pageTargetId(target.tabId));
      if (id !== null) pageTargets.set(target.tabId, id);
      return id === frameId;
    } catch (cause) {
      log.warn('Page target unknown — document served unmodified', { cause });
      return false;
    }
  };

  /** Read a paused document's body; null when unreadable (or past the read bound). */
  const readBody = async (target: DebuggerTarget, pause: PausedRequest) => {
    if (declaredTooLarge(pause)) return null;
    try {
      const result = await bounded('Fetch.getResponseBody', CHROMIUM_TIMEOUTS_MS.bodyRead, () =>
        port.send(target, 'Fetch.getResponseBody', { requestId: pause.requestId })
      );
      return responseBodyBytes(result);
    } catch (cause) {
      log.warn('Document body unreadable — served unmodified', { cause: errorMessage(cause) });
      return null;
    }
  };

  /** The host's rewrite under the release deadline; null = serve the original. */
  const hostRewrite = async (
    target: DebuggerTarget,
    pause: PausedRequest,
    facts: InterceptedResponseFacts,
    body: Uint8Array,
    identity: InterceptedResponseIdentity,
    grant: InterceptionGrant
  ): Promise<Uint8Array | null> => {
    try {
      return await bounded('Host rewrite', chromiumReleaseMs(grant.rewriteBoundMs), () =>
        host.rewriteDocument({
          tabId: target.tabId,
          documentUrl: pause.url,
          body,
          ...facts,
          identity
        })
      );
    } catch (cause) {
      log.warn('Rewrite past the release deadline — served unmodified', { cause });
      return null;
    }
  };

  /** Handle one validated paused request; every path ends in its release. */
  const handlePause = async (
    target: DebuggerTarget,
    pause: PausedRequest,
    release: PauseRelease,
    arrival: Arrival
  ): Promise<void> => {
    const disposition = classifyPause(pause);
    if (disposition.kind === 'pass') {
      // A session document the engine never rewrites (e.g. XHTML) still
      // loses its rules header — a cheap check, for documents carrying one.
      if (
        disposition.reason === 'ineligible' &&
        (await isRulesHeaderSessionDocument(target, pause))
      )
        return release.passWithoutRulesHeader('ineligible', pause);
      return release.pass(disposition.reason);
    }
    if (!mayRewrite(attachmentOf(target.tabId))) return release.pass('stopping');
    if (!(await isTopFrame(target, pause.frameId))) return release.pass('sub-frame');
    // Another origin in the session tab (or no session): its body is none
    // of the session's business — never read, passed through.
    const grant = await host.shouldIntercept(target.tabId, pause.url);
    if (grant === null) return release.pass('no-session');
    const identity = identityOf(target.tabId, pause, arrival);
    const body = await readBody(target, pause);
    if (body === null) {
      await release.passWithoutRulesHeader('body-unavailable', pause);
      await host.documentBodyUnavailable(target.tabId, pause.url, identity);
      return;
    }
    const rewritten = await hostRewrite(target, pause, disposition.facts, body, identity, grant);
    if (rewritten === null) return release.passWithoutRulesHeader('unmodified', pause);
    const fulfilled = await release.fulfill(fulfillParams(pause, rewritten));
    if (fulfilled === 'fulfilled') return;
    // The host recorded a rewrite the page never got: correct the record.
    if (fulfilled === 'refused') await release.passWithoutRulesHeader('refused', pause);
    await host.documentNotServed(target.tabId, pause.url, identity);
  };

  /** The identity handed to the host for a session document of the tab. */
  const identityOf = (
    tabId: number,
    pause: PausedRequest,
    arrival: Arrival
  ): InterceptedResponseIdentity => ({
    token: pause.requestId,
    receivedAt: arrival.receivedAt,
    wallAt: arrival.wallAt,
    speculationRulesHeader: headerValue(pause.headers, SPECULATION_RULES_HEADER) !== null,
    servedAsCopy: true,
    speculationGuard: guards.get(tabId)?.origin === parseUrl(pause.url)?.origin,
    serviceWorkersBypassed: true
  });

  /** Whether a passed-through response is a top-level session document carrying a rules header. */
  const isRulesHeaderSessionDocument = async (
    target: DebuggerTarget,
    pause: PausedRequest
  ): Promise<boolean> =>
    pause.resourceType === 'Document' &&
    pause.status !== null &&
    headerValue(pause.headers, SPECULATION_RULES_HEADER) !== null &&
    (await isTopFrame(target, pause.frameId)) &&
    (await host.shouldIntercept(target.tabId, pause.url)) !== null;

  /** A `Fetch.requestPaused` event: validate, handle, and always release. */
  const onPaused = async (target: DebuggerTarget, params: unknown): Promise<void> => {
    // Both clocks read on arrival (records may be written after the release).
    const arrival: Arrival = { receivedAt: stamp(), wallAt: wallNow() };
    const pause = parsePausedRequest(params);
    const requestId = pause?.requestId ?? pausedRequestId(params);
    if (requestId === null) {
      log.error('Paused request without an id — cannot be released', { tabId: target.tabId });
      return;
    }
    const release = createRelease(target, requestId);
    try {
      if (pause === null) {
        log.warn('Malformed paused request — served unmodified', { tabId: target.tabId });
        await release.pass('malformed');
        return;
      }
      await handlePause(target, pause, release, arrival);
    } catch (cause) {
      log.error('Paused request handling failed — served unmodified', { cause });
      await release.pass('fault');
    }
  };

  // ── Browser signals ────────────────────────────────────────────────────

  /** `onDetach`: move synchronously, then work out the cause and report or abort. */
  const onDetached = (tabId: number, reason: unknown): void => {
    pageTargets.delete(tabId);
    const step = apply(tabId, { type: 'browser-detached' });
    const effect = step?.effect ?? null;
    if (effect === null) return;
    const cause = detachCause(tabId, reason);
    if (effect.kind === 'arm-aborted') {
      aborts.set(
        tabId,
        cause.then((ended) => ended ?? 'detached')
      );
      return;
    }
    void cause
      .then((ended) => {
        if (ended === null) {
          log.debug('Session ended with its tab — nothing to report', { tabId });
          return;
        }
        log.info('Browser ended interception', { tabId, cause: ended });
        return host.interceptionEnded(tabId, ended, effect.generation);
      })
      .catch((fault: unknown) => {
        log.error('Interception end not reported', { tabId, fault });
      });
  };

  port.listen({
    event(source, method, params) {
      if (method !== REQUEST_PAUSED) return;
      const target = parseSource(source);
      if (target === null) {
        log.error('Paused request from an unknown source — cannot be released');
        return;
      }
      void onPaused(target, params);
    },
    detach(source, reason) {
      const target = parseSource(source);
      if (target === null || target.sessionId !== undefined) return;
      onDetached(target.tabId, reason);
    }
  });

  return {
    arm: (tabId, generation, origin) =>
      operation(tabId, CHROMIUM_OPERATION_BUDGETS_MS.arm, (ops) =>
        establish(ops, tabId, generation, origin)
      ),

    resume: (tabId, generation, origin) =>
      operation(
        tabId,
        CHROMIUM_OPERATION_BUDGETS_MS.resume,
        async (ops) => (await establish(ops, tabId, generation, origin)).armed
      ),

    disarm: (tabId) =>
      operation(tabId, CHROMIUM_OPERATION_BUDGETS_MS.disarm, async (ops) => {
        const held = apply(tabId, { type: 'detach' }) !== null;
        // Detached even without a record: a session kept across a background
        // restart is still this extension's to end.
        await detachQuietly(ops, tabId, held);
        apply(tabId, { type: 'detached' });
      })
  };
}
