import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pregQuote, unescapedDelimiterAt } from '../exclusion-builder/php/preg-quote';
import { parseHeaderFields } from '../exclusion-builder/wp-rocket-parity-table';
import { SIMULATION_DATA_PATH, readSimulationData } from '../wp-rocket-simulation/simulation-data';
import { WPR_VERSION_NUMBER_SOURCE } from './constants';
import {
  SUPPORTED_WPR_VERSIONS,
  latestStableWprVersion,
  supportedWprVersion,
  type SupportedWprVersion
} from './versions';

/** A registry row for the error-path tests. */
function row(version: string, role: SupportedWprVersion['role']): SupportedWprVersion {
  return { version, zipSha256: '0'.repeat(64), role, variants: { deferInlineQuoteDelimiter: '/' } };
}

describe('SUPPORTED_WPR_VERSIONS', () => {
  it('pins 3.24 (latest stable) and 3.23.5.1 (previous minor) to their zips, newest first', () => {
    expect(
      SUPPORTED_WPR_VERSIONS.map(({ version, zipSha256, role }) => ({ version, zipSha256, role }))
    ).toEqual([
      {
        version: '3.24',
        zipSha256: '1a2480ba830ede3270e5527edb93663e42618c6c900165dcb5cf100569385155',
        role: 'latest-stable'
      },
      {
        version: '3.23.5.1',
        zipSha256: 'e42f4b1ac3bfb32690dc616a36f35cb579262931ab9758e942bbd0aefe870e31',
        role: 'previous-minor'
      }
    ]);
  });

  it('holds unique versions in the wire grammar and sha256 zip pins', () => {
    const versions = SUPPORTED_WPR_VERSIONS.map((entry) => entry.version);
    expect(new Set(versions).size).toBe(versions.length);
    const grammar = new RegExp(`^${WPR_VERSION_NUMBER_SOURCE}$`);
    for (const entry of SUPPORTED_WPR_VERSIONS) {
      expect(entry.version).toMatch(grammar);
      expect(entry.zipSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('supportedWprVersion', () => {
  it('finds a row by its exact version string only', () => {
    expect(supportedWprVersion('3.23.5.1')?.role).toBe('previous-minor');
    expect(supportedWprVersion('3.24')?.role).toBe('latest-stable');
    expect(supportedWprVersion('3.24.0')).toBeUndefined();
    expect(supportedWprVersion('3.23.5')).toBeUndefined();
  });
});

describe('latestStableWprVersion', () => {
  it('is the 3.24 row', () => {
    expect(latestStableWprVersion().version).toBe('3.24');
  });

  it('throws unless exactly one row is latest-stable', () => {
    const message = 'must hold exactly one latest-stable row';
    expect(() => latestStableWprVersion([])).toThrow(`${message}, found 0`);
    expect(() => latestStableWprVersion([row('1.0', 'previous-minor')])).toThrow(message);
    expect(() =>
      latestStableWprVersion([row('1.0', 'latest-stable'), row('1.1', 'latest-stable')])
    ).toThrow(`${message}, found 2`);
  });
});

describe('the Defer JS inline-list quote variant', () => {
  /**
   * What WP Rocket's inline-exclusion pattern `/(…)/msi` does on a script
   * body under a version's delimiter (effects verified with PHP 8.1 on the
   * same rows): `null` = the pattern fails to compile, nothing excluded.
   */
  function inlineListMatches(version: string, rows: string[], body: string): boolean | null {
    const delimiter = supportedWprVersion(version)?.variants.deferInlineQuoteDelimiter;
    if (delimiter === undefined) throw new Error(`no row ${version}`);
    const alternation = rows.map((entry) => pregQuote(entry, delimiter)).join('|');
    if (unescapedDelimiterAt(`(${alternation})`, '/') !== -1) return null;
    return new RegExp(`(${alternation})`, 'msi').test(body);
  }

  it("declares '#' for 3.23.5.1 and '/' for 3.24", () => {
    expect(supportedWprVersion('3.23.5.1')?.variants).toEqual({ deferInlineQuoteDelimiter: '#' });
    expect(supportedWprVersion('3.24')?.variants).toEqual({ deferInlineQuoteDelimiter: '/' });
  });

  it('a row holding `/`: 3.23.5.1 excludes nothing by list, 3.24 matches it', () => {
    const body = 'var x = "a/b"; c#d';
    expect(inlineListMatches('3.23.5.1', ['a/b', 'c#d'], body)).toBeNull();
    expect(inlineListMatches('3.24', ['a/b', 'c#d'], body)).toBe(true);
  });

  it('`#` is quoted by both versions', () => {
    for (const version of ['3.23.5.1', '3.24']) {
      expect(inlineListMatches(version, ['c#d'], 'x c#d')).toBe(true);
      expect(inlineListMatches(version, ['c#d'], 'x c d')).toBe(false);
    }
  });
});

describe('the registry against the committed parity files', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  /** A committed JSON file of the repo. */
  const committed = (path: string): unknown =>
    JSON.parse(readFileSync(join(root, path), 'utf8')) as unknown;
  const pins = SUPPORTED_WPR_VERSIONS.map(({ version, zipSha256 }) => ({ version, zipSha256 }));

  it.each([
    ['exclusion parity', 'lib/exclusion-builder/wp-rocket-parity.fixtures.json'],
    ['simulation parity', 'lib/wp-rocket-simulation/simulation-parity.fixtures.json']
  ])(
    'the %s table is derived under every supported version, the latest stable as reference',
    (_, path) => {
      const header = parseHeaderFields(
        (committed(path) as { header: Record<string, unknown> }).header
      );
      expect(header.plugins.map(({ version, zipSha256 }) => ({ version, zipSha256 }))).toEqual(
        pins
      );
      expect(header.plugin).toBe(latestStableWprVersion().version);
    }
  );

  it('the data file holds exactly the supported versions, all sharing one runtime text today', () => {
    const read = readSimulationData(committed(`public/${SIMULATION_DATA_PATH}`));
    if (!read.ok) throw new Error(read.problem);
    const { versions } = read.data;
    expect(Object.keys(versions)).toEqual(SUPPORTED_WPR_VERSIONS.map((entry) => entry.version));
    const runtimes = new Set(Object.values(versions).map((entry) => entry.runtime.sha256));
    expect(runtimes.size).toBe(1);
  });
});
