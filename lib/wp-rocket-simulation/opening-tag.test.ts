/**
 * The opening-tag scanner against the patterns it replaces
 * (`/<name[^>]*>/i`, `/(<name\b[^>]*?>)/i`), and its speed on pages the
 * patterns are quadratic on.
 */
import { describe, expect, it } from 'vitest';
import { linearScaling } from '../../vitest.shared';
import { firstOpeningTag, openingTagStart } from './opening-tag';

/**
 * The reference: the pattern's first match as a span.
 *
 * @param html The page.
 * @param pattern The pattern.
 */
function reference(html: string, pattern: RegExp): { start: number; end: number } | null {
  const found = pattern.exec(html);
  return found === null ? null : { start: found.index, end: found.index + found[0].length };
}

describe('firstOpeningTag', () => {
  it.each([
    '<html><head a="1"><title>',
    '<header><HEAD>',
    '<head',
    'x<head-x>',
    '<headx><head >',
    '<HeAd\n>',
    '<head <head>',
    'no tag',
    '<header>',
    '<headé>',
    '<head_>'
  ])('agrees with both patterns on %j', (html) => {
    expect(firstOpeningTag(html, 'head', false)).toEqual(reference(html, /<head[^>]*>/i));
    expect(firstOpeningTag(html, 'head', true)).toEqual(reference(html, /<head\b[^>]*?>/i));
  });

  it('agrees with the patterns on random pages', () => {
    let state = 11;
    const next = (): number => (state = (state * 48_271) % 2_147_483_647) / 2_147_483_647;
    const pieces = ['<head', '<HEAD', '<header', '>', ' ', 'a', '<html', '_', '-', 'é'];
    for (let round = 0; round < 2000; round++) {
      let html = '';
      for (let index = 0; index < 8; index++)
        html += pieces[Math.floor(next() * pieces.length)] ?? '';
      expect(firstOpeningTag(html, 'head', false), html).toEqual(reference(html, /<head[^>]*>/i));
      expect(firstOpeningTag(html, 'head', true), html).toEqual(reference(html, /<head\b[^>]*?>/i));
      expect(firstOpeningTag(html, 'html', true), html).toEqual(reference(html, /<html\b[^>]*?>/i));
    }
  });

  it('finds the start without needing a `>`', () => {
    expect(openingTagStart('ab<HEAD', 'head', true)).toBe(2);
    expect(openingTagStart('<heads', 'head', true)).toBe(-1);
    expect(openingTagStart('<heads', 'head', false)).toBe(0);
  });

  it('reads `<head` without a `>` in linear time (1 → 4 MiB)', () => {
    // The patterns took ~0.5 s per 64 KiB here (quadratic).
    const scaling = linearScaling(
      (bytes) => '<head '.repeat(Math.floor(bytes / 6)),
      (html) => [firstOpeningTag(html, 'head', false), firstOpeningTag(html, 'head', true)]
    );
    expect(scaling.violation).toBeUndefined();
    expect(scaling.output).toEqual([null, null]);
  });
});
