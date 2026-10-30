/**
 * The simulation vocabulary: the registry's ids are exclusion-builder
 * feature ids, and every closed list is pinned (UI copy and the session
 * contracts map over them — a change here is a contract change).
 */
import { describe, expect, it } from 'vitest';
import { EXCLUSION_FEATURES } from '../exclusion-builder/set';
import {
  LATEST_LIST_MISSES,
  LAZYLOAD_ASSETS_URL_SOURCES,
  LAZYLOAD_FOOTER_PLACEMENTS,
  LAZYLOAD_HEAD_PLACEMENTS,
  LAZYLOAD_PAGE_INDEPENDENT_CAVEATS,
  LAZYLOAD_PLACEMENT_FALLBACKS,
  LAZYLOAD_RUNTIME_DELIVERIES,
  SIMULATED_FEATURES,
  SIMULATION_CAVEATS,
  SIMULATION_CSP_BROWSERS,
  SIMULATION_CSP_LIMITS,
  SIMULATION_CSP_UNAVAILABLE_REASONS,
  SIMULATION_LIST_LIMITS,
  SIMULATION_LIST_SOURCES,
  SIMULATION_MARKER_ID_PATTERN,
  SIMULATION_NOT_APPLICABLE_REASONS,
  SIMULATION_REPORT_VOCABULARY,
  SIMULATION_RUNTIME_UNAVAILABLE_CAUSES,
  SIMULATION_STATES,
  UNREPRODUCED_REGEXES
} from './spec';

describe('simulation vocabulary', () => {
  it("registers LazyLoad, Defer JS then Delay JS (WP Rocket's buffer order), by their exclusion-builder ids", () => {
    expect(SIMULATED_FEATURES.map((feature) => feature.id)).toEqual([
      'lazyload',
      'defer_all_js',
      'delay_js'
    ]);
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
      'preview',
      'search',
      'page-builder-editor',
      'no-head-end',
      'no-body-end',
      'body-end-before-head-end',
      'runtime-unavailable',
      'delay-js-served',
      'beyond-exact-reproduction',
      'unsupported-charset'
    ]);
    expect(UNREPRODUCED_REGEXES).toEqual([
      'ie-conditionals',
      'ie-conditional-script',
      'xmp-mask',
      'svg-mask',
      'meta-charset',
      'html-comments',
      'defer-script-src',
      'defer-inline-scripts',
      'defer-replacements',
      'defer-inline-exclusions',
      'defer-file-exclusions',
      'lazyload-hidden-blocks',
      'lazyload-pictures',
      'lazyload-images',
      'lazyload-picture-image',
      'lazyload-picture-pattern-size',
      'lazyload-tag-length',
      'lazyload-dimension',
      'lazyload-url',
      'lazyload-entities',
      'lazyload-replacements',
      'lazyload-injected-scripts',
      'lazyload-runtime-url'
    ]);
    expect(SIMULATION_CAVEATS).toEqual([
      'combined-js',
      'core-lazy-loading',
      'image-smilies',
      'foreign-lazy-markup',
      'hook-text-placement',
      'runtime-url',
      'above-the-fold-exclusions',
      'site-filters'
    ]);
    expect(LAZYLOAD_PAGE_INDEPENDENT_CAVEATS).toEqual([
      'hook-text-placement',
      'runtime-url',
      'above-the-fold-exclusions',
      'site-filters'
    ]);
    expect(LAZYLOAD_ASSETS_URL_SOURCES).toEqual([
      'beacon',
      'plugin-asset',
      'theme-asset',
      'default'
    ]);
    expect(LAZYLOAD_HEAD_PLACEMENTS).toEqual(['before-end-tag', 'before-generator-meta']);
    expect(LAZYLOAD_FOOTER_PLACEMENTS).toEqual(['before-end-tag', 'before-beacon-block']);
    expect(LAZYLOAD_PLACEMENT_FALLBACKS).toEqual([
      'first-of-several-head-ends',
      'last-of-several-body-ends'
    ]);
    expect(LAZYLOAD_RUNTIME_DELIVERIES).toEqual(['external']);
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
      'invalid',
      'unreadable',
      'expired'
    ]);
    expect(SIMULATION_RUNTIME_UNAVAILABLE_CAUSES).toEqual([
      'asset-unreachable',
      'asset-malformed',
      'hash-mismatch',
      'version-missing'
    ]);
    expect(SIMULATION_LIST_LIMITS).toEqual({ rows: 2_000, rowChars: 1_000 });
  });

  it('gives LazyLoad its own reasons, steps and caveats, never another feature’s', () => {
    const { lazyload, defer_all_js: defer, delay_js: delay } = SIMULATION_REPORT_VOCABULARY;
    expect(lazyload.states).not.toContain('csp-blocked');
    expect(lazyload.reasons).not.toContain('delay-js-served');
    expect(lazyload.regexes).toEqual([
      'ie-conditionals',
      'ie-conditional-script',
      ...UNREPRODUCED_REGEXES.filter((regex) => regex.startsWith('lazyload-'))
    ]);
    expect(lazyload.caveats).not.toContain('combined-js');
    const lazyOnly = ['preview', 'search', 'page-builder-editor', 'no-head-end', 'no-body-end'];
    const lazyCaveats: readonly string[] = lazyload.caveats;
    for (const vocabulary of [defer, delay]) {
      expect(vocabulary.regexes.some((regex) => regex.startsWith('lazyload-'))).toBe(false);
      expect(vocabulary.reasons.some((reason) => lazyOnly.includes(reason))).toBe(false);
      expect(vocabulary.caveats.some((caveat) => lazyCaveats.includes(caveat))).toBe(false);
    }
    expect(delay.caveats).toEqual(['combined-js']);
    expect(defer.caveats).toEqual([]);
  });

  it('matches marker ids of exactly 32 lowercase hex digits', () => {
    expect(SIMULATION_MARKER_ID_PATTERN.test('0'.repeat(32))).toBe(true);
    expect(SIMULATION_MARKER_ID_PATTERN.test('f'.repeat(31))).toBe(false);
    expect(SIMULATION_MARKER_ID_PATTERN.test('F'.repeat(32))).toBe(false);
    expect(SIMULATION_MARKER_ID_PATTERN.test(`${'0'.repeat(32)}\n`)).toBe(false);
  });
});
