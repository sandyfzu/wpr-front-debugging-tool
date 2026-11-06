/**
 * The beacon tester's panel-lifetime state: the settings form (the shared
 * stored-settings machinery: loaded once, written back debounced) and the
 * run — kept across route changes, so leaving the page mid-run never loses
 * the run's answer. Every state is derived from what happened (a load, a
 * write, a run's outcome, the page's payload), never latched.
 *
 * Machines:
 * - load: `loading` → `ready` | `failed` (retry → `loading`);
 * - run: `idle` | `finished` → `running` → `finished{outcome, draft, page}`.
 *   A run tests the form's settings as shown at Run (nothing waits for the
 *   save: the draft travels with the request) and always ends — a run that
 *   throws is logged and reported as a failed ask. A run never changes the
 *   page, so no repeat question exists.
 *
 * Results belong to the page load they measured: once the page reloads or
 * navigates (a new payload identity), they read as stale.
 */
import { createMemo, createSignal, type Accessor } from 'solid-js';
import type { Logger } from '../../../../lib/logger';
import type { ScheduleTimer } from '../../../../lib/messaging/bounded-ask';
import {
  checkBeaconDraft,
  type BeaconConfigIssue,
  type BeaconTestDraft,
  type SelectorValidity
} from '../../../../lib/beacon-test/config';
import type { BeaconTestResults } from '../../../../lib/beacon-test/results';
import type { BeaconTestOutcome } from '../../../../lib/beacon-test/run-test';
import {
  DEFAULT_BEACON_TEST_SETTINGS,
  deviceThresholdTexts,
  findBeaconSettingsProblem,
  parseBeaconTestSettings,
  toBeaconDraft,
  type BeaconSettingsFlag,
  type BeaconSettingsTextField,
  type BeaconTestSettings
} from '../../../../lib/beacon-test/settings';
import type { ConfigSaveState } from '../settings/config-writer';
import { createStoredSettings, type SettingsLoadState } from '../settings/stored-settings';

/** The form's store shape: the settings, writable (the store's setter needs it). */
type BeaconFormState = { -readonly [Key in keyof BeaconTestSettings]: BeaconTestSettings[Key] };

/** A run that ended with an outcome. */
export interface FinishedBeaconRun {
  readonly status: 'finished';
  readonly outcome: BeaconTestOutcome;
  /** The settings the run tested. */
  readonly draft: BeaconTestDraft;
  /** The page load the run measured (payload identity; null when unknown). */
  readonly page: string | null;
  /** Names this run (a newer run gets a higher one). */
  readonly sequence: number;
}

/** The run. */
export type BeaconRunState =
  { readonly status: 'idle' } | { readonly status: 'running' } | FinishedBeaconRun;

/** The outcome a run that threw is reported as. */
export const BEACON_RUN_THREW_OUTCOME: BeaconTestOutcome = {
  kind: 'page-unreachable',
  miss: 'failed'
};

/** What the session runs against (production binds the inspected tab; tests inject doubles). */
export interface BeaconTesterSessionDeps {
  readonly readSettings: () => Promise<BeaconTestSettings>;
  readonly writeSettings: (settings: BeaconTestSettings) => Promise<void>;
  /** Follow writes from elsewhere (another DevTools window); returns the unsubscribe. */
  readonly watchSettings: (onChange: (settings: BeaconTestSettings) => void) => () => void;
  /** Run one test with these settings. */
  readonly runTest: (draft: BeaconTestDraft) => Promise<BeaconTestOutcome>;
  /** The selector parser check (the form's live validation). */
  readonly isValidSelector: SelectorValidity;
  /**
   * The inspected page's load identity from its payload: new on every
   * reload or navigation; `null` without a payload.
   */
  readonly pageId: Accessor<string | null>;
  readonly schedule: ScheduleTimer;
  /** Quiet time (ms) after an edit before it is written. */
  readonly saveDelayMs: number;
  readonly log: Logger;
}

/** The session. */
export interface BeaconTesterSession {
  /** The form's settings (read-only; edit through the setters). */
  readonly form: BeaconTestSettings;
  readonly load: Accessor<SettingsLoadState>;
  readonly save: Accessor<ConfigSaveState>;
  readonly run: Accessor<BeaconRunState>;
  /** Every reason the form's settings cannot run now (live). */
  readonly issues: Accessor<readonly BeaconConfigIssue[]>;
  /** The shown run's results (a timed-out run's partial ones included), else null. */
  readonly results: Accessor<BeaconTestResults | null>;
  /** The shown results measured an earlier page load (it reloaded or navigated since). */
  readonly stale: Accessor<boolean>;
  /** Set a switch; the device switch also resets the viewport thresholds to its defaults. */
  readonly setFlag: (flag: BeaconSettingsFlag, value: boolean) => void;
  readonly setText: (field: BeaconSettingsTextField, value: string) => void;
  /** Put WP Rocket's default candidate selectors back. */
  readonly resetSelectors: () => void;
  readonly retryLoad: () => void;
  /** Run a test with the form's settings (ignored while one runs or the settings load). */
  readonly start: () => Promise<void>;
  /** Write any queued edit now. */
  readonly flush: () => Promise<boolean>;
  readonly dispose: () => void;
}

/**
 * A run's results, when it has any to show.
 *
 * @param outcome The run's outcome.
 * @returns The completed results, a timed-out run's partial ones, else null.
 */
export function resultsOf(outcome: BeaconTestOutcome): BeaconTestResults | null {
  if (outcome.kind === 'completed') return outcome.results;
  if (outcome.kind === 'timed-out') return outcome.partial;
  return null;
}

/**
 * Create the session (call inside a reactive root that outlives the page body).
 *
 * @param deps See {@link BeaconTesterSessionDeps}.
 */
export function createBeaconTesterSession(deps: BeaconTesterSessionDeps): BeaconTesterSession {
  const settings = createStoredSettings<BeaconTestSettings, BeaconFormState>({
    read: deps.readSettings,
    write: deps.writeSettings,
    watch: deps.watchSettings,
    check: (value) => {
      const problem = findBeaconSettingsProblem(value);
      return problem === null ? null : `These settings can't be saved: ${problem}.`;
    },
    // The parser copies and caps every field: a fresh, writable form state.
    toForm: parseBeaconTestSettings,
    toValue: parseBeaconTestSettings,
    initial: DEFAULT_BEACON_TEST_SETTINGS,
    schedule: deps.schedule,
    delayMs: deps.saveDelayMs,
    log: deps.log,
    label: 'Beacon tester'
  });
  const [run, setRun] = createSignal<BeaconRunState>({ status: 'idle' });
  let sequence = 0;
  let disposed = false;

  const issues = createMemo((): readonly BeaconConfigIssue[] => {
    const check = checkBeaconDraft(toBeaconDraft(settings.form), deps.isValidSelector);
    return check.ok ? [] : check.issues;
  });

  const results = createMemo((): BeaconTestResults | null => {
    const current = run();
    return current.status === 'finished' ? resultsOf(current.outcome) : null;
  });

  const stale = createMemo((): boolean => {
    const current = run();
    if (current.status !== 'finished') return false;
    const page = deps.pageId();
    // An unknown page on either side cannot prove a reload.
    return page !== null && current.page !== null && page !== current.page;
  });

  /**
   * Run the draft (never rejects).
   *
   * @param draft The settings to test.
   * @returns The outcome; a run that throws is logged and read as a failed ask.
   */
  const execute = async (draft: BeaconTestDraft): Promise<BeaconTestOutcome> => {
    try {
      return await deps.runTest(draft);
    } catch (cause) {
      deps.log.error(
        'Beacon tester: the run threw',
        cause instanceof Error ? cause.message : cause
      );
      return BEACON_RUN_THREW_OUTCOME;
    }
  };

  /** Run a test with the form's settings as shown now. */
  const start = async (): Promise<void> => {
    if (run().status === 'running' || settings.load().status !== 'ready') return;
    const draft = toBeaconDraft(settings.value());
    const page = deps.pageId();
    setRun({ status: 'running' });
    // Persisting is independent of the run (its draft travels with the request).
    void settings.flush();
    const outcome = await execute(draft);
    if (disposed) return;
    sequence += 1;
    setRun({ status: 'finished', outcome, draft, page, sequence });
  };

  return {
    form: settings.form,
    load: settings.load,
    save: settings.save,
    run,
    issues,
    results,
    stale,
    setFlag: (flag, value) => {
      if (flag === 'mobile' && value !== settings.form.mobile) {
        settings.setForm({ mobile: value, ...deviceThresholdTexts(value) });
      } else {
        settings.setForm(flag, value);
      }
      settings.edited();
    },
    setText: (field, value) => {
      settings.setForm(field, value);
      settings.edited();
    },
    resetSelectors: () => {
      settings.setForm('selectorText', DEFAULT_BEACON_TEST_SETTINGS.selectorText);
      settings.edited();
    },
    retryLoad: settings.retryLoad,
    start,
    flush: settings.flush,
    dispose: () => {
      disposed = true;
      settings.dispose();
    }
  };
}
