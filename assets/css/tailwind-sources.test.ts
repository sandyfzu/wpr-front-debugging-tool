import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Pins the page layer's Tailwind class-scan scope: automatic detection is
 * off and only the shipped source layers are scanned. A component file
 * outside every listed layer would silently lose its utilities, so every
 * `.tsx` file the extension ships must sit under one.
 */

/** This test's directory: the stylesheet's `@source` paths resolve against it. */
const HERE = dirname(fileURLToPath(import.meta.url));

/** The repository root. */
const ROOT = resolve(HERE, '../..');

/** Directories that never hold shipped components (tooling, output, tests, docs). */
const NOT_SHIPPED = new Set([
  'node_modules',
  '.output',
  '.wxt',
  '.git',
  '.cache',
  '.vitest',
  'coverage',
  'tests',
  'docs',
  'docker',
  'scripts',
  'public'
]);

/** The page layer's text. */
const THEME = readFileSync(join(HERE, 'theme.css'), 'utf8');

/**
 * The stylesheet's `@source` paths, resolved against its directory.
 *
 * @param negated `true` for the `@source not` entries.
 * @returns Absolute paths (globs kept as written).
 */
function sourcePaths(negated: boolean): string[] {
  const pattern = negated ? /@source not '([^']+)';/g : /@source '([^']+)';/g;
  return [...THEME.matchAll(pattern)].map((match) => resolve(HERE, match[1] ?? ''));
}

/**
 * Every `.tsx` file under `dir`, skipping the not-shipped directories.
 *
 * @param dir The directory to walk.
 * @returns Absolute file paths.
 */
function componentFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!NOT_SHIPPED.has(entry.name)) found.push(...componentFiles(path));
    } else if (entry.name.endsWith('.tsx') && !/\.(test|testing)\.tsx$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

describe('Tailwind class-scan scope', () => {
  it('turns automatic detection off', () => {
    expect(THEME).toContain("@import 'tailwindcss' source(none);");
  });

  it('scans exactly the four shipped source layers', () => {
    expect(sourcePaths(false).map((path) => relative(ROOT, path))).toEqual([
      'entrypoints',
      'components',
      'lib',
      'utils'
    ]);
  });

  it('keeps tests, test helpers and data fixtures out', () => {
    expect(sourcePaths(true).map((path) => relative(ROOT, path))).toEqual([
      join('**', '*.{test,testing,fixtures}.{ts,tsx}'),
      join('lib', '**', 'fixtures'),
      join('lib', '**', '*.json')
    ]);
  });

  it('covers every shipped component file', () => {
    const layers = sourcePaths(false);
    const files = componentFiles(ROOT);
    expect(files.length).toBeGreaterThan(0);
    const uncovered = files.filter((file) => !layers.some((layer) => file.startsWith(layer + sep)));
    expect(uncovered.map((file) => relative(ROOT, file))).toEqual([]);
  });
});
