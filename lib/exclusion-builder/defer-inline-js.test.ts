/**
 * WP Rocket's Defer JS inline-jQuery pass: when its joined exclusion text
 * turns the pass off, when that is certain without the live rows, and
 * undoing the wrapping it served. Expected values are WP Rocket 3.23.5.1's
 * own (`DeferJS::defer_inline_js` run on these inputs, PHP 8.1 / PCRE2 10.49).
 */
import { describe, expect, it } from 'vitest';
import { INLINE_WRAP_CLOSE, INLINE_WRAP_OPEN } from '../wp-rocket/constants';
import {
  inlinePassUnder,
  namesJqueryFile,
  replayInlinePass,
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

  it('runs when no row holds `.js` (nothing can complete a `jquery`)', () => {
    expect(inlinePassUnder(EMPTY_EXCLUSION_SET)).toBe('runs');
    expect(inlinePassUnder(deferSet(['jquery', 'jquery-migrate', 'app.css', 'js']))).toBe('runs');
  });

  // Each set below gives opposite WP Rocket outcomes depending on the live
  // rows (run: live rows + these rows, served page wrapped without them).
  it.each([
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
      undetermined: 0
    });
    expect(replayInlinePass(SERVED, deferSet(['jquery']))).toEqual({
      html: SERVED,
      wrapped: 1,
      unwrapped: 0,
      undetermined: 0
    });
    expect(replayInlinePass(SERVED, deferSet(['foo.js']))).toEqual({
      html: SERVED,
      wrapped: 1,
      unwrapped: 0,
      undetermined: 1
    });
  });

  it('counts nothing on a page without the wrapping', () => {
    const plain = '<script>jQuery(1)</script>';
    expect(replayInlinePass(plain, deferSet(['foo.js']))).toEqual({
      html: plain,
      wrapped: 0,
      unwrapped: 0,
      undetermined: 0
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
