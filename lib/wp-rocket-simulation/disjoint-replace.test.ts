/**
 * The one-pass replace: equal to sequential `str_replace` calls when every
 * occurrence is disjoint, and `null` whenever it cannot tell.
 */
import { describe, expect, it } from 'vitest';
import { nextOccurrenceFinder } from '../../utils/next-occurrence';
import { replaceDisjoint, type KeyEnds } from './disjoint-replace';

/** Keys up to the first `>` (a tag's head). */
const toGt: KeyEnds = (text) => {
  const nextGt = nextOccurrenceFinder(text, '>');
  return (at) => {
    const gt = nextGt(at);
    return gt === -1 ? -1 : gt + 1;
  };
};

/**
 * PHP's `str_replace` once per search, in map order (the reference).
 *
 * @param subject The text.
 * @param replacements The searches and replacements.
 */
const sequential = (subject: string, replacements: ReadonlyMap<string, string>): string =>
  [...replacements].reduce((out, [search, by]) => out.split(search).join(by), subject);

describe('replaceDisjoint', () => {
  it('replaces every occurrence of every search, as sequential calls do', () => {
    const subject = '<a x>1<b>2<a x>3<a y>4<b>';
    const replacements = new Map([
      ['<a x>', '<A>'],
      ['<b>', '<B/>'],
      ['<a y>', '']
    ]);
    expect(replaceDisjoint(subject, replacements, toGt)).toBe('<A>1<B/>2<A>34<B/>');
    expect(replaceDisjoint(subject, replacements, toGt)).toBe(sequential(subject, replacements));
  });

  it('finds searches sharing a key by comparing each in place', () => {
    const replacements = new Map([
      ['<a>x', '1'],
      ['<a>y', '2']
    ]);
    expect(replaceDisjoint('<a>y<a>x<a>z', replacements, toGt)).toBe('21<a>z');
  });

  it('returns the subject for no searches, and with no occurrence', () => {
    expect(replaceDisjoint('<a>', new Map(), toGt)).toBe('<a>');
    expect(replaceDisjoint('<a>', new Map([['<b>', '']]), toGt)).toBe('<a>');
  });

  it('gives up when occurrences overlap (order would matter)', () => {
    // One search inside another.
    const nested = new Map([
      ['<a <b>', '1'],
      ['<b>', '2']
    ]);
    expect(replaceDisjoint('<a <b>', nested, toGt)).toBeNull();
    // Two searches at one position.
    const same = new Map([
      ['<a>', '1'],
      ['<a>b', '2']
    ]);
    expect(replaceDisjoint('<a>b', same, toGt)).toBeNull();
    // Overlapping occurrences of one search.
    expect(replaceDisjoint('<a>x<a>x<a>', new Map([['<a>x<a>', '1']]), toGt)).toBeNull();
  });

  it('gives up past its lookup budget instead of going quadratic', () => {
    // Many searches sharing one key: each `<a>` compares all of them.
    const searches = new Map(
      Array.from({ length: 2000 }, (_, index) => [`<a>${String(index)}|`, ''] as const)
    );
    expect(replaceDisjoint('<a>-'.repeat(2000), searches, toGt)).toBeNull();
  });

  it('throws for a search it cannot key', () => {
    expect(() => replaceDisjoint('x', new Map([['a>', '']]), toGt)).toThrow(/cannot key/);
    expect(() => replaceDisjoint('x', new Map([['<a', '']]), toGt)).toThrow(/cannot key/);
  });
});
