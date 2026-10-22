/**
 * The Defer JS transform: matches the raw `src` value WP Rocket captured
 * (before Delay JS parked it in `data-rocket-src`) of WP Rocket-deferred
 * scripts (the served `data-rocket-defer` marker is the candidacy gate)
 * with WP Rocket's joined-row semantics, and strips both defer markers; a
 * bare native `defer` the plugin never stamped is not this feature's work.
 */
import { describe, expect, it } from 'vitest';
import { deferJsTransform, deferSubject } from './defer-js';
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
      regionRemovals: 0,
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
      regionRemovals: 0,
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

  it('reads a delayed script with two `src` as WP Rocket did: the last one fits', () => {
    // Observed: Delay renamed only the first `src`; Defer had captured the second.
    const html =
      '<script type="text/rocketlazyloadscript" data-rocket-src="real.js" src="placeholder.js" data-rocket-defer defer></script>';
    expect(deferJsTransform(html, setWithRows(['^real\\.js$'])).report.rewritten).toBe(0);
    expect(deferJsTransform(html, setWithRows(['^placeholder\\.js$'])).report.rewritten).toBe(1);
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

  it('never matches a row against a marker script without a URL: undetermined, left as served', () => {
    // WP Rocket only stamps scripts it captured a `src` from, so this one cannot be read back.
    const html = '<script data-rocket-defer="defer">inline();</script>';
    const result = deferJsTransform(html, setWithRows(['inline']));
    expect(result.html).toBe(html);
    expect(result.report).toEqual({
      feature: 'defer_all_js',
      featureWide: false,
      candidates: 1,
      rewritten: 0,
      regionRemovals: 0,
      matchedRows: [],
      unmatchedRows: ['inline'],
      undetermined: 1
    });
  });
});

describe('deferJsTransform — the subject: the raw src WP Rocket captured', () => {
  /** The ids of the scripts a run restored. */
  function restoredIds(html: string, rows: string[]): string[] {
    const out = deferJsTransform(html, setWithRows(rows)).html;
    return [...out.matchAll(/id="([^"]+)" data-wpr-fdt-excluded/g)].map((match) => match[1] ?? '');
  }

  // Served by the real DeferJS::defer_js (then DelayJS\\HTML::delay_js where delayed);
  // every expectation in this block was observed there.
  const SERVED = [
    `<script src="/it's.js" id="q" data-rocket-defer defer></script>`,
    `<script src="/a.js" title=" src='/t.js'" id="t" data-rocket-defer defer></script>`,
    `<script SRC = ' /w.js ' id="w" data-rocket-defer defer></script>`,
    '<script src="js/jquery.js" id="r" data-rocket-defer defer></script>'
  ].join('\n');

  it('never resolves a relative src against the document — the raw value only', () => {
    const absolute = ['^https://s\\.tld/page/js/jquery\\.js$'];
    expect(restoredIds(SERVED, absolute)).toEqual([]);
    expect(restoredIds(SERVED, ['^js/jquery\\.js$'])).toEqual(['r']);
  });

  it('ends the value at its first quote, as WP Rocket captures it', () => {
    expect(restoredIds(SERVED, ['s\\.js'])).toEqual([]);
    expect(restoredIds(SERVED, ['^/it$'])).toEqual(['q']);
  });

  it('takes the last `src=` that fits, even inside another attribute value', () => {
    expect(restoredIds(SERVED, ['^/t\\.js$'])).toEqual(['t']);
    expect(restoredIds(SERVED, ['^/a'])).toEqual([]);
  });

  it('keeps the whitespace around the value and reads any `src` case', () => {
    expect(restoredIds(SERVED, ['^ /w\\.js $'])).toEqual(['w']);
    expect(restoredIds(SERVED, ['^/w'])).toEqual([]);
  });

  it('reads a delayed script as WP Rocket’s Defer JS saw it, before Delay JS renamed `src`', () => {
    const delayed = [
      '<script type="text/rocketlazyloadscript" data-data-rocket-src="/q.js" src="/b.js" id="d" data-rocket-defer defer></script>',
      '<script type="text/rocketlazyloadscript" data-rocket-src="/a.js" id="x" data-rocket-defer defer></script>'
    ].join('\n');
    expect(restoredIds(delayed, ['^/q'])).toEqual([]);
    expect(restoredIds(delayed, ['^/b'])).toEqual(['d']);
    expect(restoredIds(delayed, ['^/a\\.js$'])).toEqual(['x']);
  });

  it('undoes its own stamp on a `>` inside the value (WP Rocket stamps every `>` it matched)', () => {
    const served =
      '<script src="/js/x?y= data-rocket-defer defer>1" id="a" data-rocket-defer defer></script>';
    expect(restoredIds(served, ['^/js/x\\?y=>1$'])).toEqual(['a']);
    expect(restoredIds(served, ['rocket'])).toEqual([]);
  });

  it('reads the rest of WP Rocket’s match from the body when a parser ends the tag early', () => {
    // A vertical tab is PCRE whitespace but not HTML's: the value reads unquoted, cut at its `>`.
    const served =
      '<script src=\v"/js/x?y= data-rocket-defer defer>1" id="d" data-rocket-defer defer></script>';
    const report = deferJsTransform(served, setWithRows(['x\\?y=>1'])).report;
    expect(report).toMatchObject({ candidates: 1, rewritten: 1 });
    expect(report).not.toHaveProperty('undetermined');
  });

  it('undoes Delay JS’s rename wherever its text is, not where a parser sees an attribute', () => {
    const inValue =
      '<script type="text/rocketlazyloadscript" src=/js/a.js title=" data-rocket-src=\'/t.js\'" id="b" data-rocket-defer defer></script>';
    expect(restoredIds(inValue, ['^/t\\.js$'])).toEqual(['b']);
    const afterVerticalTab =
      '<script type="text/rocketlazyloadscript" data-rocket-type="module"\vdata-rocket-src=\'module.mjs\' id="c" data-rocket-defer defer></script>';
    expect(restoredIds(afterVerticalTab, ['module\\.mjs'])).toEqual(['c']);
  });

  it('leaves a source `data-rocket-src` alone on a tag Delay JS did not rewrite', () => {
    const served =
      '<script src="/r.js" data-rocket-src="/pre.js" id="f" data-rocket-defer defer></script>';
    expect(restoredIds(served, ['^/r\\.js$'])).toEqual(['f']);
  });

  it('counts a script undetermined when its captured src cannot be read back', () => {
    // Delay JS's bare-`type` removal glued `nomodule` to the renamed `src` (WP Rocket excluded it).
    const served =
      '<script type="text/rocketlazyloadscript" nomoduledata-rocket-src="/n.js" id="e" data-rocket-defer defer></script>';
    const result = deferJsTransform(served, setWithRows(['/n\\.js']));
    expect(result.html).toBe(served);
    expect(result.report).toMatchObject({ candidates: 1, rewritten: 0, undetermined: 1 });
  });

  it('captures nothing from an unquoted src, so no row matches it', () => {
    expect(deferSubject('<script src=/u.js data-rocket-defer defer>')).toBeNull();
    expect(deferSubject('<script src="" data-rocket-defer defer>')).toBeNull();
    expect(deferSubject('<scriptx src="/a.js">')).toBeNull();
  });

  it('uses PCRE whitespace only: a no-break space is not a separator', () => {
    expect(deferSubject('<script\u00a0src="/a.js">')).toBeNull();
    expect(deferSubject('<script\vsrc="/a.js">')).toBe('/a.js');
  });
});

describe('deferJsTransform — joined-row semantics', () => {
  it('matches rows caselessly over the subject bytes, as WP Rocket’s `#…#i`', () => {
    expect(deferJsTransform(DEFERRED, setWithRows(['JQUERY\\.JS'])).report.rewritten).toBe(1);
  });

  it('credits the first matching row in list order and says the counts are best effort', () => {
    const report = deferJsTransform(DEFERRED, setWithRows(['zzz', 'jquery', '\\.js'])).report;
    expect(report.matchedRows).toEqual([{ row: 'jquery', rowKind: 'pattern', matches: 1 }]);
    expect(report.unmatchedRows).toEqual(['zzz', '\\.js']);
    expect(report.rowCountsBestEffort).toBe(true);
    // One row: its count is exact.
    expect(deferJsTransform(DEFERRED, setWithRows(['jquery'])).report).not.toHaveProperty(
      'rowCountsBestEffort'
    );
  });

  it('refuses a set WP Rocket would turn off page-wide, naming the rows', () => {
    const throws = (): unknown => deferJsTransform(DEFERRED, setWithRows(['(?<n>a)x', '(?<n>b)y']));
    expect(throws).toThrow(ExclusionValidationError);
    try {
      throws();
    } catch (error) {
      expect(
        (error as ExclusionValidationError).invalid.map(({ index, problem }) => [index, problem])
      ).toEqual([
        [0, 'joined-page-off'],
        [1, 'joined-page-off']
      ]);
    }
  });

  it('refuses rows that match differently joined, or match every script', () => {
    for (const rows of [['(?-i)zzz', 'A.JS'], ['zzz|']]) {
      expect(() => deferJsTransform(DEFERRED, setWithRows(rows)), JSON.stringify(rows)).toThrow(
        ExclusionValidationError
      );
    }
  });

  it('reports an unknown page state instead of claiming WP Rocket defers', () => {
    // Problem-free rows whose join is not modeled: the second row's open `\Q`
    // quotes into the third, whose `\E` closes it — the joined pre-check may
    // still compile, so it is not replayed. The first row still matches.
    const rows = ['jquery\\.js$', 'a\\Qb', 'c\\E'];
    const result = deferJsTransform(DEFERRED, setWithRows(rows));
    expect(result.report.pageState).toBe('unknown');
    expect(result.report.rewritten).toBe(1);
    // Feature-wide, the rows are not consulted: no page state, no count caveat.
    const wide = deferJsTransform(DEFERRED, setWithRows(rows, true)).report;
    expect(wide).not.toHaveProperty('pageState');
    expect(wide).not.toHaveProperty('rowCountsBestEffort');
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
      regionRemovals: 0,
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
    expect(result.html).toContain('data-wpr-fdt-excluded="delay_js, defer_all_js"');
  });

  it('does not duplicate an id already listed', () => {
    const html =
      '<script src="a.js" data-rocket-defer="defer" data-wpr-fdt-excluded="defer_all_js"></script>';
    const result = deferJsTransform(html, setWithRows(['a\\.js']));
    expect(result.html).toContain('data-wpr-fdt-excluded="defer_all_js"');
  });
});
