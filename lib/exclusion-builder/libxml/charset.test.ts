/**
 * How libxml reads a page's bytes, rebuilt from the session's decoding —
 * the declaration rules measured on libxml 2.9.13 (PHP 8.1.34).
 */
import { describe, expect, it } from 'vitest';
import { scanTags } from '../html-scan';
import { libxmlCharacters, libxmlTextMode, type DocumentBytes } from './charset';

/** The mode of a page whose head/body prefix is `prefix`. */
const modeOf = (prefix: string, bytes?: DocumentBytes): string => {
  const html = `${prefix}<div class="x">x</div></body></html>`;
  return libxmlTextMode(html, scanTags(html), bytes);
};

describe('libxmlTextMode — UTF-8 bytes (the default)', () => {
  it('reads UTF-8 from a charset meta, in any spelling, before any non-ASCII (measured)', () => {
    expect(modeOf('<html><head><meta charset="utf-8"></head><body>')).toBe('utf-8');
    expect(modeOf('<html><head><META CHARSET="UTF-8" /></head><body>')).toBe('utf-8');
    expect(modeOf('<html><head><meta charset=utf8></head><body>')).toBe('utf-8');
    expect(modeOf('<html><head><meta charset=" utf-8 "></head><body>')).toBe('utf-8');
    expect(
      modeOf(
        '<html><head><meta content="text/html; charset=utf-8" http-equiv="content-type"></head><body>'
      )
    ).toBe('utf-8');
    expect(modeOf('<html><head></head><body><div>aaa</div><meta charset="utf-8">')).toBe('utf-8');
  });

  it('falls back to Latin-1 without a declaration, or after non-ASCII text (measured)', () => {
    const latin = 'latin-1-of-utf-8';
    expect(modeOf('<html><head></head><body>')).toBe(latin);
    expect(modeOf('<html><head><!-- <meta charset="utf-8"> --></head><body>')).toBe(latin);
    expect(modeOf('<html><head><meta content="text/html; charset=utf-8"></head><body>')).toBe(
      latin
    );
    expect(modeOf('<html><head><title>é</title><meta charset="utf-8"></head><body>')).toBe(latin);
    expect(modeOf('<html lang="é"><head><meta charset="utf-8"></head><body>')).toBe(latin);
    expect(modeOf('<html><head><meta charset="iso-8859-1"></head><body>')).toBe(latin);
  });

  it('keeps the first declaration, and leaves other charsets unknown (measured)', () => {
    expect(
      modeOf('<html><head><meta charset="iso-8859-1"><meta charset="utf-8"></head><body>')
    ).toBe('latin-1-of-utf-8');
    expect(
      modeOf('<html><head><meta charset="utf-8"><meta charset="iso-8859-1"></head><body>')
    ).toBe('utf-8');
    expect(modeOf('<html><head><meta charset="windows-1252"></head><body>')).toBe('unknown');
  });
});

describe('libxmlTextMode — how the session decoded the bytes', () => {
  const NO_META = '<html><head></head><body>';
  const UTF8_META = '<html><head><meta charset="utf-8"></head><body>';

  it('reads a UTF-8 BOM page as UTF-8 even without a declaration (measured)', () => {
    expect(modeOf(NO_META, { encoding: 'utf-8', bom: true })).toBe('utf-8');
    expect(modeOf(NO_META, { encoding: 'UTF-16LE', bom: true })).toBe('unknown');
  });

  it('reads single-byte bytes as Latin-1 only where libxml decodes Latin-1', () => {
    const single = { encoding: 'windows-1252', bom: false };
    expect(modeOf(NO_META, single)).toBe('latin-1');
    expect(modeOf('<html><head><meta charset="latin1"></head><body>', single)).toBe('latin-1');
    // libxml decodes UTF-8 there, but the bytes are not UTF-8.
    expect(modeOf(UTF8_META, single)).toBe('unknown');
    expect(modeOf(NO_META, { encoding: 'shift_jis', bom: false })).toBe('unknown');
  });
});

describe('libxmlCharacters', () => {
  it('maps each mode, leaving ASCII text alone', () => {
    expect(libxmlCharacters('abc', 'unknown')).toBe('abc');
    expect(libxmlCharacters('aé', 'utf-8')).toBe('aé');
    expect(libxmlCharacters('aé', 'latin-1-of-utf-8')).toBe('aÃ©');
    expect(libxmlCharacters('aé', 'latin-1')).toBe('aé');
    expect(libxmlCharacters('a€', 'latin-1')).toBeNull();
    expect(libxmlCharacters('aé', 'unknown')).toBeNull();
  });
});
