/**
 * The Automatic Lazy Rendering transform: rows are LITERAL substrings of
 * the child-cleared markup (the opening tag plus its end tag; void elements
 * have none), the rewrite removes the lazyrender attribute, and the
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
  it('matches the child-cleared markup (opening tag + end tag) and removes the attribute', () => {
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

  it('matches rows anchored at the closing bracket — the clone serializes with its end tag', () => {
    const html = '<div data-wpr-lazyrender="1" class="a"><p>x</p></div>';
    const result = lazyRenderTransform(html, setWithRows(['></div>']));
    expect(result.report.rewritten).toBe(1);
  });

  it('does not fabricate an end tag for a void element', () => {
    const html = '<img src="a.jpg" data-wpr-lazyrender="1">';
    expect(lazyRenderTransform(html, setWithRows(['></img>'])).report.rewritten).toBe(0);
    // A row anchored at the tag's own closing bracket still matches.
    expect(lazyRenderTransform(html, setWithRows(['lazyrender="1">'])).report.rewritten).toBe(1);
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
      lazyRenderTransform(html, setWithRows(['data-wpr-lazyrender="1" class="pagination"'])).report
        .rewritten
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

  it('rejects an empty row of a disabled feature — but never compiles literal rows', () => {
    expect(() => lazyRenderTransform(STYLED_PAGE, setWithRows([''], true))).toThrow(
      ExclusionValidationError
    );
    // Regex metacharacters are plain text for a literal feature.
    expect(() => lazyRenderTransform(STYLED_PAGE, setWithRows(['(bad['], true))).not.toThrow();
  });
});

describe('lazyRenderTransform — matching details', () => {
  it('is case-sensitive in row values and tolerant of the attribute spelling in the doc', () => {
    const html = '<DIV DATA-WPR-LAZYRENDER="1" CLASS="pagination">x</DIV>';
    // The scanner lowercases names; the row value matches case-sensitively.
    const result = lazyRenderTransform(html, setWithRows(['CLASS="pagination"']));
    expect(result.report.rewritten).toBe(1);
    expect(lazyRenderTransform(html, setWithRows(['class="pagination"'])).report.rewritten).toBe(0);
  });

  it('preserves the doctype and passes non-ASCII and lone surrogates through unchanged', () => {
    const html = `<!doctype html><div data-wpr-lazyrender="1" class="préférences">\uD800</div>`;
    const result = lazyRenderTransform(html, setWithRows(['préférences']));
    expect(result.html.startsWith('<!doctype html>')).toBe(true);
    expect(result.html).toContain('class="préférences"');
    expect(result.html).toContain('\uD800');
  });
});
