import { describe, expect, it } from 'vitest';
import { servedByteMeasure } from './served-measure';
import { UTF8_MEASURE } from './utf8';

describe('servedByteMeasure', () => {
  it('counts UTF-8 pages (BOM or not, or undeclared bytes) as UTF-8', () => {
    expect(servedByteMeasure(undefined, 'café')).toBe(UTF8_MEASURE);
    expect(servedByteMeasure({ encoding: 'utf-8', bom: false }, 'café')).toBe(UTF8_MEASURE);
    expect(servedByteMeasure({ encoding: 'utf-8', bom: true }, 'café')).toBe(UTF8_MEASURE);
  });

  it('counts an all-ASCII page in another single-byte charset as UTF-8 (same bytes)', () => {
    const ascii = '<html><head></head><body>\u0000~\u007f</body></html>';
    expect(servedByteMeasure({ encoding: 'windows-1252', bom: false }, ascii)).toBe(UTF8_MEASURE);
    expect(servedByteMeasure({ encoding: 'iso-8859-2', bom: false }, '')).toBe(UTF8_MEASURE);
  });

  it('refuses non-ASCII text in another charset (its bytes are not the UTF-8 ones)', () => {
    expect(servedByteMeasure({ encoding: 'windows-1252', bom: false }, 'café')).toBeNull();
    expect(servedByteMeasure({ encoding: 'koi8-r', bom: false }, 'ж')).toBeNull();
    expect(servedByteMeasure({ encoding: 'windows-1252', bom: false }, '\u0080')).toBeNull();
  });

  it('refuses UTF-16 pages, ASCII or not (every unit is two bytes)', () => {
    expect(servedByteMeasure({ encoding: 'utf-16le', bom: true }, '<p>x</p>')).toBeNull();
    expect(servedByteMeasure({ encoding: 'utf-16be', bom: false }, '<p>x</p>')).toBeNull();
  });
});
