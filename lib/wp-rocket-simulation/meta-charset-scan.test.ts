/**
 * The `<meta charset>` scanner against the pattern it replaces (run here
 * as a backtracking JS regex — exact, only slow — on small subjects), and
 * its speed on subjects the pattern is polynomial on.
 */
import { describe, expect, it } from 'vitest';
import { HOSTILE_CEILING_MS } from '../../vitest.shared';
import { metaCharsetByteSpans } from './meta-charset-scan';

/** WP Rocket's pattern without its lookahead, `U` written out (the caller cuts at the last `</head>`). */
const REFERENCE = new RegExp(
  `<meta[^h]*?(http-equiv[^=]*?=[^'"]*?['" ]Content-Type['"][ ]*?[^>]*?|)` +
    `(charset[^=]*?=[ ]*?['" ]*?[^'"> ][^'">]+?[^'"> ]['" ]*?|charset[^=]*?=*?[^'"> ][^'">]+?[^'"> ])` +
    `([^>]*?|)>`,
  'gi'
);

/**
 * The reference's matches as spans.
 *
 * @param bytes The byte view.
 */
function reference(bytes: string): [number, number][] {
  return Array.from(bytes.matchAll(REFERENCE), (found) => [
    found.index,
    found.index + found[0].length
  ]);
}

describe('metaCharsetByteSpans', () => {
  it.each([
    ['case A: `charset` right before the first `h`', '<meta charset="utf-8">'],
    ['the first branch needs 3 bytes after the quotes', '<meta charset=ab><meta charset=abc>'],
    ['the second branch through an `=` run', '<meta charset==ab>'],
    ['the second branch across a `>`', '<meta charset><title>t</title>'],
    ['the first branch before the second', '<meta charset> x=abc>'],
    [
      'case B: Content-Type after a space',
      '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">'
    ],
    ['case B: Content-Type after its quote', "<meta http-equiv=a 'Content-Type' charset=abc>"],
    [
      'case B: no Content-Type at the first quote',
      '<meta http-equiv="x" Content-Type" charset=abc>'
    ],
    [
      'case B: `charset` must come before the next `>`',
      '<meta http-equiv= Content-Type">charset=abc>'
    ],
    ['no `h` after `<meta`', '<meta charset'],
    ['an earlier `<meta` spans text without `h`', '<meta x><b>y</b><meta charset=utf-8>'],
    ['caseless', '<META CHARSET="UTF-8"><Meta HTTP-EQUIV=x CONTENT-TYPE" Charset=x-y>']
  ])('%s', (_name, bytes) => {
    expect(metaCharsetByteSpans(bytes)).toEqual(reference(bytes));
  });

  it('agrees with the pattern on random subjects', () => {
    let state = 17;
    const next = (): number => (state = (state * 48_271) % 2_147_483_647) / 2_147_483_647;
    const pieces = [
      '<meta',
      '<META ',
      ' ',
      'charset',
      'charset=',
      'http-equiv',
      'http-equiv=',
      '=',
      '"',
      "'",
      '>',
      'Content-Type',
      ' Content-Type"',
      '"Content-Type\'',
      'h',
      'H',
      'a',
      'utf-8',
      '\x80',
      ';'
    ];
    let matched = 0;
    for (let round = 0; round < 20_000; round++) {
      let bytes = next() < 0.5 ? '<meta ' : '<meta http-equiv=';
      const count = 2 + Math.floor(next() * 30);
      for (let index = 0; index < count; index++) {
        bytes += pieces[Math.floor(next() * pieces.length)] ?? '';
      }
      const expected = reference(bytes);
      if (expected.length > 0) matched++;
      expect(metaCharsetByteSpans(bytes), bytes).toEqual(expected);
    }
    expect(matched).toBeGreaterThan(2000);
  });

  it.each([
    ['`<meta charset` repeated (1 KiB took the pattern 1.2 s)', '<meta charset'],
    ['`<meta ` repeated before one `charset`', '<meta '],
    ['`http-equiv` blocks sharing one far `>`', '<meta http-equiv=x Content-Type"charset '],
    ['`charset` repeated with no `=` or `>`', 'charset ']
  ])('reads 4 MiB of %s in linear time', (_name, unit) => {
    const bytes = `${unit.repeat((4 * 1024 * 1024) / unit.length)}charset`;
    const started = performance.now();
    metaCharsetByteSpans(bytes);
    expect(performance.now() - started).toBeLessThan(HOSTILE_CEILING_MS);
  });
});
