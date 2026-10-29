/**
 * Defer JS's exclusion patterns at PCRE's compiled-size cap: the inline
 * pattern's size (2 units per literal byte, 3 per `|`) read exactly
 * either side of the measured limit — past it WP Rocket excludes no
 * inline script — and refused within the band; the file pattern's join
 * (a long list, or stored rows on top of it) refused when its size is not
 * claimed. Sizes and verdicts measured with the real plugin (PHP 8.1.34,
 * PCRE2 10.49, both supported versions).
 */
import { describe, expect, it } from 'vitest';
import { INLINE_WRAP_OPEN } from '../wp-rocket/constants';
import {
  deferUrlMatcher,
  INLINE_PATTERN_UNITS_BAND,
  INLINE_PATTERN_UNITS_LIMIT,
  inlineExclusions,
  inlinePatternUnits,
  simulateDeferJs
} from './defer-js-forward';
import { validateDeferLists } from './latest-list';

/** `count` distinct rows of `length` characters. */
function rows(count: number, length: number, prefix = 'r'): string[] {
  return Array.from({ length: count }, (_, index) =>
    `${prefix}${String(index).padStart(5, '0')}${'x'.repeat(length)}`.slice(0, length)
  );
}

/** Two rows whose pattern measures exactly `units` (odd: the `|` adds 3). */
function sized(units: number, unit = 'x'): string[] {
  if (units % 2 === 0) throw new Error(`two rows measure an odd count, not ${String(units)}`);
  const unitBytes = new TextEncoder().encode(unit).length;
  const fillBytes = (units - 3 - 2 * 5) / 2;
  const repeats = Math.floor(fillBytes / unitBytes);
  return ['needl', unit.repeat(repeats) + 'y'.repeat(fillBytes - repeats * unitBytes)];
}

/** A page with an inline jQuery script naming `needle`, and another one. */
function page(needle: string): string {
  return `<html><head></head><body><script>jQuery(function(){ var a = "${needle}"; });</script><script>jQuery(2)</script></body></html>`;
}

/** Defer JS on `html` with these inline rows. */
function simulate(html: string, inline: readonly string[], delimiter: '/' | '#' = '/') {
  return simulateDeferJs({
    html,
    rows: [],
    lists: { external: ['zzz-none'], inline },
    inlineQuoteDelimiter: delimiter
  });
}

describe('inlinePatternUnits', () => {
  it('counts 2 per literal byte (UTF-8, quoting escapes none) and 3 per `|`', () => {
    expect(inlinePatternUnits([])).toBe(0);
    expect(inlinePatternUnits(['a'])).toBe(2);
    expect(inlinePatternUnits(['a', 'bc'])).toBe(2 * 3 + 3);
    expect(inlinePatternUnits(['é', '.', '\\', '', '#'])).toBe(2 * 5 + 3 * 4);
    for (const unit of ['x', '.', 'é', '\\', '#']) {
      expect(inlinePatternUnits(sized(65_521, unit))).toBe(65_521);
    }
  });
});

describe('the inline pattern at the compiled-size cap', () => {
  // `sized` builds odd unit counts: the band's edges, and the first odd count past it.
  const certainlyCompiles = INLINE_PATTERN_UNITS_LIMIT - INLINE_PATTERN_UNITS_BAND;
  const certainlyFails = INLINE_PATTERN_UNITS_LIMIT + INLINE_PATTERN_UNITS_BAND + 2;

  it.each(['x', '.', 'é', '\\', '#'])(
    'reads each side exactly, the band refused (rows of %s)',
    (unit) => {
      for (const delimiter of ['/', '#'] as const) {
        // Compiles: the needle's script is excluded, the other wrapped.
        expect(inlineExclusions(sized(certainlyCompiles, unit), delimiter).kind).toBe('rows');
        expect(simulate(page('needl'), sized(certainlyCompiles, unit), delimiter).report).toEqual({
          state: 'simulated',
          deferred: 0,
          wrapped: 1
        });
        // Too large: `preg_match` fails, no script is excluded.
        expect(inlineExclusions(sized(certainlyFails, unit), delimiter).kind).toBe('none');
        const failed = simulate(page('needl'), sized(certainlyFails, unit), delimiter);
        expect(failed.report).toEqual({ state: 'simulated', deferred: 0, wrapped: 2 });
        expect(failed.html.split(INLINE_WRAP_OPEN)).toHaveLength(3);
        for (const units of [INLINE_PATTERN_UNITS_LIMIT, INLINE_PATTERN_UNITS_LIMIT + 2]) {
          expect(simulate(page('needl'), sized(units, unit), delimiter).report).toMatchObject({
            state: 'not-applicable',
            reason: 'beyond-exact-reproduction',
            unreproducedRegex: 'defer-inline-exclusions'
          });
        }
      }
    }
  );

  it.each([
    [1000, 30, 1],
    [2000, 30, 2],
    [2000, 60, 2],
    [1500, 200, 2]
  ])('%i rows of %i bytes wrap as WP Rocket does (%i scripts)', (count, length, wrapped) => {
    const list = rows(count, length);
    expect(simulate(page(list[1] ?? ''), list).report).toEqual({
      state: 'simulated',
      deferred: 0,
      wrapped
    });
  });

  it('never refuses a page whose pattern is never evaluated (no inline script to test)', () => {
    const html = '<html><head></head><body><script src="/a.js"></script></body></html>';
    expect(simulate(html, sized(INLINE_PATTERN_UNITS_LIMIT)).report.state).toBe('simulated');
  });

  it('decides `empty()` before the size, and the size before an empty alternative', () => {
    expect(inlineExclusions(['', ''], '/').kind).toBe('every');
    expect(inlineExclusions(['', ...sized(certainlyFails)], '/').kind).toBe('none');
  });
});

describe('the file pattern’s join at the compiled-size cap', () => {
  it('claims a long list’s pre-check only when its size is claimed', () => {
    const input = (external: string[]) => ({
      rows: [],
      lists: { external, inline: [] },
      inlineQuoteDelimiter: '/' as const
    });
    expect(deferUrlMatcher(input(rows(100, 30)))).not.toBeNull();
    // 2 000 × 30 fails WP Rocket's pre-check (measured): never claimed either way.
    expect(() => deferUrlMatcher(input(rows(2000, 30)))).toThrow(/cannot be replayed/);
    // Stored rows grow the join the same way.
    expect(() => deferUrlMatcher({ ...input(['jquery-x']), rows: rows(2000, 30, 's') })).toThrow(
      /cannot be replayed/
    );
  });

  it('refuses a latest list whose patterns cannot be told, keeps one that can', () => {
    expect(validateDeferLists(rows(100, 30), ['a']).ok).toBe(true);
    expect(validateDeferLists(rows(2000, 30), ['a'])).toMatchObject({ ok: false, miss: 'invalid' });
    expect(validateDeferLists(['a.js'], sized(INLINE_PATTERN_UNITS_LIMIT))).toMatchObject({
      ok: false,
      miss: 'invalid'
    });
    // Known too large: WP Rocket excludes no inline script — reproduced.
    expect(validateDeferLists(['a.js'], rows(2000, 60)).ok).toBe(true);
  });
});
