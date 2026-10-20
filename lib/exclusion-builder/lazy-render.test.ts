/**
 * The Automatic Lazy Rendering transform: rows match the child-cleared
 * outerHTML — for the string engine, the opening tag text — and the rewrite
 * removes the lazyrender attribute; the feature-wide disable de-stamps
 * every element, removes the inline CSS and the runner scripts.
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
  it('matches the opening tag (the child-cleared outerHTML) and removes the attribute', () => {
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
      matchedRows: [{ row: 'below-fold', rowKind: 'pattern', matches: 1 }],
      unmatchedRows: []
    });
  });

  it('does not match a row naming the child content — the match target is child-cleared', () => {
    const html = '<div data-wpr-lazyrender="1"><span>child-token</span></div>';
    const result = lazyRenderTransform(html, setWithRows(['child-token']));
    expect(result.report.rewritten).toBe(0);
    expect(result.html).toBe(html);
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
  it('de-stamps every element, removes the inline CSS and the runner scripts, keeps everything else', () => {
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
      matchedRows: [],
      unmatchedRows: []
    });
    expect(result.html).not.toContain('data-wpr-lazyrender');
    expect(result.html).not.toContain('rocket-lazyrender-inline-css');
    expect(result.html).toContain('<style id="other-css">body {color: red}</style>');
    expect(result.html).toContain('<p>keep</p>');
    expect(result.html).toContain('<script>ordinary();</script>');
    expect(result.html.match(/data-wpr-fdt-excluded="automatic_lazy_rendering"/g)?.length).toBe(2);
  });

  it('removes a runner script by its asset-URL marker too', () => {
    const html =
      '<body><script src="https://s.tld/wp-content/plugins/wp-rocket/assets/js/lazyrender/runner.js"></script><div data-wpr-lazyrender="1">x</div></body>';
    const result = lazyRenderTransform(html, setWithRows([], true));
    expect(result.html).not.toContain('runner.js');
    expect(result.html).toContain('<div data-wpr-fdt-excluded="automatic_lazy_rendering">');
  });

  it('still validates rows of a disabled feature', () => {
    expect(() => lazyRenderTransform(STYLED_PAGE, setWithRows(['(bad['], true))).toThrow(
      ExclusionValidationError
    );
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
