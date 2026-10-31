/**
 * The URLs WP Rocket's LazyLoad never runs on, as PHP reads `$_GET`.
 */
import { describe, expect, it } from 'vitest';
import { lazyloadUrlSkip, phpGetKey, phpGetKeys } from './lazyload-url-skip';

describe('phpGetKey / phpGetKeys', () => {
  it.each([
    ['s', 's'],
    ['  s', 's'],
    ['fl.builder', 'fl_builder'],
    ['fl builder', 'fl_builder'],
    ['s[]', 's'],
    ['s[a]b', 's'],
    ['fl[builder', 'fl_builder'],
    ['a.b[c.d', 'a_b_c.d'],
    ['[]', ''],
    ['', ''],
    ['s\0x', 's']
  ])('registers %j as %j', (name, key) => {
    expect(phpGetKey(name)).toBe(key);
  });

  it('decodes names as urldecode does (`+`, `%XX`), keeps a malformed `%`', () => {
    expect([...phpGetKeys('?%73=1&et%5Ffb&a+b=2&%zz=3&&=4')]).toEqual(['s', 'et_fb', 'a_b', '%zz']);
    expect([...phpGetKeys('')]).toEqual([]);
  });
});

describe('lazyloadUrlSkip', () => {
  it.each([
    ['https://e.org/?s=shoes', 'search'],
    ['https://e.org/?s=', 'search'],
    ['https://e.org/?s', 'search'],
    ['https://e.org/?s[]=x', 'search'],
    ['https://e.org/page/?fl_builder', 'page-builder-editor'],
    ['https://e.org/?et_fb=1&PageSpeed=off', 'page-builder-editor'],
    ['https://e.org/?ct.builder=true', 'page-builder-editor'],
    ['https://e.org/?S=x', null],
    ['https://e.org/?search=x', null],
    ['https://e.org/#s=x', null],
    ['https://e.org/', null],
    ['https://e.org/?preview=true', 'preview'],
    ['https://e.org/?p=12&preview=0', 'preview'],
    ['https://e.org/?preview[]=', 'preview'],
    ['https://e.org/?preview=&preview=x', 'preview'],
    ['https://e.org/?pre%76iew=1', 'preview'],
    ['https://e.org/?preview=1&s=x', 'preview'],
    ['https://e.org/?preview=', null],
    ['https://e.org/?preview', null],
    ['https://e.org/?preview=x&preview=', null],
    ['https://e.org/?Preview=1', null]
  ])('%s → %s', (url, skip) => {
    expect(lazyloadUrlSkip(url)).toBe(skip);
  });

  it('names search before a builder (WP Rocket checks search first; both skip)', () => {
    expect(lazyloadUrlSkip('https://e.org/?et_fb=1&s=x')).toBe('search');
  });
});
