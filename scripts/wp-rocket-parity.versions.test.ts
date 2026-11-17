/**
 * The parity script's per-version helpers: the CLI's zip rule, each
 * supported version's zip pin, merging the builds of every supported
 * version into the tables and data file, `--ci` over several pinned builds,
 * the pinned-version `--compare` skip, and `--release-check`'s tag ordering.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SupportedWprVersion } from '../lib/wp-rocket/versions.ts';
import {
  alignedPlugins,
  ciFindings,
  compareReleaseVersions,
  compareZip,
  expectationBasis,
  formatTable,
  mergeBuilds,
  mergeSimulationData,
  newerReleaseTags,
  parseReleaseVersion,
  pinnedBuildDrift,
  pinnedPluginOf,
  pinnedVersionFindings,
  pluginZipPath,
  releaseCheckFindings,
  simulationArtifacts,
  tableForVersion,
  zipPinProblem,
  type BuildHeader,
  type BuildResult
} from './wp-rocket-parity.ts';
import type { ParityHeader } from '../lib/exclusion-builder/wp-rocket-parity-table.ts';

/** sha256 hex of a text. */
const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** A build header for a version. */
function header(version: string, run = 'v1'): BuildHeader {
  return {
    plugin: version,
    pluginZipSha256: sha(version),
    pluginPackages: { 'a/run': run },
    wp: '7.0',
    wpZipSha1: 'bb',
    php: '8.1.34',
    pcre2: '10.49',
    pcreJit: 'on',
    libxml: '2.9.13',
    generatedBy: 'test'
  };
}

/** A build of a version: one save row, one simulate row, its own runtime text. */
function build(version: string, options: { stored?: string; runtime?: string } = {}): BuildResult {
  const runtime = options.runtime ?? 'class X{constructor(){this.v="2.0.5"}}';
  const { pins, data } = simulationArtifacts(
    {
      version,
      runtime: new TextEncoder().encode(runtime),
      dynamicLists: new TextEncoder().encode(
        '{"delay_js_exclusions":["a"],"defer_js_external_exclusions":["b"],"defer_js_inline_exclusions":["c"]}'
      ),
      ieFallback: 'F',
      lazyload: {
        texts: {
          assetsUrl: 'https://e.org/assets/',
          head: '<noscript>N</noscript>',
          footer: '<script>O</script><script src="https://e.org/assets/js/l/1/l.min.js"></script>',
          excludedAttributes: ['a='],
          excludedSrc: ['/s/']
        },
        runtime: new TextEncoder().encode('!function(){}')
      }
    },
    { runtime: 'R.run()', ieFallback: 'S' }
  );
  return {
    header: header(version),
    parityRows: [
      {
        id: 'save-a',
        kind: 'save',
        feature: 'delay_js',
        typed: ['a'],
        stored: [options.stored ?? 'a'],
        dropped: []
      }
    ],
    simulationRows: [
      {
        id: 'simulate-a',
        kind: 'simulate',
        feature: 'delay_js',
        rows: [],
        listRows: [],
        html: '<p>',
        served: '<p>'
      }
    ],
    pins,
    data
  };
}

describe('compareZip', () => {
  it('pairs --zip with --compare only', () => {
    expect(compareZip({ mode: 'compare', zip: 'a.zip' })).toBe('a.zip');
    expect(compareZip({ mode: 'check' })).toBeUndefined();
    expect(() => compareZip({ mode: 'compare' })).toThrow('--compare needs --zip <path>');
    expect(() => compareZip({ mode: 'check', zip: 'a.zip' })).toThrow(
      '--zip is for --compare only: the other modes read docker/wpr/wpr-rocket-<version>.zip'
    );
    expect(() => compareZip({ mode: 'ci', zip: 'a.zip' })).toThrow('--zip is for --compare only');
  });
});

describe('zipPinProblem', () => {
  const row: SupportedWprVersion = {
    version: '3.24',
    zipSha256: 'a'.repeat(64),
    role: 'latest-stable',
    variants: { deferInlineQuoteDelimiter: '/', metaCharsetMoveText: 'literal' }
  };

  it('names one zip per version', () => {
    expect(pluginZipPath('3.24')).toBe('docker/wpr/wpr-rocket-3.24.zip');
  });

  it('accepts the pinned build', () => {
    expect(zipPinProblem(row, { version: '3.24', sha256: 'a'.repeat(64) }, 'check')).toBeNull();
  });

  it('rejects another plugin version in every mode', () => {
    for (const mode of ['check', 'write', 'ci'] as const) {
      expect(zipPinProblem(row, { version: '3.23.5.1', sha256: 'a'.repeat(64) }, mode)).toBe(
        'docker/wpr/wpr-rocket-3.24.zip is WP Rocket 3.23.5.1, expected 3.24'
      );
    }
  });

  it('rejects other bytes except under --ci (builds are not byte-reproducible)', () => {
    const found = { version: '3.24', sha256: 'b'.repeat(64) };
    expect(zipPinProblem(row, found, 'check')).toContain(
      `has sha256 ${'b'.repeat(64)}, pinned ${'a'.repeat(64)}`
    );
    expect(zipPinProblem(row, found, 'write')).toContain('shasum -a 256');
    expect(zipPinProblem(row, found, 'ci')).toBeNull();
  });
});

describe('mergeBuilds', () => {
  it('keeps the shared rows, the reference header and pins, and lists every build', () => {
    const merged = mergeBuilds([build('3.24'), build('3.23.5.1')], '3.24');
    const plugins = [pinnedPluginOf(header('3.24')), pinnedPluginOf(header('3.23.5.1'))];
    expect(merged.parity.header).toEqual({ ...header('3.24'), plugins });
    expect(Object.keys(merged.parity.header)).toEqual([
      'plugin',
      'pluginZipSha256',
      'pluginPackages',
      'plugins',
      'wp',
      'wpZipSha1',
      'php',
      'pcre2',
      'pcreJit',
      'libxml',
      'generatedBy'
    ]);
    expect(merged.parity.rows).toEqual(build('3.24').parityRows);
    expect(merged.simulation.header).toEqual({
      ...merged.parity.header,
      simulation: build('3.24').pins
    });
    expect(Object.keys(merged.data.versions)).toEqual(['3.24', '3.23.5.1']);
    // Identical runtime, fallback, lists and LazyLoad texts: one text each (runtime, fallback,
    // four LazyLoad texts), one entry per list (three dynamic lists, two LazyLoad lists).
    expect(Object.keys(merged.data.texts)).toHaveLength(6);
    expect(Object.keys(merged.data.rowLists)).toHaveLength(5);
  });

  it('stores a build-specific runtime as its own text', () => {
    const other = 'class Y{constructor(){this.v="2.0.6"}}';
    const merged = mergeBuilds([build('3.24', { runtime: other }), build('3.23.5.1')], '3.24');
    expect(Object.keys(merged.data.texts)).toHaveLength(7);
    expect(merged.data.versions['3.24']?.runtime).toEqual({ sha256: sha(other), version: '2.0.6' });
    expect(merged.simulation.header.simulation).toEqual(build('3.24', { runtime: other }).pins);
  });

  it("writes a non-reference build's differing outputs as that version's expectations", () => {
    const merged = mergeBuilds([build('3.24'), build('3.23.5.1', { stored: 'b' })], '3.24');
    expect(merged.parity.rows).toEqual([
      { ...build('3.24').parityRows[0], byVersion: { '3.23.5.1': { stored: ['b'] } } }
    ]);
    // Only the differing row carries them.
    expect(merged.simulation.rows).toEqual(build('3.24').simulationRows);
  });

  it('fails when a build differs on an input or derives another row set', () => {
    const other = build('3.23.5.1');
    const typed = { ...other, parityRows: [{ ...other.parityRows[0], typed: ['z'] }] };
    expect(() => mergeBuilds([build('3.24'), typed], '3.24')).toThrow(
      'WP Rocket 3.23.5.1: save-a.typed differs but is not an output'
    );
    const fewer = { ...other, simulationRows: [] };
    expect(() => mergeBuilds([build('3.24'), fewer], '3.24')).toThrow(
      'WP Rocket 3.23.5.1 derives another row set (at "simulate-a")'
    );
  });

  it('fails without a build of the reference version', () => {
    expect(() => mergeBuilds([build('3.23.5.1')], '3.24')).toThrow(
      'no build of the reference WP Rocket 3.24'
    );
  });
});

describe('expectationBasis (which expectations --compare reads)', () => {
  const supported = ['3.24', '3.23.5.1'];

  it("compares a newer patch of a supported minor against that minor's expectations", () => {
    expect(expectationBasis('3.23.6', supported, '3.24')).toBe('3.23.5.1');
    expect(expectationBasis('3.24.1', supported, '3.24')).toBe('3.24');
  });

  it('compares a new minor, a pre-release elsewhere or an unparsable version against the reference', () => {
    expect(expectationBasis('3.25', supported, '3.24')).toBe('3.24');
    expect(expectationBasis('4.0-beta1', supported, '3.24')).toBe('3.24');
    expect(expectationBasis('not a version', supported, '3.24')).toBe('3.24');
  });

  it('picks the newest pin of the minor when several are pinned', () => {
    expect(expectationBasis('3.23.9', ['3.24', '3.23.5', '3.23.5.1'], '3.24')).toBe('3.23.5.1');
  });
});

describe('tableForVersion', () => {
  const committed = {
    header: {
      plugin: '3.24',
      pluginPackages: { 'a/b': 'v2' },
      plugins: [
        { version: '3.24', zipSha256: 'a', packages: { 'a/b': 'v2' } },
        { version: '3.23.5.1', zipSha256: 'b', packages: { 'a/b': 'v1' } }
      ]
    },
    rows: [
      { id: 'r', served: 'new', byVersion: { '3.23.5.1': { served: 'old' } } },
      { id: 's', served: 'same' }
    ]
  };

  it("resolves the rows and the header to one version's expectations", () => {
    expect(tableForVersion(committed, '3.23.5.1')).toEqual({
      header: { ...committed.header, plugin: '3.23.5.1', pluginPackages: { 'a/b': 'v1' } },
      rows: [
        { id: 'r', served: 'old' },
        { id: 's', served: 'same' }
      ]
    });
  });

  it('gives the reference its own outputs, without byVersion', () => {
    expect(tableForVersion(committed, '3.24').rows).toEqual([
      { id: 'r', served: 'new' },
      { id: 's', served: 'same' }
    ]);
  });
});

describe('mergeSimulationData', () => {
  it('fails when the merged file breaks its own reader', () => {
    const data = build('3.24').data;
    expect(() => mergeSimulationData([{ ...data, texts: {} }])).toThrow(
      'merged public/wp-rocket-simulation/simulation-data.json:'
    );
  });
});

describe('ciFindings over several pinned builds', () => {
  /** A committed/fresh table pinning 3.24 (reference) and 3.23.5.1. */
  function table(): { header: Record<string, unknown>; rows: Record<string, unknown>[] } {
    const merged = mergeBuilds([build('3.24'), build('3.23.5.1')], '3.24');
    return {
      header: { ...merged.parity.header },
      rows: merged.parity.rows.map((row) => ({ ...row }))
    };
  }

  /** The verdict for the committed {@link table} against a mutated fresh copy. */
  async function verdict(mutate: (fresh: ReturnType<typeof table>) => void) {
    const fresh = table();
    mutate(fresh);
    return ciFindings(await formatTable(table()), fresh);
  }

  /** The fresh header's `plugins`, mutable. */
  function plugins(fresh: ReturnType<typeof table>): { zipSha256: string; packages: object }[] {
    return fresh.header.plugins as { zipSha256: string; packages: object }[];
  }

  it('reproduces when only zip bytes differ, naming every build', async () => {
    expect(
      await verdict((fresh) => {
        fresh.header.pluginZipSha256 = 'cc';
        for (const plugin of plugins(fresh)) plugin.zipSha256 = 'cc';
      })
    ).toEqual([
      {
        level: 'notice',
        title: 'the table reproduces with a fresh build of WP Rocket 3.24 and 3.23.5.1',
        details: []
      }
    ]);
  });

  it("fails as drift on a non-reference build's packages, naming it", async () => {
    const findings = await verdict((fresh) => {
      const second = plugins(fresh)[1];
      if (second !== undefined) second.packages = { 'a/run': 'v2' };
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.title).toBe('reference drift: rebuild locally and review');
    expect(findings[0]?.details[0]).toBe('WP Rocket 3.23.5.1: a/run: v1 → v2');
    expect(findings[0]?.details[1]).toContain('`apvm build wp-rocket tag:v3.23.5.1`');
  });

  it('names every drifted build', async () => {
    const findings = await verdict((fresh) => {
      fresh.header.pluginPackages = { 'a/run': 'v2' };
      for (const plugin of plugins(fresh)) plugin.packages = { 'a/run': 'v2' };
    });
    expect(findings[0]?.details).toEqual([
      'a/run: v1 → v2',
      'WP Rocket 3.23.5.1: a/run: v1 → v2',
      expect.stringContaining('WP Rocket 3.24 / 3.23.5.1 vendors other package versions')
    ]);
  });

  it('fails as stale when the pinned versions change', async () => {
    const findings = await verdict((fresh) => {
      fresh.header.plugins = plugins(fresh).slice(0, 1);
    });
    expect(findings[0]?.title).toBe('table stale');
    expect(findings[0]?.details[0]).toMatch(/^header\.plugins: /);
  });
});

describe('alignedPlugins / pinnedBuildDrift', () => {
  const before = mergeBuilds([build('3.24'), build('3.23.5.1')], '3.24').parity
    .header as unknown as ParityHeader;

  it('takes the committed entry for each build both headers pin', () => {
    const fresh = [{ version: '3.24', zipSha256: 'x', packages: {} }, { version: '9.9' }];
    expect(alignedPlugins(before.plugins, fresh)).toEqual([before.plugins[0], { version: '9.9' }]);
    expect(alignedPlugins(before.plugins, undefined)).toBeUndefined();
  });

  it('skips the reference, unpinned and unchanged builds', () => {
    const fresh = [
      { version: '3.24', packages: { 'a/run': 'v9' } },
      { version: '3.23.5.1', packages: { 'a/run': 'v1' } },
      { version: '9.9', packages: { 'a/run': 'v9' } }
    ];
    expect(pinnedBuildDrift(before, fresh)).toEqual({ lines: [], versions: [] });
    expect(pinnedBuildDrift(before, 'nope')).toEqual({ lines: [], versions: [] });
    expect(pinnedBuildDrift(before, [{ version: '3.23.5.1' }]).lines).toEqual([
      'WP Rocket 3.23.5.1: a/run: v1 → absent'
    ]);
  });
});

describe('pinnedVersionFindings', () => {
  it('skips the comparison of a supported non-reference version', () => {
    expect(pinnedVersionFindings('3.23.5.1')).toEqual([
      {
        level: 'notice',
        title:
          'WP Rocket 3.23.5.1 is a supported version the tables are derived under; comparison skipped',
        details: []
      }
    ]);
  });
});

describe('release tags', () => {
  /** The order of two tags (sign only). */
  function order(a: string, b: string): number {
    const left = parseReleaseVersion(a);
    const right = parseReleaseVersion(b);
    if (left === null || right === null) throw new Error(`unparsable ${a} / ${b}`);
    return Math.sign(compareReleaseVersions(left, right));
  }

  it('parses v-prefixed or bare dotted versions with an optional suffix', () => {
    expect(parseReleaseVersion('v3.24-beta5')).toEqual({ parts: [3, 24], suffix: 'beta5' });
    expect(parseReleaseVersion('3.23.5.1')).toEqual({ parts: [3, 23, 5, 1], suffix: '' });
    expect(parseReleaseVersion('release-1')).toBeNull();
    expect(parseReleaseVersion('v3.24-')).toBeNull();
  });

  it('orders numerically, a pre-release before its release, suffixes naturally', () => {
    expect(order('v3.24', 'v3.23.5.1')).toBe(1);
    expect(order('v3.24', 'v3.24.0')).toBe(0);
    expect(order('v3.24-beta5', 'v3.24')).toBe(-1);
    expect(order('v3.24', 'v3.24-beta5')).toBe(1);
    expect(order('v3.24-beta10', 'v3.24-beta2')).toBe(1);
    expect(order('v3.25-alpha', 'v3.24')).toBe(1);
    expect(order('v3.24-beta', 'v3.24-beta')).toBe(0);
  });

  it('lists releases newer than every supported version, newest first, flags ignored', () => {
    const tags = ['v3.24', 'v3.24-beta5', 'v3.23.5.1', 'v3.25-alpha', 'v3.24.1', 'junk', ''];
    expect(newerReleaseTags(tags, ['3.24', '3.23.5.1'])).toEqual(['v3.25-alpha', 'v3.24.1']);
    expect(newerReleaseTags(['v3.24', 'v3.24-beta5'], ['3.24', '3.23.5.1'])).toEqual([]);
  });

  it('orders pre-release stages prealpha < alpha < beta < rc < release', () => {
    expect(newerReleaseTags(['v3.25-alpha1', 'v3.25-prealpha2', 'v3.25-beta1'], ['3.24'])).toEqual([
      'v3.25-beta1',
      'v3.25-alpha1',
      'v3.25-prealpha2'
    ]);
    expect(order('v3.25-prealpha9', 'v3.25-alpha1')).toBe(-1);
    expect(order('v3.25-alpha9', 'v3.25-beta1')).toBe(-1);
    expect(order('v3.25-beta9', 'v3.25-rc1')).toBe(-1);
    expect(order('v3.25', 'v3.25-rc2')).toBe(1);
    expect(order('v3.25-RC1', 'v3.25-rc1')).toBe(0);
    expect(order('v3.25-alpha10', 'v3.25-alpha9')).toBe(1);
    expect(order('v3.25-alpha', 'v3.25-alpha1')).toBe(-1);
    expect(order('v3.25-alpha0', 'v3.25-alpha')).toBe(0);
  });

  it('ranks an unknown suffix below every known stage, naturally among its kind', () => {
    expect(order('v3.25-dev', 'v3.25-prealpha1')).toBe(-1);
    expect(order('v3.25-nightly10', 'v3.25-nightly9')).toBe(1);
    expect(order('v3.25-dev', 'v3.24.9')).toBe(1);
  });

  it('flags a newer patch or pre-release of a supported minor, never an older one', () => {
    const supported = ['3.24', '3.23.5.1'];
    expect(
      newerReleaseTags(
        ['v3.23.6', 'v3.23.5.2', 'v3.23.5.1', 'v3.23.5', 'v3.23.5.2-beta1', 'v3.22.9'],
        supported
      )
    ).toEqual(['v3.23.6', 'v3.23.5.2', 'v3.23.5.2-beta1']);
    expect(newerReleaseTags(['v3.24.1', 'v3.24-beta5', 'v3.24-rc1'], supported)).toEqual([
      'v3.24.1'
    ]);
  });

  it('names a new minor first for the comparison, a patch only when no minor is newer', () => {
    const supported = ['3.24', '3.23.5.1'];
    expect(newerReleaseTags(['v3.23.6', 'v3.25-alpha1', 'v3.24.1'], supported)[0]).toBe(
      'v3.25-alpha1'
    );
    expect(newerReleaseTags(['v3.23.6', 'v3.24.1'], supported)[0]).toBe('v3.24.1');
    expect(newerReleaseTags(['v3.23.6'], supported)[0]).toBe('v3.23.6');
  });

  it('warns once beyond the supported versions and once per supported minor with a newer patch', () => {
    const findings = releaseCheckFindings(
      ['v3.23.6', 'v3.23.5.2', 'v3.25', 'v3.24.1'],
      ['3.24', '3.23.5.1']
    );
    expect(findings.map((finding) => [finding.level, finding.title])).toEqual([
      ['warning', 'WP Rocket v3.25 newer than the supported versions (3.24, 3.23.5.1)'],
      ['warning', 'WP Rocket v3.24.1 newer than the supported 3.24 of the same minor'],
      [
        'warning',
        'WP Rocket v3.23.6, v3.23.5.2 newer than the supported 3.23.5.1 of the same minor'
      ]
    ]);
    expect(findings.every((finding) => finding.details.length === 1)).toBe(true);
  });

  it('warns (never fails) on a newer release, else notes none', () => {
    const [warning] = releaseCheckFindings(['v3.25-alpha\r'], ['3.24', '3.23.5.1']);
    expect(warning?.level).toBe('warning');
    expect(warning?.title).toBe(
      'WP Rocket v3.25-alpha newer than the supported versions (3.24, 3.23.5.1)'
    );
    expect(releaseCheckFindings(['v3.24'], ['3.24', '3.23.5.1'])).toEqual([
      {
        level: 'notice',
        title: 'no WP Rocket release newer than the supported versions (3.24, 3.23.5.1)',
        details: []
      }
    ]);
  });
});
