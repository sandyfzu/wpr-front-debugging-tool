/**
 * The parity script's pure helpers: CLI mode, preflight probes, harness case
 * building, the form-survival rule for match rows, row assembly in file key
 * order, and the staleness report. The PHP run itself is exercised by
 * `pnpm parity:wp-rocket` (dev-time only).
 */
import { describe, expect, it } from 'vitest';
import type { ParityInput } from '../lib/exclusion-builder/wp-rocket-parity-table.ts';
import {
  assembleRow,
  checkPhpProbe,
  checkSurvival,
  describeStaleness,
  formatTable,
  matchCases,
  parseMode,
  readPluginVersion,
  saveCases
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
  { id: 'match-b', kind: 'match', feature: 'defer_all_js', rows: ['x'], note: 'n', html: 'h' },
  { id: 'match-c', kind: 'match', feature: 'lazyload', rows: [' y'], filterOnly: true, html: 'h' },
  { id: 'match-d', kind: 'match', feature: 'automatic_lazy_rendering', rows: [''], html: 'h' }
];

describe('parseMode', () => {
  it('defaults to check, accepts --write, rejects anything else', () => {
    expect(parseMode([])).toBe('check');
    expect(parseMode(['--write'])).toBe('write');
    expect(() => parseMode(['--force'])).toThrow('unknown arguments: --force');
    expect(() => parseMode(['--write', '--write'])).toThrow('unknown arguments');
  });
});

describe('checkPhpProbe', () => {
  it('returns the version of a PHP >= 8.1 with ext-dom', () => {
    expect(checkPhpProbe('8.1.34\ndom\n')).toBe('8.1.34');
    expect(checkPhpProbe('9.0.0\ndom')).toBe('9.0.0');
  });

  it('fails fast on an old PHP or a missing ext-dom', () => {
    expect(() => checkPhpProbe('8.0.30\ndom')).toThrow(
      'PHP 8.0.30 found; the harness needs PHP >= 8.1'
    );
    expect(() => checkPhpProbe('7.4.1\ndom')).toThrow('needs PHP >= 8.1');
    expect(() => checkPhpProbe('')).toThrow('PHP ? found');
    expect(() => checkPhpProbe('8.4.1\nnodom')).toThrow('has no ext-dom under `php -n`');
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
      featureOff: false,
      excluded: [],
      candidates: [],
      served: 's'
    });
    expect(Object.keys(deferRow)).toEqual([
      'id',
      'kind',
      'feature',
      'rows',
      'note',
      'html',
      'served',
      'candidates',
      'excluded',
      'featureOff'
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
