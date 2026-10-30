/**
 * The parity script's pure helpers: CLI options, preflight probes, package
 * versions, harness case building, the form-survival rule for match rows, row
 * assembly in file key order, the staleness report, the `--ci` and
 * `--compare` verdicts and their GitHub Actions output, and the simulation
 * table's cases, rows, pins, data file and verdicts. The PHP run itself is
 * exercised by `pnpm parity:wp-rocket` and the WP Rocket parity workflow.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ParityInput } from '../lib/exclusion-builder/wp-rocket-parity-table.ts';
import type { SimulateInput } from '../lib/wp-rocket-simulation/simulation-parity-table.ts';
import {
  PHP_EXTENSIONS,
  SIMULATION_DATA_FILE,
  SIMULATION_TABLE,
  annotation,
  assembleRow,
  assembleSimulateRow,
  committedSentinels,
  addRuntimeFiles,
  dataFindings,
  packagedRuntimeFile,
  runtimeFileFindings,
  DEFAULT_LAZYLOAD_ASSETS_URL,
  lazyloadArtifacts,
  sameLazyloadTexts,
  simulationRuns,
  simulationSurvivalSources,
  splitLazyloadFooter,
  pinFindings,
  simulationArtifacts,
  simulationCases,
  checkPhpProbe,
  checkSurvival,
  ciFindings,
  compareFindings,
  describeStaleness,
  SHOWN_VALUE_MAX,
  differenceLine,
  differingRowIds,
  extensionArgs,
  firstDifference,
  longestBacktickRun,
  otherVersionFindings,
  phpCommand,
  shownValue,
  formatTable,
  headerDifferences,
  matchCases,
  packageDifferences,
  parseArgs,
  parsePhpProbe,
  readPackageVersions,
  readPluginVersion,
  rowDifferences,
  sameVersionFindings,
  saveCases,
  summaryMarkdown,
  type TableObject
} from './wp-rocket-parity.ts';

/** Inputs covering each case-building branch. */
const INPUTS: ParityInput[] = [
  {
    id: 'save-a',
    kind: 'save',
    feature: 'delay_js',
    typed: ['a', { b64: '/w==' }],
    safeMode: true
  },
  { id: 'save-b', kind: 'save', feature: 'lazyload', typed: ['b'] },
  { id: 'match-a', kind: 'match', feature: 'delay_js', from: 'save-a', html: 'h' },
  {
    id: 'match-b',
    kind: 'match',
    feature: 'defer_all_js',
    rows: ['x'],
    note: 'n',
    engine: { problem: 'match-all' },
    html: 'h'
  },
  { id: 'match-c', kind: 'match', feature: 'lazyload', rows: [' y'], filterOnly: true, html: 'h' },
  { id: 'match-d', kind: 'match', feature: 'automatic_lazy_rendering', rows: [''], html: 'h' }
];

describe('parseArgs', () => {
  it('defaults to check and reads one mode flag plus an optional --zip', () => {
    expect(parseArgs([])).toEqual({ mode: 'check' });
    expect(parseArgs(['--write'])).toEqual({ mode: 'write' });
    expect(parseArgs(['--ci'])).toEqual({ mode: 'ci' });
    expect(parseArgs(['--zip', 'a.zip', '--compare'])).toEqual({ mode: 'compare', zip: 'a.zip' });
    expect(parseArgs(['--zip', 'a.zip'])).toEqual({ mode: 'check', zip: 'a.zip' });
  });

  it('rejects unknown arguments, two modes and a missing or repeated --zip path', () => {
    expect(() => parseArgs(['--force'])).toThrow('unknown arguments: --force');
    expect(() => parseArgs(['a.zip'])).toThrow('unknown arguments: a.zip');
    expect(() => parseArgs(['--write', '--write'])).toThrow('one mode only');
    expect(() => parseArgs(['--ci', '--compare'])).toThrow('one mode only');
    expect(() => parseArgs(['--zip'])).toThrow('--zip needs exactly one path');
    expect(() => parseArgs(['--zip', ''])).toThrow('--zip needs exactly one path');
    expect(() => parseArgs(['--zip', '--ci'])).toThrow('--zip needs exactly one path');
    expect(() => parseArgs(['--zip', 'a', '--zip', 'b'])).toThrow('--zip needs exactly one path');
  });
});

describe('PHP probe', () => {
  it('parses the version and the loaded required extensions', () => {
    expect(parsePhpProbe('8.1.34\ndom,mbstring\n')).toEqual({
      version: '8.1.34',
      loaded: ['dom', 'mbstring']
    });
    expect(parsePhpProbe('8.1.34\n')).toEqual({ version: '8.1.34', loaded: [] });
    expect(parsePhpProbe('')).toEqual({ version: '', loaded: [] });
  });

  it('loads exactly the missing extensions as shared modules', () => {
    expect(extensionArgs({ version: '8.1', loaded: ['dom', 'mbstring'] })).toEqual([]);
    expect(extensionArgs({ version: '8.1', loaded: ['mbstring'] })).toEqual([
      '-d',
      'extension=dom'
    ]);
    expect(extensionArgs({ version: '8.1', loaded: [] })).toEqual([
      '-d',
      'extension=dom',
      '-d',
      'extension=mbstring'
    ]);
    expect(PHP_EXTENSIONS).toEqual(['dom', 'mbstring']);
  });

  it('returns the version of a PHP >= 8.1 with every required extension', () => {
    expect(checkPhpProbe({ version: '8.1.34', loaded: ['dom', 'mbstring'] })).toBe('8.1.34');
    expect(checkPhpProbe({ version: '9.0.0', loaded: ['mbstring', 'dom'] })).toBe('9.0.0');
  });

  it('fails fast on an old PHP or a missing extension, naming it', () => {
    const all = ['dom', 'mbstring'];
    expect(() => checkPhpProbe({ version: '8.0.30', loaded: all })).toThrow(
      'PHP 8.0.30 found; the harness needs PHP >= 8.1'
    );
    expect(() => checkPhpProbe({ version: '7.4.1', loaded: all })).toThrow('needs PHP >= 8.1');
    expect(() => checkPhpProbe({ version: '', loaded: all })).toThrow('PHP ? found');
    expect(() => checkPhpProbe({ version: '8.4.1', loaded: ['dom'] })).toThrow(
      'PHP 8.4.1 has no mbstring under `php -n`'
    );
    expect(() => checkPhpProbe({ version: '8.4.1', loaded: [] })).toThrow('has no dom, mbstring');
  });
});

describe('readPackageVersions', () => {
  const lock = JSON.stringify({
    packages: [{ name: 'a/run', version: 'v1.2' }, { name: 'broken' }, null],
    'packages-dev': [{ name: 'a/dev', version: '3.0.22' }]
  });

  it('reads runtime and dev packages, keys sorted', () => {
    const versions = readPackageVersions(lock, ['a/run', 'a/dev']);
    expect(versions).toEqual({ 'a/dev': '3.0.22', 'a/run': 'v1.2' });
    expect(Object.keys(versions)).toEqual(['a/dev', 'a/run']);
  });

  it('fails fast on a missing package or a malformed lock', () => {
    expect(() => readPackageVersions(lock, ['broken'])).toThrow(
      'composer.lock lists no "broken", yet its vendor/ code ran'
    );
    expect(() => readPackageVersions('{', ['a/run'])).toThrow('composer.lock is not valid JSON');
    expect(() => readPackageVersions('null', ['a/run'])).toThrow('lists no "a/run"');
    expect(readPackageVersions('{"packages": 1}', [])).toEqual({});
  });
});

describe('readPluginVersion', () => {
  it('reads the Version header line', () => {
    expect(readPluginVersion('<?php\n/**\n * Plugin Name: X\n * Version: 3.23.5.1\n */')).toBe(
      '3.23.5.1'
    );
  });

  it('fails without one', () => {
    expect(() => readPluginVersion('<?php // nothing')).toThrow('no "Version:" header line');
  });
});

describe('saveCases', () => {
  it('sends every save row, plus a survival case per authored Delay/Defer/Lazyload match row set', () => {
    expect(saveCases(INPUTS)).toEqual([
      { id: 'save-a', kind: 'save', feature: 'delay_js', typed: ['YQ==', '/w=='], safeMode: true },
      { id: 'save-b', kind: 'save', feature: 'lazyload', typed: ['Yg=='], safeMode: false },
      {
        id: 'survival:match-b',
        kind: 'save',
        feature: 'defer_all_js',
        typed: ['eA=='],
        safeMode: false
      },
      {
        id: 'survival:match-c',
        kind: 'save',
        feature: 'lazyload',
        typed: ['IHk='],
        safeMode: false
      }
    ]);
  });
});

describe('checkSurvival', () => {
  it('accepts authored rows stored unchanged and filterOnly rows the form changes', () => {
    expect(() => {
      checkSurvival(INPUTS, [
        { id: 'save-a', stored: [], dropped: [] },
        { id: 'survival:match-b', stored: ['x'], dropped: [] },
        { id: 'survival:match-c', stored: ['y'], dropped: [] }
      ]);
    }).not.toThrow();
  });

  it('names every row whose flag contradicts the form', () => {
    expect(() => {
      checkSurvival(INPUTS, [
        { id: 'survival:match-b', stored: [], dropped: [{ index: 0, reason: 'invalid-pattern' }] },
        { id: 'survival:match-c', stored: [' y'], dropped: [] }
      ]);
    }).toThrow(
      'match rows vs the settings form:\n  match-b: the settings form stores [] — write the stored form or mark the row filterOnly\n  match-c: marked filterOnly, but the settings form stores these rows unchanged'
    );
  });
});

describe('matchCases', () => {
  it('resolves from rows to the stored rows and base64-encodes every row', () => {
    const cases = matchCases(INPUTS, new Map([['save-a', ['a']]]));
    expect(cases.map((matchCase) => [matchCase.id, matchCase.rows])).toEqual([
      ['match-a', ['YQ==']],
      ['match-b', ['eA==']],
      ['match-c', ['IHk=']],
      ['match-d', ['']]
    ]);
    expect(cases[0]).toMatchObject({ kind: 'match', feature: 'delay_js', html: 'h' });
  });

  it('passes throughDelayJs on to the harness only when set', () => {
    const input: ParityInput = {
      id: 'match-e',
      kind: 'match',
      feature: 'defer_all_js',
      rows: [],
      throughDelayJs: true,
      html: 'h'
    };
    const [withDelay, plain] = matchCases([input, INPUTS[3] as ParityInput], new Map());
    expect(withDelay).toEqual({
      id: 'match-e',
      kind: 'match',
      feature: 'defer_all_js',
      rows: [],
      throughDelayJs: true,
      html: 'h'
    });
    expect(plain).not.toHaveProperty('throughDelayJs');
  });

  it('passes deferRows on to the harness base64-encoded, only when set', () => {
    const input: ParityInput = {
      id: 'match-f',
      kind: 'match',
      feature: 'delay_js',
      rows: [],
      deferRows: ['jquery', 'x'],
      html: 'h'
    };
    const [withDefer, plain] = matchCases([input, INPUTS[3] as ParityInput], new Map());
    expect(withDefer).toMatchObject({ deferRows: ['anF1ZXJ5', 'eA=='] });
    expect(plain).not.toHaveProperty('deferRows');
  });

  it('fails when a from row has no stored result', () => {
    expect(() => matchCases(INPUTS, new Map())).toThrow('match-a: no stored rows for "save-a"');
  });
});

describe('assembleRow', () => {
  it('orders a save row: inputs, then stored + dropped with the typed line copied', () => {
    const assembled = assembleRow(INPUTS[0] as ParityInput, {
      id: 'save-a',
      stored: ['a'],
      dropped: [{ index: 1, reason: 'empty' }]
    });
    expect(Object.keys(assembled)).toEqual([
      'id',
      'kind',
      'feature',
      'typed',
      'safeMode',
      'stored',
      'dropped'
    ]);
    expect(assembled.dropped).toEqual([{ index: 1, row: { b64: '/w==' }, reason: 'empty' }]);
  });

  it('orders a match row: inputs (rows in their slot even when derived), then outputs', () => {
    const fromRow = assembleRow(INPUTS[2] as ParityInput, {
      id: 'match-a',
      rows: ['a'],
      served: 's',
      candidates: ['x'],
      excluded: []
    });
    expect(Object.keys(fromRow)).toEqual([
      'id',
      'kind',
      'feature',
      'from',
      'rows',
      'html',
      'served',
      'candidates',
      'excluded'
    ]);
    expect(fromRow.rows).toEqual(['a']);
    const deferRow = assembleRow(INPUTS[3] as ParityInput, {
      id: 'match-b',
      inlineWrapped: [],
      featureOff: false,
      excluded: [],
      candidates: [],
      subjects: [],
      served: 's'
    });
    expect(Object.keys(deferRow)).toEqual([
      'id',
      'kind',
      'feature',
      'rows',
      'note',
      'engine',
      'html',
      'served',
      'subjects',
      'candidates',
      'excluded',
      'featureOff',
      'inlineWrapped'
    ]);
  });
});

describe('describeStaleness', () => {
  const fresh = JSON.stringify({
    header: { php: '8.1' },
    rows: [{ id: 'save-a', stored: ['a'] }, { id: 'save-b' }]
  });

  it('is empty for identical text', () => {
    expect(describeStaleness(fresh, fresh)).toEqual([]);
  });

  it('names header fields, changed fields, missing and extra rows', () => {
    const committed = JSON.stringify({
      header: { php: '8.0' },
      rows: [{ id: 'save-a', stored: ['b'], extra: 1 }, { id: 'save-z' }]
    });
    expect(describeStaleness(committed, fresh)).toEqual([
      'header.php: "8.0" → "8.1"',
      'save-a.stored: ["b"] → ["a"]',
      'save-a.extra: 1 → absent',
      'save-b: missing from the committed table',
      'save-z: not derivable from the inputs'
    ]);
  });

  it('reports formatting-only and unparsable differences', () => {
    expect(describeStaleness(`${fresh}\n`, fresh)).toEqual([
      'formatting differs (run with --write)'
    ]);
    expect(describeStaleness('{', fresh)).toEqual(['the committed table is not valid JSON']);
    expect(describeStaleness('{}', JSON.stringify({ header: {}, rows: [] }))).toEqual([
      'formatting differs (run with --write)'
    ]);
  });
});

describe('formatTable', () => {
  it('formats with the repo Prettier config (JSON, two-space indent, trailing newline)', async () => {
    const text = await formatTable({ header: { a: 1 }, rows: [] });
    expect(text).toBe('{ "header": { "a": 1 }, "rows": [] }\n');
  });
});

describe('difference helpers', () => {
  it('compares header fields by JSON value, absent spelled out', () => {
    expect(
      headerDifferences(
        { a: '1', p: { x: 'v1' }, same: { y: 'v' } },
        { a: '2', p: { x: 'v2' }, same: { y: 'v' }, b: '3' },
        ['a', 'p', 'same', 'b']
      )
    ).toEqual([
      'header.a: "1" → "2"',
      'header.p: {"x":"v1"} → {"x":"v2"}',
      'header.b: absent → "3"'
    ]);
    expect(headerDifferences(undefined, { a: '1' }, ['a'])).toEqual(['header.a: absent → "1"']);
  });

  it('lists row differences by id and each differing id once', () => {
    const differences = rowDifferences(
      [{ id: 'r1', a: 1, b: 2 }, { id: 'gone' }],
      [{ id: 'r1', a: 9, b: 8 }, { id: 'new' }]
    );
    expect(differences).toEqual([
      { id: 'r1', line: 'r1.a: 1 → 9' },
      { id: 'r1', line: 'r1.b: 2 → 8' },
      { id: 'new', line: 'new: missing from the committed table' },
      { id: 'gone', line: 'gone: not derivable from the inputs' }
    ]);
    expect(differingRowIds(differences)).toEqual(['r1', 'new', 'gone']);
  });

  it('lists added, removed and changed packages, sorted', () => {
    expect(
      packageDifferences({ b: 'v1', c: 'v1', d: 'v1' }, { a: 'v1', b: 'v2', d: 'v1' })
    ).toEqual(['a: absent → v1', 'b: v1 → v2', 'c: v1 → absent']);
    expect(packageDifferences({ a: 'v1' }, { a: 'v1' })).toEqual([]);
  });
});

/** A valid committed table: one save row. */
function table(): {
  header: Record<string, unknown>;
  rows: Record<string, unknown>[];
} {
  return {
    header: {
      plugin: '3.0',
      pluginZipSha256: 'aa',
      pluginPackages: { 'a/run': 'v1' },
      plugins: [{ version: '3.0', zipSha256: 'aa', packages: { 'a/run': 'v1' } }],
      wp: '7.0',
      wpZipSha1: 'bb',
      php: '8.1.34',
      pcre2: '10.49',
      pcreJit: 'on',
      libxml: '2.9.13',
      generatedBy: 'test'
    },
    rows: [
      { id: 'save-a', kind: 'save', feature: 'delay_js', typed: ['a'], stored: ['a'], dropped: [] }
    ]
  };
}

describe('ciFindings', () => {
  /** The verdict for the committed {@link table} against a mutated fresh copy. */
  async function verdict(mutate: (fresh: ReturnType<typeof table>) => void) {
    const fresh = table();
    mutate(fresh);
    return ciFindings(await formatTable(table()), fresh);
  }

  it('reproduces when only the zip bytes differ', async () => {
    expect(await verdict((fresh) => (fresh.header.pluginZipSha256 = 'cc'))).toEqual([
      {
        level: 'notice',
        title: 'the table reproduces with a fresh build of WP Rocket 3.0',
        details: []
      }
    ]);
  });

  it('reports another PHP build as a notice, never an error', async () => {
    const findings = await verdict((fresh) => {
      fresh.header.php = '8.4.27';
      fresh.header.pcre2 = '10.44';
      fresh.header.libxml = '2.9.14';
    });
    expect(findings.map((finding) => finding.level)).toEqual(['notice', 'notice']);
    expect(findings[0]).toEqual({
      level: 'notice',
      title: 'another PHP build than the table header',
      details: [
        'header.php: "8.1.34" → "8.4.27"',
        'header.pcre2: "10.49" → "10.44"',
        'header.libxml: "2.9.13" → "2.9.14"',
        'Rows are still compared; this alone never fails.'
      ]
    });
  });

  it('fails as "table stale" on a row difference, naming it', async () => {
    const findings = await verdict((fresh) => {
      (fresh.rows[0] as { stored: string[] }).stored = ['b'];
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe('error');
    expect(findings[0]?.title).toBe('table stale');
    expect(findings[0]?.details[0]).toBe('save-a.stored: ["a"] → ["b"]');
  });

  it('fails as "table stale" on another plugin version (a wrong reference build)', async () => {
    const findings = await verdict((fresh) => (fresh.header.plugin = '3.1'));
    expect(findings[0]?.title).toBe('table stale');
    expect(findings[0]?.details[0]).toBe('header.plugin: "3.0" → "3.1"');
  });

  it('fails as "reference drift" on other vendored package versions', async () => {
    const findings = await verdict((fresh) => (fresh.header.pluginPackages = { 'a/run': 'v2' }));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe('error');
    expect(findings[0]?.title).toBe('reference drift: rebuild locally and review');
    expect(findings[0]?.details[0]).toBe('a/run: v1 → v2');
    expect(findings[0]?.details[1]).toContain('`apvm build wp-rocket tag:v3.0`');
  });

  it('reports both failures when both occur, stale first', async () => {
    const findings = await verdict((fresh) => {
      fresh.header.pluginPackages = { 'a/run': 'v2' };
      (fresh.rows[0] as { stored: string[] }).stored = [];
    });
    expect(findings.map((finding) => finding.title)).toEqual([
      'table stale',
      'reference drift: rebuild locally and review'
    ]);
  });

  it('fails on a formatting-only difference and on an unparsable committed table', async () => {
    const committed = JSON.stringify(table());
    const findings = await ciFindings(committed, table());
    expect(findings[0]?.title).toBe('table stale');
    expect(findings[0]?.details[0]).toBe('formatting differs (run with --write)');
    await expect(ciFindings('{"rows": []}', table())).rejects.toThrow('"header" must be an object');
  });
});

describe('compare findings', () => {
  /** A table with `rows` save rows and the given plugin + packages. */
  function versioned(plugin: string, rows: number, stored = 'a', run = 'v1'): TableObject {
    const base = table();
    return {
      header: { ...base.header, plugin, pluginPackages: { 'a/run': run } },
      rows: Array.from({ length: rows }, (_, index) => ({
        ...base.rows[0],
        id: `save-${String(index)}`,
        stored: [stored]
      }))
    };
  }

  it('skips the comparison for the reference version', () => {
    expect(sameVersionFindings('3.0')).toEqual([
      {
        level: 'notice',
        title: "WP Rocket 3.0 is the table's reference version; comparison skipped",
        details: []
      }
    ]);
  });

  it('notes a newer version that matches every row, with package changes', () => {
    expect(compareFindings(versioned('3.0', 2), versioned('3.1', 2, 'a', 'v2'))).toEqual([
      {
        level: 'notice',
        title: 'WP Rocket 3.1 matches the table (WP Rocket 3.0) on all 2 rows',
        details: ['package a/run: v1 → v2']
      }
    ]);
  });

  it('warns (never errors) with the count and ids of the differing rows', () => {
    const [finding] = compareFindings(versioned('3.0', 2), versioned('3.1', 2, 'b'));
    expect(finding?.level).toBe('warning');
    expect(finding?.title).toBe(
      'WP Rocket 3.1 differs from the table (WP Rocket 3.0) on 2 rows: save-0, save-1'
    );
    expect(finding?.details.slice(0, 2)).toEqual([
      'save-0.stored: ["a"] → ["b"]',
      'save-1.stored: ["a"] → ["b"]'
    ]);
  });

  it('shortens a long id list in the title; the details keep every row', () => {
    const [finding] = compareFindings(versioned('3.0', 23), versioned('3.1', 23, 'b'));
    expect(finding?.title).toMatch(/on 23 rows: save-0, .*save-19 and 3 more$/);
    expect(finding?.details.filter((line) => line.startsWith('save-'))).toHaveLength(23);
  });
});

describe('GitHub Actions output', () => {
  it('escapes annotation titles and messages', () => {
    expect(annotation({ level: 'warning', title: 'a: b, 100%', details: ['x: 1', 'y\r%'] })).toBe(
      '::warning title=a%3A b%2C 100%25::x: 1%0Ay%0D%25'
    );
    expect(annotation({ level: 'notice', title: 'only a title', details: [] })).toBe(
      '::notice title=only a title::only a title'
    );
  });

  it('writes a summary section with a fence longer than any backtick run', () => {
    expect(
      summaryMarkdown('Heading', [
        { level: 'error', title: 'table stale', details: ['run `x`', 'a ``` b'] },
        { level: 'notice', title: 'ok', details: [] }
      ])
    ).toBe('### Heading\n\n❌ **table stale**\n\n````\nrun `x`\na ``` b\n````\n\nℹ️ **ok**\n\n');
  });
});

/** Simulation inputs covering each case-building branch. */
const SIMULATE_INPUTS: SimulateInput[] = [
  {
    id: 'simulate-a',
    kind: 'simulate',
    feature: 'delay_js',
    note: 'n',
    rows: ['a', 'é'],
    listRows: ['l'],
    html: '<p>'
  },
  {
    id: 'simulate-b',
    kind: 'simulate',
    feature: 'delay_js',
    rows: [],
    filterOnly: true,
    list: 'bundled',
    html: '<q>'
  }
];

/** Base64 of a string's UTF-8 bytes. */
function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

describe('simulationCases', () => {
  it('sends every row as a simulate case and a survival save case, rows base64-encoded', () => {
    expect(simulationCases(SIMULATE_INPUTS)).toEqual({
      saves: [
        {
          id: 'survival:simulate-a',
          kind: 'save',
          feature: 'delay_js',
          typed: [b64('a'), b64('é')],
          safeMode: false
        },
        { id: 'survival:simulate-b', kind: 'save', feature: 'delay_js', typed: [], safeMode: false }
      ],
      simulates: [
        {
          id: 'simulate-a',
          kind: 'simulate',
          feature: 'delay_js',
          rows: [b64('a'), b64('é')],
          listRows: [b64('l')],
          html: '<p>'
        },
        {
          id: 'simulate-b',
          kind: 'simulate',
          feature: 'delay_js',
          rows: [],
          list: 'bundled',
          html: '<q>'
        }
      ]
    });
  });

  it('feeds the survival rule: filterOnly rows must change on save', () => {
    const saved = [
      { id: 'survival:simulate-a', stored: ['a', 'é'], dropped: [] },
      { id: 'survival:simulate-b', stored: [], dropped: [] }
    ];
    expect(() => {
      checkSurvival(SIMULATE_INPUTS, saved);
    }).toThrow('simulate-b: marked filterOnly, but the settings form stores these rows unchanged');
  });
});

describe('assembleSimulateRow', () => {
  it('orders a row: authored inputs in file order, then served', () => {
    const shuffled = { html: '<q>', ...SIMULATE_INPUTS[1] } as SimulateInput;
    expect(Object.keys(assembleSimulateRow(shuffled, '<x>'))).toEqual([
      'id',
      'kind',
      'feature',
      'rows',
      'filterOnly',
      'list',
      'html',
      'served'
    ]);
    expect(assembleSimulateRow(SIMULATE_INPUTS[0] as SimulateInput, '<y>').served).toBe('<y>');
  });
});

describe('committedSentinels', () => {
  it('reads the authored sentinels from a committed table', () => {
    const value = { header: { simulation: { sentinels: { runtime: 'R', ieFallback: 'F' } } } };
    expect(committedSentinels(value)).toEqual({ runtime: 'R', ieFallback: 'F' });
  });

  it('fails fast when they are missing', () => {
    for (const value of [null, {}, { header: { simulation: { sentinels: { runtime: 'R' } } } }]) {
      expect(() => committedSentinels(value)).toThrow(
        'header.simulation.sentinels must hold the runtime and ieFallback texts'
      );
    }
  });
});

/** LazyLoad's head text in the fixtures. */
const LAZYLOAD_HEAD = '<noscript>N.</noscript>';

/** LazyLoad's options script in the fixtures. */
const LAZYLOAD_OPTIONS = '<script>window.o=1;</script>';

/** The fixtures' assets URL. */
const LAZYLOAD_ASSETS = 'https://e.org/wp-content/plugins/wp-rocket/assets/';

/** LazyLoad's texts as a harness run reports them. */
const LAZYLOAD_TEXTS = {
  assetsUrl: LAZYLOAD_ASSETS,
  head: LAZYLOAD_HEAD,
  footer: `${LAZYLOAD_OPTIONS}<script async src="${LAZYLOAD_ASSETS}js/lazyload/1.0/lazyload.min.js"></script>`,
  excludedAttributes: ['data-src=', 'skip-lazy'],
  excludedSrc: ['/captcha/']
};

describe('splitLazyloadFooter', () => {
  it('splits the options script from the runtime tag, cut around its URL', () => {
    expect(splitLazyloadFooter(LAZYLOAD_TEXTS.footer, LAZYLOAD_ASSETS)).toEqual({
      optionsScript: LAZYLOAD_OPTIONS,
      beforeUrl: '<script async src="',
      jsPath: 'lazyload/1.0/lazyload.min.js',
      afterUrl: '"></script>'
    });
  });

  it('fails fast on any other footer shape', () => {
    const tag = (src: string): string => `<script async src="${src}"></script>`;
    const js = `${LAZYLOAD_ASSETS}js/`;
    for (const [footer, problem] of [
      [tag(`${js}l.js`), 'does not start with an inline script'],
      ['<script>o', 'does not start with an inline script'],
      [`${LAZYLOAD_OPTIONS}${tag('https://other.org/js/l.js')}`, 'exactly once'],
      [`${LAZYLOAD_OPTIONS}${tag(`${js}a.js`)}${tag(`${js}b.js`)}`, 'exactly once'],
      [`${LAZYLOAD_OPTIONS}${tag(`${js}l.css`)}`, 'loads no .js file'],
      [`${LAZYLOAD_OPTIONS}${tag(`${js}../x.js`)}`, 'loads no .js file'],
      [`${LAZYLOAD_OPTIONS}${tag(`${js}l.js?v=1`)}`, 'loads no .js file'],
      [`${LAZYLOAD_OPTIONS}${tag(`${js}a//l.js`)}`, 'loads no .js file'],
      [`${LAZYLOAD_OPTIONS}<script async src="${js}l.js></script>`, 'loads no .js file']
    ] as const) {
      expect(() => splitLazyloadFooter(footer, LAZYLOAD_ASSETS), footer).toThrow(problem);
    }
  });
});

describe('LazyLoad harness runs', () => {
  const lazyCase = (
    id: string,
    assetsUrl?: string
  ): Parameters<typeof simulationRuns>[0][number] => ({
    id,
    kind: 'simulate',
    feature: assetsUrl === undefined ? 'delay_js' : 'lazyload',
    ...(assetsUrl === undefined ? {} : { lazyload: { assetsUrl, rows: [] } }),
    html: '<p>'
  });

  it('runs once per assets URL, cases without LazyLoad joining the first', () => {
    const cases = [
      lazyCase('a'),
      lazyCase('b', 'https://x/assets/'),
      lazyCase('c', 'https://y/assets/'),
      lazyCase('d', 'https://x/assets/')
    ];
    expect(
      simulationRuns(cases).map((run) => [run.assetsUrl, run.cases.map((entry) => entry.id)])
    ).toEqual([
      ['https://x/assets/', ['a', 'b', 'd']],
      ['https://y/assets/', ['c']]
    ]);
  });

  it('runs once under the default URL when no case has LazyLoad', () => {
    expect(simulationRuns([lazyCase('a')])).toEqual([
      { assetsUrl: DEFAULT_LAZYLOAD_ASSETS_URL, cases: [lazyCase('a')] }
    ]);
    expect(simulationRuns([])).toEqual([{ assetsUrl: DEFAULT_LAZYLOAD_ASSETS_URL, cases: [] }]);
  });

  it('takes texts that agree on all but the URL, and fails otherwise', () => {
    const other = 'https://cdn.example/p/assets/';
    const moved = {
      ...LAZYLOAD_TEXTS,
      assetsUrl: other,
      footer: LAZYLOAD_TEXTS.footer.replace(LAZYLOAD_ASSETS, other)
    };
    expect(sameLazyloadTexts([LAZYLOAD_TEXTS, moved])).toBe(LAZYLOAD_TEXTS);
    expect(() => sameLazyloadTexts([LAZYLOAD_TEXTS, { ...moved, head: 'x' }])).toThrow(
      'LazyLoad texts differ between assets URLs beyond the URL itself'
    );
    expect(() => sameLazyloadTexts([LAZYLOAD_TEXTS, undefined])).toThrow(
      'returned no LazyLoad texts'
    );
    expect(() => sameLazyloadTexts([])).toThrow('returned no LazyLoad texts');
  });

  it("derives LazyLoad's pins without putting the runtime among the texts", () => {
    const runtime = new TextEncoder().encode('\u{FEFF}é');
    const { pins, entry, texts } = lazyloadArtifacts({ texts: LAZYLOAD_TEXTS, runtime });
    expect(pins.runtime).toMatchObject({
      path: 'assets/js/lazyload/1.0/lazyload.min.js',
      bytes: 5
    });
    expect(entry.runtime).toEqual({
      sha256: pins.runtime.sha256,
      bytes: 5,
      jsPath: 'lazyload/1.0/lazyload.min.js'
    });
    expect(Object.keys(texts)).not.toContain(pins.runtime.sha256);
    // Bytes, not UTF-8 text: a runtime that is not UTF-8 is still pinned as shipped.
    expect(
      lazyloadArtifacts({ texts: LAZYLOAD_TEXTS, runtime: Uint8Array.of(0xff) }).pins.runtime.bytes
    ).toBe(1);
  });

  it('sends LazyLoad inputs base64-encoded, with a survival case for its rows', () => {
    const input: SimulateInput = {
      id: 'simulate-l',
      kind: 'simulate',
      feature: 'lazyload',
      lazyload: { assetsUrl: LAZYLOAD_ASSETS, rows: ['é'], filterOnly: true },
      html: '<p>'
    };
    expect(simulationCases([input])).toEqual({
      saves: [
        {
          id: 'survival:simulate-l#lazyload',
          kind: 'save',
          feature: 'lazyload',
          typed: [b64('é')],
          safeMode: false
        }
      ],
      simulates: [
        {
          id: 'simulate-l',
          kind: 'simulate',
          feature: 'lazyload',
          lazyload: { assetsUrl: LAZYLOAD_ASSETS, rows: [b64('é')] },
          html: '<p>'
        }
      ]
    });
    expect(simulationSurvivalSources([input])).toEqual([
      { id: 'simulate-l#lazyload', feature: 'lazyload', rows: ['é'], filterOnly: true }
    ]);
  });
});

describe('simulationArtifacts', () => {
  const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
  const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
  const sentinels = { runtime: 'R.run()', ieFallback: 'F' };
  const runtime = 'class X{constructor(){this.v="2.0.5"}}';
  const rows = ['a', 'b\\.js'];
  const external = ['gist.github.com'];
  const inline = ['a/b'];
  const lists = {
    other: [],
    delay_js_exclusions: rows,
    defer_js_external_exclusions: external,
    defer_js_inline_exclusions: inline
  };
  const lazyRuntime = '!function(){}';
  const sources = {
    version: '3.0',
    runtime: encode(runtime),
    dynamicLists: encode(JSON.stringify(lists)),
    ieFallback: 'fallback é',
    lazyload: { texts: LAZYLOAD_TEXTS, runtime: encode(lazyRuntime) }
  };

  it('derives the pins and a content-keyed data file from the plugin files', () => {
    const { pins, data } = simulationArtifacts(sources, sentinels);
    expect(pins).toEqual({
      runtime: {
        path: 'assets/js/lazyload-scripts.min.js',
        version: '2.0.5',
        bytes: runtime.length,
        sha256: sha(runtime)
      },
      ieFallback: { bytes: 11, sha256: sha('fallback é') },
      dynamicLists: { sha256: createHash('sha256').update(sources.dynamicLists).digest('hex') },
      delayJsExclusions: { count: 2, sha256: sha(JSON.stringify(rows)) },
      deferJsExternalExclusions: { count: 1, sha256: sha(JSON.stringify(external)) },
      deferJsInlineExclusions: { count: 1, sha256: sha(JSON.stringify(inline)) },
      lazyload: {
        runtime: {
          path: 'assets/js/lazyload/1.0/lazyload.min.js',
          bytes: 13,
          sha256: sha(lazyRuntime)
        },
        noJsStyle: { bytes: 23, sha256: sha(LAZYLOAD_HEAD) },
        optionsScript: { bytes: 28, sha256: sha(LAZYLOAD_OPTIONS) },
        runtimeTag: {
          beforeUrl: { bytes: 19, sha256: sha('<script async src="') },
          afterUrl: { bytes: 11, sha256: sha('"></script>') }
        },
        excludedAttributes: { count: 2, sha256: sha('["data-src=","skip-lazy"]') },
        excludedSrc: { count: 1, sha256: sha('["/captcha/"]') }
      },
      sentinels
    });
    expect(data).toEqual({
      format: 1,
      versions: {
        '3.0': {
          runtime: { sha256: sha(runtime), version: '2.0.5' },
          ieFallback: { sha256: sha('fallback é') },
          delayJsExclusions: { sha256: sha(JSON.stringify(rows)), count: 2 },
          deferJsExternalExclusions: { sha256: sha(JSON.stringify(external)), count: 1 },
          deferJsInlineExclusions: { sha256: sha(JSON.stringify(inline)), count: 1 },
          lazyload: {
            runtime: {
              sha256: sha(lazyRuntime),
              bytes: 13,
              jsPath: 'lazyload/1.0/lazyload.min.js'
            },
            noJsStyle: { sha256: sha(LAZYLOAD_HEAD) },
            optionsScript: { sha256: sha(LAZYLOAD_OPTIONS) },
            runtimeTag: {
              beforeUrl: { sha256: sha('<script async src="') },
              afterUrl: { sha256: sha('"></script>') }
            },
            excludedAttributes: { sha256: sha('["data-src=","skip-lazy"]'), count: 2 },
            excludedSrc: { sha256: sha('["/captcha/"]'), count: 1 }
          }
        }
      },
      // LazyLoad's runtime is pinned only: it ships as its own file.
      texts: {
        [sha(runtime)]: runtime,
        [sha('fallback é')]: 'fallback é',
        [sha(LAZYLOAD_HEAD)]: LAZYLOAD_HEAD,
        [sha(LAZYLOAD_OPTIONS)]: LAZYLOAD_OPTIONS,
        [sha('<script async src="')]: '<script async src="',
        [sha('"></script>')]: '"></script>'
      },
      rowLists: {
        [sha(JSON.stringify(rows))]: rows,
        [sha(JSON.stringify(external))]: external,
        [sha(JSON.stringify(inline))]: inline,
        [sha('["data-src=","skip-lazy"]')]: ['data-src=', 'skip-lazy'],
        [sha('["/captcha/"]')]: ['/captcha/']
      }
    });
  });

  it('keeps a leading BOM, so the text hashes as the file bytes do', () => {
    const bom = `﻿${runtime}`;
    const { pins, data } = simulationArtifacts({ ...sources, runtime: encode(bom) }, sentinels);
    expect(pins.runtime.sha256).toBe(sha(bom));
    expect(data.texts[pins.runtime.sha256]).toBe(bom);
  });

  it('fails fast on a malformed runtime or lists file', () => {
    const bad = (patch: Partial<typeof sources>): (() => unknown) => {
      return () => simulationArtifacts({ ...sources, ...patch }, sentinels);
    };
    expect(bad({ runtime: Uint8Array.of(0xff) })).toThrow('lazyload-scripts.min.js is not UTF-8');
    expect(bad({ runtime: encode('no version') })).toThrow('names no version (this.v="…")');
    expect(bad({ dynamicLists: encode('{') })).toThrow('dynamic-lists.json is not UTF-8 JSON');
    expect(bad({ dynamicLists: encode('null') })).toThrow('has no delay_js_exclusions string list');
    expect(bad({ dynamicLists: encode('{"delay_js_exclusions":[1]}') })).toThrow(
      'has no delay_js_exclusions string list'
    );
    // Each Defer JS list is required too.
    const without = (name: string): Uint8Array =>
      encode(JSON.stringify(Object.fromEntries(Object.entries(lists).filter(([k]) => k !== name))));
    for (const name of ['defer_js_external_exclusions', 'defer_js_inline_exclusions']) {
      expect(bad({ dynamicLists: without(name) })).toThrow(`has no ${name} string list`);
    }
    // An empty fallback is no text the data file can hold.
    expect(bad({ ieFallback: '' })).toThrow(`derived ${SIMULATION_DATA_FILE}: texts.`);
  });
});

describe('dataFindings', () => {
  it('is empty when the committed file is the derived one', () => {
    expect(dataFindings('{}\n', '{}\n')).toEqual([]);
  });

  it('fails as stale on any difference or a missing file', () => {
    const [changed] = dataFindings('{"a":1}\n', '{}\n');
    expect(changed?.level).toBe('error');
    expect(changed?.title).toBe('simulation data file stale');
    expect(changed?.details[0]).toBe(
      `${SIMULATION_DATA_FILE} differs from the one derived from the plugin zip`
    );
    expect(dataFindings(null, '{}\n')[0]?.details[0]).toBe(`${SIMULATION_DATA_FILE} is missing`);
  });
});

describe('pinFindings', () => {
  const pins = {
    runtime: { version: '2.0.5' },
    ieFallback: { bytes: 1 },
    dynamicLists: { sha256: 'a' },
    delayJsExclusions: { count: 75 },
    sentinels: { runtime: 'R' }
  };

  it('is empty when the other build ships the same inputs (sentinels ignored)', () => {
    const fresh = { plugin: '3.1', simulation: { ...pins, sentinels: { runtime: 'S' } } };
    expect(pinFindings({ plugin: '3.0', simulation: pins }, fresh)).toEqual([]);
  });

  it('warns (never errors), naming each differing pin', () => {
    const fresh = { plugin: '3.1', simulation: { ...pins, runtime: { version: '2.0.6' } } };
    const [finding] = pinFindings({ plugin: '3.0', simulation: pins }, fresh);
    expect(finding?.level).toBe('warning');
    expect(finding?.title).toBe(
      'WP Rocket 3.1 ships other simulation inputs than the simulation table (WP Rocket 3.0)'
    );
    expect(finding?.details[0]).toBe(
      'header.simulation.runtime: {"version":"2.0.5"} → {"version":"2.0.6"}'
    );
    expect(pinFindings({ plugin: '3.0' }, fresh)[0]?.details).toHaveLength(5);
  });
});

describe('the simulation table in the shared verdicts', () => {
  /** A valid committed simulation table: one row. */
  function simulationTable(): TableObject & { header: Record<string, unknown> } {
    return {
      header: {
        ...table().header,
        simulation: {
          runtime: { path: 'r.js', version: '2.0.5', bytes: 3, sha256: '1'.repeat(64) },
          ieFallback: { bytes: 2, sha256: '2'.repeat(64) },
          dynamicLists: { sha256: '3'.repeat(64) },
          delayJsExclusions: { count: 0, sha256: '4'.repeat(64) },
          deferJsExternalExclusions: { count: 0, sha256: '5'.repeat(64) },
          deferJsInlineExclusions: { count: 0, sha256: '6'.repeat(64) },
          lazyload: {
            runtime: { path: 'assets/js/l.js', bytes: 4, sha256: '7'.repeat(64) },
            noJsStyle: { bytes: 5, sha256: '8'.repeat(64) },
            optionsScript: { bytes: 6, sha256: '9'.repeat(64) },
            runtimeTag: {
              beforeUrl: { bytes: 7, sha256: 'a'.repeat(64) },
              afterUrl: { bytes: 8, sha256: 'b'.repeat(64) }
            },
            excludedAttributes: { count: 22, sha256: 'c'.repeat(64) },
            excludedSrc: { count: 3, sha256: 'd'.repeat(64) }
          },
          sentinels: { runtime: 'R.run()', ieFallback: 'F' }
        }
      },
      rows: [
        {
          id: 'simulate-a',
          kind: 'simulate',
          feature: 'delay_js',
          rows: [],
          listRows: [],
          html: '<p>',
          served: '<p>'
        }
      ]
    };
  }

  it('reproduces with its own label when only the zip bytes differ', async () => {
    const committed = await formatTable(simulationTable(), SIMULATION_TABLE.path);
    const fresh = simulationTable();
    fresh.header.pluginZipSha256 = 'cc';
    expect(await ciFindings(committed, fresh, SIMULATION_TABLE)).toEqual([
      {
        level: 'notice',
        title: 'the simulation table reproduces with a fresh build of WP Rocket 3.0',
        details: []
      }
    ]);
  });

  it('fails as "simulation table stale" on a pin or served difference', async () => {
    const committed = await formatTable(simulationTable(), SIMULATION_TABLE.path);
    const fresh = simulationTable();
    (fresh.header.simulation as { runtime: { bytes: number } }).runtime.bytes = 4;
    (fresh.rows[0] as { served: string }).served = '<q>';
    const [finding] = await ciFindings(committed, fresh, SIMULATION_TABLE);
    expect(finding?.title).toBe('simulation table stale');
    expect(finding?.details[0]).toMatch(/^header\.simulation: .*"bytes":3.* → .*"bytes":4/);
    expect(finding?.details[1]).toBe('simulate-a.served: "<p>" → "<q>"');
  });

  it('parses the committed simulation table strictly', async () => {
    await expect(ciFindings('{"rows": []}', simulationTable(), SIMULATION_TABLE)).rejects.toThrow(
      'simulation-parity fixtures: "header" must be an object'
    );
  });

  it('names the simulation table in a comparison', () => {
    const before = simulationTable();
    const fresh = { ...simulationTable(), header: { ...before.header, plugin: '3.1' } };
    expect(compareFindings(before, fresh, SIMULATION_TABLE.label)[0]?.title).toBe(
      'WP Rocket 3.1 matches the simulation table (WP Rocket 3.0) on all 1 rows'
    );
  });

  it('compares the given header keys only', () => {
    const before = JSON.stringify(simulationTable());
    const after = simulationTable();
    (after.header.simulation as { sentinels: { runtime: string } }).sentinels.runtime = 'S.run()';
    expect(describeStaleness(before, JSON.stringify(after))).toEqual([
      'formatting differs (run with --write)'
    ]);
    expect(
      describeStaleness(before, JSON.stringify(after), SIMULATION_TABLE.headerKeys)
    ).toHaveLength(1);
  });
});

describe('phpCommand', () => {
  it('runs without php.ini, forces the PCRE JIT on, then extension and call arguments', () => {
    expect(phpCommand(['-d', 'extension=dom'], ['-r', 'echo 1;'])).toEqual([
      '-n',
      '-d',
      'pcre.jit=1',
      '-d',
      'extension=dom',
      '-r',
      'echo 1;'
    ]);
    expect(phpCommand([], ['h.php'])).toEqual(['-n', '-d', 'pcre.jit=1', 'h.php']);
  });
});

describe('bounded difference lines', () => {
  /** sha256 hex of a text's UTF-8 bytes. */
  const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

  it('finds the first differing offset (the shorter length on a prefix)', () => {
    expect(firstDifference('abc', 'abd')).toBe(2);
    expect(firstDifference('abc', 'abc')).toBe(3);
    expect(firstDifference('ab', 'abc')).toBe(2);
    expect(firstDifference('', 'x')).toBe(0);
  });

  it('prints values up to the cap whole', () => {
    const value = 'x'.repeat(SHOWN_VALUE_MAX);
    expect(shownValue(value, 5)).toBe(value);
    expect(differenceLine('r.k', '"a"', '"b"')).toBe('r.k: "a" → "b"');
  });

  it('summarizes a longer value: length, sha256 and a window around the offset', () => {
    const value = `${'a'.repeat(1000)}Z${'b'.repeat(1000)}`;
    expect(shownValue(value, 1000)).toBe(
      `<2001 chars, sha256 ${sha(value)}, at 1000: …${'a'.repeat(20)}Z${'b'.repeat(59)}…>`
    );
    // Window clipped at both ends: no leading/trailing ellipsis there.
    const short = 'c'.repeat(SHOWN_VALUE_MAX + 1);
    expect(shownValue(short, 0)).toBe(
      `<${String(short.length)} chars, sha256 ${sha(short)}, at 0: ${'c'.repeat(60)}…>`
    );
    expect(shownValue(short, short.length)).toBe(
      `<${String(short.length)} chars, sha256 ${sha(short)}, at ${String(short.length)}: …${'c'.repeat(20)}>`
    );
  });

  it('keeps a stale multi-megabyte row to short lines, a short side whole', () => {
    const page = 'p'.repeat(4 * 1024 * 1024);
    const [difference] = rowDifferences(
      [{ id: 'r', served: page }],
      [{ id: 'r', served: `${page}!` }]
    );
    expect(difference?.line.length).toBeLessThan(500);
    expect(difference?.line).toContain(`at ${String(page.length + 1)}:`);
    expect(differenceLine('r.k', '"a"', JSON.stringify(page))).toMatch(/^r\.k: "a" → <\d+ chars, /);
    const [header] = headerDifferences({ k: page }, { k: 'x' }, ['k']);
    expect(header?.length).toBeLessThan(500);
  });

  it('fences the summary past the LONGEST backtick run, not the first', () => {
    expect(longestBacktickRun('a ` b ```` c `` d')).toBe(4);
    expect(longestBacktickRun('none')).toBe(0);
    expect(
      summaryMarkdown('H', [{ level: 'warning', title: 't', details: ['a ` b ```` c'] }])
    ).toBe('### H\n\n⚠️ **t**\n\n`````\na ` b ```` c\n`````\n\n');
  });
});

describe('otherVersionFindings', () => {
  /** A one-row table of `plugin` whose row field `k` is `value`. */
  const tableOf = (plugin: string, value: string): TableObject => ({
    header: { plugin, pluginPackages: { 'a/b': 'v1' }, simulation: { runtime: { v: 1 } } },
    rows: [{ id: 'r', k: value }]
  });

  it('reports the parity comparison and the simulation failure as its own named warning', () => {
    const findings = otherVersionFindings(tableOf('3.0', 'x'), tableOf('3.1', 'y'), {
      ok: false,
      problem: "the plugin's dynamic-lists.json has no delay_js_exclusions string list"
    });
    expect(findings.map((finding) => finding.level)).toEqual(['warning', 'warning']);
    expect(findings[0]?.title).toBe(
      'WP Rocket 3.1 differs from the table (WP Rocket 3.0) on 1 rows: r'
    );
    expect(findings[1]).toEqual({
      level: 'warning',
      title: 'could not derive the simulation table from WP Rocket 3.1',
      details: [
        "the plugin's dynamic-lists.json has no delay_js_exclusions string list",
        'Informational: the exclusion parity comparison above is unaffected.'
      ]
    });
  });

  it('adds the simulation comparison and pin differences when it derived', () => {
    const fresh = tableOf('3.1', 'x');
    const findings = otherVersionFindings(tableOf('3.0', 'x'), tableOf('3.1', 'x'), {
      ok: true,
      before: tableOf('3.0', 'x'),
      fresh: { ...fresh, header: { ...fresh.header, simulation: { runtime: { v: 2 } } } }
    });
    expect(findings.map((finding) => finding.title)).toEqual([
      'WP Rocket 3.1 matches the table (WP Rocket 3.0) on all 1 rows',
      'WP Rocket 3.1 matches the simulation table (WP Rocket 3.0) on all 1 rows',
      'WP Rocket 3.1 ships other simulation inputs than the simulation table (WP Rocket 3.0)'
    ]);
    expect(findings.every((finding) => finding.level !== 'error')).toBe(true);
  });
});

describe('ciFindings on the PCRE JIT', () => {
  it('reports a JIT difference as a PHP-build notice, rows still deciding', async () => {
    const fresh = table();
    fresh.header.pcreJit = 'off';
    const findings = await ciFindings(await formatTable(table()), fresh);
    expect(findings[0]).toEqual({
      level: 'notice',
      title: 'another PHP build than the table header',
      details: ['header.pcreJit: "on" → "off"', 'Rows are still compared; this alone never fails.']
    });
  });
});

describe('packaged LazyLoad runtime files', () => {
  const bytes = new TextEncoder().encode('/*! lazyload */');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const jsPath = 'lazyload/17.8.3/lazyload.min.js';
  /** A data file whose versions name runtimes. */
  const data = (entries: Record<string, { sha256: string; bytes: number }>) =>
    ({
      versions: Object.fromEntries(
        Object.entries(entries).map(([version, runtime]) => [
          version,
          { lazyload: { runtime: { ...runtime, jsPath } } }
        ])
      )
    }) as unknown as Parameters<typeof addRuntimeFiles>[1];

  it('adds each version’s runtime at its packaged path, read from the plugin path', () => {
    const files = new Map<string, Uint8Array>();
    const read: string[] = [];
    const pin = { sha256, bytes: bytes.byteLength };
    addRuntimeFiles(files, data({ '3.24': pin, '3.23.5.1': pin }), (path) => {
      read.push(path);
      return bytes;
    });
    expect([...files.keys()]).toEqual([
      'public/wp-rocket-simulation/lazyload/17.8.3/lazyload.min.js'
    ]);
    expect(packagedRuntimeFile(jsPath)).toBe([...files.keys()][0]);
    expect(read).toEqual([
      'assets/js/lazyload/17.8.3/lazyload.min.js',
      'assets/js/lazyload/17.8.3/lazyload.min.js'
    ]);
  });

  it('refuses bytes off their pin, and two runtimes at one path', () => {
    const files = new Map<string, Uint8Array>();
    expect(() => {
      addRuntimeFiles(
        files,
        data({ '3.24': { sha256: 'f'.repeat(64), bytes: bytes.byteLength } }),
        () => bytes
      );
    }).toThrow(/differs from its pin/);
    const other = new TextEncoder().encode('/*! other   */');
    files.set(packagedRuntimeFile(jsPath), other);
    expect(() => {
      addRuntimeFiles(files, data({ '3.24': { sha256, bytes: bytes.byteLength } }), () => bytes);
    }).toThrow(/different runtimes at one path/);
  });

  it('finds stale, missing and orphan files, nothing when committed byte for byte', () => {
    const path = packagedRuntimeFile(jsPath);
    const fresh = new Map([[path, bytes]]);
    expect(runtimeFileFindings(fresh, () => bytes, [path])).toEqual([]);
    const [finding] = runtimeFileFindings(fresh, () => new TextEncoder().encode('x'), [
      path,
      'public/wp-rocket-simulation/lazyload/1.0/lazyload.min.js'
    ]);
    expect(finding?.level).toBe('error');
    expect(finding?.details.slice(0, 2)).toEqual([
      `${path} differs from the plugin's runtime`,
      "public/wp-rocket-simulation/lazyload/1.0/lazyload.min.js is not a supported version's runtime"
    ]);
    expect(runtimeFileFindings(fresh, () => null, [])[0]?.details[0]).toBe(`${path} is missing`);
  });
});
