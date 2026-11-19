/**
 * The shared style words: names (file name, its fallback, identity in mono,
 * ordinal) and media words (hidden for none and `all`).
 */
import { describe, expect, it } from 'vitest';
import { mediaDetail, NO_HREF_NAME, styleName, type NamedStyle } from './style-words';

const LINK: NamedStyle = {
  kind: 'link',
  id: 'a',
  className: 'b',
  href: 'https://s.test/x/theme.css?v=1'
};
const INLINE: NamedStyle = { kind: 'inline', id: '', className: '', href: '' };

describe('styleName', () => {
  it('names a link by its file name, never by its identity', () => {
    expect(styleName(LINK, 1)).toEqual({ name: 'theme.css', mono: false });
  });

  it('names a link without an address by the fallback', () => {
    expect(styleName({ ...LINK, href: '' }, 1)).toEqual({ name: NO_HREF_NAME, mono: false });
    expect(styleName({ ...LINK, href: '   ' }, 1)).toEqual({ name: NO_HREF_NAME, mono: false });
  });

  it('names an inline style by its identity, in mono', () => {
    expect(styleName({ ...INLINE, id: 'x', className: ' a  b ' }, 4)).toEqual({
      name: '#x.a.b',
      mono: true
    });
    expect(styleName({ ...INLINE, className: 'c' }, 4)).toEqual({ name: '.c', mono: true });
  });

  it('names an anonymous inline style by its ordinal', () => {
    expect(styleName(INLINE, 3)).toEqual({ name: 'Inline style #3', mono: false });
    expect(styleName({ ...INLINE, className: '   ' }, 1)).toEqual({
      name: 'Inline style #1',
      mono: false
    });
  });
});

describe('mediaDetail', () => {
  it('hides no media and the default all, in any case and padding', () => {
    expect(mediaDetail('')).toBeNull();
    expect(mediaDetail('   ')).toBeNull();
    expect(mediaDetail(' ALL ')).toBeNull();
    expect(mediaDetail('all')).toBeNull();
  });

  it('names any other media, trimmed', () => {
    expect(mediaDetail('print')).toBe('media: print');
    expect(mediaDetail(' (max-width: 600px) ')).toBe('media: (max-width: 600px)');
    expect(mediaDetail('all and (min-width: 1px)')).toBe('media: all and (min-width: 1px)');
  });
});
