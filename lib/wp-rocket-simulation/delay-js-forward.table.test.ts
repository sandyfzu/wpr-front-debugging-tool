/**
 * The forward Delay JS transform against the plugin oracle: every
 * `simulate` row of the committed simulation parity table — produced by
 * the real WP Rocket passes — is reproduced byte for byte under every
 * supported version (its own outputs where it differs, its rule variants),
 * with the header's sentinels as runtime and IE fallback and, for
 * `"list": "bundled"` rows, the shipped data file's list for that version
 * (the real-list arm).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expectationsFor } from '../exclusion-builder/parity-version-expectations';
import { SUPPORTED_WPR_VERSIONS, type SupportedWprVersion } from '../wp-rocket/versions';
import { simulateDelayJs } from './delay-js-forward';
import { SIMULATION_DATA_PATH, readSimulationData } from './simulation-data';
import { isDelayOnlyRow, parseSimulationTable, type DelayOnlyRow } from './simulation-parity-table';

const HERE = dirname(fileURLToPath(import.meta.url));

const TABLE = parseSimulationTable(
  JSON.parse(readFileSync(join(HERE, 'simulation-parity.fixtures.json'), 'utf8'))
);

/** The Delay JS rows without Defer JS (Defer JS rows have their own suite). */
const DELAY_ROWS = TABLE.rows.filter(isDelayOnlyRow);

const DATA = readSimulationData(
  JSON.parse(readFileSync(join(HERE, '../../public', SIMULATION_DATA_PATH), 'utf8'))
);

/**
 * The data file's bundled list for a version.
 *
 * @param version The version key.
 */
function bundledList(version: string): readonly string[] {
  if (!DATA.ok) throw new Error(`simulation data file unreadable: ${DATA.problem}`);
  const entry = DATA.data.versions[version];
  const rows = entry === undefined ? undefined : DATA.data.rowLists[entry.delayJsExclusions.sha256];
  if (rows === undefined) throw new Error(`no bundled list for ${version}`);
  return rows;
}

/**
 * The transform's output for a table row under one version.
 *
 * @param row The row.
 * @param pin The version.
 */
function simulated(row: DelayOnlyRow, pin: SupportedWprVersion): string {
  return simulateDelayJs({
    html: row.html,
    runtime: TABLE.header.simulation.sentinels.runtime,
    ieFallback: TABLE.header.simulation.sentinels.ieFallback,
    listRows: row.list === 'bundled' ? bundledList(pin.version) : (row.listRows ?? []),
    rows: row.rows,
    metaCharsetMoveText: pin.variants.metaCharsetMoveText
  }).html;
}

/**
 * Where two texts first differ, with a window of each — `null` when equal.
 *
 * @param actual The transform's output.
 * @param expected The plugin's.
 */
function firstDifference(
  actual: string,
  expected: string
): { at: number; actual: string; expected: string } | null {
  if (actual === expected) return null;
  let at = 0;
  while (at < actual.length && actual.charCodeAt(at) === expected.charCodeAt(at)) at++;
  return { at, actual: actual.slice(at, at + 80), expected: expected.slice(at, at + 80) };
}

describe('simulateDelayJs — simulation parity table', () => {
  it('covers both list sources and a row expecting per version', () => {
    expect(DELAY_ROWS.some((row) => row.list === 'bundled')).toBe(true);
    expect(DELAY_ROWS.some((row) => row.listRows !== undefined)).toBe(true);
    expect(DELAY_ROWS.some((row) => row.byVersion !== undefined)).toBe(true);
  });

  it('pins the bundled list it reads to the table header', () => {
    expect(bundledList(TABLE.header.plugin)).toHaveLength(
      TABLE.header.simulation.delayJsExclusions.count
    );
  });
});

describe.each(SUPPORTED_WPR_VERSIONS.map((pin) => [pin.version, pin] as const))(
  'simulateDelayJs — simulation parity table under WP Rocket %s',
  (version, pin) => {
    it.each(DELAY_ROWS.map((row) => [row.id, row] as const))('%s', (_id, row) => {
      // Compared as strings, reported as the first difference (not a megabyte diff).
      const out = simulated(row, pin);
      expect(firstDifference(out, expectationsFor(row, version).served)).toBeNull();
    });
  }
);
