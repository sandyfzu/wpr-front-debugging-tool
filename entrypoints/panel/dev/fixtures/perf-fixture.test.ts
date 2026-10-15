/**
 * The performance fixture's pins: deterministic, at the contract's caps,
 * validator-genuine. `PERF_FIXTURE_OUT=<path>` writes the fixture as JSON for
 * browser runs (nothing is committed: the seed makes it reproducible).
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFdtData } from '../../../../lib/messaging/validate';
import { generatePerfFixture, PERF_FIXTURE_ROWS, seededRandom } from './perf-fixture';

describe('seededRandom', () => {
  it('repeats per seed, differs across seeds and stays in [0, 1)', () => {
    const a = seededRandom(1);
    const b = seededRandom(1);
    const c = seededRandom(2);
    const first = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(first);
    expect(Array.from({ length: 50 }, () => c())).not.toEqual(first);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
  });
});

describe('generatePerfFixture', () => {
  const fixture = generatePerfFixture();

  it('is deterministic for a seed', () => {
    expect(generatePerfFixture()).toEqual(fixture);
    expect(generatePerfFixture(1)).not.toEqual(fixture);
  });

  it('fills the script and image lists to the contract cap', () => {
    expect(fixture.wprDetections.delay_js.scripts).toHaveLength(PERF_FIXTURE_ROWS);
    expect(fixture.wprDetections.lazyload.images).toHaveLength(PERF_FIXTURE_ROWS);
  });

  it('passes the panel boundary validator unchanged', () => {
    expect(parseFdtData(JSON.parse(JSON.stringify(fixture)))).toEqual(fixture);
  });

  it('covers every script shape the JavaScript page renders', () => {
    const scripts = fixture.wprDetections.delay_js.scripts;
    const has = (predicate: (script: (typeof scripts)[number]) => boolean): boolean =>
      scripts.some(predicate);
    expect(has((s) => s.inline && s.content === '')).toBe(true);
    expect(has((s) => s.inline && (s.content ?? '').split('\n').length > 100)).toBe(true);
    expect(has((s) => s.inline && !(s.content ?? '').includes('\n'))).toBe(true);
    expect(has((s) => !s.inline && (s.src ?? '').startsWith('/'))).toBe(true);
    expect(has((s) => s.deferredByWPR)).toBe(true);
    expect(has((s) => s.deferred && !s.deferredByWPR)).toBe(true);
    expect(has((s) => s.fdtExcluded === 'delay_js')).toBe(true);
    expect(has((s) => s.fdtExcluded === 'delay_js,defer_all_js')).toBe(true);
    expect(fixture.wprDetections.delay_js.delayedScripts).toBe(
      scripts.filter((s) => s.delayed).length
    );
  });

  it.runIf(process.env['PERF_FIXTURE_OUT'] !== undefined)('writes the JSON on request', () => {
    writeFileSync(process.env['PERF_FIXTURE_OUT'] ?? '', `${JSON.stringify(fixture)}\n`);
  });
});
