import { describe, expect, it } from 'vitest';
import { createMonotonicStamp } from './monotonic-stamp';

describe('createMonotonicStamp', () => {
  it('follows the clock in whole ms', () => {
    const readings = [1000.4, 1005.9];
    const stamp = createMonotonicStamp(() => readings.shift() ?? 0);
    expect([stamp(), stamp()]).toEqual([1000, 1005]);
  });

  it('stays strictly increasing when the clock repeats or steps back', () => {
    const readings = [1000, 1000, 990, 1001.2];
    const stamp = createMonotonicStamp(() => readings.shift() ?? 0);
    expect([stamp(), stamp(), stamp(), stamp()]).toEqual([1000, 1001, 1002, 1003]);
  });

  it('defaults to the platform clock (near the wall clock, never backward)', () => {
    const stamp = createMonotonicStamp();
    const first = stamp();
    expect(Math.abs(first - Date.now())).toBeLessThan(60_000);
    expect(stamp()).toBeGreaterThan(first);
  });
});
