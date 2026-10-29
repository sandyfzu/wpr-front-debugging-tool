/**
 * The string tag scanner: tokenizes opening tags (with quoted-value-aware
 * attribute spans) straight off the served HTML — no DOMParser, no entity
 * decoding, comments and declarations skipped, raw-text element regions
 * (`script`/`style`) bounded by their end tags. Hostile inputs (unclosed
 * quotes, `<` in text, malformed attribute soup) must terminate cleanly.
 */
import { describe, expect, it } from 'vitest';
import { isEndTag, scanTags, scanTokens } from './html-scan';

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

  it('does not close a raw-text region on a longer tag name (`</scripty>` is element text)', () => {
    const html = '<script>a</scripty><img src="swallowed.jpg">';
    const tags = scanTags(html);
    expect(tags.map((tag) => tag.name)).toEqual(['script']);
    expect(tags[0]?.end).toBe(html.length);
  });

  it('does not close a style region on a longer tag name either', () => {
    const html = '<style>a</stylename><b>swallowed</b>';
    expect(scanTags(html).map((tag) => tag.name)).toEqual(['style']);
  });

  it('closes on the exact name even when a longer name appears first', () => {
    const html = '<script>a</scripty>b</script><img src="after.jpg">';
    expect(scanTags(html).map((tag) => tag.name)).toEqual(['script', 'img']);
  });

  it('bounds textarea and title regions the same way (their content is raw text, not markup)', () => {
    const html =
      '<textarea><img src="in-textarea.jpg"></textarea><title><b>not a tag</b></title><img src="after.jpg">';
    const tags = scanTags(html);
    expect(tags.map((tag) => tag.name)).toEqual(['textarea', 'title', 'img']);
    expect(tags[2]?.attrs[0]).toEqual(expect.objectContaining({ value: 'after.jpg' }));
  });

  it('closes a comment on `--!>` — content after it is markup again', () => {
    const html = '<!-- c --!><img src="after-bang.jpg">';
    const [tag] = scanTags(html);
    expect(tag?.name).toBe('img');
    expect(tag?.attrs[0]).toEqual(expect.objectContaining({ value: 'after-bang.jpg' }));
  });

  it('closes each comment on its own nearest closer, `-->` and `--!>` interleaved', () => {
    const html =
      '<!-- a --!><i id="1"><!-- b --><i id="2"><!-- c --><!-- d --!><i id="3"><!-- e --!> -->' +
      '<i id="4"><!-- f';
    expect(scanTags(html).map((tag) => tag.attrs[0]?.value)).toEqual(['1', '2', '3', '4']);
  });

  it('scans a comment-heavy 4 MiB page in linear time (no closer re-search per comment)', () => {
    let html = '<html><head></head><body>';
    for (let index = 0; html.length < 4 * 1024 * 1024; index++) {
      html += `<!-- c${String(index)} --><p>t</p><script>var a=1;</script>\n`;
    }
    const started = performance.now();
    const tags = scanTags(`${html}</body></html>`);
    const elapsed = performance.now() - started;
    expect(tags.length).toBeGreaterThan(100_000);
    // Measured ~0.1 s; re-searching the absent `--!>` per comment took seconds.
    expect(elapsed).toBeLessThan(1_000);
  });

  it('closes the empty-comment spellings `<!-->` and `<!--->` immediately', () => {
    for (const [closer, source] of [
      ['<!-->', '<!--><img src="after-empty.jpg">'],
      ['<!--->', '<!---><img src="after-dash.jpg">']
    ] as const) {
      const [tag] = scanTags(source);
      expect(tag?.name).toBe('img');
      expect(source.startsWith(closer)).toBe(true);
    }
  });

  it('runs an unclosed comment to the end of input', () => {
    const html = '<!-- <img src="swallowed.jpg"> never closes';
    expect(scanTags(html)).toEqual([]);
  });

  it('treats CDATA as a bogus comment ending at the first `>` (HTML is not XML)', () => {
    const html = '<![CDATA[<img src="in-cdata.jpg">]]><img src="after.jpg">';
    const tags = scanTags(html);
    expect(tags.map((tag) => tag.name)).toEqual(['img']);
    expect(tags[0]?.attrs[0]).toEqual(expect.objectContaining({ value: 'after.jpg' }));
  });

  it('reports duplicate attributes in document order, unmerged', () => {
    const html = '<img src="a.jpg" src="b.jpg" data-x="1" data-x="2">';
    const [tag] = scanTags(html);
    expect(tag?.attrs.map((attr) => attr.value)).toEqual(['a.jpg', 'b.jpg', '1', '2']);
  });

  it('handles the empty string', () => {
    expect(scanTags('')).toEqual([]);
  });
});

describe('scanTokens — opening and closing tags in document order', () => {
  /** Each token as `<name` or `</name` for a compact comparison. */
  const shapes = (html: string): string[] =>
    scanTokens(html).map((token) => (isEndTag(token) ? `</${token.name}` : `<${token.name}`));

  it('adds closing tags (lowercased, spans through their `>`) to the opening ones', () => {
    const html = '<div id="a"><P>x</P ></DIV junk>';
    expect(shapes(html)).toEqual(['<div', '<p', '</p', '</div']);
    const close = scanTokens(html).at(-1);
    expect(close !== undefined && isEndTag(close)).toBe(true);
    expect(html.slice(close?.start ?? 0, close && isEndTag(close) ? close.end : 0)).toBe(
      '</DIV junk>'
    );
  });

  it('skips comments, bogus end tags, and raw-text end tags (they stay inside their region)', () => {
    expect(shapes('<!-- </div> --></ div></1><script>"</p>"</script></span')).toEqual([
      '<script',
      '</span'
    ]);
  });

  it('yields exactly the scanTags opening tags', () => {
    const html = '<html><body><div a="1"><img src=x></div><br/></body></html>';
    expect(scanTokens(html).filter((token) => !isEndTag(token))).toEqual(scanTags(html));
    expect(scanTokens('')).toEqual([]);
  });
});

describe('scanTokens — the browser raw-text model', () => {
  /** Token names of a scan, end tags prefixed with `/`. */
  const names = (html: string, model: 'engine' | 'browser'): string[] =>
    scanTokens(html, model).map((token) => (isEndTag(token) ? `/${token.name}` : token.name));

  it('reads every browser raw-text element as text up to its own end tag', () => {
    for (const tag of ['xmp', 'iframe', 'noembed', 'noframes', 'noscript']) {
      const html = `<${tag}><b></head></${tag}><i>`;
      expect(names(html, 'browser'), tag).toEqual([tag, 'i']);
      const region = scanTokens(html, 'browser')[0];
      expect(region && !isEndTag(region) && html.slice(region.openingEnd, region.contentEnd)).toBe(
        '<b></head>'
      );
      // The engine model keeps reading them as markup (its transforms are pinned to it).
      expect(names(html, 'engine'), tag).toEqual([tag, 'b', '/head', `/${tag}`, 'i']);
    }
  });

  it('runs <plaintext> to the end of input: no end tag closes it', () => {
    const html = '<plaintext><b></plaintext><i>';
    const tokens = scanTokens(html, 'browser');
    expect(tokens).toHaveLength(1);
    const only = tokens[0];
    expect(only && !isEndTag(only) && only.end).toBe(html.length);
  });

  it('keeps the engine model as the default, for scanTags too', () => {
    const html = '<iframe><img src="a"></iframe>';
    expect(scanTokens(html)).toEqual(scanTokens(html, 'engine'));
    expect(scanTags(html).map((tag) => tag.name)).toEqual(['iframe', 'img']);
  });
});
