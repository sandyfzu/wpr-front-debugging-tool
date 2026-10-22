import { describe, expect, it, vi } from 'vitest';
import type {
  ActiveExclusionSession,
  ExclusionDocumentOutcome
} from '../../../lib/messaging/exclusion-session';
import { activeRecord } from '../../../lib/messaging/exclusion-session.fixtures';
import type { TransformReport } from '../../../lib/exclusion-builder/report';
import { appliedWarnings, sessionView } from './session-view';

/** The fixture session with another document outcome. */
function withDocument(document: ExclusionDocumentOutcome | null): ActiveExclusionSession {
  return { ...activeRecord(), document };
}

const REPORT: TransformReport = {
  feature: 'delay_js',
  featureWide: false,
  candidates: 5,
  rewritten: 2,
  regionRemovals: 0,
  matchedRows: [{ row: 'gtag', rowKind: 'pattern', matches: 2 }],
  unmatchedRows: ['jquery\\.min\\.js', 'nothing']
};

describe('sessionView', () => {
  it('is off without a session and never consults the page', () => {
    const match = vi.fn();
    expect(sessionView({ state: 'inactive' }, match)).toEqual({ kind: 'off' });
    expect(match).not.toHaveBeenCalled();
  });

  it('carries the cause and its retryability for the warning', () => {
    expect(
      sessionView({ state: 'unavailable', cause: 'infobar-cancelled', at: 1 }, vi.fn())
    ).toEqual({ kind: 'unavailable', cause: 'infobar-cancelled', retryable: true });
    expect(
      sessionView({ state: 'unavailable', cause: 'debugging-policy', at: 1 }, vi.fn())
    ).toEqual({ kind: 'unavailable', cause: 'debugging-policy', retryable: false });
  });

  it('is armed before any document lands', () => {
    expect(sessionView(withDocument(null), vi.fn())).toEqual({ kind: 'armed' });
  });

  it('reports a rewritten page with its no-match count', () => {
    const view = sessionView(
      withDocument({ outcome: 'rewritten', reports: [REPORT] }),
      () => 'this-page'
    );
    expect(view).toEqual({
      kind: 'applied',
      reports: [REPORT],
      unmatched: 2,
      warnings: [],
      served: undefined
    });
  });

  it('says not intercepted when the record is another page', () => {
    expect(
      sessionView(withDocument({ outcome: 'rewritten', reports: [] }), () => 'other-page')
    ).toEqual({ kind: 'not-intercepted' });
  });

  it("says can't tell when the page cannot be verified", () => {
    expect(
      sessionView(withDocument({ outcome: 'failed', reason: 'not-served' }), () => 'cant-tell')
    ).toEqual({ kind: 'cant-tell' });
  });

  it('names an over-budget page with its feature, row and budget', () => {
    const view = sessionView(
      withDocument({ outcome: 'over-budget', feature: 'delay_js', row: '.*x', budgetMs: 2000 }),
      () => 'this-page'
    );
    expect(view).toEqual({
      kind: 'unmodified',
      reason: { kind: 'over-budget', feature: 'delay_js', row: '.*x', budgetMs: 2000 },
      served: undefined
    });
  });

  it('names an unmodified page with its failure', () => {
    expect(
      sessionView(withDocument({ outcome: 'failed', reason: 'decode-failed' }), () => 'this-page')
    ).toEqual({
      kind: 'unmodified',
      reason: { kind: 'failed', reason: 'decode-failed' },
      served: undefined
    });
  });
});

describe('appliedWarnings', () => {
  /** The fixture set (Delay rows `jquery\\.min\\.js`, `gtag`; Defer `/wp-includes/js/`). */
  const SET = activeRecord().set;
  const base = { featureWide: false, candidates: 3, rewritten: 3, regionRemovals: 0 } as const;

  it('names page-off and match-all rows by their position in the applied set', () => {
    const reports: TransformReport[] = [
      { ...base, feature: 'delay_js', matchedRows: [], unmatchedRows: [], matchAllRows: ['gtag'] },
      {
        ...base,
        feature: 'defer_all_js',
        matchedRows: [],
        unmatchedRows: [],
        pageState: 'off',
        pageOffRows: ['/wp-includes/js/']
      }
    ];
    expect(appliedWarnings(reports, SET)).toEqual([
      { lane: 'delayJs', kind: 'match-all', positions: [2] },
      { lane: 'deferJs', kind: 'page-off', positions: [1] }
    ]);
  });

  it('keeps a page-off whose rows the report did not name, and nothing for a clean report', () => {
    const off: TransformReport = {
      ...base,
      feature: 'defer_all_js',
      matchedRows: [],
      unmatchedRows: [],
      pageState: 'off'
    };
    expect(appliedWarnings([off, REPORT], SET)).toEqual([
      { lane: 'deferJs', kind: 'page-off', positions: [] }
    ]);
  });

  it('reaches the applied view', () => {
    const reports: TransformReport[] = [{ ...REPORT, matchAllRows: ['gtag'] }];
    const view = sessionView(withDocument({ outcome: 'rewritten', reports }), () => 'this-page');
    expect(view).toMatchObject({
      warnings: [{ lane: 'delayJs', kind: 'match-all', positions: [2] }]
    });
  });
});
