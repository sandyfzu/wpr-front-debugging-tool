import { describe, expect, it } from 'vitest';
import { evaluateSimulationCsp } from './csp-evaluation';

describe('evaluateSimulationCsp (inert until the evaluator lands)', () => {
  it('allows every policy, limiting nothing', () => {
    expect(evaluateSimulationCsp(undefined, '<p>x</p>')).toEqual({ blocked: false, limits: [] });
    const strict = {
      browser: 'chromium' as const,
      headers: [{ name: 'Content-Security-Policy', value: "script-src 'none'" }],
      metas: []
    };
    expect(evaluateSimulationCsp(strict, '<p>x</p>')).toEqual({ blocked: false, limits: [] });
  });
});
