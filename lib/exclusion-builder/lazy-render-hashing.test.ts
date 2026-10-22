/**
 * The mirror of WP Rocket's lazy-render hash pass. Each served page below
 * is what the real plugin served (WP Rocket 3.23.5.1, libxml 2.9.13, every
 * hash recorded below the fold — the K.2 harness), and each expected
 * excluded / re-keyed list is what the real plugin produced for the rows.
 */
import { describe, expect, it } from 'vitest';
import { FDT_EXCLUDED_RESOURCE } from '../wp-rocket/constants';
import { scanTags, scanTokens } from './html-scan';
import { lazyRenderTransform } from './lazy-render';
import { analyzeLazyRender, isLazyRenderStamped, lazyRenderRekeyed } from './lazy-render-hashing';
import { EMPTY_EXCLUSION_SET } from './set';
import { findAttribute } from './tag-edit';

const UTF8_HEAD = '<html><head><meta charset="utf-8"></head><body>\n';
const NO_CHARSET_HEAD = '<html><head></head><body>\n';
const TAIL = '\n</body></html>';

/** The ids of tags (the fixtures give every element one). */
const ids = (
  tags: readonly { readonly attrs: readonly { name: string; value: string | null }[] }[]
) => tags.map((tag) => tag.attrs.find((attr) => attr.name === 'id')?.value ?? '?');

/** What the engine excludes and re-keys for `rows` on a served page. */
function outcome(
  served: string,
  rows: readonly string[]
): { excluded: string[]; rekeyed: string[] | null } {
  const set = { ...EMPTY_EXCLUSION_SET, rows: { ...EMPTY_EXCLUSION_SET.rows, lazyRender: rows } };
  const html = lazyRenderTransform(served, set).html;
  const excluded = scanTags(html).filter((tag) => findAttribute(tag, FDT_EXCLUDED_RESOURCE));
  const rekeyed = lazyRenderRekeyed(served, rows);
  return { excluded: ids(excluded), rekeyed: rekeyed === null ? null : ids(rekeyed) };
}

describe('lazy-render hash pass — traversal (real WP Rocket outcomes)', () => {
  it('walks three levels, skips a matched subtree, and re-keys every later hashed element', () => {
    const served = `${UTF8_HEAD}<div data-wpr-lazyrender="1" id="a"><div data-wpr-lazyrender="1" id="b"><div data-wpr-lazyrender="1" id="c"><div id="d">x</div></div></div></div><div data-wpr-lazyrender="1" id="e">x</div>${TAIL}`;
    expect(outcome(served, ['id="b"'])).toEqual({ excluded: ['b', 'c'], rekeyed: ['e'] });
    expect(outcome(served, ['id="e"'])).toEqual({ excluded: ['e'], rekeyed: [] });
    expect(outcome(served, ['zzz'])).toEqual({ excluded: [], rekeyed: [] });
  });

  it('closes an open `<p>` at a `<div>`, as libxml does', () => {
    const served = `${UTF8_HEAD}<div data-wpr-lazyrender="1" id="a"><p id="p">t<div data-wpr-lazyrender="1" id="b">x</div></p></div><div data-wpr-lazyrender="1" id="e">x</div>${TAIL}`;
    expect(outcome(served, ['id="a"'])).toEqual({ excluded: ['a', 'b'], rekeyed: ['e'] });
  });

  it('closes a heading at a `<p>`, so a later `<div>` is the outer element’s child', () => {
    const served = `${UTF8_HEAD}<div data-wpr-lazyrender="1" id="a"><h2 id="h">t<p id="p">u</p><div data-wpr-lazyrender="1" id="b">x</div></h2></div><div data-wpr-lazyrender="1" id="e">x</div>${TAIL}`;
    expect(outcome(served, ['id="b"'])).toEqual({ excluded: ['b'], rekeyed: ['e'] });
  });

  it('ignores an end tag that cannot close past a higher-priority element (`</a>` over a `<div>`)', () => {
    // `</a>` is ignored and the next `</div>` closes `b`: `c` lands inside the
    // anchor, which the walk never enters — a row naming it changes nothing.
    const served = `${UTF8_HEAD}<div data-wpr-lazyrender="1" id="a"><a id="x"><div id="b">x</a></div><div id="c">y</div></div><div data-wpr-lazyrender="1" id="e">x</div>${TAIL}`;
    expect(outcome(served, ['id="c"'])).toEqual({ excluded: [], rekeyed: [] });
  });

  it('nests under libxml’s non-void HTML5 elements (`<source>`)', () => {
    const served = `${UTF8_HEAD}<div data-wpr-lazyrender="1" id="a"><source id="s"><div id="b">x</div></div><div data-wpr-lazyrender="1" id="e">x</div>${TAIL}`;
    expect(outcome(served, ['id="b"'])).toEqual({ excluded: [], rekeyed: [] });
  });

  it('skips an element holding an SVG `<use>`, and stops at tags it does not process', () => {
    const withUse = `${UTF8_HEAD}<div id="a"><svg id="v"><use href="#i"></use></svg><div id="b">x</div></div><div data-wpr-lazyrender="1" id="e">x</div>${TAIL}`;
    expect(outcome(withUse, ['id="a"'])).toEqual({ excluded: [], rekeyed: [] });
    const nav = `${UTF8_HEAD}<nav id="n"><div id="b">x</div></nav><div data-wpr-lazyrender="1" id="e">x</div>${TAIL}`;
    expect(outcome(nav, ['id="n"'])).toEqual({ excluded: [], rekeyed: [] });
  });

  it('stops hashing at 200 elements', () => {
    const divs = Array.from({ length: 202 }, (_, index) =>
      index < 200
        ? `<div data-wpr-lazyrender="1" id="d${String(index)}">x</div>`
        : `<div id="d${String(index)}">x</div>`
    ).join('');
    const { excluded, rekeyed } = outcome(`${UTF8_HEAD}${divs}${TAIL}`, ['id="d0"']);
    expect(excluded).toEqual(['d0']);
    expect(rekeyed).toEqual(Array.from({ length: 199 }, (_, index) => `d${String(index + 1)}`));
  });
});

describe('lazy-render hash pass — subjects (real WP Rocket outcomes)', () => {
  it('matches an unhashed ancestor by its decoded serialization', () => {
    const served = `${UTF8_HEAD}<div id="a" title="&eacute;"><div data-wpr-lazyrender="1" id="b">x</div></div><div data-wpr-lazyrender="1" id="e">x</div>${TAIL}`;
    // `a` is never hashed (libxml re-serializes `&eacute;`) but still counts.
    expect(outcome(served, ['title="é"'])).toEqual({ excluded: ['b'], rekeyed: ['e'] });
    expect(outcome(served, ['&eacute;'])).toEqual({ excluded: [], rekeyed: [] });
  });

  it('reads a page without a charset as Latin-1: UTF-8 text never matches, its byte spelling does', () => {
    const served = `${NO_CHARSET_HEAD}<div id="a" class="été"><div data-wpr-lazyrender="1" id="b">x</div></div><div data-wpr-lazyrender="1" id="e">x</div>${TAIL}`;
    expect(outcome(served, ['été'])).toEqual({ excluded: [], rekeyed: [] });
    expect(outcome(served, ['Ã©'])).toEqual({ excluded: ['b'], rekeyed: ['e'] });
  });

  it('treats a lone empty or "0" row as no row at all', () => {
    const served = `${UTF8_HEAD}<div data-wpr-lazyrender="1" id="a">x</div><div data-wpr-lazyrender="1" id="e">x</div>${TAIL}`;
    expect(lazyRenderRekeyed(served, [''])).toEqual([]);
    expect(lazyRenderRekeyed(served, ['0'])).toEqual([]);
    // Next to other rows the empty row matches everything: nothing stays hashed.
    expect(lazyRenderRekeyed(served, ['', 'zzz'])).toEqual([]);
  });
});

describe('lazy-render hash pass — rebuilt-model limits', () => {
  it('reports the re-keying unknown when a stamped element is beyond the modelled walk', () => {
    // Four levels deep (a raised `rocket_lrc_depth`) or after `</body>`: the
    // count order of this page cannot be rebuilt.
    const deep = `${UTF8_HEAD}<div data-wpr-lazyrender="1" id="a"><div id="b"><div id="c"><div data-wpr-lazyrender="1" id="d">x</div></div></div></div>${TAIL}`;
    expect(lazyRenderRekeyed(deep, ['id="a"'])).toBeNull();
    const afterBody = `${UTF8_HEAD}<div data-wpr-lazyrender="1" id="a">x</div></body><div data-wpr-lazyrender="1" id="z">y</div></html>`;
    expect(lazyRenderRekeyed(afterBody, ['zzz'])).toBeNull();
    // Exclusion still follows each stamped element's own ancestry.
    expect(outcome(deep, ['id="a"']).excluded).toEqual(['a', 'd']);
  });

  it('walks a fragment without `<body>` from the document', () => {
    const fragment =
      '<div data-wpr-lazyrender="1" id="a"><div data-wpr-lazyrender="1" id="b">x</div></div><div data-wpr-lazyrender="1" id="c">y</div>';
    expect(outcome(fragment, ['id="a"'])).toEqual({ excluded: ['a', 'b'], rekeyed: ['c'] });
  });

  it('removes a stamp it did not place itself as an attribute', () => {
    const served = `${UTF8_HEAD}<div id="a" data-wpr-lazyrender="1" class="k">x</div>${TAIL}`;
    const analysis = analyzeLazyRender(served, scanTokens(served), ['id="a" class="k">']);
    const tag = scanTags(served).find(isLazyRenderStamped);
    expect(tag).toBeDefined();
    if (tag !== undefined) expect(analysis.verdict(tag)).toEqual({ kind: 'excluded', row: 0 });
  });

  it('reports an element whose ancestor cannot be re-serialized as undetermined, never kept', () => {
    // An unknown charset makes the non-ASCII ancestor's serialization unknown.
    const served = `<html><head><meta charset="windows-1252"></head><body>\n<div id="a" class="é"><div data-wpr-lazyrender="1" id="b">x</div></div><div data-wpr-lazyrender="1" id="c">y</div>${TAIL}`;
    const set = (rows: string[]) => ({
      ...EMPTY_EXCLUSION_SET,
      rows: { ...EMPTY_EXCLUSION_SET.rows, lazyRender: rows }
    });
    const unknown = lazyRenderTransform(served, set(['class']));
    expect(unknown.report.rewritten).toBe(0);
    expect(unknown.report.undetermined).toBe(1);
    expect(lazyRenderRekeyed(served, ['class'])).toBeNull();
    // A known match below the unknown ancestor still decides.
    expect(outcome(served, ['id="b"']).excluded).toEqual(['b']);
  });

  it('decides with the rows inert even when a tag cannot be re-serialized', () => {
    const served = `${UTF8_HEAD}<div id="a" title="a&#1;b"><div data-wpr-lazyrender="1" id="b">x</div></div>${TAIL}`;
    expect(outcome(served, ['0'])).toEqual({ excluded: [], rekeyed: [] });
    expect(outcome(served, ['zzz'])).toEqual({ excluded: [], rekeyed: null });
  });
});

describe('lazy-render hash pass — libxml serialization details (real WP Rocket outcomes)', () => {
  it('cuts a stamped element at its first `>`, even inside a raw `<!--…-->` value', () => {
    // WP Rocket matched `<main data-c="<!-- c -->` (strstr at the first `>`).
    const served = `${UTF8_HEAD}<main data-wpr-lazyrender="1" data-c="<!-- c -->" id="e0"></main>${TAIL}`;
    expect(outcome(served, ['id="e0', '">']).excluded).toEqual([]);
    expect(outcome(served, ['<!-- c --']).excluded).toEqual(['e0']);
  });

  it('matches an Alpine wrapper as libxml reads it (a bogus `@click` dropped)', () => {
    const served = `${UTF8_HEAD}<div id="w" x-data="{}" @click="go"><div data-wpr-lazyrender="1" id="a">q</div></div><div data-wpr-lazyrender="1" id="c">z</div>${TAIL}`;
    expect(outcome(served, ['x-data'])).toEqual({ excluded: ['a'], rekeyed: ['c'] });
    expect(outcome(served, ['@click'])).toEqual({ excluded: [], rekeyed: [] });
  });

  it('keeps a `.prop` binding libxml keeps', () => {
    const served = `${UTF8_HEAD}<div id='w' .prop="x"><div data-wpr-lazyrender="1" id="a">q</div></div><div data-wpr-lazyrender="1" id="c">z</div>${TAIL}`;
    expect(outcome(served, ['.prop'])).toEqual({ excluded: ['a'], rekeyed: ['c'] });
  });
});
