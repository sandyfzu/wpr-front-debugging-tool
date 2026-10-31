/**
 * The step estimates of the regexes whose backtrack limit is not
 * reproduced. "Plugin" counts are the real PCRE JIT's for the same
 * subject (PHP 8.1.34 / PCRE2 10.49, `php -n -d pcre.jit=1`, the smallest
 * `pcre.backtrack_limit` it passes at, by bisection); each estimate must
 * stay at or above them (checked on hundreds of random subjects when set).
 */
import { describe, expect, it } from 'vitest';
import { delayMaskScan } from '../exclusion-builder/delay-js-mask';
import { conditionalScan, scriptConditionalParts } from './ie-conditionals';
import {
  ieConditionalScriptSteps,
  ieConditionalsSteps,
  maskSteps,
  metaCharsetWithinCeiling,
  UNREPRODUCED_STEP_CEILING
} from './unreproduced-limits';

describe('UNREPRODUCED_STEP_CEILING', () => {
  it('is half PHP’s default backtrack limit', () => {
    expect(UNREPRODUCED_STEP_CEILING).toBe(500_000);
  });
});

describe('ieConditionalsSteps — at or above the plugin', () => {
  it.each([
    ['a matching conditional', `<!--[if IE]>${'a'.repeat(8000)}<![endif]-->`, 8_002],
    ['2-byte characters', `<!--[if IE]>${'é'.repeat(8000)}<![endif]-->`, 16_002],
    ['an opening with no end', `<!--[if IE]>${'a'.repeat(8000)}`, 8_002],
    ['openings with no end', '<!--[if IE]>'.repeat(8000 / 12), 7_982]
  ])('%s', (_name, html, plugin) => {
    const steps = ieConditionalsSteps(html, conditionalScan(html));
    expect(steps).toBeGreaterThanOrEqual(plugin);
    // Tight: one step per byte, plus a constant.
    expect(steps).toBeLessThanOrEqual(new TextEncoder().encode(html).length + 16);
  });

  it('is 0 on a page without conditionals', () => {
    expect(ieConditionalsSteps('<p>x</p>', conditionalScan('<p>x</p>'))).toBe(0);
  });
});

describe('ieConditionalScriptSteps — at or above the plugin', () => {
  const opening = '<!--[if IE]><script a>';
  const closing = '</script><![endif]-->';
  /**
   * A script conditional whose content repeats `unit` over about 8 000 bytes.
   *
   * @param unit The repeated content.
   */
  const repeated = (unit: string): string =>
    `${opening}${unit.repeat(Math.max(1, Math.floor(8000 / unit.length)))}x${closing}`;

  it.each([
    ['plain content', `${opening}${'a'.repeat(8000)}${closing}`, 16_011],
    [
      'spaces after an inner `</script>`',
      `${opening}</script>${' '.repeat(400)}x${closing}`,
      2_034
    ],
    ['`</script>` + 100 spaces, repeated', repeated(`</script>${' '.repeat(100)}`), 2_219_646],
    [
      '`</script>` + 400 spaces + `<!--` + 400 spaces, repeated',
      repeated(`</script>${' '.repeat(400)}<!--${' '.repeat(400)}`),
      3_881_492
    ]
  ])('%s', (_name, conditional, plugin) => {
    const parts = scriptConditionalParts(conditional);
    expect(parts).not.toBeNull();
    if (parts === null) return;
    expect(ieConditionalScriptSteps(conditional, parts)).toBeGreaterThanOrEqual(plugin);
  });
});

describe('maskSteps — at or above the plugin', () => {
  it.each([
    ['xmp', 'a matching region', `<xmp>${'a'.repeat(8000)}</xmp>`, 8_002],
    ['xmp', 'an unclosed region', `<xmp>${'a'.repeat(8000)}`, 16_003],
    ['xmp', 'an unclosed region of 2-byte characters', `<xmp>${'é'.repeat(8000)}`, 32_003],
    ['svg', 'a matching region of `<`', `<svg>${'<'.repeat(8000)}</svg>`, 24_007],
    ['svg', 'an unclosed region of `<`', `<svg>${'<'.repeat(8000)}`, 32_004],
    ['svg', 'a matching region of `</sv`', `<svg>${'</sv'.repeat(2000)}</svg>`, 14_007],
    ['svg', 'an unclosed region of `</`', `<svg>${'</'.repeat(4000)}`, 28_004]
  ] as const)('%s: %s', (kind, _name, html, plugin) => {
    expect(maskSteps(html, delayMaskScan(html))[kind]).toBeGreaterThanOrEqual(plugin);
  });

  it('charges the svg regex for each xmp placeholder it reads', () => {
    const html = `<svg>${'<xmp>a</xmp>'.repeat(10)}</svg>`;
    const alone = maskSteps('<svg></svg>', delayMaskScan('<svg></svg>')).svg;
    expect(maskSteps(html, delayMaskScan(html)).svg).toBeGreaterThan(alone + 10 * 32);
  });

  it('is 0 without regions or unclosed openings', () => {
    expect(maskSteps('<p>x</p>', delayMaskScan('<p>x</p>'))).toEqual({ xmp: 0, svg: 0 });
  });
});

describe('metaCharsetWithinCeiling', () => {
  it('holds for an ordinary head', () => {
    expect(
      metaCharsetWithinCeiling('<html><head><meta charset="utf-8"><title>t</title></head></html>')
    ).toBe(true);
  });

  it('fails for a body declaration read to a far page end (plugin: 500 213 steps)', () => {
    const page = `<html><head><meta charset="utf-8"></head><body><meta charset="utf-8">${'a'.repeat(100_000)}<script>x</script></body></html>`;
    expect(metaCharsetWithinCeiling(page)).toBe(false);
  });
});
