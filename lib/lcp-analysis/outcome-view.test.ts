/**
 * The LCP analysis's words: every outcome (each miss, unsupported, no LCP,
 * no navigation by candidate count, a breakdown by candidate count), the
 * part names, resource/highlight/prerender notes, element names and the
 * candidate rows (activation-aligned times, text, gone elements, LCP last).
 */
import { describe, expect, it } from 'vitest';
import type { LcpCandidateFacts } from '../messaging/lcp-analysis';
import { LCP_PARTS, type LcpBreakdown } from './breakdown';
import {
  candidateRows,
  describeElement,
  describeLcpOutcome,
  formatMs,
  formatPercent,
  LCP_HIGHLIGHT_NOTES,
  LCP_PART_HINTS,
  LCP_PART_LABELS,
  LCP_RESOURCE_NOTES,
  prerenderNote
} from './outcome-view';
import type { LcpAnalysisOutcome } from './run-analysis';

const IMAGE: LcpCandidateFacts = {
  startTime: 1500.4,
  renderTime: 1500.4,
  loadTime: 1200,
  size: 123_456.7,
  url: 'https://a.test/hero.jpg',
  element: { tag: 'img', id: 'hero', classes: ['wide', 'lazy'] }
};
const TEXT: LcpCandidateFacts = { ...IMAGE, startTime: 400, url: '', element: null, size: 900 };

const BREAKDOWN: LcpBreakdown = {
  kind: 'breakdown',
  total: 1500,
  resource: 'found',
  parts: LCP_PARTS.map((key) => ({ key, duration: 375, percent: 25 }))
};

/** An analysed outcome. */
function analysed(
  overrides: Partial<Extract<LcpAnalysisOutcome, { kind: 'analysed' }>> = {}
): LcpAnalysisOutcome {
  return {
    kind: 'analysed',
    breakdown: BREAKDOWN,
    candidates: [TEXT, IMAGE],
    activationStart: 0,
    highlight: 'off',
    ...overrides
  };
}

describe('describeLcpOutcome', () => {
  it('gives every miss its own title and recoveries, reload first unless it timed out', () => {
    const views = (['no-receiver', 'timeout', 'invalid-reply', 'failed'] as const).map((miss) =>
      describeLcpOutcome({ kind: 'page-unreachable', miss })
    );
    expect(views.map((view) => view.tone)).toEqual(['error', 'error', 'error', 'error']);
    expect(new Set(views.map((view) => view.title)).size).toBe(4);
    expect(views.map((view) => view.recoveries)).toEqual([
      ['reload-page', 'retry'],
      ['retry', 'reload-page'],
      ['reload-page', 'retry'],
      ['reload-page', 'retry']
    ]);
    expect(views[1]?.message).toContain('within 5 s');
    expect(views[0]?.message).toContain('Nothing was measured.');
  });

  it('says LCP is unsupported, with nothing to do', () => {
    expect(describeLcpOutcome({ kind: 'unsupported' })).toEqual({
      tone: 'neutral',
      title: 'LCP not supported',
      message: expect.stringContaining("doesn't report Largest Contentful Paint") as string,
      recoveries: []
    });
  });

  it('asks to wait for a first paint when there is no LCP yet', () => {
    const view = describeLcpOutcome(analysed({ breakdown: { kind: 'no-lcp' }, candidates: [] }));
    expect(view).toMatchObject({ tone: 'warn', title: 'No LCP yet', recoveries: ['retry'] });
  });

  it('points at the candidates when there is no navigation timing', () => {
    const gap = { kind: 'no-navigation' } as const;
    const message = (candidates: LcpCandidateFacts[]) =>
      describeLcpOutcome(analysed({ breakdown: gap, candidates })).message;
    expect(describeLcpOutcome(analysed({ breakdown: gap }))).toMatchObject({
      tone: 'warn',
      recoveries: ['reload-page']
    });
    expect(message([])).toContain('No candidate was painted yet either.');
    expect(message([IMAGE])).toContain('Its one candidate is listed below.');
    expect(message([TEXT, IMAGE])).toContain('Its 2 candidates are listed below.');
  });

  it('titles a breakdown with its total and counts the candidates', () => {
    expect(describeLcpOutcome(analysed())).toEqual({
      tone: 'ok',
      title: 'LCP at 1,500 ms',
      message: '2 candidates were painted; the last one is the LCP.',
      recoveries: []
    });
    expect(describeLcpOutcome(analysed({ candidates: [IMAGE] })).message).toBe(
      'One candidate was painted: it is the LCP.'
    );
  });
});

describe('labels and notes', () => {
  it('names and explains every part', () => {
    for (const key of LCP_PARTS) {
      expect(LCP_PART_LABELS[key]).not.toBe('');
      expect(LCP_PART_HINTS[key]).not.toBe('');
    }
    expect(LCP_PART_LABELS.resourceLoadDuration).toBe('Resource load time');
  });

  it('notes only text and missing resources, and only shown or failed highlights', () => {
    expect(LCP_RESOURCE_NOTES.found).toBeNull();
    expect(LCP_RESOURCE_NOTES.text).toContain('text');
    expect(LCP_RESOURCE_NOTES.missing).toContain('render delay');
    expect(LCP_HIGHLIGHT_NOTES.off).toBeNull();
    expect(LCP_HIGHLIGHT_NOTES.shown).toContain('for 5 s');
    expect(LCP_HIGHLIGHT_NOTES.unavailable).toContain('no longer on the page');
  });

  it('notes a prerendered page only', () => {
    expect(prerenderNote(0)).toBeNull();
    expect(prerenderNote(812.6)).toBe(
      'Prerendered page: times count from when it was shown, 813 ms after its navigation started.'
    );
  });
});

describe('formatting', () => {
  it('shows whole grouped milliseconds and one-decimal shares', () => {
    expect(formatMs(1234.5)).toBe('1,235 ms');
    expect(formatMs(0)).toBe('0 ms');
    expect(formatPercent(33.3)).toBe('33.3%');
    expect(formatPercent(null)).toBe('—');
  });

  it('names an element as tag, #id, then .class each', () => {
    expect(describeElement({ tag: 'img', id: 'hero', classes: ['a', 'b'] })).toBe('img#hero.a.b');
    expect(describeElement({ tag: 'h1', id: '', classes: [] })).toBe('h1');
  });
});

describe('candidateRows', () => {
  it('lists the candidates in order, the last as the LCP, times from activation', () => {
    expect(candidateRows([TEXT, IMAGE], 300)).toEqual([
      {
        id: 1,
        time: '100 ms',
        element: null,
        url: null,
        size: '900 px²',
        isLcp: false
      },
      {
        id: 2,
        time: '1,200 ms',
        element: 'img#hero.wide.lazy',
        url: 'https://a.test/hero.jpg',
        size: '123,457 px²',
        isLcp: true
      }
    ]);
  });

  it('floors a candidate painted before activation at 0 and lists nothing for none', () => {
    expect(candidateRows([TEXT], 1000)[0]?.time).toBe('0 ms');
    expect(candidateRows([], 0)).toEqual([]);
  });
});
