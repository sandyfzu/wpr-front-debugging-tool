/**
 * The parity table parser: a well-formed table round-trips, and every
 * malformed shape fails with a message naming the offending row.
 */
import { describe, expect, it } from 'vitest';
import {
  parseParityInputs,
  parseParityTable,
  comparedFields,
  pendingOwner,
  typedLineBytes
} from './wp-rocket-parity-table';

type Json = Record<string, unknown>;

/** A small valid table: one row per shape (save, from-match, Defer, lazy rendering). */
function validTable(): { header: Json; rows: Json[] } {
  return {
    header: {
      plugin: '3.0',
      pluginZipSha256: 'aa',
      pluginPackages: { 'a/b': 'v1' },
      wp: '7.0',
      wpZipSha1: 'bb',
      php: '8.1',
      pcre2: '10.49',
      libxml: '2.9',
      generatedBy: 'test'
    },
    rows: [
      {
        id: 'save-a',
        kind: 'save',
        feature: 'delay_js',
        typed: ['a', ' ', { b64: '/w==' }],
        safeMode: true,
        note: 'n',
        stored: ['a'],
        dropped: [
          { index: 1, row: ' ', reason: 'empty' },
          { index: 2, row: { b64: '/w==' }, reason: 'empty' }
        ]
      },
      {
        id: 'match-a',
        kind: 'match',
        feature: 'delay_js',
        from: 'save-a',
        rows: ['a'],
        pending: { owner: 'K.4b', fields: ['candidates', 'excluded'] },
        html: '<p>',
        served: '<p>',
        subjects: ['s1', '#0', 's2'],
        candidates: ['s1', 's2'],
        excluded: ['s1']
      },
      {
        id: 'match-b',
        kind: 'match',
        feature: 'defer_all_js',
        rows: ['('],
        filterOnly: true,
        engine: { problem: 'pcre-invalid' },
        pending: { owner: 'K.4c', fields: ['problems'] },
        html: 'h',
        served: 's',
        subjects: ['w'],
        candidates: [],
        excluded: [],
        featureOff: true,
        inlineWrapped: ['w']
      },
      {
        id: 'match-c',
        kind: 'match',
        feature: 'automatic_lazy_rendering',
        rows: [''],
        engine: { residual: 'why', candidates: ['a'], excluded: [] },
        html: 'h',
        served: 's',
        candidates: ['a', 'b'],
        excluded: ['a'],
        hashed: ['b'],
        rekeyed: ['b']
      }
    ]
  };
}

/** The row with an id, from a table copy. */
function row(table: { rows: Json[] }, id: string): Json {
  const found = table.rows.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no row ${id}`);
  return found;
}

/**
 * Expect the parser to reject a mutated valid table with a message.
 *
 * @param mutate Edits the fresh valid table in place.
 * @param message Text the error message must contain.
 */
function rejects(mutate: (table: { header: Json; rows: Json[] }) => void, message: string): void {
  const table = validTable();
  mutate(table);
  expect(() => parseParityTable(table)).toThrow(message);
}

describe('parseParityTable', () => {
  it('parses a well-formed table, keeping every field', () => {
    const table = parseParityTable(validTable());
    expect(table.header.pcre2).toBe('10.49');
    expect(table.rows.map((parsed) => parsed.id)).toEqual([
      'save-a',
      'match-a',
      'match-b',
      'match-c'
    ]);
    expect(table.rows[1]).toMatchObject({
      from: 'save-a',
      rows: ['a'],
      pending: { owner: 'K.4b', fields: ['candidates', 'excluded'] }
    });
    expect(table.rows[1]).toMatchObject({ subjects: ['s1', '#0', 's2'] });
    expect(table.rows[2]).toMatchObject({
      filterOnly: true,
      featureOff: true,
      inlineWrapped: ['w'],
      engine: { problem: 'pcre-invalid' },
      pending: { owner: 'K.4c', fields: ['problems'] }
    });
    expect(table.rows[3]).toMatchObject({
      hashed: ['b'],
      rekeyed: ['b'],
      engine: { residual: 'why', candidates: ['a'], excluded: [] }
    });
  });

  it('rejects malformed tables and headers', () => {
    expect(() => parseParityTable([])).toThrow('expected {"header"');
    expect(() => parseParityTable({ header: validTable().header })).toThrow('expected {"rows"');
    rejects((table) => Object.assign(table, { extra: 1 }), 'unknown key "extra"');
    rejects((table) => (table.header = [] as unknown as Json), '"header" must be an object');
    rejects((table) => delete table.header.php, '"php" must be a string');
    rejects((table) => (table.header.php = ''), 'header "php" must not be empty');
    rejects((table) => (table.header.extra = 'x'), 'unknown key "extra"');
  });

  it('parses pluginPackages as a non-empty map of non-empty version strings', () => {
    expect(parseParityTable(validTable()).header.pluginPackages).toEqual({ 'a/b': 'v1' });
    const shape = 'header "pluginPackages" must be a non-empty {name: version} object';
    rejects((table) => delete table.header.pluginPackages, shape);
    rejects((table) => (table.header.pluginPackages = {}), shape);
    rejects((table) => (table.header.pluginPackages = ['v1']), shape);
    rejects((table) => (table.header.pluginPackages = 'v1'), shape);
    rejects(
      (table) => (table.header.pluginPackages = { 'a/b': '' }),
      'header "pluginPackages" "a/b" must be a non-empty version string'
    );
    rejects(
      (table) => (table.header.pluginPackages = { 'a/b': 1 }),
      'header "pluginPackages" "a/b" must be a non-empty version string'
    );
  });

  it('rejects malformed rows by id', () => {
    rejects((table) => table.rows.push([] as unknown as Json), 'row #4 must be an object');
    rejects((table) => (row(table, 'save-a').id = 'save_A'), 'lowercase kebab case');
    rejects((table) => (row(table, 'save-a').id = 'match-z'), 'save row ids start with "save-"');
    rejects((table) => (row(table, 'match-b').id = 'save-z'), 'match row ids start with "match-"');
    rejects((table) => (row(table, 'save-a').kind = 'other'), '"kind" must be "save" or "match"');
    rejects((table) => (row(table, 'save-a').bogus = 1), 'row "save-a": unknown key "bogus"');
    rejects((table) => (row(table, 'match-b').id = 'match-c'), 'row "match-c": duplicate id');
    rejects((table) => (row(table, 'save-a').note = 1), '"note" must be a string');
    const pend = (table: { rows: Json[] }, value: unknown): void => {
      row(table, 'match-a').pending = value;
    };
    rejects((table) => (row(table, 'save-a').pending = 'K.3'), '"pending" must be {"owner"');
    rejects((table) => {
      pend(table, { owner: 'K.3', fields: ['excluded'] });
    }, '"pending.owner" must be "K.4b"');
    rejects((table) => {
      pend(table, { owner: 'K.4b', fields: ['excluded'], x: 1 });
    }, 'unknown key "x"');
    rejects((table) => {
      pend(table, { owner: 'K.4b', fields: 'excluded' });
    }, '"pending.fields" must be an array');
    rejects((table) => {
      pend(table, { owner: 'K.4b', fields: [] });
    }, '"pending.fields" must not be empty');
    rejects((table) => {
      pend(table, { owner: 'K.4b', fields: ['excluded', 'excluded'] });
    }, '"pending.fields" repeats');
    rejects((table) => {
      pend(table, { owner: 'K.4b', fields: ['rekeyed'] });
    }, '"pending.fields" must be a subset of candidates, excluded, in that order');
    rejects((table) => {
      pend(table, { owner: 'K.4b', fields: ['excluded', 'candidates'] });
    }, 'in that order');
    rejects(
      (table) => (row(table, 'save-a').pending = { owner: 'K.3', fields: ['problems'] }),
      'subset of stored, dropped'
    );
  });

  it('rejects malformed save rows', () => {
    rejects(
      (table) => (row(table, 'save-a').feature = 'automatic_lazy_rendering'),
      '"feature" must be one of'
    );
    rejects((table) => (row(table, 'save-a').typed = []), '"typed" must be a non-empty array');
    rejects(
      (table) => ((row(table, 'save-a').typed as unknown[])[0] = 'a\nb'),
      'contains a line break'
    );
    rejects(
      (table) => ((row(table, 'save-a').typed as unknown[])[0] = { b64: '%%' }),
      'is not base64'
    );
    rejects(
      (table) => ((row(table, 'save-a').typed as unknown[])[0] = 1),
      'must be a string or {"b64"'
    );
    rejects((table) => (row(table, 'save-a').safeMode = 'yes'), '"safeMode" must be a boolean');
    rejects(
      (table) => Object.assign(row(table, 'save-a'), { feature: 'defer_all_js', safeMode: false }),
      '"safeMode" is a Delay JS setting'
    );
    rejects((table) => (row(table, 'save-a').stored = [1]), '"stored" must be an array of strings');
  });

  it('rejects inconsistent dropped lines', () => {
    const dropped = (table: { rows: Json[] }): Json[] => row(table, 'save-a').dropped as Json[];
    rejects((table) => (row(table, 'save-a').dropped = {}), '"dropped" must be an array');
    rejects((table) => (dropped(table)[0] = 'x' as unknown as Json), 'must be an object');
    rejects((table) => ((dropped(table)[0] as Json).extra = 1), 'unknown key "extra"');
    rejects((table) => ((dropped(table)[0] as Json).index = 9), 'is not an ascending index');
    rejects((table) => ((dropped(table)[1] as Json).index = 1), 'is not an ascending index');
    rejects((table) => ((dropped(table)[0] as Json).index = 'one'), 'is not an ascending index');
    rejects((table) => ((dropped(table)[0] as Json).row = 'a'), 'differs from the typed line');
    rejects(
      (table) => ((dropped(table)[1] as Json).row = { b64: 'AA==' }),
      'differs from the typed line'
    );
    rejects(
      (table) => ((dropped(table)[0] as Json).reason = 'gone'),
      'drop reason "gone" is unknown'
    );
    rejects(
      (table) =>
        Object.assign(row(table, 'save-a'), {
          safeMode: false,
          dropped: [{ index: 1, row: ' ', reason: 'safe-mode' }, dropped(table)[1]]
        }),
      'a safe-mode drop needs safeMode'
    );
    rejects((table) => (row(table, 'save-a').stored = ['a', 'b']), 'either stored or dropped');
  });

  it('rejects malformed match rows', () => {
    rejects((table) => (row(table, 'match-a').from = 1), '"from" must be a save row id');
    rejects(
      (table) => (row(table, 'match-a').from = 'match-b'),
      '"from" must name a save row of delay_js'
    );
    rejects(
      (table) => (row(table, 'match-a').feature = 'lazyload'),
      '"pending.owner" must be "K.4d"'
    );
    rejects(
      (table) => (row(table, 'match-b').filterOnly = false),
      '"filterOnly" is either true or absent'
    );
    rejects(
      (table) => (row(table, 'match-a').filterOnly = true),
      '"filterOnly" applies to authored rows'
    );
    rejects(
      (table) => (row(table, 'match-c').filterOnly = true),
      '"filterOnly" applies to authored rows'
    );
    rejects((table) => delete row(table, 'match-b').rows, '"rows" must be an array of strings');
    rejects((table) => (row(table, 'match-b').html = ''), '"html" must not be empty');
    rejects((table) => delete row(table, 'match-b').served, '"served" must be a string');
    rejects(
      (table) => (row(table, 'match-a').candidates = ['s1', 's1']),
      '"candidates" repeats an id'
    );
    rejects(
      (table) => (row(table, 'match-a').excluded = ['s3']),
      'excluded "s3" is not a candidate'
    );
    rejects(
      (table) => (row(table, 'match-a').candidates = ['s9']),
      'candidate "s9" is not a subject'
    );
    rejects((table) => delete row(table, 'match-a').subjects, '"subjects" is present exactly');
    rejects((table) => (row(table, 'match-c').subjects = []), '"subjects" is present exactly');
    rejects(
      (table) =>
        Object.assign(row(table, 'match-c'), {
          candidates: ['#0'],
          excluded: [],
          hashed: [],
          rekeyed: []
        }),
      'lazy rendering subjects are keyed by id'
    );
    rejects((table) => (row(table, 'match-b').engine = 'x'), '"engine" must be an object');
    rejects(
      (table) => (row(table, 'match-b').engine = { problem: 'nope' }),
      'engine problem "nope" is unknown'
    );
    rejects(
      (table) => (row(table, 'match-b').engine = { problem: 'pcre-only', extra: 1 }),
      'unknown key "extra"'
    );
    rejects(
      (table) => (row(table, 'match-b').engine = { problem: 'match-all' }),
      'engine problem "match-all" is a warning'
    );
    rejects(
      (table) => (row(table, 'match-b').engine = { warning: 'pcre-only' }),
      'engine warning "pcre-only" is blocking'
    );
    rejects(
      (table) => (row(table, 'match-b').engine = { warning: 'nope' }),
      'engine warning "nope" is unknown'
    );
    rejects(
      (table) => (row(table, 'match-b').engine = { residual: '', candidates: [], excluded: [] }),
      'engine residual must say why'
    );
    rejects(
      (table) => (row(table, 'match-b').engine = { residual: 'r', candidates: 'a', excluded: [] }),
      '"engine.candidates" must be an array of strings'
    );
    rejects(
      (table) =>
        (row(table, 'match-b').engine = { residual: 'r', candidates: ['a', 'a'], excluded: [] }),
      '"engine.candidates" repeats an id'
    );
    rejects(
      (table) =>
        (row(table, 'match-b').engine = { residual: 'r', candidates: ['a'], excluded: ['b'] }),
      'engine excluded "b" is not an engine candidate'
    );
    rejects(
      (table) => delete row(table, 'match-b').featureOff,
      '"featureOff" is present exactly on Defer JS rows'
    );
    rejects(
      (table) => (row(table, 'match-a').featureOff = false),
      '"featureOff" is present exactly on Defer JS rows'
    );
    rejects((table) => (row(table, 'match-b').featureOff = 'no'), '"featureOff" must be a boolean');
    rejects(
      (table) => delete row(table, 'match-b').inlineWrapped,
      '"inlineWrapped" is present exactly on Defer JS rows'
    );
    rejects(
      (table) => (row(table, 'match-a').inlineWrapped = []),
      '"inlineWrapped" is present exactly on Defer JS rows'
    );
    rejects(
      (table) => (row(table, 'match-b').inlineWrapped = ['x']),
      'inlineWrapped "x" is not a subject'
    );
    rejects(
      (table) => (row(table, 'match-b').inlineWrapped = ['w', 'w']),
      '"inlineWrapped" repeats an id'
    );
    for (const [id, value] of [
      ['match-b', ''],
      ['match-b', 5],
      ['match-a', 'needs live rows']
    ] as const) {
      rejects(
        (table) => (row(table, id).inlineUndetermined = value),
        '"inlineUndetermined" is a non-empty reason on a Defer JS row'
      );
    }
    expect(
      parseParityTable({
        ...validTable(),
        rows: validTable().rows.map((entry) =>
          entry.id === 'match-b' ? { ...entry, inlineUndetermined: 'needs live rows' } : entry
        )
      }).rows[2]
    ).toMatchObject({ inlineUndetermined: 'needs live rows' });
    rejects(
      (table) => (row(table, 'match-a').hashed = []),
      '"hashed"/"rekeyed" are present exactly'
    );
    rejects(
      (table) => delete row(table, 'match-c').rekeyed,
      '"hashed"/"rekeyed" are present exactly'
    );
    rejects((table) => (row(table, 'match-c').rekeyed = ['a']), 'rekeyed "a" is not hashed');
    rejects(
      (table) => (row(table, 'match-a').rows = ['b']),
      '"rows" must equal the stored rows of "save-a"'
    );
  });
});

describe('parseParityInputs', () => {
  it('reads the authored inputs of a table without outputs or header', () => {
    const inputs = parseParityInputs({
      rows: [
        { id: 'save-a', kind: 'save', feature: 'lazyload', typed: ['a'] },
        { id: 'match-a', kind: 'match', feature: 'lazyload', from: 'save-a', html: 'h' }
      ]
    });
    expect(inputs).toEqual([
      { id: 'save-a', kind: 'save', feature: 'lazyload', typed: ['a'] },
      { id: 'match-a', kind: 'match', feature: 'lazyload', from: 'save-a', html: 'h' }
    ]);
  });
});

describe('comparedFields', () => {
  it('lists the fields the replay compares per row shape', () => {
    expect(comparedFields({ kind: 'save', feature: 'delay_js' })).toEqual(['stored', 'dropped']);
    expect(comparedFields({ kind: 'match', feature: 'delay_js' })).toEqual([
      'candidates',
      'excluded'
    ]);
    expect(comparedFields({ kind: 'match', feature: 'defer_all_js' })).toEqual([
      'candidates',
      'excluded',
      'featureOff',
      'inlineWrapped'
    ]);
    expect(comparedFields({ kind: 'match', feature: 'automatic_lazy_rendering' })).toEqual([
      'candidates',
      'excluded',
      'hashed',
      'rekeyed'
    ]);
    expect(
      comparedFields({ kind: 'match', feature: 'defer_all_js', engine: { problem: 'pcre-only' } })
    ).toEqual(['problems']);
    // A warning: WP Rocket's outcome is asserted, and so is the warning.
    expect(
      comparedFields({
        kind: 'match',
        feature: 'defer_all_js',
        engine: { warning: 'joined-page-off' }
      })
    ).toEqual(['candidates', 'excluded', 'featureOff', 'inlineWrapped', 'warnings']);
    expect(
      comparedFields({ kind: 'match', feature: 'delay_js', engine: { warning: 'match-all' } })
    ).toEqual(['candidates', 'excluded', 'warnings']);
    expect(
      comparedFields({
        kind: 'match',
        feature: 'automatic_lazy_rendering',
        engine: { warning: 'match-all' }
      })
    ).toEqual(['candidates', 'excluded', 'hashed', 'rekeyed', 'warnings']);
    expect(
      comparedFields({
        kind: 'match',
        feature: 'lazyload',
        engine: { residual: 'r', candidates: [], excluded: [] }
      })
    ).toEqual(['candidates', 'excluded']);
  });
});

describe('pendingOwner', () => {
  it('maps each row kind/feature to the sub-phase that flips it', () => {
    expect(pendingOwner('save', 'lazyload')).toBe('K.3');
    expect(pendingOwner('match', 'delay_js')).toBe('K.4b');
    expect(pendingOwner('match', 'defer_all_js')).toBe('K.4c');
    expect(pendingOwner('match', 'lazyload')).toBe('K.4d');
    expect(pendingOwner('match', 'automatic_lazy_rendering')).toBe('K.4d');
  });
});

describe('typedLineBytes', () => {
  it('encodes text as UTF-8 and decodes base64 lines to their bytes', () => {
    expect([...typedLineBytes('é')]).toEqual([0xc3, 0xa9]);
    expect([...typedLineBytes({ b64: '/2Jh' })]).toEqual([0xff, 0x62, 0x61]);
  });
});
