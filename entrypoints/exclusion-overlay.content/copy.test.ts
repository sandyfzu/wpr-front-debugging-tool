import { describe, expect, it } from 'vitest';
import { INTERCEPTION_UNAVAILABLE_CAUSES } from '../../lib/messaging/exclusion-session';
import {
  DOCUMENT_FAILURE_COPY,
  LANE_COPY,
  PROBLEM_COPY,
  UNAVAILABLE_COPY,
  saveStateWords,
  sessionIndicator,
  unmodifiedCopy,
  viewCopy
} from './copy';
import type { SessionView } from './session/session-view';
import type { OverlayState } from './session/machine';

/** Every string the tables hold. */
function allWords(): string[] {
  return [
    ...Object.values(UNAVAILABLE_COPY).flatMap((copy) => [copy.title, copy.body]),
    ...Object.values(DOCUMENT_FAILURE_COPY),
    ...Object.values(PROBLEM_COPY),
    // Placeholders are sample row text, not sentences.
    ...Object.values(LANE_COPY).flatMap((copy) => [copy.label, copy.rowHint, copy.absent])
  ];
}

const VIEWS: readonly SessionView[] = [
  { kind: 'off' },
  { kind: 'unavailable', cause: 'detached', retryable: true },
  { kind: 'armed' },
  { kind: 'applied', reports: [], unmatched: 0, served: undefined },
  { kind: 'applied', reports: [], unmatched: 1, served: undefined },
  { kind: 'applied', reports: [], unmatched: 3, served: undefined },
  { kind: 'unmodified', reason: { kind: 'failed', reason: 'decode-failed' }, served: undefined },
  { kind: 'not-intercepted' },
  { kind: 'cant-tell' }
];

describe('word tables', () => {
  it('follow the word rules: no pleading, no exclamation, sentence case', () => {
    for (const words of allWords()) {
      expect(words, words).not.toMatch(/please|!/i);
      expect(words.charAt(0), words).toBe(words.charAt(0).toUpperCase());
    }
  });

  it('give every unavailable cause its own title and remedy', () => {
    const causes = Object.keys(INTERCEPTION_UNAVAILABLE_CAUSES);
    expect(Object.keys(UNAVAILABLE_COPY).sort()).toEqual(causes.sort());
    const titles = Object.values(UNAVAILABLE_COPY).map((copy) => copy.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('viewCopy', () => {
  it('words every view, singular and plural no-match counts included', () => {
    const copies = VIEWS.map(viewCopy);
    for (const copy of copies) expect(copy.title.length).toBeGreaterThan(0);
    expect(copies[4]?.body).toMatch(/^1 row matches/);
    expect(copies[5]?.body).toMatch(/^3 rows match/);
    expect(copies[1]).toBe(UNAVAILABLE_COPY.detached);
  });
});

describe('unmodifiedCopy', () => {
  it('names the feature, row and budget of an overrun', () => {
    expect(
      unmodifiedCopy({ kind: 'over-budget', feature: 'delay_js', row: '.*x', budgetMs: 2000 })
    ).toBe(
      'Delay JavaScript execution (row .*x) took longer than 2000 ms, so the page was served unmodified. Simplify the row, then apply again.'
    );
    expect(
      unmodifiedCopy({ kind: 'over-budget', feature: 'lazyload', row: null, budgetMs: 5 })
    ).toMatch(/^Image LazyLoad took longer/);
  });
});

describe('sessionIndicator', () => {
  const ready = (pending: 'apply' | 'stop' | null = null): OverlayState => ({
    phase: 'ready',
    status: { state: 'inactive' },
    pending,
    notice: null
  });

  it('always pairs a word with a glyph', () => {
    const states: OverlayState[] = [
      { phase: 'loading' },
      { phase: 'load-failed', problem: 'timeout' },
      { phase: 'reloading', stalled: false },
      ready('apply'),
      ready('stop')
    ];
    const indicators = [
      ...states.map((state) => sessionIndicator(state, null)),
      ...VIEWS.map((view) => sessionIndicator(ready(), view))
    ];
    for (const indicator of indicators) {
      expect(indicator.label.length).toBeGreaterThan(0);
      expect(indicator.glyph.length).toBeGreaterThan(0);
    }
    expect(indicators.map((indicator) => indicator.label)).toEqual([
      'Checking',
      'Unreachable',
      'Reloading',
      'Applying',
      'Stopping',
      'Not applied',
      'Unavailable',
      'Applied · waiting',
      'Applied',
      'Applied · no-match rows',
      'Applied · no-match rows',
      'Served unmodified',
      'Not intercepted',
      'Can’t verify'
    ]);
  });
});

describe('saveStateWords', () => {
  it('words each save state', () => {
    expect(saveStateWords({ kind: 'idle' })).toBeNull();
    expect(saveStateWords({ kind: 'saving' })).toBe('Saving draft…');
    expect(saveStateWords({ kind: 'saved' })).toBe('Draft saved');
    expect(saveStateWords({ kind: 'not-saved', reason: 'storage-failed' })).toBe(
      'Draft not saved: storage failed'
    );
    expect(saveStateWords({ kind: 'not-saved', reason: 'timeout' })).toBe(
      'Draft not saved: the extension took too long to answer.'
    );
  });
});
