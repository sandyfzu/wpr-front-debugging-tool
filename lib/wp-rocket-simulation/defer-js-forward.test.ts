/**
 * The forward Defer JS transform's own rules (the plugin table and the
 * hostile suite cover the byte-level output): its states, the URL matcher's
 * row handling, the inline exclusion pattern's PHP readings, the tag test,
 * and the composition ahead of Delay JS.
 */
import { describe, expect, it } from 'vitest';
import { ExclusionValidationError } from '../exclusion-builder/errors';
import {
  DEFER_REPLACEMENT_WORK_LIMIT,
  deferUrlMatcher,
  holdsAsyncOrDefer,
  inlineExclusions,
  simulateDeferJs,
  type DeferJsPassInput
} from './defer-js-forward';
import { simulateDelayJs } from './delay-js-forward';
import { UNREPRODUCED_STEP_CEILING } from './unreproduced-limits';

/** Inputs with the given rows and lists (3.24 quoting). */
const input = (
  rows: readonly string[] = [],
  external: readonly string[] = ['gist.github.com'],
  inline: readonly string[] = ['DOMContentLoaded']
): DeferJsPassInput => ({ rows, lists: { external, inline }, inlineQuoteDelimiter: '/' });

/** Simulate `html` under {@link input}. */
const simulate = (
  html: string,
  pass: DeferJsPassInput = input()
): ReturnType<typeof simulateDeferJs> => simulateDeferJs({ html, ...pass });

describe('simulateDeferJs', () => {
  it('defers and wraps, counting distinct tags and scripts', () => {
    const out = simulate(
      '<script src="a.js"></script><script src="a.js"></script><script>jQuery(1)</script>'
    );
    expect(out.html).toBe(
      '<script src="a.js" data-rocket-defer defer></script><script src="a.js" data-rocket-defer defer></script><script>window.addEventListener(\'DOMContentLoaded\', function() {jQuery(1)});</script>'
    );
    expect(out.report).toEqual({ state: 'simulated', deferred: 1, wrapped: 1 });
  });

  it('is the identity on AMP and on pages WP Rocket already defers', () => {
    expect(simulate('<html amp><script src="a.js"></script>').report).toEqual({
      state: 'not-applicable',
      reason: 'amp',
      deferred: 0,
      wrapped: 0
    });
    for (const page of [
      '<script src="a.js" data-rocket-defer defer></script><script src="b.js"></script>',
      '<meta name="generator" content="WP Rocket" data-wpr-features="wpr_defer_js"><script src="b.js"></script>'
    ]) {
      expect(simulate(page)).toEqual({
        html: page,
        report: { state: 'already-served', deferred: 0, wrapped: 0 }
      });
    }
    // A mention in a comment or a value is no footprint.
    expect(simulate('<!-- data-rocket-defer --><script src="b.js"></script>').report.state).toBe(
      'simulated'
    );
  });

  it('is the identity, naming the regex, where PCRE could stop', () => {
    const beyond = (html: string): unknown => simulate(html).report.unreproducedRegex;
    const big = UNREPRODUCED_STEP_CEILING;
    expect(beyond(`<!--${'a'.repeat(big)}-->`)).toBe('html-comments');
    expect(beyond(`<script ${' '.repeat(400)}>`)).toBe('defer-script-src');
    expect(beyond(`<script>${'a'.repeat(big)}`)).toBe('defer-inline-scripts');
    expect(beyond(`<!--[if IE]>${'a'.repeat(big)}`)).toBe('ie-conditionals');
    expect(beyond(`<!--[if IE]><script a>${'x'.repeat(big / 8)}</script><![endif]-->`)).toBe(
      'ie-conditional-script'
    );
    expect(simulate(`<!--${'a'.repeat(big)}-->`).report).toMatchObject({
      state: 'not-applicable',
      reason: 'beyond-exact-reproduction'
    });
  });

  it('rewrites many distinct scripts in one pass, past what a replay could rescan', () => {
    const scripts = Array.from(
      { length: 300 },
      (_, index) =>
        `<script src="/${String(index)}.js"></script><script>jQuery(${String(index)})</script>`
    );
    const filler = `<p>${'x'.repeat(Math.ceil(DEFER_REPLACEMENT_WORK_LIMIT / 256))}</p>`;
    const out = simulate(`${filler}${scripts.join('')}`);
    expect(out.report).toEqual({ state: 'simulated', deferred: 300, wrapped: 300 });
    expect(
      out.html.endsWith(
        `<script src="/299.js" data-rocket-defer defer></script><script>window.addEventListener('DOMContentLoaded', function() {jQuery(299)});</script>`
      )
    ).toBe(true);
  });

  it('replays overlapping tags call by call, and stops past the work limit', () => {
    // A tag inside another's URL: replacing the outer one first breaks the inner occurrence.
    const pair = (index: number): string => {
      const inner = `<script src="r${String(index)}.js">`;
      return `<script src="q${inner}"></script>${inner}</script>`;
    };
    expect(simulate(pair(0)).html).toBe(
      '<script src="q<script src="r0.js" data-rocket-defer defer>"></script><script src="r0.js" data-rocket-defer defer></script>'
    );
    const pairs = Array.from({ length: 300 }, (_, index) => pair(index)).join('');
    const filler = `<p>${'x'.repeat(Math.ceil(DEFER_REPLACEMENT_WORK_LIMIT / 256))}</p>`;
    expect(simulate(`${filler}${pairs}`).report.unreproducedRegex).toBe('defer-replacements');
  });

  it('wraps a repeated inline script once, and again when an insertion recreated it', () => {
    const once = simulate('<script>$(1)</script><p></p><script>$(1)</script>');
    expect(once.html.match(/DOMContentLoaded/g)).toHaveLength(2);
    expect(once.report.wrapped).toBe(1);
  });
});

describe('deferUrlMatcher', () => {
  it('matches every URL with no rows at all (the empty pattern)', () => {
    expect(deferUrlMatcher(input([], [], []))?.('/x.js')).toBe(0);
  });

  it('is null when the joined pattern fails the pre-check', () => {
    expect(deferUrlMatcher(input(['(']))).toBeNull();
    expect(deferUrlMatcher(input(['.*']))).toBeNull();
  });

  it('merges the list ahead of the rows, duplicates dropped', () => {
    const matcher = deferUrlMatcher(input(['a\\.js', 'gist.github.com']));
    expect(matcher?.('https://gist.github.com/x')).toBe(0);
    expect(matcher?.('/a.js')).toBe(1);
    expect(matcher?.('/b.js')).toBe(-1);
  });

  it('names stored rows (by stored index) and list rows it cannot reproduce', () => {
    // An inline option that leaks into the rows joined after it.
    const unmodeled = '(?-i)zzz';
    try {
      deferUrlMatcher(input(['b', unmodeled, 'A.JS']));
      expect.unreachable();
    } catch (error) {
      if (!(error instanceof ExclusionValidationError)) throw error;
      expect(error.invalid.map(({ index, row }) => [index, row])).toEqual([[1, unmodeled]]);
    }
    expect(() => deferUrlMatcher(input([], [unmodeled, 'A.JS']))).toThrow(
      /Defer JS exclusion list row 0 .* cannot be reproduced/
    );
    // A pre-check this tool cannot replay is never guessed.
    expect(() => deferUrlMatcher(input(['(?>x)', 'zzz']))).toThrow();
  });
});

describe('inlineExclusions (the pattern as PHP builds it)', () => {
  it('reads plain rows as caseless literals', () => {
    expect(inlineExclusions(['A.b(', 'x#y'], '/')).toEqual({ kind: 'rows', rows: ['a.b(', 'x#y'] });
  });

  it('skips every script for an empty pattern, "0", or an empty alternative', () => {
    expect(inlineExclusions([], '/')).toEqual({ kind: 'every' });
    expect(inlineExclusions(['', ''], '/')).toEqual({ kind: 'every' });
    expect(inlineExclusions(['0'], '#')).toEqual({ kind: 'every' });
    expect(inlineExclusions(['a', '', 'b'], '/')).toEqual({ kind: 'every' });
    // Trailing empty rows are trimmed away with the separators.
    expect(inlineExclusions(['a', ''], '/')).toEqual({ kind: 'rows', rows: ['a'] });
  });

  it('never compiles with an unescaped "/" (quoted for "#") or a trimmed last "|"', () => {
    expect(inlineExclusions(['a/b'], '#')).toEqual({ kind: 'none' });
    expect(inlineExclusions(['a/b'], '/')).toEqual({ kind: 'rows', rows: ['a/b'] });
    expect(inlineExclusions(['a|'], '/')).toEqual({ kind: 'none' });
    expect(inlineExclusions(['a\\'], '/')).toEqual({ kind: 'rows', rows: ['a\\'] });
  });
});

describe('holdsAsyncOrDefer', () => {
  it('finds whitespace then async/defer anywhere, caseless', () => {
    expect(holdsAsyncOrDefer('<script async src="a">')).toBe(true);
    expect(holdsAsyncOrDefer('<script src="a"\tDEFER>')).toBe(true);
    expect(holdsAsyncOrDefer('<script src="a?x= deferred">')).toBe(true);
    expect(holdsAsyncOrDefer('<script data-defer src="a">')).toBe(false);
    expect(holdsAsyncOrDefer('<script src="a">')).toBe(false);
  });
});

describe('simulateDelayJs with Defer JS ahead', () => {
  const delay = (html: string, defer: DeferJsPassInput): ReturnType<typeof simulateDelayJs> =>
    simulateDelayJs({ html, runtime: 'R', ieFallback: 'F', listRows: [], rows: [], defer });

  it('reports the Defer JS passes, or that the page already defers', () => {
    expect(delay('<head></head><script src="a.js"></script>', input()).report.defer).toEqual({
      state: 'simulated',
      deferred: 1,
      wrapped: 0
    });
    expect(
      delay('<head></head><script src="a.js" data-rocket-defer defer></script>', input()).report
        .defer
    ).toEqual({ state: 'already-served', deferred: 0, wrapped: 0 });
  });

  it('is the identity when a Defer JS regex could stop', () => {
    const html = `<head></head><script>${'a'.repeat(UNREPRODUCED_STEP_CEILING)}`;
    expect(delay(html, input()).report).toMatchObject({
      state: 'not-applicable',
      unreproducedRegex: 'defer-inline-scripts'
    });
  });
});
