/**
 * The current-visit vitals' words: value formats per metric, each state per
 * metric (measured with rating + INP's interaction count, unsupported, no
 * data — restored LCP said apart), the visit notes (restored, capped) and
 * every missed read.
 */
import { describe, expect, it } from 'vitest';
import type { CurrentVisitVitals } from './current-visit';
import {
  CAPPED_NOTE,
  describeVitalsMiss,
  formatVital,
  NO_DATA_NOTES,
  RESTORED_LCP_NOTE,
  RESTORED_NOTE,
  UNSUPPORTED_NOTES,
  VITAL_KEYS,
  visitNotes,
  vitalRow,
  vitalRows
} from './vitals-view';

const MEASURED: CurrentVisitVitals = {
  lcp: { state: 'measured', value: 2345.6, rating: 'good' },
  cls: { state: 'measured', value: 0.137, rating: 'needs-improvement' },
  inp: { state: 'measured', value: 640, rating: 'poor', interactions: 12 }
};

describe('formatVital', () => {
  it('shows LCP and INP in whole milliseconds, CLS to two decimals', () => {
    expect(formatVital('lcp', 2345.6)).toBe('2,346 ms');
    expect(formatVital('inp', 48)).toBe('48 ms');
    expect(formatVital('cls', 0.137)).toBe('0.14');
    expect(formatVital('cls', 0)).toBe('0.00');
  });

  it('never shows a real shift as 0.00', () => {
    expect(formatVital('cls', 0.004)).toBe('< 0.01');
    expect(formatVital('cls', 0.005)).toBe('0.01');
  });
});

describe('vitalRow / vitalRows', () => {
  it('rates measured metrics, counting INP interactions', () => {
    expect(vitalRows(MEASURED)).toEqual([
      {
        key: 'lcp',
        short: 'LCP',
        full: 'Largest Contentful Paint',
        state: 'measured',
        value: '2,346 ms',
        rating: 'good',
        note: null
      },
      {
        key: 'cls',
        short: 'CLS',
        full: 'Cumulative Layout Shift',
        state: 'measured',
        value: '0.14',
        rating: 'needs-improvement',
        note: null
      },
      {
        key: 'inp',
        short: 'INP',
        full: 'Interaction to Next Paint',
        state: 'measured',
        value: '640 ms',
        rating: 'poor',
        note: 'From 12 interactions.'
      }
    ]);
    expect(vitalRow('inp', MEASURED.inp, false, 1)).toMatchObject({ note: 'From 1 interaction.' });
    expect(vitalRow('inp', MEASURED.inp, false)).toMatchObject({ note: null });
  });

  it('says per metric what the browser does not report', () => {
    for (const key of VITAL_KEYS) {
      expect(vitalRow(key, { state: 'unsupported' }, false)).toMatchObject({
        state: 'unsupported',
        note: UNSUPPORTED_NOTES[key]
      });
    }
    expect(new Set(Object.values(UNSUPPORTED_NOTES)).size).toBe(3);
  });

  it('says per metric why there is no value, LCP after a restore apart', () => {
    for (const key of VITAL_KEYS) {
      expect(vitalRow(key, { state: 'no-data' }, false)).toMatchObject({
        state: 'no-data',
        note: NO_DATA_NOTES[key]
      });
    }
    expect(vitalRow('lcp', { state: 'no-data' }, true).note).toBe(RESTORED_LCP_NOTE);
    expect(vitalRow('inp', { state: 'no-data' }, true).note).toBe(NO_DATA_NOTES.inp);
  });

  it('reads the restore from the visit', () => {
    const rows = vitalRows({ ...MEASURED, lcp: { state: 'no-data' }, restored: true });
    expect(rows[0]?.note).toBe(RESTORED_LCP_NOTE);
  });
});

describe('visitNotes', () => {
  it('notes a restore, then a capped list, else nothing', () => {
    expect(visitNotes({ kind: 'read', vitals: MEASURED, capped: false })).toEqual([]);
    expect(
      visitNotes({ kind: 'read', vitals: { ...MEASURED, restored: true }, capped: true })
    ).toEqual([RESTORED_NOTE, CAPPED_NOTE]);
    expect(visitNotes({ kind: 'read', vitals: MEASURED, capped: true })).toEqual([CAPPED_NOTE]);
  });
});

describe('describeVitalsMiss', () => {
  it('gives every miss its own title and recoveries, reload first unless it timed out', () => {
    const views = (['no-receiver', 'timeout', 'invalid-reply', 'failed'] as const).map(
      describeVitalsMiss
    );
    expect(new Set(views.map((view) => view.title)).size).toBe(4);
    expect(views.map((view) => view.recoveries)).toEqual([
      ['reload-page', 'retry'],
      ['retry', 'reload-page'],
      ['reload-page', 'retry'],
      ['reload-page', 'retry']
    ]);
    expect(views[1]?.message).toContain('within 5 s');
  });
});
