/**
 * LazyLoad's tag-level rewrites: every expected value below was produced
 * by the plugin itself (WP Rocket 3.24's `Image` methods through
 * reflection, or its exact `preg_*` calls, PHP 8.1).
 */
import { describe, expect, it } from 'vitest';
import {
  backgroundUrl,
  findRealAttribute,
  firstQuotedValue,
  imageSource,
  isExcludedBy,
  lazyPlaceholder,
  withLazyClass,
  withLazyResponsiveAttributes,
  withLazySourceSrcset,
  withoutLazyLoading,
  withoutNativeLoading,
  withoutOuterQuotes,
  withPlaceholderSource
} from './lazyload-tag';

describe('findRealAttribute', () => {
  it.each<[string, string, { attribute: string; value: string } | null]>([
    ['<div style="a">', 'style', { 'attribute': 'style="a"', 'value': '"a"' }],
    ['<div title=\'x style="no"\' style=y>', 'style', { 'attribute': 'style=y', 'value': 'y' }],
    ["<div STYLE = 'a b'>", 'style', { 'attribute': "STYLE = 'a b'", 'value': "'a b'" }],
    ['<div style=>', 'style', null],
    ['<div style="open>', 'style', { 'attribute': 'style="open', 'value': '"open' }],
    ['<div data-style="x" style=\'z\'>', 'style', { 'attribute': "style='z'", 'value': "'z'" }],
    ['<div title=it\'s style="a" data-q=\'b\' style="c">', 'style', null],
    ['<div class="a" class="b">', 'class', { 'attribute': 'class="a"', 'value': '"a"' }],
    ['<div\tclass=c>', 'class', { 'attribute': 'class=c', 'value': 'c' }]
  ])('%j %s', (tag, name, expected) => {
    expect(findRealAttribute(tag, name)).toEqual(expected);
  });
});

describe('withLazyClass', () => {
  it.each<[string, string]>([
    ['<div>', '<div class="rocket-lazyload">'],
    ['<div class="">', '<div class="rocket-lazyload">'],
    ['<div class=0>', '<div class="rocket-lazyload">'],
    ['<div class="  a   b ">', '<div class="a b rocket-lazyload">'],
    ["<div class='x'>", "<div class='x rocket-lazyload'>"],
    ['<div class=solo>', '<div class="solo rocket-lazyload">'],
    ['<div class="0 a 0">', '<div class="a rocket-lazyload">'],
    ['<li data-x="<link a>" y>', '<li class="rocket-lazyload" data-x="<link a>" y>'],
    ['<div class="\'q\'">', '<div class="\'q\' rocket-lazyload">'],
    ['<a href="/x" class=""">', '<a href="/x" class="rocket-lazyload"">'],
    ['<aside>', '<aside class="rocket-lazyload">'],
    ['<abbr x>', '<a class="rocket-lazyload"bbr x>']
  ])('%j', (element, expected) => {
    expect(withLazyClass(element)).toBe(expected);
  });
});

describe('withLazyResponsiveAttributes', () => {
  it.each<[string, string]>([
    ['<img srcset="a 1x" sizes="100vw">', '<img data-lazy-srcset="a 1x" data-lazy-sizes="100vw">'],
    ["<img SRCSET='a' Sizes='b'>", "<img data-lazy-SRCSET='a' data-lazy-Sizes='b'>"],
    ['<img "srcset="a">', '<img  data-lazy-srcset="a">'],
    ['<img |srcset="a|b">', '<img |srcset="a|b">'],
    ['<img srcset="">', '<img srcset="">'],
    ['<img srcset = \'x">', '<img srcset = \'x">'],
    ['<img data-srcset="a">', '<img data-srcset="a">']
  ])('%j', (tag, expected) => {
    expect(withLazyResponsiveAttributes(tag)).toBe(expected);
  });
});

describe('quoted values: src and width', () => {
  it.each<[string, string | null]>([
    [' src="a"', 'a'],
    [" SRC = 'b'", 'b'],
    [" src=\"open src='c'", 'c'],
    [' data-src="x" src="y"', 'y'],
    [' src=x src="z"', 'z'],
    [' src=""', ''],
    ['\tsrc="t"', 't']
  ])('src of %j', (atts, expected) => {
    const found = firstQuotedValue(atts, 'src', false);
    expect(found === null ? null : atts.slice(found.valueStart, found.valueEnd)).toBe(expected);
  });

  it.each<[string, string | null]>([
    [' width="10"', '10'],
    ["\"width='5'", '5'],
    [' data-width="1" width="2"', '2'],
    [' width="open', null],
    [' width= "3"', '3']
  ])('width of %j', (atts, expected) => {
    const found = firstQuotedValue(atts, 'width', true);
    expect(found === null ? null : atts.slice(found.valueStart, found.valueEnd)).toBe(expected);
  });

  it('imageSource trims, and refuses an empty value', () => {
    expect(imageSource(' src=" a.jpg "')).toBe('a.jpg');
    expect(imageSource(' src=" "')).toBeNull();
    expect(imageSource(' data-src="x"')).toBeNull();
  });
});

describe('attribute rewrites', () => {
  it.each<[string, string]>([
    [' src="a.jpg"', ' src="P"'],
    [' src="a b.jpg"', ' src="a b.jpg"'],
    [' src=\'x\' src="y"', ' src="P" src="P"'],
    [' src=""', ' src=""'],
    [' src="a\'b"', ' src="a\'b"'],
    ['\tSRC = "z"', ' src="P"'],
    [' src="q>"', ' src="q>"']
  ])('placeholder src in %j', (atts, expected) => {
    expect(withPlaceholderSource(atts, 'P')).toBe(expected);
  });

  it.each<[string, string]>([
    [' loading="lazy"', ''],
    [" LOADING = 'AUTO'", ''],
    [' loading="eager"', ' loading="eager"'],
    [' loading="lazy\'', ' loading="lazy\''],
    [' a loading=\'lazy\' b loading="auto"', ' a b']
  ])('native loading out of %j', (tag, expected) => {
    expect(withoutNativeLoading(tag)).toBe(expected);
  });

  it.each<[string, string]>([
    ['loading="lazy"', ''],
    ['loading=\'lazy"', ''],
    ['LOADING="LAZY"', ''],
    ['loading = "lazy"', 'loading = "lazy"'],
    ['data-loading="lazy"', 'data-']
  ])('loading=lazy out of %j', (text, expected) => {
    expect(withoutLazyLoading(text)).toBe(expected);
  });

  it.each<[string, string]>([
    ['<source srcset="a">', '<source data-lazy-srcset="a">'],
    ['<source "srcset=\'b\' SRCSET="c">', '<source "data-lazy-srcset=\'b\' data-lazy-srcset="c">'],
    ['<source data-srcset="x">', '<source data-srcset="x">'],
    ['<source  srcsetsrcset>', '<source  data-lazy-srcsetsrcset>']
  ])('source srcset in %j', (source, expected) => {
    expect(withLazySourceSrcset(source)).toBe(expected);
  });
});

describe('backgroundUrl', () => {
  it.each<[string, { declaration: string; url: string } | null]>([
    [
      'background-image:url(a.png)',
      { 'declaration': 'background-image:url(a.png)', 'url': 'a.png' }
    ],
    [
      "BACKGROUND-IMAGE : URL ( 'b' ) ; x",
      { 'declaration': "BACKGROUND-IMAGE : URL ( 'b' ) ;", 'url': " 'b' " }
    ],
    ['background-image:url()', null],
    [
      'background-image: none; background-image:url(c)',
      { 'declaration': 'background-image:url(c)', 'url': 'c' }
    ],
    ['background-image:url(d', null],
    ['xbackground-image:url(e)  ;', { 'declaration': 'background-image:url(e)  ;', 'url': 'e' }]
  ])('%j', (styles, expected) => {
    expect(backgroundUrl(styles)).toEqual(expected);
  });

  it.each<[string, string]>([
    ['"a"', 'a'],
    ["'b'", 'b'],
    ['"c\'', '"c\''],
    ['"', '"'],
    ["''", ''],
    ['x', 'x']
  ])('outer quotes of %j', (value, expected) => {
    expect(withoutOuterQuotes(value)).toBe(expected);
  });
});

describe('helpers', () => {
  it('isExcludedBy ignores empty and "0" rows, case-sensitive', () => {
    expect(isExcludedBy('a0b', ['', '0'])).toBe(false);
    expect(isExcludedBy('Hero', ['hero'])).toBe(false);
    expect(isExcludedBy('hero', ['x', 'her'])).toBe(true);
  });

  it('lazyPlaceholder sizes the empty SVG', () => {
    expect(lazyPlaceholder(3, 0)).toBe(
      "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%203%200'%3E%3C/svg%3E"
    );
  });
});
