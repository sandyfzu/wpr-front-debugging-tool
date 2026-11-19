/**
 * The threshold meter: band and position per value (each band a third, the
 * thresholds themselves on the good side, the poor band capped), missing and
 * NaN values without a meter, bad thresholds refused, outcomes, legends.
 */
import { describe, expect, it } from 'vitest';
import { rate, VITAL_THRESHOLDS } from './current-visit';
import {
  meterLegend,
  METER_BAND_SPAN,
  METER_BANDS,
  outcomeMeter,
  POOR_BAND_END,
  vitalMeter
} from './vital-meter';
import { VITAL_KEYS } from './vitals-view';

const LCP = VITAL_THRESHOLDS.lcp;

describe('vitalMeter', () => {
  it('splits the bar into three equal bands, good to poor', () => {
    expect(METER_BANDS).toEqual(['good', 'needs-improvement', 'poor']);
    expect(METER_BAND_SPAN).toBeCloseTo(1 / 3, 12);
    expect(POOR_BAND_END).toBe(2);
  });

  it.each<[number, string, number]>([
    [0, 'good', 0],
    [1250, 'good', 1 / 6],
    // A threshold is on its good side (the published `>` rule) and ends that band.
    [2500, 'good', 1 / 3],
    [2500.001, 'needs-improvement', 1 / 3],
    [3250, 'needs-improvement', 1 / 2],
    [4000, 'needs-improvement', 2 / 3],
    [4000.001, 'poor', 2 / 3],
    [6000, 'poor', 5 / 6],
    [8000, 'poor', 1],
    // Past the poor band's end, and the extremes: pinned to the ends.
    [12_000, 'poor', 1],
    [Number.POSITIVE_INFINITY, 'poor', 1],
    [-5, 'good', 0],
    [Number.NEGATIVE_INFINITY, 'good', 0]
  ])('places LCP %d ms in %s at %d', (value, band, position) => {
    const meter = vitalMeter(value, LCP);
    expect(meter?.band).toBe(band);
    expect(meter?.position).toBeCloseTo(position, 6);
  });

  it('places CLS and INP by their own thresholds', () => {
    expect(vitalMeter(0.05, VITAL_THRESHOLDS.cls)).toEqual({ band: 'good', position: 1 / 6 });
    expect(vitalMeter(0.25, VITAL_THRESHOLDS.cls)?.position).toBeCloseTo(2 / 3, 12);
    expect(vitalMeter(0.5, VITAL_THRESHOLDS.cls)).toEqual({ band: 'poor', position: 1 });
    expect(vitalMeter(350, VITAL_THRESHOLDS.inp)).toEqual({
      band: 'needs-improvement',
      position: 0.5
    });
  });

  it('agrees with the rating at every value, keeping the bands in order', () => {
    let previous = -1;
    for (let value = 0; value <= 9000; value += 125) {
      const meter = vitalMeter(value, LCP);
      expect(meter?.band).toBe(rate(value, LCP));
      const position = meter?.position ?? Number.NaN;
      expect(position).toBeGreaterThanOrEqual(previous);
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThanOrEqual(1);
      previous = position;
    }
  });

  it('gives no meter without a value (not measured, pending) or for NaN', () => {
    expect(vitalMeter(null, LCP)).toBeNull();
    expect(vitalMeter(undefined, LCP)).toBeNull();
    expect(vitalMeter(Number.NaN, LCP)).toBeNull();
  });

  it.each<[number, number]>([
    [0, 4000],
    [-1, 4000],
    [2500, 2500],
    [4000, 2500],
    [Number.NaN, 4000],
    [2500, Number.NaN],
    [2500, Number.POSITIVE_INFINITY]
  ])('refuses thresholds [%d, %d], naming them, even without a value', (good, poor) => {
    expect(() => vitalMeter(1, [good, poor])).toThrow(RangeError);
    expect(() => vitalMeter(null, [good, poor])).toThrow(`got [${String(good)}, ${String(poor)}]`);
  });
});

describe('outcomeMeter', () => {
  it('places a measured value by its metric', () => {
    expect(outcomeMeter('inp', { state: 'measured', value: 100, rating: 'good' })).toEqual({
      band: 'good',
      position: 1 / 6
    });
    expect(outcomeMeter('cls', { state: 'measured', value: 0.3, rating: 'poor' })?.band).toBe(
      'poor'
    );
  });

  it('has none for an unsupported metric or one without data', () => {
    for (const key of VITAL_KEYS) {
      expect(outcomeMeter(key, { state: 'unsupported' })).toBeNull();
      expect(outcomeMeter(key, { state: 'no-data' })).toBeNull();
    }
  });
});

describe('meterLegend', () => {
  it('names each metric’s thresholds in its own units', () => {
    expect(meterLegend('lcp')).toBe('Good ≤ 2,500 ms · Poor > 4,000 ms');
    expect(meterLegend('cls')).toBe('Good ≤ 0.100 · Poor > 0.250');
    expect(meterLegend('inp')).toBe('Good ≤ 200 ms · Poor > 500 ms');
  });
});
