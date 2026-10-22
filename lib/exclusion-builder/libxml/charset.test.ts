/**
 * How libxml reads a page's bytes, rebuilt from the session's decoding —
 * the declaration rules measured on libxml 2.9.13 (PHP 8.1.34).
 */
import { describe, expect, it } from 'vitest';
import { scanTags } from '../html-scan';
import { libxmlCharacters, libxmlTextModeAt, libxmlTextModes, type DocumentBytes } from './charset';

/** The mode at a `<div>` that follows the head/body prefix `prefix`. */
const modeOf = (prefix: string, bytes?: DocumentBytes): string => {
  const html = `${prefix}<div class="x">x</div></body></html>`;
  return libxmlTextModeAt(libxmlTextModes(html, scanTags(html), bytes), prefix.length);
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

  it('switches a UTF-8 BOM page to Latin-1 after a Latin-1 declaration only (measured)', () => {
    const bom = { encoding: 'utf-8', bom: true };
    expect(modeOf('<html><head><meta charset="iso-8859-1"></head><body>', bom)).toBe(
      'latin-1-of-utf-8'
    );
    expect(
      modeOf(
        '<html><head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"></head><body>',
        bom
      )
    ).toBe('latin-1-of-utf-8');
    // Non-ASCII before the declaration does not stop the switch after a BOM.
    expect(modeOf('<html><head><title>é</title><meta charset="latin1"></head><body>', bom)).toBe(
      'latin-1-of-utf-8'
    );
    expect(modeOf('<html><head><title>é</title><meta charset="utf-8"></head><body>', bom)).toBe(
      'utf-8'
    );
    // libxml keeps UTF-8 for a label it does not know (`bogus`) but switches for every
    // label it knows (`l1`, `iso-8859-15` → Latin-1; `us-ascii` empties the value):
    // which is which is not modelled, so any other label is unknown.
    for (const label of ['bogus', 'l1', 'iso-8859-15', 'us-ascii', 'shift_jis', '']) {
      expect(modeOf(`<html><head><meta charset="${label}"></head><body>`, bom), label).toBe(
        'unknown'
      );
    }
    expect(
      modeOf('<html><head><meta charset="iso-8859-1"><meta charset="utf-8"></head><body>', bom)
    ).toBe('latin-1-of-utf-8');
    // windows-1252 reads UTF-8 continuation bytes 0x80–0x9F differently: not modelled.
    expect(modeOf('<html><head><meta charset="windows-1252"></head><body>', bom)).toBe('unknown');
  });

  it("fails closed where libxml's look-ahead may switch a page to UTF-8 (measured)", () => {
    // Measured (no BOM, `é` in <title> before any declaration): a later
    // `http-equiv … content … charset=` anywhere — a refresh meta, a Content-Type
    // meta, even body text — makes libxml read the page as UTF-8; `<meta charset>`,
    // `<meta name content=charset=…>` and a bare `http-equiv` do not.
    const lead = '<html><head><title>é</title></head><body><div title="é">x</div>';
    for (const later of [
      '<meta http-equiv="refresh" content="5; charset=utf-8">',
      '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
      '<p>HTTP-EQUIV and CONTENT with CHARSET=utf-8</p>',
      '<p>http-equiv</p>'
    ]) {
      expect(modeOf(`${lead}${later}`), later).toBe('unknown');
    }
    for (const later of ['<meta charset="utf-8">', '<meta name="x" content="charset=utf-8">']) {
      expect(modeOf(`${lead}${later}`), later).toBe('latin-1-of-utf-8');
    }
    // An `http-equiv` before the first non-ASCII character is not searched.
    expect(
      modeOf('<html><head><meta http-equiv="X-UA-Compatible" content="IE=edge"><title>é</title>')
    ).toBe('latin-1-of-utf-8');
  });

  it('keeps the text before the switching declaration in the starting mode (measured)', () => {
    const html =
      '<html><head></head><body><div class="é">x</div><meta charset="iso-8859-1"></body></html>';
    const modes = libxmlTextModes(html, scanTags(html), { encoding: 'utf-8', bom: true });
    expect(libxmlTextModeAt(modes, html.indexOf('<div'))).toBe('utf-8');
    expect(libxmlTextModeAt(modes, html.length)).toBe('latin-1-of-utf-8');
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
