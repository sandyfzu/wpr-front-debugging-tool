/**
 * The LazyLoad half of the simulation contract: its engine input (exactly
 * with the feature; URL, text, path and list caps) and its report (counts,
 * the simulated-only facts all or none, no list provenance, its own
 * vocabulary only) — and the other features' reports refusing its values.
 */
import { describe, expect, it } from 'vitest';
import {
  LAZYLOAD_CAVEATS,
  SIMULATION_REPORT_VOCABULARY,
  type SimulateSpec
} from '../wp-rocket-simulation/spec';
import {
  isLazyloadRuntimeUrl,
  parseDocumentSimulationInput,
  parseDocumentSimulationReport,
  parseSimulationLazyloadInput,
  SIMULATION_WIRE_LIMITS,
  type DocumentSimulationInput,
  type SimulationLazyloadInput
} from './exclusion-simulation';

const LAZYLOAD: SimulationLazyloadInput = {
  pageUrl: 'https://example.org/post/?p=1',
  noJsStyle: '<noscript><style id="rocket-lazyload-nojs-css">x</style></noscript>',
  optionsScript: '<script>window.lazyLoadOptions=[{}];</script>',
  runtimeTagBeforeUrl: '<script data-no-minify="1" async src="',
  runtimeTagAfterUrl: '"></script>',
  runtimeJsPath: 'lazyload/17.8.3/lazyload.min.js',
  excludedAttributes: ['data-no-lazy='],
  excludedSrc: ['/wpcf7_captcha/']
};

/** An engine input simulating `features` (LazyLoad's inputs given unless `null`: absent). */
function input(
  features: DocumentSimulationInput['features'] = ['lazyload'],
  lazyload: unknown = LAZYLOAD
): Record<string, unknown> {
  return {
    ...(lazyload === null ? {} : { lazyload }),
    features,
    wpRocketVersion: '3.24',
    runtime: 'r',
    fallback: 'f',
    listRows: [],
    listSource: 'bundled',
    listMiss: 'never-fetched'
  };
}

describe('parseSimulationLazyloadInput', () => {
  it('rebuilds a valid input exactly', () => {
    expect(parseSimulationLazyloadInput(LAZYLOAD)).toEqual(LAZYLOAD);
    expect(parseSimulationLazyloadInput(LAZYLOAD)).not.toBe(LAZYLOAD);
  });

  it.each([
    ['an unknown key', { extra: 1 }],
    ['a relative page URL', { pageUrl: '/post/' }],
    ['a non-http page URL', { pageUrl: 'file:///x.html' }],
    [
      'an over-cap page URL',
      { pageUrl: `https://e.org/${'x'.repeat(SIMULATION_WIRE_LIMITS.pageUrlChars)}` }
    ],
    ['an empty text', { noJsStyle: '' }],
    [
      'an over-cap text',
      { optionsScript: 'x'.repeat(SIMULATION_WIRE_LIMITS.lazyloadTextChars + 1) }
    ],
    ['a non-string text', { runtimeTagAfterUrl: 1 }],
    ['a climbing runtime path', { runtimeJsPath: '../x.js' }],
    ['a non-JS runtime path', { runtimeJsPath: 'lazyload/x.css' }],
    ['an over-cap runtime path', { runtimeJsPath: `${'a/'.repeat(200)}x.js` }],
    ['a bad literal', { excludedSrc: [''] }],
    ['a missing list', { excludedAttributes: undefined }],
    ['an unknown runtime-unavailable cause', { runtimeUnavailable: 'gone' }]
  ])('refuses %s', (_name, change) => {
    expect(parseSimulationLazyloadInput({ ...LAZYLOAD, ...change })).toBeNull();
  });

  it('rebuilds an unusable runtime’s cause', () => {
    const unusable = { ...LAZYLOAD, runtimeUnavailable: 'hash-mismatch' };
    expect(parseSimulationLazyloadInput(unusable)).toEqual(unusable);
  });

  it('rides the engine input exactly with LazyLoad', () => {
    expect(parseDocumentSimulationInput(input(), 10)?.lazyload).toEqual(LAZYLOAD);
    expect(parseDocumentSimulationInput(input(['lazyload'], null), 10)).toBeNull();
    expect(parseDocumentSimulationInput(input(['delay_js']), 10)).toBeNull();
    expect(parseDocumentSimulationInput(input(['delay_js'], null), 10)).not.toBeNull();
    expect(parseDocumentSimulationInput(input(['lazyload'], { pageUrl: 'x' }), 10)).toBeNull();
  });
});

const SPEC: SimulateSpec = { features: ['lazyload', 'delay_js'] };

const SIMULATED = {
  feature: 'lazyload',
  state: 'simulated',
  wpRocketVersion: '3.24',
  images: 2,
  pictures: 1,
  backgrounds: 0,
  runtimeUrl:
    'https://example.org/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js',
  assetsUrlSource: 'beacon',
  delivery: 'external',
  placement: {
    head: 'before-generator-meta',
    footer: 'before-beacon-block',
    fallbacks: ['last-of-several-body-ends']
  },
  caveats: ['core-lazy-loading', 'hook-text-placement']
};

/** Parse a report under the spec. */
function parse(report: unknown, policy: 'reject' | 'ignore' = 'reject') {
  return parseDocumentSimulationReport(report, SPEC, policy);
}

describe('parseDocumentSimulationReport — LazyLoad', () => {
  it('rebuilds a simulated report exactly (no list provenance)', () => {
    expect(parse(SIMULATED)).toEqual(SIMULATED);
    expect(
      parse({ ...SIMULATED, placement: { ...SIMULATED.placement, fallbacks: [] } })
    ).not.toBeNull();
  });

  it('accepts every identity state and reason of its vocabulary, with zero counts and no facts', () => {
    const identity = {
      feature: 'lazyload',
      wpRocketVersion: '3.24',
      images: 0,
      pictures: 0,
      backgrounds: 0
    };
    expect(parse({ ...identity, state: 'already-served' })).not.toBeNull();
    for (const reason of SIMULATION_REPORT_VOCABULARY.lazyload.reasons) {
      if (reason === 'beyond-exact-reproduction') continue;
      expect(parse({ ...identity, state: 'not-applicable', reason })).not.toBeNull();
    }
    for (const regex of SIMULATION_REPORT_VOCABULARY.lazyload.regexes) {
      const beyond = { ...identity, state: 'not-applicable', reason: 'beyond-exact-reproduction' };
      expect(parse({ ...beyond, unreproducedRegex: regex })).not.toBeNull();
    }
    expect(parse({ ...identity, state: 'csp-blocked' })).not.toBeNull();
    expect(parse({ ...identity, state: 'csp-blocked', images: 1 })).toBeNull();
    expect(parse({ ...identity, state: 'csp-blocked', cspLimits: ['placeholders'] })).toBeNull();
    expect(parse({ ...identity, state: 'not-applicable', reason: 'delay-js-served' })).toBeNull();
    const beyond = { ...identity, state: 'not-applicable', reason: 'beyond-exact-reproduction' };
    expect(parse({ ...beyond, unreproducedRegex: 'xmp-mask' })).toBeNull();
    expect(parse({ ...identity, state: 'already-served', images: 1 })).toBeNull();
    expect(parse({ ...identity, state: 'already-served', delivery: 'external' })).toBeNull();
    expect(parse({ ...identity, state: 'already-served', cspUnavailable: 'oversized' })).toBeNull();
  });

  it.each([
    ['a missing fact', { runtimeUrl: undefined }],
    ['a relative runtime URL', { runtimeUrl: '/x.js' }],
    [
      'an over-cap runtime URL',
      { runtimeUrl: `https://e.org/${'x'.repeat(SIMULATION_WIRE_LIMITS.runtimeUrlChars)}` }
    ],
    ['an unknown source', { assetsUrlSource: 'guess' }],
    ['an unknown delivery', { delivery: 'inline' }],
    [
      'an unknown placement',
      { placement: { head: 'top', footer: 'before-end-tag', fallbacks: [] } }
    ],
    ['a placement key more', { placement: { ...SIMULATED.placement, extra: 1 } }],
    [
      'a repeated fallback',
      {
        placement: {
          ...SIMULATED.placement,
          fallbacks: ['last-of-several-body-ends', 'last-of-several-body-ends']
        }
      }
    ],
    ['no caveat', { caveats: [] }],
    ['Delay JS’s caveat', { caveats: ['combined-js'] }],
    ['a negative count', { images: -1 }],
    ['list provenance', { listSource: 'bundled', listMiss: 'never-fetched' }],
    ['Delay JS’s field', { delayed: 0 }]
  ])('refuses %s', (_name, change) => {
    expect(parse({ ...SIMULATED, ...change })).toBeNull();
  });

  it('carries its CSP facts on a simulated report: its own limit, or why the CSP was not read', () => {
    expect(parse({ ...SIMULATED, cspLimits: ['placeholders'] })).toEqual({
      ...SIMULATED,
      cspLimits: ['placeholders']
    });
    for (const cspUnavailable of ['oversized', 'unreadable']) {
      expect(parse({ ...SIMULATED, cspUnavailable })).toEqual({ ...SIMULATED, cspUnavailable });
    }
    expect(parse({ ...SIMULATED, cspLimits: ['inline'] })).toBeNull();
    expect(parse({ ...SIMULATED, cspLimits: [] })).toBeNull();
    expect(parse({ ...SIMULATED, cspLimits: ['placeholders', 'placeholders'] })).toBeNull();
    expect(parse({ ...SIMULATED, cspUnavailable: 'huge' })).toBeNull();
    expect(
      parse({ ...SIMULATED, cspLimits: ['placeholders'], cspUnavailable: 'oversized' })
    ).toBeNull();
  });

  it('refuses CSP facts on a Defer JS report', () => {
    const defer = {
      feature: 'defer_all_js',
      state: 'simulated',
      wpRocketVersion: '3.24',
      listSource: 'bundled',
      listMiss: 'never-fetched',
      deferred: 1,
      wrapped: 0
    };
    const spec: SimulateSpec = { features: ['defer_all_js'] };
    expect(parseDocumentSimulationReport(defer, spec, 'reject')).not.toBeNull();
    expect(
      parseDocumentSimulationReport({ ...defer, cspLimits: ['placeholders'] }, spec, 'reject')
    ).toBeNull();
    expect(
      parseDocumentSimulationReport({ ...defer, cspUnavailable: 'oversized' }, spec, 'reject')
    ).toBeNull();
  });

  it('accepts every caveat of its vocabulary at once', () => {
    expect(parse({ ...SIMULATED, caveats: [...LAZYLOAD_CAVEATS] })).not.toBeNull();
  });

  it('refuses LazyLoad’s values on another feature’s report', () => {
    const delay = {
      feature: 'delay_js',
      state: 'simulated',
      wpRocketVersion: '3.24',
      listSource: 'bundled',
      listMiss: 'never-fetched',
      delayed: 1,
      runtimeInjected: true
    };
    expect(parse(delay)).not.toBeNull();
    expect(parse({ ...delay, caveats: ['core-lazy-loading'] })).toBeNull();
    expect(parse({ ...delay, images: 0 })).toBeNull();
    const beyond = { ...delay, state: 'not-applicable', delayed: 0, runtimeInjected: false };
    expect(parse({ ...beyond, reason: 'search' })).toBeNull();
    expect(
      parse({
        ...beyond,
        reason: 'beyond-exact-reproduction',
        unreproducedRegex: 'lazyload-images'
      })
    ).toBeNull();
  });

  it('refuses a LazyLoad report from a session that does not simulate it', () => {
    expect(
      parseDocumentSimulationReport(SIMULATED, { features: ['delay_js'] }, 'reject')
    ).toBeNull();
  });

  it('reads a runtime URL as absolute http(s) within the cap', () => {
    expect(isLazyloadRuntimeUrl('http://e.org/x.js')).toBe(true);
    expect(isLazyloadRuntimeUrl('javascript:alert(1)')).toBe(false);
    expect(isLazyloadRuntimeUrl(1)).toBe(false);
  });
});
