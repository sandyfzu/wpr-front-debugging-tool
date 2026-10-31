/**
 * Version-keyed expectations of the parity tables: strict parse, per-version
 * resolution, and the writer that records only where builds differ.
 */
import { describe, expect, it } from 'vitest';
import {
  VERSION_EXPECTATIONS_KEY,
  expectationsFor,
  parseVersionExpectations,
  withVersionExpectations,
  type VersionedRow
} from './parity-version-expectations';

/** Throws the parse problem as is (the table parsers prefix their own label). */
const fail = (problem: string): never => {
  throw new Error(problem);
};

/** Parse `byVersion` of a row whose only output is `served`, reference 3.24. */
const parse = (row: Record<string, unknown>): unknown =>
  parseVersionExpectations(row, ['served'], '3.24', fail);

describe('parseVersionExpectations', () => {
  it('is undefined without the key and keeps a valid override', () => {
    expect(VERSION_EXPECTATIONS_KEY).toBe('byVersion');
    expect(parse({ served: 'a' })).toBeUndefined();
    expect(parse({ served: 'a', byVersion: { '3.23.5.1': { served: 'b' } } })).toEqual({
      '3.23.5.1': { served: 'b' }
    });
  });

  it('rejects every malformed shape, naming it', () => {
    const rejects = (byVersion: unknown, problem: string): void => {
      expect(() => parse({ served: 'a', byVersion })).toThrow(problem);
    };
    rejects(null, '"byVersion" must be a non-empty object');
    rejects({}, '"byVersion" must be a non-empty object');
    rejects({ '3.24': { served: 'b' } }, 'must not name the reference version 3.24');
    rejects({ '3.0': { served: 'b' } }, 'key "3.0" is not a supported WP Rocket version');
    rejects({ '3.23.5.1': {} }, '"byVersion".3.23.5.1 must be a non-empty object');
    rejects({ '3.23.5.1': 'b' }, '"byVersion".3.23.5.1 must be a non-empty object');
    rejects({ '3.23.5.1': { html: 'b' } }, 'has "html", which is not an output of this row');
    rejects({ '3.23.5.1': { served: 'a' } }, "equals the row's own value (write only differences)");
  });

  it('accepts null (the field is absent for that version) only for a field the row has', () => {
    expect(parse({ served: 'a', byVersion: { '3.23.5.1': { served: null } } })).toEqual({
      '3.23.5.1': { served: null }
    });
    expect(() => parse({ byVersion: { '3.23.5.1': { served: null } } })).toThrow(
      '"byVersion".3.23.5.1.served is null, but the row has no "served" to remove'
    );
  });

  it('compares values regardless of object key order', () => {
    const row = { served: { a: 1, b: [{ c: 1, d: 2 }] } };
    expect(() =>
      parse({ ...row, byVersion: { '3.23.5.1': { served: { b: [{ d: 2, c: 1 }], a: 1 } } } })
    ).toThrow("equals the row's own value");
  });

  it('takes the supported versions as a parameter', () => {
    const supported = [
      { version: '9.1', zipSha256: '', role: 'latest-stable', variants: {} },
      { version: '9.0', zipSha256: '', role: 'previous-minor', variants: {} }
    ] as const;
    const row = { served: 'a', byVersion: { '9.0': { served: 'b' } } };
    expect(parseVersionExpectations(row, ['served'], '9.1', fail, supported as never)).toEqual({
      '9.0': { served: 'b' }
    });
  });
});

describe('expectationsFor', () => {
  const row = { id: 'r', served: 'a', byVersion: { '3.23.5.1': { served: 'b' } } };

  it('applies the version overrides and drops the key', () => {
    expect(expectationsFor(row, '3.23.5.1')).toEqual({ id: 'r', served: 'b' });
  });

  it('removes a field a version overrides with null', () => {
    const absent = { id: 'r', served: 'a', byVersion: { '3.23.5.1': { served: null } } };
    expect(expectationsFor(absent, '3.23.5.1')).toEqual({ id: 'r' });
    expect(expectationsFor(absent, '3.24')).toEqual({ id: 'r', served: 'a' });
  });

  it('gives the reference (or any version without an entry) the top-level outputs', () => {
    expect(expectationsFor(row, '3.24')).toEqual({ id: 'r', served: 'a' });
    const plain: VersionedRow & { readonly id: string; readonly served: string } = {
      id: 'r',
      served: 'a'
    };
    expect(expectationsFor(plain, '3.23.5.1')).toEqual({ id: 'r', served: 'a' });
  });
});

describe('withVersionExpectations', () => {
  const outputs = (): readonly string[] => ['served'];

  it('records only the differing outputs, per version in the given order', () => {
    const reference = [
      { id: 'a', html: 'h', served: '1' },
      { id: 'b', html: 'h', served: '2' }
    ];
    const rows = withVersionExpectations(
      reference,
      [
        {
          version: '3.23.5.1',
          rows: [
            { id: 'a', html: 'h', served: '1' },
            { id: 'b', html: 'h', served: '3' }
          ]
        },
        {
          version: '3.22',
          rows: [
            { id: 'a', html: 'h', served: '1' },
            { id: 'b', html: 'h', served: '4' }
          ]
        }
      ],
      outputs
    );
    expect(rows).toEqual([
      { id: 'a', html: 'h', served: '1' },
      {
        id: 'b',
        html: 'h',
        served: '2',
        byVersion: { '3.23.5.1': { served: '3' }, '3.22': { served: '4' } }
      }
    ]);
    expect(Object.keys(rows[1] ?? {})).toEqual(['id', 'html', 'served', 'byVersion']);
  });

  it('records an output only one build has', () => {
    const rows = withVersionExpectations(
      [{ id: 'a' }],
      [{ version: '3.23.5.1', rows: [{ id: 'a', served: 'x' }] }],
      outputs
    );
    expect(rows).toEqual([{ id: 'a', byVersion: { '3.23.5.1': { served: 'x' } } }]);
  });

  it('records an output another build lacks as null, which round-trips through JSON', () => {
    const rows = withVersionExpectations(
      [{ id: 'a', served: 'x' }],
      [{ version: '3.23.5.1', rows: [{ id: 'a' }] }],
      outputs
    );
    expect(rows).toEqual([{ id: 'a', served: 'x', byVersion: { '3.23.5.1': { served: null } } }]);
    const [read] = JSON.parse(JSON.stringify(rows)) as [Record<string, unknown>];
    expect(parse(read)).toEqual({ '3.23.5.1': { served: null } });
    expect(expectationsFor(read as VersionedRow, '3.23.5.1')).toEqual({ id: 'a' });
  });

  it('treats objects equal up to key order as no difference', () => {
    const rows = withVersionExpectations(
      [{ id: 'a', served: { p: 1, q: 2 } }],
      [{ version: '3.23.5.1', rows: [{ id: 'a', served: { q: 2, p: 1 } }] }],
      outputs
    );
    expect(rows).toEqual([{ id: 'a', served: { p: 1, q: 2 } }]);
  });

  it('fails on another row set or a differing input', () => {
    const reference = [{ id: 'a', html: 'h', served: '1' }];
    expect(() =>
      withVersionExpectations(reference, [{ version: '3.23.5.1', rows: [] }], outputs)
    ).toThrow('WP Rocket 3.23.5.1 derives another row set (at "a")');
    expect(() =>
      withVersionExpectations(
        reference,
        [{ version: '3.23.5.1', rows: [{ id: 'b', html: 'h', served: '1' }] }],
        outputs
      )
    ).toThrow('derives another row set (at "a")');
    expect(() =>
      withVersionExpectations(
        reference,
        [{ version: '3.23.5.1', rows: [{ id: 'a', html: 'x', served: '1' }] }],
        outputs
      )
    ).toThrow('WP Rocket 3.23.5.1: a.html differs but is not an output');
  });
});
