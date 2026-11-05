/** The shared line-list reader: splitting, trimming, blank removal, ordered dedupe. */
import { describe, expect, it } from 'vitest';
import { parseLineList } from './line-list';

describe('parseLineList', () => {
  it('reads empty and whitespace-only text as no entries', () => {
    expect(parseLineList('')).toEqual([]);
    expect(parseLineList('   ')).toEqual([]);
    expect(parseLineList('\n\n \t\n\r\n')).toEqual([]);
  });

  it('splits on LF, CRLF and lone CR alike', () => {
    expect(parseLineList('a\nb\r\nc\rd')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('trims each line (spaces, tabs, non-breaking spaces, BOM) and drops blank ones', () => {
    expect(parseLineList('  a  \n\n\t b\t\n\u00a0c\u00a0\n\ufeffd\n \u00a0 \n')).toEqual([
      'a',
      'b',
      'c',
      'd'
    ]);
  });

  it('keeps commas inside a line (one line is one entry)', () => {
    expect(parseLineList('.a, .b\nx{1,3}\n,')).toEqual(['.a, .b', 'x{1,3}', ',']);
  });

  it('collapses repeats onto the first occurrence, keeping typed order', () => {
    expect(parseLineList('b\na\nb\n a \nc\na')).toEqual(['b', 'a', 'c']);
  });

  it('is case- and inner-whitespace-sensitive (distinct entries stay distinct)', () => {
    expect(parseLineList('A\na\na  b\na b')).toEqual(['A', 'a', 'a  b', 'a b']);
  });

  it('treats prototype-named lines as plain entries', () => {
    expect(parseLineList('__proto__\nconstructor\n__proto__')).toEqual([
      '__proto__',
      'constructor'
    ]);
  });
});
