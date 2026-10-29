/**
 * The forward Delay JS transform against the plugin oracle: every
 * `simulate` row of the committed simulation parity table — produced by
 * the real WP Rocket passes — is reproduced byte for byte, with the
 * header's sentinels as runtime and IE fallback and, for `"list": "bundled"`
 * rows, the shipped data file's list (the real-list arm).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { simulateDelayJs } from './delay-js-forward';
import { SIMULATION_DATA_PATH, readSimulationData } from './simulation-data';
import { parseSimulationTable, type SimulateRow } from './simulation-parity-table';

const HERE = dirname(fileURLToPath(import.meta.url));

const TABLE = parseSimulationTable(
  JSON.parse(readFileSync(join(HERE, 'simulation-parity.fixtures.json'), 'utf8'))
);

const DATA = readSimulationData(
  JSON.parse(readFileSync(join(HERE, '../../public', SIMULATION_DATA_PATH), 'utf8'))
);

/** The data file's list for the table's plugin version (the bundled list). */
function bundledList(): readonly string[] {
  if (!DATA.ok) throw new Error(`simulation data file unreadable: ${DATA.problem}`);
  const version = DATA.data.versions[TABLE.header.plugin];
  const rows =
    version === undefined ? undefined : DATA.data.rowLists[version.delayJsExclusions.sha256];
  if (rows === undefined) throw new Error(`no bundled list for ${TABLE.header.plugin}`);
  return rows;
}

/**
 * The transform's output for a table row.
 *
 * @param row The row.
 */
function simulated(row: SimulateRow): string {
  return simulateDelayJs({
    html: row.html,
    runtime: TABLE.header.simulation.sentinels.runtime,
    ieFallback: TABLE.header.simulation.sentinels.ieFallback,
    listRows: row.list === 'bundled' ? bundledList() : (row.listRows ?? []),
    rows: row.rows
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
  it('covers both list sources', () => {
    expect(TABLE.rows.some((row) => row.list === 'bundled')).toBe(true);
    expect(TABLE.rows.some((row) => row.listRows !== undefined)).toBe(true);
  });

  it('pins the bundled list it reads to the table header', () => {
    expect(bundledList()).toHaveLength(TABLE.header.simulation.delayJsExclusions.count);
  });

  it.each(TABLE.rows.map((row) => [row.id, row] as const))('%s', (_id, row) => {
    // Compared as strings, reported as the first difference (not a megabyte diff).
    const out = simulated(row);
    expect(firstDifference(out, row.served)).toBeNull();
  });
});
