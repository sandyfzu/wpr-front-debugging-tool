/**
 * The enable decision matrix: simulation exists exactly where the browser
 * can deliver it on a debugged site tab — Chromium availability, never the
 * analysis host, whatever the switch's own UI gate already decided.
 */
import { describe, expect, it } from 'vitest';
import { canSimulate } from './can-simulate';

describe('canSimulate', () => {
  it('is true exactly for a DNR-capable browser on a debugged site tab', () => {
    expect(canSimulate({ dnrAvailable: true, analysisHost: false })).toBe(true);
  });

  it('refuses the analysis host even when the browser can simulate', () => {
    expect(canSimulate({ dnrAvailable: true, analysisHost: true })).toBe(false);
  });

  it('refuses an unavailable browser (Firefox degrades to disabled, never half-working)', () => {
    expect(canSimulate({ dnrAvailable: false, analysisHost: false })).toBe(false);
    expect(canSimulate({ dnrAvailable: false, analysisHost: true })).toBe(false);
  });
});
