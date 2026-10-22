/**
 * The libxml opening-tag re-serializer. Every expected string below was
 * produced by the real library (PHP 8.1.34 `DOMDocument::loadHTML` +
 * `saveHTML`, libxml 2.9.13, WP Rocket's own flags and cut at the first
 * `>`); `null` marks inputs the module refuses to guess (libxml drops,
 * empties or truncates there).
 */
import { describe, expect, it } from 'vitest';
import { scanTags } from './html-scan';
import { libxmlDocumentCharset, libxmlOpeningTag, utf8AsLatin1 } from './libxml-serialize';

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
    ['<div  >', '<div>']
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

describe('libxmlOpeningTag — fails closed where libxml drops, empties or truncates', () => {
  const REFUSED: readonly string[] = [
    '<div =x>',
    '<div/id="a">',
    '<div id="a"/ class="b">',
    '<div id="a"/x>',
    '<div @click="x">',
    '<div [a]="1">',
    '<div 1a="1">',
    '<div -a="1">',
    '<div a$b="1">',
    '<div é="1">',
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
    '<div title="&{a}">',
    '<div title="&amp;{a}">',
    '<div title="&#38;{">',
    '<div id="a"',
    '<div id="a>',
    '<custom-el id="a">'
  ];

  it.each(REFUSED)('%j → null', (source) => {
    expect(libxmlOpeningTag(source, 'utf-8')).toBeNull();
  });
});

describe('libxmlOpeningTag — Latin-1 and unknown charsets', () => {
  it('reads raw non-ASCII as Latin-1 bytes, while references still decode to their characters (measured)', () => {
    expect(libxmlOpeningTag('<div class="été">', 'latin-1')).toBe('<div class="Ã©tÃ©">');
    expect(libxmlOpeningTag('<div title="😀">', 'latin-1')).toBe(
      '<div title="ð\u009f\u0098\u0080">'
    );
    expect(libxmlOpeningTag('<div title="&#xe9;&#x1F600;&euro;">', 'latin-1')).toBe(
      '<div title="é😀€">'
    );
    expect(libxmlOpeningTag('<div src="é">', 'latin-1')).toBe('<div src="%C3%83%C2%A9">');
    expect(libxmlOpeningTag('<div id="a">', 'latin-1')).toBe('<div id="a">');
  });

  it('serializes ASCII tags on an unknown charset, refusing non-ASCII ones', () => {
    expect(libxmlOpeningTag('<div title="&eacute;">', 'unknown')).toBe('<div title="é">');
    expect(libxmlOpeningTag('<div title="é">', 'unknown')).toBeNull();
  });

  it('maps UTF-8 bytes to Latin-1 characters only when the text has non-ASCII', () => {
    expect(utf8AsLatin1('abc')).toBe('abc');
    expect(utf8AsLatin1('aé')).toBe('aÃ©');
  });
});

describe('libxmlDocumentCharset (measured)', () => {
  /** The charset of a page whose head/body prefix is `prefix`. */
  const charsetOf = (prefix: string): string => {
    const html = `${prefix}<div class="x">x</div></body></html>`;
    return libxmlDocumentCharset(html, scanTags(html));
  };

  it('reads UTF-8 from a charset meta, in any spelling, before any non-ASCII', () => {
    expect(charsetOf('<html><head><meta charset="utf-8"></head><body>')).toBe('utf-8');
    expect(charsetOf('<html><head><META CHARSET="UTF-8" /></head><body>')).toBe('utf-8');
    expect(charsetOf('<html><head><meta charset=utf8></head><body>')).toBe('utf-8');
    expect(charsetOf('<html><head><meta charset=" utf-8 "></head><body>')).toBe('utf-8');
    expect(
      charsetOf(
        '<html><head><meta content="text/html; charset=utf-8" http-equiv="content-type"></head><body>'
      )
    ).toBe('utf-8');
    expect(charsetOf('<html><head></head><body><div>aaa</div><meta charset="utf-8">')).toBe(
      'utf-8'
    );
  });

  it('falls back to Latin-1 without a declaration, or after non-ASCII text', () => {
    expect(charsetOf('<html><head></head><body>')).toBe('latin-1');
    expect(charsetOf('<html><head><!-- <meta charset="utf-8"> --></head><body>')).toBe('latin-1');
    expect(charsetOf('<html><head><meta content="text/html; charset=utf-8"></head><body>')).toBe(
      'latin-1'
    );
    expect(charsetOf('<html><head><title>é</title><meta charset="utf-8"></head><body>')).toBe(
      'latin-1'
    );
    expect(charsetOf('<html lang="é"><head><meta charset="utf-8"></head><body>')).toBe('latin-1');
  });

  it('keeps the first declaration, and leaves other charsets unknown', () => {
    expect(
      charsetOf('<html><head><meta charset="iso-8859-1"><meta charset="utf-8"></head><body>')
    ).toBe('unknown');
    expect(
      charsetOf('<html><head><meta charset="utf-8"><meta charset="iso-8859-1"></head><body>')
    ).toBe('utf-8');
    expect(charsetOf('<html><head><meta charset="windows-1252"></head><body>')).toBe('unknown');
  });

  it('reads a leading byte-order mark as UTF-8', () => {
    expect(charsetOf('﻿<html><head></head><body>')).toBe('utf-8');
  });
});
