/**
 * The minify-cache URL check decides the Minify CSS/JS footprint verdicts,
 * so its linear walk must answer exactly as the original grammar
 * `(.*)cache/min/<n>/<w>(.*).<ext>(.*)` does — pinned here against that
 * grammar over the fixture corpus' URLs, crafted edge cases (every line
 * terminator included) and a seeded random set biased toward the grammar's
 * own fragments — and must stay linear on hostile input of any length.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_DIR, FIXTURES } from '../detection/fixtures/corpus';
import { hasMinifiedCacheUrl, type MinifiedAssetExtension } from './minify-cache-url';

/** The original grammar per extension: the equivalence reference. */
const REFERENCE: Readonly<Record<MinifiedAssetExtension, RegExp>> = {
  css: /(.*)cache\/min\/\d+\/[a-zA-Z0-9_](.*).css(.*)/,
  js: /(.*)cache\/min\/\d+\/[a-zA-Z0-9_](.*).js(.*)/
};

/** Both extensions. */
const EXTENSIONS: readonly MinifiedAssetExtension[] = ['css', 'js'];

/** Longest input fed to the reference (its cost is polynomial in length). */
const REFERENCE_MAX_LENGTH = 600;

/**
 * Every quoted attribute value in the fixture corpus that is short enough
 * for the reference grammar — the real URLs (`src`, `href`, `data-rocket-src`…).
 *
 * @returns The values, document order per fixture.
 */
function corpusValues(): string[] {
  const values: string[] = [];
  for (const name of FIXTURES) {
    const html = readFileSync(join(FIXTURE_DIR, name), 'utf8');
    for (const match of html.matchAll(/=\s*(["'])([^"']{1,600})\1/g)) {
      const value = match[2];
      if (value !== undefined) values.push(value);
    }
  }
  return values;
}

/**
 * Deterministic PRNG (mulberry32), so a failing random case reproduces.
 *
 * @param seed The 32-bit seed.
 * @returns A generator of floats in [0, 1).
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Building blocks biased toward the grammar's own pieces and its edges. */
const FRAGMENTS = [
  'cache/min/',
  'cache/min/1/',
  'cache/min//',
  'cache/mín/1/',
  '12',
  '/',
  'a',
  '_',
  '-',
  '.',
  'j',
  's',
  'js',
  '.js',
  'c',
  'css',
  '.css',
  '?ver=1',
  '\n',
  '\r',
  '\u2028',
  '\u2029',
  ' ',
  'é'
] as const;

/**
 * Random strings assembled from {@link FRAGMENTS}.
 *
 * @param count How many strings.
 * @param seed The PRNG seed.
 * @returns The strings, each at most 40 fragments long.
 */
function randomStrings(count: number, seed: number): string[] {
  const next = seededRandom(seed);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const parts = Math.floor(next() * 40);
    let value = '';
    for (let p = 0; p < parts; p++) value += FRAGMENTS[Math.floor(next() * FRAGMENTS.length)] ?? '';
    out.push(value);
  }
  return out;
}

/** Crafted edge cases: each boundary the grammar has. */
const EDGES = [
  '',
  'cache/min/1/a.js',
  'cache/min/1/aj',
  'cache/min/1/a.j',
  'cache/min/1/ajs',
  'cache/min/1/xjs',
  'cache/min/1/x.css',
  'cache/min/1/xcss',
  'cache/min/1/-a.js',
  'cache/min/a/b.js',
  'cache/min//b.js',
  'cache/min/1/a\n.js',
  'cache/min/1/a\r.js',
  'cache/min/1/a\u2028.js',
  'cache/min/1/a\u2029.js',
  'cache/min/1/a\u2028\u2029xjs',
  'cache/min/1/a.js\u2028',
  '\u2029cache/min/1/a.js',
  'cache/min/1/a\n\ncache/min/2/b.js',
  'cache/min/1/a\u2028cache/min/2/b.css',
  'cache/min/1/a\u2029js\u2029cache/min/1/b',
  'js\ncache/min/1/a',
  'cache/min/1/a js\ncache/min/1/b',
  'cache/min/1/xcache/min/1/js',
  'cache/min/12345/cache/min/1/aXjs',
  'https://x/wp-content/cache/min/1/abc.js?ver=1',
  'https://x/wp-content/cache/min/1/abc.css?ver=1',
  'https://x/style.css',
  'https://x/wp-content/cache/min/1/wp-content/themes/t/a.min.js',
  '//cdn.example/cache/min/12/abcdef0123456789abcdef0123456789.js',
  '/wp-content/cache/min/1/abc.js',
  'CACHE/MIN/1/A.JS',
  'cache/min/1/a.JS'
] as const;

describe('hasMinifiedCacheUrl — equivalence with the original grammar', () => {
  const inputs = [...EDGES, ...corpusValues(), ...randomStrings(20_000, 0x5eed)];

  it('feeds a meaningful mix (corpus present, both answers reached)', () => {
    expect(corpusValues().length).toBeGreaterThan(500);
    for (const extension of EXTENSIONS) {
      const hits = inputs.filter((value) => REFERENCE[extension].test(value)).length;
      expect(hits, extension).toBeGreaterThan(100);
      expect(inputs.length - hits, extension).toBeGreaterThan(100);
    }
  });

  for (const extension of EXTENSIONS) {
    it(`answers exactly as the original grammar (${extension})`, () => {
      const mismatches = inputs
        .filter((value) => value.length <= REFERENCE_MAX_LENGTH)
        .filter(
          (value) => REFERENCE[extension].test(value) !== hasMinifiedCacheUrl(value, extension)
        );
      expect(mismatches).toEqual([]);
    });
  }

  it('pins the served shapes', () => {
    expect(hasMinifiedCacheUrl('https://x/wp-content/cache/min/1/abc.css?ver=1', 'css')).toBe(true);
    expect(hasMinifiedCacheUrl('https://x/wp-content/cache/min/1/abc.js?ver=1', 'js')).toBe(true);
    expect(hasMinifiedCacheUrl('https://x/style.css', 'css')).toBe(false);
    // The row's own extension only.
    expect(hasMinifiedCacheUrl('https://x/wp-content/cache/min/1/abc.css', 'js')).toBe(false);
  });

  it('is stateless across calls (its global searches reset every call)', () => {
    const long = `${'x'.repeat(50)}cache/min/1/a\ncache/min/1/b.js`;
    expect(hasMinifiedCacheUrl(long, 'js')).toBe(true);
    expect(hasMinifiedCacheUrl('cache/min/1/a.js', 'js')).toBe(true);
    expect(hasMinifiedCacheUrl('cache/min/1/a', 'js')).toBe(false);
    expect(hasMinifiedCacheUrl('cache/min/1/a.js', 'js')).toBe(true);
  });
});

describe('hasMinifiedCacheUrl — cost on hostile input', () => {
  /**
   * A hostile URL: repeated cache directories with no extension.
   *
   * @param length The length in characters.
   * @returns The URL.
   */
  function hostile(length: number): string {
    return 'cache/min/1/a'.repeat(Math.ceil(length / 13)).slice(0, length);
  }

  it('rejects a 256 KiB hostile URL fast (original grammar: ~0.9 s at 4 KiB)', () => {
    // Without the extension, and with it only past the line's end (every
    // directory then has a candidate extension to rule out).
    const urls = [hostile(256 * 1024), `${hostile(256 * 1024)}\njs css`];
    for (const url of urls) {
      for (const extension of EXTENSIONS) {
        const start = performance.now();
        expect(hasMinifiedCacheUrl(url, extension)).toBe(false);
        // Linear: < 1 ms on Node 24 (the lazy regex form: ~1.1 s); the bound only catches a regression.
        expect(performance.now() - start).toBeLessThan(150);
      }
    }
  });

  it('stays linear across many lines, long digit runs and an early extension', () => {
    const lines = 'cache/min/1/a\n'.repeat(20_000);
    const digits = `cache/min/${'1'.repeat(200_000)}`;
    const extensionEarly = `js${'cache/min/1/a'.repeat(20_000)}`;
    const start = performance.now();
    expect(hasMinifiedCacheUrl(lines, 'js')).toBe(false);
    expect(hasMinifiedCacheUrl(digits, 'js')).toBe(false);
    expect(hasMinifiedCacheUrl(extensionEarly, 'js')).toBe(false);
    expect(performance.now() - start).toBeLessThan(150);
  });

  it('rejects 5000 long non-matching URLs fast (original grammar: ~0.5 s)', () => {
    const url = `https://example.com/wp-content/cache/min/1/${'a'.repeat(400)}.txt`;
    const start = performance.now();
    for (let i = 0; i < 5000; i++) hasMinifiedCacheUrl(url, 'js');
    expect(performance.now() - start).toBeLessThan(100);
  });
});
