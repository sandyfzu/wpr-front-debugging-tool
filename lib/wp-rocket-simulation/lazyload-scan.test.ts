/**
 * LazyLoad's page-scale regexes as scanners, and the per-picture image
 * replacement: every expected value below is the plugin's own `preg_*`
 * call's result (PHP 8.1, PCRE2 10.49, JIT on).
 */
import { describe, expect, it } from 'vitest';
import {
  PICTURE_IMAGE_PATTERN_BAND_BYTES,
  PICTURE_IMAGE_PATTERN_MAX_BYTES,
  pictureImagePatternCompiles,
  replacePictureImage
} from './lazyload-picture-image';
import {
  backgroundElementMatches,
  imageMatches,
  lazyloadParseCopy,
  pictureMatches,
  sourceMatches
} from './lazyload-scan';
import { ReplacementWorkExceeded } from './str-replace-sequence';
import { UTF8_MEASURE } from './utf8';

describe('lazyloadParseCopy', () => {
  it.each<[string, string]>([
    ['a<script>x</script>b', 'ab'],
    ['<SCRIPT type=x>y</script \n>c', 'c'],
    ['<script>open', '<script>open'],
    ['<noscript><img></noscript>d<noscript x>e</NOSCRIPT>', 'd'],
    ['<scriptx>z</script>w', 'w'],
    ['<script>a</script>b<script>c', 'b<script>c']
  ])('%j', (html, expected) => {
    expect(lazyloadParseCopy(html, UTF8_MEASURE)).toBe(expected);
  });
});

describe('pictureMatches', () => {
  it.each<[string, [string, string][]]>([
    ['<picture><img src=a></picture>', [['<picture><img src=a></picture>', '<img src=a>']]],
    [
      '<picture class=x><source srcset=s><img></picture><picture class=x><source srcset=s><img></picture>',
      [['<picture class=x><source srcset=s><img></picture>', '<source srcset=s><img>']]
    ],
    ['<PICTURE>a</picture></picture>', [['<PICTURE>a</picture>', 'a']]],
    ['<picture-x a>b</picture>', [['<picture-x a>b</picture>', 'b']]],
    ['<picture>a', []],
    ['<picture>>a</picture>', [['<picture>>a</picture>', '>a']]],
    ['<picture></picture>', [['<picture></picture>', '']]]
  ])('%j', (html, expected) => {
    expect(pictureMatches(html, UTF8_MEASURE)).toEqual(
      expected.map(([text, sources]) => ({ text, sources }))
    );
  });

  // PCRE skips its required-`>` check past 500 000 bytes left (measured: 2 steps per byte then,
  // `<picture` + 600 000 bytes fails); any unclosed opening is charged 4 per byte + 32 to the end.
  it.each<[string, string, boolean]>([
    ['one unclosed opening at the bound', `<picture${'a'.repeat(124_992 - 8)}`, false],
    ['one unclosed opening one byte past', `<picture${'a'.repeat(124_993 - 8)}`, true],
    ['the bound counted in bytes', `<picture${'é'.repeat(62_500)}`, true],
    [
      'a match before a 600 000-byte tail',
      `<picture>a</picture><picture${'a'.repeat(600_000)}`,
      true
    ],
    [
      '4 000 openings of 308 bytes',
      `<picture>a</picture>${`<picture${'a'.repeat(300)}`.repeat(4000)}`,
      true
    ],
    [
      'openings summed (the first alone is under it)',
      `<picture${'a'.repeat(20_000)}`.repeat(4),
      true
    ],
    ['two short openings', `<picture${'a'.repeat(20_000)}`.repeat(2), false]
  ])('refuses %s past the ceiling: %#', (_name, html, refused) => {
    expect('beyond' in pictureMatches(html, UTF8_MEASURE)).toBe(refused);
  });
});

describe('imageMatches', () => {
  it.each<[string, [string, string][]]>([
    ['<img src=a>', [['<img src=a>', ' src=a']]],
    ['<img src=a />', [['<img src=a />', ' src=a']]],
    ['<img src=a/>', [['<img src=a/>', ' src=a']]],
    ['<img  >', [['<img  >', '  ']]],
    ['<img >x>', [['<img >x>', ' >x']]],
    ['<img/>', []],
    ['<IMG\tsrc=b>', [['<IMG\tsrc=b>', '\tsrc=b']]],
    ['<imgx a>', []],
    ['<img a<img b>', [['<img a<img b>', ' a<img b']]],
    ['<img a', []],
    ['<img / />', [['<img / />', ' /']]],
    ['<img a\n/>', [['<img a\n/>', ' a']]]
  ])('%j', (html, expected) => {
    expect(imageMatches(html, UTF8_MEASURE)).toEqual(
      expected.map(([text, atts]) => ({ text, atts }))
    );
  });

  // PCRE skips its required-`>` check past 500 000 bytes left (measured: 3 steps per byte then,
  // `<img ` + 499 996 bytes fails), and reads to the end after an `<img\s>` whose `>` it cannot
  // use (measured: 300 003 steps for 100 006 bytes); any unclosed opening is charged 4 per byte + 32.
  it.each<[string, string, boolean]>([
    ['one unclosed opening at the bound', `<img ${'a'.repeat(124_992 - 5)}`, false],
    ['one unclosed opening one byte past', `<img ${'a'.repeat(124_993 - 5)}`, true],
    ['the bound counted in bytes', `<img ${'é'.repeat(62_500)}`, true],
    ['an `<img >` with its `>` unusable', `<img >${'a'.repeat(124_993 - 6)}`, true],
    ['a match before a 600 000-byte tail', `<img src="/a.jpg"><img ${'a'.repeat(600_000)}`, true],
    ['4 000 openings of 305 bytes', `<img a>${`<img ${'a'.repeat(300)}`.repeat(4000)}`, true],
    ['openings summed (the first alone is under it)', `<img ${'a'.repeat(20_000)}`.repeat(4), true],
    ['two short openings', `<img ${'a'.repeat(20_000)}`.repeat(2), false],
    ['`<imgx` openings ignored', `<imgx${'a'.repeat(600_000)}`, false]
  ])('refuses %s past the ceiling: %#', (_name, html, refused) => {
    expect('beyond' in imageMatches(html, UTF8_MEASURE)).toBe(refused);
  });

  it('stops at the first match when asked (preg_match)', () => {
    expect(imageMatches('<img a><img b>', UTF8_MEASURE, true)).toEqual([
      { text: '<img a>', atts: ' a' }
    ]);
  });
});

describe('sourceMatches', () => {
  it.each<[string, string[]]>([
    ['<source srcset=a><source srcset=a>', ['<source srcset=a>']],
    ['<source>', []],
    ['<source a/>', ['<source a/>']],
    ['<SOURCE\nb>', ['<SOURCE\nb>']],
    ['<sourcex a>', []]
  ])('%j', (sources, expected) => {
    expect(sourceMatches(sources)).toEqual(expected);
  });
});

describe('backgroundElementMatches', () => {
  it.each<[string, [string, string][]]>([
    ['<div class=a>', [['<div class=a>', 'div']]],
    ['<div title="a>b" x>', [['<div title="a>b" x>', 'div']]],
    ['<div ="a>', [['<div ="a>', 'div']]],
    ['<aside>', [['<aside>', 'aside']]],
    ['<abbr>', []],
    ['<li>', [['<li>', 'li']]],
    ['<link>', []],
    ['<a-b x>', [['<a-b x>', 'a']]],
    ["<span ='q'>t>", [["<span ='q'>", 'span']]],
    ['<div', []],
    ['<div a=b c="d" e=\'f\'>', [['<div a=b c="d" e=\'f\'>', 'div']]],
    ['<DIV>', [['<DIV>', 'DIV']]],
    ['<div title="x" =>', [['<div title="x" =>', 'div']]]
  ])('%j', (html, expected) => {
    expect(backgroundElementMatches(html)).toEqual(expected.map(([text, tag]) => ({ text, tag })));
  });
});

describe('replacePictureImage', () => {
  it.each<[string, string, string]>([
    [
      '<img src="a"><noscript><img src="a"></noscript><IMG SRC="a">',
      '<img src="a">',
      'R[<img src="a">]<noscript><img src="a"></noscript>R[<IMG SRC="a">]'
    ],
    [
      '<noscript>a\n<img src="a"></noscript>',
      '<img src="a">',
      '<noscript>a\nR[<img src="a">]</noscript>'
    ],
    [
      '<noscript><img src="a"> <img src="a"></noscript> <img src="a">',
      '<img src="a">',
      '<noscript><img src="a"> <img src="a"></noscript> R[<img src="a">]'
    ],
    [
      '<noscript><img src="a">\n</noscript><img src="a">',
      '<img src="a">',
      '<noscript>R[<img src="a">]\n</noscript>R[<img src="a">]'
    ],
    [
      '<noscript x=">"><img src="a"></noscript>',
      '<img src="a">',
      '<noscript x=">"><img src="a"></noscript>'
    ]
  ])('%j', (html, image, expected) => {
    expect(replacePictureImage(html, image, 'R[$0]')).toBe(expected);
  });

  it('leaves a page without the image as is', () => {
    expect(replacePictureImage('<p>x</p>', '<img a>', 'R')).toBe('<p>x</p>');
  });

  it('folds ASCII letters only (PCRE without UTF): `É` is not `é`', () => {
    expect(replacePictureImage('<IMG ALT=É><img alt=é>', '<img alt=é>', 'R')).toBe('<IMG ALT=É>R');
  });

  it('charges its reads to the replay work and stops past the bound', () => {
    const work = { units: 0 };
    replacePictureImage('<noscript>\n<img a>', '<img a>', 'R', work);
    expect(work.units).toBeGreaterThan('<noscript>\n<img a>'.length);
    expect(() => replacePictureImage('<img a>', '<img a>', 'R', { units: 0, limit: 3 })).toThrow(
      ReplacementWorkExceeded
    );
  });
});

describe('pictureImagePatternCompiles', () => {
  /** A tag of `bytes` bytes. */
  const tag = (bytes: number): string => `<img alt="${'a'.repeat(bytes - 12)}">`;

  it('compiles below the band, fails above it, refuses within it', () => {
    const max = PICTURE_IMAGE_PATTERN_MAX_BYTES;
    const band = PICTURE_IMAGE_PATTERN_BAND_BYTES;
    expect(pictureImagePatternCompiles(tag(max - band), UTF8_MEASURE)).toBe(true);
    expect(pictureImagePatternCompiles(tag(max), UTF8_MEASURE)).toBeNull();
    expect(pictureImagePatternCompiles(tag(max + band + 1), UTF8_MEASURE)).toBe(false);
  });
});
