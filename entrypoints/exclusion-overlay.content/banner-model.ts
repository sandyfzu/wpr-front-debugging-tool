/**
 * The overlay's state banners as data: for each overlay state and session
 * view, the tone, glyph, words and forward actions to show — every state
 * names what happened and offers a way on (Retry, Reload), never a dead
 * end. Pure, so the whole state matrix is tested without rendering.
 */
import {
  EXCLUSION_SET_LIMITS,
  type ExclusionServedDocument
} from '../../lib/messaging/exclusion-session';
import {
  ACTION_FAILED_TITLE,
  COUNT_WORDS,
  PROBLEM_COPY,
  SERVED_NOTE_COPY,
  SESSION_ON_NOTE,
  SESSION_PERSISTS_NOTE,
  simulationLimitLines,
  stoppedBody,
  viewCopy,
  type Indicator,
  type IndicatorTone
} from './copy';
import { countNoun } from '../../utils/format-count';
import type { ActionNotice, OverlayState } from './session/machine';
import { simulationReports, type SessionView } from './session/session-view';

/** A banner's forward action. */
export type BannerAction = 'retry-load' | 'retry-apply' | 'retry-action' | 'reload' | 'dismiss';

/** One banner. */
export interface Banner {
  readonly tone: IndicatorTone;
  readonly glyph: Indicator['glyph'];
  readonly title: string;
  readonly body: string;
  /** Lines this page shows (a simulation's page-found caveats and CSP limits): always visible. */
  readonly notes: readonly string[];
  /**
   * The session's generic notes (how long it lasts, what it changed besides
   * the exclusions): behind one collapsed disclosure.
   */
  readonly sessionNotes: readonly string[];
  readonly actions: readonly BannerAction[];
}

/**
 * What the session changed on a served page besides the exclusions — each
 * said only when it happened, because each changes what the user sees or
 * measures.
 *
 * @param served The served document's identity.
 */
export function servedNotes(served: ExclusionServedDocument | undefined): string[] {
  if (served === undefined) return [];
  const notes: string[] = [];
  if (served.copy) notes.push(SERVED_NOTE_COPY.copy);
  if (served.serviceWorkersBypassed) notes.push(SERVED_NOTE_COPY.serviceWorkersBypassed);
  const rules = served.speculationRules;
  if (rules.removedFromDocument > 0 || rules.headerRemoved || rules.guarded) {
    notes.push(SERVED_NOTE_COPY.prefetchOff);
  }
  return notes;
}

/**
 * The session banner of a loaded overlay (none when nothing is applied).
 * Every active session's banner says, in its session notes, that the
 * session outlives the page.
 */
function viewBanner(view: SessionView): Banner | null {
  const { title, body } = viewCopy(view);
  const base = { title, body, notes: [], sessionNotes: [SESSION_PERSISTS_NOTE] };
  switch (view.kind) {
    case 'off':
      // Nothing to report: the header's indicator already says "Not
      // applied"; the empty editor carries its own guidance.
      return null;
    case 'unavailable':
      return {
        ...base,
        // Nothing runs: no session to outlive the page.
        sessionNotes: [],
        tone: 'error',
        glyph: 'blocked',
        actions: view.retryable ? ['retry-apply'] : []
      };
    case 'armed':
      return { ...base, tone: 'info', glyph: 'waiting', actions: ['reload'] };
    case 'applied': {
      const reports = simulationReports(view);
      // A simulation that did not run here, or one the page limits, warns.
      const limits = reports.flatMap(simulationLimitLines);
      const notSimulated = reports.some((report) => report.state !== 'simulated');
      const clean =
        view.unmatched === 0 && view.warnings.length === 0 && limits.length === 0 && !notSimulated;
      return {
        ...base,
        tone: clean ? 'ok' : 'warn',
        glyph: clean ? 'check' : 'alert',
        notes: limits,
        sessionNotes: [...base.sessionNotes, ...servedNotes(view.served)],
        actions: []
      };
    }
    case 'unmodified':
      return {
        ...base,
        tone: 'warn',
        glyph: 'alert',
        sessionNotes: [SESSION_ON_NOTE, ...servedNotes(view.served)],
        actions: ['reload']
      };
    case 'not-intercepted':
      return {
        ...base,
        sessionNotes: [SESSION_ON_NOTE],
        tone: 'warn',
        glyph: 'alert',
        actions: ['reload']
      };
    case 'cant-tell':
      return {
        ...base,
        sessionNotes: [SESSION_ON_NOTE],
        tone: 'warn',
        glyph: 'question',
        actions: ['reload']
      };
  }
}

/**
 * The main banner for the overlay state (null while loading: the skeleton
 * shows instead).
 *
 * @param state The overlay state.
 * @param view The session view (null outside `ready`).
 */
export function stateBanner(state: OverlayState, view: SessionView | null): Banner | null {
  switch (state.phase) {
    case 'loading':
      return null;
    case 'load-failed':
      return {
        tone: 'error',
        glyph: 'blocked',
        title: 'Couldn’t load the session',
        body: PROBLEM_COPY[state.problem],
        notes: [],
        sessionNotes: [],
        // A dead context cannot be retried from here: the words name the
        // way back (reopen the builder).
        actions: state.problem === 'context-invalidated' ? [] : ['retry-load']
      };
    case 'reloading':
      return {
        tone: 'info',
        glyph: 'spinner',
        title: 'Reloading with your exclusions',
        body: 'The page reloads now; the builder comes back with the result.',
        notes: [],
        sessionNotes: [],
        actions: []
      };
    case 'ready':
      return view === null ? null : viewBanner(view);
  }
}

/**
 * The banner of the last action's outcome.
 *
 * @param notice The notice.
 * @param simulated The page on screen still runs a simulation (the stopped
 *   notice says the reload removes it too).
 */
export function noticeBanner(notice: ActionNotice, simulated = false): Banner {
  switch (notice.kind) {
    case 'action-failed':
      return {
        tone: 'error',
        glyph: 'blocked',
        title: ACTION_FAILED_TITLE[notice.action],
        body: PROBLEM_COPY[notice.problem],
        notes: [],
        sessionNotes: [],
        // Transient problems can be retried; a dead context cannot.
        actions:
          notice.problem === 'context-invalidated' ? ['dismiss'] : ['retry-action', 'dismiss']
      };
    case 'invalid':
      return {
        tone: 'warn',
        glyph: 'alert',
        title: `Fix ${String(notice.rows)} ${countNoun(notice.rows, COUNT_WORDS.row)} before applying`,
        body: 'Each marked row says what is wrong with it.',
        notes: [],
        sessionNotes: [],
        actions: ['dismiss']
      };
    case 'too-large':
      return {
        tone: 'warn',
        glyph: 'alert',
        title: 'Too many exclusions to apply',
        body: `All rows together must stay under ${EXCLUSION_SET_LIMITS.totalChars.toLocaleString('en-US')} characters. Remove some rows, then apply.`,
        notes: [],
        sessionNotes: [],
        actions: ['dismiss']
      };
    case 'check-failed':
      return {
        tone: 'error',
        glyph: 'blocked',
        title: 'Couldn’t check the rows before applying',
        body: 'Checking how the rows work together stopped with an error. Nothing was applied: try again.',
        notes: [],
        sessionNotes: [],
        actions: ['retry-action', 'dismiss']
      };
    case 'reload-stalled':
      return {
        tone: 'warn',
        glyph: 'alert',
        title: 'The page didn’t reload',
        body: 'Reload to render the page with your exclusions, or keep editing.',
        notes: [],
        sessionNotes: [],
        actions: ['reload', 'dismiss']
      };
    case 'stopped':
      return {
        tone: 'info',
        glyph: 'check',
        title: 'Session stopped',
        body: stoppedBody(simulated),
        notes: [],
        sessionNotes: [],
        actions: ['reload', 'dismiss']
      };
  }
}

/**
 * The main banner without the forward actions the notice below it already
 * offers (an overdue reload's notice and the armed banner both offer
 * Reload: one is enough).
 *
 * @param main The state banner.
 * @param notice The notice banner, if any.
 */
export function withoutRepeatedActions(main: Banner, notice: Banner | null): Banner {
  if (notice === null) return main;
  const repeated = main.actions.filter(
    (action) => action !== 'dismiss' && notice.actions.includes(action)
  );
  return repeated.length === 0
    ? main
    : { ...main, actions: main.actions.filter((action) => !repeated.includes(action)) };
}
