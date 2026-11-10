/**
 * The JavaScript page's pure view layer: state chips, the inline-code shape
 * (line counting, the bounded preview, expandability), chips, estimates, the
 * per-row keyed flag bookkeeping (expanded, wrapped) and the count phrases.
 */
import { describe, expect, it } from 'vitest';
import type { JsScriptResource } from '../../../../lib/panel/resources-view-model';
import type { ScriptSimulation } from '../../../../lib/panel/script-states';
import { JS_PAGE_RESOURCES } from '../../../../lib/panel/resources-view-model';
import { formatCount } from '../../../../utils/format-count';
import { buildRowView } from './script-identity';
import {
  COLLAPSED_CODE_LINES,
  JS_VIEW_RESOURCES,
  PREVIEW_LINE_CHARS,
  ROW_ESTIMATES,
  buildChips,
  codeCaption,
  codeToggleLabel,
  collapsedPreview,
  delaySummaryBadge,
  countLines,
  estimateRowSize,
  expandedCutNote,
  expandedText,
  inlineCode,
  lineCount,
  pruneRowFlags,
  ORIGINAL_TYPE_TITLE,
  originalTypeDetail,
  sameScript,
  scriptChipSplit,
  scriptStateChips,
  UNVERIFIED_SIMULATION_SUFFIX,
  JS_CHIP_SOURCES
} from './script-view';

/** A classified script with overrides. */
function script(overrides: Partial<JsScriptResource> = {}): JsScriptResource {
  return {
    id: 0,
    type: 'external',
    content: 'https://example.test/a.js',
    delayed: false,
    deferred: false,
    deferredByWPR: false,
    fdtExcluded: null,
    minified: false,
    combined: false,
    originalType: null,
    ...overrides
  };
}

describe('delaySummaryBadge', () => {
  it('served, simulated (never "Not detected"), absent', () => {
    expect(delaySummaryBadge(true, false)).toEqual({ label: 'Detected', kind: 'ok' });
    expect(delaySummaryBadge(false, true)).toEqual({ label: 'Simulated', kind: 'info' });
    expect(delaySummaryBadge(false, false)).toEqual({ label: 'Not detected', kind: 'neutral' });
  });
});

/** Delay JS and Defer JS both run by a verified simulation. */
const BOTH_SIMULATED: ScriptSimulation = { delay: 'simulated', defer: 'simulated' };

/** The chips in order, each as `label/source`. */
function words(row: JsScriptResource, simulation?: ScriptSimulation): string[] {
  return scriptStateChips(row, simulation).map((chip) => `${chip.label}/${chip.source}`);
}

describe('scriptStateChips', () => {
  it.each([
    [{}, []],
    [{ type: 'inline' as const }, []],
    [{ delayed: true }, ['Delayed/wp-rocket']],
    // The page's own defer.
    [{ deferred: true }, ['Deferred/page']],
    [{ deferredByWPR: true, deferred: true }, ['Deferred/wp-rocket']],
    // The stamp alone still reads WP Rocket's defer.
    [{ deferredByWPR: true }, ['Deferred/wp-rocket']],
    [{ minified: true }, ['Minified/wp-rocket']],
    [{ combined: true }, ['Combined/wp-rocket']],
    [{ fdtExcluded: 'delay_js' }, ['Excluded/excluded']],
    [{ fdtExcluded: 'defer_all_js' }, ['Excluded/excluded']],
    // A marker naming a feature that applied anyway is no exclusion.
    [{ fdtExcluded: 'delay_js', delayed: true }, ['Delayed/wp-rocket']],
    [{ fdtExcluded: 'defer_all_js', deferred: true }, ['Deferred/page']],
    // An inline script cannot be deferred: no Deferred chip, no defer exclusion.
    [{ type: 'inline' as const, deferred: true, fdtExcluded: 'defer_all_js' }, []],
    // Most important first: the exclusion, then Delay JS, Defer JS, the file states.
    [
      { fdtExcluded: 'defer_all_js', delayed: true, minified: true },
      ['Excluded/excluded', 'Delayed/wp-rocket', 'Minified/wp-rocket']
    ],
    [
      { delayed: true, deferred: true, deferredByWPR: true, combined: true },
      ['Delayed/wp-rocket', 'Deferred/wp-rocket', 'Combined/wp-rocket']
    ]
  ] as const)('%j → %j', (overrides, expected) => {
    expect(words(script(overrides))).toEqual(expected);
  });

  it('negative states are no chips (the filters keep them)', () => {
    const labels = scriptStateChips(script({ fdtExcluded: 'delay_js,defer_all_js' })).map(
      (chip) => chip.label
    );
    expect(labels).toEqual(['Excluded']);
    expect(labels.join(' ')).not.toMatch(/Not /);
  });

  it('attributes Deferred per who deferred: WP Rocket, a verified simulation, the page', () => {
    const stamped = script({ deferredByWPR: true, deferred: true });
    expect(words(stamped, { delay: null, defer: 'simulated' })).toEqual(['Deferred/simulated']);
    expect(words(stamped, { delay: 'simulated', defer: null })).toEqual(['Deferred/wp-rocket']);
    // The page's own defer stays the page's, simulation or not.
    expect(words(script({ deferred: true }), BOTH_SIMULATED)).toEqual(['Deferred/page']);
    const [own] = scriptStateChips(script({ deferred: true }));
    expect(own).toEqual({
      id: 'deferred',
      label: 'Deferred',
      source: 'page',
      title: "The page's own defer attribute"
    });
    expect(scriptStateChips(stamped, BOTH_SIMULATED)[0]?.title).toBe(
      "Deferred by the FDT's Load JavaScript deferred simulation"
    );
    expect(scriptStateChips(stamped)[0]?.title).toBe(
      'Deferred by WP Rocket (Load JavaScript deferred)'
    );
  });

  it('attributes Delayed to a verified Delay JS simulation, else to WP Rocket', () => {
    const delayed = script({ delayed: true });
    expect(words(delayed, { delay: 'simulated', defer: null })).toEqual(['Delayed/simulated']);
    // Only the Delay JS fact moves Delayed.
    expect(words(delayed, { delay: null, defer: 'simulated' })).toEqual(['Delayed/wp-rocket']);
    expect(scriptStateChips(delayed, BOTH_SIMULATED)[0]?.title).toBe(
      "Delayed by the FDT's Delay JavaScript execution simulation"
    );
    expect(scriptStateChips(delayed)[0]?.title).toBe(
      'Delayed by WP Rocket (Delay JavaScript execution)'
    );
  });

  it("keeps an unverified marker's states WP Rocket's, flagged on hover", () => {
    const row = script({ delayed: true, deferred: true, deferredByWPR: true });
    const chips = scriptStateChips(row, { delay: 'unverified', defer: 'unverified' });
    expect(chips.map((chip) => [chip.source, chip.title])).toEqual([
      ['wp-rocket', 'Delayed by WP Rocket (Delay JavaScript execution) (simulation not verified)'],
      ['wp-rocket', 'Deferred by WP Rocket (Load JavaScript deferred) (simulation not verified)']
    ]);
    // Each flag follows its own feature's fact only.
    const [delayed, deferred] = scriptStateChips(row, { delay: 'unverified', defer: null });
    expect(delayed?.title?.endsWith(UNVERIFIED_SIMULATION_SUFFIX)).toBe(true);
    expect(deferred?.title).toBe('Deferred by WP Rocket (Load JavaScript deferred)');
    // The page's own defer is never flagged.
    expect(
      scriptStateChips(script({ deferred: true }), { delay: null, defer: 'unverified' })[0]?.title
    ).toBe("The page's own defer attribute");
  });

  it('declares all four sources for the legend', () => {
    expect(JS_CHIP_SOURCES).toEqual(['wp-rocket', 'simulated', 'excluded', 'page']);
  });

  it('never moves the exclusion or the file states under a simulation', () => {
    expect(
      words(script({ fdtExcluded: 'defer_all_js', delayed: true, minified: true }), BOTH_SIMULATED)
    ).toEqual(['Excluded/excluded', 'Delayed/simulated', 'Minified/wp-rocket']);
    expect(words(script({ combined: true }), BOTH_SIMULATED)).toEqual(['Combined/wp-rocket']);
  });

  it('names the excluded features in the Excluded chip’s title', () => {
    const chip = (fdtExcluded: string, delayed = false) =>
      scriptStateChips(script({ fdtExcluded, delayed }))[0];
    expect(chip('delay_js')).toMatchObject({
      source: 'excluded',
      title: 'Excluded by FDT from Delay JavaScript execution'
    });
    expect(chip('defer_all_js')?.title).toBe('Excluded by FDT from Load JavaScript deferred');
    expect(chip('delay_js,defer_all_js')?.title).toBe(
      'Excluded by FDT from Delay JavaScript execution and Load JavaScript deferred'
    );
    // Delayed anyway: only the defer exclusion is named.
    expect(chip('delay_js defer_all_js', true)?.title).toBe(
      'Excluded by FDT from Load JavaScript deferred'
    );
  });

  it('titles the file states with their feature names', () => {
    expect(scriptStateChips(script({ minified: true }))[0]).toMatchObject({
      source: 'wp-rocket',
      title: 'Minified by WP Rocket (Minify JavaScript files)'
    });
    expect(scriptStateChips(script({ combined: true }))[0]).toMatchObject({
      source: 'wp-rocket',
      title: 'Bundle built by WP Rocket (Combine JavaScript files)'
    });
    // Delayed now names its source and feature on hover too (it had no title).
    expect(scriptStateChips(script({ delayed: true }))[0]).toEqual({
      id: 'delayed',
      label: 'Delayed',
      source: 'wp-rocket',
      title: 'Delayed by WP Rocket (Delay JavaScript execution)'
    });
  });
});

describe('scriptChipSplit', () => {
  it('shows every chip of a row within the cap, no "+N"', () => {
    const split = scriptChipSplit(script({ delayed: true, deferred: true, minified: true }));
    expect(split.visible.map((chip) => chip.id)).toEqual(['delayed', 'deferred', 'minified']);
    expect(split.overflow).toBeNull();
  });

  it('a plain row has no chips at all', () => {
    expect(scriptChipSplit(script())).toEqual({ visible: [], overflow: null });
  });

  it('past the cap, the least important chips go behind "+N"', () => {
    // A row shape the detection does not produce today (the states are
    // mostly exclusive), held to the cap all the same.
    const split = scriptChipSplit(
      script({ fdtExcluded: 'defer_all_js', delayed: true, minified: true, combined: true })
    );
    expect(split.visible.map((chip) => chip.id)).toEqual(['excluded', 'delayed', 'combined']);
    expect(split.overflow).toEqual({
      label: '+1',
      title: 'Also: Minified (WP Rocket)',
      hidesWpRocket: true
    });
  });
});

describe('originalTypeDetail', () => {
  it.each([
    'text/javascript',
    ' Text/JavaScript ',
    'application/javascript',
    'text/jscript',
    ' ',
    '\t\n'
  ])('hides a classic or blank type (%j): it says nothing new', (originalType) => {
    expect(originalTypeDetail(script({ delayed: true, originalType }))).toBeNull();
  });

  it('shows module whatever its case', () => {
    expect(originalTypeDetail(script({ delayed: true, originalType: 'Module' }))).toBe(
      'type: Module'
    );
  });

  it('names a delayed row’s original type; none without one', () => {
    expect(originalTypeDetail(script({ delayed: true, originalType: 'module' }))).toBe(
      'type: module'
    );
    expect(originalTypeDetail(script({ delayed: true }))).toBeNull();
    expect(originalTypeDetail(script({ delayed: true, originalType: 'text/template' }))).toBe(
      'type: text/template'
    );
    // Parameters make a type a data block, not classic: worth showing.
    expect(
      originalTypeDetail(script({ delayed: true, originalType: 'text/javascript; charset=utf-8' }))
    ).toBe('type: text/javascript; charset=utf-8');
    expect(ORIGINAL_TYPE_TITLE).toBe(
      "The script's own type, restored when Delay JavaScript execution runs it"
    );
  });
});

describe('countLines', () => {
  it.each([
    ['', 0],
    ['a', 1],
    ['abc\nde', 2],
    ['a\nb\n', 2],
    ['a\n\n', 2],
    ['\n', 1],
    ['a\r\nbc', 2]
  ])('%j → %i lines', (text, lines) => {
    expect(countLines(text)).toBe(lines);
  });

  it('counts a large script', () => {
    expect(countLines(Array.from({ length: 10_000 }, () => 'x = 1;').join('\n'))).toBe(10_000);
  });
});

describe('collapsedPreview', () => {
  it('returns the text itself when nothing is cut', () => {
    for (const text of ['', 'a', 'a\nb\nc', 'a\nb\nc\n']) {
      expect(collapsedPreview(text)).toEqual({ preview: text, lineCut: false, cutLines: [] });
    }
  });

  it('keeps only the first three lines', () => {
    expect(collapsedPreview('a\nb\nc\nd\ne')).toEqual({
      preview: 'a\nb\nc',
      lineCut: false,
      cutLines: []
    });
  });

  it('cuts a long line at the cap, writing no mark into the code', () => {
    const long = 'y'.repeat(PREVIEW_LINE_CHARS + 1);
    // No mark inside the code: the cut is announced by the toggle.
    const cut = 'y'.repeat(PREVIEW_LINE_CHARS);
    expect(collapsedPreview(long)).toEqual({ preview: cut, lineCut: true, cutLines: [0] });
    expect(collapsedPreview(`a\n${long}\nc`)).toEqual({
      preview: `a\n${cut}\nc`,
      lineCut: true,
      cutLines: [1]
    });
    // Exactly at the cap is not cut.
    const exact = 'y'.repeat(PREVIEW_LINE_CHARS);
    expect(collapsedPreview(exact)).toEqual({ preview: exact, lineCut: false, cutLines: [] });
  });
});

describe('inlineCode', () => {
  it('is expandable past three lines, or when a preview line was cut', () => {
    expect(inlineCode('a\nb\nc\nd')).toEqual({
      lines: 4,
      expandable: true,
      preview: 'a\nb\nc',
      lineCut: false,
      cutLines: [],
      blank: false
    });
    expect(inlineCode('a\nb\nc').expandable).toBe(false);
    expect(inlineCode('z'.repeat(PREVIEW_LINE_CHARS + 1)).expandable).toBe(true);
    // A long-but-uncut line needs the block's clamp report to offer the toggle.
    expect(inlineCode('z'.repeat(200)).expandable).toBe(false);
  });

  it('marks empty and whitespace-only sources blank and never expandable', () => {
    expect(inlineCode('')).toMatchObject({ blank: true, expandable: false });
    expect(inlineCode('  \n\n\n\n  ')).toMatchObject({ blank: true, expandable: false });
  });
});

describe('codeToggleLabel', () => {
  it('names how much the click reveals, or collapses', () => {
    expect(codeToggleLabel(inlineCode('a\nb\nc\nd'), false)).toBe('Show all 4 lines');
    expect(codeToggleLabel(inlineCode('z'.repeat(COLLAPSED_CODE_LINES)), false)).toBe('Expand');
    expect(codeToggleLabel(inlineCode('z'.repeat(PREVIEW_LINE_CHARS + 1)), false)).toBe(
      'Show full lines'
    );
    expect(codeToggleLabel(inlineCode('a\nb\nc\nd'), true)).toBe('Collapse');
  });
});

describe('sameScript', () => {
  it('compares every data field, never the position', () => {
    const base = script();
    expect(sameScript(base, { ...base, id: 9 })).toBe(true);
    for (const change of [
      { type: 'inline' as const },
      { content: 'other' },
      { delayed: true },
      { deferred: true },
      { deferredByWPR: true },
      { fdtExcluded: 'delay_js' },
      { minified: true },
      { combined: true },
      { originalType: 'module' }
    ]) {
      expect(sameScript(base, { ...base, ...change })).toBe(false);
    }
  });
});

describe('JS_VIEW_RESOURCES', () => {
  it('lifts the shared chip table through the row (ids and labels unchanged)', () => {
    expect(JS_VIEW_RESOURCES.filters.map((filter) => [filter.id, filter.label])).toEqual(
      JS_PAGE_RESOURCES.filters.map((filter) => [filter.id, filter.label])
    );
    const view = buildRowView(script({ delayed: true }), 'k');
    const delayed = JS_VIEW_RESOURCES.filters.find((filter) => filter.id === 'delayed');
    expect(delayed?.predicate(view)).toBe(true);
    expect(delayed?.predicate(buildRowView(script(), 'k'))).toBe(false);
    expect(JS_VIEW_RESOURCES.searchField(view)).toBe('https://example.test/a.js');
  });
});

describe('buildChips', () => {
  const counts = {
    all: 3,
    delayed: 0,
    'non-delayed': 3,
    deferred: 0,
    'non-deferred': 3,
    minified: 0,
    combined: 0,
    excluded: 0,
    inline: 0,
    external: 3
  };

  it('disables zero-count chips except "all" and the selected one', () => {
    const chips = buildChips(JS_PAGE_RESOURCES.filters, counts, 'deferred');
    const disabled = chips.filter((chip) => chip.disabled).map((chip) => chip.value);
    expect(disabled).toEqual(['delayed', 'minified', 'combined', 'excluded', 'inline']);
    expect(chips.find((chip) => chip.value === 'deferred')).toMatchObject({
      count: 0,
      disabled: false
    });
  });

  it('keeps "all" enabled on an empty page whichever chip is selected', () => {
    const empty = Object.fromEntries(Object.keys(counts).map((key) => [key, 0])) as typeof counts;
    for (const selected of ['all', 'delayed'] as const) {
      const all = buildChips(JS_PAGE_RESOURCES.filters, empty, selected)[0];
      expect(all).toMatchObject({ value: 'all', disabled: false, label: 'Show all' });
    }
  });
});

describe('estimateRowSize', () => {
  it('seeds per row shape', () => {
    expect(estimateRowSize(buildRowView(script(), 'k'))).toBe(ROW_ESTIMATES.external);
    const inline = (content: string): number =>
      estimateRowSize(buildRowView(script({ type: 'inline', content }), 'k'));
    expect(inline('')).toBe(ROW_ESTIMATES.inlineBlank);
    expect(inline('a')).toBe(ROW_ESTIMATES.inlineShort);
    expect(inline('a\nb\nc\nd')).toBe(ROW_ESTIMATES.inlineCollapsed);
  });
});

describe('row-flag bookkeeping', () => {
  const a = buildRowView(script({ content: 'a' }), 'a');
  const b = buildRowView(script({ content: 'b' }), 'b');

  it('keeps keys whose view survived unchanged, by identity', () => {
    const flags = new Set(['a', 'b']);
    expect(pruneRowFlags(flags, [a, b], [b, a])).toBe(flags);
    expect(pruneRowFlags(new Set<string>(), [a], [])).toEqual(new Set());
  });

  it('drops keys whose script is gone or changed under the same key', () => {
    const changed = buildRowView(script({ content: 'b2' }), 'b');
    expect([...pruneRowFlags(new Set(['a', 'b']), [a, b], [a])]).toEqual(['a']);
    expect([...pruneRowFlags(new Set(['a', 'b']), [a, b], [a, changed])]).toEqual(['a']);
  });
});

describe('phrases', () => {
  it('formats counts with thousands separators', () => {
    expect(formatCount(5000)).toBe('5,000');
    expect(lineCount(1)).toBe('1 line');
    expect(lineCount(1040)).toBe('1,040 lines');
  });

  it('joins the language and the count into the row caption', () => {
    expect(codeCaption('javascript', 1)).toBe('javascript · 1 line');
    expect(codeCaption('javascript', 1040)).toBe('javascript · 1,040 lines');
  });
});

describe('expandedText', () => {
  it('keeps a source within the limit whole', () => {
    expect(expandedText('abc', 3)).toEqual({ text: 'abc', cut: false });
  });

  it('cuts a longer source at the limit, never splitting a surrogate pair', () => {
    expect(expandedText('abcd', 3)).toEqual({ text: 'abc', cut: true });
    // '😀' is two UTF-16 units: a cut through it keeps neither half.
    expect(expandedText('ab😀cd', 3)).toEqual({ text: 'ab', cut: true });
    expect(expandedText('ab😀cd', 4)).toEqual({ text: 'ab😀', cut: true });
  });

  it('names the limit in its note', () => {
    expect(expandedCutNote(20_000)).toBe(
      'Showing the first 20,000 characters — copy gets the full script.'
    );
  });
});
