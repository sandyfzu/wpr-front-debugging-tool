/**
 * Every RUCSS test outcome in user words: a tone, a title, one or two
 * sentences naming what happened and whether the page changed, and the
 * recovery actions that apply — exhaustive over {@link RucssTestOutcome},
 * so a new outcome kind cannot ship without its words (the compiler stops
 * it). Pure; the panel renders the view verbatim.
 */
import { countLabel, formatCount } from '../../utils/format-count';
import type { RucssApplyFailure, RucssStartFailure } from '../messaging/rucss-test';
import { RUCSS_TEST_LIMITS } from '../messaging/rucss-test';
import type { RucssBuildOutcome } from './build-client';
import {
  RUCSS_BUILD_TIMEOUT_MS,
  RUCSS_FETCH_TIMEOUT_MS,
  RUCSS_START_DEADLINE_MS
} from './deadlines';
import type { RucssFetchFailure } from './response';
import { RUCSS_RESPONSE_MAX_BYTES } from './response';
import { RUCSS_RESULT_CSS_MAX_CHARS } from './run-plan';
import type { RucssAskMiss, RucssTestOutcome } from './run-test';

/**
 * What the user can do next:
 * - `retry` — run the test again;
 * - `reload-page` — reload the inspected page (a clean page, or its content script back);
 * - `review-patterns` — go to the offending field;
 * - `inspect-styles` — open the page-style inventory.
 */
export type RucssRecovery = 'retry' | 'reload-page' | 'review-patterns' | 'inspect-styles';

/** The field a `review-patterns` recovery leads to. */
export type RucssFocusTarget =
  | { readonly field: 'excludeFiles' }
  | { readonly field: 'replacement'; readonly index: number }
  | { readonly field: 'prepend' };

/** One outcome, ready to render. */
export interface RucssOutcomeView {
  readonly tone: 'ok' | 'warn' | 'error';
  readonly title: string;
  readonly message: string;
  /** Recovery actions, the main one first (may be empty: the form's Run stays available). */
  readonly recoveries: readonly RucssRecovery[];
  /** The request sent, when one was (copyable). */
  readonly requestUrl: string | null;
  /** Where `review-patterns` leads when one field is to blame (null: the pattern fields' start). */
  readonly focus: RucssFocusTarget | null;
}

/** The closing clause of every outcome that left the page as it was. */
const UNCHANGED = 'Nothing on the page was changed.';

/** Seconds, for a deadline in ms. */
function seconds(ms: number): string {
  return `${formatCount(Math.round(ms / 1000))} s`;
}

/** Mebibytes / mebi-characters, for a byte or character cap. */
function mebi(value: number): string {
  return `${formatCount(Math.round(value / (1024 * 1024)))} Mi`;
}

/** A pair's 1-based name. */
function pairName(index: number): string {
  return `Replacement ${formatCount(index + 1)}`;
}

/** A view with the common defaults. */
function view(
  tone: RucssOutcomeView['tone'],
  title: string,
  message: string,
  recoveries: readonly RucssRecovery[],
  extra: Partial<Pick<RucssOutcomeView, 'requestUrl' | 'focus'>> = {}
): RucssOutcomeView {
  return {
    tone,
    title,
    message,
    recoveries,
    requestUrl: extra.requestUrl ?? null,
    focus: extra.focus ?? null
  };
}

/**
 * A start that got no usable answer from the page (nothing changed).
 *
 * @param miss How the ask missed.
 */
function startMissView(miss: RucssAskMiss): RucssOutcomeView {
  switch (miss) {
    case 'no-receiver':
      return view(
        'error',
        "The page isn't listening",
        `The extension is not active on this page yet — reload it (an http or https page) and run again. ${UNCHANGED}`,
        ['reload-page', 'retry']
      );
    case 'timeout':
      return view(
        'error',
        "The page didn't answer in time",
        `No answer within ${seconds(RUCSS_START_DEADLINE_MS)}, the service request included. Run again; reload the page if it keeps happening. ${UNCHANGED}`,
        ['retry', 'reload-page']
      );
    case 'invalid-reply':
      return view(
        'error',
        "The page's answer was unreadable",
        `The page runs another version of the extension — reload it so both match, then run again. ${UNCHANGED}`,
        ['reload-page', 'retry']
      );
    case 'failed':
      return view(
        'error',
        "Couldn't reach the page",
        `Sending the test to the page failed — reload it and run again. ${UNCHANGED}`,
        ['reload-page', 'retry']
      );
  }
}

/**
 * A failed service request (nothing changed).
 *
 * @param failure The request's failure.
 * @param requestUrl The request sent.
 */
function fetchFailureView(failure: RucssFetchFailure, requestUrl: string): RucssOutcomeView {
  const at = { requestUrl };
  switch (failure.kind) {
    case 'network-error':
      return view(
        'error',
        "Couldn't reach the RUCSS service",
        `The request to mega.wp-rocket.me failed (offline, or blocked by a network filter or another extension). Check the connection and run again. ${UNCHANGED}`,
        ['retry'],
        at
      );
    case 'timeout':
      return view(
        'error',
        "The RUCSS service didn't answer in time",
        `No answer within ${seconds(RUCSS_FETCH_TIMEOUT_MS)}. The service may be busy — run again in a moment. ${UNCHANGED}`,
        ['retry'],
        at
      );
    case 'cancelled':
      return view(
        'warn',
        'The request was cancelled',
        `A newer test on this page cancelled it. ${UNCHANGED}`,
        ['retry'],
        at
      );
    case 'oversize':
      return view(
        'error',
        "The service's answer is too large",
        `It passed the ${mebi(RUCSS_RESPONSE_MAX_BYTES)}B limit, so it was not used. ${UNCHANGED}`,
        ['retry'],
        at
      );
    case 'not-utf8':
      return view(
        'error',
        "The service's answer is unreadable",
        `It was not UTF-8 text. ${UNCHANGED}`,
        ['retry'],
        at
      );
    case 'http-status':
      return view(
        'error',
        `The RUCSS service answered HTTP ${String(failure.httpStatus)}`,
        `The service did not run the test. Run again later. ${UNCHANGED}`,
        ['retry'],
        at
      );
    case 'malformed':
      return view(
        'error',
        "The service's answer holds no CSS",
        `HTTP ${String(failure.httpStatus)}, but not the answer a test returns. ${UNCHANGED}`,
        ['retry'],
        at
      );
    case 'service-code':
      return view(
        'error',
        `The RUCSS service returned code ${String(failure.serviceCode)}`,
        `It could not build used CSS for this address (HTTP ${String(failure.httpStatus)}). ${UNCHANGED}`,
        ['retry'],
        at
      );
  }
}

/**
 * A start the page answered with a failure (nothing changed).
 *
 * @param failure The start's failure.
 */
function startFailureView(failure: RucssStartFailure): RucssOutcomeView {
  switch (failure.kind) {
    case 'fetch':
      return fetchFailureView(failure.failure, failure.requestUrl);
    case 'refused':
      return view(
        'error',
        'The extension refused the request',
        `Only a top-level http or https page can be tested, for its own address. Nothing was sent. ${UNCHANGED}`,
        ['reload-page']
      );
    case 'background-unreachable':
      return view(
        'error',
        "The extension's background didn't answer",
        `Run again; if it persists, reload the extension. ${UNCHANGED}`,
        ['retry']
      );
    case 'superseded':
      return view(
        'warn',
        'A newer test replaced this one',
        `Another test started on this page. ${UNCHANGED}`,
        ['retry']
      );
    case 'too-many-styles':
      return view(
        'error',
        'Too many stylesheets to test',
        `The page links more than ${formatCount(RUCSS_TEST_LIMITS.links)} stylesheets (or their addresses pass ${mebi(RUCSS_TEST_LIMITS.linkChars)} characters). ${UNCHANGED}`,
        ['inspect-styles']
      );
  }
}

/**
 * A build that produced no CSS (nothing changed).
 *
 * @param failure The build's failure.
 * @param requestUrl The request sent.
 */
function buildFailureView(
  failure: Extract<RucssBuildOutcome, { ok: false }>,
  requestUrl: string
): RucssOutcomeView {
  const at = { requestUrl };
  switch (failure.problem) {
    case 'timeout':
      return view(
        'error',
        'Your patterns took too long',
        `Building the CSS with your replacements and exclusions stopped after ${seconds(RUCSS_BUILD_TIMEOUT_MS)} — a pattern likely backtracks without end. Simplify it and run again. ${UNCHANGED}`,
        ['review-patterns', 'retry'],
        at
      );
    case 'unavailable':
      return view(
        'error',
        "This panel can't build the CSS",
        `It has no Web Worker here, and your patterns never run on the page itself. ${UNCHANGED}`,
        ['retry'],
        at
      );
    case 'failed':
      return view(
        'error',
        'The CSS build stopped unexpectedly',
        `Run again; if it persists, reload the DevTools panel. ${UNCHANGED}`,
        ['retry'],
        at
      );
    case 'oversize':
      return failure.index === undefined
        ? view(
            'error',
            'The built CSS is too large',
            `With the CSS before and after it, the result passes ${mebi(RUCSS_RESULT_CSS_MAX_CHARS)} characters. ${UNCHANGED}`,
            ['review-patterns'],
            { ...at, focus: { field: 'prepend' } }
          )
        : view(
            'error',
            'The built CSS is too large',
            `${pairName(failure.index)} grows the result past ${mebi(RUCSS_RESULT_CSS_MAX_CHARS)} characters. ${UNCHANGED}`,
            ['review-patterns'],
            { ...at, focus: { field: 'replacement', index: failure.index } }
          );
    case 'pattern-failed':
      return view(
        'error',
        `${pairName(failure.index)} failed on this CSS`,
        `The pattern engine gave up (${failure.message}). Simplify the pattern and run again. ${UNCHANGED}`,
        ['review-patterns'],
        { ...at, focus: { field: 'replacement', index: failure.index } }
      );
    case 'exclusion-failed':
      return view(
        'error',
        'A stylesheet exclusion failed',
        `“${failure.line}” — the pattern engine gave up (${failure.message}). Simplify it and run again. ${UNCHANGED}`,
        ['review-patterns'],
        { ...at, focus: { field: 'excludeFiles' } }
      );
    case 'invalid-config':
      return view(
        'error',
        'The settings changed during the run',
        `A pattern stopped compiling between the check and the build. Run again. ${UNCHANGED}`,
        ['retry'],
        at
      );
  }
}

/**
 * An apply the page refused (nothing changed).
 *
 * @param failure The apply's failure.
 */
function applyFailureView(failure: RucssApplyFailure): RucssOutcomeView {
  switch (failure) {
    case 'stale-run':
      return view(
        'warn',
        'The test expired before it applied',
        `The page reloaded, another test started, or the build outlasted the page's wait. Run again. ${UNCHANGED}`,
        ['retry']
      );
    case 'invalid-request':
      return view(
        'error',
        'The page refused the result',
        `The result named stylesheets the page no longer has. Run again. ${UNCHANGED}`,
        ['retry']
      );
    case 'no-document':
      return view(
        'error',
        "This page has nowhere to put the test's CSS",
        `It has no head or root element. ${UNCHANGED}`,
        ['reload-page']
      );
    case 'css-blocked':
      return view(
        'error',
        "This page's security policy blocked the test's CSS",
        `Its Content Security Policy does not allow inline styles, so the result could not be added. ${UNCHANGED}`,
        []
      );
  }
}

/**
 * The success view: the counts that matter (removed, kept, gone) and the
 * empty-result warning — an empty answer leaves the page with only the
 * styles a test keeps.
 *
 * @param outcome The applied outcome.
 */
function appliedView(outcome: Extract<RucssTestOutcome, { kind: 'applied' }>): RucssOutcomeView {
  const { removed, preserved, excluded, gone, cssChars } = outcome.summary;
  const kept = preserved + excluded;
  const parts = [
    `Removed ${countLabel(removed, { one: 'style', other: 'styles' })}`,
    `kept ${formatCount(kept)}`,
    `injected ${countLabel(cssChars, { one: 'character', other: 'characters' })} of CSS`
  ];
  const already = gone > 0 ? ` ${formatCount(gone)} had already left the page.` : '';
  return cssChars === 0
    ? view(
        'warn',
        'Test applied — the result is empty',
        `${parts.join(', ')}.${already} The page now has only the styles the test kept. Reload it to restore its styles.`,
        ['reload-page'],
        { requestUrl: outcome.requestUrl }
      )
    : view(
        'ok',
        'Test applied',
        `${parts.join(', ')}.${already} Reload the page to restore its styles.`,
        ['reload-page'],
        { requestUrl: outcome.requestUrl }
      );
}

/**
 * Describe one outcome.
 *
 * @param outcome How the run ended.
 * @returns The view to render.
 */
export function describeRucssOutcome(outcome: RucssTestOutcome): RucssOutcomeView {
  switch (outcome.kind) {
    case 'config-unreadable':
      return view(
        'error',
        "Couldn't read the test settings",
        `The extension's storage did not answer — reload the DevTools panel and run again. Nothing was sent. ${UNCHANGED}`,
        ['retry']
      );
    case 'invalid-config':
      return view(
        'error',
        'Fix the patterns first',
        `${countLabel(outcome.problems.length, { one: 'pattern does', other: 'patterns do' })} not compile — see the marked fields. Nothing was sent. ${UNCHANGED}`,
        ['review-patterns'],
        {
          focus:
            outcome.problems[0]?.kind === 'replacement-pattern'
              ? { field: 'replacement', index: outcome.problems[0].index }
              : { field: 'excludeFiles' }
        }
      );
    case 'page-unreachable':
      return outcome.step === 'start'
        ? startMissView(outcome.miss)
        : view(
            'warn',
            "The page didn't confirm the test",
            'Its styles may or may not have changed. Reload it for a clean page, then run again.',
            ['reload-page', 'retry']
          );
    case 'start-failed':
      return startFailureView(outcome.failure);
    case 'build-failed':
      return buildFailureView(outcome.failure, outcome.requestUrl);
    case 'apply-failed':
      return applyFailureView(outcome.failure);
    case 'applied':
      return appliedView(outcome);
  }
}
