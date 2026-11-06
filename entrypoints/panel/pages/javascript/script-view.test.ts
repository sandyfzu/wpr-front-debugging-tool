/**
 * The JavaScript page's pure view layer: state badges, the inline-code shape
 * (line counting, the bounded preview, expandability), chips, estimates, the
 * per-row keyed flag bookkeeping (expanded, wrapped) and the count phrases.
 */
import { describe, expect, it } from 'vitest';
import type { JsScriptResource } from '../../../../lib/panel/resources-view-model';
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
  pruneKeyedFlags,
  pruneRowFlags,
  sameScript,
  scriptStateBadges,
  toggleRowFlag
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

describe('scriptStateBadges', () => {
  it.each([
    [{ delayed: true }, 'Delayed', 'info'],
    [{ fdtExcluded: 'delay_js' }, 'Not delayed (Excluded by FDT)', 'warn'],
    [{ fdtExcluded: 'delay_js,defer_all_js' }, 'Not delayed (Excluded by FDT)', 'warn'],
    [{ fdtExcluded: 'defer_all_js' }, 'Not delayed', 'neutral'],
    [{}, 'Not delayed', 'neutral'],
    // Delayed wins over the marker (the marker only explains a non-delay).
    [{ delayed: true, fdtExcluded: 'delay_js' }, 'Delayed', 'info']
  ] as const)('delay state of %j → %s (%s)', (overrides, label, kind) => {
    expect(scriptStateBadges(script(overrides))[0]).toEqual({ label, kind });
  });

  it.each([
    [{ deferredByWPR: true, deferred: true }, 'Deferred (By WP Rocket)', 'info'],
    [{ deferredByWPR: true }, 'Deferred (By WP Rocket)', 'info'],
    [{ deferred: true }, 'Deferred', 'info'],
    [{ deferred: true, fdtExcluded: 'defer_all_js' }, 'Deferred', 'info'],
    [{ fdtExcluded: 'defer_all_js' }, 'Not deferred (Excluded by FDT)', 'warn'],
    [{ fdtExcluded: 'delay_js' }, 'Not deferred', 'neutral'],
    [{}, 'Not deferred', 'neutral']
  ] as const)('defer state of an external %j → %s (%s)', (overrides, label, kind) => {
    const badges = scriptStateBadges(script(overrides));
    expect(badges).toHaveLength(2);
    expect(badges[1]).toEqual({ label, kind });
  });

  it('names a verified Defer JS simulation’s stamp as the simulation’s, never WP Rocket’s', () => {
    expect(scriptStateBadges(script({ deferredByWPR: true, deferred: true }), true)[1]).toEqual({
      label: 'Deferred (Simulated)',
      kind: 'info'
    });
    // Only the stamp changes words: a native defer or an excluded script reads as before.
    expect(scriptStateBadges(script({ deferred: true }), true)[1]?.label).toBe('Deferred');
    expect(scriptStateBadges(script({ fdtExcluded: 'defer_all_js' }), true)[1]?.label).toBe(
      'Not deferred (Excluded by FDT)'
    );
  });

  it('gives an inline script the delay state only (it cannot be deferred)', () => {
    const badges = scriptStateBadges(script({ type: 'inline', deferred: true }));
    expect(badges).toEqual([{ label: 'Not delayed', kind: 'neutral' }]);
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
      { fdtExcluded: 'delay_js' }
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
    inline: 0,
    external: 3
  };

  it('disables zero-count chips except "all" and the selected one', () => {
    const chips = buildChips(JS_PAGE_RESOURCES.filters, counts, 'deferred');
    const disabled = chips.filter((chip) => chip.disabled).map((chip) => chip.value);
    expect(disabled).toEqual(['delayed', 'inline']);
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

  it('prunes any keyed rows by their key function (numeric keys too)', () => {
    const one = { id: 1 };
    const two = { id: 2 };
    const flags = new Set([1, 2]);
    const keyOf = (row: { id: number }): number => row.id;
    expect(pruneKeyedFlags(flags, [one, two], [two, one], keyOf)).toBe(flags);
    expect([...pruneKeyedFlags(flags, [one, two], [one, { id: 2 }], keyOf)]).toEqual([1]);
    expect([...pruneKeyedFlags(flags, [one, two], [two], keyOf)]).toEqual([2]);
  });

  it('toggles membership into a fresh set', () => {
    const empty = new Set<string>();
    const one = toggleRowFlag(empty, 'k');
    expect(one).not.toBe(empty);
    expect([...one]).toEqual(['k']);
    expect([...toggleRowFlag(one, 'k')]).toEqual([]);
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
