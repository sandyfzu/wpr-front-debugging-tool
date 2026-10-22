/**
 * WP Rocket's settings save of exclusion rows, per feature: the stored rows
 * and the per-row diff. Stored forms and drop reasons are the real save's
 * (WP Rocket 3.23.5.1 + WordPress 7.1.3, as in the parity table); the whole
 * save tables replay in `wp-rocket-parity.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  cleanWildcards,
  committedFieldRows,
  exclusionFieldText,
  hasInvisibleKeptCharacters,
  SAFE_MODE_DELAY_ROWS,
  saveExclusionRows,
  splitFieldText,
  storedExclusionRows,
  storedRowKey,
  trimExclusionRow
} from './field-text';

describe('cleanWildcards', () => {
  it.each([
    ['\\d*x', '\\d(.*)x'],
    ['*', '(.*)'],
    ['(*)', '(.*)'],
    ['.*', '(.*)'],
    ['(.*)', '(.*)'],
    ['((.*)', '((.*)'],
    ['..*', '.(.*)'],
    ['**', '(.*)(.*)'],
    ['\\*', '\\(.*)'],
    ['[*]', '[(.*)]'],
    ['(.*?)', '((.*)?)'],
    ['a/*/b', 'a/(.*)/b'],
    ['a.+b', 'a.+b'],
    ['0', ''],
    ['', '']
  ])('%j → %j', (row, expected) => {
    expect(cleanWildcards(row)).toBe(expected);
  });
});

describe('saveExclusionRows: the per-row diff', () => {
  it('says unchanged, stored-as, or dropped with the reason, one diff per typed row', () => {
    expect(saveExclusionRows('defer_all_js', ['a.js', ' b.js ', 'x%41y', '', '0', 'a.js'])).toEqual(
      {
        rows: ['a.js', 'b.js', 'xy'],
        diffs: [
          { state: 'unchanged', index: 0 },
          { state: 'stored-as', text: 'b.js', index: 1 },
          { state: 'stored-as', text: 'xy', index: 2 },
          { state: 'dropped', reason: 'empty' },
          { state: 'dropped', reason: 'zero' },
          { state: 'dropped', reason: 'duplicate' }
        ]
      }
    );
  });

  it('drops rows emptied or zeroed by the sanitizer', () => {
    const saved = saveExclusionRows('lazyload', ['<b></b>', '<b>0</b>', '%E2%80%8B', ' 0 ']);
    expect(saved.rows).toEqual([]);
    expect(saved.diffs.map((diff) => diff.state === 'dropped' && diff.reason)).toEqual([
      'empty',
      'zero',
      'empty',
      'zero'
    ]);
  });

  it('dedupes on the stored form, keeping the first occurrence (case-sensitive)', () => {
    expect(storedExclusionRows('lazyload', ['a b', 'a  b', 'a\tb', 'A b'])).toEqual(['a b', 'A b']);
  });

  it('rewrites Delay JS wildcards before deduping; other fields keep them', () => {
    expect(storedExclusionRows('delay_js', ['.*', '*', '(*)', '(.*)'])).toEqual(['(.*)']);
    expect(storedExclusionRows('lazyload', ['.*', '*'])).toEqual(['.*', '*']);
  });

  it('drops a Delay/Defer row PCRE rejects, naming the construct; Lazyload stores it', () => {
    const delay = saveExclusionRows('delay_js', ['(', 'ok']);
    expect(delay.rows).toEqual(['ok']);
    expect(delay.diffs[0]).toMatchObject({ state: 'dropped', reason: 'invalid-pattern' });
    expect(delay.diffs[0]).toHaveProperty('construct');
    // A Delay `\*` becomes `\(.*)`, which PCRE rejects; Defer keeps `\*`.
    expect(saveExclusionRows('delay_js', ['\\*']).diffs[0]).toMatchObject({
      state: 'dropped',
      reason: 'invalid-pattern'
    });
    expect(storedExclusionRows('defer_all_js', ['\\*'])).toEqual(['\\*']);
    expect(storedExclusionRows('lazyload', ['('])).toEqual(['(']);
  });

  it('keeps a row whose pattern check is not modeled, as unverified', () => {
    const saved = saveExclusionRows('delay_js', ['(?+1)(x)', 'a\\\0b']);
    expect(saved.rows).toEqual(['(?+1)(x)', 'a\\\0b']);
    expect(saved.diffs[0]).toMatchObject({ state: 'unverified', text: '(?+1)(x)', index: 0 });
    expect(saved.diffs[1]).toMatchObject({ state: 'unverified', construct: '\\0', index: 1 });
  });

  it('flags the safe-mode patterns when safe mode is unknown, drops them when on', () => {
    const typed = [...SAFE_MODE_DELAY_ROWS, 'other'];
    const unknown = saveExclusionRows('delay_js', typed);
    expect(unknown.rows).toEqual(typed);
    expect(unknown.diffs.slice(0, 3)).toEqual([
      { state: 'unchanged', index: 0, dropsInSafeMode: true },
      { state: 'unchanged', index: 1, dropsInSafeMode: true },
      { state: 'unchanged', index: 2, dropsInSafeMode: true }
    ]);
    expect(unknown.diffs[3]).toEqual({ state: 'unchanged', index: 3 });
    const on = saveExclusionRows('delay_js', typed, { safeMode: true });
    expect(on.rows).toEqual(['other']);
    expect(on.diffs.slice(0, 3).map((diff) => diff.state === 'dropped' && diff.reason)).toEqual([
      'safe-mode',
      'safe-mode',
      'safe-mode'
    ]);
    expect(saveExclusionRows('delay_js', typed, { safeMode: false }).diffs[0]).toEqual({
      state: 'unchanged',
      index: 0
    });
    // Only Delay JS has safe mode.
    expect(saveExclusionRows('defer_all_js', typed).diffs[1]).toEqual({
      state: 'unchanged',
      index: 1
    });
  });

  it('drops a non-UTF-8 line as empty and reads valid bytes as text', () => {
    const saved = saveExclusionRows('defer_all_js', [
      Uint8Array.of(0xc0, 0xaf),
      new TextEncoder().encode(' é ')
    ]);
    expect(saved.rows).toEqual(['é']);
    expect(saved.diffs).toEqual([
      { state: 'dropped', reason: 'empty' },
      { state: 'stored-as', text: 'é', index: 0 }
    ]);
  });

  it('takes Automatic Lazy Rendering rows as written: no trim, no dedupe, no drop', () => {
    expect(saveExclusionRows('automatic_lazy_rendering', [' a ', 'a', 'a', '', '0'])).toEqual({
      rows: [' a ', 'a', 'a', '', '0'],
      diffs: [0, 1, 2, 3, 4].map((index) => ({ state: 'unchanged', index }))
    });
  });
});

describe('storedRowKey', () => {
  it('is the stored form before dedupe and the pattern check, null when emptied', () => {
    expect(storedRowKey('delay_js', ' x%41y* ')).toBe('xy(.*)');
    expect(storedRowKey('delay_js', '\\*')).toBe('\\(.*)');
    expect(storedRowKey('defer_all_js', '<b></b>')).toBeNull();
    expect(storedRowKey('lazyload', '0')).toBeNull();
    expect(storedRowKey('automatic_lazy_rendering', ' x ')).toBe(' x ');
  });
});

describe('exclusionFieldText', () => {
  it('joins stored rows with LF and no trailing newline', () => {
    expect(exclusionFieldText(storedExclusionRows('delay_js', [' gtag ', '', 'a*\r']))).toBe(
      'gtag\na(.*)'
    );
    expect(exclusionFieldText([])).toBe('');
  });

  it('saves back to the same rows', () => {
    const stored = storedExclusionRows('delay_js', ['a<b', 'x%41', 'q*', 'q*']);
    expect(storedExclusionRows('delay_js', splitFieldText(exclusionFieldText(stored)))).toEqual(
      stored
    );
  });
});

describe('trimExclusionRow', () => {
  it('strips leading and trailing spaces, tabs and line breaks', () => {
    expect(trimExclusionRow('  gtag  ')).toBe('gtag');
    expect(trimExclusionRow('\t/js/main.js\r\n')).toBe('/js/main.js');
    expect(trimExclusionRow('\n\r\t \u000b\u0000a\u0000\u000b \t\r\n')).toBe('a');
  });

  it('keeps inner whitespace untouched', () => {
    expect(trimExclusionRow('  <section class="footer">  ')).toBe('<section class="footer">');
    expect(trimExclusionRow('a \t b')).toBe('a \t b');
  });

  it('keeps every other Unicode space, as the save does', () => {
    expect(trimExclusionRow(' x ')).toBe(' x ');
    expect(trimExclusionRow(' x﻿')).toBe(' x﻿');
    expect(trimExclusionRow('   ')).toBe(' ');
  });

  it('returns an already trimmed row as is, and empty for whitespace only', () => {
    expect(trimExclusionRow('gtag')).toBe('gtag');
    expect(trimExclusionRow('')).toBe('');
    expect(trimExclusionRow(' \t\r\n ')).toBe('');
  });
});

describe('committedFieldRows', () => {
  it('trims every row and drops the blank ones, keeping order and duplicates', () => {
    expect(committedFieldRows([' b ', '', '\t', 'a', '  c', 'a'])).toEqual(['b', 'a', 'c', 'a']);
  });

  it('keeps typed text the save would rewrite (it is not the stored form)', () => {
    expect(committedFieldRows(['x%41y', '<b>a</b>', '*'])).toEqual(['x%41y', '<b>a</b>', '*']);
  });

  it('is empty for no rows or blank rows only', () => {
    expect(committedFieldRows([])).toEqual([]);
    expect(committedFieldRows(['', '   '])).toEqual([]);
  });
});

describe('hasInvisibleKeptCharacters', () => {
  it('flags rows of kept-but-invisible spaces only, and kept spaces around text', () => {
    expect(hasInvisibleKeptCharacters('\u00a0')).toBe(true);
    expect(hasInvisibleKeptCharacters(' \u00a0\u2028 ')).toBe(true);
    expect(hasInvisibleKeptCharacters('\u00a0gtag')).toBe(true);
    expect(hasInvisibleKeptCharacters('gtag\u3000')).toBe(true);
  });

  it('flags zero-width characters anywhere', () => {
    for (const mark of ['\u200b', '\u200d', '\u2060', '\ufeff', '\u0085', '\u00ad']) {
      expect(hasInvisibleKeptCharacters(`gt${mark}ag`)).toBe(true);
    }
  });

  it('flags inner no-break and other Unicode spaces (they never match a typed space)', () => {
    expect(hasInvisibleKeptCharacters('a\u00a0b')).toBe(true);
    expect(hasInvisibleKeptCharacters('a\u202fb')).toBe(true);
  });

  it('leaves blank rows and rows of visible text and ASCII spaces alone', () => {
    expect(hasInvisibleKeptCharacters('  \t')).toBe(false);
    expect(hasInvisibleKeptCharacters(' gtag ')).toBe(false);
    expect(hasInvisibleKeptCharacters('a b')).toBe(false);
    expect(hasInvisibleKeptCharacters('')).toBe(false);
  });
});

describe('splitFieldText', () => {
  it('breaks lines on LF, CRLF and a lone CR, as a textarea normalizes them', () => {
    expect(splitFieldText('a\rb\r\nc\nd')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps empty and untrimmed lines (trimming is the save step)', () => {
    expect(splitFieldText(' a \n\n')).toEqual([' a ', '', '']);
    expect(splitFieldText('')).toEqual(['']);
  });
});
