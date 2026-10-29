/**
 * Simulation contract guards: the simulate spec, the contradictory pair,
 * the document report (every state's facts, the list provenance pairing),
 * the engine input (caps, CSP inputs — page-derived parts degrading, never
 * failing) and the marker verification ask — every accept and reject arm
 * under both unknown-key policies.
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from '../exclusion-builder/set';
import {
  LATEST_LIST_MISSES,
  SIMULATION_CAVEATS,
  SIMULATION_CSP_LIMITS,
  SIMULATION_CSP_UNAVAILABLE_REASONS,
  SIMULATION_LIST_LIMITS,
  SIMULATION_RUNTIME_UNAVAILABLE_CAUSES,
  UNREPRODUCED_REGEXES
} from '../wp-rocket-simulation/spec';
import {
  isSimulatedFeatureId,
  isSimulationMarkerId,
  fitSimulationCsp,
  fitSiteVersion,
  isSimulationRuntimeUnavailableCause,
  optionalSimulateFor,
  parseDocumentSimulationInput,
  parseDocumentSimulationReport,
  parseSimulateSpec,
  parseSimulationMarkerQuery,
  parseSimulationMarkerVerdict,
  simulateContradictsSet,
  SIMULATION_WIRE_LIMITS
} from './exclusion-simulation';
import {
  delaySimulate,
  MARKER_ID,
  simulatedReport,
  simulationInput
} from './exclusion-simulation.fixtures';

/** A deep-cloned plain-object copy the cases mutate freely. */
function clone(value: unknown): Record<string, unknown> {
  return structuredClone(value) as Record<string, unknown>;
}

/** The fixture report with fields replaced (`undefined` deletes). */
function report(changes: Record<string, unknown>): Record<string, unknown> {
  const value = clone(simulatedReport());
  for (const [key, field] of Object.entries(changes)) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test helper: delete the named field
    if (field === undefined) delete value[key];
    else value[key] = field;
  }
  return value;
}

/** An identity-state report: nothing ran, a bundled list. */
function identity(state: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    feature: 'delay_js',
    state,
    delayed: 0,
    runtimeInjected: false,
    wpRocketVersion: '3.24',
    listSource: 'bundled',
    listMiss: 'never-fetched',
    ...extra
  };
}

/** The fixture input with fields replaced (`undefined` deletes). */
function input(changes: Record<string, unknown>): Record<string, unknown> {
  const value = clone(simulationInput());
  for (const [key, field] of Object.entries(changes)) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test helper: delete the named field
    if (field === undefined) delete value[key];
    else value[key] = field;
  }
  return value;
}

const parseReport = (value: unknown, policy: 'reject' | 'ignore' = 'reject') =>
  parseDocumentSimulationReport(value, delaySimulate(), policy);

/** A set disabling Delay JS. */
const DELAY_DISABLED: ExclusionSet = {
  rows: EMPTY_EXCLUSION_SET.rows,
  disable: { ...EMPTY_EXCLUSION_SET.disable, delayJs: true }
};

describe('parseSimulateSpec', () => {
  it('accepts registry features, each once, as a fresh value', () => {
    const raw = { features: ['delay_js'] };
    const parsed = parseSimulateSpec(raw, 'reject');
    expect(parsed).toEqual(delaySimulate());
    expect(parsed?.features).not.toBe(raw.features);
  });

  it.each([
    ['an empty list', { features: [] }],
    ['an unknown feature', { features: ['defer_all_js'] }],
    ['a repeated feature', { features: ['delay_js', 'delay_js'] }],
    ['a non-array', { features: 'delay_js' }],
    ['a sparse hole', { features: new Array<unknown>(1) }],
    ['no features', {}],
    ['a non-record', ['delay_js']],
    ['null', null]
  ])('rejects %s', (_label, value) => {
    expect(parseSimulateSpec(value, 'reject')).toBeNull();
    expect(parseSimulateSpec(value, 'ignore')).toBeNull();
  });

  it('rejects unknown keys under reject, drops them under ignore', () => {
    const extra = { features: ['delay_js'], mode: 'x' };
    expect(parseSimulateSpec(extra, 'reject')).toBeNull();
    expect(parseSimulateSpec(extra, 'ignore')).toEqual(delaySimulate());
  });

  it('reads own properties only', () => {
    const inherited = Object.create({ features: ['delay_js'] }) as object;
    expect(parseSimulateSpec(inherited, 'ignore')).toBeNull();
  });
});

describe('the contradictory pair', () => {
  it('flags a set disabling a simulated feature, nothing else', () => {
    expect(simulateContradictsSet(DELAY_DISABLED, delaySimulate())).toBe(true);
    expect(simulateContradictsSet(EMPTY_EXCLUSION_SET, delaySimulate())).toBe(false);
    const otherDisabled: ExclusionSet = {
      rows: EMPTY_EXCLUSION_SET.rows,
      disable: { delayJs: false, deferJs: true, lazyRender: true }
    };
    expect(simulateContradictsSet(otherDisabled, delaySimulate())).toBe(false);
  });

  it('reads an optional spec beside a set: absent, valid, malformed, contradictory', () => {
    expect(optionalSimulateFor(undefined, EMPTY_EXCLUSION_SET, 'reject')).toBeUndefined();
    expect(optionalSimulateFor(delaySimulate(), EMPTY_EXCLUSION_SET, 'reject')).toEqual(
      delaySimulate()
    );
    expect(optionalSimulateFor({ features: [] }, EMPTY_EXCLUSION_SET, 'reject')).toBeNull();
    expect(optionalSimulateFor(null, EMPTY_EXCLUSION_SET, 'reject')).toBeNull();
    expect(optionalSimulateFor(delaySimulate(), DELAY_DISABLED, 'reject')).toBeNull();
    expect(optionalSimulateFor(delaySimulate(), DELAY_DISABLED, 'ignore')).toBeNull();
  });
});

describe('parseDocumentSimulationReport', () => {
  it('rebuilds a full simulated report exactly', () => {
    expect(parseReport(simulatedReport())).toEqual(simulatedReport());
  });

  it('accepts a bare simulated report (every optional fact absent)', () => {
    const bare = report({
      undetermined: undefined,
      siteVersion: undefined,
      markerId: undefined,
      cspLimits: undefined,
      caveats: undefined
    });
    expect(parseReport(bare)).toEqual(bare);
  });

  it('carries a regex-limit-hit report as the transform produces it (nothing delayed)', () => {
    const hit = report({ delayed: 0, undetermined: undefined, regexLimitHit: true });
    expect(parseReport(hit)).toEqual(hit);
    expect(parseReport(report({ regexLimitHit: true }))).toBeNull();
    expect(parseReport(report({ delayed: 0, regexLimitHit: true }))).toBeNull();
    expect(parseReport(report({ regexLimitHit: false }))).toBeNull();
  });

  it('accepts each identity state with zero facts', () => {
    for (const state of ['already-served', 'csp-blocked']) {
      expect(parseReport(identity(state))).toEqual(identity(state));
    }
    const amp = identity('not-applicable', { reason: 'amp' });
    expect(parseReport(amp)).toEqual(amp);
    for (const regex of UNREPRODUCED_REGEXES) {
      const beyond = identity('not-applicable', {
        reason: 'beyond-exact-reproduction',
        unreproducedRegex: regex
      });
      expect(parseReport(beyond)).toEqual(beyond);
    }
  });

  it('pairs the reason with not-applicable and the regex with beyond-exact-reproduction', () => {
    expect(parseReport(identity('not-applicable'))).toBeNull();
    expect(parseReport(identity('not-applicable', { reason: 'other' }))).toBeNull();
    expect(
      parseReport(identity('not-applicable', { reason: 'amp', unreproducedRegex: 'xmp-mask' }))
    ).toBeNull();
    expect(
      parseReport(identity('not-applicable', { reason: 'beyond-exact-reproduction' }))
    ).toBeNull();
    expect(
      parseReport(
        identity('not-applicable', {
          reason: 'beyond-exact-reproduction',
          unreproducedRegex: 'other'
        })
      )
    ).toBeNull();
    expect(parseReport(identity('already-served', { reason: 'amp' }))).toBeNull();
    expect(parseReport(report({ unreproducedRegex: 'xmp-mask' }))).toBeNull();
  });

  it('refuses work on an identity state', () => {
    for (const fact of [
      { delayed: 1 },
      { runtimeInjected: true },
      { undetermined: 1 },
      { regexLimitHit: true },
      { markerId: MARKER_ID },
      { cspLimits: ['eval'] },
      { caveats: ['combined-js'] }
    ]) {
      expect(parseReport(identity('already-served', fact))).toBeNull();
      expect(parseReport(identity('csp-blocked', fact))).toBeNull();
    }
  });

  it('pairs each list source with its one companion fact', () => {
    expect(parseReport(report({}))).not.toBeNull();
    for (const miss of LATEST_LIST_MISSES) {
      const bundled = report({ listSource: 'bundled', listFetchedAt: undefined, listMiss: miss });
      expect(parseReport(bundled)).toEqual(bundled);
    }
    expect(parseReport(report({ listMiss: 'timeout' }))).toBeNull();
    expect(parseReport(report({ listFetchedAt: undefined }))).toBeNull();
    expect(parseReport(report({ listFetchedAt: -1 }))).toBeNull();
    expect(parseReport(report({ listFetchedAt: 1.5 }))).toBeNull();
    expect(parseReport(report({ listSource: 'bundled', listFetchedAt: undefined }))).toBeNull();
    expect(parseReport(report({ listSource: 'bundled', listMiss: 'timeout' }))).toBeNull();
    expect(
      parseReport(report({ listSource: 'bundled', listFetchedAt: undefined, listMiss: 'x' }))
    ).toBeNull();
    expect(parseReport(report({ listSource: 'cached' }))).toBeNull();
    expect(parseReport(report({ listSource: undefined }))).toBeNull();
  });

  it('checks every field’s type and bound', () => {
    for (const change of [
      { feature: 'defer_all_js' },
      { feature: undefined },
      { state: 'served' },
      { delayed: -1 },
      { delayed: 1.5 },
      { delayed: '4' },
      { undetermined: 0 },
      { runtimeInjected: 'yes' },
      { wpRocketVersion: '3.24-beta' },
      { wpRocketVersion: '' },
      { wpRocketVersion: '1.2.3.4.5' },
      { wpRocketVersion: '9'.repeat(SIMULATION_WIRE_LIMITS.versionChars + 1) },
      { wpRocketVersion: undefined },
      { markerId: MARKER_ID.toUpperCase() },
      { markerId: MARKER_ID.slice(1) },
      { cspLimits: [] },
      { cspLimits: ['eval', 'eval'] },
      { cspLimits: ['script'] },
      { caveats: [] },
      { caveats: ['combined-js', 'combined-js'] },
      { caveats: 'combined-js' }
    ]) {
      expect(parseReport(report(change)), JSON.stringify(change)).toBeNull();
    }
    expect(parseReport(report({ siteVersion: '3.24 (white-label)' }))).not.toBeNull();
  });

  it('omits an unfit served version (page-derived) instead of failing the report', () => {
    const withoutSite = report({ siteVersion: undefined });
    for (const siteVersion of [
      '',
      'x\u0000',
      'x'.repeat(SIMULATION_WIRE_LIMITS.versionChars + 1),
      // The detection's version grammar has no digit-run bound.
      '9'.repeat(SIMULATION_WIRE_LIMITS.versionChars + 1)
    ]) {
      expect(parseReport(report({ siteVersion })), JSON.stringify(siteVersion)).toEqual(
        withoutSite
      );
    }
    const edge = 'x'.repeat(SIMULATION_WIRE_LIMITS.versionChars);
    expect(parseReport(report({ siteVersion: edge }))?.siteVersion).toBe(edge);
  });

  it('fails a report whose served version is not a string (type drift, not page data)', () => {
    for (const siteVersion of [7, null, true, ['3.12'], { v: '3.12' }]) {
      expect(parseReport(report({ siteVersion })), JSON.stringify(siteVersion)).toBeNull();
    }
  });

  it('carries a CSP-unavailable reason on a simulated report only, never beside limits', () => {
    for (const cspUnavailable of SIMULATION_CSP_UNAVAILABLE_REASONS) {
      const unevaluated = report({ cspLimits: undefined, cspUnavailable });
      expect(parseReport(unevaluated)).toEqual(unevaluated);
    }
    expect(parseReport(report({ cspUnavailable: 'oversized' }))).toBeNull();
    expect(parseReport(report({ cspLimits: undefined, cspUnavailable: 'huge' }))).toBeNull();
    expect(parseReport(identity('already-served', { cspUnavailable: 'oversized' }))).toBeNull();
  });

  it('accepts every vocabulary value of the CSP limits and caveats', () => {
    expect(parseReport(report({ cspLimits: [...SIMULATION_CSP_LIMITS] }))).not.toBeNull();
    expect(parseReport(report({ caveats: [...SIMULATION_CAVEATS] }))).not.toBeNull();
  });

  it('accepts a report only for a feature the session simulates', () => {
    expect(parseDocumentSimulationReport(simulatedReport(), undefined, 'reject')).toBeNull();
  });

  it('rejects unknown keys under reject, drops them under ignore', () => {
    const extra = report({ future: 1 });
    expect(parseReport(extra, 'reject')).toBeNull();
    expect(parseReport(extra, 'ignore')).toEqual(simulatedReport());
    expect(parseReport('x')).toBeNull();
  });
});

describe('parseDocumentSimulationInput', () => {
  const HTML_LENGTH = 100;

  it('rebuilds a full input exactly, and a bare one', () => {
    expect(parseDocumentSimulationInput(simulationInput(), HTML_LENGTH)).toEqual(simulationInput());
    const bare = input({ markerId: undefined, csp: undefined });
    expect(parseDocumentSimulationInput(bare, HTML_LENGTH)).toEqual(bare);
    const latest = input({ listSource: 'latest', listMiss: undefined, listFetchedAt: 5 });
    expect(parseDocumentSimulationInput(latest, HTML_LENGTH)).toEqual(latest);
    const site = input({ siteVersion: '3.12' });
    expect(parseDocumentSimulationInput(site, HTML_LENGTH)).toEqual(site);
    const emptyList = input({ listRows: [] });
    expect(parseDocumentSimulationInput(emptyList, HTML_LENGTH)).toEqual(emptyList);
  });

  it('holds the caps at their exact edges', () => {
    const rows = Array.from({ length: SIMULATION_LIST_LIMITS.rows }, () => 'x');
    expect(parseDocumentSimulationInput(input({ listRows: rows }), HTML_LENGTH)).not.toBeNull();
    expect(
      parseDocumentSimulationInput(input({ listRows: [...rows, 'x'] }), HTML_LENGTH)
    ).toBeNull();
    const longRow = 'r'.repeat(SIMULATION_LIST_LIMITS.rowChars);
    expect(
      parseDocumentSimulationInput(input({ listRows: [longRow] }), HTML_LENGTH)
    ).not.toBeNull();
    expect(
      parseDocumentSimulationInput(input({ listRows: [`${longRow}r`] }), HTML_LENGTH)
    ).toBeNull();
    const runtime = 'r'.repeat(SIMULATION_WIRE_LIMITS.runtimeChars);
    expect(parseDocumentSimulationInput(input({ runtime }), HTML_LENGTH)).not.toBeNull();
    expect(parseDocumentSimulationInput(input({ runtime: `${runtime}r` }), HTML_LENGTH)).toBeNull();
    const fallback = 'f'.repeat(SIMULATION_WIRE_LIMITS.fallbackChars);
    expect(parseDocumentSimulationInput(input({ fallback }), HTML_LENGTH)).not.toBeNull();
    expect(
      parseDocumentSimulationInput(input({ fallback: `${fallback}f` }), HTML_LENGTH)
    ).toBeNull();
  });

  it('checks every field', () => {
    for (const change of [
      { features: [] },
      { features: ['lazyload'] },
      { features: undefined },
      { wpRocketVersion: 'latest' },
      { wpRocketVersion: '9'.repeat(SIMULATION_WIRE_LIMITS.versionChars + 1) },
      { runtime: '' },
      { runtime: 1 },
      { fallback: '' },
      { listRows: [''] },
      { listRows: [1] },
      { listRows: 'a' },
      { listSource: 'latest' },
      { listMiss: 'nope' },
      { markerId: 'x' },
      { cspUnavailable: 'huge' },
      { extra: true }
    ]) {
      expect(
        parseDocumentSimulationInput(input(change), HTML_LENGTH),
        JSON.stringify(change)
      ).toBeNull();
    }
    expect(parseDocumentSimulationInput('x', HTML_LENGTH)).toBeNull();
  });

  it('omits an unfit served version instead of failing the request', () => {
    for (const siteVersion of [
      '',
      'x\u0000',
      'x'.repeat(SIMULATION_WIRE_LIMITS.versionChars + 1)
    ]) {
      expect(parseDocumentSimulationInput(input({ siteVersion }), HTML_LENGTH)).toEqual(
        simulationInput()
      );
    }
    expect(fitSiteVersion(undefined)).toBeUndefined();
    expect(fitSiteVersion('3.24 (white-label)')).toBe('3.24 (white-label)');
  });

  it('fails a request whose served version is not a string', () => {
    for (const siteVersion of [7, null, ['3.12']]) {
      expect(
        parseDocumentSimulationInput(input({ siteVersion }), HTML_LENGTH),
        JSON.stringify(siteVersion)
      ).toBeNull();
    }
  });

  /** The CSP pair the input guard carries for a fixture whose `csp` is changed. */
  const cspOf = (changes: Record<string, unknown>, htmlLength = HTML_LENGTH) => {
    const parsed = parseDocumentSimulationInput(
      input({ csp: { ...clone(simulationInput().csp), ...changes } }),
      htmlLength
    );
    return parsed === null ? null : { csp: parsed.csp, cspUnavailable: parsed.cspUnavailable };
  };

  it('carries a fitting CSP: browser, header and meta shapes at their cap edges', () => {
    expect(cspOf({ browser: 'firefox' })?.csp?.browser).toBe('firefox');
    expect(cspOf({ headers: [], metas: [] }, 0)).toEqual({
      csp: { browser: 'chromium', headers: [], metas: [] },
      cspUnavailable: undefined
    });
    expect(cspOf({ metas: [{ content: '', offset: HTML_LENGTH }] })?.csp).toBeDefined();
    const many = Array.from({ length: SIMULATION_WIRE_LIMITS.cspEntries }, () => ({
      name: 'Content-Security-Policy',
      value: ''
    }));
    expect(cspOf({ headers: many })?.csp?.headers).toHaveLength(many.length);
    const long = 'v'.repeat(SIMULATION_WIRE_LIMITS.cspValueChars);
    expect(cspOf({ headers: [{ name: 'csp', value: long }] })?.csp).toBeDefined();
    const name = 'n'.repeat(SIMULATION_WIRE_LIMITS.cspNameChars);
    expect(cspOf({ headers: [{ name, value: 'x' }] })?.csp).toBeDefined();
  });

  it('degrades an oversized CSP to `oversized` (never truncated, never failing)', () => {
    const header = { name: 'Content-Security-Policy', value: '' };
    const many = Array.from({ length: SIMULATION_WIRE_LIMITS.cspEntries + 1 }, () => header);
    const long = 'v'.repeat(SIMULATION_WIRE_LIMITS.cspValueChars + 1);
    for (const changes of [
      { headers: many },
      {
        metas: Array.from({ length: SIMULATION_WIRE_LIMITS.cspEntries + 1 }, () => ({
          content: '',
          offset: 0
        }))
      },
      { headers: [{ name: 'csp', value: long }] },
      { headers: [{ name: 'n'.repeat(SIMULATION_WIRE_LIMITS.cspNameChars + 1), value: 'x' }] },
      { metas: [{ content: long, offset: 0 }] }
    ]) {
      expect(cspOf(changes), JSON.stringify(changes).slice(0, 80)).toEqual({
        csp: undefined,
        cspUnavailable: 'oversized'
      });
    }
  });

  it('degrades an unreadable CSP to `unreadable`', () => {
    for (const changes of [
      { browser: 'webkit' },
      { headers: undefined },
      { metas: undefined },
      { extra: 1 },
      { headers: [{ name: '', value: 'x' }] },
      { headers: [{ name: 'csp', value: 1 }] },
      { headers: [{ name: 'csp', value: '', extra: 1 }] },
      { headers: ['csp'] },
      { metas: [{ content: 'x', offset: -1 }] },
      { metas: [{ content: 'x', offset: HTML_LENGTH + 1 }] },
      { metas: [{ content: 1, offset: 0 }] },
      { metas: [{ content: 'x', offset: 0, extra: 1 }] }
    ]) {
      expect(cspOf(changes), JSON.stringify(changes)).toEqual({
        csp: undefined,
        cspUnavailable: 'unreadable'
      });
    }
    const notRecord = parseDocumentSimulationInput(input({ csp: null }), HTML_LENGTH);
    expect(notRecord?.cspUnavailable).toBe('unreadable');
  });

  it('keeps a host-given CSP-unavailable reason; beside a CSP it is contradictory', () => {
    for (const cspUnavailable of SIMULATION_CSP_UNAVAILABLE_REASONS) {
      const given = input({ csp: undefined, cspUnavailable });
      expect(parseDocumentSimulationInput(given, HTML_LENGTH)).toEqual(given);
      expect(parseDocumentSimulationInput(input({ cspUnavailable }), HTML_LENGTH)).toBeNull();
    }
  });

  it('fits a host-side CSP identically for both browser engines', () => {
    const long = 'v'.repeat(SIMULATION_WIRE_LIMITS.cspValueChars + 1);
    for (const browser of ['chromium', 'firefox']) {
      const fitting = {
        browser,
        headers: [{ name: 'csp', value: "script-src 'self'" }],
        metas: []
      };
      expect(fitSimulationCsp(fitting, 0)).toEqual({ csp: fitting });
      const oversized = { ...fitting, headers: [{ name: 'csp', value: long }] };
      expect(fitSimulationCsp(oversized, 0)).toEqual({ cspUnavailable: 'oversized' });
      const unreadable = { ...fitting, metas: [{ content: 'x', offset: 1 }] };
      expect(fitSimulationCsp(unreadable, 0)).toEqual({ cspUnavailable: 'unreadable' });
    }
  });
});

describe('marker verification row', () => {
  it('parses the ask: exactly a well-formed marker id', () => {
    expect(parseSimulationMarkerQuery({ markerId: MARKER_ID })).toEqual({ markerId: MARKER_ID });
    expect(parseSimulationMarkerQuery({ markerId: MARKER_ID, tabId: 1 })).toBeNull();
    expect(parseSimulationMarkerQuery({ markerId: 'f'.repeat(31) })).toBeNull();
    expect(parseSimulationMarkerQuery({})).toBeNull();
    expect(parseSimulationMarkerQuery(null)).toBeNull();
  });

  it('parses the verdict: registry features each once, empty = unverified', () => {
    expect(parseSimulationMarkerVerdict({ features: [] })).toEqual({ features: [] });
    expect(parseSimulationMarkerVerdict({ features: ['delay_js'] })).toEqual({
      features: ['delay_js']
    });
    expect(parseSimulationMarkerVerdict({ features: ['x'] })).toBeNull();
    expect(parseSimulationMarkerVerdict({ features: ['delay_js', 'delay_js'] })).toBeNull();
    expect(parseSimulationMarkerVerdict({ features: [], extra: 1 })).toBeNull();
    expect(parseSimulationMarkerVerdict({})).toBeNull();
  });
});

describe('closed-value predicates', () => {
  it('recognize their vocabularies only', () => {
    expect(isSimulatedFeatureId('delay_js')).toBe(true);
    expect(isSimulatedFeatureId('defer_all_js')).toBe(false);
    expect(isSimulationMarkerId(MARKER_ID)).toBe(true);
    expect(isSimulationMarkerId(`${MARKER_ID}0`)).toBe(false);
    expect(isSimulationMarkerId(1)).toBe(false);
    for (const cause of SIMULATION_RUNTIME_UNAVAILABLE_CAUSES) {
      expect(isSimulationRuntimeUnavailableCause(cause)).toBe(true);
    }
    expect(isSimulationRuntimeUnavailableCause('toString')).toBe(false);
    expect(isSimulationRuntimeUnavailableCause(undefined)).toBe(false);
  });
});
