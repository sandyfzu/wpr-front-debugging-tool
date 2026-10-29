/**
 * The Delay JS regex's matches and step model. Every expected step count
 * below was measured on the real PCRE JIT (PHP 8.1.34 + PCRE2 10.49,
 * `php -n -d pcre.jit=1`: the smallest `pcre.backtrack_limit` the subject
 * passes at, by bisection); the model also matched 12 000 random subjects
 * exactly when it was derived.
 */
import { describe, expect, it } from 'vitest';
import { LINEAR_SCALING_TIMEOUT_MS, linearScaling } from '../../vitest.shared';
import {
  PCRE_BACKTRACK_LIMIT,
  contentSteps,
  delayScriptMatches,
  delaySearchSteps,
  endTagReach,
  failedAttemptSteps,
  failingTailSteps,
  failsAtOnce,
  surelyWithinLimit
} from './delay-js-regex';
import type { ByteMeasure } from './utf8';

const A20 = 'a'.repeat(20);

/** [subject, measured steps of one search from offset 0]. */
const MEASURED: readonly (readonly [string, number])[] = [
  ['<script></script>', 9],
  ['<script>a</script>', 11],
  ['< script ></ script >', 9],
  ['<SCRIPT>é€😀</SCRIPT>', 27],
  ['<script  id="x">var s="</scr"+"ipt>";</script>', 65],
  ['<script>< / script x</script>', 36],
  ['<script></scriptx</script>', 30],
  [`<script>${A20}`, 91],
  [`<script>${A20}</`, 103],
  [`<script >${A20}`, 96],
  [`<script   >${A20}`, 198],
  [`<script  b>${A20}`, 152],
  [`<scriptx>${A20}`, 50],
  [`<script><${A20}`, 99],
  [`<script  ></script${A20}`, 212],
  ['<script>', 1],
  [`<p><script>${A20}`, 91],
  [`<script>${A20}<script     >${A20}`, 308],
  [`<script ${A20}`, 1]
];

describe('delaySearchSteps', () => {
  it.each(MEASURED)('%j takes %i steps', (subject, steps) => {
    expect(delaySearchSteps(subject)).toBe(steps);
  });

  it('counts from the given offset only', () => {
    expect(delaySearchSteps(`<script>${A20}</script><script></script>`, 30)).toBe(9);
  });

  it('is 1 with no opening at all', () => {
    expect(delaySearchSteps('<p>no scripts</p>')).toBe(1);
  });
});

describe('endTagReach', () => {
  it.each([
    ['a', 0],
    ['<a', 1],
    ['< \n/', 2],
    ['</', 2],
    ['< / x', 2],
    ['</SCRIP', 2],
    ['</ScRiPt', 3],
    ['</script x', 3]
  ] as const)('%j reaches %i', (text, reach) => {
    expect(endTagReach(text, 0)).toBe(reach);
  });
});

describe('contentSteps', () => {
  it('charges 2 per UTF-8 byte plus each position’s reach', () => {
    expect(contentSteps('ab', 0, 2)).toBe(4);
    expect(contentSteps('é', 0, 1)).toBe(4);
    expect(contentSteps('😀', 0, 2)).toBe(8);
    expect(contentSteps('</x', 0, 3)).toBe(8);
  });

  it('counts a lone surrogate as U+FFFD’s three bytes', () => {
    expect(contentSteps('\ud800', 0, 1)).toBe(6);
  });
});

describe('failsAtOnce / failedAttemptSteps', () => {
  it('ends at once with no `>` or under 17 bytes left', () => {
    expect(failsAtOnce('<script x', { start: 0, attrStart: 7, gt: -1 })).toBe(true);
    expect(failsAtOnce('<script>aaaaaaaa', { start: 0, attrStart: 7, gt: 7 })).toBe(true);
    expect(failsAtOnce('<script>aaaaaaaaa', { start: 0, attrStart: 7, gt: 7 })).toBe(false);
    // Bytes, not units: 9 units, 17 bytes.
    expect(failsAtOnce('<script>éééééééé€', { start: 0, attrStart: 7, gt: 7 })).toBe(false);
    expect(failedAttemptSteps('<script x', { start: 0, attrStart: 7, gt: -1 }, 0)).toBe(1);
  });

  it('matches the measured shapes', () => {
    const text = `<script  b>${A20}`;
    const opening = { start: 0, attrStart: 7, gt: 10 };
    expect(failedAttemptSteps(text, opening, contentSteps(text, 11, text.length))).toBe(152);
  });
});

describe('surelyWithinLimit', () => {
  it('admits only lengths whose worst case stays within the limit', () => {
    expect(surelyWithinLimit(66_666)).toBe(true);
    expect(surelyWithinLimit(66_667)).toBe(false);
  });
});

describe('delayScriptMatches', () => {
  it('reads each script from its opening to the first end tag after its first `>`', () => {
    const text = '<p><script a="1">x</script ><SCRIPT>y</ script>tail';
    expect(delayScriptMatches(text)).toEqual([
      { opening: { start: 3, attrStart: 10, gt: 16 }, contentEnd: 18, end: 28 },
      { opening: { start: 28, attrStart: 35, gt: 35 }, contentEnd: 37, end: 47 }
    ]);
  });

  it('stops at an opening with no end tag after it (within the limit)', () => {
    expect(delayScriptMatches('<script>a</script><script>open')).toHaveLength(1);
    expect(delayScriptMatches('<script')).toEqual([]);
  });

  it('fails as a whole past the limit, matching or not', () => {
    const body = (n: number): string => `<script>${'a'.repeat(n)}</script><script></script>`;
    // 9 + 2n <= 1 000 000 ⇔ n <= 499 995 (the plugin flips at the same byte).
    expect(delayScriptMatches(body(499_995))).toHaveLength(2);
    expect(delayScriptMatches(body(499_996))).toBeNull();
    const tail = (n: number): string => `<script></script><script>${'a'.repeat(n)}`;
    // 11 + 2 × 2n <= 1 000 000.
    expect(delayScriptMatches(tail(249_997))).toHaveLength(1);
    expect(delayScriptMatches(tail(249_998))).toBeNull();
    expect(PCRE_BACKTRACK_LIMIT).toBe(1_000_000);
  });

  it('charges every failing attempt of the tail, the costliest deciding', () => {
    // The second attempt (k = 5 spaces: 6 runs) costs more than the first.
    const text = (n: number): string => `<script>aaaaa<script     >${'a'.repeat(n)}`;
    const steps = (n: number): number => delaySearchSteps(text(n));
    expect(steps(20)).toBe(308);
    const n = 83_327;
    // Measured: 999 992 and 1 000 004 (68 + 12n).
    expect(steps(n)).toBe(999_992);
    expect(steps(n + 1)).toBe(1_000_004);
    expect(delayScriptMatches(text(n))).toEqual([]);
    expect(delayScriptMatches(text(n + 1))).toBeNull();
  });
});

describe('the byte measure', () => {
  /** A single-byte charset: every unit one byte. */
  const singleByte: ByteMeasure = { unitBytes: () => 1, maxUnitBytes: 1 };

  it('charges each byte the served encoding has, UTF-8 by default', () => {
    expect(contentSteps('é€', 0, 2)).toBe(10);
    expect(contentSteps('é€', 0, 2, singleByte)).toBe(4);
    expect(delaySearchSteps('<script>é</script>', 0, singleByte)).toBe(11);
    expect(delaySearchSteps('<script>é</script>')).toBe(13);
  });

  it('bounds the cheap check by the measure’s widest unit', () => {
    expect(surelyWithinLimit(199_998, singleByte)).toBe(true);
    expect(surelyWithinLimit(199_999, singleByte)).toBe(false);
  });
});

describe('failing attempts — linear on hostile input', () => {
  it(
    'shares one `>` search between openings before a far `>` (1 → 4 MiB)',
    () => {
      // One `indexOf` per opening re-read the page: 19.7 s at 4 MiB.
      const scaling = linearScaling(
        (bytes) => `<head></head>${'<script'.repeat(Math.floor(bytes / 7))}>`,
        delayScriptMatches
      );
      expect(scaling.violation).toBeUndefined();
      // Its first attempt reads 4 MiB of attribute: past the limit, as on the plugin.
      expect(scaling.output).toBeNull();
    },
    LINEAR_SCALING_TIMEOUT_MS
  );

  it(
    'reads the end-tag reach after a shared `>` once (openings before `<   …`)',
    () => {
      // `bytes` is split between the openings and the spaces (400 000 each at 4 MiB).
      const scaling = linearScaling(
        (bytes) => {
          const count = Math.floor(bytes / 10);
          const text = `${'<script '.repeat(count)}><${' '.repeat(count)}/`;
          return { text, first: { start: 0, attrStart: 7, gt: text.indexOf('>') } };
        },
        (input) => failingTailSteps(input.text, input.first)
      );
      expect(scaling.violation).toBeUndefined();
      expect(scaling.output).toBeGreaterThan(PCRE_BACKTRACK_LIMIT);
    },
    LINEAR_SCALING_TIMEOUT_MS
  );
});
