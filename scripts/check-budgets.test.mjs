import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  buildDirectory,
  markerProblems,
  matchesGlob,
  measureRow,
  requiredGlobProblems,
  measureSurface,
  parseBudgetRows,
  readPinnedNode,
  rowFiles,
  runtimeProblem,
  startOverlaps
} from './check-budgets.mjs';

/* Pure pieces of the budget gate (incl. the per-row outcome `measureRow`); the CLI `main()` (output discovery + table
 * printing) is thin glue and stays untested. */

describe('runtimeProblem', () => {
  it('accepts the pinned major only (its zlib measures gzip sizes)', () => {
    expect(runtimeProblem('v24.21.0', '24\n')).toBeNull();
    expect(runtimeProblem('v24.1.0', 'v24')).toBeNull();
    expect(runtimeProblem('v26.12.1', '24\n')).toBe(
      'Node v26.12.1 measures gzip with its own zlib; run with Node 24 (.nvmrc)'
    );
    expect(runtimeProblem('v24.21.0', 'lts/*')).toBe('.nvmrc holds no Node major (got "lts/*")');
    // No file: an actionable refusal, never a raw ENOENT.
    expect(readPinnedNode('/nonexistent/.nvmrc')).toBeNull();
    expect(runtimeProblem('v24.21.0', null)).toBe(
      '.nvmrc is missing or unreadable at the package root: it pins the Node major gzip sizes are measured with'
    );
  });
});

describe('matchesGlob', () => {
  it('matches exact paths', () => {
    expect(matchesGlob('background.js', 'background.js')).toBe(true);
    expect(matchesGlob('background.js', 'foo.js')).toBe(false);
  });

  it('keeps `*` within one path segment', () => {
    expect(matchesGlob('chunks/options-BptklVxT.js', 'chunks/options-*.js')).toBe(true);
    expect(matchesGlob('chunks/options.js', 'chunks/options-*.js')).toBe(false);
    expect(matchesGlob('chunks/nested/options-x.js', 'chunks/options-*.js')).toBe(false);
    expect(matchesGlob('chunks/nested/options-x.js', 'chunks/*/options-*.js')).toBe(true);
  });

  it('matches the committed content-script globs', () => {
    expect(matchesGlob('content-scripts/isolated.content.js', 'content-scripts/isolated*.js')).toBe(
      true
    );
    expect(
      matchesGlob('content-scripts/main-world.content.js', 'content-scripts/main-world*.js')
    ).toBe(true);
    expect(
      matchesGlob('content-scripts/isolated.content.js', 'content-scripts/main-world*.js')
    ).toBe(false);
  });

  it('rejects different depth regardless of segment shapes', () => {
    expect(matchesGlob('background.js', 'chunks/background-*.js')).toBe(false);
  });
});

describe('measureSurface', () => {
  // 2 KB of a compressible pattern + 1 KB of another, both in-memory.
  const sampleContents = [
    { path: 'chunks/options-x.js', body: 'a'.repeat(2048) },
    { path: 'chunks/options-y.js', body: 'b'.repeat(1024) },
    { path: 'chunks/other-x.js', body: 'c'.repeat(4096) }
  ];
  const fileContents = new Map(sampleContents.map(({ path, body }) => [path, Buffer.from(body)]));
  const readFile = (path) => {
    const content = fileContents.get(path);
    if (!content) throw new Error(`test sample missing: ${path}`);
    return content;
  };

  it('sums raw bytes over all matching files and reports them', () => {
    const { rawBytes, files: matched } = measureSurface(
      sampleContents.map(({ path }) => path),
      ['chunks/options-*.js'],
      readFile
    );
    expect(matched).toEqual(['chunks/options-x.js', 'chunks/options-y.js']);
    expect(rawBytes).toBe(3072);
  });

  it('sums gzip bytes per file', () => {
    const expectedGzip = [...fileContents]
      .filter(([path]) => path.startsWith('chunks/options-'))
      .reduce((total, [, content]) => total + gzipSync(content).length, 0);
    const { gzipBytes } = measureSurface(
      sampleContents.map(({ path }) => path),
      ['chunks/options-*.js'],
      readFile
    );
    expect(gzipBytes).toBe(expectedGzip);
    expect(gzipBytes).toBeGreaterThan(0);
    expect(gzipBytes).toBeLessThanOrEqual(3072);
  });

  it('returns zero totals when nothing matches', () => {
    const { rawBytes, gzipBytes, files } = measureSurface(
      ['chunks/other-x.js'],
      ['chunks/options-*.js'],
      readFile
    );
    expect(files).toEqual([]);
    expect(rawBytes).toBe(0);
    expect(gzipBytes).toBe(0);
  });
});

describe('parseBudgetRows', () => {
  /** A valid bytes row (the default kind every pre-existing row used). */
  const bytesRow = {
    surface: 'options JS',
    globs: ['chunks/options-*.js'],
    maxKb: { raw: 50 }
  };
  /** A valid timing row (the runtime-facing kind). */
  const timingRow = {
    surface: 'panel cold-start (harness fixture)',
    kind: 'timing',
    maxMs: 500,
    measuredBy: 'the cold-start harness spec'
  };

  it('parses kindless rows as bytes rows', () => {
    expect(parseBudgetRows([bytesRow])).toEqual([
      { ...bytesRow, kind: 'bytes' } // normalization adds the kind
    ]);
  });

  it('treats an explicit bytes kind identically', () => {
    expect(parseBudgetRows([{ ...bytesRow, kind: 'bytes' }])).toEqual(parseBudgetRows([bytesRow]));
  });

  it('accepts a well-formed timing row', () => {
    expect(parseBudgetRows([bytesRow, timingRow])).toEqual([
      { ...bytesRow, kind: 'bytes' },
      timingRow
    ]);
  });

  it('accepts a bytes row measured on the Firefox build', () => {
    const firefoxRow = { ...bytesRow, build: 'firefox-mv2' };
    expect(parseBudgetRows([firefoxRow])).toEqual([{ ...firefoxRow, kind: 'bytes' }]);
    expect(parseBudgetRows([{ ...bytesRow, build: 'chrome-mv3' }])[0].build).toBe('chrome-mv3');
  });

  it('rejects an unknown build, and a build on a timing row, naming the row', () => {
    expect(() => parseBudgetRows([{ ...bytesRow, build: 'safari' }])).toThrow(
      /#0 \(options JS\) build must be one of chrome-mv3, firefox-mv2/
    );
    expect(() => parseBudgetRows([{ ...timingRow, build: 'firefox-mv2' }])).toThrow(
      /timing row .* cannot carry build/
    );
  });

  it('names the build directory each row is measured in (Chromium by default)', () => {
    expect(buildDirectory({ build: 'firefox-mv2' })).toBe('firefox-mv2');
    expect(buildDirectory({})).toBe('chrome-mv3');
  });

  it('still rejects the old bytes-row malformations', () => {
    expect(() => parseBudgetRows([{ ...bytesRow, globs: [] }])).toThrow(/globs/i);
    expect(() => parseBudgetRows([{ ...bytesRow, maxKb: {} }])).toThrow(/maxKb/i);
    expect(() => parseBudgetRows('not an array')).toThrow('must contain an array');
  });

  it('rejects an unknown kind naming the row', () => {
    expect(() => parseBudgetRows([{ ...timingRow, kind: 'ms' }])).toThrow(
      /kind must be "bytes" or "timing"/
    );
  });

  it('rejects timing rows with a broken ceiling or runner, naming the row', () => {
    const broken = [
      { ...timingRow, maxMs: 0 },
      { ...timingRow, maxMs: -500 },
      { ...timingRow, maxMs: Number.POSITIVE_INFINITY },
      { ...timingRow, maxMs: '500' },
      { ...timingRow, maxMs: undefined },
      { ...timingRow, measuredBy: '' },
      { ...timingRow, measuredBy: undefined }
    ];
    for (const row of broken) {
      expect(() => parseBudgetRows([bytesRow, row])).toThrow(/panel cold-start/);
    }
  });

  it('rejects timing rows that carry bundle fields (a mixed row would measure nothing)', () => {
    expect(() => parseBudgetRows([{ ...timingRow, globs: ['panel.js'] }])).toThrow(
      /timing row.*globs/
    );
    expect(() => parseBudgetRows([{ ...timingRow, maxKb: { raw: 600 } }])).toThrow(
      /timing row.*maxKb/
    );
  });

  it('rejects unknown fields on either kind, naming the row and the field (a typo is never ignored)', () => {
    expect(() => parseBudgetRows([{ ...bytesRow, mustNotContains: ['a'] }])).toThrow(
      /#0 \(options JS\) carries unknown field "mustNotContains"/
    );
    expect(() => parseBudgetRows([{ ...timingRow, maxMS: 1 }])).toThrow(
      /carries unknown field "maxMS"/
    );
  });

  it('parses every committed row (each of its fields is a known one)', () => {
    const raw = JSON.parse(readFileSync('scripts/budgets.json', 'utf8'));
    expect(parseBudgetRows(raw)).toHaveLength(raw.length);
  });

  it('rejects bytes rows that carry timing fields (dead letters would read like maxima)', () => {
    expect(() => parseBudgetRows([{ ...bytesRow, maxMs: 500 }])).toThrow(/bytes row.*maxMs/);
    expect(() => parseBudgetRows([{ ...bytesRow, measuredBy: 'a runner' }])).toThrow(
      /bytes row.*measuredBy/
    );
  });
});

describe('measureRow', () => {
  const row = { kind: 'bytes', surface: 'worker', globs: ['w.js'], maxKb: { raw: 1 } };
  const reader = () => Buffer.alloc(100);

  it('skips a row whose (optional) build is absent instead of failing it', () => {
    const filesOf = (build) => (build === 'chrome-mv3' ? ['w.js'] : null);
    expect(measureRow({ ...row, build: 'firefox-mv2' }, filesOf, () => reader)).toEqual({
      status: 'skipped',
      build: 'firefox-mv2'
    });
  });

  it('reports a surface absent from a present build', () => {
    expect(
      measureRow(
        row,
        () => ['other.js'],
        () => reader
      )
    ).toEqual({ status: 'absent' });
  });

  it('measures a row in its own build and flags a breach', () => {
    const builds = [];
    const measured = measureRow(
      { ...row, build: 'firefox-mv2', maxKb: { raw: 0.05, gzip: 1 } },
      (build) => {
        builds.push(build);
        return ['w.js'];
      },
      (build) => {
        builds.push(`read:${build}`);
        return reader;
      }
    );
    expect(builds).toEqual(['firefox-mv2', 'read:firefox-mv2']);
    expect(measured).toMatchObject({
      status: 'measured',
      rawBytes: 100,
      rawOver: true,
      gzipOver: false
    });
  });
});

describe('marker rows', () => {
  const base = {
    kind: 'bytes',
    surface: 'background',
    globs: ['bg.js'],
    maxKb: { raw: 10 },
    required: true
  };
  const engine = Buffer.from('x={stopAfter:1,spanning:2}');
  const clean = Buffer.from('x={other:1}');
  /** A reader over named in-memory files. */
  const readerOf = (map) => (path) => map[path];

  it('flags each forbidden marker a file holds, naming file and marker', () => {
    const row = { ...base, mustNotContain: ['stopAfter', 'spanning:', 'absent'] };
    expect(markerProblems(row, ['bg.js'], readerOf({ 'bg.js': engine }))).toEqual([
      'bg.js contains forbidden marker "stopAfter"',
      'bg.js contains forbidden marker "spanning:"'
    ]);
    expect(markerProblems(row, ['bg.js'], readerOf({ 'bg.js': clean }))).toEqual([]);
  });

  it('flags a required marker none of the files holds (a renamed marker fails, never passes vacuously)', () => {
    const row = { ...base, globs: ['a.js', 'b.js'], mustContain: ['stopAfter', 'renamed'] };
    expect(
      markerProblems(row, ['a.js', 'b.js'], readerOf({ 'a.js': clean, 'b.js': engine }))
    ).toEqual(['required marker "renamed" is in none of a.js, b.js']);
  });

  it('reads no file for a row without markers', () => {
    expect(
      markerProblems(base, ['bg.js'], () => {
        throw new Error('read');
      })
    ).toEqual([]);
  });

  it('carries marker breaches on a measured row, empty when clean', () => {
    const row = { ...base, mustNotContain: ['stopAfter'] };
    expect(
      measureRow(
        row,
        () => ['bg.js'],
        () => readerOf({ 'bg.js': engine })
      )
    ).toMatchObject({
      status: 'measured',
      rawOver: false,
      markerProblems: ['bg.js contains forbidden marker "stopAfter"']
    });
    expect(
      measureRow(
        row,
        () => ['bg.js'],
        () => readerOf({ 'bg.js': clean })
      )
    ).toMatchObject({ status: 'measured', markerProblems: [] });
  });

  it('pairs every forbidden marker of the committed table with a bundle that must ship it', () => {
    const rows = parseBudgetRows(JSON.parse(readFileSync('scripts/budgets.json', 'utf8')));
    const forbidden = rows.flatMap((row) => row.mustNotContain ?? []);
    const required = new Set(rows.flatMap((row) => row.mustContain ?? []));
    expect(forbidden.length).toBeGreaterThan(0);
    expect(forbidden.filter((marker) => !required.has(marker))).toEqual([]);
  });

  it('parses marker lists and rejects malformed ones, on start rows and on timing rows', () => {
    const parsed = parseBudgetRows([{ ...base, mustNotContain: ['a'], mustContain: ['b'] }]);
    expect(parsed[0]).toMatchObject({ mustNotContain: ['a'], mustContain: ['b'] });
    for (const markers of [[], [''], ['  '], [1], 'a']) {
      expect(() => parseBudgetRows([{ ...base, mustNotContain: markers }])).toThrow(
        /#0 \(background\) mustNotContain must be a non-empty array of non-empty strings/
      );
      expect(() => parseBudgetRows([{ ...base, mustContain: markers }])).toThrow(
        /mustContain must be a non-empty array/
      );
    }
    const { globs: _globs, ...startRow } = { ...base, start: 'panel.html' };
    expect(() => parseBudgetRows([{ ...startRow, mustNotContain: ['a'] }])).toThrow(
      /start row — name marker files by globs, not mustNotContain/
    );
    expect(() =>
      parseBudgetRows([
        { surface: 't', kind: 'timing', maxMs: 1, measuredBy: 'a spec', mustContain: ['a'] }
      ])
    ).toThrow(/timing row.*cannot carry mustContain/);
  });

  it('rejects marker lists on a row that is not required (an absent file would pass vacuously)', () => {
    const { required: _required, ...optional } = base;
    for (const field of ['mustNotContain', 'mustContain']) {
      expect(() => parseBudgetRows([{ ...optional, [field]: ['a'] }])).toThrow(
        new RegExp(`#0 \\(background\\) carries ${field} — a marker row must be required: true`)
      );
    }
  });
});

describe('required rows', () => {
  const row = {
    kind: 'bytes',
    surface: 'data',
    globs: ['data/d.json'],
    maxKb: { raw: 1 },
    required: true
  };
  const reader = () => Buffer.alloc(100);

  it('parses required: true on a bytes row; rejects any other value and timing rows carrying it', () => {
    expect(parseBudgetRows([row])).toEqual([row]);
    expect(() => parseBudgetRows([{ ...row, required: false }])).toThrow(
      /required must be true when present/
    );
    expect(() => parseBudgetRows([{ ...row, required: 'yes' }])).toThrow(
      /required must be true when present/
    );
    expect(() =>
      parseBudgetRows([
        { surface: 't', kind: 'timing', maxMs: 5, measuredBy: 'a spec', required: true }
      ])
    ).toThrow(/timing row.*required/);
  });

  it('names each glob that does not match exactly one file, with its count', () => {
    expect(requiredGlobProblems(['a.js', 'b-1.js', 'b-2.js'], ['a.js', 'b-*.js', 'c.js'])).toEqual([
      { glob: 'b-*.js', matched: 2 },
      { glob: 'c.js', matched: 0 }
    ]);
    expect(requiredGlobProblems(['a.js'], ['a.js'])).toEqual([]);
  });

  it('fails a required row whose file is missing (renamed or moved) instead of reading it absent', () => {
    expect(
      measureRow(
        row,
        () => ['data/other.json'],
        () => reader
      )
    ).toEqual({ status: 'unmatched', problems: [{ glob: 'data/d.json', matched: 0 }] });
  });

  it('fails a required row whose glob matches more than one file', () => {
    expect(
      measureRow(
        { ...row, globs: ['data/*.json'] },
        () => ['data/d.json', 'data/d2.json'],
        () => reader
      )
    ).toEqual({ status: 'unmatched', problems: [{ glob: 'data/*.json', matched: 2 }] });
  });

  it('measures a required row that matches exactly once, and still skips it while its build is absent', () => {
    expect(
      measureRow(
        row,
        () => ['data/d.json'],
        () => reader
      )
    ).toMatchObject({ status: 'measured', rawBytes: 100, rawOver: false });
    expect(
      measureRow(
        { ...row, build: 'firefox-mv2' },
        () => null,
        () => reader
      )
    ).toEqual({ status: 'skipped', build: 'firefox-mv2' });
  });
});

describe('start rows', () => {
  const row = { kind: 'bytes', surface: 'panel start', start: 'panel.html', maxKb: { raw: 1 } };
  /** A built page, its entry and the entry's one static import (plus a lazy chunk). */
  const contents = new Map([
    ['panel.html', Buffer.from('<script type="module" src="/chunks/panel-A.js"></script>')],
    ['chunks/panel-A.js', Buffer.from('import"./shared-B.js";const l=()=>import("./lazy-C.js");')],
    // 300 bytes of valid JS: start chunks are parsed, so filler must be code, not NUL bytes.
    ['chunks/shared-B.js', Buffer.from('export const b=1;'.padEnd(300))],
    ['chunks/lazy-C.js', Buffer.alloc(5000)]
  ]);
  const files = [...contents.keys()];
  const reader = () => (path) => contents.get(path) ?? Buffer.alloc(0);

  it('parses a start row; rejects one that also names globs, required or backstop, or no page', () => {
    expect(parseBudgetRows([row])).toEqual([row]);
    expect(() => parseBudgetRows([{ ...row, globs: ['panel.js'] }])).toThrow(
      /carries start and globs/
    );
    expect(() => parseBudgetRows([{ ...row, required: true }])).toThrow(
      /start row .* cannot carry required/
    );
    expect(() => parseBudgetRows([{ ...row, backstop: true }])).toThrow(
      /start row .* cannot carry backstop/
    );
    for (const start of ['', '/panel.html', 'panel.js', 7]) {
      expect(() => parseBudgetRows([{ ...row, start }])).toThrow(/start must name a built page/);
    }
    expect(() =>
      parseBudgetRows([
        { surface: 't', kind: 'timing', maxMs: 5, measuredBy: 'a spec', start: 'a.html' }
      ])
    ).toThrow(/timing row.*start/);
  });

  it('accepts backstop: true on a glob row only', () => {
    const backstop = { surface: 'all', globs: ['*.js'], maxKb: { raw: 9 }, backstop: true };
    expect(parseBudgetRows([backstop])).toEqual([{ ...backstop, kind: 'bytes' }]);
    expect(() => parseBudgetRows([{ ...backstop, backstop: false }])).toThrow(
      /backstop must be true when present/
    );
    expect(() =>
      parseBudgetRows([
        { surface: 't', kind: 'timing', maxMs: 5, measuredBy: 'a spec', backstop: true }
      ])
    ).toThrow(/timing row.*backstop/);
  });

  it('measures the derived start set only (the lazy chunk stays out) and names its files', () => {
    expect(rowFiles(row, files, reader())).toEqual({
      files: ['chunks/panel-A.js', 'chunks/shared-B.js'],
      problems: []
    });
    const measured = measureRow(row, () => files, reader);
    const entryBytes = contents.get('chunks/panel-A.js').length;
    expect(measured).toMatchObject({
      status: 'measured',
      rawBytes: entryBytes + 300,
      files: ['chunks/panel-A.js', 'chunks/shared-B.js'],
      rawOver: false
    });
  });

  it('fails a start row whose set cannot be resolved instead of measuring part of it', () => {
    expect(
      measureRow(row, () => files.filter((file) => file !== 'chunks/shared-B.js'), reader)
    ).toEqual({
      status: 'broken',
      problems: ['chunks/panel-A.js loads ./shared-B.js: chunks/shared-B.js is not in the build']
    });
    expect(measureRow(row, () => [], reader)).toEqual({
      status: 'broken',
      problems: ['panel.html is not in the build']
    });
  });

  it('fails a start row whose chunk does not parse, naming the chunk and its first error', () => {
    const broken = new Map(contents).set('chunks/shared-B.js', Buffer.from('{{{ import"./x.js";'));
    expect(
      measureRow(
        row,
        () => files,
        () => (path) => broken.get(path)
      )
    ).toEqual({
      status: 'broken',
      problems: [
        "chunks/shared-B.js does not parse (1:20 '}' expected.): its imports cannot be read"
      ]
    });
  });

  it('still skips a start row while its build is absent', () => {
    expect(measureRow({ ...row, build: 'firefox-mv2' }, () => null, reader)).toEqual({
      status: 'skipped',
      build: 'firefox-mv2'
    });
  });

  it('flags a start file another row counts, except a backstop or another start row', () => {
    const start = ['chunks/panel-A.js', 'chunks/stylesheets-S.js'];
    expect(
      startOverlaps('panel start', start, [
        { surface: 'Stylesheets page', globs: ['chunks/stylesheets-*.js'] },
        { surface: 'options JS', globs: ['chunks/options-*.js'] },
        { surface: 'whole build', globs: ['chunks/*.js'], backstop: true },
        { surface: 'options start', start: 'options.html' }
      ])
    ).toEqual([
      'chunks/stylesheets-S.js is in the start set of "panel start" and also counted by "Stylesheets page"'
    ]);
    expect(startOverlaps('panel start', start, [])).toEqual([]);
  });
});
