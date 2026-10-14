/**
 * The JavaScript page's pure view layer: state badges, the inline-code shape
 * (line counting, the bounded preview, expandability), chips, estimates, the
 * expanded-set bookkeeping and the count phrases.
 */
import { describe, expect, it } from 'vitest';
import type { JsScriptResource } from '../../../../lib/panel/resources-view-model';
import { JS_PAGE_RESOURCES } from '../../../../lib/panel/resources-view-model';
import { buildRowView } from './script-identity';
import {
  COLLAPSED_CODE_LINES,
  JS_VIEW_RESOURCES,
  PREVIEW_CUT_MARK,
  PREVIEW_LINE_CHARS,
  ROW_ESTIMATES,
  buildChips,
  codeToggleLabel,
  collapsedPreview,
  countLines,
  estimateRowSize,
  formatCount,
  inlineCode,
  lineCount,
  pruneExpanded,
  resultAnnouncement,
  sameScript,
  scriptCount,
  scriptStateBadges,
  toggleExpanded
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
      expect(collapsedPreview(text)).toEqual({ preview: text, lineCut: false });
    }
  });

  it('keeps only the first three lines', () => {
    expect(collapsedPreview('a\nb\nc\nd\ne')).toEqual({ preview: 'a\nb\nc', lineCut: false });
  });

  it('cuts a long line at the cap and marks it with an ellipsis', () => {
    const long = 'y'.repeat(PREVIEW_LINE_CHARS + 1);
    const cut = `${'y'.repeat(PREVIEW_LINE_CHARS)}${PREVIEW_CUT_MARK}`;
    expect(collapsedPreview(long)).toEqual({ preview: cut, lineCut: true });
    expect(collapsedPreview(`a\n${long}\nc`).preview).toBe(`a\n${cut}\nc`);
    // Exactly at the cap is not cut.
    const exact = 'y'.repeat(PREVIEW_LINE_CHARS);
    expect(collapsedPreview(exact)).toEqual({ preview: exact, lineCut: false });
  });
});

describe('inlineCode', () => {
  it('is expandable past three lines, or when a preview line was cut', () => {
    expect(inlineCode('a\nb\nc\nd')).toEqual({
      lines: 4,
      expandable: true,
      preview: 'a\nb\nc',
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
      expect(all).toMatchObject({ value: 'all', disabled: false, label: 'Show All' });
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

describe('expanded-set bookkeeping', () => {
  const a = buildRowView(script({ content: 'a' }), 'a');
  const b = buildRowView(script({ content: 'b' }), 'b');

  it('keeps keys whose view survived unchanged, by identity', () => {
    const expanded = new Set(['a', 'b']);
    expect(pruneExpanded(expanded, [a, b], [b, a])).toBe(expanded);
    expect(pruneExpanded(new Set<string>(), [a], [])).toEqual(new Set());
  });

  it('drops keys whose script is gone or changed under the same key', () => {
    const changed = buildRowView(script({ content: 'b2' }), 'b');
    expect([...pruneExpanded(new Set(['a', 'b']), [a, b], [a])]).toEqual(['a']);
    expect([...pruneExpanded(new Set(['a', 'b']), [a, b], [a, changed])]).toEqual(['a']);
  });

  it('toggles membership into a fresh set', () => {
    const empty = new Set<string>();
    const one = toggleExpanded(empty, 'k');
    expect(one).not.toBe(empty);
    expect([...one]).toEqual(['k']);
    expect([...toggleExpanded(one, 'k')]).toEqual([]);
  });
});

describe('phrases', () => {
  it('formats counts with thousands separators', () => {
    expect(formatCount(5000)).toBe('5,000');
    expect(scriptCount(0)).toBe('0 scripts');
    expect(scriptCount(1)).toBe('1 script');
    expect(scriptCount(1204)).toBe('1,204 scripts');
    expect(lineCount(1)).toBe('1 line');
    expect(lineCount(1040)).toBe('1,040 lines');
  });

  it('floors a cut total', () => {
    expect(scriptCount(5000, true)).toBe('5,000+ scripts');
  });

  it('announces only while the list is narrowed', () => {
    expect(resultAnnouncement(3, 10, false)).toBe('');
    expect(resultAnnouncement(3, 10, true)).toBe('3 of 10 scripts shown');
    expect(resultAnnouncement(0, 1, true)).toBe('0 of 1 script shown');
    expect(resultAnnouncement(1200, 5000, true)).toBe('1,200 of 5,000 scripts shown');
  });
});
