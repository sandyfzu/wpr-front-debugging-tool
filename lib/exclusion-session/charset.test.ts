/**
 * Charset resolution and the lossless round trip: BOMs, the `Content-Type`
 * charset (Fetch/MIME parsing), the `<meta>` prescan (WHATWG cases), the
 * default, and decode → encode across every supported encoding class plus
 * the refused ones.
 */
import { describe, expect, it } from 'vitest';
import {
  contentTypeCharset,
  extractMimeType,
  decodeDocument,
  encodeDocument,
  encodingForLabel,
  isRoundTripEncoding,
  metaContentCharset,
  PRESCAN_BYTE_LIMIT,
  prescanEncoding,
  resolveDocumentEncoding,
  sniffByteOrderMark
} from './charset';

/** Latin-1-style bytes of an ASCII/byte string (code unit = byte). */
function bytes(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

/** UTF-8 bytes of a string. */
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Decode, assert success, return the result. */
function decodeOk(body: Uint8Array, contentType: string | null) {
  const decoded = decodeDocument(body, contentType);
  if (!decoded.ok) throw new Error(`decode failed: ${decoded.reason} (${decoded.encoding})`);
  return decoded;
}

describe('sniffByteOrderMark', () => {
  it.each([
    [[0xef, 0xbb, 0xbf, 0x3c], 'utf-8', 3],
    [[0xfe, 0xff, 0x00, 0x3c], 'utf-16be', 2],
    [[0xff, 0xfe, 0x3c, 0x00], 'utf-16le', 2]
  ])('sniffs %j as %s', (input, encoding, length) => {
    expect(sniffByteOrderMark(Uint8Array.from(input))).toEqual({ encoding, length });
  });

  it('finds none in plain markup, a truncated BOM, or an empty body', () => {
    expect(sniffByteOrderMark(bytes('<html>'))).toBeNull();
    expect(sniffByteOrderMark(Uint8Array.of(0xef, 0xbb))).toBeNull();
    expect(sniffByteOrderMark(new Uint8Array())).toBeNull();
  });
});

describe('encodingForLabel', () => {
  it('resolves labels case-insensitively and trimmed to canonical names', () => {
    expect(encodingForLabel('UTF-8')).toBe('utf-8');
    expect(encodingForLabel('  utf8 ')).toBe('utf-8');
    expect(encodingForLabel('latin1')).toBe('windows-1252');
    expect(encodingForLabel('ISO-8859-1')).toBe('windows-1252');
    expect(encodingForLabel('ascii')).toBe('windows-1252');
    expect(encodingForLabel('Shift_JIS')).toBe('shift_jis');
    expect(encodingForLabel('utf-16')).toBe('utf-16le');
  });

  it('resolves the replacement labels the platform decoder refuses', () => {
    for (const label of ['iso-2022-kr', 'HZ-GB-2312', 'csiso2022kr', 'replacement']) {
      expect(encodingForLabel(label)).toBe('replacement');
    }
  });

  it('answers null for unknown labels', () => {
    expect(encodingForLabel('klingon')).toBeNull();
    expect(encodingForLabel('')).toBeNull();
    expect(encodingForLabel('utf-8\u0000')).toBeNull();
  });
});

describe('contentTypeCharset', () => {
  it.each([
    ['text/html; charset=UTF-8', 'UTF-8'],
    ['text/html;charset=windows-1251', 'windows-1251'],
    ['TEXT/HTML ; CHARSET = x', null], // whitespace before `=` makes the name "charset "
    ['text/html; charset="iso-8859-2"', 'iso-8859-2'],
    ['text/html; charset="shift_jis"iso-2022-jp', 'shift_jis'],
    ['text/html; charset="a\\"b"', 'a"b'],
    ['text/html; foo=bar; charset=utf-8; charset=latin1', 'utf-8'],
    ['text/html; charset=; charset=utf-8', 'utf-8'],
    ['text/html; charset=""; charset=utf-8', ''],
    ['text/html; charset', null],
    ['text/html; charset=utf-8  ', 'utf-8'],
    ['text/html', null],
    ['', null],
    ['nonsense', null],
    ['text/html; charset=utf-8, text/html', 'utf-8'],
    ['text/html; charset=utf-8, text/plain', null],
    ['text/plain; charset=latin1, text/html; charset=utf-8', 'utf-8'],
    ['text/html; charset=utf-8, */*', 'utf-8'],
    ['text/html; charset=latin1, text/html; charset=koi8-r', 'koi8-r'],
    ['text/html; x="a,b"; charset=koi8-r', 'koi8-r'],
    ['text/html; charset="unterminated', 'unterminated'],
    ['text/html; charset="trail\\', 'trail\\'],
    ['te xt/html; charset=utf-8', null],
    ['text/; charset=utf-8', null]
  ])('extracts %j → %j', (header, expected) => {
    expect(contentTypeCharset(header)).toBe(expected);
  });

  it('answers null for an absent header', () => {
    expect(contentTypeCharset(null)).toBeNull();
  });
});

describe('extractMimeType', () => {
  it.each([
    ['TEXT/HTML; Charset=UTF-8', { essence: 'text/html', charset: 'UTF-8' }],
    ['text/html', { essence: 'text/html', charset: null }],
    ['application/xhtml+xml', { essence: 'application/xhtml+xml', charset: null }],
    ['text/plain, text/html', { essence: 'text/html', charset: null }],
    ['text/html; charset=koi8-r, */*', { essence: 'text/html', charset: 'koi8-r' }],
    ['text/html, nonsense', { essence: 'text/html', charset: null }]
  ])('extracts %j (last valid type wins)', (header, expected) => {
    expect(extractMimeType(header)).toEqual(expected);
  });

  it.each([[null], [''], ['nonsense'], ['*/*'], ['text/']])('answers null for %j', (header) => {
    expect(extractMimeType(header)).toBeNull();
  });
});

describe('metaContentCharset', () => {
  it.each([
    ['text/html; charset=utf-8', 'utf-8'],
    ['text/html;charset = "koi8-r"', 'koi8-r'],
    ["text/html; charset='windows-1250'", 'windows-1250'],
    ['charsetx; charset=latin1', 'windows-1252'],
    ['text/html; charset=utf-8;foo', 'utf-8'],
    ['text/html; charset="utf-8', null],
    ['text/html; charset=', null],
    ['text/html', null],
    ['charset=bogus', null]
  ])('extracts %j → %j', (content, expected) => {
    expect(metaContentCharset(content)).toBe(expected);
  });
});

describe('prescanEncoding', () => {
  it.each([
    ['<meta charset="windows-1251">', 'windows-1251'],
    ['<META CHARSET=KOI8-R>', 'koi8-r'],
    ["<meta charset='iso-8859-2'/>", 'iso-8859-2'],
    ['<meta http-equiv="Content-Type" content="text/html; charset=windows-1250">', 'windows-1250'],
    ['<meta content="text/html; charset=windows-1250" http-equiv="content-type">', 'windows-1250'],
    ['<meta/charset=utf-8>', 'utf-8'],
    ['<!doctype html><html><head><meta charset=utf-8>', 'utf-8'],
    ['<meta charset="utf-16">', 'utf-8'],
    ['<meta charset="x-user-defined">', 'windows-1252'],
    ['<meta charset="iso-2022-kr">', 'replacement'],
    ['<meta name=x charset = "latin1" >', 'windows-1252']
  ])('finds %j → %s', (head, expected) => {
    expect(prescanEncoding(bytes(head))).toBe(expected);
  });

  it.each([
    ['a content charset without the pragma', '<meta content="text/html; charset=koi8-r">'],
    ['a pragma without a charset', '<meta http-equiv="content-type" content="text/html">'],
    ['an unknown label', '<meta charset="klingon">'],
    ['a meta inside a comment', '<!-- <meta charset="koi8-r"> -->'],
    ['a meta-looking attribute value', '<div title="<meta charset=koi8-r>">'],
    ['a meta-looking end tag', '</meta charset=koi8-r>'],
    ['a <metadata> tag', '<metadata charset="koi8-r">'],
    ['a processing instruction', '<?php <meta charset="koi8-r"> ?>'],
    ['nothing at all', '<html><body>hi</body></html>'],
    ['an empty window', '']
  ])('declares nothing for %s', (_case, head) => {
    expect(prescanEncoding(bytes(head))).toBeNull();
  });

  it('honors the first duplicate attribute only', () => {
    expect(prescanEncoding(bytes('<meta charset="koi8-r" charset="utf-8">'))).toBe('koi8-r');
  });

  it('lets a later charset attribute override a content charset', () => {
    const head = '<meta http-equiv="content-type" content="charset=koi8-r" charset="koi8-u">';
    expect(prescanEncoding(bytes(head))).toBe('koi8-u');
  });

  it('ignores a content charset once a charset attribute failed', () => {
    const head = '<meta charset="bogus" http-equiv="content-type" content="charset=koi8-r">';
    expect(prescanEncoding(bytes(head))).toBeNull();
  });

  it('closes `<!-->` and `<!--->` immediately (the opener dashes count)', () => {
    expect(prescanEncoding(bytes('<!--><meta charset="koi8-r">'))).toBe('koi8-r');
    expect(prescanEncoding(bytes('<!---><meta charset="koi8-r">'))).toBe('koi8-r');
  });

  it('ends a comment only at a `-->` after its own `<` (back-to-back comments)', () => {
    // A search starting before the opener would re-find the previous `-->` and never advance.
    const head = '<!-- a --><!-- b --><!--><meta charset="koi8-r">';
    expect(prescanEncoding(bytes(head))).toBe('koi8-r');
    // `<!-->` ends at its own `>`: a search starting past it swallows the meta up to the later `-->`.
    expect(prescanEncoding(bytes('<!--><meta charset="koi8-r"><!-- -->'))).toBe('koi8-r');
  });

  it('reads only the first 1024 bytes', () => {
    const padding = ' '.repeat(PRESCAN_BYTE_LIMIT);
    expect(prescanEncoding(bytes(`${padding}<meta charset="koi8-r">`))).toBeNull();
    const fits = `${' '.repeat(PRESCAN_BYTE_LIMIT - 25)}<meta charset="koi8-r">`;
    expect(prescanEncoding(bytes(fits))).toBe('koi8-r');
  });

  it('stops at an unterminated comment, tag or attribute (falls back to the XML check)', () => {
    expect(prescanEncoding(bytes('<!-- never closed <meta charset=koi8-r>'))).toBeNull();
    expect(prescanEncoding(bytes('<meta charset="koi8-r'))).toBeNull();
    expect(prescanEncoding(bytes('<div class="x'))).toBeNull();
    expect(prescanEncoding(bytes('<!doctype'))).toBeNull();
  });

  it('detects UTF-16 `<?x` prefixes in both byte orders', () => {
    expect(prescanEncoding(Uint8Array.of(0x3c, 0, 0x3f, 0, 0x78, 0))).toBe('utf-16le');
    expect(prescanEncoding(Uint8Array.of(0, 0x3c, 0, 0x3f, 0, 0x78))).toBe('utf-16be');
  });

  it.each([
    ['<?xml version="1.0" encoding="windows-1251"?><html>', 'windows-1251'],
    ["<?xml encoding = 'koi8-r'?>", 'koi8-r'],
    ['<?xml version="1.0" encoding="utf-16"?>', 'utf-8'],
    ['<?xml version="1.0"?><p encoding="koi8-r">', null],
    ['<?xml encoding="koi 8"?>', null],
    ['<?xml encoding=koi8-r?>', null],
    ['<?xml encoding="koi8-r', null],
    ['<?xml encoding', null],
    ['<?xml encoding x="koi8-r"?>', null],
    ['<?xml encoding=""?>', null],
    ['<?XML encoding="koi8-r"?>', null]
  ])('falls back to the XML declaration: %j → %j', (head, expected) => {
    expect(prescanEncoding(bytes(head))).toBe(expected);
  });
});

describe('resolveDocumentEncoding', () => {
  const meta = bytes('<meta charset="koi8-r">');

  it('puts the BOM above every declaration', () => {
    const body = Uint8Array.of(0xef, 0xbb, 0xbf, ...meta);
    expect(resolveDocumentEncoding(body, 'text/html; charset=windows-1251')).toEqual({
      encoding: 'utf-8',
      source: 'bom',
      bomLength: 3
    });
  });

  it('puts a known transport charset above the meta prescan', () => {
    expect(resolveDocumentEncoding(meta, 'text/html; charset=windows-1251')).toEqual({
      encoding: 'windows-1251',
      source: 'transport',
      bomLength: 0
    });
  });

  it('ignores an unknown transport label and prescans', () => {
    expect(resolveDocumentEncoding(meta, 'text/html; charset=bogus')).toEqual({
      encoding: 'koi8-r',
      source: 'prescan',
      bomLength: 0
    });
  });

  it('falls back to the default when nothing declares an encoding', () => {
    expect(resolveDocumentEncoding(bytes('<p>x</p>'), 'text/html')).toEqual({
      encoding: null,
      source: 'default',
      bomLength: 0
    });
  });
});

describe('decodeDocument / encodeDocument round trip', () => {
  /** Decode then re-encode unchanged: the bytes must come back identical. */
  function roundTrip(body: Uint8Array, contentType: string | null): Uint8Array | null {
    const decoded = decodeOk(body, contentType);
    return encodeDocument(decoded.text, decoded.codec);
  }

  it('round-trips UTF-8 (declared, with and without a BOM)', () => {
    const body = utf8('<meta charset=utf-8><p>café — 日本 🎉</p>');
    expect(roundTrip(body, 'text/html; charset=utf-8')).toEqual(body);
    const withBom = Uint8Array.of(0xef, 0xbb, 0xbf, ...body);
    const decoded = decodeOk(withBom, null);
    expect(decoded.text.startsWith('<meta')).toBe(true);
    expect(decoded.codec).toEqual({ encoding: 'utf-8', bom: Uint8Array.of(0xef, 0xbb, 0xbf) });
    expect(encodeDocument(decoded.text, decoded.codec)).toEqual(withBom);
  });

  it('keeps a second BOM-like character as text (never swallowed)', () => {
    const body = Uint8Array.of(0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x41);
    const decoded = decodeOk(body, null);
    expect(decoded.text).toBe('﻿A');
    expect(encodeDocument(decoded.text, decoded.codec)).toEqual(body);
  });

  it('round-trips UTF-16LE and UTF-16BE (BOM and transport-declared)', () => {
    const text = '<p>ü 🎉</p>';
    const le = new Uint8Array(text.length * 2);
    const be = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      const unit = text.charCodeAt(i);
      le[i * 2] = unit & 0xff;
      le[i * 2 + 1] = unit >> 8;
      be[i * 2] = unit >> 8;
      be[i * 2 + 1] = unit & 0xff;
    }
    const leBom = Uint8Array.of(0xff, 0xfe, ...le);
    const beBom = Uint8Array.of(0xfe, 0xff, ...be);
    expect(decodeOk(leBom, null).text).toBe(text);
    expect(roundTrip(leBom, null)).toEqual(leBom);
    expect(roundTrip(beBom, 'text/html; charset=utf-8')).toEqual(beBom);
    expect(roundTrip(le, 'text/html; charset=utf-16le')).toEqual(le);
    expect(roundTrip(be, 'text/html; charset=utf-16be')).toEqual(be);
  });

  it('round-trips a declared single-byte document across every byte it maps', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(roundTrip(all, 'text/html; charset=windows-1252')).toEqual(all);
    expect(roundTrip(all, 'text/html; charset=windows-1251')).toEqual(all);
    expect(roundTrip(all, 'text/html; charset=x-user-defined')).toEqual(all);
    expect(decodeOk(bytes('\xe9'), 'text/html; charset=windows-1252').text).toBe('é');
    expect(decodeOk(bytes('\xc1'), 'text/html; charset=koi8-r').text).toBe('а');
  });

  it('round-trips a meta-declared single-byte document', () => {
    const body = bytes('<meta charset="windows-1250"><p>\x8a\xe8</p>');
    const decoded = decodeOk(body, 'text/html');
    expect(decoded.codec.encoding).toBe('windows-1250');
    expect(decoded.text).toContain('Šč');
    expect(encodeDocument(decoded.text, decoded.codec)).toEqual(body);
  });

  it('defaults an undeclared document to UTF-8 when valid, else windows-1252 (both lossless)', () => {
    const valid = utf8('<p>café</p>');
    expect(decodeOk(valid, 'text/html').codec.encoding).toBe('utf-8');
    expect(roundTrip(valid, null)).toEqual(valid);
    const latin = bytes('<p>caf\xe9 \x81\x8d</p>');
    const decoded = decodeOk(latin, 'text/html');
    expect(decoded.codec.encoding).toBe('windows-1252');
    expect(decoded.text).toContain('café');
    expect(encodeDocument(decoded.text, decoded.codec)).toEqual(latin);
  });

  it('refuses malformed bytes for a declared encoding (no U+FFFD laundering)', () => {
    expect(decodeDocument(bytes('<p>caf\xe9</p>'), 'text/html; charset=utf-8')).toEqual({
      ok: false,
      reason: 'malformed-bytes',
      encoding: 'utf-8'
    });
    // 0xA5 is unmapped in ISO-8859-3.
    expect(decodeDocument(bytes('\xa5'), 'text/html; charset=iso-8859-3')).toEqual({
      ok: false,
      reason: 'malformed-bytes',
      encoding: 'iso-8859-3'
    });
    // A lone UTF-16 surrogate.
    expect(decodeDocument(Uint8Array.of(0xff, 0xfe, 0x00, 0xd8), null)).toMatchObject({
      ok: false,
      reason: 'malformed-bytes'
    });
  });

  it.each(['shift_jis', 'euc-jp', 'iso-2022-jp', 'gbk', 'gb18030', 'big5', 'euc-kr'])(
    'refuses the multi-byte encoding %s (no encoder)',
    (label) => {
      expect(decodeDocument(bytes('<p>x</p>'), `text/html; charset=${label}`)).toEqual({
        ok: false,
        reason: 'unsupported-encoding',
        encoding: label
      });
    }
  );

  it('refuses the replacement encoding', () => {
    expect(decodeDocument(bytes('<p>x</p>'), 'text/html; charset=iso-2022-kr')).toEqual({
      ok: false,
      reason: 'unsupported-encoding',
      encoding: 'replacement'
    });
  });

  it('encodes rewritten text (ASCII edits) in the original single-byte encoding', () => {
    const body = bytes('<img data-lazy-src="\xe9.jpg">');
    const decoded = decodeOk(body, 'text/html; charset=windows-1252');
    const edited = decoded.text.replace('data-lazy-src', 'src');
    expect(encodeDocument(edited, decoded.codec)).toEqual(bytes('<img src="\xe9.jpg">'));
  });

  it('encodes a single-byte encoding whose table has unmapped bytes', () => {
    const body = Uint8Array.from('<p>\xa1x</p>', (char) => char.charCodeAt(0));
    const decoded = decodeOk(body, 'text/html; charset=iso-8859-3');
    expect(encodeDocument(decoded.text, decoded.codec)).toEqual(body);
  });

  it('answers null for characters the encoding cannot carry', () => {
    const latin = { encoding: 'windows-1252', bom: new Uint8Array() };
    expect(encodeDocument('日本', latin)).toBeNull();
    const utf8Codec = { encoding: 'utf-8', bom: new Uint8Array() };
    expect(encodeDocument('a\uD800b', utf8Codec)).toBeNull();
    expect(encodeDocument('x', { encoding: 'shift_jis', bom: new Uint8Array() })).toBeNull();
  });

  it('declares exactly the encodings it can re-encode', () => {
    expect(isRoundTripEncoding('utf-8')).toBe(true);
    expect(isRoundTripEncoding('utf-16be')).toBe(true);
    expect(isRoundTripEncoding('iso-8859-8-i')).toBe(true);
    expect(isRoundTripEncoding('shift_jis')).toBe(false);
    expect(isRoundTripEncoding('replacement')).toBe(false);
  });
});
