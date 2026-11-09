/**
 * The RUCSS tester's panel-lifetime state: the form (loaded once from the
 * store, then written back debounced), the run, and the page-style
 * inventory — kept across route changes, so leaving the page mid-run
 * never loses the run's answer. Every state is derived from what happened
 * (a load, a write, a run's outcome, the page's payload), never latched.
 *
 * Machines:
 * - load: `loading` → `ready` | `failed` (retry → `loading`);
 * - run: `idle` | `finished` → (`confirm-repeat{previous}` when a test
 *   changed — or may have changed — the page; Cancel restores `previous`,
 *   and so does a settled page load that no earlier test remains on)
 *   → `running` → `finished{outcome}`; `blocked` when the settings could
 *   not be saved first (the run would read stale ones). `running` always
 *   ends: a run that throws is logged and reported as an unconfirmed apply;
 * - inventory: `idle` → `loading` → `ready{reply}` | `failed{miss}`, each
 *   read stamped with the page it listed — a reload or navigation shows it
 *   `idle` again; a test that may have applied re-reads a shown (or
 *   loading) list.
 *
 * A finished run is stamped with the page load it ran on: once the page
 * reloads or navigates, a run that changed it (or may have) reads `stale`
 * — its change is gone.
 *
 * Earlier tests: the page's payload counts the applied ones; the session
 * also records its own runs that applied or may have (a payload refresh can
 * be dropped, and an unconfirmed apply leaves no fact), each stamped like
 * the run, so a reload (a new page identity) clears them.
 */
import { createComputed, createMemo, createSignal, type Accessor } from 'solid-js';
import type { Logger } from '../../../../lib/logger';
import type { AskOutcome, ScheduleTimer } from '../../../../lib/messaging/bounded-ask';
import type { PageStylesReply } from '../../../../lib/messaging/page-styles';
import {
  DEFAULT_RUCSS_TESTER_CONFIG,
  RUCSS_CONFIG_LIMITS,
  type RucssReplacement,
  type RucssTesterConfig
} from '../../../../lib/rucss-tester/config';
import { clampRucssTesterConfig, findStoreProblem } from '../../../../lib/rucss-tester/form-check';
import { pageChangeOf, type RucssTestOutcome } from '../../../../lib/rucss-tester/run-test';
import { isOtherLoad, settleStamp, stampAsk, type LoadStamp } from '../../state/page-identity';
import type { ConfigSaveState } from '../settings/config-writer';
import { createStoredSettings, type SettingsLoadState } from '../settings/stored-settings';

/** The form's text fields. */
export type RucssTextField = 'safelist' | 'inlinePreserve' | 'excludeFiles' | 'prepend' | 'append';

/** The form's two request flags. */
export type RucssFlagField = 'mobile' | 'home';

/** The stored settings' load. */
export type ConfigLoadState = SettingsLoadState;

/** A run that ended with an outcome. */
export interface FinishedRun {
  readonly status: 'finished';
  readonly outcome: RucssTestOutcome;
  /** The page load the run ran on (payload identity; null when unknown or not yet settled). */
  readonly page: string | null;
  /** Started mid-refetch: `page` becomes the load the shell settles on. */
  readonly provisional: boolean;
  /** Names this run (a newer run gets a higher one). */
  readonly sequence: number;
}

/** The run. */
export type RucssRunState =
  | { readonly status: 'idle' }
  /**
   * A test changed (or may have changed) the page: a clean reload or an
   * explicit run on top. `previous` is the finished run Cancel brings back.
   */
  | { readonly status: 'confirm-repeat'; readonly previous: FinishedRun | null }
  | { readonly status: 'running' }
  /** The settings could not be saved, so the run did not start. */
  | { readonly status: 'blocked' }
  | FinishedRun;

/** Earlier tests on the inspected page, as far as the panel knows. */
export interface PriorTests {
  /** Tests known to have applied (the payload's count, or this session's own). */
  readonly applied: number;
  /** This session's runs whose apply the page never confirmed. */
  readonly unconfirmed: number;
}

/** The outcome a run that threw is reported as: where it stopped is unknown. */
export const RUN_THREW_OUTCOME: RucssTestOutcome = {
  kind: 'page-unreachable',
  step: 'apply',
  miss: 'failed'
};

/** The page-style inventory. */
export type InventoryState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly reply: PageStylesReply }
  | { readonly status: 'failed'; readonly miss: Exclude<AskOutcome<unknown>['kind'], 'reply'> };

/** An inventory read, stamped with the page identity it was asked on. */
type InventoryRead =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly reply: PageStylesReply; readonly page: string | null }
  | {
      readonly status: 'failed';
      readonly miss: Exclude<AskOutcome<unknown>['kind'], 'reply'>;
      readonly page: string | null;
    };

/** One of this session's runs that changed the page or may have, stamped with the load it ran on. */
export interface LocalTest extends LoadStamp {
  readonly change: 'applied' | 'unconfirmed';
}

/** What the session runs against (production binds the inspected tab; tests inject doubles). */
export interface RucssTesterSessionDeps {
  readonly readConfig: () => Promise<RucssTesterConfig>;
  readonly writeConfig: (config: RucssTesterConfig) => Promise<void>;
  /** Follow writes from elsewhere (another DevTools window); returns the unsubscribe. */
  readonly watchConfig: (onChange: (config: RucssTesterConfig) => void) => () => void;
  /** Run one test with the stored settings. */
  readonly runTest: () => Promise<RucssTestOutcome>;
  /** Ask the page for its styles. */
  readonly listStyles: () => Promise<AskOutcome<PageStylesReply>>;
  /** Tests applied on the inspected page, per its current payload. */
  readonly pageRuns: Accessor<number>;
  /**
   * The inspected page's load identity from its payload: new on every
   * reload or navigation; `null` without a payload (or an older one).
   */
  readonly pageId: Accessor<string | null>;
  /** Whether `pageId` is current (no shell refetch in flight). */
  readonly pageSettled: Accessor<boolean>;
  /** A test applied, or may have: refresh the page's payload (its TEST MODE fact). */
  readonly onApplied: () => void;
  readonly schedule: ScheduleTimer;
  /** Quiet time (ms) after an edit before it is written. */
  readonly saveDelayMs: number;
  readonly log: Logger;
}

/** The session. */
export interface RucssTesterSession {
  /** The form's settings (read-only; edit through the setters). */
  readonly form: RucssTesterConfig;
  readonly load: Accessor<ConfigLoadState>;
  readonly save: Accessor<ConfigSaveState>;
  readonly run: Accessor<RucssRunState>;
  readonly inventory: Accessor<InventoryState>;
  /** Tests applied on the inspected page, per its current payload. */
  readonly pageRuns: Accessor<number>;
  /** Earlier tests a new run would land on top of (see {@link PriorTests}). */
  readonly priorTests: Accessor<PriorTests>;
  /**
   * The shown run changed the page (or may have), and the page reloaded or
   * navigated since: that change is gone.
   */
  readonly stale: Accessor<boolean>;
  readonly setText: (field: RucssTextField, value: string) => void;
  readonly setFlag: (field: RucssFlagField, value: boolean) => void;
  /** Add an empty pair (no-op at the pair cap). */
  readonly addPair: () => void;
  readonly removePair: (index: number) => void;
  readonly setPair: (index: number, part: keyof RucssReplacement, value: string) => void;
  readonly retryLoad: () => void;
  /** Start a run; `force` runs on top of an earlier test's result. */
  readonly start: (options?: { readonly force?: boolean }) => Promise<void>;
  /** Leave the repeat-run question without running (the previous outcome comes back). */
  readonly cancelRepeat: () => void;
  /** Read the page's styles now. */
  readonly inspect: () => Promise<void>;
  /** Write any queued edit now. */
  readonly flush: () => Promise<boolean>;
  readonly dispose: () => void;
}

/** The form's store shape: the configuration, writable (the store's setter needs it). */
interface RucssFormState {
  safelist: string;
  inlinePreserve: string;
  excludeFiles: string;
  prepend: string;
  append: string;
  replacements: { search: string; replacement: string }[];
  mobile: boolean;
  home: boolean;
}

/**
 * A configuration as fresh form state, within every cap.
 *
 * @param config The configuration (stored, or the defaults).
 */
function toFormState(config: RucssTesterConfig): RucssFormState {
  const clamped = clampRucssTesterConfig(config);
  return { ...clamped, replacements: clamped.replacements.map((pair) => ({ ...pair })) };
}

/**
 * Settle a finished run's provisional stamp ({@link settleStamp}).
 *
 * @param finished The finished run.
 * @param id The shell's identity now.
 * @param settled Whether that identity is current.
 * @returns The same run when nothing settles, else the settled copy.
 */
function settleFinished(finished: FinishedRun, id: string | null, settled: boolean): FinishedRun {
  if (!finished.provisional) return finished;
  const stamp = settleStamp(finished, id, settled);
  return stamp === finished ? finished : { ...finished, ...stamp };
}

/**
 * Settle the run's provisional stamp — the one the repeat question holds included.
 *
 * @param state The run.
 * @param id The shell's identity now.
 * @param settled Whether that identity is current.
 * @returns The same state when nothing settles, else the settled copy.
 */
export function settleRunStamp(
  state: RucssRunState,
  id: string | null,
  settled: boolean
): RucssRunState {
  if (state.status === 'finished') return settleFinished(state, id, settled);
  if (state.status !== 'confirm-repeat' || state.previous === null) return state;
  const previous = settleFinished(state.previous, id, settled);
  return previous === state.previous ? state : { ...state, previous };
}

/**
 * Settle the provisional stamps of this session's own tests ({@link settleStamp}).
 *
 * @param tests The recorded tests.
 * @param id The shell's identity now.
 * @param settled Whether that identity is current.
 * @returns The same list when nothing settles, else the settled copy.
 */
export function settleLocalTests(
  tests: readonly LocalTest[],
  id: string | null,
  settled: boolean
): readonly LocalTest[] {
  if (!settled || !tests.some((test) => test.provisional)) return tests;
  return tests.map((test) =>
    test.provisional ? { ...test, ...settleStamp(test, id, true) } : test
  );
}

/**
 * Leave an open repeat question once a settled page load carries no
 * earlier test: the question is about a test that is gone.
 *
 * @param state The run.
 * @param prior Earlier tests on the page now.
 * @param settled Whether the page identity is current.
 * @returns The run the question held (or `idle`), else `state` unchanged.
 */
export function dropAnsweredQuestion(
  state: RucssRunState,
  prior: PriorTests,
  settled: boolean
): RucssRunState {
  if (state.status !== 'confirm-repeat' || !settled) return state;
  if (prior.applied > 0 || prior.unconfirmed > 0) return state;
  return state.previous ?? { status: 'idle' };
}

/**
 * Create the session (call inside a reactive root that outlives the page body).
 *
 * @param deps See {@link RucssTesterSessionDeps}.
 */
export function createRucssTesterSession(deps: RucssTesterSessionDeps): RucssTesterSession {
  const settings = createStoredSettings<RucssTesterConfig, RucssFormState>({
    read: deps.readConfig,
    write: deps.writeConfig,
    watch: deps.watchConfig,
    check: findStoreProblem,
    toForm: toFormState,
    toValue: clampRucssTesterConfig,
    initial: DEFAULT_RUCSS_TESTER_CONFIG,
    schedule: deps.schedule,
    delayMs: deps.saveDelayMs,
    log: deps.log,
    label: 'RUCSS tester'
  });
  const { form, setForm, load, edited } = settings;
  const [run, setRun] = createSignal<RucssRunState>({ status: 'idle' });
  const [inventoryRead, setInventoryRead] = createSignal<InventoryRead>({ status: 'idle' });
  const [localTests, setLocalTests] = createSignal<readonly LocalTest[]>([]);
  let sequence = 0;
  let disposed = false;
  // A test may have applied while a read was in the air: read once more when it lands.
  let rereadQueued = false;

  /**
   * Whether something recorded on `page` is about an earlier page load
   * (an unknown current page keeps it; a record of an unknown page counts
   * as another load once the page is known: asking once too often is the
   * safe side).
   *
   * @param page The page identity the record was made on.
   */
  const isOtherPage = (page: string | null): boolean => {
    const current = deps.pageId();
    return current !== null && (page === null || isOtherLoad(page, current));
  };

  // A run (and its own test record) started mid-refetch takes the load the shell settles on.
  createComputed(() => {
    const id = deps.pageId();
    const settled = deps.pageSettled();
    setRun((current) => settleRunStamp(current, id, settled));
    setLocalTests((tests) => settleLocalTests(tests, id, settled));
  });

  /**
   * Whether the shown run's page change is gone: the page is a known load
   * other than the run's (an unknown one on either side proves nothing).
   */
  const stale = createMemo((): boolean => {
    const current = run();
    if (current.status !== 'finished' || pageChangeOf(current.outcome) === null) return false;
    return isOtherLoad(current.page, deps.pageId());
  });

  /** The inventory as shown: a read of an earlier page load reads `idle` (stale). */
  const inventory = createMemo((): InventoryState => {
    const read = inventoryRead();
    if (read.status === 'idle' || read.status === 'loading') return read;
    if (isOtherPage(read.page)) return { status: 'idle' };
    return read.status === 'ready'
      ? { status: 'ready', reply: read.reply }
      : { status: 'failed', miss: read.miss };
  });

  /** Earlier tests a new run would land on top of. */
  const priorTests = createMemo((): PriorTests => {
    // A provisional record counts until it settles: asking once too often is the safe side.
    let applied = 0;
    let unconfirmed = 0;
    for (const test of localTests()) {
      if (!test.provisional && isOtherPage(test.page)) continue;
      if (test.change === 'applied') applied += 1;
      else unconfirmed += 1;
    }
    return { applied: Math.max(deps.pageRuns(), applied), unconfirmed };
  });

  // A reload leaves nothing to ask about: the question goes, the run it held comes back.
  createComputed(() => {
    const prior = priorTests();
    const settled = deps.pageSettled();
    setRun((current) => dropAnsweredQuestion(current, prior, settled));
  });

  /**
   * Ask the page for its style list.
   *
   * @returns The read's outcome; a rejected ask is logged and read as `failed`.
   */
  const askStyles = async (): Promise<AskOutcome<PageStylesReply>> => {
    try {
      return await deps.listStyles();
    } catch (cause) {
      deps.log.error(
        'RUCSS tester: reading the page styles threw',
        cause instanceof Error ? cause.message : cause
      );
      return { kind: 'failed', cause };
    }
  };

  /** Ask the page for its current style list (ignored while one is loading). */
  const inspect = async (): Promise<void> => {
    if (inventoryRead().status === 'loading') return;
    const page = deps.pageId();
    setInventoryRead({ status: 'loading' });
    const outcome = await askStyles();
    if (disposed) return;
    setInventoryRead(
      outcome.kind === 'reply'
        ? { status: 'ready', reply: outcome.reply, page }
        : { status: 'failed', miss: outcome.kind, page }
    );
    if (rereadQueued) {
      rereadQueued = false;
      void inspect();
    }
  };

  /** The page may have changed: a shown list re-reads; one in the air reads once more. */
  const followPage = (): void => {
    const status = inventory().status;
    if (status === 'loading') rereadQueued = true;
    else if (status === 'ready') void inspect();
  };

  /**
   * Record a run that changed the page, or may have, stamped with the load
   * it ran on; records of earlier loads go.
   *
   * @param stamp The run's stamp.
   * @param change How the run left the page.
   */
  const noteLocalTest = (stamp: LoadStamp, change: LocalTest['change']): void => {
    setLocalTests((tests) => [
      ...tests.filter((test) => test.provisional || !isOtherPage(test.page)),
      { page: stamp.page, provisional: stamp.provisional, change }
    ]);
  };

  /**
   * Save the form, then run (never rejects).
   *
   * @returns The outcome, or `blocked` when the settings could not be saved.
   */
  const execute = async (): Promise<RucssTestOutcome | 'blocked'> => {
    try {
      // The run reads the store: it must hold what the form showed at Run.
      if (!(await settings.flush())) return 'blocked';
    } catch (cause) {
      deps.log.error(
        'RUCSS tester: saving the settings before the run threw',
        cause instanceof Error ? cause.message : cause
      );
      return 'blocked';
    }
    try {
      return await deps.runTest();
    } catch (cause) {
      deps.log.error(
        'RUCSS tester: the run threw; the page state is unknown',
        cause instanceof Error ? cause.message : cause
      );
      return RUN_THREW_OUTCOME;
    }
  };

  /**
   * Run a test: asks to confirm when the page already carries one (unless `force`),
   * saves the form first (blocked when it cannot), then runs and records the outcome.
   *
   * @param options.force Run on top of an earlier test without asking.
   */
  const start = async (options: { readonly force?: boolean } = {}): Promise<void> => {
    const current = run();
    if (current.status === 'running' || load().status !== 'ready') return;
    const prior = priorTests();
    if (options.force !== true && (prior.applied > 0 || prior.unconfirmed > 0)) {
      // The shown outcome stays reachable: Cancel brings it back.
      const previous =
        current.status === 'confirm-repeat'
          ? current.previous
          : current.status === 'finished'
            ? current
            : null;
      setRun({ status: 'confirm-repeat', previous });
      return;
    }
    const started: LoadStamp = stampAsk(deps.pageId(), deps.pageSettled());
    setRun({ status: 'running' });
    const outcome = await execute();
    if (outcome === 'blocked') {
      setRun({ status: 'blocked' });
      return;
    }
    sequence += 1;
    const stamp = settleStamp(started, deps.pageId(), deps.pageSettled());
    setRun({ status: 'finished', outcome, ...stamp, sequence });
    const change = pageChangeOf(outcome);
    if (change === null || disposed) return;
    noteLocalTest(stamp, change);
    deps.onApplied();
    followPage();
  };

  return {
    form,
    load,
    save: settings.save,
    run,
    inventory,
    pageRuns: deps.pageRuns,
    priorTests,
    stale,
    setText: (field, value) => {
      setForm(field, value);
      edited();
    },
    setFlag: (field, value) => {
      setForm(field, value);
      edited();
    },
    addPair: () => {
      if (form.replacements.length >= RUCSS_CONFIG_LIMITS.replacements) return;
      setForm('replacements', (pairs) => [...pairs, { search: '', replacement: '' }]);
      edited();
    },
    removePair: (index) => {
      setForm('replacements', (pairs) => pairs.filter((_, at) => at !== index));
      edited();
    },
    setPair: (index, part, value) => {
      if (index < 0 || index >= form.replacements.length) return;
      setForm('replacements', index, part, value);
      edited();
    },
    retryLoad: settings.retryLoad,
    start,
    cancelRepeat: () => {
      const current = run();
      if (current.status === 'confirm-repeat') setRun(current.previous ?? { status: 'idle' });
    },
    inspect,
    flush: settings.flush,
    dispose: () => {
      disposed = true;
      settings.dispose();
    }
  };
}
