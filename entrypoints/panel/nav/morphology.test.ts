/**
 * The morphology rule: the pure width → form function and — because the
 * CSS arm of the rule is written as class literals (container queries
 * cannot read a JS value) — the sync guard that keeps the literals, the
 * constant, and the stylesheet's container anchor one rule.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NAV_TAB_BAR_MIN_WIDTH, navMorphology } from './morphology';
/** The sample container widths, one per shape-boundary region. */
const SAMPLE_WIDTHS = [
  { width: 320, expect: 'icon-rail' }, // narrowest docking (the 48px glanceability floor below this)
  { width: NAV_TAB_BAR_MIN_WIDTH - 1, expect: 'icon-rail' },
  { width: NAV_TAB_BAR_MIN_WIDTH, expect: 'tab-bar' },
  { width: NAV_TAB_BAR_MIN_WIDTH + 1, expect: 'tab-bar' },
  { width: 1280, expect: 'tab-bar' }
] as const;

describe('navMorphology', () => {
  it('declares the bar from the threshold on and the rail below it', () => {
    for (const { width, expect: morphology } of SAMPLE_WIDTHS) {
      expect(navMorphology(width), `at ${width.toString()}px`).toBe(morphology);
    }
  });

  it('takes the exact threshold', () => {
    expect(NAV_TAB_BAR_MIN_WIDTH).toBe(768);
  });
});

describe('the rule CSS arm (sync guard)', () => {
  /** The container-query threshold tokens the shell's class strings carry. */
  const THRESHOLD_TOKEN = /@min-\[(\d+)(?:\.\d+)?px\]/g;

  /** All threshold tokens in the two files that write morphology classes. */
  const thresholds = (): number[] =>
    ['./adaptive-nav.tsx', '../App.tsx'].flatMap((file) =>
      [...readFileSync(`${import.meta.dirname}/${file}`, 'utf8').matchAll(THRESHOLD_TOKEN)].map(
        (match) => Number(match[1])
      )
    );

  it('carries the declared threshold in every variant, never a second rule', () => {
    const tokens = thresholds();
    // The guard cannot pass vacuously: the nav's classes must still exist.
    expect(tokens.length).toBeGreaterThan(0);
    expect(new Set(tokens)).toEqual(new Set([NAV_TAB_BAR_MIN_WIDTH]));
  });

  it('anchors the queries on the panel mount element as a size container', () => {
    // `import.meta.dirname` instead of the `new URL(file, import.meta.url)`
    // asset pattern — Vite rewrites that pattern for .css and the FS read
    // never sees the real path.
    const styleSheet = readFileSync(`${import.meta.dirname}/../style.css`, 'utf8');
    expect(styleSheet).toMatch(/#root\s*\{\s*container-type:\s*inline-size/);
  });
});
