/**
 * The panel's cold-start instrument: the shell's three `performance.mark`s
 * and the two named measures the panel's timing budget reads.
 *
 * Chain and meaning: *script start* is the panel document's bundled entry
 * beginning to execute; *shell interactive* is the app shell mounted (the
 * brand, nav, top bar and overlay layer accept interaction); *first
 * data state* is the boot flight's first settle — `ready` **or** `error`, a
 * genuine answer in both arms. The cold-start measure spans script start →
 * first data state; it is ≤ 500 ms on the P5.1 browser harness (the budget
 * table's typed timing row, asserted by the harness spec that reads these
 * entries) — "faster than the tool it replaces" is a measured gate, not a
 * claim.
 *
 * One instrument per document, armed in boot order: each mark fires exactly
 * once (a repeated mark would append a second timeline entry, and every
 * consumer reads the first settle only), so later data events and a
 * re-changing machine state can call freely without ever re-marking.
 * Instrumentation is best-effort by contract: a timing-API failure logs and
 * continues — a broken instrument must never take the boot down with it.
 */
import { createLogger } from '../../lib/logger';

const log = createLogger('panel');

/** The timeline entries' prefix — every name below starts with it. */
const MARK_PREFIX = 'wpr-fdt:panel:';

/** The panel entry's first statement (script start). */
export const PANEL_SCRIPT_START_MARK = `${MARK_PREFIX}script-start`;

/** The shell is mounted and interactive. */
export const PANEL_SHELL_INTERACTIVE_MARK = `${MARK_PREFIX}shell-interactive`;

/** The boot's first data settle (ready or error — see the module header). */
export const PANEL_FIRST_DATA_STATE_MARK = `${MARK_PREFIX}first-data-state`;

/** The measure spanning script start → shell interactive. */
export const PANEL_SHELL_INTERACTIVE_MEASURE = PANEL_SHELL_INTERACTIVE_MARK;

/** The measure spanning script start → first data state — the budgeted span. */
export const PANEL_COLD_START_MEASURE = `${MARK_PREFIX}cold-start`;

/**
 * The timing seam: exactly the User Timing API surface the instrument uses.
 * `performance` satisfies it; tests record into doubles instead.
 */
export interface Uptime {
  /** Record a timeline entry named `name` at the current instant. */
  mark(name: string): void;
  /**
   * Record a window named `name` between two already-recorded marks.
   *
   * @param name The measure's name.
   * @param startMark The span's start mark (must already exist).
   * @param endMark The span's end mark (must already exist).
   */
  measure(name: string, startMark: string, endMark: string): void;
}

/** Mark names by instrument step (the factory's internal bookkeeping). */
type Step = 'script-start' | 'shell-interactive' | 'first-data-state';

const STEP_MARKS: Record<Step, string> = {
  'script-start': PANEL_SCRIPT_START_MARK,
  'shell-interactive': PANEL_SHELL_INTERACTIVE_MARK,
  'first-data-state': PANEL_FIRST_DATA_STATE_MARK
};

/** What one measured timeline window reads (the factory's internal spec). */
const STEP_SPANS: Record<Step, { startMark: Step; name: string } | null> = {
  'script-start': null,
  'shell-interactive': { startMark: 'script-start', name: PANEL_SHELL_INTERACTIVE_MEASURE },
  'first-data-state': { startMark: 'script-start', name: PANEL_COLD_START_MEASURE }
};

/**
 * Create the cold-start instrument over one timing seam: three once-guarded
 * marks and their derived windows. Production arms it with `performance`
 * (the singleton below); tests hand a recorder in.
 *
 * @param uptime The timing seam (a structural `performance`).
 */
export function createPanelColdStart(uptime: Uptime): {
  markScriptStart(): void;
  markShellInteractive(): void;
  markFirstDataState(): void;
} {
  /** Which steps already landed in this instrument (span preconditions). */
  const landed: Set<Step> = new Set();

  /** Mark one step and — when its span's start mark landed — its window. */
  const emit = (step: Step): void => {
    const span = STEP_SPANS[step];
    // The span's start mark must have landed in *this* instrument; boot
    // order guarantees it. If a rewiring ever breaks that order, the mark
    // still records and only the (unconstructible) window is skipped, named.
    if (span !== null && !landed.has(span.startMark)) {
      log.warn(`Cold-start: skipped the ${span.name} window — ${span.startMark} never landed`);
    }
    try {
      uptime.mark(STEP_MARKS[step]);
      if (span !== null && landed.has(span.startMark)) {
        uptime.measure(span.name, STEP_MARKS[span.startMark], STEP_MARKS[step]);
      }
    } catch (cause) {
      // Instrumentation failure never reaches boot: named at warn, ignored.
      log.warn(`Cold-start: could not record the ${step} mark`, {
        cause: cause instanceof Error ? { message: cause.message } : cause
      });
    }
    landed.add(step);
  };

  /** Arm one step exactly once — later calls (the data effect re-runs) no-op. */
  const once = (step: Step): (() => void) => {
    let fired = false;
    return () => {
      if (fired) return;
      fired = true;
      emit(step);
    };
  };

  return {
    markScriptStart: once('script-start'),
    markShellInteractive: once('shell-interactive'),
    markFirstDataState: once('first-data-state')
  };
}

/** The panel document's one instrument — module scope is document scope. */
export const panelColdStart = createPanelColdStart(performance);
