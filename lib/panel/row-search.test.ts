/** The shared search rule: empty query skips, case-insensitive substring, no trimming of its own. */
import { describe, expect, it, vi } from 'vitest';
import { searchPredicate } from './row-search';

describe('searchPredicate', () => {
  it('is null for an empty query (no search phase, the field is never read)', () => {
    const field = vi.fn((row: string) => row);
    expect(searchPredicate(field, '')).toBeNull();
    expect(field).not.toHaveBeenCalled();
  });

  it('matches a case-insensitive substring of the field', () => {
    const matches = searchPredicate((row: string) => row, 'CdN');
    expect(matches?.('https://cdn.test/a.js')).toBe(true);
    expect(matches?.('https://CDN.test/a.js')).toBe(true);
    expect(matches?.('https://site.test/a.js')).toBe(false);
    expect(matches?.('')).toBe(false);
  });

  it('keeps the query as given: whitespace is part of it (callers normalize first)', () => {
    const matches = searchPredicate((row: string) => row, ' a');
    expect(matches?.('a')).toBe(false);
    expect(matches?.('b a')).toBe(true);
    // A whitespace-only query is still a query (only '' skips).
    expect(searchPredicate((row: string) => row, ' ')?.('ab')).toBe(false);
  });

  it('reads the field once per row', () => {
    const field = vi.fn((row: { text: string }) => row.text);
    const matches = searchPredicate(field, 'x');
    matches?.({ text: 'x' });
    matches?.({ text: 'y' });
    expect(field).toHaveBeenCalledTimes(2);
  });
});
