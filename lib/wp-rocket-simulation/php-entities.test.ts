/**
 * PHP's `html_entity_decode` (ENT_QUOTES | ENT_HTML5, UTF-8) on the
 * ported table, and the name sets kses and `htmlspecialchars` keep —
 * expected values printed by PHP 8.1 (numeric code points swept U+0000 to
 * U+10FFFF).
 */
import { describe, expect, it } from 'vitest';
import { htmlEntityDecodeHtml5, isHtml401EntityName, isKsesEntityName } from './php-entities';

describe('htmlEntityDecodeHtml5', () => {
  it.each<[string, string]>([
    ['&#x41;', 'A'],
    ['&#X41;', 'A'],
    ['&#0065;', 'A'],
    ['&#00000000065;', 'A'],
    ['&#+65;', '&#+65;'],
    ['&#65', '&#65'],
    ['&#x;', '&#x;'],
    ['&amp', '&amp'],
    ['&apos;', "'"],
    ['&quot;a&quot;', '"a"'],
    ['&nbsp;x', ' x'],
    ['&#99999999999999999999;', '&#99999999999999999999;'],
    ['&#13;&#x0D;', '&#13;&#x0D;'],
    ['&#9;&#10;&#11;&#12;&#127;&#160;', '\t\n&#11;\f&#127; '],
    ['&#xD800;&#xFDD0;&#xFFFE;&#x1FFFF;&#x10FFFD;', '&#xD800;&#xFDD0;&#xFFFE;&#x1FFFF;\u{10fffd}'],
    ['&&amp;', '&&'],
    ['&foo-bar;', '&foo-bar;']
  ])('%j → %j', (text, expected) => {
    expect(htmlEntityDecodeHtml5(text)).toBe(expected);
  });

  it.each(['&AMP;', '&lpar;', '&lang;', '&rang;', '&unknownname;'])(
    'refuses %j (outside the ported table, or redefined by HTML5)',
    (text) => {
      expect(htmlEntityDecodeHtml5(`/a${text}.png`)).toBeNull();
    }
  );
});

describe('entity name sets', () => {
  it('kses keeps the 253 names, htmlspecialchars all of them but apos', () => {
    expect(isKsesEntityName('apos')).toBe(true);
    expect(isHtml401EntityName('apos')).toBe(false);
    expect(isHtml401EntityName('lang')).toBe(true);
    expect(isKsesEntityName('AMP')).toBe(false);
    expect(isKsesEntityName('lpar')).toBe(false);
  });
});
