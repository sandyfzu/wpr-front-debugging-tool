/**
 * The `<meta charset>` pattern's explored cost. "Plugin" counts are the
 * real PCRE JIT's (PHP 8.1.34 / PCRE2 10.49, `php -n -d pcre.jit=1`: the
 * smallest `pcre.backtrack_limit` the attempt passes at, by bisection);
 * the estimate must never fall below them (it was measured at or above
 * them on 3 000 random attempts when it was set).
 */
import { describe, expect, it } from 'vitest';
import { metaCharsetCost } from './meta-charset-cost';
import { metaCharsetByteSpans } from './meta-charset-scan';
import { byteView } from './utf8';

/** No cap: explore everything. */
const UNCAPPED = { attempt: Number.POSITIVE_INFINITY, work: Number.POSITIVE_INFINITY };

describe('metaCharsetCost — at or above the plugin', () => {
  it.each([
    ['walk to the first `h`', `<meta ${'a'.repeat(16_000)}h</head>`, 32_004],
    ['lookahead to `</head>`', `<meta charset="utf-8">${'a'.repeat(16_000)}</head>`, 16_019],
    [
      'lookahead with 2-byte characters',
      `<meta charset="utf-8">${'é'.repeat(8_000)}</head>`,
      16_019
    ],
    ['failing lookaheads', `<meta charset="utf-8">${'a'.repeat(16_000)}`, 80_053],
    ['second branch over a long run', `<meta charset ${'a b '.repeat(400)}></head>`, 3_208],
    ['second branch, all failing', `<meta charset ${'a b '.repeat(100)}>`, 5_433_713],
    ['an `=` run', `<meta charset${'='.repeat(1600)}abc></head>`, 3_211],
    [
      'http-equiv then many `charset`',
      `<meta http-equiv= Content-Type"${'charsetx'.repeat(200)}></head>`,
      3_196
    ],
    ['`<meta charset` repeated', `${'<meta charset'.repeat(12)}</head>`, 957_574],
    [
      'a body declaration with 100 000 bytes after it',
      `<html><head><meta charset="utf-8"></head><body><meta charset="utf-8">${'a'.repeat(100_000)}<script>x</script></body></html>`,
      500_213
    ]
  ])('%s', (_name, page, plugin) => {
    const cost = metaCharsetCost(byteView(page), UNCAPPED);
    expect(cost.complete).toBe(true);
    expect(cost.mostSteps).toBeGreaterThanOrEqual(plugin);
  });
});

describe('metaCharsetCost — matches and caps', () => {
  it('finds the scanner’s matches before the last `</head>` (and none after)', () => {
    let state = 23;
    const next = (): number => (state = (state * 48_271) % 2_147_483_647) / 2_147_483_647;
    const pieces = [
      '<meta ',
      'charset',
      '=',
      '"',
      "'",
      '>',
      'http-equiv=',
      ' Content-Type"',
      'h',
      'a',
      '</head>'
    ];
    for (let round = 0; round < 5000; round++) {
      let page = '';
      for (let index = 0; index < 20; index++)
        page += pieces[Math.floor(next() * pieces.length)] ?? '';
      const head = page.lastIndexOf('</head>');
      const spans = head === -1 ? [] : metaCharsetByteSpans(page.slice(0, head));
      expect(metaCharsetCost(page, UNCAPPED).matches, page).toEqual(spans);
    }
  });

  it('counts an attempt with no group at its first `h` without walking it', () => {
    const page = `<meta ${'a'.repeat(1000)}h`;
    // 1 for `<meta`, 4 per byte up to and including the `h`.
    expect(metaCharsetCost(page, { attempt: Infinity, work: 1 }).mostSteps).toBe(1 + 4 * 1002);
  });

  it('stops exploring past either cap', () => {
    const page = `${'<meta charset'.repeat(12)}</head>`;
    expect(metaCharsetCost(page, { attempt: 10_000, work: Infinity }).complete).toBe(false);
    expect(metaCharsetCost(page, { attempt: Infinity, work: 10_000 }).complete).toBe(false);
  });
});
