/**
 * The Defer JS transform: matches the effective URL (`data-rocket-src` or
 * `src`) of WP Rocket-deferred scripts (the served `data-rocket-defer`
 * marker is the candidacy gate) and strips both defer markers; a bare
 * native `defer` the plugin never stamped is not this feature's work.
 */
import { describe, expect, it } from 'vitest';
import { deferJsTransform } from './defer-js';
import { ExclusionValidationError } from './errors';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from './set';

function setWithRows(rows: string[], disableDeferJs = false): ExclusionSet {
  return {
    rows: { ...EMPTY_EXCLUSION_SET.rows, deferJs: rows },
    disable: { ...EMPTY_EXCLUSION_SET.disable, deferJs: disableDeferJs }
  };
}

const DEFERRED =
  '<script src="https://s.tld/jquery.js" id="jquery-core-js" data-rocket-defer defer></script>';
const DEFERRED_AND_DELAYED =
  '<script type="rocketlazyloadscript" data-rocket-src="https://s.tld/sentry.js" id="sentry" data-rocket-defer defer></script>';

describe('deferJsTransform — identity arms', () => {
  it('is the identity when no script carries the plugin defer marker', () => {
    const html = '<script src="native-defer.js" defer></script><script>live();</script>';
    const result = deferJsTransform(html, setWithRows(['native-defer']));
    expect(result.html).toBe(html);
    expect(result.report).toEqual({
      feature: 'defer_all_js',
      featureWide: false,
      candidates: 0,
      rewritten: 0,
      matchedRows: [],
      unmatchedRows: ['native-defer']
    });
  });

  it('is the identity for an empty set, and for an empty document', () => {
    const emptySet = deferJsTransform(DEFERRED, EMPTY_EXCLUSION_SET);
    expect(emptySet.html).toBe(DEFERRED);
    expect(emptySet.report.candidates).toBe(1);
    expect(emptySet.report.rewritten).toBe(0);
    expect(deferJsTransform('', setWithRows(['x'])).html).toBe('');
  });
});

describe('deferJsTransform — stripping the markers', () => {
  it('removes both the plugin marker and the native defer on a URL-row match', () => {
    const result = deferJsTransform(DEFERRED, setWithRows(['jquery\\.js$']));
    expect(result.html).toBe(
      '<script src="https://s.tld/jquery.js" id="jquery-core-js" data-wpr-fdt-excluded="defer_all_js"></script>'
    );
    expect(result.report).toEqual({
      feature: 'defer_all_js',
      featureWide: false,
      candidates: 1,
      rewritten: 1,
      matchedRows: [{ row: 'jquery\\.js$', rowKind: 'pattern', matches: 1 }],
      unmatchedRows: []
    });
  });

  it('matches the effective URL from `data-rocket-src` on a delayed-and-deferred script', () => {
    const result = deferJsTransform(DEFERRED_AND_DELAYED, setWithRows(['sentry\\.js']));
    expect(result.html).toBe(
      '<script type="rocketlazyloadscript" data-rocket-src="https://s.tld/sentry.js" id="sentry" data-wpr-fdt-excluded="defer_all_js"></script>'
    );
  });

  it('prefers `data-rocket-src` over `src` as the effective URL', () => {
    const html =
      '<script src="placeholder.js" data-rocket-src="real.js" data-rocket-defer="defer"></script>';
    const result = deferJsTransform(html, setWithRows(['^real\\.js$']));
    expect(result.report.rewritten).toBe(1);
  });

  it('does not match a row that only fits the surrounding tag (the URL is the match target)', () => {
    const html = '<script src="a.js" id="marker-xyz" data-rocket-defer="defer"></script>';
    const result = deferJsTransform(html, setWithRows(['marker-xyz']));
    expect(result.report.rewritten).toBe(0);
    expect(result.report.matchedRows).toEqual([]);
    expect(result.report.unmatchedRows).toEqual(['marker-xyz']);
  });

  it('leaves a script whose markers never match any row untouched', () => {
    const result = deferJsTransform(DEFERRED, setWithRows(['other\\.js']));
    expect(result.html).toBe(DEFERRED);
    expect(result.report.unmatchedRows).toEqual(['other\\.js']);
  });
});

describe('deferJsTransform — adversarial markup', () => {
  it('strips every occurrence of a duplicated script', () => {
    const html = `${DEFERRED}${DEFERRED}`;
    const result = deferJsTransform(html, setWithRows(['jquery\\.js']));
    expect(result.report.rewritten).toBe(2);
    expect(result.html.match(/data-wpr-fdt-excluded="defer_all_js"/g)?.length).toBe(2);
    expect(result.html).not.toContain('data-rocket-defer');
    expect(result.html).not.toContain(' defer');
  });

  it('survives minified single-line documents and preserves the doctype', () => {
    const html = `<!doctype html><script>live();</script>${DEFERRED}<p>tail</p>`;
    const result = deferJsTransform(html, setWithRows(['jquery\\.js']));
    expect(result.html).toContain('<!doctype html>');
    expect(result.html).not.toContain('data-rocket-defer');
    expect(result.html).toContain('live();');
  });

  it('keeps a bare native `defer` the plugin never stamped', () => {
    const html = '<script src="theme.js" defer></script>' + DEFERRED;
    const result = deferJsTransform(html, setWithRows(['(theme|jquery)\\.js']));
    // The theme's own defer survives; only the plugin-marked script is stripped.
    expect(result.html).toContain('<script src="theme.js" defer></script>');
    expect(result.report.candidates).toBe(1);
  });

  it('strips a marker-only inline script under the feature-wide disable (no URL to match)', () => {
    const html = '<script data-rocket-defer="defer">inline();</script>';
    const result = deferJsTransform(html, setWithRows([], true));
    expect(result.html).toBe('<script data-wpr-fdt-excluded="defer_all_js">inline();</script>');
  });

  it('never matches a row against a marker script without a URL (nothing to match with)', () => {
    const html = '<script data-rocket-defer="defer">inline();</script>';
    const result = deferJsTransform(html, setWithRows(['inline']));
    expect(result.html).toBe(html);
    expect(result.report).toEqual({
      feature: 'defer_all_js',
      featureWide: false,
      candidates: 1,
      rewritten: 0,
      matchedRows: [],
      unmatchedRows: ['inline']
    });
  });
});

describe('deferJsTransform — feature-wide disable', () => {
  it('strips every marker-carrying script without consulting rows', () => {
    const html = `${DEFERRED}<script src="other.js" data-rocket-defer="defer" defer></script>`;
    const result = deferJsTransform(html, setWithRows(['never'], true));
    expect(result.report).toEqual({
      feature: 'defer_all_js',
      featureWide: true,
      candidates: 2,
      rewritten: 2,
      matchedRows: [],
      unmatchedRows: []
    });
    expect(result.html).not.toContain('data-rocket-defer');
    expect(result.html).not.toContain(' defer');
  });

  it('still validates rows of a disabled feature', () => {
    expect(() => deferJsTransform(DEFERRED, setWithRows(['(bad['], true))).toThrow(
      ExclusionValidationError
    );
  });
});

describe('deferJsTransform — marker accumulation', () => {
  it('appends to an existing marker value', () => {
    const html =
      '<script src="a.js" data-rocket-defer="defer" data-wpr-fdt-excluded="delay_js"></script>';
    const result = deferJsTransform(html, setWithRows(['a\\.js']));
    expect(result.html).toContain('data-wpr-fdt-excluded="delay_js,defer_all_js"');
  });

  it('does not duplicate an id already listed', () => {
    const html =
      '<script src="a.js" data-rocket-defer="defer" data-wpr-fdt-excluded="defer_all_js"></script>';
    const result = deferJsTransform(html, setWithRows(['a\\.js']));
    expect(result.html).toContain('data-wpr-fdt-excluded="defer_all_js"');
  });
});
