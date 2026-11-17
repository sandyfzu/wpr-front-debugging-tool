/**
 * The `<meta charset>` move. Expected pages are WP Rocket's own output
 * (`move_meta_charset_to_head`, run through the parity harness).
 */
import { describe, expect, it } from 'vitest';
import type { MetaCharsetMoveText } from '../wp-rocket/versions';
import { metaCharsetSpans, moveMetaCharsetToHead, phpEmpty } from './meta-charset';

/** Both versions' ways of writing the moved declaration: the same move otherwise. */
const MOVE_TEXTS: readonly MetaCharsetMoveText[] = ['replacement', 'literal'];

describe.each(MOVE_TEXTS)('moveMetaCharsetToHead (%s)', (moveText) => {
  it('moves the first declaration after `<head …>` and removes the others', () => {
    expect(
      moveMetaCharsetToHead(
        '<html><head a="1"><title>t</title><meta charset=utf-8><meta charset="latin1"></head></html>',
        moveText
      )
    ).toBe('<html><head a="1"><meta charset=utf-8><title>t</title></head></html>');
  });

  it('moves the http-equiv form', () => {
    expect(
      moveMetaCharsetToHead(
        '<head><title>t</title><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head>',
        moveText
      )
    ).toBe(
      '<head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><title>t</title></head>'
    );
  });

  it('falls back to after `<html …>`, then before the first tag, else drops it', () => {
    expect(
      moveMetaCharsetToHead('<html><title>t</title><meta charset=utf-8></head>', moveText)
    ).toBe('<html><meta charset=utf-8><title>t</title></head>');
    expect(moveMetaCharsetToHead('x<p>y<meta charset=utf-8></head>', moveText)).toBe(
      'x<meta charset=utf-8><p>y</head>'
    );
    expect(moveMetaCharsetToHead('x<meta charset=utf-8></head>', moveText)).toBe('x</head>');
  });

  it('drops the declaration when the `<head`/`<html` it goes after has no `>` (plugin output)', () => {
    expect(moveMetaCharsetToHead('x<meta charset=utf-8></head><head', moveText)).toBe(
      'x</head><head'
    );
    expect(moveMetaCharsetToHead('x<meta charset=utf-8></head><html', moveText)).toBe(
      'x</head><html'
    );
  });

  it('does not count `<header>` as `<head`', () => {
    expect(moveMetaCharsetToHead('<html><header><meta charset=utf-8></head>', moveText)).toBe(
      '<html><meta charset=utf-8><header></head>'
    );
  });

  it('leaves declarations after the last `</head>`, and pages without one, as they are', () => {
    const body = '<head></head><body><meta charset="utf-8"></body>';
    expect(moveMetaCharsetToHead(body, moveText)).toBe(body);
    expect(moveMetaCharsetToHead('<meta charset="utf-8">', moveText)).toBe(
      '<meta charset="utf-8">'
    );
  });
});

describe('moveMetaCharsetToHead: replacement syntax inside the moved declaration', () => {
  /** A declaration holding every replacement-syntax form (`$n`, `\\n`, `${n}`, `\\\\`, `\\$`, a lone `\\`). */
  const META = '<meta charset="utf-8" data-x="$0 \\1 ${1} \\\\ \\$ $9 \\">';

  it("replacement: expands it, per branch, against that branch's match", () => {
    const page = (lead: string): string => `${lead}<title>t</title>${META}</head><body></body>`;
    expect(moveMetaCharsetToHead(page('<html><head>'), 'replacement')).toBe(
      '<html><head><meta charset="utf-8" data-x="<head> <head> <head> \\ $  \\"><title>t</title></head><body></body>'
    );
    expect(moveMetaCharsetToHead(page('<html lang="en">'), 'replacement')).toBe(
      '<html lang="en"><meta charset="utf-8" data-x="<html lang="en"> <html lang="en"> <html lang="en"> \\ $  \\"><title>t</title></head><body></body>'
    );
    expect(moveMetaCharsetToHead(page(''), 'replacement')).toBe(
      '<meta charset="utf-8" data-x="<title <title <title \\ $  \\"><title>t</title></head><body></body>'
    );
  });

  it('literal: copies it byte for byte, in every branch', () => {
    for (const lead of ['<html><head>', '<html lang="en">', '']) {
      expect(
        moveMetaCharsetToHead(`${lead}<title>t</title>${META}</head><body></body>`, 'literal')
      ).toBe(`${lead}${META}<title>t</title></head><body></body>`);
    }
  });
});

describe('metaCharsetSpans', () => {
  it('needs 3 bytes from its `=` on (bytes, not characters)', () => {
    expect(metaCharsetSpans('<meta charset=a></head>')).toEqual([]);
    expect(metaCharsetSpans('<meta charset=ab></head>')).toEqual([[0, 17]]);
    expect(metaCharsetSpans('<meta charset=é></head>')).toEqual([[0, 16]]);
  });

  it('spans from an earlier `<meta` across text without an `h`', () => {
    expect(metaCharsetSpans('<meta x><b>y</b><meta charset=utf-8></head>')).toEqual([[0, 36]]);
  });
});

describe('phpEmpty', () => {
  it('is true for "" and "0" only', () => {
    expect([phpEmpty(''), phpEmpty('0'), phpEmpty('00'), phpEmpty(' ')]).toEqual([
      true,
      true,
      false,
      false
    ]);
  });
});
