import { describe, expect, it } from 'vitest';
import { INTERCEPTION_UNAVAILABLE_CAUSES } from '../../lib/messaging/exclusion-session';
import {
  COPY_ALL_COPY,
  COUNT_COPY,
  DOCUMENT_FAILURE_COPY,
  DRAFT_TOO_LARGE_WORDS,
  INLINE_JQUERY_LINE,
  INVISIBLE_ROW_NOTE,
  LANE_COPY,
  NOTE_ROW_MAX,
  PAGE_OFF_COPY,
  PASTE_COPY,
  PROBLEM_COPY,
  ROW_NOTE_COPY,
  UNAVAILABLE_COPY,
  appliedRowWarningNote,
  appliedWarningLine,
  candidateAnnouncement,
  commitAnnouncement,
  noteToText,
  rowWarningNote,
  rowsPhrase,
  type RowRef,
  saveStateWords,
  sessionIndicator,
  unmodifiedCopy,
  runtimeUnavailableCopy,
  simulationListCopy,
  viewCopy
} from './copy';
import type { StoredRowDiff } from '../../lib/exclusion-builder/field-text';
import type { AppliedWarning, SessionView } from './session/session-view';
import type { OverlayState } from './session/machine';
import {
  LATEST_LIST_MISSES,
  SIMULATION_RUNTIME_UNAVAILABLE_CAUSES
} from '../../lib/wp-rocket-simulation/spec';

/** Names applied rows by their text (the rows left the lane). */
const textRefs = (rows: readonly string[]): readonly RowRef[] => rows.map((text) => ({ text }));

/** Names applied rows by their 1-based position in `lane`. */
const positionRefs =
  (lane: readonly string[]) =>
  (rows: readonly string[]): readonly RowRef[] =>
    rows.map((text) => ({ position: lane.indexOf(text) + 1 }));

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
    DRAFT_TOO_LARGE_WORDS,
    rowWarningNote('Row is only whitespace — x'),
    appliedRowWarningNote('WP Rocket stores this and it excludes every script'),
    ...COUNT_COPY.caveats(
      {
        candidates: 9,
        rewritten: 1,
        featureWide: false,
        undetermined: 2,
        approximate: 1,
        inlineUnknown: true,
        bestEffort: true,
        pageUnknown: false,
        pageOffRows: null,
        matchAllRows: ['(?a)']
      },
      'delayed scripts',
      positionRefs(['(?a)'])
    ),
    ...COUNT_COPY.caveats(
      {
        candidates: 9,
        rewritten: 9,
        featureWide: false,
        undetermined: 0,
        approximate: 0,
        inlineUnknown: false,
        bestEffort: false,
        pageUnknown: false,
        pageOffRows: ['.*'],
        matchAllRows: []
      },
      'deferred and wrapped scripts',
      textRefs,
      LANE_COPY.deferJs.page
    ),
    LANE_COPY.deferJs.page?.offLead(1) ?? '',
    LANE_COPY.deferJs.page?.offLead(2) ?? '',
    LANE_COPY.deferJs.page?.offOutcome(1) ?? '',
    LANE_COPY.deferJs.page?.offOutcome(2) ?? '',
    LANE_COPY.deferJs.page?.countsOff('row 1') ?? '',
    LANE_COPY.deferJs.page?.unknown ?? '',
    LANE_COPY.deferJs.page?.countsUnknown ?? '',
    PAGE_OFF_COPY.goTo(2),
    PAGE_OFF_COPY.more(1),
    PAGE_OFF_COPY.more(4),
    COPY_ALL_COPY.empty,
    COPY_ALL_COPY.failed,
    INVISIBLE_ROW_NOTE,
    PASTE_COPY.held,
    PASTE_COPY.failed,
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
  { kind: 'applied', reports: [], unmatched: 0, warnings: [], served: undefined },
  { kind: 'applied', reports: [], unmatched: 1, warnings: [], served: undefined },
  { kind: 'applied', reports: [], unmatched: 3, warnings: [], served: undefined },
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

describe('candidateAnnouncement', () => {
  const words = (outcome: Parameters<typeof candidateAnnouncement>[0]): string =>
    candidateAnnouncement(outcome, 'gtag.js', 'Delay JavaScript');

  it('says "already in" only when a row holds the candidate', () => {
    expect(words('added')).toBe('Added gtag.js to Delay JavaScript');
    expect(words('present')).toBe('gtag.js is already in Delay JavaScript');
  });

  it('names the real reason when nothing was added', () => {
    expect(words('dropped')).toBe(
      "gtag.js not added: WP Rocket's save would drop it from Delay JavaScript"
    );
    expect(words('full')).toBe('gtag.js not added: Delay JavaScript holds 500 rows at most');
    expect(words('held')).toBe("gtag.js not added: the exclusions can't be edited right now");
    for (const outcome of ['dropped', 'full', 'held'] as const) {
      expect(words(outcome)).not.toMatch(/already in/);
    }
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
    expect(saveStateWords({ kind: 'not-saved', reason: 'too-large' })).toBe(
      'Draft not saved: it is over 65,536 characters, so closing the overlay loses it. Remove rows to keep it.'
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
    bestEffort: false,
    pageUnknown: false,
    pageOffRows: null,
    matchAllRows: []
  };
  const NOUN = 'delayed scripts';

  it('words the count, feature-wide or row-driven, with no caveat when exact', () => {
    expect(COUNT_COPY.line(exact, 'delayed scripts')).toBe('3 of 9 delayed scripts restored');
    expect(COUNT_COPY.line({ ...exact, featureWide: true, rewritten: 9 }, 'lazy images')).toBe(
      'All 9 lazy images restored (feature disabled)'
    );
    expect(COUNT_COPY.caveats(exact, NOUN, textRefs)).toEqual([]);
  });

  it('says what the count could not tell, one line each, singular and plural', () => {
    expect(COUNT_COPY.caveats({ ...exact, undetermined: 1 }, NOUN, textRefs)).toEqual([
      '1 left as served: how WP Rocket matched it can’t be read from this page.'
    ]);
    expect(
      COUNT_COPY.caveats(
        {
          ...exact,
          undetermined: 2,
          approximate: 3,
          inlineUnknown: true,
          bestEffort: true
        },
        NOUN,
        textRefs
      )
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
      /^WP Rocket’s remote exclusion lists and any custom code filters aren’t read here \(assumed unused: rocket_exclude_defer_js, rocket_defer_jquery_patterns, rocket_defer_inline_exclusions\)\.$/
    );
    for (const lane of ['delayJs', 'lazyload', 'lazyRender'] as const)
      expect(LANE_COPY[lane].limitHint).toBeUndefined();
  });

  it('words Defer JS’s page-wide states, singular and plural (K.5b, warning since K.5c)', () => {
    const page = LANE_COPY.deferJs.page;
    expect(page?.offLead(1)).toBe('WP Rocket defers no script on this page because of this row:');
    expect(page?.offLead(2)).toBe('WP Rocket defers no script on this page because of these rows:');
    expect(page?.offOutcome(1)).toBe(
      'Apply still runs and previews the page as WP Rocket serves it, with no script deferred. Edit or remove it to defer scripts again.'
    );
    expect(page?.offOutcome(3)).toMatch(/Edit or remove them to defer scripts again\.$/);
    expect(page?.countsOff('rows 1 and 3')).toBe(
      'WP Rocket defers no script on this page because of rows 1 and 3, so every deferred script is restored.'
    );
    expect(page?.countsOff('')).toMatch(/because of the applied rows,/);
    expect(page?.unknown).toBe(
      'WP Rocket may defer no script on this page with these rows — not checked here.'
    );
    expect(PAGE_OFF_COPY.goTo(12)).toBe('Go to row 12');
    expect([PAGE_OFF_COPY.more(1), PAGE_OFF_COPY.more(2)]).toEqual([
      'And 1 more row.',
      'And 2 more rows.'
    ]);
    // Only the set-read lane has page words.
    for (const lane of ['delayJs', 'lazyload', 'lazyRender'] as const)
      expect(LANE_COPY[lane].page).toBeUndefined();
  });

  it('puts the page-state caveat first, only for a lane with page words', () => {
    const unknown = { ...exact, pageUnknown: true, bestEffort: true };
    expect(COUNT_COPY.caveats(unknown, NOUN, textRefs, LANE_COPY.deferJs.page)).toEqual([
      'These counts assume WP Rocket defers scripts on this page: with the applied rows, that isn’t checked here.',
      'Row counts are best effort: WP Rocket matches these rows as one pattern, so the first matching row is credited.'
    ]);
    expect(COUNT_COPY.caveats(unknown, NOUN, textRefs)).toHaveLength(1);
  });

  it('carries the applied warnings into the counts: page off first, then match-all rows (K.5c)', () => {
    const off = { ...exact, rewritten: 9, pageOffRows: ['(?<n>a)x', '(?<n>b)y'] };
    expect(
      COUNT_COPY.caveats(
        off,
        NOUN,
        positionRefs(['zzz', '(?<n>a)x', '(?<n>b)y']),
        LANE_COPY.deferJs.page
      )
    ).toEqual([
      'WP Rocket defers no script on this page because of rows 2 and 3, so every deferred script is restored.'
    ]);
    // Rows not named by the report: the generic words.
    expect(
      COUNT_COPY.caveats({ ...off, pageOffRows: [] }, NOUN, textRefs, LANE_COPY.deferJs.page)
    ).toEqual([
      'WP Rocket defers no script on this page because of the applied rows, so every deferred script is restored.'
    ]);
    // Without page words (not a set-read lane), no page line.
    expect(COUNT_COPY.caveats(off, NOUN, textRefs)).toEqual([]);
    const one = { ...exact, matchAllRows: ['(?a)'] };
    expect(COUNT_COPY.caveats(one, NOUN, positionRefs(['ok', '(?a)']))).toEqual([
      'Row 2 matches everything: WP Rocket excludes all delayed scripts with it, and so does this preview.'
    ]);
    const two = { ...exact, matchAllRows: ['(?a)', 'zzz|'] };
    expect(COUNT_COPY.caveats(two, NOUN, textRefs)).toEqual([
      '`(?a)` and `zzz|` match everything: WP Rocket excludes all delayed scripts with them, and so does this preview.'
    ]);
  });

  it('names applied rows by position, else by their text as code (capped)', () => {
    expect(rowsPhrase([{ position: 4 }])).toBe('row 4');
    expect(rowsPhrase([{ position: 1 }, { position: 3 }])).toBe('rows 1 and 3');
    expect(rowsPhrase([{ position: 1 }, { position: 2 }, { position: 4 }])).toBe('rows 1, 2 and 4');
    expect(rowsPhrase([{ position: 1 }, { text: 'a.js' }])).toBe('row 1 and `a.js`');
    const long = 'x'.repeat(NOTE_ROW_MAX + 10);
    expect(rowsPhrase([{ text: long }])).toBe(`\`${'x'.repeat(NOTE_ROW_MAX)}…\``);
  });

  it('words a row warning the preview applies (K.5c)', () => {
    expect(appliedRowWarningNote('WP Rocket stores this and it excludes every script')).toBe(
      'WP Rocket stores this and it excludes every script. Apply still runs and previews it as WP Rocket would.'
    );
  });

  it('hints each lane by WP Rocket’s own matching subject and case', () => {
    // Plain words, ASCII only (WP Rocket folds A–Z, nothing else).
    const ascii = '(upper and lower case A–Z count as the same)';
    expect(LANE_COPY.delayJs.rowHint).toBe(
      `Regular expression, matched against the script element ${ascii}`
    );
    expect(LANE_COPY.deferJs.rowHint).toBe(
      `Regular expression, matched against the script’s src value ${ascii}`
    );
    expect(LANE_COPY.lazyRender.rowHint).toBe(
      `Text, matched against the element’s opening tag ${ascii}`
    );
    expect(LANE_COPY.lazyload.rowHint).toMatch(
      /image’s attributes; upper and lower case must match/
    );
    for (const lane of ['delayJs', 'deferJs', 'lazyload', 'lazyRender'] as const)
      expect(LANE_COPY[lane].rowHint).not.toMatch(/case-(in)?sensitively/);
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

describe('applied warnings in the status banner (K.5c)', () => {
  const applied = (
    warnings: readonly AppliedWarning[],
    unmatched = 0
  ): Extract<SessionView, { kind: 'applied' }> => ({
    kind: 'applied',
    reports: [],
    unmatched,
    warnings,
    served: undefined
  });

  it('says each applied warning after what the page shows', () => {
    expect(viewCopy(applied([{ lane: 'deferJs', kind: 'page-off', positions: [1, 3] }]))).toEqual({
      title: 'Applied, with warnings',
      body: 'This page was rendered with your exclusions. Load JavaScript deferred: WP Rocket defers no script on this page because of rows 1 and 3, so every deferred script is restored.'
    });
    expect(
      viewCopy(applied([{ lane: 'delayJs', kind: 'match-all', positions: [2] }], 1)).body
    ).toBe(
      '1 row matches no element on this page. Check the rows marked “No match”. Delay JavaScript execution: Row 2 matches everything: WP Rocket excludes all delayed scripts with it, and so does this preview.'
    );
  });

  it('words a page-off whose rows are not named', () => {
    expect(appliedWarningLine({ lane: 'deferJs', kind: 'page-off', positions: [] })).toBe(
      'Load JavaScript deferred: WP Rocket defers no script on this page because of the applied rows, so every deferred script is restored.'
    );
  });

  it('stays the plain words without warnings', () => {
    expect(viewCopy(applied([]))).toEqual({
      title: 'Applied',
      body: 'This page was rendered with your exclusions.'
    });
  });
});

describe('unmodifiedCopy: runtime unavailable', () => {
  it('words every cause with a forward action', () => {
    for (const cause of SIMULATION_RUNTIME_UNAVAILABLE_CAUSES) {
      const copy = unmodifiedCopy({ kind: 'runtime-unavailable', cause });
      expect(copy).toBe(runtimeUnavailableCopy(cause));
      expect(copy).toMatch(
        /served unmodified\. (?:(?:Reload or reinstall|Update) the extension|Reload the page to retry)/
      );
    }
    // Unreachable is retried on the next document: a page reload, not a reinstall.
    expect(runtimeUnavailableCopy('asset-unreachable')).toBe(
      'The packaged simulation data could not be loaded, so the page was served unmodified. Reload the page to retry.'
    );
    expect(runtimeUnavailableCopy('hash-mismatch')).toBe(
      'The packaged simulation data is damaged, so the page was served unmodified. Reload or reinstall the extension.'
    );
    // A missing version is this build's gap: reinstalling the same build cannot fix it.
    expect(runtimeUnavailableCopy('version-missing')).toBe(
      'The packaged simulation data has no entry for this WP Rocket version, so the page was served unmodified. Update the extension to simulate this version.'
    );
  });
});

describe('simulationListCopy', () => {
  const NOW = 1_790_000_000_000;

  it('names the latest list with its age', () => {
    expect(
      simulationListCopy(
        { listSource: 'latest', listFetchedAt: NOW - 3 * 3_600_000, wpRocketVersion: '3.24' },
        NOW
      )
    ).toBe('Exclusion list: latest (fetched 3 h ago)');
  });

  it('names the bundled list with its version and why the latest one did not run', () => {
    expect(
      simulationListCopy(
        { listSource: 'bundled', listMiss: 'never-fetched', wpRocketVersion: '3.23.5.1' },
        NOW
      )
    ).toBe('Exclusion list: bundled with WP Rocket 3.23.5.1 (latest list not fetched yet)');
    const words = LATEST_LIST_MISSES.map((listMiss) =>
      simulationListCopy({ listSource: 'bundled', listMiss, wpRocketVersion: '3.24' }, NOW)
    );
    // Every miss has its own words.
    expect(new Set(words).size).toBe(LATEST_LIST_MISSES.length);
    for (const line of words)
      expect(line).toMatch(/^Exclusion list: bundled with WP Rocket 3\.24 \(.+\)$/);
  });
});
