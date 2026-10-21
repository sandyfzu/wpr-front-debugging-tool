/**
 * Every word the overlay shows, declared once and mapped over the contract
 * tables (causes, document failures, problems, lanes) — so a new cause or
 * lane fails to type-check until it has its words. Sentence case, present
 * tense, no blame (the UI bar's word rules).
 */
import type {
  ExclusionDocumentFailure,
  InterceptionUnavailableCause
} from '../../lib/messaging/exclusion-session';
import type { ExclusionFeatureId } from '../../lib/exclusion-builder/set';
import {
  LABEL_AUTOMATIC_LAZY_RENDERING,
  LABEL_DELAY_JAVASCRIPT_EXECUTION,
  LABEL_IMAGE_LAZYLOAD,
  LABEL_LOAD_JAVASCRIPT_DEFERRED
} from '../../lib/detection/labels';
import type { LaneKey } from './exclusions/draft';
import type { SessionProblem } from './session/port';
import type { OverlayState, SessionAction } from './session/machine';
import type { SessionView, UnmodifiedReason } from './session/session-view';

/** The tool's name (the overlay's heading). */
export const TOOL_TITLE = 'Exclusion builder';

/** One lane's words. */
export interface LaneCopy {
  /** The feature's verified name. */
  readonly label: string;
  /** How a row matches, in one line. */
  readonly rowHint: string;
  /** The empty row input's placeholder. */
  readonly placeholder: string;
  /** What a candidate count counts (plural noun). */
  readonly noun: string;
  /** Shown when the page has nothing this lane can act on. */
  readonly absent: string;
}

/** The lanes' words. */
export const LANE_COPY: Readonly<Record<LaneKey, LaneCopy>> = {
  delayJs: {
    label: LABEL_DELAY_JAVASCRIPT_EXECUTION,
    rowHint: 'Regular expression, matched against the delayed script’s markup',
    placeholder: 'wp-content/plugins/slider/',
    noun: 'delayed scripts',
    absent: 'No delayed scripts on this page.'
  },
  deferJs: {
    label: LABEL_LOAD_JAVASCRIPT_DEFERRED,
    rowHint: 'Regular expression, matched against the script URL',
    placeholder: 'jquery\\.min\\.js',
    noun: 'deferred scripts',
    absent: 'No deferred scripts on this page.'
  },
  lazyRender: {
    label: LABEL_AUTOMATIC_LAZY_RENDERING,
    rowHint: 'Text, matched against the element’s opening tag',
    placeholder: 'id="footer"',
    noun: 'lazily rendered elements',
    absent: 'No lazily rendered elements on this page.'
  },
  lazyload: {
    label: LABEL_IMAGE_LAZYLOAD,
    rowHint: 'Text, matched against the image tag with its real source',
    placeholder: 'hero.jpg',
    noun: 'lazy images',
    absent: 'No lazy images on this page.'
  }
};

/** The feature names by engine id (report → words). */
export const FEATURE_NAMES: Readonly<Record<ExclusionFeatureId, string>> = {
  delay_js: LANE_COPY.delayJs.label,
  defer_all_js: LANE_COPY.deferJs.label,
  automatic_lazy_rendering: LANE_COPY.lazyRender.label,
  lazyload: LANE_COPY.lazyload.label
};

/** A titled message with its remedy. */
export interface StateCopy {
  readonly title: string;
  readonly body: string;
}

/**
 * The interception-unavailable warning per cause: what happened and what
 * to do — distinct words for each arm.
 */
export const UNAVAILABLE_COPY: Readonly<Record<InterceptionUnavailableCause, StateCopy>> = {
  'attach-denied': {
    title: 'The browser refused interception',
    body: 'Another debugger may hold this tab. Close it, then retry.'
  },
  'debugging-policy': {
    title: 'Debugging is blocked by policy',
    body: 'This browser is managed and forbids extension debugging. Ask its administrator, or use an unmanaged profile.'
  },
  'infobar-cancelled': {
    title: 'Interception was cancelled',
    body: 'The browser’s “started debugging” bar was closed with Cancel. Retry, and leave the bar open while the session runs.'
  },
  detached: {
    title: 'Interception ended',
    body: 'The browser ended it while the tab stayed open (for example after a crash). Retry to start it again.'
  },
  'unsupported-page': {
    title: 'This page can’t be intercepted',
    body: 'Only regular http and https pages can be rewritten. Open the site page itself in a normal tab.'
  },
  'unsupported-browser': {
    title: 'This browser can’t rewrite pages',
    body: 'Rewriting pages before they render needs Chrome (or another Chromium browser) or Firefox.'
  },
  'session-limit': {
    title: 'Too many sessions',
    body: 'Other tabs hold every available session. Stop one of them, then retry.'
  }
};

/** Why an intercepted page was served unmodified, per failure. */
export const DOCUMENT_FAILURE_COPY: Readonly<Record<ExclusionDocumentFailure, string>> = {
  'body-unavailable': 'Its HTML could not be read (too large, or the response was cut short).',
  'decode-failed': 'Its character encoding is not supported for rewriting.',
  'encode-failed': 'The rewritten HTML could not be saved back in the page’s character encoding.',
  'engine-failed': 'The exclusion engine failed on this page.',
  'not-served': 'The rewrite was not delivered: the navigation ended first.'
};

/**
 * The words of an unmodified page's reason.
 *
 * @param reason The reason.
 */
export function unmodifiedCopy(reason: UnmodifiedReason): string {
  if (reason.kind === 'failed') return DOCUMENT_FAILURE_COPY[reason.reason];
  const row = reason.row === null ? '' : ` (row ${reason.row})`;
  return `${FEATURE_NAMES[reason.feature]}${row} took longer than ${String(reason.budgetMs)} ms, so the page was served unmodified. Simplify the row, then apply again.`;
}

/** An ask that produced nothing, per problem. */
export const PROBLEM_COPY: Readonly<Record<SessionProblem, string>> = {
  'no-receiver': 'The extension is not answering. Reload the page, then try again.',
  timeout: 'The extension took too long to answer.',
  'invalid-reply': 'The extension sent an unexpected answer.',
  'context-invalidated': 'The extension was reloaded or updated. Reload the page to reconnect.',
  failed: 'The request failed.'
};

/** The title of a failed action's notice. */
export const ACTION_FAILED_TITLE: Readonly<Record<SessionAction, string>> = {
  apply: 'Couldn’t apply',
  reset: 'Couldn’t reset',
  stop: 'Couldn’t stop'
};

/** The session view's banner words. */
export function viewCopy(view: SessionView): StateCopy {
  switch (view.kind) {
    case 'off':
      return {
        title: 'Not applied',
        body: 'Pick elements or write rows, then apply: the page reloads with the exclusions rendered for real.'
      };
    case 'unavailable':
      return UNAVAILABLE_COPY[view.cause];
    case 'armed':
      return {
        title: 'Applied — waiting for the page',
        body: 'Reload to render this page through the session.'
      };
    case 'applied':
      return view.unmatched === 0
        ? { title: 'Applied', body: 'This page was rendered with your exclusions.' }
        : {
            title: 'Applied, with rows that matched nothing',
            body: `${String(view.unmatched)} ${view.unmatched === 1 ? 'row matches' : 'rows match'} no element on this page. Check the rows marked “No match”.`
          };
    case 'unmodified':
      return { title: 'Served unmodified', body: unmodifiedCopy(view.reason) };
    case 'not-intercepted':
      return {
        title: 'This page was not intercepted',
        body: 'The session is on, but this load bypassed it. Reload to render it with your exclusions.'
      };
    case 'cant-tell':
      return {
        title: 'Can’t verify this page',
        body: 'The session is on, but this page changed its address or loaded from history, so it may not be the rewritten one. Reload to be sure.'
      };
  }
}

/** The tone vocabulary of the session indicator (one status token each). */
export type IndicatorTone = 'neutral' | 'ok' | 'warn' | 'error' | 'info';

/** The session indicator: a word and a glyph, never color alone. */
export interface Indicator {
  readonly tone: IndicatorTone;
  readonly label: string;
  /** Glyph name (the overlay's icon set). */
  readonly glyph: 'dot' | 'check' | 'alert' | 'blocked' | 'spinner' | 'question';
}

/**
 * The header's session indicator for the overlay state.
 *
 * @param state The overlay state.
 * @param view The session view (null outside `ready`).
 */
export function sessionIndicator(state: OverlayState, view: SessionView | null): Indicator {
  if (state.phase === 'loading') return { tone: 'neutral', label: 'Checking', glyph: 'spinner' };
  if (state.phase === 'load-failed')
    return { tone: 'error', label: 'Unreachable', glyph: 'blocked' };
  if (state.phase === 'reloading') return { tone: 'info', label: 'Reloading', glyph: 'spinner' };
  if (state.pending !== null) {
    return {
      tone: 'info',
      label: state.pending === 'stop' ? 'Stopping' : 'Applying',
      glyph: 'spinner'
    };
  }
  switch (view?.kind) {
    case 'applied':
      return view.unmatched === 0
        ? { tone: 'ok', label: 'Applied', glyph: 'check' }
        : { tone: 'warn', label: 'Applied · no-match rows', glyph: 'alert' };
    case 'armed':
      return { tone: 'info', label: 'Applied · waiting', glyph: 'dot' };
    case 'unavailable':
      return { tone: 'error', label: 'Unavailable', glyph: 'blocked' };
    case 'unmodified':
      return { tone: 'warn', label: 'Served unmodified', glyph: 'alert' };
    case 'not-intercepted':
      return { tone: 'warn', label: 'Not intercepted', glyph: 'alert' };
    case 'cant-tell':
      return { tone: 'warn', label: 'Can’t verify', glyph: 'question' };
    default:
      return { tone: 'neutral', label: 'Not applied', glyph: 'dot' };
  }
}
