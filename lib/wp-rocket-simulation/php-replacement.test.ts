/**
 * PHP replacement-string expansion. Each expectation is PHP 8.1's own
 * output for `preg_replace('/H/', template, 'aHb', 1)` (group 0 = `H`).
 */
import { describe, expect, it } from 'vitest';
import { expandPhpReplacement } from './php-replacement';

/** [template, what PHP writes in place of `H`]. */
const PHP_CASES: readonly (readonly [string, string])[] = [
  ['a\\\\b', 'a\\b'],
  ['a\\\\\\\\b', 'a\\\\b'],
  ['x\\$0y', 'x$0y'],
  ['$0$1${0}${1}', 'HH'],
  ['\\0-\\\\0', 'H-\\0'],
  ['${0', '${0'],
  ['$01x', 'x'],
  ['$', '$'],
  ['\\', '\\'],
  ['a\\b\\\\$0', 'a\\b\\H'],
  ['${12}z', 'z'],
  ['\\\\\\\\$0', '\\\\H']
];

describe('expandPhpReplacement', () => {
  it.each(PHP_CASES)('%j → %j', (template, written) => {
    expect(expandPhpReplacement(template, ['H'])).toBe(written);
  });

  it('copies text without `$` or `\\` as is', () => {
    expect(expandPhpReplacement('<script>run()</script>', ['x'])).toBe('<script>run()</script>');
  });

  it('substitutes later groups when given', () => {
    expect(expandPhpReplacement('[${1}|$2]', ['all', 'one', 'two'])).toBe('[one|two]');
  });

  it('reads a NUL after `$` as the end of a reference', () => {
    expect(expandPhpReplacement('$\0', ['H'])).toBe('$\0');
  });
});
