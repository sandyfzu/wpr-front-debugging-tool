import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  buildDirectory,
  matchesGlob,
  measureRow,
  measureSurface,
  parseBudgetRows,
  readPinnedNode,
  runtimeProblem
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
    expect(matchesGlob('chunks/popup-BptklVxT.js', 'chunks/popup-*.js')).toBe(true);
    expect(matchesGlob('chunks/popup.js', 'chunks/popup-*.js')).toBe(false);
    expect(matchesGlob('chunks/nested/popup-x.js', 'chunks/popup-*.js')).toBe(false);
    expect(matchesGlob('chunks/nested/popup-x.js', 'chunks/*/popup-*.js')).toBe(true);
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
    { path: 'chunks/popup-x.js', body: 'a'.repeat(2048) },
    { path: 'chunks/popup-y.js', body: 'b'.repeat(1024) },
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
      ['chunks/popup-*.js'],
      readFile
    );
    expect(matched).toEqual(['chunks/popup-x.js', 'chunks/popup-y.js']);
    expect(rawBytes).toBe(3072);
  });

  it('sums gzip bytes per file', () => {
    const expectedGzip = [...fileContents]
      .filter(([path]) => path.startsWith('chunks/popup-'))
      .reduce((total, [, content]) => total + gzipSync(content).length, 0);
    const { gzipBytes } = measureSurface(
      sampleContents.map(({ path }) => path),
      ['chunks/popup-*.js'],
      readFile
    );
    expect(gzipBytes).toBe(expectedGzip);
    expect(gzipBytes).toBeGreaterThan(0);
    expect(gzipBytes).toBeLessThanOrEqual(3072);
  });

  it('returns zero totals when nothing matches', () => {
    const { rawBytes, gzipBytes, files } = measureSurface(
      ['chunks/other-x.js'],
      ['chunks/popup-*.js'],
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
    surface: 'popup JS',
    globs: ['chunks/popup-*.js'],
    maxKb: { raw: 50 }
  };
  /** A valid timing row (the runtime-facing kind). */
  const timingRow = {
    surface: 'panel cold-start (harness fixture)',
    kind: 'timing',
    maxMs: 500,
    measuredBy: 'the P5.1 harness spec'
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
      /#0 \(popup JS\) build must be one of chrome-mv3, firefox-mv2/
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
