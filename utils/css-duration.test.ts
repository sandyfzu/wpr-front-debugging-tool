import { describe, expect, it } from 'vitest';
import { parseCssTimeMs, transitionEndMs } from './css-duration';

/** Computed timing as a style declaration reports it (empty = unset). */
function timing(duration: string, delay = '', property = '') {
  return { transitionProperty: property, transitionDuration: duration, transitionDelay: delay };
}

describe('parseCssTimeMs', () => {
  it('reads seconds and milliseconds, any case, signed', () => {
    expect(parseCssTimeMs('0.18s')).toBe(180);
    expect(parseCssTimeMs('280ms')).toBe(280);
    expect(parseCssTimeMs('1S')).toBe(1000);
    expect(parseCssTimeMs('.5s')).toBe(500);
    expect(parseCssTimeMs('-50ms')).toBe(-50);
    expect(parseCssTimeMs('+0.1s')).toBe(100);
  });

  it('reads the reduced-motion collapse (exponent form)', () => {
    expect(parseCssTimeMs('1e-05s')).toBeCloseTo(0.01);
    expect(parseCssTimeMs('0.01ms')).toBe(0.01);
  });

  it('is null for anything that is not a finite time', () => {
    for (const entry of ['', 'auto', '180', 'var(--motion-base)', '1e400s', '0.1 s']) {
      expect(parseCssTimeMs(entry)).toBeNull();
    }
  });
});

describe('transitionEndMs', () => {
  it('is the duration with no delay', () => {
    expect(transitionEndMs(timing('0.18s'))).toBe(180);
    expect(transitionEndMs(timing('0.18s', '0s', 'translate'))).toBe(180);
  });

  it('takes the longest entry of a list', () => {
    expect(transitionEndMs(timing('0.18s, 280ms'))).toBe(280);
    expect(transitionEndMs(timing('120ms,0.18s , 0s'))).toBe(180);
  });

  it('adds each entry’s delay to its own duration', () => {
    expect(transitionEndMs(timing('0.18s', '50ms'))).toBe(230);
    // 100+0 vs 50+200: the second entry ends last.
    expect(transitionEndMs(timing('100ms, 50ms', '0s, 200ms', 'opacity, translate'))).toBe(250);
  });

  it('repeats the shorter time list to the property count (CSS list pairing)', () => {
    // Three properties: durations 100,200,100; delays 300 each → 500.
    expect(transitionEndMs(timing('100ms, 200ms', '300ms', 'a, b, c'))).toBe(500);
    // One property truncates the lists: only 100+0 counts.
    expect(transitionEndMs(timing('100ms, 900ms', '0s, 900ms', 'opacity'))).toBe(100);
  });

  it('pairs by the longer time list when the property list is unknown', () => {
    expect(transitionEndMs(timing('100ms', '0s, 400ms'))).toBe(500);
  });

  it('shortens the end by a negative delay, never below 0', () => {
    expect(transitionEndMs(timing('200ms', '-50ms'))).toBe(150);
    expect(transitionEndMs(timing('200ms', '-1s'))).toBe(0);
  });

  it('reads the reduced-motion collapse as a near-zero wait', () => {
    expect(transitionEndMs(timing('1e-05s', '0s', 'translate'))).toBeCloseTo(0.01);
  });

  it('counts empty, unparseable and negative durations as 0', () => {
    expect(transitionEndMs(timing(''))).toBe(0);
    expect(transitionEndMs(timing('', '500ms'))).toBe(0);
    expect(transitionEndMs(timing('0s'))).toBe(0);
    expect(transitionEndMs(timing('auto'))).toBe(0);
    expect(transitionEndMs(timing('-0.2s'))).toBe(0);
    expect(transitionEndMs(timing('1e400s'))).toBe(0);
    expect(transitionEndMs(timing('nope, 0.1s'))).toBe(100);
    expect(transitionEndMs(timing('0.1s', 'nope'))).toBe(100);
  });
});
