/**
 * The sequential `str_replace` replay: PHP's semantics (non-overlapping,
 * left to right, one call per search, in order) and its work bound.
 */
import { describe, expect, it } from 'vitest';
import {
  REPLACEMENT_WORK_LIMIT,
  ReplacementWorkExceeded,
  countReplacementWork,
  replaceInOrder,
  strReplaceCounted
} from './str-replace-sequence';

describe('strReplaceCounted', () => {
  it('replaces non-overlapping occurrences left to right and counts the subject', () => {
    const work = { units: 0 };
    expect(strReplaceCounted(work, 'aaaa', 'aa', 'b')).toBe('bb');
    expect(strReplaceCounted(work, 'xyz', '', 'q')).toBe('xyz');
    expect(work.units).toBe(7);
  });

  it('throws past the bound', () => {
    const work = { units: REPLACEMENT_WORK_LIMIT };
    expect(() => strReplaceCounted(work, 'a', 'a', 'b')).toThrow(ReplacementWorkExceeded);
    expect(() => {
      countReplacementWork({ units: REPLACEMENT_WORK_LIMIT }, 1);
    }).toThrow(ReplacementWorkExceeded);
  });

  it("honors a transform's own limit", () => {
    const work = { units: 0, limit: 10 };
    countReplacementWork(work, 10);
    expect(() => strReplaceCounted(work, 'a', 'a', 'b')).toThrow(ReplacementWorkExceeded);
    const wide = { units: REPLACEMENT_WORK_LIMIT, limit: REPLACEMENT_WORK_LIMIT * 2 };
    expect(strReplaceCounted(wide, 'a', 'a', 'b')).toBe('b');
  });
});

describe('replaceInOrder', () => {
  const keyEnds = (text: string) => (at: number) => {
    const gt = text.indexOf('>', at);
    return gt === -1 ? -1 : gt + 1;
  };

  it('replays call by call when a replacement creates an occurrence', () => {
    const replacements = new Map([
      ['<a>', '<b>'],
      ['<b>', '<c>']
    ]);
    expect(
      replaceInOrder('<a><b>', ['<a>', '<b>'], replacements, false, keyEnds, { units: 0 })
    ).toBe('<c><c>');
  });

  it('replaces in one pass when the caller proved it exact', () => {
    const replacements = new Map([['<a>', '<x>']]);
    const work = { units: 0 };
    expect(replaceInOrder('<a>-<a>', ['<a>'], replacements, true, keyEnds, work)).toBe('<x>-<x>');
    expect(work.units).toBe(0);
  });
});
