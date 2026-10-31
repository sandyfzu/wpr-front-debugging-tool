/**
 * WordPress's escaping functions as LazyLoad reaches them: every expected
 * value below was printed by WordPress 7.1.3's own `esc_url`, `esc_attr`
 * and `wp_strip_all_tags` (PHP 8.1, UTF-8 site, default protocols).
 */
import { describe, expect, it } from 'vitest';
import { escAttr, escUrl, ksesNormalizeEntities, wpStripAllTags } from './wp-escaping';

describe('escUrl', () => {
  it.each<[string, string]>([
    ['', ''],
    ['  /a b.jpg', '/a%20b.jpg'],
    ['/a.jpg?x=1&y=2', '/a.jpg?x=1&#038;y=2'],
    ['/a.jpg?x=1&amp;y=2', '/a.jpg?x=1&#038;y=2'],
    ['javascript:alert(1)', ''],
    ['data:image/png;base64,AA', ''],
    ['example.com/x.jpg', 'http://example.com/x.jpg'],
    ['x.php?a', 'x.php?a'],
    ['?q', '?q'],
    ['#h', '#h'],
    ['//cdn/x', '//cdn/x'],
    ['HTTPS://H/A.JPG', 'https://H/A.JPG'],
    ['mailto:a%0d@b', 'mailto:a%0d@b'],
    ['/p%0d%0Ax%0%0aa', '/px'],
    ['feed:http://x/y', 'feed:http://x/y'],
    ['feed:javascript:x', ''],
    ['a;//b', ''],
    ['http://h/é.jpg', 'http://h/é.jpg'],
    ["/a'b.jpg", '/a&#039;b.jpg'],
    ['/<x>"y\\z^`{}', '/xyz'],
    ['&#58;x', 'http://&#058;x'],
    ['jav&#x61;script:x', ''],
    ['tel:1', 'tel:1'],
    [
      '/a&hellip;&foo;&#65;&#0;&#x41;&#1114112;.jpg',
      '/a&hellip;&#038;foo;&#065;&#038;#0;&#x41;&#038;#1114112;.jpg'
    ],
    ['/a&apos;b&lang;', '/a&apos;b&lang;'],
    ['sms:1', 'sms:1'],
    ['ftp://x', 'ftp://x'],
    ['  \t/lead', '/lead']
  ])('%j → %j', (url, expected) => {
    expect(escUrl(url)).toBe(expected);
  });

  it('refuses a URL holding brackets (WordPress re-encodes them through parse_url)', () => {
    expect(escUrl('http://h/[1].jpg')).toBeNull();
    expect(escUrl('/a]')).toBeNull();
  });
});

describe('escAttr', () => {
  it.each<[string, string]>([
    ['', ''],
    ['plain', 'plain'],
    ['a&b', 'a&amp;b'],
    ['&amp;', '&amp;'],
    ['&apos;', '&amp;apos;'],
    ['&#038;', '&#038;'],
    ['&#x26;', '&#x26;'],
    ['&lang;', '&lang;'],
    ['&foo;', '&amp;foo;'],
    ["<a href='x'>\"", '&lt;a href=&#039;x&#039;&gt;&quot;'],
    ['&#1114111;', '&#1114111;'],
    ['&#65', '&amp;#65'],
    ['&#x110000;', '&amp;#x110000;']
  ])('%j → %j', (text, expected) => {
    expect(escAttr(text)).toBe(expected);
  });
});

describe('wpStripAllTags', () => {
  it.each<[string, string]>([
    ['<b>a</b>', 'a'],
    ['<script>x</script>y', 'y'],
    ['<STYLE a>z</style>w', 'w'],
    ['a<scriptx>b</script>c', 'ac'],
    [' <p>t</p> ', 't'],
    ['<script>unclosed', 'unclosed'],
    ['a < b', 'a < b']
  ])('%j → %j', (text, expected) => {
    expect(wpStripAllTags(text)).toBe(expected);
  });
});

describe('ksesNormalizeEntities', () => {
  it('re-arms kses references only', () => {
    expect(ksesNormalizeEntities('&#0065;&#x0041;&#xD800;&foo;&nbsp;&#65')).toBe(
      '&#065;&#x41;&amp;#xD800;&amp;foo;&nbsp;&amp;#65'
    );
  });
});
