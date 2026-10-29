/**
 * The exclusion-session controller: the backend-agnostic lifecycle the
 * background runs — the session channels' answers, the per-tab state
 * machine driven over injected I/O (backend, stores, pushes, reload,
 * clock), the host side of the interception seam, and the cleanup paths
 * (Stop, tab close, extension install/update, wake re-validation).
 *
 * Rules it owns:
 * - **The `session:` record is the state**, read fresh per event (a
 *   suspended background keeps nothing in memory); every event of one tab
 *   runs serialized, so transitions never interleave (apply vs stop vs a
 *   detach vs a document record). A push only ever carries what the record
 *   holds (a failed write re-reads it first).
 * - **Everything awaited is time-boxed** (`./timeouts`): backend calls,
 *   store and saved-set I/O, the tab probe, pushes and the wake wait — a
 *   hung step fails that step, never the tab's queue; each host method
 *   resolves within its declared bound.
 * - **Arming is attempted, never assumed**; the session exists only once
 *   its record is stored (documents consult the record). No backend ⇒
 *   `unsupported-browser`; an arm that never answers ⇒ `attach-denied`.
 * - **Generations**: a session's start time is issued monotonically per
 *   controller (never repeating, even with a stalled or backward clock) and
 *   tags its documents and its interception's end, so a replaced or
 *   stopped session's late document or end never lands on a newer one.
 * - **Saving**: an apply saves the origin's set only when it answers
 *   `applying`; `saveExclusionSet` stores any wire-valid draft.
 * - **Stored form only**: a set holds rows as WP Rocket's settings save
 *   stores them (the editor converts on commit); an apply whose rows are
 *   not in that form is refused as `invalid`, naming each such row.
 * - **A stored record is a hint**: at wake every active record is
 *   re-validated through the backend (stale ⇒ cleared, served unmodified)
 *   before any ask or document is served; an install/update clears all.
 * - **Rewrite gate**: only eligible responses (`isRewritableResponse`) of
 *   the origin a session was applied from are rewritten; anything else in
 *   the tab passes through untouched and unrecorded. Bytes are served only
 *   when the session that ran the engine is still the tab's live one.
 * - Pushes tolerate the no-receiver case; every other failure is logged.
 */
import { createLogger, type Logger } from '../logger';
import { notStoredRows } from '../exclusion-builder/field-text';
import { prevalidateExclusionSet } from '../exclusion-builder/validate';
import type { ExclusionSet } from '../exclusion-builder/set';
import type { SimulateSpec } from '../wp-rocket-simulation/spec';
import { scheduleWithTimeout, type ScheduleTimer } from '../messaging/bounded-ask';
import {
  invalidApplyReply,
  parseExclusionSessionRecord,
  parseExclusionSessionTabQuery,
  parseExclusionSetPayload,
  parseServedDocument,
  type ActiveExclusionSession,
  type ExclusionApplyReply,
  type ExclusionDocumentOutcome,
  type ExclusionSaveReply,
  type ExclusionServedDocument,
  type ExclusionSessionRecord,
  type ExclusionSessionStatus,
  type SavedExclusionSetReply
} from '../messaging/exclusion-session';
import { isNoReceiverError } from '../messaging/no-receiver';
import {
  isExtensionPageSender,
  resolveTopFrameSender,
  type LooseMessageSender,
  type TopFrameSender
} from '../messaging/sender';
import {
  EXCLUSION_SESSION_LIMIT,
  type ExclusionSessionRecords,
  type PutSessionOutcome
} from '../storage/exclusion-sessions';
import { createKeyedQueue } from '../../utils/keyed-queue';
import { parseUrl } from '../../utils/urls';
import type {
  ArmResult,
  ArmUnavailableCause,
  InterceptedDocument,
  InterceptedResponseIdentity,
  InterceptionBackend,
  InterceptionEndCause,
  InterceptionHost
} from './backend';
import {
  createInProcessTransformRunner,
  DOCUMENT_TRANSFORM_BUDGET_MS,
  isRewritableResponse,
  rewriteDocument,
  type DocumentTransformRunner
} from './document-transform';
import {
  INACTIVE,
  observableStatus,
  transition,
  withSimulate,
  type SessionEffect,
  type SessionEvent,
  type SessionMachineState
} from './machine';
import { servedUrl } from './served-url';
import {
  INERT_SIMULATION_SOURCES,
  SimulationPreparationError,
  simulationPreparer,
  type SimulationSources
} from './simulation-sources';
import {
  DeadlineExceededError,
  INTERCEPTION_HOST_BOUNDS_MS,
  rewriteDocumentBoundMs,
  SESSION_STEP_TIMEOUTS_MS as STEPS,
  withinDeadline,
  withinExtensibleDeadline
} from './timeouts';

/** The per-tab session store (the `session:` helpers' shape). */
export interface SessionRecordStore {
  read(tabId: number): Promise<ExclusionSessionStatus>;
  readAll(): Promise<ExclusionSessionRecords>;
  put(tabId: number, record: ExclusionSessionRecord): Promise<PutSessionOutcome>;
  remove(tabId: number): Promise<void>;
}

/** The per-origin saved sets (the `local:` helpers' shape). */
export interface SavedSetStore {
  get(origin: string): Promise<ExclusionSet | null>;
  /** Save `set` with its simulation (absent: none — a stored one is replaced). */
  save(origin: string, set: ExclusionSet, simulate?: SimulateSpec): Promise<unknown>;
}

/** Everything the controller needs from the browser, injected. */
export interface ExclusionSessionControllerDeps {
  /** Create the selected backend wired to the host, or null when none exists. */
  readonly createBackend: (host: InterceptionHost) => InterceptionBackend | null;
  readonly sessions: SessionRecordStore;
  readonly savedSets: SavedSetStore;
  /** Push to the tab's top-frame overlay (`exclusionSessionChanged`). */
  readonly pushToTab: (tabId: number, status: ExclusionSessionStatus) => Promise<unknown>;
  /** Push to the extension's panels (`exclusionSessionUpdated`). */
  readonly pushToPanels: (tabId: number, status: ExclusionSessionStatus) => Promise<unknown>;
  /** Reload the tab once the apply answer is on its way (the wiring defers it). */
  readonly reload: (tabId: number) => void;
  /** Whether a tab still exists (wake re-validation). */
  readonly tabExists: (tabId: number) => Promise<boolean>;
  /** Epoch ms. */
  readonly now: () => number;
  /** This extension's id (the panel ask's sender gate). */
  readonly extensionId: string;
  /** The fallback engine runner; defaults to in-process. */
  readonly runner?: DocumentTransformRunner;
  /** Where a simulating session's inputs come from; defaults to the inert sources. */
  readonly simulation?: SimulationSources;
  /** The logger; defaults to the `exclusion-session` logger. */
  readonly log?: Logger;
  /** Timer seam for every deadline; defaults to `setTimeout`. */
  readonly schedule?: ScheduleTimer;
}

/** The controller: one method per channel and lifecycle hook. */
export interface ExclusionSessionController {
  /** `applyExclusionSession`. Rejects only on an unexpected fault (the sender sees `failed`). */
  apply(sender: LooseMessageSender | undefined, data: unknown): Promise<ExclusionApplyReply>;
  /** `stopExclusionSession`. Rejects when the record could not be removed (retryable). */
  stop(sender: LooseMessageSender | undefined): Promise<ExclusionSessionStatus>;
  /** `getExclusionSession`. */
  status(sender: LooseMessageSender | undefined): Promise<ExclusionSessionStatus>;
  /** `getSavedExclusionSet`. Rejects when the store read fails. */
  savedSet(sender: LooseMessageSender | undefined): Promise<SavedExclusionSetReply>;
  /** `saveExclusionSet`. */
  save(sender: LooseMessageSender | undefined, data: unknown): Promise<ExclusionSaveReply>;
  /** `getExclusionSessionForTab`. Rejects for senders other than this extension's tab-less pages. */
  statusForTab(
    sender: LooseMessageSender | undefined,
    data: unknown
  ): Promise<ExclusionSessionStatus>;
  /**
   * One tab's status for the background's own use (no sender gate; queued
   * behind the tab's events like an ask, after the wake re-validation).
   * Rejects when it cannot start within the ask queue wait or the read fails.
   */
  tabStatus(tabId: number): Promise<ExclusionSessionStatus>;
  /** `tabs.onRemoved`. Never rejects. */
  tabClosed(tabId: number): Promise<void>;
  /** Wake re-validation of stored records; asks and documents wait for it. Never rejects. */
  revalidate(): Promise<void>;
  /** Extension install/update: end every session (unmodified rendering restored). Never rejects. */
  resetAll(): Promise<void>;
  /** The host side handed to the backend. */
  readonly host: InterceptionHost;
}

/**
 * The cause an arm that never answers within its deadline is reported as:
 * the browser did not grant interception in time — the same user-facing
 * meaning and remedy (retryable: Retry) as a refused attach. `detached`
 * would claim a live session ended; the non-retryable causes would wrongly
 * rule a retry out.
 */
const ARM_TIMEOUT_CAUSE: ArmUnavailableCause = 'attach-denied';

/** The newest session start time among records (0 when none) — seeds the start issuer. */
function newestStart(records: ExclusionSessionRecords): number {
  let newest = 0;
  for (const record of Object.values(records)) {
    if (record.state === 'active') newest = Math.max(newest, record.startedAt);
  }
  return newest;
}

/** The latest document order among records (0 when none) — seeds the document order. */
function newestOrder(records: ExclusionSessionRecords): number {
  let newest = 0;
  for (const record of Object.values(records)) {
    if (record.state === 'active') newest = Math.max(newest, record.document?.served?.order ?? 0);
  }
  return newest;
}

/** The canonical origin of a URL, or null. */
function originOf(url: string): string | null {
  return parseUrl(url)?.origin ?? null;
}

/** An outcome with its served identity attached (when there is one). */
function withServed(
  outcome: ExclusionDocumentOutcome,
  served: ExclusionServedDocument | null
): ExclusionDocumentOutcome {
  return served === null ? outcome : { ...outcome, served };
}

/** Whether a failure is a missed deadline. */
function timedOut(cause: unknown): cause is DeadlineExceededError {
  return cause instanceof DeadlineExceededError;
}

/**
 * Create the controller.
 *
 * @param deps The injected browser seams.
 */
export function createExclusionSessionController(
  deps: ExclusionSessionControllerDeps
): ExclusionSessionController {
  const log = deps.log ?? createLogger('exclusion-session');
  const enqueue = createKeyedQueue();
  const fallbackRunner = deps.runner ?? createInProcessTransformRunner();
  const simulationSources = deps.simulation ?? INERT_SIMULATION_SOURCES;
  /** Settles once the wake re-validation ran; asks and documents wait for it (bounded). */
  let ready: Promise<void> = Promise.resolve();
  let backend: InterceptionBackend | null = null;
  /** The last session start issued or seen — the floor of the next one. */
  let lastStart = 0;
  /** The latest document order issued or seen in storage. */
  let lastOrder = 0;
  /**
   * What this background lifetime adds to a backend's monotonic stamps so
   * the document order continues past every stored one (a restarted
   * background's clock may read behind what an earlier one stored); fixed
   * at the first document, so stamps keep their relative order.
   */
  let orderOffset: number | null = null;

  /** Run one step under its deadline. */
  const bounded = <T>(step: string, ms: number, work: () => Promise<T>): Promise<T> =>
    withinDeadline(step, ms, work, deps.schedule);

  /** Remember the newest start seen in storage (a woken background issues past it). */
  const seenStart = (startedAt: number): void => {
    lastStart = Math.max(lastStart, startedAt);
  };

  /** Remember the latest document order seen in storage. */
  const seenOrder = (order: number): void => {
    lastOrder = Math.max(lastOrder, order);
  };

  /** A document's order from its backend stamp: continuous across background lifetimes. */
  const orderOf = (receivedAt: number): number => {
    orderOffset ??= Math.max(0, lastOrder + 1 - receivedAt);
    const order = receivedAt + orderOffset;
    seenOrder(order);
    return order;
  };

  /** Issue a session start: now, but strictly after every start issued or seen. */
  const issueStart = (): number => {
    lastStart = Math.max(deps.now(), lastStart + 1);
    return lastStart;
  };

  // ── Bounded I/O ────────────────────────────────────────────────────────

  /** One tab's status, bounded; an active record's start feeds the issuer. */
  const readSession = async (tabId: number): Promise<ExclusionSessionStatus> => {
    const status = await bounded('Session read', STEPS.store, () => deps.sessions.read(tabId));
    if (status.state === 'active') {
      seenStart(status.startedAt);
      seenOrder(status.document?.served?.order ?? 0);
    }
    return status;
  };

  /** Every stored record, bounded; the newest start feeds the issuer. */
  const readAllSessions = async (): Promise<ExclusionSessionRecords> => {
    const records = await bounded('Session read', STEPS.store, () => deps.sessions.readAll());
    seenStart(newestStart(records));
    seenOrder(newestOrder(records));
    return records;
  };

  /** Store one tab's record, bounded. */
  const putSession = (tabId: number, record: ExclusionSessionRecord): Promise<PutSessionOutcome> =>
    bounded('Session write', STEPS.store, () => deps.sessions.put(tabId, record));

  /** Remove one tab's record, bounded. */
  const removeSession = (tabId: number): Promise<void> =>
    bounded('Session removal', STEPS.store, () => deps.sessions.remove(tabId));

  /** Save an origin's set, bounded. */
  const saveSet = (
    origin: string,
    set: ExclusionSet,
    simulate: SimulateSpec | undefined
  ): Promise<unknown> =>
    bounded('Saved-set write', STEPS.store, () => deps.savedSets.save(origin, set, simulate));

  /**
   * Queue an ask's task behind the tab's earlier events, giving up when it
   * cannot start within the queue wait (it rejects, never starts late — the
   * sender's own deadline would already be at risk).
   */
  const enqueueAsk = <T>(tabId: number, ask: string, task: () => Promise<T>): Promise<T> => {
    let late = false;
    const cancel = (deps.schedule ?? scheduleWithTimeout)(() => {
      late = true;
    }, STEPS.queueWait);
    return enqueue(tabId, () => {
      cancel();
      if (late) {
        log.warn('Session ask waited too long behind its tab’s events — refused', { tabId, ask });
        throw new DeadlineExceededError(`${ask} queue wait`, STEPS.queueWait);
      }
      return task();
    });
  };

  /** Wait for the wake re-validation, bounded; false when it is still running. */
  const awaitReady = async (what: string): Promise<boolean> => {
    try {
      await bounded('Wake re-validation', STEPS.ready, () => ready);
      return true;
    } catch (cause) {
      log.warn(`Wake re-validation still running — ${what}`, { cause });
      return false;
    }
  };

  /** Push a status to the tab and the panels; a missing receiver is expected. */
  const notify = async (tabId: number, status: ExclusionSessionStatus): Promise<void> => {
    const pushes: [string, () => Promise<unknown>][] = [
      ['tab', () => deps.pushToTab(tabId, status)],
      ['panels', () => deps.pushToPanels(tabId, status)]
    ];
    await Promise.all(
      pushes.map(async ([target, push]) => {
        try {
          await bounded('Session push', STEPS.push, push);
        } catch (cause) {
          if (isNoReceiverError(cause))
            log.debug('Session push without a listener (expected)', { tabId, target });
          else log.error('Session push failed', { tabId, target, cause });
        }
      })
    );
  };

  /** Push what the record holds now (after a write that may not have landed); skip when unreadable. */
  const notifyStored = async (tabId: number): Promise<void> => {
    let stored: ExclusionSessionStatus;
    try {
      stored = await readSession(tabId);
    } catch (cause) {
      log.error('Session re-read failed — status push skipped', { tabId, cause });
      return;
    }
    await notify(tabId, stored);
  };

  // ── The arm activity ───────────────────────────────────────────────────

  /** The backend arm, bounded: a missed deadline is unavailability, not a fault. */
  const armBackend = async (
    armer: InterceptionBackend,
    tabId: number,
    generation: number,
    origin: string
  ): Promise<ArmResult> => {
    try {
      return await bounded('Backend arm', STEPS.arm, () => armer.arm(tabId, generation, origin));
    } catch (cause) {
      if (!timedOut(cause)) throw cause;
      log.warn('Backend arm timed out — interception unavailable', { tabId, cause });
      return { armed: false, cause: ARM_TIMEOUT_CAUSE };
    }
  };

  /**
   * The arm activity: the live-session cap, the backend attempt, and the
   * active record's store — the event that settles the arming state.
   */
  const runArm = async (tabId: number, state: SessionMachineState): Promise<SessionEvent> => {
    if (state.state !== 'arming') return { type: 'arm-failed' };
    const armer = backend;
    if (armer === null)
      return { type: 'arm-unavailable', cause: 'unsupported-browser', at: deps.now() };
    try {
      const records = await readAllSessions();
      const othersActive = Object.entries(records).filter(
        ([key, record]) => key !== String(tabId) && record.state === 'active'
      ).length;
      // Checked before attaching anything; the store re-checks on write (another tab may race).
      if (othersActive >= EXCLUSION_SESSION_LIMIT)
        return { type: 'arm-unavailable', cause: 'session-limit', at: deps.now() };
      const armed = await armBackend(armer, tabId, state.startedAt, state.origin);
      if (!armed.armed) return { type: 'arm-unavailable', cause: armed.cause, at: deps.now() };
      const record: ActiveExclusionSession = {
        state: 'active',
        origin: state.origin,
        set: state.set,
        ...withSimulate(state.simulate),
        startedAt: state.startedAt,
        document: null
      };
      const stored = await putSession(tabId, record);
      if (stored === 'limit-reached') {
        return { type: 'arm-unavailable', cause: 'session-limit', at: deps.now() };
      }
      return { type: 'armed' };
    } catch (cause) {
      log.error('Arming failed unexpectedly — no session started', { tabId, cause });
      return { type: 'arm-failed' };
    }
  };

  // ── Effects ────────────────────────────────────────────────────────────

  /**
   * Perform one effect; failures are logged (a `clear` failure is rethrown
   * for Stop).
   *
   * @returns False when a record write did not land (refused or failed).
   */
  const perform = async (tabId: number, effect: SessionEffect): Promise<boolean> => {
    switch (effect.kind) {
      case 'arm':
        return true; // driven by `drive` (its result is the next event)
      case 'disarm': {
        const disarmer = backend;
        if (disarmer === null) return true;
        try {
          await bounded('Backend disarm', STEPS.disarm, () => disarmer.disarm(tabId));
        } catch (cause) {
          log.error('Disarm failed', { tabId, cause });
        }
        return true;
      }
      case 'store':
        try {
          const stored = await putSession(tabId, effect.record);
          if (stored === 'stored') return true;
          log.warn('Session record refused at the cap', { tabId });
        } catch (cause) {
          log.error('Session record write failed', { tabId, cause });
        }
        return false;
      case 'clear':
        await removeSession(tabId);
        return true;
      case 'save-set':
        try {
          await saveSet(effect.origin, effect.set, effect.simulate);
        } catch (cause) {
          log.error('Applied set not saved for its origin', { tabId, cause });
        }
        return true;
      case 'reload':
        try {
          deps.reload(tabId);
        } catch (cause) {
          log.error('Tab reload could not be scheduled', { tabId, cause });
        }
        return true;
      case 'notify':
        await notify(tabId, effect.status);
        return true;
    }
  };

  /**
   * Run every effect in order. Once a record write or removal did not land,
   * a later `notify` pushes the re-read record instead of the transition's
   * status (observers never see a state the record does not hold). A failed
   * `clear` is rethrown once the rest ran (Stop reports it, others log).
   */
  const performAll = async (tabId: number, effects: readonly SessionEffect[]): Promise<void> => {
    let clearFailure: Error | null = null;
    let recordUncertain = false;
    for (const effect of effects) {
      if (effect.kind === 'notify' && recordUncertain) {
        await notifyStored(tabId);
        continue;
      }
      try {
        if (!(await perform(tabId, effect))) recordUncertain = true;
      } catch (cause) {
        recordUncertain = true;
        clearFailure =
          cause instanceof Error ? cause : new Error('Session record removal failed', { cause });
      }
    }
    if (clearFailure !== null) throw clearFailure;
  };

  /**
   * Drive one event for a tab (call inside the tab's queue): read the
   * stored state, transition, perform effects; an arm effect runs the arm
   * activity and drives its settling event in turn.
   *
   * @returns The state the event settled in.
   */
  const drive = async (tabId: number, event: SessionEvent): Promise<SessionMachineState> => {
    let state: SessionMachineState = await readSession(tabId);
    let next = transition(state, event);
    while (next !== null) {
      state = next.next;
      const arms = next.effects.some((effect) => effect.kind === 'arm');
      await performAll(tabId, next.effects);
      if (!arms) break;
      next = transition(state, await runArm(tabId, state));
    }
    return state;
  };

  /** Drive an event where nobody awaits a reply: every failure is logged. */
  const driveQuietly = async (tabId: number, event: SessionEvent, what: string): Promise<void> => {
    try {
      await enqueue(tabId, () => drive(tabId, event));
    } catch (cause) {
      log.error(`Session ${what} failed`, { tabId, cause });
    }
  };

  // ── Host side ──────────────────────────────────────────────────────────

  /**
   * Answer a host method from its already-bounded work: past the bound (or
   * on an unexpected fault) the backend gets `fallback` — the host never
   * rejects.
   *
   * @param method The host method (names the step).
   * @param fallback The safe answer past the bound or on a fault.
   * @param boundedWork The method's work under its deadline (named by `step`).
   * @param onExpired Called once the bound passed (before `fallback` is answered).
   */
  const hostGuard = async <T>(
    method: keyof typeof INTERCEPTION_HOST_BOUNDS_MS,
    fallback: T,
    boundedWork: (step: string) => Promise<T>,
    onExpired?: () => void
  ): Promise<T> => {
    try {
      return await boundedWork(`Host ${method}`);
    } catch (cause) {
      if (timedOut(cause)) {
        onExpired?.();
        log.warn('Host call past its bound — answered with the safe default', { method, cause });
      } else {
        log.error('Host call failed — answered with the safe default', { method, cause });
      }
      return fallback;
    }
  };

  /** {@link hostGuard} under the method's declared bound. */
  const hostCall = <T>(
    method: keyof typeof INTERCEPTION_HOST_BOUNDS_MS,
    fallback: T,
    work: () => Promise<T>
  ): Promise<T> =>
    hostGuard(method, fallback, (step) => bounded(step, INTERCEPTION_HOST_BOUNDS_MS[method], work));

  /** The tab's active session for a document URL, or null (no session, another origin, not ready). */
  const activeFor = async (
    tabId: number,
    documentUrl: string
  ): Promise<ActiveExclusionSession | null> => {
    if (!(await awaitReady('document served unmodified'))) return null;
    try {
      const status = await readSession(tabId);
      return status.state === 'active' && originOf(documentUrl) === status.origin ? status : null;
    } catch (cause) {
      log.error('Session read failed — document served unmodified', { tabId, cause });
      return null;
    }
  };

  /** Whether the session that ran the engine is still the tab's live one. */
  const stillLive = async (tabId: number, startedAt: number): Promise<boolean> => {
    try {
      const status = await readSession(tabId);
      return status.state === 'active' && status.startedAt === startedAt;
    } catch (cause) {
      log.error('Session re-check failed — document served unmodified', { tabId, cause });
      return false;
    }
  };

  /**
   * The engine's outcome checked against the session it is recorded on
   * (a preempting runner's result crossed a port: never trusted) — an
   * outcome the record guard refuses becomes `engine-failed`.
   */
  const checkedOutcome = (
    session: ActiveExclusionSession,
    outcome: ExclusionDocumentOutcome
  ): ExclusionDocumentOutcome | null => {
    const record = parseExclusionSessionRecord({ ...session, document: outcome }, 'reject');
    return record?.state === 'active' ? record.document : null;
  };

  /**
   * The served identity of a document, or null when the backend gave no
   * identity or it cannot cross the contract (logged).
   *
   * @param removedFromDocument Rule scripts removed from the served bytes.
   * @param copy Whether bytes are served by a copy-serving backend.
   */
  const servedIdentity = async (
    document: Pick<InterceptedDocument, 'documentUrl' | 'identity'>,
    removedFromDocument: number,
    copy: boolean
  ): Promise<ExclusionServedDocument | null> => {
    const identity = document.identity;
    if (identity === undefined) return null;
    const url = await servedUrl(document.documentUrl);
    const served =
      url === null
        ? null
        : parseServedDocument(
            {
              ...url,
              token: identity.token,
              order: orderOf(identity.receivedAt),
              // Wall clock, for surfaces comparing with a page's
              // (wall-anchored) navigation window: the monotonic arrival
              // stamp orders documents, but it lags the wall clock after a
              // sleep in a long-lived background. The backend's arrival wall
              // time when it has one — a record written after the release
              // (served unmodified, not served) must not read later.
              receivedAt: identity.wallAt ?? deps.now(),
              speculationRules: {
                removedFromDocument,
                headerRemoved: identity.speculationRulesHeader,
                guarded: identity.speculationGuard
              },
              copy,
              serviceWorkersBypassed: identity.serviceWorkersBypassed
            },
            'reject'
          );
    if (served === null) log.debug('Document identity not recordable — recorded without it');
    return served;
  };

  /** The engine runner in use, bounded past the budget (a runner that never answers is a failure). */
  const boundedRunner: DocumentTransformRunner = (request) =>
    bounded('Engine run', request.budgetMs + STEPS.runnerOverhead, () =>
      (backend?.runner ?? fallbackRunner)(request)
    );

  /**
   * Rewrite one eligible document of the tab's live session (see the seam).
   *
   * @param document The intercepted document.
   * @param expired Whether the host bound already passed.
   * @param abandoned Whether the backend stopped waiting.
   * @param extendBound Lengthens the host bound to a simulating session's —
   *   called once the session is known to simulate, before its preparation.
   */
  const rewriteForSession = async (
    document: InterceptedDocument,
    expired: () => boolean,
    abandoned: () => boolean,
    extendBound: () => void
  ): Promise<Uint8Array | null> => {
    if (!isRewritableResponse(document)) return null;
    const session = await activeFor(document.tabId, document.documentUrl);
    if (session === null) return null;
    if (session.simulate !== undefined) extendBound();
    const result = await rewriteDocument(
      document,
      session.set,
      boundedRunner,
      DOCUMENT_TRANSFORM_BUDGET_MS,
      session.simulate === undefined
        ? undefined
        : simulationPreparer(session.simulate, document, simulationSources)
    );
    if (result.cause !== undefined) {
      log.error(
        result.cause instanceof SimulationPreparationError
          ? 'Simulation inputs could not be prepared — document served unmodified'
          : 'Exclusion engine failed — document served unmodified',
        { tabId: document.tabId, cause: result.cause }
      );
    }
    // A copy-serving backend serves the original unless the exclusions
    // changed the document (a copy costs the page its real security state
    // and timing); its page guard removes the rules instead.
    const copies = document.identity?.servedAsCopy === true;
    let body = copies && result.rulesOnly === true ? null : result.body;
    let outcome = checkedOutcome(
      session,
      withServed(
        result.outcome,
        await servedIdentity(
          document,
          body === null ? 0 : (result.speculationRulesRemoved ?? 0),
          copies && body !== null
        )
      )
    );
    if (outcome === null) {
      log.error('Engine outcome failed validation — document served unmodified', {
        tabId: document.tabId
      });
      body = null;
      outcome = withServed(
        { outcome: 'failed', reason: 'engine-failed' },
        await servedIdentity(document, 0, false)
      );
    }
    // Stop or a re-apply may have landed while the engine ran, or the
    // backend may have served the original already: serve (and record) only
    // for the session that is still live and a backend still waiting.
    if (!(await stillLive(document.tabId, session.startedAt)) || expired() || abandoned()) {
      return null;
    }
    void driveQuietly(
      document.tabId,
      { type: 'document', startedAt: session.startedAt, outcome },
      'document record'
    );
    return body;
  };

  /**
   * Record that a session document was served as received (`reason`), with
   * its identity — ordered like any document, so a later page's record is
   * never replaced by it (a correction of the same response replaces its
   * own record: same order).
   */
  const recordUnserved = async (
    tabId: number,
    documentUrl: string,
    identity: InterceptedResponseIdentity | undefined,
    reason: 'body-unavailable' | 'not-served'
  ): Promise<void> => {
    const session = await activeFor(tabId, documentUrl);
    if (session === null) return;
    const served = await servedIdentity({ documentUrl, identity }, 0, false);
    await driveQuietly(
      tabId,
      {
        type: 'document',
        startedAt: session.startedAt,
        outcome: withServed({ outcome: 'failed', reason }, served)
      },
      'document record'
    );
  };

  const host: InterceptionHost = {
    shouldIntercept: (tabId, documentUrl) =>
      hostCall('shouldIntercept', null, async () => {
        const session = await activeFor(tabId, documentUrl);
        return session === null
          ? null
          : { rewriteBoundMs: rewriteDocumentBoundMs(session.simulate !== undefined) };
      }),

    // Bounded from the call: the exclusions-only bound, lengthened to the
    // simulating one only once the session read shows it simulates.
    rewriteDocument: (document, abandoned = () => false) => {
      let expired = false;
      return hostGuard(
        'rewriteDocument',
        null,
        (step) =>
          withinExtensibleDeadline(
            step,
            rewriteDocumentBoundMs(false),
            rewriteDocumentBoundMs(true),
            (extend) => rewriteForSession(document, () => expired, abandoned, extend),
            deps.schedule
          ),
        () => {
          expired = true;
        }
      );
    },

    documentBodyUnavailable: (tabId, documentUrl, identity) =>
      hostCall('documentBodyUnavailable', undefined, () =>
        recordUnserved(tabId, documentUrl, identity, 'body-unavailable')
      ),

    documentNotServed: (tabId, documentUrl, identity) =>
      hostCall('documentNotServed', undefined, () =>
        recordUnserved(tabId, documentUrl, identity, 'not-served')
      ),

    interceptionEnded: (tabId: number, cause: InterceptionEndCause, generation: number) =>
      hostCall('interceptionEnded', undefined, async () => {
        // The generation check makes proceeding safe even while the wake runs.
        await awaitReady('interception end handled anyway');
        await driveQuietly(
          tabId,
          { type: 'interception-ended', startedAt: generation, cause, at: deps.now() },
          'end'
        );
      })
  };

  try {
    backend = deps.createBackend(host);
  } catch (cause) {
    log.error('Interception backend failed to start — interception unavailable', cause);
    backend = null;
  }

  /** The overlay sender, or null (logged) when it cannot act for a page. */
  const pageSender = (
    sender: LooseMessageSender | undefined,
    row: string
  ): TopFrameSender | null => {
    const page = resolveTopFrameSender(sender);
    if (page === null)
      log.warn('Session ask from a sender that is not a top-frame http(s) page refused', { row });
    return page;
  };

  // ── Wake re-validation ─────────────────────────────────────────────────

  /** Whether the record's tab still exists; a failed or timed-out probe counts as present. */
  const probeTab = async (tabId: number): Promise<boolean> => {
    try {
      return await bounded('Tab probe', STEPS.tabProbe, () => deps.tabExists(tabId));
    } catch (cause) {
      // Kept: an active record is still re-validated through `resume` below.
      log.error('Wake tab probe failed — record kept', { tabId, cause });
      return true;
    }
  };

  /** Whether the backend confirms the tab's interception (false on any failure or timeout). */
  const resumeLive = async (
    tabId: number,
    generation: number,
    origin: string
  ): Promise<boolean> => {
    const resumer = backend;
    if (resumer === null) return false;
    try {
      return await bounded('Backend resume', STEPS.resume, () =>
        resumer.resume(tabId, generation, origin)
      );
    } catch (cause) {
      log.error('Wake resume failed — session treated as stale', { tabId, cause });
      return false;
    }
  };

  /** Re-validate one stored record at wake. */
  const revalidateRecord = async (tabId: number, record: ExclusionSessionRecord): Promise<void> => {
    if (!(await probeTab(tabId))) {
      await driveQuietly(tabId, { type: 'tab-closed' }, 'wake cleanup');
      return;
    }
    if (record.state !== 'active') return;
    if (!(await resumeLive(tabId, record.startedAt, record.origin))) {
      log.info('Stale session cleared at wake — tab served unmodified', { tabId });
      await driveQuietly(tabId, { type: 'stale' }, 'stale cleanup');
    }
  };

  /** One tab's status once the wake re-validation ran, queued behind its events. */
  const tabStatus = async (tabId: number, ask: string): Promise<ExclusionSessionStatus> => {
    await awaitReady('status answered from the stored record');
    return enqueueAsk(tabId, ask, () => readSession(tabId));
  };

  // ── Channels ───────────────────────────────────────────────────────────

  return {
    host,

    async apply(sender, data) {
      await awaitReady('apply proceeds');
      const page = pageSender(sender, 'applyExclusionSession');
      if (page === null) return { outcome: 'unavailable', cause: 'unsupported-page' };
      const payload = parseExclusionSetPayload(data);
      if (payload === null) throw new Error('applyExclusionSession: malformed payload refused');
      const notStored = notStoredRows(payload.set);
      if (notStored.length > 0) return invalidApplyReply(notStored);
      const problems = prevalidateExclusionSet(payload.set);
      if (!problems.valid) return invalidApplyReply(problems.invalid);
      const after = await enqueueAsk(page.tabId, 'applyExclusionSession', () =>
        drive(page.tabId, {
          type: 'apply',
          origin: page.origin,
          set: payload.set,
          ...withSimulate(payload.simulate),
          at: issueStart()
        })
      );
      const status = observableStatus(after);
      if (status.state === 'active') return { outcome: 'applying' };
      if (status.state === 'unavailable') return { outcome: 'unavailable', cause: status.cause };
      throw new Error(`applyExclusionSession: tab ${String(page.tabId)} could not be armed`);
    },

    async stop(sender) {
      await awaitReady('stop proceeds');
      const page = pageSender(sender, 'stopExclusionSession');
      if (page === null) return INACTIVE;
      const after = await enqueueAsk(page.tabId, 'stopExclusionSession', () =>
        drive(page.tabId, { type: 'stop' })
      );
      return observableStatus(after);
    },

    async status(sender) {
      await awaitReady('status answered from the stored record');
      const page = pageSender(sender, 'getExclusionSession');
      if (page === null) return INACTIVE;
      return enqueueAsk(page.tabId, 'getExclusionSession', () => readSession(page.tabId));
    },

    async savedSet(sender) {
      const page = pageSender(sender, 'getSavedExclusionSet');
      if (page === null) return { set: null };
      return {
        set: await bounded('Saved-set read', STEPS.store, () => deps.savedSets.get(page.origin))
      };
    },

    async save(sender, data) {
      const page = pageSender(sender, 'saveExclusionSet');
      if (page === null) return { outcome: 'not-saved', reason: 'unsupported-page' };
      const payload = parseExclusionSetPayload(data);
      if (payload === null) return { outcome: 'not-saved', reason: 'invalid-request' };
      try {
        await saveSet(page.origin, payload.set, payload.simulate);
        return { outcome: 'saved' };
      } catch (cause) {
        log.error('Exclusion set save failed', { cause });
        return { outcome: 'not-saved', reason: 'storage-failed' };
      }
    },

    async statusForTab(sender, data) {
      if (!isExtensionPageSender(sender, deps.extensionId)) {
        throw new Error('getExclusionSessionForTab: only extension pages may ask for a tab');
      }
      const query = parseExclusionSessionTabQuery(data);
      if (query === null) throw new Error('getExclusionSessionForTab: malformed query refused');
      return tabStatus(query.tabId, 'getExclusionSessionForTab');
    },

    tabStatus(tabId) {
      return tabStatus(tabId, 'tabStatus');
    },

    async tabClosed(tabId) {
      await awaitReady('tab-close cleanup proceeds');
      await driveQuietly(tabId, { type: 'tab-closed' }, 'tab-close cleanup');
    },

    revalidate() {
      const run = (async (): Promise<void> => {
        let records: ExclusionSessionRecords;
        try {
          records = await readAllSessions();
        } catch (cause) {
          log.error('Wake re-validation could not read the sessions', cause);
          return;
        }
        await Promise.all(
          Object.entries(records).map(([key, record]) => revalidateRecord(Number(key), record))
        );
      })();
      ready = run;
      return run;
    },

    async resetAll() {
      await awaitReady('reset proceeds');
      let records: ExclusionSessionRecords;
      try {
        records = await readAllSessions();
      } catch (cause) {
        log.error('Session reset could not read the sessions', cause);
        return;
      }
      await Promise.all(
        Object.keys(records).map((key) => driveQuietly(Number(key), { type: 'stop' }, 'reset'))
      );
    }
  };
}
