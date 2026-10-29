/**
 * The simulation parity table: its parser accepts a well-formed table and
 * names the offending row or field of every malformed one; the committed
 * table parses, its outputs carry no `wpr_*` comment of their own, its
 * sentinels are recognized by the Delay JS disable step like the real
 * scripts, and the committed data file hashes to the header's pins.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../utils/sha256';
import { delayJsTransform } from '../exclusion-builder/delay-js';
import { EMPTY_EXCLUSION_SET } from '../exclusion-builder/set';
import { SIMULATION_DATA_PATH, readSimulationData } from './simulation-data';
import {
  SIMULATION_HEADER_KEYS,
  parseSimulationHeader,
  parseSimulationInputs,
  parseSimulationTable,
  type SimulationTable
} from './simulation-parity-table';

type Json = Record<string, unknown>;

const HERE = dirname(fileURLToPath(import.meta.url));

/** The committed table, parsed. */
const TABLE: SimulationTable = parseSimulationTable(
  JSON.parse(readFileSync(join(HERE, 'simulation-parity.fixtures.json'), 'utf8'))
);

/** A small valid table: one row per list source. */
function validTable(): { header: Json & { simulation: Json }; rows: Json[] } {
  return {
    header: {
      plugin: '3.0',
      pluginZipSha256: 'aa',
      pluginPackages: { 'a/b': 'v1' },
      plugins: [{ version: '3.0', zipSha256: 'aa', packages: { 'a/b': 'v1' } }],
      wp: '7.0',
      wpZipSha1: 'bb',
      php: '8.1',
      pcre2: '10.49',
      pcreJit: 'on',
      libxml: '2.9',
      generatedBy: 'test',
      simulation: {
        runtime: { path: 'r.js', version: '2.0.5', bytes: 3, sha256: '1'.repeat(64) },
        ieFallback: { bytes: 2, sha256: '2'.repeat(64) },
        dynamicLists: { sha256: '3'.repeat(64) },
        delayJsExclusions: { count: 0, sha256: '4'.repeat(64) },
        deferJsExternalExclusions: { count: 0, sha256: '5'.repeat(64) },
        deferJsInlineExclusions: { count: 0, sha256: '6'.repeat(64) },
        sentinels: { runtime: 'R.run()', ieFallback: 'F' }
      }
    },
    rows: [
      {
        id: 'simulate-a',
        kind: 'simulate',
        feature: 'delay_js',
        note: 'n',
        rows: ['a'],
        listRows: [],
        html: '<p>',
        served: '<p>'
      },
      {
        id: 'simulate-b',
        kind: 'simulate',
        feature: 'delay_js',
        rows: [],
        filterOnly: true,
        list: 'bundled',
        html: '<p>',
        served: '<q>'
      }
    ]
  };
}

/** A row of a table built by {@link validTable}. */
function row(table: ReturnType<typeof validTable>, index: number): Json {
  return table.rows[index] as Json;
}

/** `header.simulation[key]` of a table built by {@link validTable}. */
function pin(table: ReturnType<typeof validTable>, key: string): Json {
  return table.header.simulation[key] as Json;
}

/** Expect the mutated table to fail parsing with a message containing `message`. */
function rejects(mutate: (table: ReturnType<typeof validTable>) => void, message: string): void {
  const table = validTable();
  mutate(table);
  expect(() => parseSimulationTable(table)).toThrow(message);
}

describe('parseSimulationTable', () => {
  it('parses a valid table, keeping only the fields each row sets', () => {
    const table = parseSimulationTable(validTable());
    expect(table.header.simulation.sentinels).toEqual({ runtime: 'R.run()', ieFallback: 'F' });
    expect(table.rows).toEqual([
      {
        id: 'simulate-a',
        kind: 'simulate',
        feature: 'delay_js',
        note: 'n',
        rows: ['a'],
        listRows: [],
        html: '<p>',
        served: '<p>'
      },
      {
        id: 'simulate-b',
        kind: 'simulate',
        feature: 'delay_js',
        rows: [],
        filterOnly: true,
        list: 'bundled',
        html: '<p>',
        served: '<q>'
      }
    ]);
  });

  it('reads inputs without outputs', () => {
    const table = validTable();
    for (const entry of table.rows) delete entry.served;
    expect(parseSimulationInputs(table).map((input) => input.id)).toEqual([
      'simulate-a',
      'simulate-b'
    ]);
  });

  it('rejects malformed table shapes', () => {
    expect(() => parseSimulationTable(null)).toThrow(
      'simulation-parity fixtures: the table must be an object'
    );
    rejects((table) => ((table as Json).extra = 1), 'the table has an unknown key "extra"');
    rejects((table) => ((table as Json).rows = {}), 'expected {"rows": […]}');
    expect(() => parseSimulationInputs({})).toThrow('expected {"rows": […]}');
    rejects((table) => (table.rows[0] = 'x' as unknown as Json), 'row #0 must be an object');
  });

  it('rejects malformed header fields, naming this table', () => {
    rejects((table) => delete (table as Json).header, '"header" must be an object');
    rejects((table) => (table.header.extra = 1), '"header" has an unknown key "extra"');
    rejects(
      (table) => delete table.header.php,
      'simulation-parity fixtures: "php" must be a string'
    );
    rejects((table) => (table.header.wp = ''), 'header "wp" must not be empty');
    rejects((table) => (table.header.pluginPackages = {}), 'header "pluginPackages" must be');
  });

  it('rejects malformed simulation pins', () => {
    rejects(
      (table) => Reflect.deleteProperty(table.header, 'simulation'),
      'header.simulation must be an object'
    );
    rejects(
      (table) => (table.header.simulation.extra = 1),
      'header.simulation has an unknown key "extra"'
    );
    rejects((table) => delete pin(table, 'runtime').path, '"path" must be a string');
    rejects(
      (table) => (pin(table, 'runtime').path = ''),
      'header.simulation.runtime path and version must not be empty'
    );
    rejects(
      (table) => (pin(table, 'runtime').version = ''),
      'header.simulation.runtime path and version must not be empty'
    );
    rejects(
      (table) => (pin(table, 'runtime').bytes = -1),
      'header.simulation.runtime.bytes must be a non-negative integer'
    );
    rejects(
      (table) => (pin(table, 'ieFallback').bytes = 1.5),
      'header.simulation.ieFallback.bytes must be a non-negative integer'
    );
    rejects(
      (table) => (pin(table, 'dynamicLists').sha256 = 'x'),
      'header.simulation.dynamicLists.sha256 must be 64 lowercase hex digits'
    );
    rejects(
      (table) => (pin(table, 'delayJsExclusions').count = '0'),
      'header.simulation.delayJsExclusions.count must be a non-negative integer'
    );
    rejects(
      (table) => (pin(table, 'delayJsExclusions').sha256 = 'F'.repeat(64)),
      'delayJsExclusions.sha256 must be 64 lowercase hex digits'
    );
    rejects(
      (table) => (pin(table, 'runtime').extra = 1),
      'header.simulation.runtime has an unknown key "extra"'
    );
  });

  it('rejects sentinels the plugin would rewrite or that end their script', () => {
    const sentinels = (table: ReturnType<typeof validTable>): Json => pin(table, 'sentinels');
    rejects(
      (table) => (sentinels(table).runtime = 'a$0'),
      'header.simulation.sentinels.runtime must not contain "$" or "\\"'
    );
    rejects(
      (table) => (sentinels(table).ieFallback = 'a\\1'),
      'header.simulation.sentinels.ieFallback must not contain "$" or "\\"'
    );
    rejects(
      (table) => (sentinels(table).runtime = 'x</SCRIPT>'),
      'sentinels.runtime must not contain "</script"'
    );
    rejects(
      (table) => (sentinels(table).ieFallback = ''),
      'sentinels.ieFallback must not be empty'
    );
    rejects((table) => delete sentinels(table).runtime, '"runtime" must be a string');
    rejects((table) => (sentinels(table).extra = 'x'), 'sentinels has an unknown key "extra"');
  });

  it('rejects malformed rows, naming them', () => {
    rejects((table) => (row(table, 0).id = 'match-a'), 'ids are simulate-…');
    rejects((table) => (row(table, 0).id = 1), '"id" must be a string');
    rejects((table) => (row(table, 1).id = 'simulate-a'), 'row "simulate-a": duplicate id');
    rejects((table) => (row(table, 0).extra = 1), 'the row has an unknown key "extra"');
    rejects((table) => (row(table, 0).kind = 'match'), '"kind" must be "simulate"');
    rejects((table) => (row(table, 0).feature = 'lazyload'), '"feature" must be one of delay_js');
    rejects((table) => (row(table, 0).note = ''), '"note" must be a non-empty string');
    rejects((table) => (row(table, 0).note = 1), '"note" must be a non-empty string');
    rejects((table) => (row(table, 0).rows = 'a'), '"rows" must be an array of strings');
    rejects((table) => (row(table, 0).rows = [1]), '"rows" must be an array of strings');
    rejects((table) => (row(table, 0).filterOnly = false), '"filterOnly" is either true or absent');
    rejects((table) => (row(table, 0).listRows = [1]), '"listRows" must be an array of strings');
    rejects((table) => (row(table, 1).list = 'latest'), '"list" is either "bundled" or absent');
    rejects(
      (table) => (row(table, 0).list = 'bundled'),
      'exactly one of "listRows" and "list" is required'
    );
    rejects(
      (table) => delete row(table, 1).list,
      'exactly one of "listRows" and "list" is required'
    );
    for (const value of [true, false, 'bundled']) {
      rejects((table) => (row(table, 1).defer = value), '"defer" must be an object');
    }
    rejects(
      (table) => (row(table, 1).defer = { rows: [], lists: 'latest' }),
      '"defer.lists" must be an object'
    );
    rejects(
      (table) => (row(table, 1).defer = { rows: [], lists: { external: [] } }),
      '"inline" must be an array of strings'
    );
    rejects(
      (table) => (row(table, 1).defer = { rows: [], lists: 'bundled', extra: 1 }),
      'unknown key'
    );
    rejects(
      (table) => (row(table, 1).defer = { rows: [], filterOnly: false, lists: 'bundled' }),
      '"filterOnly" is either true or absent'
    );
    // A Defer JS row carries `defer` and none of the Delay JS inputs.
    rejects(
      (table) => (row(table, 1).feature = 'defer_all_js'),
      'a Defer JS row has no Delay JS input ("rows")'
    );
    rejects((table) => {
      const entry = row(table, 1);
      entry.feature = 'defer_all_js';
      for (const key of ['rows', 'filterOnly', 'list']) Reflect.deleteProperty(entry, key);
    }, 'a Defer JS row needs "defer"');
    rejects((table) => (row(table, 0).html = ''), '"html" must not be empty');
    rejects((table) => delete row(table, 0).html, '"html" must be a string');
    rejects((table) => delete row(table, 0).served, 'row "simulate-a": "served" must be a string');
    rejects((table) => (row(table, 1).served = ''), 'row "simulate-b": "served" must not be empty');
  });

  it("reads a row's version-keyed served page and a Defer JS row", () => {
    const table = validTable();
    row(table, 1).byVersion = { '3.23.5.1': { served: '<r>' } };
    table.rows.push({
      id: 'simulate-c',
      kind: 'simulate',
      feature: 'defer_all_js',
      defer: { rows: ['x'], filterOnly: true, lists: { external: ['e'], inline: ['i'] } },
      html: '<p>',
      served: '<p>'
    });
    const parsed = parseSimulationTable(table);
    expect(parsed.rows[1]?.byVersion).toEqual({ '3.23.5.1': { served: '<r>' } });
    expect(parsed.rows[2]).toEqual(table.rows[2]);
    rejects(
      (t) => (row(t, 1).byVersion = { '3.23.5.1': { served: '' } }),
      '"byVersion" served must be a non-empty string'
    );
    // `served` is required: a version cannot lack it (null = absent).
    rejects(
      (t) => (row(t, 1).byVersion = { '3.23.5.1': { served: null } }),
      '"byVersion" served must be a non-empty string'
    );
    rejects(
      (t) => (row(t, 1).byVersion = { '3.23.5.1': { html: '<r>' } }),
      'has "html", which is not an output of this row'
    );
  });

  it('parses a header on its own', () => {
    expect(Object.keys(parseSimulationHeader(validTable().header))).toEqual(SIMULATION_HEADER_KEYS);
  });
});

describe('the committed simulation table', () => {
  const { sentinels } = TABLE.header.simulation;

  it('has a served page for every row and exactly one list source per Delay JS row', () => {
    expect(TABLE.rows.length).toBeGreaterThan(0);
    for (const entry of TABLE.rows) {
      expect(entry.served, entry.id).not.toBe('');
      if (entry.feature === 'defer_all_js') {
        // Defer JS alone: its lists live in `defer`, and no Delay JS list source.
        expect(entry.defer, entry.id).toBeDefined();
        expect(entry.listRows ?? entry.list ?? entry.rows, entry.id).toBeUndefined();
      } else {
        expect((entry.listRows === undefined) !== (entry.list === undefined), entry.id).toBe(true);
      }
    }
  });

  it('never adds a wpr_* comment its input lacks (none for Delay JS at all)', () => {
    const comments = (html: string): string[] => html.match(/<!-- wpr_[a-z_]+ -->/g) ?? [];
    for (const entry of TABLE.rows) {
      expect(comments(entry.served), entry.id).toEqual(comments(entry.html));
      expect(entry.served, entry.id).not.toContain('wpr_delay_js');
    }
  });

  it('injects the sentinels where WP Rocket injects its runtime: fallback first, then runtime', () => {
    const injected = `<script>${sentinels.ieFallback}</script><script>${sentinels.runtime}</script>`;
    const withHead = TABLE.rows.filter((entry) => /<head[^>]*>/i.test(entry.html));
    expect(withHead.length).toBeGreaterThan(0);
    for (const entry of withHead) {
      // Defer JS alone injects no runtime at all.
      if (entry.feature === 'defer_all_js') {
        expect(entry.served, entry.id).not.toContain(sentinels.runtime);
        expect(entry.served, entry.id).not.toContain(sentinels.ieFallback);
      } else {
        expect(entry.served, entry.id).toContain(injected);
      }
    }
  });

  it('has sentinels the Delay JS disable step removes like the real scripts', () => {
    const disable = {
      ...EMPTY_EXCLUSION_SET,
      disable: { ...EMPTY_EXCLUSION_SET.disable, delayJs: true }
    };
    for (const id of ['simulate-delay-type-text-javascript', 'simulate-delay-docker-off']) {
      const served = TABLE.rows.find((entry) => entry.id === id)?.served ?? '';
      const { html } = delayJsTransform(served, disable);
      expect(served, id).toContain(sentinels.runtime);
      expect(html, id).not.toContain(sentinels.runtime);
      expect(html, id).not.toContain(sentinels.ieFallback);
      expect(html, id).not.toContain('rocketlazyloadscript');
    }
  });
});

describe('the committed data file', () => {
  const read = readSimulationData(
    JSON.parse(readFileSync(join(HERE, '../../public', SIMULATION_DATA_PATH), 'utf8'))
  );
  if (!read.ok) throw new Error(read.problem);
  const { data } = read;
  const pins = TABLE.header.simulation;

  it('keys every text and row list by its own sha256', () => {
    for (const [key, text] of Object.entries(data.texts)) expect(sha256Hex(text)).toBe(key);
    for (const [key, rows] of Object.entries(data.rowLists)) {
      expect(sha256Hex(JSON.stringify(rows))).toBe(key);
    }
  });

  it("holds the table reference version's runtime, fallback and list, as pinned", () => {
    const entry = data.versions[TABLE.header.plugin];
    expect(entry).toEqual({
      runtime: { sha256: pins.runtime.sha256, version: pins.runtime.version },
      ieFallback: { sha256: pins.ieFallback.sha256 },
      delayJsExclusions: pins.delayJsExclusions,
      deferJsExternalExclusions: pins.deferJsExternalExclusions,
      deferJsInlineExclusions: pins.deferJsInlineExclusions
    });
    const bytes = (key: string): number => new TextEncoder().encode(data.texts[key]).byteLength;
    expect(bytes(pins.runtime.sha256)).toBe(pins.runtime.bytes);
    expect(bytes(pins.ieFallback.sha256)).toBe(pins.ieFallback.bytes);
  });
});
