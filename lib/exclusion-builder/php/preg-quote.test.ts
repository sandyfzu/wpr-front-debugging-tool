import { describe, expect, it } from 'vitest';
import { pregQuote, unescapedDelimiterAt } from './preg-quote';

// Expected texts are PHP 8.1's own `preg_quote` outputs (`php -n -r`).
describe('pregQuote', () => {
  it("escapes PHP's special characters, NUL as \\000, and the delimiter", () => {
    expect(pregQuote('a/b#c.\\+*?[^]$(){}=!<>|:-\0x', '/')).toBe(
      'a\\/b\\#c\\.\\\\\\+\\*\\?\\[\\^\\]\\$\\(\\)\\{\\}\\=\\!\\<\\>\\|\\:\\-\\000x'
    );
  });

  it('leaves `/` alone unless it is the delimiter; `#` is always escaped', () => {
    expect(pregQuote('a/b#c', '#')).toBe('a/b\\#c');
    expect(pregQuote('a/b#c')).toBe('a/b\\#c');
  });

  it("reads only the delimiter's first character", () => {
    expect(pregQuote('a/b', 'ab')).toBe('\\a/b');
  });

  it('keeps non-ASCII text as is', () => {
    expect(pregQuote('é/ü', '/')).toBe('é\\/ü');
  });
});

describe('unescapedDelimiterAt', () => {
  it('finds the first delimiter not escaped by a backslash', () => {
    expect(unescapedDelimiterAt('a\\/b/c', '/')).toBe(4);
    expect(unescapedDelimiterAt('a\\\\/b', '/')).toBe(3);
  });

  it('returns -1 for an intact body, a trailing backslash included', () => {
    expect(unescapedDelimiterAt('a\\/b\\#c', '/')).toBe(-1);
    expect(unescapedDelimiterAt('', '/')).toBe(-1);
    expect(unescapedDelimiterAt('a\\', '/')).toBe(-1);
  });
});
