/**
 * WP Rocket's Defer JS inline-jQuery pass: when its joined exclusion text
 * turns the pass off, when that is certain without the live rows, and
 * undoing the wrapping it served. Expected values are WP Rocket 3.23.5.1's
 * own (`DeferJS::defer_inline_js` run on these inputs, PHP 8.1 / PCRE2 10.49).
 */
import { describe, expect, it } from 'vitest';
import { INLINE_WRAP_CLOSE, INLINE_WRAP_OPEN } from '../wp-rocket/constants';
import {
  hasSpanningWrapper,
  inlinePassUnder,
  namesJqueryFile,
  replayInlinePass,
  spanningWrapperReading,
  unwrapInlineScripts
} from './defer-inline-js';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from './set';

/** A body as WP Rocket wraps it. */
const wrap = (body: string): string => `${INLINE_WRAP_OPEN}${body}${INLINE_WRAP_CLOSE}`;

/** A set with these Defer JS rows (and, optionally, Defer JS disabled). */
function deferSet(rows: string[], disabled = false): ExclusionSet {
  return {
    rows: { ...EMPTY_EXCLUSION_SET.rows, deferJs: rows },
    disable: { ...EMPTY_EXCLUSION_SET.disable, deferJs: disabled }
  };
}

describe('namesJqueryFile — WP Rocket`s /(jquery(?:.*)?\\.js)/i over the joined rows', () => {
  it.each([
    [[], false],
    [['jquery'], false],
    [['jquery.min.js'], true],
    [['/jquery-?[0-9.]*(.min|.slim|.slim.min)?.js'], true],
    [['JQUERY.JS'], true],
    // The joined text: `jquery|foo.js` matches, `foo.js|jquery` does not.
    [['jquery', 'foo.js'], true],
    [['foo.js', 'jquery'], false],
    // `#` escaped inside the joined text: `jquery\#x|a.js`.
    [['jquery#x', 'a.js'], true],
    // Deduplicated before the join (first kept): `foo.js|jquery`.
    [['foo.js', 'jquery', 'foo.js'], false],
    [['jquery', 'jquery.js'], true],
    [['jqu', 'ery.js'], false],
    [['jquery.j'], false]
  ])('%j → %s', (rows, expected) => {
    expect(namesJqueryFile(rows)).toBe(expected);
  });

  it('stops at a line feed only, and folds ASCII case only (PCRE `.` and `i`)', () => {
    expect(namesJqueryFile(['jquery\nx.js'])).toBe(false);
    expect(namesJqueryFile(['jquery\rx.js'])).toBe(true);
    expect(namesJqueryFile(['jquery.jſ'])).toBe(false);
  });

  it('stays linear on a row of repeated `jquery`', () => {
    const row = 'jquery'.repeat(20_000);
    const started = performance.now();
    expect(namesJqueryFile([row])).toBe(false);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe('inlinePassUnder — certain only where the live rows cannot change it', () => {
  it('is skipped under the Defer JS disable, or when one row names a jQuery file alone', () => {
    expect(inlinePassUnder(deferSet([], true))).toBe('skipped');
    expect(inlinePassUnder(deferSet(['jquery.min.js']))).toBe('skipped');
    expect(inlinePassUnder(deferSet(['foo', 'JQUERY.JS']))).toBe('skipped');
    expect(inlinePassUnder(deferSet(['/jquery-?[0-9.]*(.min|.slim|.slim.min)?.js']))).toBe(
      'skipped'
    );
  });

  it('runs when no row holds `.js` or `jquery` (nothing can pair up)', () => {
    expect(inlinePassUnder(EMPTY_EXCLUSION_SET)).toBe('runs');
    expect(inlinePassUnder(deferSet(['jqu', 'app.css', 'js', 'ery.j', '.j#s']))).toBe('runs');
  });

  // Each set below gives opposite WP Rocket outcomes depending on the live
  // rows and where the set's rows sit among them (run: served page wrapped
  // without the set).
  it.each([
    // live `foo.js`: `jquery` below it → runs; `jquery` above it → `jquery|foo.js` skips.
    [['jquery']],
    // live `a.js`: `jquery-ui` above it skips; below it → runs.
    [['jquery-ui']],
    // live `/wp-includes/js/jquery/` or `jquery-migrate`: skipped; no live rows: runs.
    [['foo.js']],
    // live `foo.js`: the second `foo.js` is dropped as a duplicate → runs;
    // no live rows: `jquery|foo.js` → skipped.
    [['jquery', 'foo.js']],
    // The external list holds `/wp-includes/js/dist/i18n.min.js`: the row is
    // dropped as its duplicate → runs; with another list: skipped.
    [['jquery', '/wp-includes/js/dist/i18n.min.js']],
    [['jquery#x', 'a.js']],
    [['.js']]
  ])('is unknown for %j', (rows) => {
    expect(inlinePassUnder(deferSet(rows))).toBe('unknown');
  });
});

describe('replayInlinePass', () => {
  const SERVED = `<script src="/a.js" data-rocket-defer defer></script><script>${wrap('jQuery(1)')}</script>`;

  it('undoes, keeps, or leaves the wrapping undetermined per the pass', () => {
    expect(replayInlinePass(SERVED, deferSet(['jquery.js']))).toEqual({
      html: '<script src="/a.js" data-rocket-defer defer></script><script>jQuery(1)</script>',
      wrapped: 1,
      unwrapped: 1,
      undetermined: 0,
      spanned: 0
    });
    expect(replayInlinePass(SERVED, deferSet(['jqu']))).toEqual({
      html: SERVED,
      wrapped: 1,
      unwrapped: 0,
      undetermined: 0,
      spanned: 0
    });
    expect(replayInlinePass(SERVED, deferSet(['foo.js']))).toEqual({
      html: SERVED,
      wrapped: 1,
      unwrapped: 0,
      undetermined: 1,
      spanned: 0
    });
  });

  it('counts nothing on a page without the wrapping', () => {
    const plain = '<script>jQuery(1)</script>';
    expect(replayInlinePass(plain, deferSet(['foo.js']))).toEqual({
      html: plain,
      wrapped: 0,
      unwrapped: 0,
      undetermined: 0,
      spanned: 0
    });
  });
});

describe('unwrapInlineScripts', () => {
  // Served by WP Rocket with no rows (wrapped), and with `jquery.js` (not wrapped).
  const SOURCE =
    '<script src="/a.js" data-rocket-defer defer></script>' +
    `<script>x.replace(/a/, "$'"); jQuery('$&')</script>` +
    '<script data-b="jQuery(2)">jQuery(2)</script>' +
    '<script data-x="a>b">jQuery(1)</script>' +
    '<script type="application/ld+json">{"a":"jQuery"}</script>' +
    '<!-- <script>jQuery(3)</script> -->' +
    '<script>jQuery(3)</script>' +
    '<SCRIPT>$(4)</SCRIPT>';
  const SERVED =
    '<script src="/a.js" data-rocket-defer defer></script>' +
    `<script>${wrap(`x.replace(/a/, "$'"); jQuery('$&')`)}</script>` +
    `<script data-b="${wrap('jQuery(2)')}">${wrap('jQuery(2)')}</script>` +
    `<script data-x="a>${wrap('b">jQuery(1)')}</script>` +
    '<script type="application/ld+json">{"a":"jQuery"}</script>' +
    `<!-- <script>${wrap('jQuery(3)')}</script> -->` +
    `<script>${wrap('jQuery(3)')}</script>` +
    `<SCRIPT>${wrap('$(4)')}</SCRIPT>`;

  it('gives every wrapped script its original back, byte for byte', () => {
    // `$'`/`$&` stay literal; the attribute copy and the `>`-in-a-value
    // match (WP Rocket's tag ends at the first `>`) come back too; the
    // commented copy WP Rocket wrapped with the live one is restored.
    expect(unwrapInlineScripts(SERVED)).toEqual({ html: SOURCE, unwrapped: 5 });
  });

  it('is the identity without the wrapper, and on the unwrapped source', () => {
    const plain = '<script>jQuery(1)</script>';
    expect(unwrapInlineScripts(plain)).toEqual({ html: plain, unwrapped: 0 });
    expect(unwrapInlineScripts(SOURCE)).toEqual({ html: SOURCE, unwrapped: 0 });
  });

  it('restores a copy page-wide, across a comment end inside the element', () => {
    // WP Rocket's `str_replace` wraps the commented copy too, although the
    // comment ends at the element's own `-->`.
    const element = (body: string): string => `<script>${body}</script>`;
    const source = `${element('jQuery(1)-->x')}<!-- ${element('jQuery(1)-->x')} -->`;
    const served = `${element(wrap('jQuery(1)-->x'))}<!-- ${element(wrap('jQuery(1)-->x'))} -->`;
    expect(unwrapInlineScripts(served)).toEqual({ html: source, unwrapped: 1 });
  });

  it('restores copies whatever later rewrites did to their opening tags', () => {
    const served =
      `<script data-wpr-fdt-excluded="delay_js">${wrap('jQuery(1)')}</script>` +
      `<!-- <script type="text/rocketlazyloadscript">${wrap('jQuery(1)')}</script> -->`;
    expect(unwrapInlineScripts(served)).toEqual({
      html:
        '<script data-wpr-fdt-excluded="delay_js">jQuery(1)</script>' +
        '<!-- <script type="text/rocketlazyloadscript">jQuery(1)</script> -->',
      unwrapped: 1
    });
  });

  it('unwraps a body whose attribute copy was left as the source wrote it', () => {
    // Not WP Rocket output (it would have wrapped the copy too): a source
    // already in wrapper form, unwrapped like any wrapped body.
    expect(unwrapInlineScripts(`<script data-b="jQuery(1)">${wrap('jQuery(1)')}</script>`)).toEqual(
      { html: '<script data-b="jQuery(1)">jQuery(1)</script>', unwrapped: 1 }
    );
  });

  it('takes off one layer of a body wrapped twice', () => {
    const once = `<script>${wrap('jQuery(3)')}</script>`;
    expect(unwrapInlineScripts(`<script>${wrap(wrap('jQuery(3)'))}</script>`)).toEqual({
      html: once,
      unwrapped: 1
    });
  });

  it.each([
    ['a body without jQuery code', `<script>${wrap('var z=1;')}</script>`],
    ['structured data', `<script type="application/ld+json">${wrap('jQuery(1)')}</script>`],
    [
      'structured data named in the body',
      `<script>${wrap('var t = "Application/LD+JSON"; jQuery(1)')}</script>`
    ],
    ['an opening without its closing', `<script>${INLINE_WRAP_OPEN}jQuery(1)</script>`],
    ['the wrapper alone', `<script>${INLINE_WRAP_OPEN}${INLINE_WRAP_CLOSE}</script>`],
    ['a script inside a comment only', `<!-- <script>${wrap('jQuery(1)')}</script> -->`]
  ])('leaves %s as served', (_label, html) => {
    expect(unwrapInlineScripts(html)).toEqual({ html, unwrapped: 0 });
  });
});

describe('a wrapper spanning scripts (an end tag WP Rocket does not end at, rewritten by Delay JS)', () => {
  // WP Rocket's served page for `<script id="i1">jQuery(1)</script >` + an
  // empty `foo.js` script, through Delay JS: the wrapper opens in i1 and
  // closes in f; the source can no longer be told from the page.
  const tag = (attributes: string): string =>
    `<script type="text/rocketlazyloadscript"${attributes}>`;
  const SPLIT =
    `${tag(' id="i1"')}${INLINE_WRAP_OPEN}jQuery(1)</script>\n` +
    `${tag(' data-rocket-src="/f.js" id="f" data-rocket-defer defer')}${INLINE_WRAP_CLOSE}</script>`;
  const WHOLE = `<script id="w">${wrap('jQuery(2)')}</script>`;

  it('leaves it as served and undetermined unless the pass runs', () => {
    for (const rows of [['jquery.min.js'], ['foo.js']]) {
      // Both scripts are left as served: i1, and f holding the closing (f
      // is deferred: Defer JS counts it as a candidate already).
      expect(replayInlinePass(SPLIT, deferSet(rows))).toEqual({
        html: SPLIT,
        wrapped: 1,
        unwrapped: 0,
        undetermined: 2,
        spanned: 2
      });
    }
    expect(replayInlinePass(SPLIT, deferSet([]))).toEqual({
      html: SPLIT,
      wrapped: 1,
      unwrapped: 0,
      undetermined: 0,
      spanned: 0
    });
  });

  it('still undoes the whole wrappers the span cannot reach', () => {
    // A later opening sits between this wrapper and the closing: read back.
    expect(replayInlinePass(`${WHOLE}${SPLIT}`, deferSet(['jquery.min.js']))).toEqual({
      html: `<script id="w">jQuery(2)</script>${SPLIT}`,
      wrapped: 2,
      unwrapped: 1,
      undetermined: 2,
      spanned: 2
    });
  });

  it('treats a whole wrapper followed by the closing alone as spanning', () => {
    // Its body may be the opener's own body ending in `});` plus the next
    // script's empty body: two sources, one served page.
    const page = `${WHOLE}<script src="/f.js">${INLINE_WRAP_CLOSE}</script>`;
    // The closing's script is not deferred: it counts as wrapped too.
    expect(replayInlinePass(page, deferSet(['jquery.min.js']))).toEqual({
      html: page,
      wrapped: 2,
      unwrapped: 0,
      undetermined: 2,
      spanned: 2
    });
    expect(hasSpanningWrapper(page)).toBe(true);
  });

  it('keeps an identical whole wrapper elsewhere wrapped too (bodies are undone by text)', () => {
    const page = `${WHOLE}${WHOLE}<script>${INLINE_WRAP_CLOSE}</script>`;
    expect(replayInlinePass(page, deferSet(['jquery.min.js']))).toMatchObject({
      html: page,
      wrapped: 3,
      unwrapped: 0,
      undetermined: 3,
      spanned: 3
    });
  });

  it('reads a whole wrapper back when the next script has a body of its own (the named limit)', () => {
    // `$.ajax({});` is not jQuery code to WP Rocket, and ends in `});` on its own.
    const page = `${WHOLE}<script>$.ajax({});</script>`;
    expect(hasSpanningWrapper(page)).toBe(false);
    expect(replayInlinePass(page, deferSet(['jquery.min.js'])).unwrapped).toBe(1);
  });

  it('counts a wrapper opening without jQuery code only when it may span', () => {
    const opening = `<script>${wrap('var z=1;')}</script>`;
    expect(replayInlinePass(opening, deferSet(['jquery.min.js'])).wrapped).toBe(0);
    const page = `${opening}<script>${INLINE_WRAP_CLOSE}</script>`;
    expect(replayInlinePass(page, deferSet(['jquery.min.js']))).toMatchObject({
      wrapped: 2,
      undetermined: 2,
      spanned: 2
    });
  });

  it('is left as served by unwrapInlineScripts', () => {
    expect(unwrapInlineScripts(SPLIT)).toEqual({ html: SPLIT, unwrapped: 0 });
    expect(unwrapInlineScripts(`${WHOLE}${SPLIT}`)).toEqual({
      html: `<script id="w">jQuery(2)</script>${SPLIT}`,
      unwrapped: 1
    });
  });

  it('takes the closing to sit in the first script after the opening that ends like it', () => {
    const opening = `<script id="o">${INLINE_WRAP_OPEN}jQuery(1)</script>`;
    const page = `${opening}<script id="p">var a;</script><script id="c">b();});</script><script id="d">e();});</script>`;
    // o and c are left as served (and counted); p never ends like the
    // closing, d comes after the closing was taken.
    expect(replayInlinePass(page, deferSet(['jquery.min.js']))).toEqual({
      html: page,
      wrapped: 2,
      unwrapped: 0,
      undetermined: 2,
      spanned: 2
    });
    // With the live rows deciding, the same two are undetermined.
    expect(replayInlinePass(page, deferSet(['foo.js']))).toMatchObject({ undetermined: 2 });
    // Another opening ends the search: its closing is its own.
    const twice = `${opening}${opening.replace('"o"', '"q"')}<script>${INLINE_WRAP_CLOSE}</script>`;
    expect(replayInlinePass(twice, deferSet(['jquery.min.js']))).toMatchObject({
      wrapped: 3,
      undetermined: 3
    });
  });

  it('is found outside comments only', () => {
    const commented = `<!-- <script>${INLINE_WRAP_OPEN}jQuery(1)</script> -->`;
    expect(hasSpanningWrapper(commented)).toBe(false);
    expect(hasSpanningWrapper(SPLIT)).toBe(true);
    expect(hasSpanningWrapper(WHOLE)).toBe(false);
  });
});

describe('spanningWrapperReading', () => {
  it('drops the opening at the start, else the closing at the end after an opening', () => {
    expect(spanningWrapperReading(`${INLINE_WRAP_OPEN}jQuery(1)`, false)).toBe('jQuery(1)');
    expect(spanningWrapperReading(wrap('jQuery(1)'), true)).toBe(`jQuery(1)${INLINE_WRAP_CLOSE}`);
    expect(spanningWrapperReading(`b()${INLINE_WRAP_CLOSE}`, true)).toBe('b()');
    expect(spanningWrapperReading(`b()${INLINE_WRAP_CLOSE}`, false)).toBeNull();
    expect(spanningWrapperReading('b()', true)).toBeNull();
  });
});
