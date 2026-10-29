/**
 * The Defer JS scanners' own rules (the plugin table and the fuzz-pinned
 * forward suites cover their matches): the comment stripper's reading of
 * unclosed comments and where its backtrack-limit guard refuses, in bytes.
 */
import { describe, expect, it } from 'vitest';
import { deferSrcMatches, stripDeferComments } from './defer-js-scan';
import { UNREPRODUCED_STEP_CEILING } from './unreproduced-limits';
import { UTF8_MEASURE } from './utf8';

/** A deferrable script ahead of the comment, as in the plugin repro. */
const SCRIPT = '<script src="a.js"></script>';

/**
 * The most bytes an unclosed comment may hold after `<!--` and still be
 * stripped: the guard's ceiling less the per-attempt overhead.
 */
const MAX_UNCLOSED_BYTES = UNREPRODUCED_STEP_CEILING - 32;

describe('stripDeferComments', () => {
  it('removes each comment up to the first closer, left to right', () => {
    expect(stripDeferComments('a<!--x-->b<!--y--z-->c', UTF8_MEASURE)).toBe('abc');
    expect(stripDeferComments('a<!---->b', UTF8_MEASURE)).toBe('ab');
  });

  it('keeps an unclosed comment and everything after it', () => {
    expect(stripDeferComments(`a<!--x-->b<!--c<!--d-->`, UTF8_MEASURE)).toBe('ab');
    expect(stripDeferComments(`a<!--x-->b<!--c`, UTF8_MEASURE)).toBe('ab<!--c');
  });

  it('refuses an unclosed comment PCRE scans past its backtrack limit (the plugin fails there)', () => {
    const page = `${SCRIPT}<!--${'z'.repeat(1_100_000)}`;
    expect(stripDeferComments(page, UTF8_MEASURE)).toEqual({ beyond: 'html-comments' });
    // With more page after it: the attempt still reads to the end.
    expect(stripDeferComments(`${page}${SCRIPT}`, UTF8_MEASURE)).toEqual({
      beyond: 'html-comments'
    });
  });

  it('accepts an unclosed comment well inside the limit', () => {
    const page = `${SCRIPT}<!--${'z'.repeat(400_000)}`;
    expect(stripDeferComments(page, UTF8_MEASURE)).toBe(page);
  });

  it('pins the unclosed-comment boundary in bytes', () => {
    const at = (tail: string): unknown => stripDeferComments(`${SCRIPT}<!--${tail}`, UTF8_MEASURE);
    expect(typeof at('z'.repeat(MAX_UNCLOSED_BYTES))).toBe('string');
    expect(at('z'.repeat(MAX_UNCLOSED_BYTES + 1))).toEqual({ beyond: 'html-comments' });
    // `é` is two UTF-8 bytes: half the code units reach the same boundary.
    expect(typeof at('é'.repeat(MAX_UNCLOSED_BYTES / 2))).toBe('string');
    expect(at(`${'é'.repeat(MAX_UNCLOSED_BYTES / 2)}z`)).toEqual({ beyond: 'html-comments' });
    expect(at('é'.repeat(MAX_UNCLOSED_BYTES / 2 + 1))).toEqual({ beyond: 'html-comments' });
  });

  it('charges only the first unclosed opener (the scan stops there)', () => {
    const half = 'z'.repeat(MAX_UNCLOSED_BYTES / 2);
    expect(typeof stripDeferComments(`<!--${half}<!--${half.slice(4)}`, UTF8_MEASURE)).toBe(
      'string'
    );
  });
});

describe('deferSrcMatches', () => {
  it('reads each script tag once, skipping stretches without a `src`', () => {
    const page = `${'<script type="text/x">v</script>'.repeat(3)}<script id="i" src="b.js"></script>`;
    expect(deferSrcMatches(page, UTF8_MEASURE)).toEqual([
      { text: '<script id="i" src="b.js">', url: 'b.js' }
    ]);
  });

  it('takes the last `src` after whitespace or a quote (as the plugin does)', () => {
    expect(deferSrcMatches(`<script src="a.js" src='b.js'>`, UTF8_MEASURE)).toEqual([
      { text: `<script src="a.js" src='b.js'>`, url: 'b.js' }
    ]);
    // `data-src` is no candidate: `-` is neither whitespace nor a quote.
    expect(deferSrcMatches(`<script src="a.js" data-src='b.js'>`, UTF8_MEASURE)).toEqual([
      { text: `<script src="a.js" data-src='b.js'>`, url: 'a.js' }
    ]);
    expect(deferSrcMatches(`<script data-x=" src='q.js'" src="r.js">`, UTF8_MEASURE)).toEqual([
      { text: `<script data-x=" src='q.js'" src="r.js">`, url: 'r.js' }
    ]);
  });
});
