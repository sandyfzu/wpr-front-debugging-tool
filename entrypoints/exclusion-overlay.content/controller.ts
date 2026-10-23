/**
 * The overlay's controller: owns the view state machine, the draft and the
 * draft's autosave, performs every ask through the injected session port
 * and feeds the answers back as machine events. The views only read its
 * accessors and call its actions — no view talks to the port. Built on
 * Solid signals (created inside the caller's reactive root), with every
 * outside effect injected so the whole flow is unit-tested.
 */
import { batch, createEffect, createMemo, createSignal, type Accessor } from 'solid-js';
import { stepFor } from '../../utils/stepped';
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
  commitAll,
  commitRows,
  startCommit,
  createIdSource,
  createRowCarry,
  createRowValidator,
  draftChars,
  draftFromSet,
  draftToSet,
  restoreDraft,
  insertRows,
  isBlankRow,
  laneFeature,
  pasteIntoRow,
  reinsertRow,
  removeRow,
  blankRowWarning,
  sameSet,
  setDisable,
  updateRow,
  type Committed,
  type Draft,
  type DraftRow,
  type LaneKey,
  type Pasted,
  type RowCheck,
  type RowCommit,
  type RowSelection,
  type ToggleKey
} from './exclusions/draft';
import {
  EMPTY_DRAFT_NOTES,
  forgetRow,
  recordCommits,
  retireLane,
  takeUndo,
  type CommitSource,
  type DraftNotes
} from './exclusions/row-notes';
import { rowVerdict, type LanePage, type RowVerdict } from './exclusions/lane-page';
import { createSetReadings } from './exclusions/set-readings';
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
  /** Monotonic ms now, for timing a long paste's slices (default `performance.now`). */
  readonly clock?: () => number;
  /**
   * The most a paste lands at once (default {@link PASTE_AT_ONCE}); a longer
   * one is sliced. Tests compare the two paths with it.
   */
  readonly pasteAtOnce?: PasteBounds;
}

/** How much a paste may commit in one task: rows and their characters. */
export interface PasteBounds {
  readonly rows: number;
  readonly chars: number;
}

/**
 * A row's non-blocking warning: `applied` — WP Rocket applies the row as
 * stored and so does the preview (it matches every element, or it turns
 * the feature off on the page); `blank` — a blank row WP Rocket would
 * accept, which the editor leaves out.
 */
export interface RowWarning {
  readonly reason: string;
  readonly kind: 'applied' | 'blank';
}

/** A row the editor should focus next (after an edit moved focus). */
export interface FocusRequest {
  readonly lane: LaneKey;
  readonly id: string;
  /** Where the caret goes in the row (default: where focus puts it). */
  readonly caret?: number;
}

/**
 * What a paste did: `pasted` (every line in), `dropped` (the lane cap left
 * `lines` pasted lines out), `lane-full` (nothing pasted: the lane holds no
 * more rows), `ignored` (not editable now, or an unknown row), `failed` (a
 * long paste broke while committing: nothing landed, the editor is free).
 */
export type SettledPasteOutcome =
  | { readonly kind: 'pasted' | 'lane-full' | 'ignored' | 'failed' }
  | { readonly kind: 'dropped'; readonly lines: number };

/**
 * A paste's outcome: settled at once, or `pending` for a long paste, which
 * commits its rows a slice per task (see {@link TASK_SLICE_MS}) and lands in
 * the draft in one step when `done` settles.
 */
export type PasteOutcome =
  SettledPasteOutcome | { readonly kind: 'pending'; readonly done: Promise<SettledPasteOutcome> };

/**
 * The most a paste commits at once, in the paste's own task. Checking a row
 * costs about linearly in its characters (and more for rows dense in
 * character classes), so both bound it: within them the task stays well
 * under 50 ms at 4× CPU throttle even for the costliest rows, measured.
 * A longer paste is committed in slices (see {@link TASK_SLICE_MS}),
 * holding edits until its rows land in the draft at once.
 */
export const PASTE_AT_ONCE: PasteBounds = { rows: 64, chars: 16 * 1024 };

/**
 * The time one slice of long work runs for — a long paste's commit, a
 * lane's set reading — in elapsed ms on the page (at least one row each,
 * so it always progresses): a task stays near this
 * whatever the CPU speed and the rows cost — under 50 ms at 4× throttle
 * with the costliest row's overrun (measured ≤ 25 ms); shorter slices only
 * add per-task overhead to the paste's total time.
 */
export const TASK_SLICE_MS = 16;

/**
 * Whether a paste's rows to commit fit in one task (see {@link PASTE_AT_ONCE}).
 *
 * @param rows The pasted lane's rows.
 * @param targets The rows to commit, by id.
 * @param bounds The bounds.
 */
export function fitsAtOnce(
  rows: readonly { readonly id: string; readonly text: string }[],
  targets: readonly string[],
  bounds: PasteBounds
): boolean {
  if (targets.length > bounds.rows) return false;
  const wanted = new Set(targets);
  let chars = 0;
  for (const row of rows) {
    if (!wanted.has(row.id)) continue;
    chars += row.text.length;
    if (chars > bounds.chars) return false;
  }
  return true;
}

/** An action a long paste holds until its rows land (see {@link OverlayController.pasting}). */
type HeldAction =
  | { readonly kind: 'commit-row'; readonly lane: LaneKey; readonly id: string }
  | { readonly kind: 'commit-lane'; readonly lane: LaneKey }
  | { readonly kind: 'apply' | 'reset' | 'stop' };

/** How a long paste's sliced commit ended. */
type SlicedOutcome =
  | { readonly kind: 'committed'; readonly committed: Committed }
  | { readonly kind: 'failed'; readonly cause: unknown };

/** The controller's surface. */
export interface OverlayController {
  readonly state: Accessor<OverlayState>;
  readonly draft: Accessor<Draft>;
  /** The session as it applies to this page (null until loaded). */
  readonly view: Accessor<SessionView | null>;
  readonly saveState: Accessor<SaveState>;
  /** The draft holds edits not in the active session's set. */
  readonly dirty: Accessor<boolean>;
  /** Rows with a blocking problem (engine-named), counted over the whole draft. */
  readonly invalidCount: Accessor<number>;
  /** The latest focus request (a fresh object per request). */
  readonly focusRequest: Accessor<FocusRequest | null>;
  /**
   * A lane's rows read as one set, as WP Rocket runs them on the page (its
   * page state and the rows behind a page-wide failure); `null` for a lane
   * whose rows act alone.
   */
  lanePage(lane: LaneKey): LanePage | null;
  /**
   * What the editor tells about committed rows — WP Rocket's save applied
   * at commit (stored form, drop and its reason, unverified, safe-mode flag,
   * each with the typed text): row notes, removals and the latest batch to
   * announce, with their undo state.
   */
  readonly notes: Accessor<DraftNotes>;
  /**
   * A row's blocking problem: the background's reason from the last refused
   * apply (until the row changes), else the engine's prevalidation — the
   * lane's rows read as one set first (its verdict on a row it read wins:
   * problems that exist only joined, and rows it reads as warnings), then
   * the row alone.
   */
  rowProblem(lane: LaneKey, id: string, text: string): string | null;
  /**
   * A row's non-blocking warning (never with a problem), read like
   * {@link OverlayController.rowProblem}; else a blank row's warning.
   */
  rowWarning(lane: LaneKey, id: string, text: string): RowWarning | null;
  /** Start loading (call once, after mount). */
  start(): void;
  /**
   * Re-read the session status (the page came back from the back/forward
   * cache: pushes meant for it went to other documents meanwhile).
   */
  resync(): void;
  retryLoad(): void;
  /** Apply the draft (also the Retry of a retryable warning); after a long paste lands. */
  apply(): void;
  /** Discard edits and re-apply the active session's set; after a long paste lands. */
  reset(): void;
  stop(): void;
  dismissNotice(): void;
  /** Re-run the action whose failure the notice shows. */
  retryFailedAction(): void;
  reloadPage(): void;
  /** Whether the draft can be edited now (loaded, no action in flight, no long paste landing). */
  readonly editable: Accessor<boolean>;
  /**
   * A long paste is committing (see {@link TASK_SLICE_MS}): editing waits;
   * row and lane commits, Apply and Reset asked meanwhile run, in order, once
   * its rows land.
   */
  readonly pasting: Accessor<boolean>;
  /**
   * An Apply waits for the set readings of rows not read yet (read in
   * slices): editing waits, and actions asked meanwhile queue behind it.
   */
  readonly checking: Accessor<boolean>;
  editRow(lane: LaneKey, id: string, text: string): void;
  /**
   * Commit a row the user left: it becomes the form WP Rocket's settings
   * save stores, or leaves the lane when the save drops it (never while
   * typing). Works in any phase (a row left while an action is in flight is
   * committed at once); it saves the draft only when ready. While a long
   * paste lands it waits for the paste (it commits the rows the paste made).
   *
   * @returns What the commit did to the row (null: blank or unknown row, or
   *   waiting for a long paste).
   */
  commitRow(lane: LaneKey, id: string): RowCommit | null;
  /**
   * Undo a commit's change from its note (kept row: its typed text back;
   * removed row: back at its place, typed), focusing the row for editing.
   * Leaving the row commits it again, with the same note.
   *
   * @param id The row, or the removed row's former id.
   * @returns Whether anything was put back (false: not editable now, no
   *   undo for that note any more, or no room in the lane).
   */
  undoCommit(lane: LaneKey, id: string): boolean;
  /**
   * Commit every row of a lane (before its rows are copied: a row still
   * being typed must be copied in its stored form). Works in any phase;
   * waits for a long paste like {@link OverlayController.commitRow}.
   */
  commitLane(lane: LaneKey): void;
  /**
   * Insert rows after a row (`null` = append), focusing the first one.
   *
   * @returns The new rows' ids (none at the lane cap).
   */
  insertRows(lane: LaneKey, texts: readonly string[], afterId: string | null): readonly string[];
  /**
   * Paste lines into a row at `selection` (its text before and after it is
   * kept), focusing the last row filled with the caret after the pasted text.
   *
   * @returns What the paste did (the caller says so when lines were left
   *   out) — `pending` while a long paste commits, editing held meanwhile.
   */
  pasteRows(lane: LaneKey, id: string, text: string, selection: RowSelection): PasteOutcome;
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
  /** Every row's own save and check, read once per row object (see `RowCarry`). */
  const carry = createRowCarry(validate);
  const [state, setState] = createSignal<OverlayState>(INITIAL_OVERLAY_STATE);
  const [draft, setDraftSignal] = createSignal<Draft>(draftFromSet(EMPTY_EXCLUSION_SET, nextId));
  const [saveState, setSaveState] = createSignal<SaveState>({ kind: 'idle' });
  const [serverInvalid, setServerInvalid] = createSignal<ReadonlyMap<string, string>>(new Map());
  const [focusRequest, setFocusRequest] = createSignal<FocusRequest | null>(null);
  const [notes, setNotes] = createSignal<DraftNotes>(EMPTY_DRAFT_NOTES);
  /**
   * What holds the draft: a long paste committing (its rows land at once),
   * or an Apply waiting for the set readings; edits wait, and commits,
   * Apply, Reset and Stop asked meanwhile queue (see `afterPaste`).
   */
  const [hold, setHold] = createSignal<'paste' | 'readings' | null>(null);
  /** An Apply waits for the set readings (see `apply`). */
  let waitingForReadings = false;
  /** Runs a long paste's remaining slices at once (the overlay is closing: it lands, then saves). */
  let finishPaste: (() => void) | null = null;
  /** Cancels the task that runs the held actions after a landing. */
  let cancelHeldRun: (() => void) | null = null;
  /**
   * Actions asked while a long paste holds the draft, run in order in the
   * task after it lands: the paste lands on the draft and selection it
   * started from, as a short paste would have before them.
   */
  const afterPaste: HeldAction[] = [];
  const atOnce = deps.pasteAtOnce ?? PASTE_AT_ONCE;
  const clock = deps.clock ?? (() => performance.now());
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
    return current.phase === 'ready' && current.pending === null && hold() === null;
  });

  /** Rows edited since their last commit (their commit runs against the rows already there). */
  const uncommitted = new Set<string>();
  const setReadings = createSetReadings({
    draft,
    uncommitted,
    carry,
    schedule: deps.schedule,
    clock,
    sliceMs: TASK_SLICE_MS,
    lanes: LANE_ORDER
  });
  const lanePage = (lane: LaneKey): LanePage | null => setReadings.page(lane);

  /** Each lane's rows by id (rebuilt once per change of the lane, not per read). */
  const rowsById = new Map<LaneKey, Accessor<ReadonlyMap<string, DraftRow>>>();
  for (const lane of LANE_ORDER) {
    const byId = createMemo(() => new Map(draft().rows[lane].map((row) => [row.id, row])));
    // eslint-disable-next-line solid/reactivity -- read by `rowCheck`, inside the views' and counts' tracked scopes
    rowsById.set(lane, byId);
  }

  /**
   * A row's check: carried by its draft row (read once per row object),
   * else — a text the draft does not hold for that id — read by text.
   */
  const rowCheck = (lane: LaneKey, id: string, text: string): RowCheck | null => {
    const row = rowsById.get(lane)?.().get(id);
    return row?.text === text ? carry.check(lane, row) : validate(lane, text);
  };

  /** A row's verdict as the engine reads it (the server's reason aside). */
  const verdict = (lane: LaneKey, id: string, text: string): RowVerdict =>
    rowVerdict(lanePage(lane), id, rowCheck(lane, id, text));

  const rowProblem = (lane: LaneKey, id: string, text: string): string | null =>
    serverInvalid().get(id) ?? verdict(lane, id, text).problem;

  const rowWarning = (lane: LaneKey, id: string, text: string): RowWarning | null => {
    if (serverInvalid().has(id)) return null;
    const { problem, warning } = verdict(lane, id, text);
    if (problem !== null) return null;
    if (warning !== null) return { reason: warning, kind: 'applied' };
    const blank = blankRowWarning(lane, text);
    return blank === null ? null : { reason: blank, kind: 'blank' };
  };

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
  // with the last one (judged once the set readings caught up with the rows).
  createEffect(() => {
    const current = state();
    if (
      current.phase === 'ready' &&
      current.notice?.kind === 'invalid' &&
      setReadings.settled() &&
      invalidCount() === 0
    ) {
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

  /**
   * Save now an edit the autosave was still waiting to save (the overlay is
   * closing: a pause shorter than the autosave's must not lose the edit).
   */
  const flushAutosave = (): void => {
    if (cancelAutosave === null) return;
    cancelAutosave();
    cancelAutosave = null;
    // Not the memo: the reactive root may already be gone.
    void saveNow(draftToSet(draft()));
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

  /**
   * Take a commit: store its draft and record its notes (rows stored as
   * typed are not news).
   *
   * @param source What made the commit (the announcement's wording).
   * @returns The committed draft.
   */
  const takeCommit = (committed: Committed, source: CommitSource): Draft => {
    // The notes are computed before anything is written: a throw there changes nothing.
    const nextNotes = recordCommits(notes(), committed.commits, source, committed.draft);
    for (const { id } of committed.commits) uncommitted.delete(id);
    batch(() => {
      setDraft(committed.draft);
      setNotes(nextNotes);
    });
    return committed.draft;
  };

  /** Record a commit's notes (a batch without news changes nothing). */
  const publishCommits = (committed: Committed, source: CommitSource): void => {
    setNotes((current) => recordCommits(current, committed.commits, source, committed.draft));
  };

  /**
   * Land a paste in the draft in one step: its rows committed (all but the
   * caret's), its notes, and focus on the last filled row with the caret.
   *
   * @param lane The pasted lane.
   * @param id The row pasted into.
   * @param pasted The paste's rows.
   * @param commit The paste's commit (run now, or already run in slices).
   * @param focus Ask for focus on the last filled row (not when the user
   *   left the row while a long paste committed: focus stays where it went).
   */
  const landPaste = (
    lane: LaneKey,
    id: string,
    pasted: Pasted,
    commit: () => Committed,
    focus = true
  ): SettledPasteOutcome => {
    const last = pasted.ids.at(-1);
    if (last === undefined) return { kind: pasted.dropped > 0 ? 'lane-full' : 'ignored' };
    // Atomic: everything is computed first (a throw there writes nothing),
    // then written in one step; once the draft holds the paste it landed,
    // whatever its consumers do next.
    const committed = commit();
    const previousNotes = notes();
    const nextNotes = recordCommits(
      forgetRow(previousNotes, lane, id),
      committed.commits,
      'paste',
      committed.draft
    );
    const invalid = serverInvalid();
    const nextInvalid = invalid.has(id) ? withoutKey(invalid, id) : invalid;
    try {
      batch(() => {
        setServerInvalid(nextInvalid);
        setNotes(nextNotes);
        setDraftSignal(committed.draft);
      });
    } catch (cause) {
      // Thrown by something reacting to the writes: landed if the draft holds the paste.
      if (draft() !== committed.draft) {
        batch(() => {
          setServerInvalid(invalid);
          setNotes(previousNotes);
        });
        throw cause;
      }
      deps.log.warn(`a reaction to a paste landing in ${lane} failed`, cause);
    }
    for (const { id: committedId } of committed.commits) uncommitted.delete(committedId);
    uncommitted.add(last);
    // The paste is in the draft: it landed whatever fails next. The autosave
    // goes first, so a throw reacting to the focus request cannot keep a
    // close from saving the paste the user saw land; each step fails alone.
    try {
      if (state().phase === 'ready') scheduleAutosave();
    } catch (cause) {
      // A later edit re-arms it.
      deps.log.warn(`arming the autosave after a paste landed in ${lane} failed`, cause);
    }
    if (focus) {
      try {
        setFocusRequest({
          lane,
          id: last,
          ...(pasted.caret === null ? {} : { caret: pasted.caret })
        });
      } catch (cause) {
        deps.log.warn(`a reaction to focusing a paste landed in ${lane} failed`, cause);
      }
    }
    return pasted.dropped > 0 ? { kind: 'dropped', lines: pasted.dropped } : { kind: 'pasted' };
  };

  /**
   * Commit a long paste's rows a slice per task, checking each kept row as
   * it goes (so the draft update reads every row's verdict from the cache).
   * Never rejects: a throw settles as `failed`.
   *
   * @param pastedDraft The draft with the pasted rows in.
   * @param lane The pasted lane.
   * @param ids The rows to commit.
   */
  const commitInSlices = (
    pastedDraft: Draft,
    lane: LaneKey,
    ids: readonly string[]
  ): Promise<SlicedOutcome> =>
    new Promise((resolve) => {
      let commit: ReturnType<typeof startCommit>;
      try {
        commit = startCommit(pastedDraft, lane, ids, {
          carry,
          // Read each kept row while its readings are fresh in the memos: once
          // the paste lands, every row's check and save is carried, never redone.
          onKept: (row) => {
            carry.check(lane, row);
            carry.save(lane, row);
          }
        });
      } catch (cause) {
        resolve({ kind: 'failed', cause });
        return;
      }
      /**
       * Commit rows for `ms` (at least one); settle once done or broken.
       *
       * @returns Whether it settled.
       */
      const run = (ms: number): boolean => {
        try {
          if (!stepFor(() => commit.step(1), clock, ms)) return false;
          resolve({ kind: 'committed', committed: commit.result() });
        } catch (cause) {
          resolve({ kind: 'failed', cause });
        }
        return true;
      };
      const slice = (): void => {
        finishPaste = null;
        if (run(TASK_SLICE_MS)) return;
        const cancel = deps.schedule(slice, 0);
        finishPaste = () => {
          cancel();
          finishPaste = null;
          run(Number.POSITIVE_INFINITY);
        };
      };
      slice();
    });

  /**
   * Settle a long paste once its slices ran: land it (unless it broke), then
   * release the hold.
   *
   * @param lane The pasted lane.
   * @param id The row pasted into.
   * @param pasted The paste's rows.
   * @param sliced How its commit ended.
   */
  const settleLongPaste = (
    lane: LaneKey,
    id: string,
    pasted: Pasted,
    sliced: SlicedOutcome
  ): SettledPasteOutcome => {
    let outcome: SettledPasteOutcome = { kind: 'failed' };
    if (sliced.kind === 'failed') {
      deps.log.warn(`paste of ${String(pasted.ids.length)} rows into ${lane} failed`, sliced.cause);
    } else {
      try {
        outcome = landPaste(lane, id, pasted, () => sliced.committed, !leftDuringHold(lane, id));
        retargetLeave(lane, id, pasted.ids.at(-1));
      } catch (cause) {
        deps.log.warn(`landing a paste into ${lane} failed`, cause);
      }
    }
    releaseHold(outcome.kind !== 'failed');
    return outcome;
  };

  /**
   * Whether the user left the pasted row while the paste was committing.
   *
   * @param lane The pasted lane.
   * @param id The row pasted into.
   */
  const leftDuringHold = (lane: LaneKey, id: string): boolean =>
    afterPaste.some(
      (action) => action.kind === 'commit-row' && action.lane === lane && action.id === id
    );

  /**
   * Point a held leave of the pasted row at the row the caret landed in: a
   * paste landing at once moves focus there, so leaving commits that row
   * (the pasted row itself was committed with the paste).
   *
   * @param lane The pasted lane.
   * @param id The row pasted into.
   * @param last The last filled row (none when nothing was pasted).
   */
  const retargetLeave = (lane: LaneKey, id: string, last: string | undefined): void => {
    if (last === undefined) return;
    afterPaste.forEach((action, index) => {
      if (action.kind === 'commit-row' && action.lane === lane && action.id === id)
        afterPaste[index] = { ...action, id: last };
    });
  };

  /**
   * End a paste's hold: run the held actions in a task of their own (an
   * Apply must not share the landing's task), editing still held until then
   * so later actions queue behind them. After a failed paste only the held
   * commits run (the user reads why before any Apply, Reset or Stop); a
   * closing overlay runs only the held commits too, at once, then saves.
   *
   * @param landed Whether the paste landed.
   */
  const releaseHold = (landed: boolean): void => {
    if (!landed || disposed) {
      const commits = afterPaste.filter(isHeldCommit);
      afterPaste.splice(0, afterPaste.length, ...commits);
    }
    if (disposed) {
      runHeld();
      flushAutosave();
      return;
    }
    if (afterPaste.length === 0) {
      setHold(null);
      return;
    }
    cancelHeldRun = deps.schedule(() => {
      cancelHeldRun = null;
      runHeld();
    }, 0);
  };

  /**
   * Hold an action until a long paste lands (when one is landing).
   *
   * @param action The action asked.
   * @returns Whether it was held (the caller then does nothing now).
   */
  const heldForPaste = (action: HeldAction): boolean => {
    if (hold() === null) return false;
    afterPaste.push(action);
    return true;
  };

  /** Release the hold and run the held actions in the order asked; one failing never stops the rest. */
  const runHeld = (): void => {
    const after = hold() === 'readings' ? 'the set readings' : 'a paste';
    setHold(null);
    for (const action of afterPaste.splice(0)) {
      try {
        if (action.kind === 'commit-row') controller.commitRow(action.lane, action.id);
        else if (action.kind === 'commit-lane') controller.commitLane(action.lane);
        else if (action.kind === 'apply') controller.apply();
        else if (action.kind === 'reset') controller.reset();
        else controller.stop();
      } catch (cause) {
        deps.log.warn(`held ${action.kind} after ${after} failed`, cause);
      }
    }
  };

  /** An edit in a lane: its undos end (and the edited row's note leaves). */
  const noteEdit = (lane: LaneKey, id: string | null): void => {
    setNotes((current) => (id === null ? retireLane(current, lane) : forgetRow(current, lane, id)));
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
    // A set saved before rows were stored this way opens in the stored form.
    const restored = restoreDraft(set, nextId);
    uncommitted.clear();
    batch(() => {
      setDraftSignal(restored.draft);
      setNotes(EMPTY_DRAFT_NOTES);
      publishCommits(restored, 'restore');
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

  /**
   * Split a paste into rows and land it: at once, or a slice per task for a
   * long one (see {@link PASTE_AT_ONCE}).
   *
   * @param lane The pasted lane.
   * @param id The row pasted into.
   * @param text The pasted text.
   * @param selection Where in the row it lands.
   * @throws Whatever the row split or a one-step commit throws (the caller settles it).
   */
  const startPaste = (
    lane: LaneKey,
    id: string,
    text: string,
    selection: RowSelection
  ): PasteOutcome => {
    const pasted = pasteIntoRow(draft(), lane, id, text, selection, nextId);
    // Every filled row but the one the caret lands in is committed.
    const targets = pasted.ids.slice(0, -1);
    if (fitsAtOnce(pasted.draft.rows[lane], targets, atOnce)) {
      return landPaste(lane, id, pasted, () => commitRows(pasted.draft, lane, targets, carry));
    }
    setHold('paste');
    // Nothing changes the draft meanwhile: every edit is gated on
    // `editable`; commits, Apply, Reset and Stop wait in `afterPaste`
    // (the load is done before a paste can start).
    const done = commitInSlices(pasted.draft, lane, targets).then((sliced) =>
      settleLongPaste(lane, id, pasted, sliced)
    );
    return { kind: 'pending', done };
  };

  const controller: OverlayController = {
    state,
    draft,
    view,
    saveState,
    dirty,
    invalidCount,
    focusRequest,
    lanePage,
    notes,
    rowProblem,
    rowWarning,
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
      // A long paste lands first: its rows are part of what is applied.
      if (heldForPaste({ kind: 'apply' }) || !canStart(state(), 'apply')) return;
      // The set carries WP Rocket's stored form: a row still being typed is committed first.
      takeCommit(commitAll(draft(), carry), 'apply');
      // One gate, the same one the session's prevalidation applies (rows
      // that only warn — a page-wide Defer JS failure included — never
      // block) — read from the current rows, never from a reading still
      // waiting for its pause: a lane not read yet is read now; when one
      // slice does not finish it, the rest runs in slices, the draft held,
      // and the Apply runs once every lane is read.
      if (!setReadings.readNow()) {
        setHold('readings');
        afterPaste.push({ kind: 'apply' });
        waitingForReadings = true;
        // eslint-disable-next-line solid/reactivity -- run once the readings settle: reads the draft untracked, then
        setReadings.whenSettled(() => {
          waitingForReadings = false;
          releaseHold(true);
        });
        return;
      }
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
      if (heldForPaste({ kind: 'reset' })) return;
      const current = status();
      if (current?.state !== 'active' || !canStart(state(), 'reset')) return;
      const restored = draftFromSet(current.set, nextId);
      uncommitted.clear();
      batch(() => {
        setDraftSignal(restored);
        setServerInvalid(new Map());
        setNotes(EMPTY_DRAFT_NOTES);
      });
      void runApply('reset', restored);
    },
    stop: () => {
      if (heldForPaste({ kind: 'stop' }) || !canStart(state(), 'stop')) return;
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
    pasting: () => hold() === 'paste',
    checking: () => hold() === 'readings',
    reloadPage: () => {
      deps.reload();
    },
    editRow: (lane, id, text) => {
      if (!editable()) return;
      const next = updateRow(draft(), lane, id, text);
      if (next === draft()) return;
      clearServerReason(id);
      uncommitted.add(id);
      batch(() => {
        noteEdit(lane, id);
        setDraft(next);
      });
    },
    commitRow: (lane, id) => {
      // A long paste lands on the rows it started from (its selection is
      // theirs): the row is committed after it.
      if (heldForPaste({ kind: 'commit-row', lane, id })) return null;
      // Safe while an action is in flight (the inputs are read-only then),
      // so a row left meanwhile is committed at once rather than never.
      const committed = commitRows(draft(), lane, [id], carry);
      takeCommit(committed, 'row');
      return committed.commits[0] ?? null;
    },
    commitLane: (lane) => {
      if (heldForPaste({ kind: 'commit-lane', lane })) return;
      takeCommit(
        commitRows(
          draft(),
          lane,
          draft().rows[lane].map((row) => row.id),
          carry
        ),
        'row'
      );
    },
    undoCommit: (lane, id) => {
      if (!editable()) return false;
      const taken = takeUndo(notes(), lane, id, draft().rows[lane]);
      if (taken === null) return false;
      const { target } = taken;
      const next =
        target.kind === 'row'
          ? updateRow(draft(), lane, id, target.typed)
          : reinsertRow(draft(), lane, { id, text: target.typed }, target.at);
      if (next === null) return false;
      // Back to its typed text, for editing: uncommitted until it is left.
      uncommitted.add(id);
      batch(() => {
        setNotes(taken.notes);
        setDraft(next);
      });
      setFocusRequest({ lane, id, caret: target.typed.length });
      return true;
    },
    insertRows: (lane, texts, afterId) => {
      if (!editable()) return [];
      const inserted = insertRows(draft(), lane, texts, afterId, nextId);
      if (inserted.ids.length > 0) noteEdit(lane, null);
      // Inserted text was not typed here: it is committed at once.
      const committed = takeCommit(commitRows(inserted.draft, lane, inserted.ids, carry), 'insert');
      const kept = inserted.ids.filter((id) => committed.rows[lane].some((row) => row.id === id));
      const first = kept[0];
      if (first !== undefined) setFocusRequest({ lane, id: first });
      return kept;
    },
    pasteRows: (lane, id, text, selection) => {
      if (!editable()) return { kind: 'ignored' };
      // A paste runs inside the host page's paste event: a throw must never
      // reach the page — it settles `failed`, the lane says so, the editor
      // stays as it was.
      try {
        return startPaste(lane, id, text, selection);
      } catch (cause) {
        deps.log.warn(`paste of ${String(text.length)} characters into ${lane} failed`, cause);
        return { kind: 'failed' };
      }
    },

    removeRow: (lane, id) => {
      if (!editable()) return;
      clearServerReason(id);
      const removed = removeRow(draft(), lane, id);
      if (removed.draft === draft()) return;
      uncommitted.delete(id);
      batch(() => {
        noteEdit(lane, id);
        setDraft(removed.draft);
      });
      if (removed.focusId !== null) setFocusRequest({ lane, id: removed.focusId });
    },
    setDisable: (key, value) => {
      if (!editable()) return;
      setDraft(setDisable(draft(), key, value));
    },
    addCandidate: (lane, row, focus) => {
      if (!editable()) return false;
      const added = addCandidate(draft(), lane, row, nextId);
      const id = added.id;
      if (added.added && id !== null) {
        const at = added.draft.rows[lane].findIndex((candidate) => candidate.id === id);
        batch(() => {
          noteEdit(lane, null);
          takeCommit(
            { draft: added.draft, commits: [{ lane, id, index: at, diff: added.diff }] },
            'candidate'
          );
        });
      }
      if (focus && added.id !== null) setFocusRequest({ lane, id: added.id });
      return added.added;
    },
    dispose: () => {
      disposed = true;
      cancelStall?.();
      if (finishPaste !== null) {
        // A long paste still committing lands now; its landing saves (no pasted line is lost).
        finishPaste();
      } else {
        // Landed (or the readings an Apply waits for still running), its
        // held actions not run yet: the held commits run now, no Apply.
        if (cancelHeldRun !== null) {
          cancelHeldRun();
          cancelHeldRun = null;
          releaseHold(true);
        } else if (waitingForReadings) {
          waitingForReadings = false;
          releaseHold(true);
        }
        flushAutosave();
      }
      setReadings.dispose();
      unsubscribe?.();
    }
  };
  return controller;
}

/**
 * A copy of a map without one key.
 *
 * @param map The map.
 * @param key The key to leave out.
 */
function withoutKey<V>(map: ReadonlyMap<string, V>, key: string): ReadonlyMap<string, V> {
  const next = new Map(map);
  next.delete(key);
  return next;
}

/** Whether a held action is a commit (kept when the paste fails or the overlay closes). */
function isHeldCommit(action: HeldAction): boolean {
  return action.kind === 'commit-row' || action.kind === 'commit-lane';
}

/** The first ask problem among the load's two answers. */
function firstProblem(...outcomes: readonly PortOutcome<unknown>[]): SessionProblem | null {
  for (const outcome of outcomes) if (outcome.kind === 'problem') return outcome.problem;
  return null;
}
