/**
 * PHP replacement-string expansion. Each expectation is PHP 8.1's own
 * output for `preg_replace('/H/', template, 'aHb', 1)` (group 0 = `H`).
 */
import { describe, expect, it } from 'vitest';
import { expandPhpReplacement, quotePhpReplacement } from './php-replacement';

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

/** [text, PHP 8.1's `addcslashes(text, '\\$')`]. */
const QUOTE_CASES: readonly (readonly [string, string])[] = [
  ['a\\1 $0 ${1} \\\\ \\$ $9 \\', 'a\\\\1 \\$0 \\${1} \\\\\\\\ \\\\\\$ \\$9 \\\\'],
  ['$', '\\$'],
  ['\\', '\\\\'],
  ['\\\\$$', '\\\\\\\\\\$\\$'],
  ['plain', 'plain'],
  ['$\0x', '\\$\0x']
];

describe('quotePhpReplacement', () => {
  it.each(QUOTE_CASES)('%j → %j', (text, quoted) => {
    expect(quotePhpReplacement(text)).toBe(quoted);
  });

  it.each([...QUOTE_CASES.map(([text]) => text), ...PHP_CASES.map(([template]) => template)])(
    'makes %j literal in a replacement (PHP writes it as is)',
    (text) => {
      expect(expandPhpReplacement(`\${1}${quotePhpReplacement(text)}`, ['H', 'H'])).toBe(
        `H${text}`
      );
    }
  );
});
