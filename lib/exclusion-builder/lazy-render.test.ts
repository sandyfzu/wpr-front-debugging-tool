/**
 * The Automatic Lazy Rendering transform: rows are LITERAL,
 * ASCII-case-insensitive substrings of the opening tag WP Rocket's hash pass
 * saw (re-serialized, stamp-free, no end tag); a match excludes the element's
 * subtree; the rewrite removes the lazyrender attribute, and the
 * feature-wide disable de-stamps every element and removes the inline CSS
 * block only — the plugin serves no runner script for this feature.
 */
import { describe, expect, it } from 'vitest';
import { lazyRenderTransform } from './lazy-render';
import { ExclusionValidationError } from './errors';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from './set';

function setWithRows(rows: string[], disableLazyRender = false): ExclusionSet {
  return {
    rows: { ...EMPTY_EXCLUSION_SET.rows, lazyRender: rows },
    disable: { ...EMPTY_EXCLUSION_SET.disable, lazyRender: disableLazyRender }
  };
}

const STYLED_PAGE = `<html><head><style id="rocket-lazyrender-inline-css">[data-wpr-lazyrender] {content-visibility: auto;}</style></head><body><div data-wpr-lazyrender="1" class="pagination"><ul class='page-numbers'><li>1</li></ul></div></body></html>`;

describe('lazyRenderTransform — identity arms', () => {
  it('is the identity when no element carries the lazyrender attribute', () => {
    const html = '<div class="plain"><p>content</p></div>';
    const result = lazyRenderTransform(html, setWithRows(['pagination']));
    expect(result.html).toBe(html);
    expect(result.report).toEqual({
      feature: 'automatic_lazy_rendering',
      featureWide: false,
      candidates: 0,
      rewritten: 0,
      regionRemovals: 0,
      matchedRows: [],
      unmatchedRows: ['pagination']
    });
  });

  it('is the identity for an empty set and an empty document', () => {
    const stamped = '<div data-wpr-lazyrender="1">x</div>';
    const emptySet = lazyRenderTransform(stamped, EMPTY_EXCLUSION_SET);
    expect(emptySet.html).toBe(stamped);
    expect(emptySet.report.candidates).toBe(1);
    expect(emptySet.report.rewritten).toBe(0);
    expect(lazyRenderTransform('', setWithRows(['x'])).html).toBe('');
  });
});

describe('lazyRenderTransform — de-stamping a matched element', () => {
  it('matches the opening tag and removes the attribute', () => {
    const html =
      '<section data-wpr-lazyrender="1" class="below-fold"><p>deep child text</p></section>';
    const result = lazyRenderTransform(html, setWithRows(['below-fold']));
    expect(result.html).toBe(
      '<section class="below-fold" data-wpr-fdt-excluded="automatic_lazy_rendering"><p>deep child text</p></section>'
    );
    expect(result.report).toEqual({
      feature: 'automatic_lazy_rendering',
      featureWide: false,
      candidates: 1,
      rewritten: 1,
      regionRemovals: 0,
      matchedRows: [{ row: 'below-fold', rowKind: 'literal', matches: 1 }],
      unmatchedRows: []
    });
  });

  it('never matches an end tag — WP Rocket cuts the element at its first `>`', () => {
    const html = '<div data-wpr-lazyrender="1" class="a"><p>x</p></div>';
    expect(lazyRenderTransform(html, setWithRows(['></div>'])).report.rewritten).toBe(0);
    expect(lazyRenderTransform(html, setWithRows(['</div>'])).report.rewritten).toBe(0);
    // A row anchored at the opening tag's own closing bracket matches.
    expect(lazyRenderTransform(html, setWithRows(['class="a">'])).report.rewritten).toBe(1);
  });

  it('matches the tag as WP Rocket saw it — the stamp it added later is not part of it', () => {
    const html = '<img src="a.jpg" data-wpr-lazyrender="1">';
    expect(lazyRenderTransform(html, setWithRows(['></img>'])).report.rewritten).toBe(0);
    expect(lazyRenderTransform(html, setWithRows(['lazyrender="1">'])).report.rewritten).toBe(0);
    expect(lazyRenderTransform(html, setWithRows(['src="a.jpg">'])).report.rewritten).toBe(1);
  });

  it('does not match a row naming the child content — the match target is child-cleared', () => {
    const html = '<div data-wpr-lazyrender="1"><span>child-token</span></div>';
    const result = lazyRenderTransform(html, setWithRows(['child-token']));
    expect(result.report.rewritten).toBe(0);
    expect(result.html).toBe(html);
  });

  it('never interprets a row as a regular expression — metacharacters are literal', () => {
    const html = '<div data-wpr-lazyrender="1" class="pagination"><span>1</span></div>';
    // '(pagination|alternate)' is tested as literal text — it appears verbatim nowhere.
    expect(
      lazyRenderTransform(html, setWithRows(['(pagination|alternate)'])).report.rewritten
    ).toBe(0);
    expect(
      lazyRenderTransform(html, setWithRows(['<div class="pagination">'])).report.rewritten
    ).toBe(1);
  });

  it('preserves other attributes and keeps nested stamped elements independent', () => {
    const html =
      '<div data-wpr-lazyrender="1" class="outer"><div data-wpr-lazyrender="1" class="inner"><p>x</p></div></div>';
    const result = lazyRenderTransform(html, setWithRows(['class="inner']));
    expect(result.html).toBe(
      '<div data-wpr-lazyrender="1" class="outer"><div class="inner" data-wpr-fdt-excluded="automatic_lazy_rendering"><p>x</p></div></div>'
    );
    expect(result.report.candidates).toBe(2);
    expect(result.report.rewritten).toBe(1);
  });

  it('strips every occurrence of a duplicated element on a row match', () => {
    const html =
      '<div data-wpr-lazyrender="1" class="pagination">a</div><div data-wpr-lazyrender="1" class="pagination">b</div>';
    const result = lazyRenderTransform(html, setWithRows(['pagination']));
    expect(result.report.candidates).toBe(2);
    expect(result.report.rewritten).toBe(2);
    expect(result.html.match(/data-wpr-fdt-excluded="automatic_lazy_rendering"/g)?.length).toBe(2);
  });
});

describe('lazyRenderTransform — feature-wide disable', () => {
  it('de-stamps every element and removes the inline CSS block — nothing else', () => {
    const html = [
      '<html><head>',
      '<style id="rocket-lazyrender-inline-css">[data-wpr-lazyrender] {content-visibility: auto;}</style>',
      '<style id="other-css">body {color: red}</style>',
      '</head><body>',
      '<div data-wpr-lazyrender="1" class="a"><p>keep</p></div>',
      '<section data-wpr-lazyrender="1">b</section>',
      '<script>document.querySelectorAll("[data-wpr-lazyrender]").forEach(e => e.removeAttribute("data-wpr-lazyrender"));</script>',
      '<script>ordinary();</script>',
      '</body></html>'
    ].join('');
    const result = lazyRenderTransform(html, setWithRows([], true));
    expect(result.report).toEqual({
      feature: 'automatic_lazy_rendering',
      featureWide: true,
      candidates: 2,
      rewritten: 2,
      regionRemovals: 1,
      matchedRows: [],
      unmatchedRows: []
    });
    expect(result.html).not.toContain('rocket-lazyrender-inline-css');
    // The stamps are gone, but the page's own script naming the attribute survives —
    // the disable removes no scripts.
    expect(result.html).toContain('removeAttribute("data-wpr-lazyrender")');
    expect(result.html).toContain('<style id="other-css">body {color: red}</style>');
    expect(result.html).toContain('<p>keep</p>');
    expect(result.html).toContain('<script>ordinary();</script>');
    expect(result.html.match(/data-wpr-fdt-excluded="automatic_lazy_rendering"/g)?.length).toBe(2);
  });

  it('rejects an empty row next to others on a disabled feature — but never compiles literal rows', () => {
    expect(() => lazyRenderTransform(STYLED_PAGE, setWithRows(['', 'x'], true))).toThrow(
      ExclusionValidationError
    );
    // A lone empty row is WP Rocket's own no-op, not a problem.
    expect(() => lazyRenderTransform(STYLED_PAGE, setWithRows([''], true))).not.toThrow();
    // Regex metacharacters are plain text for a literal feature.
    expect(() => lazyRenderTransform(STYLED_PAGE, setWithRows(['(bad['], true))).not.toThrow();
  });
});

describe('lazyRenderTransform — matching details', () => {
  it('folds ASCII case only, and tolerates the attribute spelling in the doc', () => {
    const html = '<DIV DATA-WPR-LAZYRENDER="1" CLASS="pagination">x</DIV>';
    // PCRE's `i` without `u`: A–Z fold, both ways.
    const result = lazyRenderTransform(html, setWithRows(['CLASS="pagination"']));
    expect(result.report.rewritten).toBe(1);
    expect(lazyRenderTransform(html, setWithRows(['class="PAGINATION"'])).report.rewritten).toBe(1);
    const accented = '<div data-wpr-lazyrender="1" class="été">x</div>';
    expect(lazyRenderTransform(accented, setWithRows(['ÉTÉ'])).report.rewritten).toBe(0);
    expect(lazyRenderTransform(accented, setWithRows(['été'])).report.rewritten).toBe(1);
  });

  it('preserves the doctype and passes non-ASCII and lone surrogates through unchanged', () => {
    const html = `<!doctype html><div data-wpr-lazyrender="1" class="préférences">\uD800</div>`;
    const result = lazyRenderTransform(html, setWithRows(['préférences']));
    expect(result.html.startsWith('<!doctype html>')).toBe(true);
    expect(result.html).toContain('class="préférences"');
    expect(result.html).toContain('\uD800');
  });
});

describe('lazyRenderTransform — WP Rocket hash-pass semantics', () => {
  const PAGE = [
    '<html><head><meta charset="utf-8"></head><body>',
    '<div data-wpr-lazyrender="1" id="outer"><div data-wpr-lazyrender="1" id="inner">x</div></div>',
    `<div CLASS='Hero' id="hero"><div data-wpr-lazyrender="1" id="hero-child">y</div></div>`,
    '<div data-wpr-lazyrender="1" id="last">z</div>',
    '</body></html>'
  ].join('');

  it("excludes a matched element's whole subtree, counted for the outermost match's row", () => {
    const result = lazyRenderTransform(PAGE, setWithRows(['zzz', 'id="outer"', 'id="inner"']));
    expect(result.html).toContain('<div id="outer" data-wpr-fdt-excluded');
    expect(result.html).toContain('<div id="inner" data-wpr-fdt-excluded');
    expect(result.html).toContain('<div data-wpr-lazyrender="1" id="last">');
    expect(result.report.matchedRows).toEqual([
      { row: 'id="outer"', rowKind: 'literal', matches: 2 }
    ]);
    expect(result.report.unmatchedRows).toEqual(['zzz', 'id="inner"']);
  });

  it('matches an unstamped ancestor by its re-serialized tag, never as written', () => {
    // libxml serializes `CLASS='Hero'` as `class="Hero"`; WP Rocket never hashes
    // the hero itself, but a row matching it still skips its child.
    expect(lazyRenderTransform(PAGE, setWithRows(['class="Hero"'])).report.matchedRows).toEqual([
      { row: 'class="Hero"', rowKind: 'literal', matches: 1 }
    ]);
    expect(lazyRenderTransform(PAGE, setWithRows(["class='Hero'"])).report.rewritten).toBe(0);
  });

  it('ignores a lone empty or "0" row, and rejects an empty row next to others as match-all', () => {
    expect(lazyRenderTransform(PAGE, setWithRows([''])).report.rewritten).toBe(0);
    expect(lazyRenderTransform(PAGE, setWithRows(['0'])).report.rewritten).toBe(0);
    let caught: unknown = null;
    try {
      lazyRenderTransform(PAGE, setWithRows(['0', '']));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ExclusionValidationError);
    expect((caught as ExclusionValidationError).invalid).toEqual([
      expect.objectContaining({ index: 1, row: '', problem: 'match-all' })
    ]);
  });
});
