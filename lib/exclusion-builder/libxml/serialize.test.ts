/**
 * The libxml opening-tag re-serializer. Every expected string below was
 * produced by the real library (PHP 8.1.34 `DOMDocument::loadHTML` +
 * `saveHTML`, libxml 2.9.13, WP Rocket's own flags and cut at the first
 * `>`); `null` marks inputs the module refuses to guess (libxml empties or
 * truncates the value there).
 */
import { describe, expect, it } from 'vitest';
import { libxmlOpeningTag } from './serialize';

describe('libxmlOpeningTag — UTF-8 pages (measured)', () => {
  const MEASURED: readonly (readonly [string, string])[] = [
    ['<div class="">', '<div class="">'],
    ['<div hidden="">', '<div hidden="">'],
    ['<div HIDDEN>', '<div hidden>'],
    ['<DIV id="a">', '<div id="a">'],
    ['<div id=a>', '<div id="a">'],
    ['<div id = "a">', '<div id="a">'],
    ['<div  id="a"  class="b" >', '<div id="a" class="b">'],
    ['<div id="a" />', '<div id="a">'],
    ['<div id=a/>', '<div id="a/">'],
    ['<div\nid="a">', '<div id="a">'],
    ['<div id="x"title="y">', '<div id="x" title="y">'],
    ["<div id='a'>", '<div id="a">'],
    [`<div title="a'b">`, `<div title="a'b">`],
    [`<div title='a"b'>`, `<div title='a"b'>`],
    ['<div title="a&quot;b&#39;c">', `<div title="a&quot;b'c">`],
    ['<div title=a"b>', `<div title='a"b'>`],
    ['<div title="&amp;">', '<div title="&amp;">'],
    ['<div title="a & b">', '<div title="a &amp; b">'],
    ['<div title="<>">', '<div title="&lt;&gt;">'],
    ['<div title=">">', '<div title="&gt;">'],
    ['<div title="&copy;&#169;&#xA9;&#XA9;">', '<div title="©©©©">'],
    ['<div title="&#233">', '<div title="é">'],
    ['<div title="&#65a">', '<div title="Aa">'],
    ['<div title="&apos;s &hellip; &Eacute;">', `<div title="'s … É">`],
    [
      '<div title="&foo; &AMP; &amp &eacute">',
      '<div title="&amp;foo; &amp;AMP; &amp;amp &amp;eacute">'
    ],
    ['<div title="&notit; &notin;">', '<div title="&amp;notit; ∉">'],
    ['<div title="&nbsp;&#9;&#x80;">', '<div title=" \t\u0080">'],
    ['<div title="a\tb\nc\rd\u007fe">', '<div title="a\tb\nc\rd\u007fe">'],
    ['<div title="été 😀 &#x1F600;">', '<div title="été 😀 😀">'],
    [
      '<div checked="checked" disabled="x" selected="" nowrap>',
      '<div checked disabled selected nowrap>'
    ],
    [
      '<div compact="1" declare ismap="1" multiple="" nohref="x">',
      '<div compact declare ismap multiple nohref>'
    ],
    [
      '<div noresize="x" noshade="x" readonly="x" defer=1>',
      '<div noresize noshade readonly defer>'
    ],
    [
      '<div hidden="hidden" async="x" required="x">',
      '<div hidden="hidden" async="x" required="x">'
    ],
    ['<div a=>', '<div a="">'],
    ['<div a= b="">', `<div a='b=""'>`],
    ['<div a =b>', '<div a="b">'],
    ['<div id="a" id="b" ID="c">', '<div id="a">'],
    [
      '<div Data-Foo="1" XML:LANG="x" :class="y" x-on:click.prevent="z">',
      '<div data-foo="1" xml:lang="x" :class="y" x-on:click.prevent="z">'
    ],
    ['<div a.b="1" _a="1" xmlns:foo="x">', '<div a.b="1" _a="1" xmlns:foo="x">'],
    ['<div href="a b">', '<div href="a%20b">'],
    ['<div src=" \t\na">', '<div src="a">'],
    ['<div href="a ">', '<div href="a%20">'],
    ['<div action="é">', '<div action="%C3%A9">'],
    ['<div href="/a?b=1&amp;c=2">', '<div href="/a?b=1&amp;c=2">'],
    [
      `<div href="a!b~c*d(e)f_g-h.i'j@k:l=m;n,o+p#q%41">`,
      `<div href="a!b~c*d(e)f_g-h.i'j@k:l=m;n,o+p#q%41">`
    ],
    ['<div href="a[b]c`d^e|f{g}h">', '<div href="a%5Bb%5Dc%60d%5Ee%7Cf%7Bg%7Dh">'],
    [`<div href='a"b'>`, '<div href="a%22b">'],
    ['<div HREF="&nbsp;&lt;">', '<div href="%C2%A0&lt;">'],
    ['<div action=" ">', '<div action="">'],
    ['<div name="a b">', '<div name="a b">'],
    [
      '<div title="it&#39;s &eacute;&nbsp;x &gt; &lt; &quot;q&quot;" data-a=\'say "hi"\'>',
      `<div title="it's é x &gt; &lt; &quot;q&quot;" data-a='say "hi"'>`
    ],
    ['<MAIN>', '<main>'],
    ['<div  >', '<div>'],
    // Bogus attributes: skipped to the next blank, `>` or `/>`, quotes ignored.
    ['<div =x>', '<div>'],
    ['<div/id="a">', '<div>'],
    ['<div id="a"/ class="b">', '<div id="a" class="b">'],
    ['<div id="a"/x>', '<div id="a">'],
    ['<div @click="x">', '<div>'],
    ['<div [a]="1">', '<div>'],
    ['<div 1a="1">', '<div>'],
    ['<div -a="1">', '<div>'],
    ['<div a$b="1">', '<div a>'],
    ['<div a!="1" b="2">', '<div a b="2">'],
    ['<div é="1" id="k">', '<div id="k">'],
    ['<div data-é="1" id="k">', '<div data- id="k">'],
    ['<div v-bind:[key]="x" id="k">', '<div v-bind: id="k">'],
    ['<div @click="a b" id="k">', '<div b id="k">'],
    [
      '<div x-data="{ open: false }" @click.away="open = false" id="k">',
      '<div x-data="{ open: false }" false id="k">'
    ],
    ['<div a="1"@b="2" c="3">', '<div a="1" c="3">'],
    ['<div a ="1" @ b="2">', '<div a="1" b="2">'],
    ['<div a= @b>', '<div a="@b">'],
    ['<div a=b"c d>', `<div a='b"c' d>`],
    ['<div @x\tid="k">', '<div id="k">'],
    // A bogus attribute's `>` ends the tag (the rest is text there).
    ['<div @click="a>b" id="k">', '<div>'],
    // `<!--…-->` and `&{…}` spans are copied raw; the first `>` cuts the tag.
    ['<div title="<!-- c -->" id="k">', '<div title="<!-- c -->'],
    ['<div title="<!-->x" id="k">', '<div title="<!-->'],
    ['<div title="<!--->x" id="k">', '<div title="<!--->'],
    ['<div title="a<!--b" id="k">', '<div title="a&lt;!--b" id="k">'],
    ['<div title="<!-- a" id="k">', '<div title="&lt;!-- a" id="k">'],
    ['<div title="&lt;!-- a&amp;b --&gt; &lt;c" id="k">', '<div title="<!-- a&b -->'],
    ['<div href="<!-- a b -->c d" id="k">', '<div href="<!--%20a%20b%20-->'],
    [`<div title='<!-- "q" -->' id="k">`, `<div title='<!-- "q" -->`],
    ['<div title="x" data-c="<!-- c -->" id="k">', '<div title="x" data-c="<!-- c -->'],
    ['<div title="&{a}">', '<div title="&{a}">'],
    ['<div title="&amp;{a}">', '<div title="&{a}">'],
    ['<div title="&#38;{">', '<div title="&amp;{">'],
    ['<div title="&{&amp;{">', '<div title="&amp;{&amp;{">'],
    ['<div title="&eacuteé">', '<div title="&amp;eacuteé">'],
    ['<div title="&é">', '<div title="&amp;é">']
  ];

  it.each(MEASURED)('%j → %j', (source, serialized) => {
    expect(libxmlOpeningTag(source, 'utf-8')).toBe(serialized);
  });

  it('adds no end tag and keeps `>` out of values, so the first `>` ends the tag', () => {
    const serialized = libxmlOpeningTag('<div title="a>b">', 'utf-8');
    expect(serialized).toBe('<div title="a&gt;b">');
    expect(serialized?.indexOf('>')).toBe((serialized?.length ?? 0) - 1);
  });
});

describe('libxmlOpeningTag — fails closed where libxml empties or truncates', () => {
  const REFUSED: readonly string[] = [
    '<div title="&#0;">',
    '<div title="&#x;">',
    '<div title="&#;">',
    '<div title="&#99999999;">',
    '<div title="&#xD800;">',
    '<div title="a&#1;b">',
    '<div title="a&#xFFFE;b">',
    '<div title="a\u0001b">',
    '<div title="a\u000bb">',
    '<div title="a\fb">',
    '<div title="a\u0000b">',
    // No closing `>`, an unclosed quote, a name it does not serialize, markup past libxml's tag end.
    '<div id="a"',
    '<div id="a>',
    '<custom-el id="a">',
    '<div @x="a>b" <i>'
  ];

  it.each(REFUSED)('%j → null', (source) => {
    expect(libxmlOpeningTag(source, 'utf-8')).toBeNull();
  });
});

describe('libxmlOpeningTag — text modes', () => {
  it('reads UTF-8 bytes as Latin-1 on a page libxml decodes as Latin-1 (measured)', () => {
    const mode = 'latin-1-of-utf-8';
    expect(libxmlOpeningTag('<div class="été">', mode)).toBe('<div class="Ã©tÃ©">');
    expect(libxmlOpeningTag('<div title="😀">', mode)).toBe('<div title="ð\u009f\u0098\u0080">');
    expect(libxmlOpeningTag('<div title="&#xe9;&#x1F600;&euro;">', mode)).toBe(
      '<div title="é😀€">'
    );
    expect(libxmlOpeningTag('<div title="&#233é">', mode)).toBe('<div title="éÃ©">');
    expect(libxmlOpeningTag('<div title="&amp;é">', mode)).toBe('<div title="&amp;Ã©">');
    expect(libxmlOpeningTag('<div src="é">', mode)).toBe('<div src="%C3%83%C2%A9">');
    expect(libxmlOpeningTag('<div id="a">', mode)).toBe('<div id="a">');
  });

  it('refuses a Latin-1 `&name` running into a non-ASCII byte (libxml drops part of the name)', () => {
    // Measured: `&eacuteé` → `&amp;Ã©`, `&é` → `&amp;©`.
    expect(libxmlOpeningTag('<div title="&eacuteé">', 'latin-1-of-utf-8')).toBeNull();
    expect(libxmlOpeningTag('<div title="&é">', 'latin-1-of-utf-8')).toBeNull();
    expect(libxmlOpeningTag('<div title="&é">', 'latin-1')).toBeNull();
  });

  it('keeps single-byte text as is, refusing what windows-1252 decoded above U+00FF', () => {
    expect(libxmlOpeningTag('<div class="été">', 'latin-1')).toBe('<div class="été">');
    expect(libxmlOpeningTag('<div class="€">', 'latin-1')).toBeNull();
  });

  it('serializes ASCII tags in an unknown mode, refusing non-ASCII ones', () => {
    expect(libxmlOpeningTag('<div title="&eacute;">', 'unknown')).toBe('<div title="é">');
    expect(libxmlOpeningTag('<div title="é">', 'unknown')).toBeNull();
  });
});
