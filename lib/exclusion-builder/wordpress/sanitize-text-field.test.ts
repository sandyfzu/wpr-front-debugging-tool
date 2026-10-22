/**
 * WordPress `sanitize_text_field` port. Every expectation is the real
 * function's output (WordPress 7.1.3 under PHP 8.1.34, `blog_charset`
 * UTF-8), including the WP Rocket save tables' cases.
 */
import { describe, expect, it } from 'vitest';
import { phpTrim } from './php-trim';
import { sanitizeTextField, submittedText } from './sanitize-text-field';

/** Bytes from base64 (lines that are not UTF-8). */
function bytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));
}

describe('sanitizeTextField', () => {
  it.each([
    // An unclosed `<` run is escaped (only that run; no double encoding).
    ['a<b', 'a&lt;b'],
    ['x<y<z>w', 'x&lt;yw'],
    ['a&b<c&d"e\'f', 'a&b&lt;c&amp;d&quot;e&#039;f'],
    ['a&amp;<b', 'a&amp;&lt;b'],
    ['[<a]', '[&lt;a]'],
    ['(?<=a)b', '(?&lt;=a)b'],
    ['<\tb', '&lt; b'],
    // Entities in the run: KSES's names (minus `apos`) and valid code points stay.
    ['<&nbsp;&apos;&eacute;&foo;', '&lt;&nbsp;&amp;apos;&eacute;&amp;foo;'],
    [
      '<&#9;&#0039;&#x2E;&#X41;&#x0;&#0;&#xD800;',
      '&lt;&#009;&#039;&#x2E;&#x41;&amp;#x0;&amp;#0;&amp;#xD800;'
    ],
    [
      '<&#1114112;&#1234567;&#12345678;&#x000002E;&#xFFFE;',
      '&lt;&amp;#1114112;&amp;#1234567;&amp;#12345678;&#x2E;&amp;#xFFFE;'
    ],
    ['<&AMP;&amp&#39', '&lt;&amp;AMP;&amp;amp&amp;#39'],
    // `<` + LF survives as `&lt;` before the whitespace collapse.
    ['a<b\nc', 'a&lt;b c'],
    ['x<\ny', 'x&lt; y'],
    // Tags, comments, script/style blocks.
    ['a<b>c</b>d', 'acd'],
    ['a<!-- x -->b', 'ab'],
    ['<script>x</script>y', 'y'],
    ['<style>a</STYLE>b', 'b'],
    ['<SCRIPT a>x</script >y', 'xy'],
    ['<script>never closed', 'never closed'],
    ['<b>0</b>', '0'],
    ['<b> </b>', ''],
    ['(?<n>a)', '(?a)'],
    ['\\k<n>', '\\k'],
    // strip_tags quirks.
    ['a < b > c', 'a < b > c'],
    ['a<b"c>d"e>f', 'af'],
    ['1<2 and 3>2', '12'],
    ['[^<>]+x', '[^]+x'],
    ['<a\0>b', 'b'],
    // Whitespace: CR/LF/tab/space runs → one space, PHP trim.
    ['  a \t\r\n b  ', 'a b'],
    ['a b', 'a b'],
    ['﻿a', '﻿a'],
    ['a\0b', 'a\0b'],
    // Octets, removed until none is left.
    ['x%41y', 'xy'],
    ['%2541', '41'],
    ['%zz%2F%2f', '%zz'],
    ['%E2%80%8B', ''],
    ['a %41 b', 'a b'],
    ['%%4141', ''],
    ['a%20%20b', 'ab']
  ])('%j → %j', (input, expected) => {
    expect(sanitizeTextField(input)).toBe(expected);
  });

  it('empties a row that is not valid UTF-8', () => {
    // 0xFF, an overlong `/`, a UTF-16 surrogate, a truncated sequence.
    for (const line of ['/2JhZA==', 'wK8=', '7aCA', 'YYA=']) {
      expect(sanitizeTextField(bytes(line))).toBe('');
    }
  });

  it('reads valid UTF-8 bytes as their text, a leading BOM included', () => {
    expect(sanitizeTextField(new TextEncoder().encode('é<b>x</b>'))).toBe('éx');
    expect(sanitizeTextField(Uint8Array.of(0xef, 0xbb, 0xbf, 0x61))).toBe('﻿a');
  });
});

describe('submittedText', () => {
  it('sends a lone surrogate as U+FFFD, as a browser submits a form', () => {
    expect(submittedText('a\ud800b')).toBe('a�b');
    expect(submittedText('😀')).toBe('😀');
  });

  it('is null for bytes that are not UTF-8', () => {
    expect(submittedText(bytes('wK8='))).toBeNull();
    expect(submittedText(Uint8Array.of(0x61))).toBe('a');
  });
});

describe('phpTrim', () => {
  it('strips space, tab, LF, CR, NUL and vertical tab only', () => {
    expect(phpTrim('\n\r\t \v\0a\0\v \t\r\n')).toBe('a');
    expect(phpTrim('\f a  ')).toBe('\f a  ');
  });
});
