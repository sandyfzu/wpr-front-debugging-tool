/**
 * The current-visit vitals' words: value formats per metric, each state per
 * metric (measured with rating + INP's interaction count, unsupported, no
 * data — restored LCP said apart), the visit notes (restored, capped) and
 * every missed read.
 */
import { describe, expect, it } from 'vitest';
import { rate, VITAL_THRESHOLDS, type CurrentVisitVitals, type VitalRating } from './current-visit';
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
  vitalRows,
  type VitalKey
} from './vitals-view';

const MEASURED: CurrentVisitVitals = {
  lcp: { state: 'measured', value: 2345.6, rating: 'good' },
  cls: { state: 'measured', value: 0.137, rating: 'needs-improvement' },
  inp: { state: 'measured', value: 640, rating: 'poor', interactions: 12 }
};

describe('formatVital', () => {
  it('shows LCP and INP in whole milliseconds, CLS to three decimals', () => {
    expect(formatVital('lcp', 2345.6)).toBe('2,346 ms');
    expect(formatVital('lcp', 2345.4)).toBe('2,345 ms');
    expect(formatVital('inp', 48)).toBe('48 ms');
    expect(formatVital('cls', 0.137)).toBe('0.137');
    expect(formatVital('cls', 0.1374)).toBe('0.137');
    expect(formatVital('cls', 0)).toBe('0.000');
  });

  it('never shows a real shift as 0.000', () => {
    expect(formatVital('cls', 0.0004)).toBe('< 0.001');
    expect(formatVital('cls', 0.0005)).toBe('0.001');
  });

  it.each<[VitalKey, number, string, VitalRating]>([
    // Just above a threshold: never rounded onto its good side.
    ['cls', 0.1004, '0.101', 'needs-improvement'],
    ['lcp', 2500.4, '2,501 ms', 'needs-improvement'],
    ['inp', 200.4, '201 ms', 'needs-improvement'],
    ['lcp', 4000.2, '4,001 ms', 'poor'],
    ['cls', 0.2500001, '0.251', 'poor'],
    // On or just below: rounds as usual (the threshold itself is good).
    ['cls', 0.1, '0.100', 'good'],
    ['cls', 0.0996, '0.100', 'good'],
    ['lcp', 2500, '2,500 ms', 'good'],
    ['lcp', 2499.6, '2,500 ms', 'good'],
    ['inp', 200, '200 ms', 'good']
  ])('shows %s %d as %s beside its %s rating', (key, value, shown, rating) => {
    expect(formatVital(key, value)).toBe(shown);
    expect(rate(value, VITAL_THRESHOLDS[key])).toBe(rating);
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
        value: '0.137',
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
