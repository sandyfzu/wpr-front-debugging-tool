import { describe, expect, it } from 'vitest';
import { INTERCEPTION_UNAVAILABLE_CAUSES } from '../../lib/messaging/exclusion-session';
import {
  COPY_ALL_COPY,
  COUNT_COPY,
  DOCUMENT_FAILURE_COPY,
  INLINE_JQUERY_LINE,
  INVISIBLE_ROW_NOTE,
  LANE_COPY,
  NOTE_ROW_MAX,
  PASTE_COPY,
  PROBLEM_COPY,
  ROW_NOTE_COPY,
  UNAVAILABLE_COPY,
  commitAnnouncement,
  noteToText,
  rowWarningNote,
  saveStateWords,
  sessionIndicator,
  unmodifiedCopy,
  viewCopy
} from './copy';
import type { StoredRowDiff } from '../../lib/exclusion-builder/field-text';
import type { SessionView } from './session/session-view';
import type { OverlayState } from './session/machine';

/** Every string the tables hold. */
function allWords(): string[] {
  return [
    ...Object.values(UNAVAILABLE_COPY).flatMap((copy) => [copy.title, copy.body]),
    ...Object.values(DOCUMENT_FAILURE_COPY),
    ...Object.values(PROBLEM_COPY),
    // Placeholders are sample row text, not sentences.
    ...Object.values(LANE_COPY).flatMap((copy) => [
      copy.label,
      copy.rowHint,
      copy.absent,
      copy.copyHint,
      ...(copy.limitHint === undefined ? [] : [copy.limitHint]),
      ...(copy.rowsNote === undefined ? [] : [copy.rowsNote])
    ]),
    INLINE_JQUERY_LINE,
    rowWarningNote('Row is only whitespace — x'),
    ...COUNT_COPY.caveats({
      candidates: 9,
      rewritten: 1,
      featureWide: false,
      undetermined: 2,
      approximate: 1,
      inlineUnknown: true,
      bestEffort: true
    }),
    COPY_ALL_COPY.empty,
    COPY_ALL_COPY.failed,
    INVISIBLE_ROW_NOTE,
    PASTE_COPY.laneFull(500),
    PASTE_COPY.dropped(1, 500),
    PASTE_COPY.dropped(3, 500),
    ROW_NOTE_COPY.undo,
    ROW_NOTE_COPY.moreRemoved(2),
    ROW_NOTE_COPY.summary({ source: 'paste', changed: 2, removed: 1 }),
    noteToText(ROW_NOTE_COPY.removed({ state: 'dropped', reason: 'zero', typed: '0' }, null)),
    noteToText(ROW_NOTE_COPY.row({ state: 'stored-as', stored: 'a', typed: 'a ' }))
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
    ).toMatch(/^LazyLoad for images took longer/);
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
      { phase: 'reloading' },
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
      // Changed in audit round 1: its own clause, no longer a lower-cased sentence.
      'Draft not saved: the extension took too long to answer'
    );
  });
});

describe('copy-all words', () => {
  it('names the control per lane and counts what was copied', () => {
    expect(COPY_ALL_COPY.name(LANE_COPY.delayJs.label)).toBe(
      `Copy all ${LANE_COPY.delayJs.label} exclusions`
    );
    expect(COPY_ALL_COPY.copied(1)).toBe('Copied 1 exclusion');
    expect(COPY_ALL_COPY.copied(12)).toBe('Copied 12 exclusions');
  });

  it('tells the lane without a settings field where its lines go', () => {
    expect(LANE_COPY.lazyRender.copyHint).toMatch(/rocket_lrc_exclusions/);
    expect(LANE_COPY.delayJs.copyHint).toMatch(/one per line/i);
  });
});

describe('paste words', () => {
  it('count the lines a capped paste left out', () => {
    expect(PASTE_COPY.dropped(1, 500)).toBe(
      '1 pasted line was not added: a lane holds 500 rows at most.'
    );
    expect(PASTE_COPY.dropped(2, 500)).toMatch(/^2 pasted lines were not added/);
  });
});

describe('ROW_NOTE_COPY', () => {
  it('says how WP Rocket stores a row, with the typed text, as code runs', () => {
    expect(
      ROW_NOTE_COPY.row({ state: 'stored-as', stored: 'jquery-(.*).js', typed: 'jquery-*.js' })
    ).toEqual([
      'WP Rocket stores this as ',
      { code: 'jquery-(.*).js' },
      ' (you typed ',
      { code: 'jquery-*.js' },
      ').'
    ]);
  });

  it('merges the unverified and safe-mode conditions into one note', () => {
    const unverified = {
      state: 'unverified',
      stored: '(?+1)(x)',
      construct: '(?+1)',
      detail: 'relative reference',
      typed: '(?+1)(x)'
    } as const;
    expect(noteToText(ROW_NOTE_COPY.row(unverified))).toBe(
      'WP Rocket’s handling of this row isn’t checked here, so the preview doesn’t apply it; kept as typed.'
    );
    // Only the ends' whitespace went: said in words (it is invisible as code).
    expect(noteToText(ROW_NOTE_COPY.row({ ...unverified, typed: ' (?+1)(x) ' }))).toBe(
      'WP Rocket stores this without the spaces at its ends. Whether WP Rocket keeps it isn’t checked here, so the preview doesn’t apply it.'
    );
    expect(noteToText(ROW_NOTE_COPY.row({ ...unverified, typed: '(?+1)(x)*' }))).toBe(
      'WP Rocket stores this as (?+1)(x) (you typed (?+1)(x)*). Whether WP Rocket keeps it isn’t checked here, so the preview doesn’t apply it.'
    );
    expect(
      noteToText(
        ROW_NOTE_COPY.row({ state: 'unchanged', typed: 'js-(before|after)', dropsInSafeMode: true })
      )
    ).toBe(
      'WP Rocket drops this row when Safe Mode for jQuery is on (that setting can’t be read from the page).'
    );
    expect(
      noteToText(
        ROW_NOTE_COPY.row({
          state: 'stored-as',
          stored: 'js-(before|after)',
          typed: ' js-(before|after)',
          dropsInSafeMode: true
        })
      )
    ).toMatch(/its ends\. WP Rocket drops this row when Safe Mode/);
  });

  it('names every drop reason, the copied row and the rejected construct', () => {
    const removed = (
      diff: Parameters<typeof ROW_NOTE_COPY.removed>[0],
      copyOf: number | null = null
    ): string => noteToText(ROW_NOTE_COPY.removed(diff, copyOf));
    expect(removed({ state: 'dropped', reason: 'empty', typed: '<b></b>' })).toBe(
      'Removed <b></b>: WP Rocket drops rows left empty once saved.'
    );
    expect(removed({ state: 'dropped', reason: 'zero', typed: ' 0' })).toBe(
      'Removed  0: WP Rocket drops rows that read 0.'
    );
    expect(removed({ state: 'dropped', reason: 'duplicate', typed: 'a' }, 2)).toBe(
      'Removed a: WP Rocket drops a copy of row 2.'
    );
    expect(removed({ state: 'dropped', reason: 'duplicate', typed: 'a' })).toBe(
      'Removed a: WP Rocket drops a copy of another row.'
    );
    expect(
      removed({
        state: 'dropped',
        reason: 'invalid-pattern',
        typed: '(',
        construct: '(',
        detail: 'missing )'
      })
    ).toBe('Removed (: WP Rocket drops patterns it can’t read: ( (missing )).');
    expect(removed({ state: 'dropped', reason: 'invalid-pattern', typed: '(' })).toBe(
      'Removed (: WP Rocket drops patterns it can’t read.'
    );
    expect(removed({ state: 'dropped', reason: 'safe-mode', typed: 'js-(before|after)' })).toMatch(
      /drops this row while Safe Mode for jQuery is on\.$/
    );
  });

  it('cuts long row texts it quotes, keeping them code', () => {
    const long = 'x'.repeat(NOTE_ROW_MAX + 10);
    const note = ROW_NOTE_COPY.removed({ state: 'dropped', reason: 'zero', typed: long }, null);
    expect(note[1]).toEqual({ code: `${'x'.repeat(NOTE_ROW_MAX)}…` });
  });

  it('counts a batch and names undo targets', () => {
    expect(ROW_NOTE_COPY.summary({ source: 'paste', changed: 3, removed: 1 })).toBe(
      '3 pasted rows changed to WP Rocket’s stored form, 1 removed.'
    );
    expect(ROW_NOTE_COPY.summary({ source: 'restore', changed: 1, removed: 0 })).toBe(
      '1 saved row changed to WP Rocket’s stored form.'
    );
    expect(ROW_NOTE_COPY.summary({ source: 'apply', changed: 0, removed: 2 })).toBe(
      '2 rows removed: WP Rocket drops them when saving.'
    );
    expect(ROW_NOTE_COPY.moreRemoved(1)).toBe('1 more row removed.');
    expect(ROW_NOTE_COPY.moreRemoved(4)).toBe('4 more rows removed.');
    expect(ROW_NOTE_COPY.undoName('Image lazyload', 3)).toBe('Undo change to Image lazyload row 3');
    expect(ROW_NOTE_COPY.restoreName('Image lazyload', 2)).toBe(
      'Restore removed Image lazyload row 2'
    );
  });
});

describe('commitAnnouncement', () => {
  const label = LANE_COPY.delayJs.label;

  it('says one changed or removed row by its number', () => {
    expect(
      commitAnnouncement({
        source: 'row',
        news: [
          {
            lane: 'delayJs',
            position: 2,
            diff: { state: 'stored-as', stored: 'a(.*)', typed: 'a*' },
            copyOf: null
          }
        ]
      })
    ).toBe(`${label} row 2: WP Rocket stores it as a(.*).`);
    expect(
      commitAnnouncement({
        source: 'row',
        news: [
          {
            lane: 'delayJs',
            position: 3,
            diff: { state: 'dropped', reason: 'duplicate', typed: 'a' },
            copyOf: 1
          }
        ]
      })
    ).toBe(`${label} row 3 removed: WP Rocket drops a copy of row 1.`);
  });

  it('counts a batch, ignores flag-only news, says nothing without a change', () => {
    const flagged = {
      lane: 'delayJs',
      position: 1,
      diff: { state: 'unchanged', typed: 'js-(before|after)', dropsInSafeMode: true },
      copyOf: null
    } as const;
    expect(commitAnnouncement({ source: 'restore', news: [flagged] })).toBeNull();
    expect(
      commitAnnouncement({
        source: 'paste',
        news: [
          flagged,
          { ...flagged, diff: { state: 'stored-as', stored: 'b', typed: ' b' } },
          { ...flagged, diff: { state: 'dropped', reason: 'zero', typed: '0' } }
        ]
      })
    ).toBe('1 pasted row changed to WP Rocket’s stored form, 1 removed.');
  });
});

describe('long and whitespace-only changes (audit round)', () => {
  const typed = `https://example.com/wp-content/plugins/${'my-plugin/'.repeat(4)}assets/js/script-*.min.js`;
  const stored = typed.replace('*', '(.*)');
  const news = (diff: StoredRowDiff) =>
    commitAnnouncement({
      source: 'row',
      news: [{ lane: 'delayJs', position: 2, diff, copyOf: null }]
    });

  it('cuts long rows around their difference, the same way in note and announcement', () => {
    const note = ROW_NOTE_COPY.row({ state: 'stored-as', stored, typed });
    const quotes = note.filter((part): part is { code: string } => typeof part !== 'string');
    expect(quotes.map((quote) => quote.code)).toEqual([
      '…s/js/script-(.*).min.js',
      '…s/js/script-*.min.js'
    ]);
    expect(news({ state: 'stored-as', stored, typed })).toBe(
      `${LANE_COPY.delayJs.label} row 2: WP Rocket stores it as …s/js/script-(.*).min.js.`
    );
  });

  it('says a trim of the ends in words, never as invisible quotes', () => {
    const diff = { state: 'stored-as', stored: 'a.js', typed: '\ta.js  ' } as const;
    expect(noteToText(ROW_NOTE_COPY.row(diff))).toBe(
      'WP Rocket stores this without the spaces at its ends.'
    );
    expect(news(diff)).toBe(
      `${LANE_COPY.delayJs.label} row 2: WP Rocket stores it without the spaces at its ends.`
    );
  });

  it('names the removed-rows list by its lane', () => {
    expect(ROW_NOTE_COPY.removedListName('LazyLoad for images')).toBe(
      'LazyLoad for images rows removed'
    );
  });
});

describe('lane counts and hints (K.5a.2)', () => {
  const exact = {
    candidates: 9,
    rewritten: 3,
    featureWide: false,
    undetermined: 0,
    approximate: 0,
    inlineUnknown: false,
    bestEffort: false
  };

  it('words the count, feature-wide or row-driven, with no caveat when exact', () => {
    expect(COUNT_COPY.line(exact, 'delayed scripts')).toBe('3 of 9 delayed scripts restored');
    expect(COUNT_COPY.line({ ...exact, featureWide: true, rewritten: 9 }, 'lazy images')).toBe(
      'All 9 lazy images restored (feature disabled)'
    );
    expect(COUNT_COPY.caveats(exact)).toEqual([]);
  });

  it('says what the count could not tell, one line each, singular and plural', () => {
    expect(COUNT_COPY.caveats({ ...exact, undetermined: 1 })).toEqual([
      '1 left as served: how WP Rocket matched it can’t be read from this page.'
    ]);
    expect(
      COUNT_COPY.caveats({
        ...exact,
        undetermined: 2,
        approximate: 3,
        inlineUnknown: true,
        bestEffort: true
      })
    ).toEqual([
      '2 left as served: how WP Rocket matched them can’t be read from this page.',
      '3 matched against a rebuilt tag: WP Rocket’s original wasn’t on the page.',
      'Whether inline jQuery stays wrapped depends on your existing Defer JS exclusions.',
      'Row counts are best effort: WP Rocket matches these rows as one pattern, so the first matching row is credited.'
    ]);
  });

  it('counts Defer JS scripts with the wrapped inline ones, and names its limits', () => {
    expect(LANE_COPY.deferJs.noun).toBe('deferred and wrapped scripts');
    expect(LANE_COPY.deferJs.limitHint).toMatch(
      /remote exclusion lists aren’t read here.*rocket_exclude_defer_js, rocket_defer_jquery_patterns and rocket_defer_inline_exclusions/
    );
    for (const lane of ['delayJs', 'lazyload', 'lazyRender'] as const)
      expect(LANE_COPY[lane].limitHint).toBeUndefined();
  });

  it('hints each lane by WP Rocket’s own matching subject and case', () => {
    expect(LANE_COPY.delayJs.rowHint).toMatch(/script element, case-insensitively$/);
    expect(LANE_COPY.deferJs.rowHint).toMatch(/src value, case-insensitively$/);
    expect(LANE_COPY.lazyload.rowHint).toMatch(/image’s attributes, case-sensitively/);
    expect(LANE_COPY.lazyRender.rowHint).toMatch(
      /case-insensitively against the element’s opening tag$/
    );
  });

  it('copies Automatic Lazy Rendering as a filter, and says so', () => {
    expect(LANE_COPY.lazyRender.copyHint).toMatch(/rocket_lrc_exclusions filter/);
    expect(LANE_COPY.lazyRender.rowsNote).toMatch(/^Excluding an element re-keys/);
    expect(COPY_ALL_COPY.copied(2, LANE_COPY.lazyRender.copiedAs)).toBe(
      'Copied 2 exclusions as a rocket_lrc_exclusions filter'
    );
    expect(COPY_ALL_COPY.copied(1, LANE_COPY.delayJs.copiedAs)).toBe('Copied 1 exclusion');
  });

  it('tells what the editor does with a warned row', () => {
    expect(rowWarningNote('Row is only whitespace — x')).toBe(
      'Row is only whitespace — x. It is left out here: a blank row is an unfinished edit.'
    );
  });
});
