/**
 * The parity script's pure helpers: CLI options, preflight probes, package
 * versions, harness case building, the form-survival rule for match rows, row
 * assembly in file key order, the staleness report, the `--ci` and
 * `--compare` verdicts and their GitHub Actions output. The PHP run itself is
 * exercised by `pnpm parity:wp-rocket` and the WP Rocket parity workflow.
 */
import { describe, expect, it } from 'vitest';
import type { ParityInput } from '../lib/exclusion-builder/wp-rocket-parity-table.ts';
import {
  PHP_EXTENSIONS,
  annotation,
  assembleRow,
  checkPhpProbe,
  checkSurvival,
  ciFindings,
  compareFindings,
  describeStaleness,
  differingRowIds,
  extensionArgs,
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
      wp: '7.0',
      wpZipSha1: 'bb',
      php: '8.1.34',
      pcre2: '10.49',
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
