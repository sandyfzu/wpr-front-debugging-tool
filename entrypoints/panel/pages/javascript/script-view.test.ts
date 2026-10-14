/**
 * The JavaScript page's pure view layer: state badges, the inline-code shape
 * (line counting, expandability thresholds, the bounded preview), row-view
 * reconciliation, chips, estimates and the expanded-set bookkeeping.
 */
import { describe, expect, it } from 'vitest';
import type { JsScriptResource } from '../../../../lib/panel/resources-view-model';
import { JS_PAGE_RESOURCES } from '../../../../lib/panel/resources-view-model';
import {
  COLLAPSED_CODE_LINES,
  JS_VIEW_RESOURCES,
  PREVIEW_LINE_CHARS,
  ROW_ESTIMATES,
  WRAP_RISK_LINE_CHARS,
  buildChips,
  buildRowView,
  codeToggleLabel,
  collapsedPreview,
  estimateRowSize,
  inlineCode,
  isExpandable,
  lineCount,
  measureCode,
  pruneExpanded,
  reconcileRowViews,
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

  it('never renders the retired "FDT legacy" wording', () => {
    const all = [
      script({ fdtExcluded: 'delay_js,defer_all_js' }),
      script({ type: 'inline', fdtExcluded: 'delay_js' })
    ].flatMap(scriptStateBadges);
    expect(all.some((badge) => badge.label.includes('legacy'))).toBe(false);
  });
});

describe('measureCode', () => {
  it.each([
    ['', 0, 0],
    ['a', 1, 1],
    ['abc\nde', 2, 3],
    ['a\nb\n', 2, 1],
    ['a\n\n', 2, 1],
    ['\n', 1, 0],
    ['a\r\nbc', 2, 2],
    ['x'.repeat(90), 1, 90]
  ])('%j → %i lines, longest %i', (text, lines, longestLine) => {
    expect(measureCode(text)).toEqual({ lines, longestLine });
  });

  it('counts a large script without building a line array', () => {
    const text = Array.from({ length: 10_000 }, () => 'x = 1;').join('\n');
    expect(measureCode(text)).toEqual({ lines: 10_000, longestLine: 6 });
  });
});

describe('isExpandable', () => {
  it('is true past the collapsed line count', () => {
    expect(isExpandable(COLLAPSED_CODE_LINES, 10)).toBe(false);
    expect(isExpandable(COLLAPSED_CODE_LINES + 1, 10)).toBe(true);
  });

  it('is true for a line that may fold under wrapping', () => {
    expect(isExpandable(1, WRAP_RISK_LINE_CHARS)).toBe(false);
    expect(isExpandable(1, WRAP_RISK_LINE_CHARS + 1)).toBe(true);
  });
});

describe('collapsedPreview', () => {
  it('returns the text itself when nothing is cut', () => {
    for (const text of ['', 'a', 'a\nb\nc', 'a\nb\nc\n']) {
      expect(collapsedPreview(text)).toBe(text);
    }
  });

  it('keeps only the first three lines', () => {
    expect(collapsedPreview('a\nb\nc\nd\ne')).toBe('a\nb\nc');
  });

  it('caps each kept line', () => {
    const long = 'y'.repeat(PREVIEW_LINE_CHARS + 50);
    expect(collapsedPreview(long)).toBe('y'.repeat(PREVIEW_LINE_CHARS));
    expect(collapsedPreview(`a\n${long}\nc`)).toBe(`a\n${'y'.repeat(PREVIEW_LINE_CHARS)}\nc`);
  });
});

describe('inlineCode', () => {
  it('derives lines, expandability and preview', () => {
    expect(inlineCode('a\nb\nc\nd')).toEqual({
      lines: 4,
      expandable: true,
      preview: 'a\nb\nc',
      blank: false
    });
    expect(inlineCode('short')).toEqual({
      lines: 1,
      expandable: false,
      preview: 'short',
      blank: false
    });
  });

  it('marks empty and whitespace-only sources blank and never expandable', () => {
    expect(inlineCode('')).toMatchObject({ blank: true, expandable: false });
    expect(inlineCode('  \n\n\n\n  ')).toMatchObject({ blank: true, expandable: false });
  });
});

describe('codeToggleLabel', () => {
  it('names how much the click reveals, or collapses', () => {
    expect(codeToggleLabel(inlineCode('a\nb\nc\nd'), false)).toBe('Show all 4 lines');
    expect(codeToggleLabel(inlineCode('z'.repeat(100)), false)).toBe('Expand');
    expect(codeToggleLabel(inlineCode('a\nb\nc\nd'), true)).toBe('Collapse');
  });
});

describe('buildRowView', () => {
  it('derives code for inline rows only', () => {
    expect(buildRowView(script()).code).toBeNull();
    expect(buildRowView(script({ type: 'inline', content: 'x' })).code?.lines).toBe(1);
  });
});

describe('sameScript', () => {
  it('compares every field', () => {
    const base = script();
    expect(sameScript(base, { ...base })).toBe(true);
    for (const change of [
      { id: 1 },
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

describe('reconcileRowViews', () => {
  const rows = [script({ id: 0 }), script({ id: 1, type: 'inline', content: 'a' })];

  it('builds every view on the first pass', () => {
    const views = reconcileRowViews([], rows);
    expect(views.map((view) => view.row)).toEqual(rows);
  });

  it('returns the previous array when nothing changed (a no-op refresh)', () => {
    const first = reconcileRowViews([], rows);
    expect(
      reconcileRowViews(
        first,
        rows.map((row) => ({ ...row }))
      )
    ).toBe(first);
  });

  it('reuses unchanged views and rebuilds changed ones', () => {
    const first = reconcileRowViews([], rows);
    const next = reconcileRowViews(first, [rows[0] as JsScriptResource, script({ id: 1 })]);
    expect(next).not.toBe(first);
    expect(next[0]).toBe(first[0]);
    expect(next[1]).not.toBe(first[1]);
    expect(next[1]?.code).toBeNull();
  });

  it('reports a change when rows were removed or reordered', () => {
    const first = reconcileRowViews([], rows);
    const shorter = reconcileRowViews(first, [rows[0] as JsScriptResource]);
    expect(shorter).toHaveLength(1);
    expect(shorter[0]).toBe(first[0]);
    const reordered = reconcileRowViews(first, [...rows].reverse());
    expect(reordered).not.toBe(first);
    expect(reordered[0]).toBe(first[1]);
  });
});

describe('JS_VIEW_RESOURCES', () => {
  it('lifts the shared chip table through the row (ids and labels unchanged)', () => {
    expect(JS_VIEW_RESOURCES.filters.map((filter) => [filter.id, filter.label])).toEqual(
      JS_PAGE_RESOURCES.filters.map((filter) => [filter.id, filter.label])
    );
    const view = buildRowView(script({ delayed: true }));
    const delayed = JS_VIEW_RESOURCES.filters.find((filter) => filter.id === 'delayed');
    expect(delayed?.predicate(view)).toBe(true);
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

  it('keeps "all" enabled on an empty page', () => {
    const empty = Object.fromEntries(Object.keys(counts).map((key) => [key, 0])) as typeof counts;
    const all = buildChips(JS_PAGE_RESOURCES.filters, empty, 'all')[0];
    expect(all).toMatchObject({ value: 'all', disabled: false, label: 'Show All' });
  });
});

describe('estimateRowSize', () => {
  it('seeds per row shape', () => {
    expect(estimateRowSize(buildRowView(script()))).toBe(ROW_ESTIMATES.external);
    const inline = (content: string): number =>
      estimateRowSize(buildRowView(script({ type: 'inline', content })));
    expect(inline('')).toBe(ROW_ESTIMATES.inlineBlank);
    expect(inline('a')).toBe(ROW_ESTIMATES.inlineShort);
    expect(inline('a\nb\nc\nd')).toBe(ROW_ESTIMATES.inlineCollapsed);
  });
});

describe('expanded-set bookkeeping', () => {
  it('prunes ids no longer present, keeping identity when nothing is stale', () => {
    const expanded = new Set([1, 2]);
    expect(pruneExpanded(expanded, new Set([1, 2, 3]))).toBe(expanded);
    expect([...pruneExpanded(expanded, new Set([2]))]).toEqual([2]);
    expect(pruneExpanded(new Set<number>(), new Set<number>()).size).toBe(0);
  });

  it('toggles membership into a fresh set', () => {
    const empty = new Set<number>();
    const one = toggleExpanded(empty, 4);
    expect(one).not.toBe(empty);
    expect([...one]).toEqual([4]);
    expect([...toggleExpanded(one, 4)]).toEqual([]);
  });
});

describe('phrases', () => {
  it('pluralizes counts', () => {
    expect(scriptCount(0)).toBe('0 scripts');
    expect(scriptCount(1)).toBe('1 script');
    expect(lineCount(1)).toBe('1 line');
    expect(lineCount(12)).toBe('12 lines');
  });

  it('announces only while the list is narrowed', () => {
    expect(resultAnnouncement(3, 10, false)).toBe('');
    expect(resultAnnouncement(3, 10, true)).toBe('3 of 10 scripts shown');
    expect(resultAnnouncement(0, 1, true)).toBe('0 of 1 script shown');
  });
});
