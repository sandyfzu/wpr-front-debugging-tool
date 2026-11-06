/**
 * The page-style inventory over happy-dom: document order, both kinds,
 * every field clipped to its cap, the CSS preview, the count bound with an
 * honest total, and a page left untouched.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { PAGE_STYLE_LIMITS, parsePageStylesReply } from '../../../lib/messaging/page-styles';
import { collectPageStyles, cssPreview, describeStyle } from './style-inventory';

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('collectPageStyles', () => {
  it('lists the stripped selector’s elements in document order, untouched', () => {
    document.head.innerHTML = [
      '<link rel="stylesheet" id="theme-css" class="a  b" media="print" href="/theme.css">',
      '<link rel="preload" href="/font.woff2">',
      '<style id="inline">\n  .a {\n color: red; }\n</style>'
    ].join('');
    document.body.innerHTML =
      '<link rel="stylesheet" href="https://cdn.test/x.css"><style></style>';
    const before = document.documentElement.outerHTML;
    const reply = collectPageStyles(document);
    expect(document.documentElement.outerHTML).toBe(before);
    expect(reply.total).toBe(4);
    expect(reply.styles).toEqual([
      {
        kind: 'link',
        id: 'theme-css',
        className: 'a  b',
        href: new URL('/theme.css', location.href).href,
        media: 'print',
        preview: '',
        chars: 0
      },
      {
        kind: 'inline',
        id: 'inline',
        className: '',
        href: '',
        media: '',
        preview: '.a { color: red; }',
        chars: '\n  .a {\n color: red; }\n'.length
      },
      {
        kind: 'link',
        id: '',
        className: '',
        href: 'https://cdn.test/x.css',
        media: '',
        preview: '',
        chars: 0
      },
      { kind: 'inline', id: '', className: '', href: '', media: '', preview: '', chars: 0 }
    ]);
    // Exactly what the panel's guard accepts.
    expect(parsePageStylesReply(reply)).toEqual(reply);
  });

  it('lists at most the cap and still counts every style', () => {
    document.head.innerHTML = '<style></style>'.repeat(PAGE_STYLE_LIMITS.count + 2);
    const reply = collectPageStyles(document);
    expect(reply.styles).toHaveLength(PAGE_STYLE_LIMITS.count);
    expect(reply.total).toBe(PAGE_STYLE_LIMITS.count + 2);
    expect(parsePageStylesReply(reply)).not.toBeNull();
  });
});

describe('describeStyle', () => {
  it('clips every string to its cap so a hostile page cannot break the reply', () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.id = 'i'.repeat(PAGE_STYLE_LIMITS.idChars + 50);
    link.setAttribute('class', 'c'.repeat(PAGE_STYLE_LIMITS.classChars + 50));
    link.setAttribute('media', 'm'.repeat(PAGE_STYLE_LIMITS.mediaChars + 50));
    link.href = `https://a.test/${'p'.repeat(PAGE_STYLE_LIMITS.hrefChars)}`;
    const entry = describeStyle(link);
    expect(entry.id).toHaveLength(PAGE_STYLE_LIMITS.idChars);
    expect(entry.id.endsWith('…')).toBe(true);
    expect(entry.className).toHaveLength(PAGE_STYLE_LIMITS.classChars);
    expect(entry.media).toHaveLength(PAGE_STYLE_LIMITS.mediaChars);
    expect(entry.href).toHaveLength(PAGE_STYLE_LIMITS.hrefChars);
    expect(parsePageStylesReply({ styles: [entry], total: 1 })).not.toBeNull();
  });

  it('counts a large inline style whole but previews only its start', () => {
    const style = document.createElement('style');
    style.textContent = `.x{}${' '.repeat(10)}${'a'.repeat(5_000_000)}`;
    const entry = describeStyle(style);
    expect(entry.chars).toBe(5_000_014);
    expect(entry.preview).toHaveLength(PAGE_STYLE_LIMITS.previewChars);
    expect(entry.preview.startsWith('.x{} aaa')).toBe(true);
  });
});

describe('cssPreview', () => {
  it('collapses whitespace and trims', () => {
    expect(cssPreview('\n\t a {\n  b: c }  ')).toBe('a { b: c }');
    expect(cssPreview('')).toBe('');
  });
});
