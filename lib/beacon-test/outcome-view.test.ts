/** Every beacon outcome and configuration issue in words, with its recoveries and focus. */
import { describe, expect, it } from 'vitest';
import type { AskMiss } from '../messaging/bounded-ask';
import type { BeaconConfigIssue, BeaconTestDraft } from './config';
import {
  BEACON_FEATURE_LABELS,
  describeBeaconOutcome,
  describeConfigIssue,
  issueField,
  resultsSummary
} from './outcome-view';
import type { BeaconTestResults } from './results';
import type { BeaconTestOutcome } from './run-test';

const DRAFT: BeaconTestDraft = {
  features: { aboveTheFold: true, lazyRender: true },
  mobile: false,
  widthThreshold: 1600,
  heightThreshold: 700,
  lazyRenderThreshold: 1800,
  selectorText: 'img'
};

const RESULTS: BeaconTestResults = {
  aboveTheFold: { kind: 'ok', items: [], dropped: 0, truncated: false },
  lazyRender: { kind: 'ok', items: ['a', 'b'], dropped: 0, truncated: false }
};

describe('resultsSummary', () => {
  it('counts each feature that ran, marks a cut list and an unreadable one', () => {
    expect(resultsSummary(RESULTS)).toBe(
      'Found 0 critical image candidates and 2 lazy-render elements.'
    );
    expect(
      resultsSummary({
        aboveTheFold: { kind: 'ok', items: new Array(500).fill(null), dropped: 0, truncated: true },
        lazyRender: null
      })
    ).toBe('Found 500+ critical image candidates.');
    expect(resultsSummary({ aboveTheFold: null, lazyRender: { kind: 'malformed' } })).toBe(
      `Found an unreadable ${BEACON_FEATURE_LABELS.lazyRender} list.`
    );
    expect(resultsSummary({ aboveTheFold: null, lazyRender: null })).toBe(
      'The beacon returned no results.'
    );
  });
});

describe('describeBeaconOutcome', () => {
  it('reads a clean completed run as ok, with the summary and no recovery', () => {
    const view = describeBeaconOutcome(
      { kind: 'completed', results: RESULTS, scriptErrors: [] },
      DRAFT
    );
    expect(view).toEqual({
      tone: 'ok',
      title: 'Beacon test complete',
      message: 'Found 0 critical image candidates and 2 lazy-render elements.',
      recoveries: [],
      focus: null
    });
  });

  it('warns on a scan error, pointing at the selectors only when the critical-images scan threw', () => {
    const atf = describeBeaconOutcome(
      { kind: 'completed', results: RESULTS, scriptErrors: ['aboveTheFold'] },
      DRAFT
    );
    expect(atf.tone).toBe('warn');
    expect(atf.message).toContain('Optimize Critical Images scan stopped on an error');
    expect(atf.message).toContain('often a selector this page rejects');
    expect(atf.recoveries).toEqual(['review-settings', 'retry']);
    expect(atf.focus).toBe('selectorText');
    const lrc = describeBeaconOutcome(
      { kind: 'completed', results: RESULTS, scriptErrors: ['lazyRender'] },
      DRAFT
    );
    expect(lrc.message).not.toContain('selector');
    expect(lrc.recoveries).toEqual(['retry']);
    expect(lrc.focus).toBeNull();
  });

  it('separates a timed-out run with partial results from one with none', () => {
    const partial = describeBeaconOutcome({ kind: 'timed-out', partial: RESULTS }, DRAFT);
    expect(partial.tone).toBe('warn');
    expect(partial.message).toContain('within 15 s; these are the results it had by then');
    const none = describeBeaconOutcome({ kind: 'timed-out', partial: null }, DRAFT);
    expect(none.tone).toBe('error');
    expect(none.message).toContain('found nothing until then');
    expect(none.recoveries).toEqual(['retry', 'reload-page']);
  });

  it('names the viewport bound of the device that bailed, from the settings it ran with', () => {
    const desktop = describeBeaconOutcome({ kind: 'bailed', reason: 'screen-size' }, DRAFT);
    expect(desktop.message).toContain('at least 1,600 × 700 px');
    expect(desktop.recoveries).toEqual(['retry', 'review-settings']);
    expect(desktop.focus).toBe('widthThreshold');
    const mobile = describeBeaconOutcome(
      { kind: 'bailed', reason: 'screen-size' },
      { ...DRAFT, mobile: true, widthThreshold: 393, heightThreshold: 830 }
    );
    expect(mobile.message).toContain('at most 393 × 830 px');
    expect(mobile.message).toContain('device toolbar');
    const scrolled = describeBeaconOutcome({ kind: 'bailed', reason: 'page-scrolled' }, DRAFT);
    expect(scrolled.title).toBe('The page is scrolled');
    expect(scrolled.recoveries).toEqual(['retry', 'reload-page']);
  });

  it.each<[BeaconTestOutcome, string, readonly string[]]>([
    [{ kind: 'failed', message: 'boom' }, 'The beacon test failed', ['retry', 'reload-page']],
    [
      { kind: 'runner-unavailable' },
      "Couldn't load the beacon into the page",
      ['reload-page', 'retry']
    ],
    [{ kind: 'busy' }, 'A test is already running on this page', ['retry']]
  ])('reads the page answer %j', (outcome, title, recoveries) => {
    const view = describeBeaconOutcome(outcome, DRAFT);
    expect(view.title).toBe(title);
    expect(view.recoveries).toEqual(recoveries);
  });

  it('quotes a failure message', () => {
    expect(describeBeaconOutcome({ kind: 'failed', message: 'boom' }, DRAFT).message).toContain(
      '“boom”'
    );
  });

  it('sends a refused configuration to the first issue’s field', () => {
    const view = describeBeaconOutcome(
      {
        kind: 'invalid-config',
        issues: [{ kind: 'threshold', field: 'heightThreshold' }, { kind: 'no-selector' }]
      },
      DRAFT
    );
    expect(view.tone).toBe('error');
    expect(view.recoveries).toEqual(['review-settings']);
    expect(view.focus).toBe('heightThreshold');
    expect(describeBeaconOutcome({ kind: 'invalid-config', issues: [] }, DRAFT).focus).toBeNull();
  });

  it.each<[AskMiss, string]>([
    ['no-receiver', "The page isn't listening"],
    ['timeout', "The page didn't answer in time"],
    ['invalid-reply', "The page's answer was unreadable"],
    ['failed', "Couldn't reach the page"]
  ])('reads the ask miss %s', (miss, title) => {
    const view = describeBeaconOutcome({ kind: 'page-unreachable', miss }, DRAFT);
    expect(view.title).toBe(title);
    expect(view.tone).toBe('error');
    expect(view.recoveries.length).toBeGreaterThan(0);
  });

  it('derives the ask timeout from the deadlines', () => {
    expect(
      describeBeaconOutcome({ kind: 'page-unreachable', miss: 'timeout' }, DRAFT).message
    ).toContain('within 30 s');
  });
});

describe('describeConfigIssue / issueField', () => {
  it.each<[BeaconConfigIssue, RegExp, string | null]>([
    [{ kind: 'malformed' }, /unreadable/, null],
    [{ kind: 'no-feature' }, /Optimize Critical Images or Automatic Lazy Rendering/, 'features'],
    [
      { kind: 'threshold', field: 'lazyRenderThreshold' },
      /^Lazy-render distance must be a whole number of px from 1 to 100,000\.$/,
      'lazyRenderThreshold'
    ],
    [{ kind: 'no-selector' }, /at least one candidate selector/, 'selectorText'],
    [{ kind: 'too-many-selectors', count: 201 }, /^201 selectors — at most 200\.$/, 'selectorText'],
    [{ kind: 'selector-too-long', selector: 'div' }, /longer than 1,000/, 'selectorText'],
    [{ kind: 'selector-invalid', selector: 'a[' }, /“a\[” isn't a valid/, 'selectorText'],
    [{ kind: 'selector-unclosed', selector: 'img[alt="x' }, /isn't closed/, 'selectorText'],
    [{ kind: 'selector-list-invalid' }, /as a whole/, 'selectorText']
  ])('words %j and names its field', (issue, words, field) => {
    expect(describeConfigIssue(issue)).toMatch(words);
    expect(issueField(issue)).toBe(field);
  });
});
