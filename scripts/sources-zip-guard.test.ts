import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertCleanSources,
  execText,
  gitTopLevel,
  LISTED_FILES_MAX,
  parseNulList,
  runGit,
  TOP_LEVEL_ARGS,
  UNTRACKED_ARGS,
  untrackedSources,
  untrackedSourcesError,
  type GitRunner
} from './sources-zip-guard';

/** A thrower shaped like `execFileSync`'s failure, with `stderr` attached. */
function gitFailure(stderr: string): Error {
  return Object.assign(new Error('Command failed: git'), { stderr });
}

/** A git runner that always fails with `stderr`. */
function failingGit(stderr: string): GitRunner {
  return () => {
    throw gitFailure(stderr);
  };
}

/**
 * A git runner answering the two calls the guard makes.
 *
 * @param topLevel - What `rev-parse --show-toplevel` prints.
 * @param untracked - What `ls-files` prints, or a function that throws.
 */
function fakeGit(topLevel: string, untracked: string | (() => never)): GitRunner {
  return (args) => {
    if (args[0] === 'rev-parse') return `${topLevel}\n`;
    return typeof untracked === 'string' ? untracked : untracked();
  };
}

/** Identity: fake paths need no canonicalization. */
const samePath = (target: string): string => target;

/** Runs `body` with a fresh temporary folder (canonical path), then removes it. */
function withTempDir(body: (dir: string) => void): void {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'wpr-fdt-sources-')));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('parseNulList', () => {
  it('splits, drops empties and sorts', () => {
    expect(parseNulList('b.txt\0a dir/x.md\0\0')).toEqual(['a dir/x.md', 'b.txt']);
    expect(parseNulList('')).toEqual([]);
  });
});

describe('execText', () => {
  it('returns stdout larger than the 1 MiB default when the ceiling allows it', () => {
    const script = "process.stdout.write('x'.repeat(2 * 1024 * 1024))";
    expect(execText(process.execPath, ['-e', script], tmpdir(), 4 * 1024 * 1024)).toHaveLength(
      2 * 1024 * 1024
    );
  });

  it('throws ENOBUFS beyond the ceiling', () => {
    const script = "process.stdout.write('x'.repeat(4096))";
    expect(() => execText(process.execPath, ['-e', script], tmpdir(), 1024)).toThrow(/ENOBUFS/);
  });
});

describe('gitTopLevel', () => {
  it('returns the trimmed top level', () => {
    const calls: (readonly string[])[] = [];
    const git: GitRunner = (args) => {
      calls.push(args);
      return '/repo\n';
    };
    expect(gitTopLevel('/repo/sub', git)).toBe('/repo');
    expect(calls).toEqual([TOP_LEVEL_ARGS]);
  });

  it('is null outside a working tree and throws naming the root otherwise', () => {
    expect(gitTopLevel('/x', failingGit('fatal: not a git repository'))).toBeNull();
    expect(() => gitTopLevel('/x', failingGit('fatal: bad config'))).toThrow(
      'cannot list untracked files in /x: fatal: bad config'
    );
  });
});

describe('untrackedSources', () => {
  it('asks git for untracked, non-ignored files when the root is the top level', () => {
    const calls: [readonly string[], string][] = [];
    const git: GitRunner = (args, cwd) => {
      calls.push([args, cwd]);
      return args[0] === 'rev-parse' ? '/repo\n' : 'notes.md\0';
    };
    expect(untrackedSources('/repo', git, samePath)).toEqual(['notes.md']);
    expect(calls).toEqual([
      [TOP_LEVEL_ARGS, '/repo'],
      [UNTRACKED_ARGS, '/repo']
    ]);
  });

  it('steps aside when the root is nested inside another repository', () => {
    const git = fakeGit('/home', () => {
      throw new Error('ls-files must not run');
    });
    expect(untrackedSources('/home/sources', git, samePath)).toBeNull();
  });

  it('compares canonical paths (a symlinked or /private-aliased root still counts)', () => {
    const realpath = (target: string): string => target.replace(/^\/var\//, '/private/var/');
    expect(untrackedSources('/var/repo', fakeGit('/private/var/repo', 'a.md\0'), realpath)).toEqual(
      ['a.md']
    );
  });

  it('returns null outside a git working tree', () => {
    expect(
      untrackedSources('/x', failingGit('fatal: not a git repository (or any parent)'), samePath)
    ).toBeNull();
  });

  it('throws naming the root on any other git failure', () => {
    expect(() => untrackedSources('/x', failingGit('fatal: bad index'), samePath)).toThrow(
      'cannot list untracked files in /x'
    );
    expect(() =>
      untrackedSources(
        '/x',
        () => {
          throw new Error('spawn git ENOENT');
        },
        samePath
      )
    ).toThrow('spawn git ENOENT');
    const overflow = fakeGit('/x', () => {
      throw Object.assign(new Error('spawnSync git ENOBUFS'), { code: 'ENOBUFS' });
    });
    expect(() => untrackedSources('/x', overflow, samePath)).toThrow(
      /cannot list untracked files in \/x: .*ENOBUFS/
    );
  });
});

describe('untrackedSourcesError', () => {
  it('is null for a clean checkout', () => {
    expect(untrackedSourcesError([])).toBeNull();
  });

  it('names every file and the remedy', () => {
    const message = untrackedSourcesError(['a.zip', 'notes/todo.md']) ?? '';
    expect(message).toContain('sources zip refused');
    expect(message).toContain('  a.zip\n  notes/todo.md\n');
    expect(message).toContain('Zip from a clean checkout');
    expect(message).not.toContain('more');
  });

  it('names the first files of a huge listing and counts the rest', () => {
    const files = Array.from({ length: 100_000 }, (_, index) => `f${String(index)}.txt`);
    const message = untrackedSourcesError(files) ?? '';
    expect(message.split('\n').filter((line) => line.startsWith('  f'))).toHaveLength(
      LISTED_FILES_MAX
    );
    expect(message).toContain(`  … and ${String(100_000 - LISTED_FILES_MAX)} more\n`);
  });
});

describe('assertCleanSources', () => {
  it('passes on a clean checkout, outside a repository and nested in another one', () => {
    expect(() => {
      assertCleanSources('/repo', fakeGit('/repo', ''), samePath);
    }).not.toThrow();
    expect(() => {
      assertCleanSources('/x', failingGit('fatal: not a git repository'), samePath);
    }).not.toThrow();
    expect(() => {
      assertCleanSources('/home/x', fakeGit('/home', 'x/\0'), samePath);
    }).not.toThrow();
  });

  it('refuses naming the untracked files', () => {
    expect(() => {
      assertCleanSources('/repo', fakeGit('/repo', 'scratch.txt\0'), samePath);
    }).toThrow(/on disk\):\n {2}scratch\.txt/);
  });

  it('sees real untracked files and skips ignored ones, inner .gitignore included (real git)', () => {
    withTempDir((dir) => {
      runGit(['init', '-q'], dir);
      writeFileSync(path.join(dir, '.gitignore'), 'ignored.log\n');
      writeFileSync(path.join(dir, 'ignored.log'), '');
      writeFileSync(path.join(dir, 'stray.md'), '');
      // A tool folder that ignores itself (husky's `_/`) is not a stray file.
      mkdirSync(path.join(dir, 'tool'));
      writeFileSync(path.join(dir, 'tool', '.gitignore'), '*\n');
      writeFileSync(path.join(dir, 'tool', 'hook'), '');
      mkdirSync(path.join(dir, 'scratch'));
      writeFileSync(path.join(dir, 'scratch', 'a.txt'), '');
      expect(untrackedSources(dir)).toEqual(['.gitignore', 'scratch/a.txt', 'stray.md']);
      expect(() => {
        assertCleanSources(dir);
      }).toThrow(/stray\.md/);
    });
  });

  it('steps aside for sources unpacked inside a foreign repository (real git)', () => {
    withTempDir((dir) => {
      runGit(['init', '-q'], dir);
      const sources = path.join(dir, 'unpacked');
      mkdirSync(sources);
      writeFileSync(path.join(sources, 'package.json'), '{}');
      expect(untrackedSources(sources)).toBeNull();
      expect(() => {
        assertCleanSources(sources);
      }).not.toThrow();
    });
  });

  it('checks a root reached through a non-canonical path (real git)', () => {
    withTempDir((dir) => {
      runGit(['init', '-q'], dir);
      writeFileSync(path.join(dir, 'stray.md'), '');
      // `dir/.` resolves to the same folder; git prints the canonical one.
      expect(untrackedSources(`${dir}/.`)).toEqual(['stray.md']);
    });
  });
});
