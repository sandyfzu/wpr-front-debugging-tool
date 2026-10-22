/**
 * The settings-field form of exclusion rows: each row trimmed of exactly the
 * whitespace the settings save strips (space, tab, LF, CR, NUL, vertical
 * tab — no other Unicode space), rows left empty dropped, the rest kept in
 * order and joined by `\n` with no trailing newline.
 */
import { describe, expect, it } from 'vitest';
import { exclusionFieldLines, exclusionFieldText, trimExclusionRow } from './field-text';

describe('trimExclusionRow', () => {
  it('strips leading and trailing spaces, tabs and line breaks', () => {
    expect(trimExclusionRow('  gtag  ')).toBe('gtag');
    expect(trimExclusionRow('\t/js/main.js\r\n')).toBe('/js/main.js');
    expect(trimExclusionRow('\n\r\t \u000b\u0000a\u0000\u000b \t\r\n')).toBe('a');
  });

  it('keeps inner whitespace untouched', () => {
    expect(trimExclusionRow('  <section class="footer">  ')).toBe('<section class="footer">');
    expect(trimExclusionRow('a \t b')).toBe('a \t b');
  });

  it('keeps every other Unicode space, as the save does', () => {
    expect(trimExclusionRow(' x ')).toBe(' x ');
    expect(trimExclusionRow(' x﻿')).toBe(' x﻿');
    expect(trimExclusionRow('   ')).toBe(' ');
  });

  it('returns an already trimmed row as is, and empty for whitespace only', () => {
    expect(trimExclusionRow('gtag')).toBe('gtag');
    expect(trimExclusionRow('')).toBe('');
    expect(trimExclusionRow(' \t\r\n ')).toBe('');
  });
});

describe('exclusionFieldLines', () => {
  it('trims every row and drops the ones left empty, keeping list order', () => {
    expect(exclusionFieldLines([' b ', '', '\t', 'a', '  c'])).toEqual(['b', 'a', 'c']);
  });

  it('keeps duplicates and regex-looking text verbatim (only whitespace is touched)', () => {
    expect(exclusionFieldLines(['x', ' x', '(.*)\\.js'])).toEqual(['x', 'x', '(.*)\\.js']);
  });

  it('is empty for no rows or blank rows only', () => {
    expect(exclusionFieldLines([])).toEqual([]);
    expect(exclusionFieldLines(['', '   '])).toEqual([]);
  });
});

describe('exclusionFieldText', () => {
  it('joins the field lines with LF and no trailing newline', () => {
    expect(exclusionFieldText([' gtag ', '', 'jquery\\.min\\.js\r'])).toBe(
      'gtag\njquery\\.min\\.js'
    );
  });

  it('is the single line itself, and empty when nothing is left', () => {
    expect(exclusionFieldText(['  one'])).toBe('one');
    expect(exclusionFieldText(['  ', ''])).toBe('');
  });
});
