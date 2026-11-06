/**
 * Every beacon test outcome — and every configuration issue — in user
 * words: a tone, a title, one or two sentences naming what happened, and
 * the recoveries that apply. Exhaustive over {@link BeaconTestOutcome} and
 * {@link BeaconConfigIssue}, so a new kind cannot ship without its words
 * (the compiler stops it). Pure; the panel renders the view verbatim.
 */
import { countLabel, formatCount } from '../../utils/format-count';
import {
  LABEL_AUTOMATIC_LAZY_RENDERING,
  LABEL_OPTIMIZE_CRITICAL_IMAGES
} from '../detection/labels';
import type { AskMiss } from '../messaging/bounded-ask';
import {
  SELECTOR_COUNT_MAX,
  SELECTOR_LENGTH_MAX,
  THRESHOLD_MAX,
  type BeaconConfigIssue,
  type BeaconTestDraft,
  type ThresholdField
} from './config';
import { BEACON_RUN_TIMEOUT_MS, BEACON_TEST_ASK_DEADLINE_MS } from './deadlines';
import type { BeaconTestResults, FeatureList } from './results';
import type { BeaconFeatureKey } from './runner-bridge';
import type { BeaconTestOutcome } from './run-test';

/**
 * What the user can do next:
 * - `retry` — run the test again;
 * - `reload-page` — reload the inspected page (scrolled back to the top, its content script back);
 * - `review-settings` — go to the setting to change.
 */
export type BeaconRecovery = 'retry' | 'reload-page' | 'review-settings';

/** A form setting an issue or a recovery points at. */
export type BeaconSettingField = 'features' | ThresholdField | 'selectorText';

/** One outcome, ready to render. */
export interface BeaconOutcomeView {
  readonly tone: 'ok' | 'warn' | 'error';
  readonly title: string;
  readonly message: string;
  /** Recovery actions, the main one first (may be empty: the Run button stays available). */
  readonly recoveries: readonly BeaconRecovery[];
  /** Where `review-settings` leads (null: the settings' start). */
  readonly focus: BeaconSettingField | null;
}

/** The feature names on screen: WP Rocket's own (one declaring site, `lib/detection/labels`). */
export const BEACON_FEATURE_LABELS: Readonly<Record<BeaconFeatureKey, string>> = {
  aboveTheFold: LABEL_OPTIMIZE_CRITICAL_IMAGES,
  lazyRender: LABEL_AUTOMATIC_LAZY_RENDERING
};

/** What each feature's list holds. */
const FEATURE_NOUNS = {
  aboveTheFold: { one: 'critical image candidate', other: 'critical image candidates' },
  lazyRender: { one: 'lazy-render element', other: 'lazy-render elements' }
} as const;

/** Each threshold field's name in sentences. */
export const THRESHOLD_NAMES: Readonly<Record<ThresholdField, string>> = {
  widthThreshold: 'Viewport width',
  heightThreshold: 'Viewport height',
  lazyRenderThreshold: 'Lazy-render distance'
};

/** The closing clause of every outcome that measured nothing. */
const NOTHING_MEASURED = 'Nothing was measured.';

/** Seconds, for a deadline in ms. */
function seconds(ms: number): string {
  return `${formatCount(Math.round(ms / 1000))} s`;
}

/** A view with the common defaults. */
function view(
  tone: BeaconOutcomeView['tone'],
  title: string,
  message: string,
  recoveries: readonly BeaconRecovery[],
  focus: BeaconSettingField | null = null
): BeaconOutcomeView {
  return { tone, title, message, recoveries, focus };
}

/**
 * One configuration issue in user words.
 *
 * @param issue The issue.
 * @returns One sentence.
 */
export function describeConfigIssue(issue: BeaconConfigIssue): string {
  switch (issue.kind) {
    case 'malformed':
      return 'The settings are unreadable — reload the DevTools panel.';
    case 'no-feature':
      return `Pick at least one feature: ${LABEL_OPTIMIZE_CRITICAL_IMAGES} or ${LABEL_AUTOMATIC_LAZY_RENDERING}.`;
    case 'threshold':
      return `${THRESHOLD_NAMES[issue.field]} must be a whole number of px from 1 to ${formatCount(THRESHOLD_MAX)}.`;
    case 'no-selector':
      return 'Add at least one candidate selector (one per line).';
    case 'too-many-selectors':
      return `${formatCount(issue.count)} selectors — at most ${formatCount(SELECTOR_COUNT_MAX)}.`;
    case 'selector-too-long':
      // The selector arrives already shortened (with its own ellipsis) by the validator.
      return `“${issue.selector}” is longer than ${formatCount(SELECTOR_LENGTH_MAX)} characters.`;
    case 'selector-invalid':
      return `“${issue.selector}” isn't a valid CSS selector.`;
    case 'selector-unclosed':
      return `“${issue.selector}” isn't closed — check quotes, brackets, parentheses, comments or a trailing backslash.`;
    case 'selector-list-invalid':
      return "The selector list doesn't parse as a whole.";
  }
}

/**
 * The setting an issue is about.
 *
 * @param issue The issue.
 * @returns The field, or null for one no field can fix.
 */
export function issueField(issue: BeaconConfigIssue): BeaconSettingField | null {
  switch (issue.kind) {
    case 'malformed':
      return null;
    case 'no-feature':
      return 'features';
    case 'threshold':
      return issue.field;
    case 'no-selector':
    case 'too-many-selectors':
    case 'selector-too-long':
    case 'selector-invalid':
    case 'selector-unclosed':
    case 'selector-list-invalid':
      return 'selectorText';
  }
}

/**
 * One feature's share of a summary.
 *
 * @param key The feature.
 * @param list Its list (null: it did not run).
 * @returns The phrase, or null when the feature did not run.
 */
function featurePhrase(key: BeaconFeatureKey, list: FeatureList<unknown> | null): string | null {
  if (list === null) return null;
  if (list.kind === 'malformed') return `an unreadable ${BEACON_FEATURE_LABELS[key]} list`;
  return countLabel(list.items.length, FEATURE_NOUNS[key], list.truncated);
}

/**
 * What a run found, as one sentence.
 *
 * @param results The validated results.
 * @returns E.g. "Found 3 critical image candidates and 12 lazy-render elements."
 */
export function resultsSummary(results: BeaconTestResults): string {
  const phrases = [
    featurePhrase('aboveTheFold', results.aboveTheFold),
    featurePhrase('lazyRender', results.lazyRender)
  ].filter((phrase): phrase is string => phrase !== null);
  return phrases.length === 0
    ? 'The beacon returned no results.'
    : `Found ${phrases.join(' and ')}.`;
}

/**
 * A miss of the panel's ask: the page never answered usably (nothing measured).
 *
 * @param miss How the ask missed.
 */
function missView(miss: AskMiss): BeaconOutcomeView {
  switch (miss) {
    case 'no-receiver':
      return view(
        'error',
        "The page isn't listening",
        `The extension is not active on this page yet — reload it (an http or https page) and run again. ${NOTHING_MEASURED}`,
        ['reload-page', 'retry']
      );
    case 'timeout':
      return view(
        'error',
        "The page didn't answer in time",
        `No answer within ${seconds(BEACON_TEST_ASK_DEADLINE_MS)}, the beacon's loading included. Run again; reload the page if it keeps happening.`,
        ['retry', 'reload-page']
      );
    case 'invalid-reply':
      return view(
        'error',
        "The page's answer was unreadable",
        'The page runs another version of the extension — reload it so both match, then run again.',
        ['reload-page', 'retry']
      );
    case 'failed':
      return view(
        'error',
        "Couldn't reach the page",
        `Sending the test to the page failed — reload it and run again. ${NOTHING_MEASURED}`,
        ['reload-page', 'retry']
      );
  }
}

/**
 * A screen-size bail: the viewport does not fit the device's thresholds.
 *
 * @param draft The settings the run used.
 */
function screenSizeView(draft: BeaconTestDraft): BeaconOutcomeView {
  const size = `${formatCount(draft.widthThreshold)} × ${formatCount(draft.heightThreshold)} px`;
  const message = draft.mobile
    ? `The mobile beacon measures only in a viewport at most ${size}. Use the DevTools device toolbar or a smaller window — or raise the thresholds — then run again. ${NOTHING_MEASURED}`
    : `The desktop beacon measures only in a viewport at least ${size}. Enlarge the window or undock DevTools — or lower the thresholds — then run again. ${NOTHING_MEASURED}`;
  return view(
    'warn',
    "The viewport doesn't fit the device",
    message,
    ['retry', 'review-settings'],
    'widthThreshold'
  );
}

/**
 * A completed run.
 *
 * @param results The validated results.
 * @param scriptErrors Features whose scan threw.
 */
function completedView(
  results: BeaconTestResults,
  scriptErrors: readonly BeaconFeatureKey[]
): BeaconOutcomeView {
  const summary = resultsSummary(results);
  if (scriptErrors.length === 0) return view('ok', 'Beacon test complete', summary, []);
  const names = scriptErrors.map((key) => BEACON_FEATURE_LABELS[key]).join(' and ');
  const selectorsToBlame = scriptErrors.includes('aboveTheFold');
  return view(
    'warn',
    'Beacon test complete, with errors',
    `The ${names} scan stopped on an error, so its results may be incomplete${selectorsToBlame ? ' — often a selector this page rejects' : ''}. ${summary}`,
    selectorsToBlame ? ['review-settings', 'retry'] : ['retry'],
    selectorsToBlame ? 'selectorText' : null
  );
}

/**
 * Describe an outcome.
 *
 * @param outcome The run's outcome.
 * @param draft The settings the run used (thresholds name the viewport bail).
 * @returns The view.
 */
export function describeBeaconOutcome(
  outcome: BeaconTestOutcome,
  draft: BeaconTestDraft
): BeaconOutcomeView {
  switch (outcome.kind) {
    case 'completed':
      return completedView(outcome.results, outcome.scriptErrors);
    case 'timed-out':
      return outcome.partial === null
        ? view(
            'error',
            'The test ran out of time',
            `The beacon didn't finish within ${seconds(BEACON_RUN_TIMEOUT_MS)} and found nothing until then. Run again; reload the page if it keeps happening.`,
            ['retry', 'reload-page']
          )
        : view(
            'warn',
            'The test ran out of time',
            `The beacon didn't finish within ${seconds(BEACON_RUN_TIMEOUT_MS)}; these are the results it had by then. ${resultsSummary(outcome.partial)}`,
            ['retry']
          );
    case 'bailed':
      return outcome.reason === 'screen-size'
        ? screenSizeView(draft)
        : view(
            'warn',
            'The page is scrolled',
            `The beacon measures only from the top of the page. Scroll the page back to the top (or reload it), then run again. ${NOTHING_MEASURED}`,
            ['retry', 'reload-page']
          );
    case 'failed':
      return view(
        'error',
        'The beacon test failed',
        `The page reported: “${outcome.message}”. Run again; reload the page if it keeps happening.`,
        ['retry', 'reload-page']
      );
    case 'runner-unavailable':
      return view(
        'error',
        "Couldn't load the beacon into the page",
        `The page doesn't accept the extension's scripts (a browser or store page), or the extension was reloaded since the page loaded. Reload the page and run again. ${NOTHING_MEASURED}`,
        ['reload-page', 'retry']
      );
    case 'busy':
      return view(
        'warn',
        'A test is already running on this page',
        `An earlier test (from this or another DevTools window) is still running; it ends within ${seconds(BEACON_RUN_TIMEOUT_MS)}. Run again then.`,
        ['retry']
      );
    case 'invalid-config': {
      const first = outcome.issues[0];
      return view(
        'error',
        "These settings can't run",
        'Fix what is listed below, then run again. Nothing was sent to the page.',
        ['review-settings'],
        first === undefined ? null : issueField(first)
      );
    }
    case 'page-unreachable':
      return missView(outcome.miss);
  }
}
