/**
 * The string tag scanner: tokenizes opening tags (with quoted-value-aware
 * attribute spans) straight off the served HTML — no DOMParser, no entity
 * decoding, comments and declarations skipped, raw-text element regions
 * (`script`/`style`) bounded by their end tags. Hostile inputs (unclosed
 * quotes, `<` in text, malformed attribute soup) must terminate cleanly.
 */
import { describe, expect, it } from 'vitest';
import { scanTags } from './html-scan';

describe('scanTags — ordinary documents', () => {
  it('tokenizes every opening tag with its spans and lowercased name', () => {
    const html = '<!DOCTYPE html><html lang="en"><body><DIV CLASS="a">x</DIV></body></html>';
    const tags = scanTags(html);
    expect(tags.map((tag) => tag.name)).toEqual(['html', 'body', 'div']);
    const div = tags[2];
    expect(div).toBeDefined();
    expect(html.slice(div?.start ?? 0, div?.openingEnd ?? 0)).toBe('<DIV CLASS="a">');
    expect(html.slice(div?.start ?? 0, div?.end ?? 0)).toBe('<DIV CLASS="a">');
  });

  it('skips comments, doctype, processing instructions and closing tags', () => {
    const html = [
      '<!doctype html>',
      '<!-- <script type="rocketlazyloadscript" data-rocket-src="decoy.js"></script> -->',
      '<?xml dummy?>',
      '<img src="real.jpg">',
      '</p>',
      '<!-- another <!-- nested --> still comment -->',
      '<img src="second.jpg">'
    ].join('\n');
    const tags = scanTags(html);
    expect(tags.map((tag) => tag.name)).toEqual(['img', 'img']);
    expect(tags[0]?.attrs[0]).toEqual(expect.objectContaining({ name: 'src', value: 'real.jpg' }));
  });

  it('parses quoted values raw — entities are not decoded and `>` inside quotes is safe', () => {
    const html = `<img alt="a>b &#038; c" data-x='single > quoted' src=plain.jpg>`;
    const [tag] = scanTags(html);
    expect(tag?.attrs).toEqual([
      expect.objectContaining({ name: 'alt', value: 'a>b &#038; c', quote: '"' }),
      expect.objectContaining({ name: 'data-x', value: 'single > quoted', quote: "'" }),
      expect.objectContaining({ name: 'src', value: 'plain.jpg', quote: '' })
    ]);
  });

  it('records valueless attributes and empty quoted values distinctly', () => {
    const html = '<script defer data-empty="" data-rocket-defer></script>';
    const [tag] = scanTags(html);
    expect(tag?.attrs.map((attr) => [attr.name, attr.value])).toEqual([
      ['defer', null],
      ['data-empty', ''],
      ['data-rocket-defer', null]
    ]);
  });

  it('marks self-closing tags — but an unquoted value consumes the slash like the HTML tokenizer', () => {
    const [quoted, unquoted] = scanTags('<img data-x="1"/><img src=a.jpg/>');
    expect(quoted?.selfClosing).toBe(true);
    expect(unquoted?.attrs[0]).toEqual(expect.objectContaining({ name: 'src', value: 'a.jpg/' }));
    expect(unquoted?.selfClosing).toBe(false);
  });
});

describe('scanTags — raw-text regions', () => {
  it('extends a script region through its case-insensitive end tag', () => {
    const html = '<script>a</SCRIPT><script>b</script >';
    const tags = scanTags(html);
    expect(tags.length).toBe(2);
    expect(html.slice(tags[0]?.start ?? 0, tags[0]?.end ?? 0)).toBe('<script>a</SCRIPT>');
    expect(html.slice(tags[1]?.start ?? 0, tags[1]?.end ?? 0)).toBe('<script>b</script >');
  });

  it('treats `<script` inside script content as raw text, not a new tag', () => {
    const html =
      '<script type="rocketlazyloadscript">if (x) { document.write("<script></scr"+"ipt>"); }</script><img src="after.jpg">';
    const tags = scanTags(html);
    expect(tags.map((tag) => tag.name)).toEqual(['script', 'img']);
  });

  it('runs an unterminated script region to the end of input', () => {
    const html = '<p>before</p><script type="rocketlazyloadscript" data-rocket-src="x.js">';
    const tags = scanTags(html);
    const script = tags[1];
    expect(script?.name).toBe('script');
    expect(script?.end).toBe(html.length);
  });

  it('bounds style regions the same way (the lazy-render inline CSS removal needs them)', () => {
    const html =
      '<style id="rocket-lazyrender-inline-css">[data-wpr-lazyrender] {content-visibility: auto;}</style><p>x</p>';
    const [style] = scanTags(html);
    expect(style?.name).toBe('style');
    expect(html.slice(style?.start ?? 0, style?.end ?? 0)).toBe(
      '<style id="rocket-lazyrender-inline-css">[data-wpr-lazyrender] {content-visibility: auto;}</style>'
    );
  });
});

describe('scanTags — hostile inputs terminate cleanly', () => {
  it('survives an unclosed quoted attribute (the value consumes the rest of input)', () => {
    const html = '<p>ok</p><img alt="unclosed><p>swallowed</p>';
    expect(() => scanTags(html)).not.toThrow();
    const tags = scanTags(html);
    expect(tags.length).toBe(2);
    expect(tags[1]?.name).toBe('img');
  });

  it('survives attribute soup that never closes the tag', () => {
    const html = '<div ==x a=1 <b';
    expect(() => scanTags(html)).not.toThrow();
    const tags = scanTags(html);
    expect(tags.length).toBe(1);
    expect(tags[0]?.name).toBe('div');
  });

  it('consumes a stray slash that is not self-closing and keeps parsing attributes', () => {
    const html = '<img / src="a.jpg">';
    const [tag] = scanTags(html);
    expect(tag?.attrs.map((attr) => attr.name)).toEqual(['src']);
    expect(tag?.selfClosing).toBe(false);
  });

  it('ignores `<` that does not open a tag', () => {
    const html = '<p>1 < 2 and a < b</p>';
    const tags = scanTags(html);
    expect(tags.map((tag) => tag.name)).toEqual(['p']);
  });

  it('tolerates a malformed end tag carrying junk (`</script x>`) — the region closes at the next `>`', () => {
    const html = '<script>a</script x><img src="after.jpg">';
    const tags = scanTags(html);
    expect(tags.map((tag) => tag.name)).toEqual(['script', 'img']);
    expect(html.slice(tags[0]?.start ?? 0, tags[0]?.end ?? 0)).toBe('<script>a</script x>');
  });

  it('handles the empty string', () => {
    expect(scanTags('')).toEqual([]);
  });
});
