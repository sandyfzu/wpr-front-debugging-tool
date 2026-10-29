/**
 * O1 for Defer JS: the forward transforms reproduce every Defer JS row of
 * the plugin-derived simulation table byte for byte, under each supported
 * WP Rocket version (its own lists and quoting, its own expectations) —
 * Defer JS alone, and Defer JS then Delay JS in one buffer.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expectationsFor } from '../exclusion-builder/parity-version-expectations';
import { SUPPORTED_WPR_VERSIONS, type SupportedWprVersion } from '../wp-rocket/versions';
import { simulateDeferJs, type DeferJsPassInput } from './defer-js-forward';
import { simulateDelayJs } from './delay-js-forward';
import { SIMULATION_DATA_PATH, readSimulationData } from './simulation-data';
import { parseSimulationTable, type SimulateRow } from './simulation-parity-table';

const HERE = dirname(fileURLToPath(import.meta.url));

const TABLE = parseSimulationTable(
  JSON.parse(readFileSync(join(HERE, 'simulation-parity.fixtures.json'), 'utf8'))
);

const DATA = (() => {
  const read = readSimulationData(
    JSON.parse(readFileSync(join(HERE, '../../public', SIMULATION_DATA_PATH), 'utf8'))
  );
  if (!read.ok) throw new Error(read.problem);
  return read.data;
})();

/** The Defer JS-only rows (rows with LazyLoad also on belong to the LazyLoad suites). */
const DEFER_ROWS = TABLE.rows.filter(
  (row) => row.feature === 'defer_all_js' && row.lazyload === undefined
);

/** The Delay JS rows with Defer JS (and not LazyLoad) on in the same buffer. */
const COMPOSED_ROWS = TABLE.rows.filter(
  (row) => row.feature === 'delay_js' && row.defer !== undefined && row.lazyload === undefined
);

/**
 * A row list of the packaged data file.
 *
 * @param key Its content key.
 */
function dataRows(key: string): readonly string[] {
  const list = DATA.rowLists[key];
  if (list === undefined) throw new Error(`no row list ${key}`);
  return list;
}

/**
 * A version's packaged entry.
 *
 * @param version A supported version.
 */
function entryOf(version: string): NonNullable<(typeof DATA.versions)[string]> {
  const entry = DATA.versions[version];
  if (entry === undefined) throw new Error(`no data for ${version}`);
  return entry;
}

/**
 * A row's Defer JS inputs under one version (`bundled` = its packaged lists).
 *
 * @param row The row (holds `defer`).
 * @param pin The version.
 */
function deferInput(row: SimulateRow, pin: SupportedWprVersion): DeferJsPassInput {
  const defer = row.defer;
  if (defer === undefined) throw new Error(`${row.id} holds no defer`);
  const entry = entryOf(pin.version);
  return {
    rows: defer.rows,
    lists:
      defer.lists === 'bundled'
        ? {
            external: dataRows(entry.deferJsExternalExclusions.sha256),
            inline: dataRows(entry.deferJsInlineExclusions.sha256)
          }
        : defer.lists,
    inlineQuoteDelimiter: pin.variants.deferInlineQuoteDelimiter
  };
}

/** The first differing offset with a little context, or null when equal. */
function firstDifference(actual: string, expected: string): string | null {
  if (actual === expected) return null;
  let at = 0;
  while (at < actual.length && actual[at] === expected[at]) at++;
  return `at ${String(at)}: got ${JSON.stringify(actual.slice(at - 20, at + 60))}, want ${JSON.stringify(expected.slice(at - 20, at + 60))}`;
}

describe.each(SUPPORTED_WPR_VERSIONS.map((pin) => [pin.version, pin] as const))(
  'Defer JS simulation parity under WP Rocket %s',
  (version, pin) => {
    it('covers Defer JS alone and with Delay JS, one row expecting per version', () => {
      expect(DEFER_ROWS.length).toBeGreaterThanOrEqual(15);
      expect(COMPOSED_ROWS.length).toBeGreaterThanOrEqual(2);
      expect(TABLE.rows.some((row) => row.byVersion !== undefined)).toBe(true);
    });

    it.each(DEFER_ROWS.map((row) => [row.id, row] as const))('%s', (_id, row) => {
      const out = simulateDeferJs({ html: row.html, ...deferInput(row, pin) });
      expect(firstDifference(out.html, expectationsFor(row, version).served)).toBeNull();
    });

    it.each(COMPOSED_ROWS.map((row) => [row.id, row] as const))('%s', (_id, row) => {
      const { sentinels } = TABLE.header.simulation;
      const out = simulateDelayJs({
        html: row.html,
        runtime: sentinels.runtime,
        ieFallback: sentinels.ieFallback,
        listRows:
          row.list === 'bundled'
            ? dataRows(entryOf(version).delayJsExclusions.sha256)
            : (row.listRows ?? []),
        rows: row.rows ?? [],
        defer: deferInput(row, pin)
      });
      // The local site's page is served with Defer JS on already: identity for that pass.
      expect(out.report.defer?.state).toBe(
        row.html.includes('data-rocket-defer') ? 'already-served' : 'simulated'
      );
      expect(firstDifference(out.html, expectationsFor(row, version).served)).toBeNull();
    });
  }
);
