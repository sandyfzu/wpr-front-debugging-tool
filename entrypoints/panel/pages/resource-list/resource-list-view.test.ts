import { describe, expect, it } from 'vitest';
import { capTitle, TITLE_MAX } from '../../../../utils/cap-text';
import {
  listCapped,
  MINIFY_STAMP_LABEL,
  urlClipped,
  urlPreview,
  normalizeQuery,
  resourceName
} from './resource-list-view';

describe('MINIFY_STAMP_LABEL', () => {
  it('names the minify stamp fact', () => {
    expect(MINIFY_STAMP_LABEL).toBe('Minify stamp');
  });
});

describe('normalizeQuery', () => {
  it.each([
    ['', ''],
    ['   ', ''],
    ['  hero.webp ', 'hero.webp'],
    ['a b', 'a b']
  ])('%j → %j', (raw, expected) => {
    expect(normalizeQuery(raw)).toBe(expected);
  });
});

describe('resourceName', () => {
  it.each([
    ['https://cdn.example/wp-content/uploads/hero.webp', 'hero.webp'],
    ['https://cdn.example/uploads/hero.webp?ver=1#x', 'hero.webp'],
    ['https://cdn.example/uploads/folder/', 'folder'],
    ['https://cdn.example/', 'cdn.example'],
    ['https://cdn.example:8443', 'cdn.example:8443'],
    ['/wp-content/uploads/relative.jpg', 'relative.jpg'],
    ['relative.jpg', 'relative.jpg'],
    ['//cdn.example/protocol-relative.png', 'protocol-relative.png'],
    ['//cdn.example', 'cdn.example'],
    ['/', '/'],
    ['https://site.test/wp-includes/js/jquery/jquery.min.js?ver=3.7.1', 'jquery.min.js'],
    ['https://site.test/wp-content/themes/t/style.css?ver=6.5#main', 'style.css'],
    ['https://site.test/a%20b%2Fc.css', 'a b/c.css'],
    ['data:text/css,/*a*/', 'data:text/css'],
    ['https://cdn.example/caf%C3%A9.jpg', 'café.jpg'],
    ['https://cdn.example/bad%E0%A4%A.jpg', 'bad%E0%A4%A.jpg'],
    ['data:image/svg+xml,%3Csvg%3E%3C/svg%3E', 'data:image/svg+xml'],
    ['DATA:image/png;base64,AAAA', 'data:image/png'],
    ['data:,hello', 'data:'],
    ['?only-a-query', '?only-a-query'],
    ['  https://cdn.example/spaced.png  ', 'spaced.png'],
    ['', ''],
    ['   ', '']
  ])('%j → %j', (url, expected) => {
    expect(resourceName(url)).toBe(expected);
  });

  it('keeps unparseable input as text', () => {
    expect(resourceName('http://[bad')).toBe('http://[bad');
  });

  it('names a non-web scheme by its scheme (no fake file name)', () => {
    expect(resourceName('javascript:alert(1)')).toBe('javascript: URL');
    expect(resourceName('mailto:a@b.example')).toBe('mailto: URL');
  });

  it('names a blob URL by its last segment', () => {
    expect(resourceName('blob:https://cdn.example/3f2a')).toBe('3f2a');
  });
});

describe('capTitle', () => {
  it('keeps short text and elides long text by code point', () => {
    expect(capTitle('a.jpg')).toBe('a.jpg');
    const long = '😀'.repeat(TITLE_MAX + 5);
    const capped = capTitle(long);
    expect(Array.from(capped)).toHaveLength(TITLE_MAX + 1);
    expect(capped.endsWith('…')).toBe(true);
    expect(capTitle('x'.repeat(TITLE_MAX))).toBe('x'.repeat(TITLE_MAX));
  });
});

describe('listCapped', () => {
  it('needs the mark AND a list at its cap (a clipped string alone sets the mark)', () => {
    expect(listCapped(true, 5000, 5000)).toBe(true);
    expect(listCapped(true, 4999, 5000)).toBe(false);
    expect(listCapped(undefined, 5000, 5000)).toBe(false);
  });
});

describe('urlClipped', () => {
  it('flags a marked URL at the cap or one unit short (surrogate-safe clip)', () => {
    expect(urlClipped(true, 'x'.repeat(4096), 4096)).toBe(true);
    expect(urlClipped(true, 'x'.repeat(4095), 4096)).toBe(true);
    expect(urlClipped(true, 'x'.repeat(4094), 4096)).toBe(false);
    expect(urlClipped(undefined, 'x'.repeat(4096), 4096)).toBe(false);
  });
});

describe('urlPreview', () => {
  it('drops the scheme of an http(s) URL and keeps host, path, query and fragment', () => {
    expect(urlPreview('https://cdn.test:8080/js/a.min.js?ver=1#x')).toBe(
      'cdn.test:8080/js/a.min.js?ver=1#x'
    );
  });

  it('keeps anything else as captured', () => {
    expect(urlPreview('/relative.js')).toBe('/relative.js');
    expect(urlPreview('data:text/javascript,1')).toBe('data:text/javascript,1');
    expect(urlPreview('')).toBe('');
  });
});
