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
 *   detach vs a document record).
 * - **Arming is attempted, never assumed**; the session exists only once
 *   its record is stored (documents consult the record). No backend ⇒
 *   `unsupported-browser`.
 * - **Saving**: an apply saves the origin's set only when it answers
 *   `applying`; `saveExclusionSet` stores any wire-valid draft.
 * - **A stored record is a hint**: at wake every active record is
 *   re-validated through the backend (stale ⇒ cleared, served unmodified)
 *   before any ask or document is served; an install/update clears all.
 * - **Origin gate**: a session rewrites only documents of the origin it
 *   was applied from; other documents in the tab pass through untouched.
 * - Pushes tolerate the no-receiver case; every other failure is logged.
 */
import { createLogger, type Logger } from '../logger';
import { prevalidateExclusionSet } from '../exclusion-builder/validate';
import type { ExclusionSet } from '../exclusion-builder/set';
import {
  invalidApplyReply,
  parseExclusionSessionTabQuery,
  parseExclusionSetPayload,
  type ActiveExclusionSession,
  type ExclusionApplyReply,
  type ExclusionSaveReply,
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
import { parseUrl } from '../../utils/urls';
import type {
  InterceptedDocument,
  InterceptionBackend,
  InterceptionEndCause,
  InterceptionHost
} from './backend';
import {
  createInProcessTransformRunner,
  rewriteDocument,
  type DocumentTransformRunner
} from './document-transform';
import {
  observableStatus,
  transition,
  type SessionEffect,
  type SessionEvent,
  type SessionMachineState
} from './machine';

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
  save(origin: string, set: ExclusionSet): Promise<unknown>;
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
  /** The logger; defaults to the `exclusion-session` logger. */
  readonly log?: Logger;
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
  /** `tabs.onRemoved`. Never rejects. */
  tabClosed(tabId: number): Promise<void>;
  /** Wake re-validation of stored records; asks and documents wait for it. Never rejects. */
  revalidate(): Promise<void>;
  /** Extension install/update: end every session (unmodified rendering restored). Never rejects. */
  resetAll(): Promise<void>;
  /** The host side handed to the backend. */
  readonly host: InterceptionHost;
}

/** The inactive status. */
const INACTIVE: ExclusionSessionStatus = { state: 'inactive' };

/**
 * A per-key serial queue: tasks for one key run one after another; keys
 * are independent; an idle key holds no memory.
 */
function createKeyedQueue(): <T>(key: number, task: () => Promise<T>) => Promise<T> {
  const tails = new Map<number, Promise<unknown>>();
  return <T>(key: number, task: () => Promise<T>): Promise<T> => {
    const run = (tails.get(key) ?? Promise.resolve()).then(task);
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
}

/** The canonical origin of a URL, or null. */
function originOf(url: string): string | null {
  return parseUrl(url)?.origin ?? null;
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
  /** Settles once the wake re-validation ran; asks and documents wait for it. */
  let ready: Promise<void> = Promise.resolve();
  let backend: InterceptionBackend | null = null;

  /** Push a status to the tab and the panels; a missing receiver is expected. */
  const notify = async (tabId: number, status: ExclusionSessionStatus): Promise<void> => {
    const pushes: [string, () => Promise<unknown>][] = [
      ['tab', () => deps.pushToTab(tabId, status)],
      ['panels', () => deps.pushToPanels(tabId, status)]
    ];
    await Promise.all(
      pushes.map(async ([target, push]) => {
        try {
          await push();
        } catch (cause) {
          if (isNoReceiverError(cause))
            log.debug('Session push without a listener (expected)', { tabId, target });
          else log.error('Session push failed', { tabId, target, cause });
        }
      })
    );
  };

  /**
   * The arm activity: the live-session cap, the backend attempt, and the
   * active record's store — the event that settles the arming state.
   */
  const runArm = async (tabId: number, state: SessionMachineState): Promise<SessionEvent> => {
    if (state.state !== 'arming') return { type: 'arm-failed' };
    if (backend === null)
      return { type: 'arm-unavailable', cause: 'unsupported-browser', at: deps.now() };
    try {
      const records = await deps.sessions.readAll();
      const othersActive = Object.entries(records).filter(
        ([key, record]) => key !== String(tabId) && record.state === 'active'
      ).length;
      // Checked before attaching anything; the store re-checks on write (another tab may race).
      if (othersActive >= EXCLUSION_SESSION_LIMIT)
        return { type: 'arm-unavailable', cause: 'session-limit', at: deps.now() };
      const armed = await backend.arm(tabId);
      if (!armed.armed) return { type: 'arm-unavailable', cause: armed.cause, at: deps.now() };
      const record: ActiveExclusionSession = {
        state: 'active',
        origin: state.origin,
        set: state.set,
        startedAt: state.startedAt,
        document: null
      };
      const stored = await deps.sessions.put(tabId, record);
      if (stored === 'limit-reached') {
        return { type: 'arm-unavailable', cause: 'session-limit', at: deps.now() };
      }
      return { type: 'armed' };
    } catch (cause) {
      log.error('Arming failed unexpectedly — no session started', { tabId, cause });
      return { type: 'arm-failed' };
    }
  };

  /** Perform one effect; failures are logged (a `clear` failure is rethrown for Stop). */
  const perform = async (tabId: number, effect: SessionEffect): Promise<void> => {
    switch (effect.kind) {
      case 'arm':
        return; // driven by `drive` (its result is the next event)
      case 'disarm':
        if (backend === null) return;
        try {
          await backend.disarm(tabId);
        } catch (cause) {
          log.error('Disarm failed', { tabId, cause });
        }
        return;
      case 'store':
        try {
          const stored = await deps.sessions.put(tabId, effect.record);
          if (stored === 'limit-reached') log.warn('Session record refused at the cap', { tabId });
        } catch (cause) {
          log.error('Session record write failed', { tabId, cause });
        }
        return;
      case 'clear':
        await deps.sessions.remove(tabId);
        return;
      case 'save-set':
        try {
          await deps.savedSets.save(effect.origin, effect.set);
        } catch (cause) {
          log.error('Applied set not saved for its origin', { tabId, cause });
        }
        return;
      case 'reload':
        try {
          deps.reload(tabId);
        } catch (cause) {
          log.error('Tab reload could not be scheduled', { tabId, cause });
        }
        return;
      case 'notify':
        await notify(tabId, effect.status);
        return;
    }
  };

  /**
   * Run every effect in order. A failed `clear` is collected and rethrown
   * once the rest ran (the caller decides: Stop reports it, others log).
   */
  const performAll = async (tabId: number, effects: readonly SessionEffect[]): Promise<void> => {
    let clearFailure: Error | null = null;
    for (const effect of effects) {
      try {
        await perform(tabId, effect);
      } catch (cause) {
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
    let state: SessionMachineState = await deps.sessions.read(tabId);
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

  /** The tab's active session for a document URL, or null (no session, another origin). */
  const activeFor = async (
    tabId: number,
    documentUrl: string
  ): Promise<ActiveExclusionSession | null> => {
    await ready;
    try {
      const status = await deps.sessions.read(tabId);
      return status.state === 'active' && originOf(documentUrl) === status.origin ? status : null;
    } catch (cause) {
      log.error('Session read failed — document served unmodified', { tabId, cause });
      return null;
    }
  };

  const host: InterceptionHost = {
    shouldIntercept: async (tabId, documentUrl) => (await activeFor(tabId, documentUrl)) !== null,

    rewriteDocument: async (document: InterceptedDocument) => {
      const session = await activeFor(document.tabId, document.documentUrl);
      if (session === null) return null;
      const result = await rewriteDocument(
        document,
        session.set,
        backend?.runner ?? fallbackRunner
      );
      if (result.cause !== undefined) {
        log.error('Exclusion engine failed — document served unmodified', {
          tabId: document.tabId,
          cause: result.cause
        });
      }
      void driveQuietly(
        document.tabId,
        { type: 'document', startedAt: session.startedAt, outcome: result.outcome },
        'document record'
      );
      return result.body;
    },

    documentBodyUnavailable: async (tabId, documentUrl) => {
      const session = await activeFor(tabId, documentUrl);
      if (session === null) return;
      await driveQuietly(
        tabId,
        {
          type: 'document',
          startedAt: session.startedAt,
          outcome: { outcome: 'failed', reason: 'body-unavailable' }
        },
        'document record'
      );
    },

    interceptionEnded: async (tabId: number, cause: InterceptionEndCause) => {
      await ready;
      await driveQuietly(tabId, { type: 'interception-ended', cause, at: deps.now() }, 'end');
    }
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

  /** Re-validate one stored record at wake. */
  const revalidateRecord = async (tabId: number, record: ExclusionSessionRecord): Promise<void> => {
    let exists: boolean;
    try {
      exists = await deps.tabExists(tabId);
    } catch (cause) {
      log.error('Wake tab probe failed — record kept', { tabId, cause });
      return;
    }
    if (!exists) {
      await driveQuietly(tabId, { type: 'tab-closed' }, 'wake cleanup');
      return;
    }
    if (record.state !== 'active') return;
    let live = false;
    try {
      live = backend !== null && (await backend.resume(tabId));
    } catch (cause) {
      log.error('Wake resume failed — session treated as stale', { tabId, cause });
    }
    if (!live) {
      log.info('Stale session cleared at wake — tab served unmodified', { tabId });
      await driveQuietly(tabId, { type: 'stale' }, 'stale cleanup');
    }
  };

  return {
    host,

    async apply(sender, data) {
      await ready;
      const page = pageSender(sender, 'applyExclusionSession');
      if (page === null) return { outcome: 'unavailable', cause: 'unsupported-page' };
      const payload = parseExclusionSetPayload(data);
      if (payload === null) throw new Error('applyExclusionSession: malformed payload refused');
      const problems = prevalidateExclusionSet(payload.set);
      if (!problems.valid) return invalidApplyReply(problems.invalid);
      const after = await enqueue(page.tabId, () =>
        drive(page.tabId, { type: 'apply', origin: page.origin, set: payload.set, at: deps.now() })
      );
      const status = observableStatus(after);
      if (status.state === 'active') return { outcome: 'applying' };
      if (status.state === 'unavailable') return { outcome: 'unavailable', cause: status.cause };
      throw new Error(`applyExclusionSession: tab ${String(page.tabId)} could not be armed`);
    },

    async stop(sender) {
      await ready;
      const page = pageSender(sender, 'stopExclusionSession');
      if (page === null) return INACTIVE;
      const after = await enqueue(page.tabId, () => drive(page.tabId, { type: 'stop' }));
      return observableStatus(after);
    },

    async status(sender) {
      await ready;
      const page = pageSender(sender, 'getExclusionSession');
      if (page === null) return INACTIVE;
      return enqueue(page.tabId, () => deps.sessions.read(page.tabId));
    },

    async savedSet(sender) {
      const page = pageSender(sender, 'getSavedExclusionSet');
      if (page === null) return { set: null };
      return { set: await deps.savedSets.get(page.origin) };
    },

    async save(sender, data) {
      const page = pageSender(sender, 'saveExclusionSet');
      if (page === null) return { outcome: 'not-saved', reason: 'unsupported-page' };
      const payload = parseExclusionSetPayload(data);
      if (payload === null) return { outcome: 'not-saved', reason: 'invalid-request' };
      try {
        await deps.savedSets.save(page.origin, payload.set);
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
      await ready;
      return enqueue(query.tabId, () => deps.sessions.read(query.tabId));
    },

    async tabClosed(tabId) {
      await ready;
      await driveQuietly(tabId, { type: 'tab-closed' }, 'tab-close cleanup');
    },

    revalidate() {
      const run = (async (): Promise<void> => {
        let records: ExclusionSessionRecords;
        try {
          records = await deps.sessions.readAll();
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
      await ready;
      let records: ExclusionSessionRecords;
      try {
        records = await deps.sessions.readAll();
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
