/**
 * The simulation vocabulary: the registry's ids are exclusion-builder
 * feature ids, and every closed list is pinned (UI copy and the session
 * contracts map over them — a change here is a contract change).
 */
import { describe, expect, it } from 'vitest';
import { EXCLUSION_FEATURES } from '../exclusion-builder/set';
import {
  LATEST_LIST_MISSES,
  SIMULATED_FEATURES,
  SIMULATION_CAVEATS,
  SIMULATION_CSP_BROWSERS,
  SIMULATION_CSP_LIMITS,
  SIMULATION_CSP_UNAVAILABLE_REASONS,
  SIMULATION_LIST_LIMITS,
  SIMULATION_LIST_SOURCES,
  SIMULATION_MARKER_ID_PATTERN,
  SIMULATION_NOT_APPLICABLE_REASONS,
  SIMULATION_RUNTIME_UNAVAILABLE_CAUSES,
  SIMULATION_STATES,
  UNREPRODUCED_REGEXES
} from './spec';

describe('simulation vocabulary', () => {
  it('registers Delay JS only, by its exclusion-builder id', () => {
    expect(SIMULATED_FEATURES.map((feature) => feature.id)).toEqual(['delay_js']);
    for (const feature of SIMULATED_FEATURES) {
      expect(EXCLUSION_FEATURES.some((spec) => spec.id === feature.id)).toBe(true);
    }
  });

  it('pins every closed list', () => {
    expect(SIMULATION_STATES).toEqual([
      'simulated',
      'already-served',
      'csp-blocked',
      'not-applicable'
    ]);
    expect(SIMULATION_NOT_APPLICABLE_REASONS).toEqual([
      'amp',
      'beyond-exact-reproduction',
      'unsupported-charset'
    ]);
    expect(UNREPRODUCED_REGEXES).toEqual([
      'ie-conditionals',
      'ie-conditional-script',
      'xmp-mask',
      'svg-mask',
      'meta-charset'
    ]);
    expect(SIMULATION_CAVEATS).toEqual(['combined-js']);
    expect(SIMULATION_CSP_LIMITS).toEqual([
      'eval',
      'data',
      'inline',
      'inline-after-fallback',
      'trusted-types'
    ]);
    expect(SIMULATION_CSP_BROWSERS).toEqual(['chromium', 'firefox']);
    expect(SIMULATION_CSP_UNAVAILABLE_REASONS).toEqual(['oversized', 'unreadable']);
    expect(SIMULATION_LIST_SOURCES).toEqual(['latest', 'bundled']);
    expect(LATEST_LIST_MISSES).toEqual([
      'never-fetched',
      'network-error',
      'timeout',
      'http-error',
      'oversize',
      'malformed',
      'invalid'
    ]);
    expect(SIMULATION_RUNTIME_UNAVAILABLE_CAUSES).toEqual([
      'asset-unreachable',
      'asset-malformed',
      'hash-mismatch',
      'version-missing'
    ]);
    expect(SIMULATION_LIST_LIMITS).toEqual({ rows: 2_000, rowChars: 1_000 });
  });

  it('matches marker ids of exactly 32 lowercase hex digits', () => {
    expect(SIMULATION_MARKER_ID_PATTERN.test('0'.repeat(32))).toBe(true);
    expect(SIMULATION_MARKER_ID_PATTERN.test('f'.repeat(31))).toBe(false);
    expect(SIMULATION_MARKER_ID_PATTERN.test('F'.repeat(32))).toBe(false);
    expect(SIMULATION_MARKER_ID_PATTERN.test(`${'0'.repeat(32)}\n`)).toBe(false);
  });
});
