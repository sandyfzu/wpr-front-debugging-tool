/**
 * The cooperative search: line-aligned slicing, the pacer's yield/cancel
 * contract, the default yield's feature detection, and answer parity with
 * the shared engine's batch search (sliced sources included).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findDefinitions, type ScriptAsset } from '../../../../lib/panel/undefined-refs';
import { UNDEFINED_REFERENCE_EXTERNAL_ERROR } from '../../../../lib/wp-rocket/constants';
import { createPacer, defaultYieldToMain, lineSlices, searchWord, type Pacer } from './search';

/** A pacer that never yields and is never cancelled. */
const FREE: Pacer = { checkpoint: () => Promise.resolve(true) };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lineSlices', () => {
  it('keeps a short source whole', () => {
    expect(lineSlices('var a;\nvar b;', 100)).toEqual(['var a;\nvar b;']);
  });

  it('cuts after the first line break past the target size, losing nothing', () => {
    const source = 'aaaa\nbbbb\ncccc\ndddd';
    const slices = lineSlices(source, 6);
    expect(slices).toEqual(['aaaa\nbbbb\n', 'cccc\ndddd']);
    expect(slices.join('')).toBe(source);
  });

  it('keeps a line longer than the target whole', () => {
    const long = 'x'.repeat(50);
    expect(lineSlices(`${long}\nshort`, 10)).toEqual([`${long}\n`, 'short']);
    expect(lineSlices(long, 10)).toEqual([long]);
  });
});

describe('createPacer', () => {
  it('yields only once the budget is spent, then checks for cancellation', async () => {
    let clock = 0;
    let cancelled = false;
    const yieldToMain = vi.fn(() => Promise.resolve());
    const pacer = createPacer({
      yieldToMain,
      now: () => clock,
      sliceMs: 8,
      cancelled: () => cancelled
    });
    clock = 5;
    await expect(pacer.checkpoint()).resolves.toBe(true);
    expect(yieldToMain).not.toHaveBeenCalled();
    clock = 9;
    await expect(pacer.checkpoint()).resolves.toBe(true);
    expect(yieldToMain).toHaveBeenCalledOnce();
    // The budget restarts after a yield.
    clock = 12;
    await expect(pacer.checkpoint()).resolves.toBe(true);
    expect(yieldToMain).toHaveBeenCalledOnce();
    cancelled = true;
    await expect(pacer.checkpoint()).resolves.toBe(false);
  });
});

describe('defaultYieldToMain', () => {
  it('prefers scheduler.yield, called on the scheduler', async () => {
    const scheduler = {
      yield: vi.fn(function (this: unknown) {
        expect(this).toBe(scheduler);
        return Promise.resolve();
      })
    };
    vi.stubGlobal('scheduler', scheduler);
    await defaultYieldToMain()();
    expect(scheduler.yield).toHaveBeenCalledOnce();
  });

  it('falls back to a MessageChannel macrotask, then to setTimeout', async () => {
    vi.stubGlobal('scheduler', undefined);
    await expect(defaultYieldToMain()()).resolves.toBeUndefined();
    vi.stubGlobal('MessageChannel', undefined);
    await expect(defaultYieldToMain()()).resolves.toBeUndefined();
  });
});

describe('searchWord', () => {
  const corpus: ScriptAsset[] = [
    { origin: { kind: 'url', url: 'https://x.test/a.js' }, content: 'var alpha = 1;' },
    { origin: { kind: 'url', url: 'https://x.test/a.js' }, content: 'alpha = 2;' },
    {
      origin: { kind: 'url', url: 'https://x.test/b.js' },
      content: `${'// filler line\n'.repeat(200)}window.beta = function () {};\nfunction gamma() {}`
    },
    { origin: { kind: 'inline' }, content: 'const delta = 4;\nobj.alpha: 1' }
  ];
  const words = [
    'alpha',
    'beta',
    'gamma',
    'delta',
    'missing',
    'a.c',
    '(',
    UNDEFINED_REFERENCE_EXTERNAL_ERROR
  ];

  it('answers exactly what the shared batch search answers, sliced or whole', async () => {
    const expected = findDefinitions(corpus, words);
    for (const sliceChars of [16, 1024, 1_000_000]) {
      const answered = [];
      for (const word of words) {
        answered.push({ word, definitions: await searchWord(word, corpus, FREE, sliceChars) });
      }
      expect(answered).toEqual(expected);
    }
  });

  it('answers the cross-origin sentinel with no definitions', async () => {
    await expect(searchWord(UNDEFINED_REFERENCE_EXTERNAL_ERROR, corpus, FREE)).resolves.toEqual([]);
  });

  it('checkpoints after every slice and stops when cancelled', async () => {
    let calls = 0;
    const pacer: Pacer = {
      checkpoint: () => {
        calls += 1;
        return Promise.resolve(calls < 3);
      }
    };
    await expect(searchWord('missing', corpus, pacer, 16)).resolves.toBeNull();
    expect(calls).toBe(3);
  });
});
