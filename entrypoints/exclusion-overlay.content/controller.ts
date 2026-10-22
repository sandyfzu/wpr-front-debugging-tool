/**
 * The overlay's controller: owns the view state machine, the draft and the
 * draft's autosave, performs every ask through the injected session port
 * and feeds the answers back as machine events. The views only read its
 * accessors and call its actions — no view talks to the port. Built on
 * Solid signals (created inside the caller's reactive root), with every
 * outside effect injected so the whole flow is unit-tested.
 */
import { batch, createEffect, createMemo, createSignal, type Accessor } from 'solid-js';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from '../../lib/exclusion-builder/set';
import type { InvalidExclusionRow } from '../../lib/exclusion-builder/errors';
import {
  EXCLUSION_SET_LIMITS,
  parseExclusionSet,
  type ExclusionSaveFailure,
  type ExclusionSessionStatus
} from '../../lib/messaging/exclusion-session';
import type { Logger } from '../../lib/logger';
import {
  LANE_ORDER,
  addCandidate,
  createIdSource,
  createRowValidator,
  draftChars,
  draftFromSet,
  draftToSet,
  insertRows,
  isBlankRow,
  laneFeature,
  pasteIntoRow,
  removeRow,
  sameSet,
  setDisable,
  trimRow,
  updateRow,
  type Draft,
  type LaneKey,
  type RowSelection,
  type ToggleKey
} from './exclusions/draft';
import { INITIAL_OVERLAY_STATE, canStart, overlayTransition } from './session/machine';
import type { OverlayEvent, OverlayState, SessionAction } from './session/machine';
import { matchServedDocument, type PageFacts } from './session/page-match';
import type { ExclusionSessionPort, PortOutcome, SessionProblem } from './session/port';
import { sessionView, type SessionView } from './session/session-view';

/** How long a typing pause waits before the draft is saved. */
export const AUTOSAVE_DELAY_MS = 800;

/**
 * How long an accepted apply may wait for the background's reload before
 * the view offers a manual reload (the arm itself is answered before the
 * reload, so the reload normally starts within a frame or two).
 */
export const RELOAD_STALL_MS = 8_000;

/** The draft's save state, as the footer shows it. */
export type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'not-saved'; readonly reason: ExclusionSaveFailure | SessionProblem };

/** Everything the controller needs from the outside. */
export interface OverlayControllerDeps {
  readonly port: ExclusionSessionPort;
  /** This page's facts, read when the view is derived (reactive when it is a signal). */
  readonly pageFacts: Accessor<PageFacts>;
  /** Epoch ms now. */
  readonly now: () => number;
  /** One-shot timer; returns its cancel (context-owned in production). */
  readonly schedule: (run: () => void, ms: number) => () => void;
  /** Reload the page (the user's manual reload). */
  readonly reload: () => void;
  readonly log: Pick<Logger, 'warn'>;
}

/** A row the editor should focus next (after an edit moved focus). */
export interface FocusRequest {
  readonly lane: LaneKey;
  readonly id: string;
}

/** The controller's surface. */
export interface OverlayController {
  readonly state: Accessor<OverlayState>;
  readonly draft: Accessor<Draft>;
  /** The session as it applies to this page (null until loaded). */
  readonly view: Accessor<SessionView | null>;
  readonly saveState: Accessor<SaveState>;
  /** The draft holds edits not in the active session's set. */
  readonly dirty: Accessor<boolean>;
  /** Rows with a problem (engine-named), counted over the whole draft. */
  readonly invalidCount: Accessor<number>;
  /** The latest focus request (a fresh object per request). */
  readonly focusRequest: Accessor<FocusRequest | null>;
  /**
   * A row's problem: the background's reason from the last refused apply
   * (until the row changes), else the engine's prevalidation.
   */
  rowProblem(lane: LaneKey, id: string, text: string): string | null;
  /** Start loading (call once, after mount). */
  start(): void;
  /**
   * Re-read the session status (the page came back from the back/forward
   * cache: pushes meant for it went to other documents meanwhile).
   */
  resync(): void;
  retryLoad(): void;
  /** Apply the draft (also the Retry of a retryable warning). */
  apply(): void;
  /** Discard edits and re-apply the active session's set. */
  reset(): void;
  stop(): void;
  dismissNotice(): void;
  /** Re-run the action whose failure the notice shows. */
  retryFailedAction(): void;
  reloadPage(): void;
  /** Whether the draft can be edited now (loaded, no action in flight). */
  readonly editable: Accessor<boolean>;
  editRow(lane: LaneKey, id: string, text: string): void;
  /**
   * Commit a row the user left: trim it the way WP Rocket's settings save
   * does, so the editor shows what would be stored (never while typing).
   */
  commitRow(lane: LaneKey, id: string): void;
  /**
   * Insert rows after a row (`null` = append), focusing the first one.
   *
   * @returns The new rows' ids (none at the lane cap).
   */
  insertRows(lane: LaneKey, texts: readonly string[], afterId: string | null): readonly string[];
  /**
   * Paste lines into a row at `selection` (its text before and after it is
   * kept), focusing the last row filled.
   */
  pasteRows(lane: LaneKey, id: string, text: string, selection: RowSelection): void;
  removeRow(lane: LaneKey, id: string): void;
  setDisable(key: ToggleKey, value: boolean): void;
  /**
   * Add a picked candidate.
   *
   * @param focus Move focus to its row (a pointer pick) or leave focus where
   *   it is (adding from the page list, several in a row).
   * @returns Whether a row was added (false: already there, or the lane is full).
   */
  addCandidate(lane: LaneKey, row: string, focus: boolean): boolean;
  /** Stop timers (call on teardown). */
  dispose(): void;
}

/**
 * Map an `invalid` answer's rows (feature + index in the applied set) back
 * to draft row ids — the applied set dropped blank rows, so the index
 * counts non-blank rows only.
 *
 * @param draft The draft that was applied.
 * @param invalid The background's invalid rows.
 */
export function invalidRowsById(
  draft: Draft,
  invalid: readonly InvalidExclusionRow[]
): Map<string, string> {
  const byId = new Map<string, string>();
  for (const problem of invalid) {
    const lane = LANE_ORDER.find((key) => laneFeature(key).id === problem.feature);
    if (lane === undefined) continue;
    const row = draft.rows[lane].filter((candidate) => !isBlankRow(candidate.text))[problem.index];
    if (row !== undefined) byId.set(row.id, problem.reason);
  }
  return byId;
}

/**
 * Build the controller.
 *
 * @param deps The injected outside world.
 */
export function createOverlayController(deps: OverlayControllerDeps): OverlayController {
  const nextId = createIdSource();
  const validate = createRowValidator();
  const [state, setState] = createSignal<OverlayState>(INITIAL_OVERLAY_STATE);
  const [draft, setDraftSignal] = createSignal<Draft>(draftFromSet(EMPTY_EXCLUSION_SET, nextId));
  const [saveState, setSaveState] = createSignal<SaveState>({ kind: 'idle' });
  const [serverInvalid, setServerInvalid] = createSignal<ReadonlyMap<string, string>>(new Map());
  const [focusRequest, setFocusRequest] = createSignal<FocusRequest | null>(null);
  /** The set last known stored (the autosave compares against it). */
  let lastSaved: ExclusionSet = EMPTY_EXCLUSION_SET;
  let cancelAutosave: (() => void) | null = null;
  let cancelStall: (() => void) | null = null;
  let disposed = false;
  let unsubscribe: (() => void) | null = null;
  /** A status push landed while the first asks were in flight (their answer may be older). */
  let pushedWhileLoading = false;
  /** The status before the last accepted apply (the stall fallback when a re-read fails). */
  let statusBeforeApply: ExclusionSessionStatus = { state: 'inactive' };

  const dispatch = (event: OverlayEvent): void => {
    setState((current) => overlayTransition(current, event));
  };

  const status = (): ExclusionSessionStatus | null => {
    const current = state();
    return current.phase === 'ready' ? current.status : null;
  };

  const view = createMemo<SessionView | null>(() => {
    const current = status();
    if (current === null) return null;
    return sessionView(current, (served) => matchServedDocument(served, deps.pageFacts()));
  });

  const draftSet = createMemo(() => draftToSet(draft()));

  const dirty = createMemo(() => {
    const current = status();
    return current?.state === 'active' && !sameSet(draftSet(), current.set);
  });

  const editable = createMemo(() => {
    const current = state();
    return current.phase === 'ready' && current.pending === null;
  });

  const rowProblem = (lane: LaneKey, id: string, text: string): string | null =>
    serverInvalid().get(id) ?? validate(lane, text);

  const invalidCount = createMemo(() => {
    let count = 0;
    const current = draft();
    for (const lane of LANE_ORDER) {
      for (const row of current.rows[lane])
        if (rowProblem(lane, row.id, row.text) !== null) count += 1;
    }
    return count;
  });

  // The fix-rows notice is true only while a row has a problem: it leaves
  // with the last one.
  createEffect(() => {
    const current = state();
    if (current.phase === 'ready' && current.notice?.kind === 'invalid' && invalidCount() === 0) {
      dispatch({ type: 'dismiss-notice' });
    }
  });

  /** Save the draft unless it equals what is stored. */
  const saveNow = async (set: ExclusionSet): Promise<void> => {
    if (sameSet(set, lastSaved)) {
      setSaveState({ kind: 'idle' });
      return;
    }
    // A draft the session's contract refuses would be refused anyway: say
    // so without asking (the marked rows say which).
    if (parseExclusionSet(set, 'reject') === null) {
      setSaveState({ kind: 'not-saved', reason: 'invalid-request' });
      return;
    }
    setSaveState({ kind: 'saving' });
    const outcome = await deps.port.save(set);
    if (disposed) return;
    if (outcome.kind === 'problem') {
      setSaveState({ kind: 'not-saved', reason: outcome.problem });
    } else if (outcome.reply.outcome === 'not-saved') {
      setSaveState({ kind: 'not-saved', reason: outcome.reply.reason });
    } else {
      lastSaved = set;
      // A newer edit may have been typed while the save was in flight.
      setSaveState(sameSet(draftSet(), set) ? { kind: 'saved' } : { kind: 'saving' });
    }
  };

  /** (Re)arm the autosave after an edit. */
  const scheduleAutosave = (): void => {
    cancelAutosave?.();
    // eslint-disable-next-line solid/reactivity -- a timer callback: reads the draft untracked, when it fires
    cancelAutosave = deps.schedule(() => {
      cancelAutosave = null;
      void saveNow(draftSet());
    }, AUTOSAVE_DELAY_MS);
  };

  /** Commit an edit to the draft. */
  const setDraft = (next: Draft): void => {
    if (next === draft()) return;
    setDraftSignal(next);
    if (state().phase === 'ready') scheduleAutosave();
  };

  /** Clear a row's background reason once it is edited. */
  const clearServerReason = (id: string): void => {
    if (!serverInvalid().has(id)) return;
    const next = new Map(serverInvalid());
    next.delete(id);
    setServerInvalid(next);
  };

  /** Load status + saved set; the draft starts from the active set, else the saved one. */
  const load = async (): Promise<void> => {
    const [current, savedReply] = await Promise.all([deps.port.status(), deps.port.savedSet()]);
    if (disposed) return;
    const problem = firstProblem(current, savedReply);
    if (problem !== null) {
      dispatch({ type: 'load-failed', problem });
      return;
    }
    if (current.kind !== 'reply' || savedReply.kind !== 'reply') return;
    // An active session's set is authoritative for the page, but the saved
    // draft holds edits made since the apply (an apply saves its set, so the
    // two differ only by those edits): reopen on the edits, marked dirty.
    const saved = savedReply.reply.set;
    const set =
      saved ?? (current.reply.state === 'active' ? current.reply.set : EMPTY_EXCLUSION_SET);
    lastSaved = saved ?? EMPTY_EXCLUSION_SET;
    batch(() => {
      setDraftSignal(draftFromSet(set, nextId));
      dispatch({ type: 'loaded', status: current.reply });
    });
    if (pushedWhileLoading) {
      pushedWhileLoading = false;
      void refreshStatus();
    }
  };

  /** Re-read the status (a push may have outrun the load's answer). */
  const refreshStatus = async (): Promise<void> => {
    const outcome = await deps.port.status();
    if (!disposed && outcome.kind === 'reply')
      dispatch({ type: 'status-pushed', status: outcome.reply });
  };

  /** Arm the overdue-reload exit once an apply is accepted. */
  const watchReload = (): void => {
    if (state().phase !== 'reloading') return;
    cancelStall?.();
    cancelStall = deps.schedule(() => {
      cancelStall = null;
      // The page is still here: read where the session stands and hand
      // the editor back (Reload / Stop / edit again).
      void deps.port.status().then((outcome) => {
        if (disposed) return;
        dispatch({
          type: 'reload-stalled',
          status: outcome.kind === 'reply' ? outcome.reply : statusBeforeApply
        });
      });
    }, RELOAD_STALL_MS);
  };

  /** Ask for an apply of `set`, already requested as `action`. */
  const runApply = async (action: SessionAction, applied: Draft): Promise<void> => {
    statusBeforeApply = status() ?? statusBeforeApply;
    dispatch({ type: 'request', action });
    const outcome = await deps.port.apply(draftToSet(applied));
    if (disposed) return;
    if (outcome.kind === 'problem') {
      dispatch({ type: 'action-failed', problem: outcome.problem });
      return;
    }
    if (outcome.reply.outcome === 'invalid') {
      setServerInvalid(invalidRowsById(applied, outcome.reply.invalid));
      focusFirstInvalid();
    }
    dispatch({ type: 'apply-answered', reply: outcome.reply, at: deps.now() });
    watchReload();
  };

  /** Move focus to the first row with a problem. */
  const focusFirstInvalid = (): void => {
    const current = draft();
    for (const lane of LANE_ORDER) {
      const row = current.rows[lane].find(
        (candidate) => rowProblem(lane, candidate.id, candidate.text) !== null
      );
      if (row !== undefined) {
        setFocusRequest({ lane, id: row.id });
        return;
      }
    }
  };

  const controller: OverlayController = {
    state,
    draft,
    view,
    saveState,
    dirty,
    invalidCount,
    focusRequest,
    rowProblem,
    start: () => {
      // eslint-disable-next-line solid/reactivity -- a push callback: reads the phase untracked, when a push lands
      unsubscribe = deps.port.onStatus((pushed) => {
        if (state().phase === 'loading') pushedWhileLoading = true;
        dispatch({ type: 'status-pushed', status: pushed });
      });
      void load();
    },
    resync: () => {
      if (state().phase === 'loading') pushedWhileLoading = true;
      else void refreshStatus();
    },
    retryLoad: () => {
      if (state().phase !== 'load-failed') return;
      dispatch({ type: 'retry-load' });
      void load();
    },
    apply: () => {
      if (!canStart(state(), 'apply')) return;
      if (invalidCount() > 0) {
        dispatch({ type: 'apply-blocked', block: { kind: 'invalid', rows: invalidCount() } });
        focusFirstInvalid();
        return;
      }
      if (draftChars(draft()) > EXCLUSION_SET_LIMITS.totalChars) {
        dispatch({ type: 'apply-blocked', block: { kind: 'too-large' } });
        return;
      }
      void runApply('apply', draft());
    },
    reset: () => {
      const current = status();
      if (current?.state !== 'active' || !canStart(state(), 'reset')) return;
      const restored = draftFromSet(current.set, nextId);
      batch(() => {
        setDraftSignal(restored);
        setServerInvalid(new Map());
      });
      void runApply('reset', restored);
    },
    stop: () => {
      if (!canStart(state(), 'stop')) return;
      dispatch({ type: 'request', action: 'stop' });
      void deps.port.stop().then((outcome) => {
        if (disposed) return;
        dispatch(
          outcome.kind === 'reply'
            ? { type: 'stop-answered', status: outcome.reply }
            : { type: 'action-failed', problem: outcome.problem }
        );
      });
    },
    dismissNotice: () => {
      dispatch({ type: 'dismiss-notice' });
    },
    retryFailedAction: () => {
      const current = state();
      if (current.phase !== 'ready' || current.notice?.kind !== 'action-failed') return;
      const action = current.notice.action;
      if (action === 'apply') controller.apply();
      else if (action === 'reset') controller.reset();
      else controller.stop();
    },
    editable,
    reloadPage: () => {
      deps.reload();
    },
    editRow: (lane, id, text) => {
      if (!editable()) return;
      clearServerReason(id);
      setDraft(updateRow(draft(), lane, id, text));
    },
    commitRow: (lane, id) => {
      // The trimmed row is the one already applied/validated: its background
      // reason (if any) still holds, so it is kept.
      if (editable()) setDraft(trimRow(draft(), lane, id));
    },
    insertRows: (lane, texts, afterId) => {
      if (!editable()) return [];
      const inserted = insertRows(draft(), lane, texts, afterId, nextId);
      setDraft(inserted.draft);
      const first = inserted.ids[0];
      if (first !== undefined) setFocusRequest({ lane, id: first });
      return inserted.ids;
    },
    pasteRows: (lane, id, text, selection) => {
      if (!editable()) return;
      const pasted = pasteIntoRow(draft(), lane, id, text, selection, nextId);
      const last = pasted.ids.at(-1);
      if (last === undefined) return;
      clearServerReason(id);
      setDraft(pasted.draft);
      setFocusRequest({ lane, id: last });
    },
    removeRow: (lane, id) => {
      if (!editable()) return;
      clearServerReason(id);
      const removed = removeRow(draft(), lane, id);
      setDraft(removed.draft);
      if (removed.focusId !== null) setFocusRequest({ lane, id: removed.focusId });
    },
    setDisable: (key, value) => {
      if (!editable()) return;
      setDraft(setDisable(draft(), key, value));
    },
    addCandidate: (lane, row, focus) => {
      if (!editable()) return false;
      const added = addCandidate(draft(), lane, row, nextId);
      setDraft(added.draft);
      if (focus && added.id !== null) setFocusRequest({ lane, id: added.id });
      return added.added;
    },
    dispose: () => {
      disposed = true;
      cancelAutosave?.();
      cancelStall?.();
      unsubscribe?.();
    }
  };
  return controller;
}

/** The first ask problem among the load's two answers. */
function firstProblem(...outcomes: readonly PortOutcome<unknown>[]): SessionProblem | null {
  for (const outcome of outcomes) if (outcome.kind === 'problem') return outcome.problem;
  return null;
}
