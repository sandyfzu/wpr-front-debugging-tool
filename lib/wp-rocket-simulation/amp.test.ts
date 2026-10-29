/** AMP documents: detected on the root `<html>` element only. */
import { describe, expect, it } from 'vitest';
import { scanTags } from '../exclusion-builder/html-scan';
import { AMP_HTML_ATTRIBUTES, isAmpDocument } from './amp';

describe('isAmpDocument', () => {
  it.each(['<html amp>', '<!doctype html><HTML ⚡ lang="en">', '<html lang="en" AMP="">'])(
    '%j is AMP',
    (html) => {
      expect(isAmpDocument(`${html}<head></head></html>`)).toBe(true);
    }
  );

  it.each([
    '<html lang="en"><body amp></body></html>',
    '<!-- <html amp> --><html>',
    '<p>no root element</p>',
    '<html data-amp="1">'
  ])('%j is not AMP', (html) => {
    expect(isAmpDocument(html)).toBe(false);
  });

  it('reads pre-scanned tags when given', () => {
    const html = '<html amp></html>';
    expect(isAmpDocument(html, scanTags(html))).toBe(true);
    expect(isAmpDocument(html, [])).toBe(false);
  });

  it('declares both spellings', () => {
    expect(AMP_HTML_ATTRIBUTES).toEqual(['amp', '⚡']);
  });
});
