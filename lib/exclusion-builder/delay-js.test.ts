/**
 * The Delay JS transform: whole-markup matching against delayed scripts
 * (both served type variants, plus the runtime status marker), restoring
 * `type`/`src` per the controller's own runtime semantics (empty carriers
 * count as absent), stamping the exclusion marker as CSV, honest identity
 * when nothing matches, and the feature-wide disable's removal of the
 * plugin's three controller scripts.
 */
import { describe, expect, it, vi } from 'vitest';
import { delayJsTransform, delayScriptMatch, wpBodyStart } from './delay-js';
import { delayMaskedRegions } from './delay-js-mask';
import { ExclusionValidationError } from './errors';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from './set';
import { scanTags } from './html-scan';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseParityTable, type ParityRow } from './wp-rocket-parity-table';
import { ID_PROBE_LIMITS, type ProbeBudget } from './pcre/id-probe';
import type * as IdProbe from './pcre/id-probe';

/**
 * The id-probe work a transform does, observed through the real functions
 * (pass-through wrappers): each script budget handed out (`share` = its
 * steps at hand-out, `budget.left` = what is left after the run) and how
 * many row probes were compiled. Work, unlike wall clock, is the same on
 * every machine.
 */
const probeWork = {
  budgets: [] as { readonly share: number; readonly budget: ProbeBudget }[],
  compiles: 0
};

vi.mock('./pcre/id-probe', async (original) => {
  const actual = await original<typeof IdProbe>();
  return {
    ...actual,
    scriptProbeBudget: (...args: Parameters<typeof actual.scriptProbeBudget>): ProbeBudget => {
      const budget = actual.scriptProbeBudget(...args);
      probeWork.budgets.push({ share: budget.left, budget });
      return budget;
    },
    compileIdProbe: (...args: Parameters<typeof actual.compileIdProbe>) => {
      probeWork.compiles++;
      return actual.compileIdProbe(...args);
    }
  };
});

/**
 * Run `transform` with the probe work recorded from zero.
 *
 * @param transform The run to observe.
 * @returns Its result, the budgets handed out, and each one's steps spent.
 */
function withProbeWork<T>(transform: () => T): {
  readonly result: T;
  readonly shares: readonly number[];
  readonly spent: readonly number[];
  readonly compiles: number;
} {
  probeWork.budgets.length = 0;
  probeWork.compiles = 0;
  const result = transform();
  return {
    result,
    shares: probeWork.budgets.map(({ share }) => share),
    spent: probeWork.budgets.map(({ share, budget }) => share - budget.left),
    compiles: probeWork.compiles
  };
}

/** A match row of the WP Rocket parity table (outputs derived from the real plugin). */
function parityRow(id: string): Extract<ParityRow, { kind: 'match' }> {
  const table = parseParityTable(
    JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), 'wp-rocket-parity.fixtures.json'),
        'utf8'
      )
    )
  );
  const row = table.rows.find((candidate) => candidate.id === id);
  if (row?.kind !== 'match') throw new Error(`no match row ${id}`);
  return row;
}

/** A set whose Delay JS rows are replaced. */
function setWithRows(rows: string[], disableDelayJs = false): ExclusionSet {
  return {
    rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs: rows },
    disable: { ...EMPTY_EXCLUSION_SET.disable, delayJs: disableDelayJs }
  };
}

const OLD_TYPE =
  '<script type="rocketlazyloadscript" data-rocket-src="https://s.tld/wp/a.js" id="one"></script>';
const NEW_TYPE = `<script type="text/rocketlazyloadscript" data-rocket-type='text/javascript' data-rocket-src="https://s.tld/wp/b.js" id="two">
  console.log("delayed body");
</script>`;

describe('delayJsTransform — identity arms', () => {
  it('is the identity when the document carries no delayed script', () => {
    const html = '<p>plain</p><script>live();</script>';
    const result = delayJsTransform(html, setWithRows(['a.js']));
    expect(result.html).toBe(html);
    expect(result.report).toEqual({
      feature: 'delay_js',
      featureWide: false,
      candidates: 0,
      rewritten: 0,
      regionRemovals: 0,
      matchedRows: [],
      unmatchedRows: ['a.js']
    });
  });

  it('is the identity for an empty set and for an empty document', () => {
    const html = '<script type="rocketlazyloadscript" data-rocket-src="a.js"></script>';
    const emptySet = delayJsTransform(html, EMPTY_EXCLUSION_SET);
    expect(emptySet.html).toBe(html);
    expect(emptySet.report.candidates).toBe(1);
    expect(emptySet.report.rewritten).toBe(0);
    expect(delayJsTransform('', setWithRows(['a.js'])).html).toBe('');
  });
});

describe('delayJsTransform — restoring a live script', () => {
  it('restores `src` and drops the delay type when no original type was declared', () => {
    const result = delayJsTransform(OLD_TYPE, setWithRows(['a.js']));
    expect(result.html).toBe(
      '<script id="one" src="https://s.tld/wp/a.js" data-wpr-fdt-excluded="delay_js"></script>'
    );
    expect(result.report).toEqual({
      feature: 'delay_js',
      featureWide: false,
      candidates: 1,
      rewritten: 1,
      regionRemovals: 0,
      matchedRows: [{ row: 'a.js', rowKind: 'pattern', matches: 1 }],
      unmatchedRows: []
    });
  });

  it('restores the declared original type and keeps inline content and the end tag', () => {
    const result = delayJsTransform(NEW_TYPE, setWithRows(['b.js']));
    // The served delay `type` is double-quoted here — the restore keeps that
    // attribute's own quote style (the single-quoted one belongs to
    // `data-rocket-type`, which is dropped).
    expect(result.html).toBe(
      `<script type="text/javascript" id="two" src="https://s.tld/wp/b.js" data-wpr-fdt-excluded="delay_js">
  console.log("delayed body");
</script>`
    );
  });

  it('removes the type attribute entirely when the original had none (the controller sets no type)', () => {
    const html = '<script type="rocketlazyloadscript" data-rocket-src="u.js" defer></script>';
    const result = delayJsTransform(html, setWithRows(['u.js']));
    expect(result.html).toContain('<script defer src="u.js" data-wpr-fdt-excluded="delay_js">');
    expect(result.html).not.toContain('type=');
  });

  it('restores an inline delayed script (no source to move)', () => {
    const html =
      '<script type="rocketlazyloadscript" data-rocket-type="text/javascript">inline();</script>';
    const result = delayJsTransform(html, setWithRows(['inline']));
    expect(result.html).toBe(
      '<script type="text/javascript" data-wpr-fdt-excluded="delay_js">inline();</script>'
    );
  });

  it('overwrites a surviving plain `src` with the parked original', () => {
    // WP Rocket's served form of `src="real.js" src="placeholder.js"`: its
    // greedy rename parks the first and leaves the second (PHP-observed).
    const html =
      '<script type="rocketlazyloadscript" data-rocket-src="real.js" src="placeholder.js"></script>';
    const result = delayJsTransform(html, setWithRows(['real\\.js']));
    expect(result.html).toBe('<script src="real.js" data-wpr-fdt-excluded="delay_js"></script>');
    expect(result.html).not.toContain('placeholder.js');
  });

  it('treats an empty `data-rocket-type` as no original type — `type` is removed entirely', () => {
    const html =
      '<script type="rocketlazyloadscript" data-rocket-type="" data-rocket-src="u.js"></script>';
    const result = delayJsTransform(html, setWithRows(['u\\.js']));
    expect(result.html).toBe('<script src="u.js" data-wpr-fdt-excluded="delay_js"></script>');
    expect(result.html).not.toContain('type=');
  });

  it('treats an empty `data-rocket-src` as absent — kept, nothing restored from it', () => {
    const html =
      '<script type="rocketlazyloadscript" data-rocket-type="text/javascript" data-rocket-src="">inline();</script>';
    const result = delayJsTransform(html, setWithRows(['inline']));
    // The type still restores; the empty src carrier stays parked and adds no `src`.
    expect(result.html).toBe(
      '<script type="text/javascript" data-rocket-src="" data-wpr-fdt-excluded="delay_js">inline();</script>'
    );
  });

  it('counts a status-marker candidate it has nothing to restore (an already-live snapshot script)', () => {
    const html = '<script type="text/javascript" data-rocket-status="executed">live();</script>';
    const result = delayJsTransform(html, setWithRows(['live']));
    expect(result.html).toBe(html);
    expect(result.report.candidates).toBe(1);
    expect(result.report.rewritten).toBe(0);
  });
});

describe('delayJsTransform — matching', () => {
  it('matches the whole script markup: attributes, body text, and the closing tag region', () => {
    const html =
      '<script type="rocketlazyloadscript" id="marker-xyz">var payload = "unique-body-token";</script>';
    for (const row of ['marker-xyz', 'unique-body-token']) {
      const result = delayJsTransform(html, setWithRows([row]));
      expect(result.report.rewritten).toBe(1);
      expect(result.report.matchedRows).toEqual([{ row, rowKind: 'pattern', matches: 1 }]);
    }
  });

  it('does not match a sibling script — the row is tested per script, not per document', () => {
    const html = `<script type="rocketlazyloadscript" data-rocket-src="mine.js"></script><script type="rocketlazyloadscript" data-rocket-src="theirs.js"></script>`;
    const result = delayJsTransform(html, setWithRows(['theirs.js']));
    expect(result.report.candidates).toBe(2);
    expect(result.report.rewritten).toBe(1);
    expect(result.report.matchedRows[0]?.matches).toBe(1);
  });

  it('attributes a script to the first matching row only', () => {
    const html = '<script type="rocketlazyloadscript" data-rocket-src="u.js"></script>';
    const result = delayJsTransform(html, setWithRows(['u\\.js', 'u']));
    expect(result.report.matchedRows).toEqual([{ row: 'u\\.js', rowKind: 'pattern', matches: 1 }]);
    expect(result.report.unmatchedRows).toEqual(['u']);
  });

  it('reads type values case-sensitively and rows ASCII-case-insensitively, as WP Rocket does', () => {
    // Uppercase tag names scan fine; the served type value is what isDelayJSType reads.
    const upperTag = '<SCRIPT TYPE="rocketlazyloadscript" DATA-ROCKET-SRC="u.js"></SCRIPT>';
    expect(delayJsTransform(upperTag, setWithRows(['u\\.js'])).report.rewritten).toBe(1);
    // An uppercase type VALUE is not the served delay type — not a candidate.
    const upperType = '<script type="ROCKETLAZYLOADSCRIPT" data-rocket-src="u.js"></script>';
    const upperResult = delayJsTransform(upperType, setWithRows(['u\\.js']));
    expect(upperResult.report.candidates).toBe(0);
    // Rows match with WP Rocket's `i` flag: ASCII letters fold, others do not.
    expect(delayJsTransform(OLD_TYPE, setWithRows(['A.JS'])).report.rewritten).toBe(1);
    const accented = '<script type="text/rocketlazyloadscript">var t = "été";</script>';
    expect(delayJsTransform(accented, setWithRows(['ÉTÉ'])).report.rewritten).toBe(0);
    expect(delayJsTransform(accented, setWithRows(['VAR T = "été"'])).report.rewritten).toBe(1);
  });

  it('matches raw served text — served `&#038;` entities are not decoded', () => {
    const html =
      '<script type="rocketlazyloadscript" data-rocket-src="u.js?a=1&#038;b=2"></script>';
    expect(delayJsTransform(html, setWithRows(['a=1&#038;b=2'])).report.rewritten).toBe(1);
    expect(delayJsTransform(html, setWithRows(['a=1&b=2'])).report.rewritten).toBe(0);
  });
});

describe('delayJsTransform — adversarial markup', () => {
  it('restores every occurrence of a duplicated script and stamps each', () => {
    const html = `${OLD_TYPE}${OLD_TYPE}`;
    const result = delayJsTransform(html, setWithRows(['a\\.js']));
    expect(result.report.candidates).toBe(2);
    expect(result.report.rewritten).toBe(2);
    expect(result.report.matchedRows[0]?.matches).toBe(2);
    expect(result.html.match(/data-wpr-fdt-excluded="delay_js"/g)?.length).toBe(2);
  });

  it('survives minified single-line documents with several scripts', () => {
    const html = [
      '<!DOCTYPE html><html><head>',
      '<script>live();</script>',
      '<script type="rocketlazyloadscript" data-rocket-src="one.js"></script>',
      '<script type="rocketlazyloadscript" data-rocket-src="two.js"></script>',
      '</head><body></body></html>'
    ].join('');
    const result = delayJsTransform(html, setWithRows(['one\\.js', 'two\\.js']));
    expect(result.report.rewritten).toBe(2);
    expect(result.html).toContain('<!DOCTYPE html>');
    expect(result.html).not.toContain('rocketlazyloadscript');
    expect(result.html).toContain('src="one.js"');
    expect(result.html).toContain('src="two.js"');
    expect(result.html).toContain('live();');
  });

  it('reads attributes with `>` inside quoted values and restores inside an unterminated script', () => {
    const html = '<script type="rocketlazyloadscript" data-rocket-src="u.js" data-weird="a>b">';
    const result = delayJsTransform(html, setWithRows(['u\\.js']));
    expect(result.report.rewritten).toBe(1);
    expect(result.html).toContain('src="u.js"');
  });

  it('ignores scripts inside comments', () => {
    const html =
      '<!-- <script type="rocketlazyloadscript" data-rocket-src="decoy.js"></script> -->';
    const result = delayJsTransform(html, setWithRows(['decoy']));
    expect(result.report.candidates).toBe(0);
    expect(result.html).toBe(html);
  });

  it('leaves script markup WP Rocket delayed inside attribute values as served (named residual)', () => {
    // Served by WP Rocket for `data-s='<script src="/a.js"></script>'` and
    // `data-s="<script>a();</script>"` (parity harness run, PHP 8.1 and 8.4);
    // with rows `/a\.js` and `a\(\)` WP Rocket serves both values original.
    // The tokenizer reads them as attribute text: the elements are restored,
    // the copies stay as served (the double-quoted one stays broken).
    const served =
      '<script type="text/rocketlazyloadscript" data-rocket-src="/a.js" id="s1"></script>\n' +
      `<div id="d1" data-s='<script type="text/rocketlazyloadscript" data-rocket-src="/a.js"></script>'></div>\n` +
      '<div id="d2" data-s="<script type="text/rocketlazyloadscript">a();</script>"></div>\n' +
      '<script type="text/rocketlazyloadscript" data-rocket-src="/b.js" id="s2"></script>';
    const result = delayJsTransform(served, setWithRows(['/a\\.js', 'a\\(\\)']));
    expect(result.report.rewritten).toBe(1);
    const [, d1, d2] = result.html.split('\n');
    expect(d1).toBe(served.split('\n')[1]);
    expect(d2).toBe(served.split('\n')[2]);
  });

  it('leaves the copies WP Rocket delayed inside comments as served (named residual)', () => {
    // WP Rocket's Delay regex reaches commented copies (the table's served
    // page shows them delayed), so with a matching row it would leave them
    // original. A comment never runs: the engine restores elements only.
    const served = parityRow('match-delay-copy-in-comment').served;
    const result = delayJsTransform(served, setWithRows(['/a\\.js']));
    expect(result.report.rewritten).toBe(1);
    expect(result.html).toContain(
      '<!-- <script type="text/rocketlazyloadscript" data-rocket-src="/a.js"></script> -->'
    );
    expect(result.html).toContain('<script id="s1" src="/a.js"');
  });

  it('preserves the doctype byte-for-byte and passes lone surrogates through (no byte handling here)', () => {
    const html = `<!DoCtYpE html><p>\uD800surrogate</p>${OLD_TYPE}`;
    const result = delayJsTransform(html, setWithRows(['a\\.js']));
    expect(result.html.startsWith('<!DoCtYpE html><p>\uD800surrogate</p>')).toBe(true);
    expect(result.html).toContain('\uD800surrogate');
  });

  it('lets nested `<script` text inside a body stay raw text (no double match)', () => {
    const html =
      '<script type="rocketlazyloadscript" data-rocket-src="u.js">x("<script type=\\"rocketlazyloadscript\\">");</script>';
    const result = delayJsTransform(html, setWithRows(['u\\.js']));
    expect(result.report.candidates).toBe(1);
    expect(result.report.rewritten).toBe(1);
  });
});

describe('delayJsTransform — feature-wide disable', () => {
  it('restores every delayed script without consulting rows', () => {
    const html = `${OLD_TYPE}<script type="rocketlazyloadscript" data-rocket-src="zzz-other.js"></script>`;
    const result = delayJsTransform(html, setWithRows(['never-matches'], true));
    expect(result.report).toEqual({
      feature: 'delay_js',
      featureWide: true,
      candidates: 2,
      rewritten: 2,
      regionRemovals: 0,
      matchedRows: [],
      unmatchedRows: []
    });
    expect(result.html).toContain('src="https://s.tld/wp/a.js"');
    expect(result.html).toContain('src="zzz-other.js"');
    expect(result.html.match(/data-wpr-fdt-excluded="delay_js"/g)?.length).toBe(2);
  });

  it('removes the UA `?nowprocket=1` cookie/redirect bootstrap script', () => {
    const html = [
      '<script>if (navigator.userAgent.match(/iPhone|iPad|iPod/i)) {',
      'document.cookie = "rocket_hide_all_js=1; path=/";',
      'window.location.href = window.location.href + "?nowprocket=1";',
      '}</script>'
    ].join('');
    const result = delayJsTransform(html, setWithRows([], true));
    expect(result.html).toBe('');
    expect(result.report.regionRemovals).toBe(1);
  });

  it('removes the delay controller run-invocation script', () => {
    const html =
      '<script>if (!window.RocketLazyLoadScripts) { window.RocketLazyLoadScripts = { listeners: [] }; } RocketLazyLoadScripts.run();</script>';
    const result = delayJsTransform(html, setWithRows([], true));
    expect(result.html).toBe('');
    expect(result.report.regionRemovals).toBe(1);
  });

  it('removes the Elementor animation helper script', () => {
    const html =
      "<script>document.addEventListener('DOMContentLoaded', function () { RocketElementorAnimation.run(); });</script>";
    const result = delayJsTransform(html, setWithRows([], true));
    expect(result.html).toBe('');
    expect(result.report.regionRemovals).toBe(1);
  });

  it('removes only the first script of each controller kind and restores the rest', () => {
    const html = [
      '<script>if (navigator.userAgent.match(/x/i)) location.href += "?nowprocket=1";</script>',
      '<script>navigator.userAgent.match(/y/i) && location.assign("?nowprocket=1");</script>',
      '<script>RocketLazyLoadScripts.run();</script>',
      '<script>RocketElementorAnimation.run();</script>',
      OLD_TYPE
    ].join('');
    const result = delayJsTransform(html, setWithRows([], true));
    expect(result.report.regionRemovals).toBe(3);
    // The second UA-redirect lookalike survives (first-of-kind removal only);
    // the delayed script is still restored.
    expect(result.html).toContain('location.assign');
    expect(result.html).toContain('src="https://s.tld/wp/a.js"');
    expect(result.html.match(/data-wpr-fdt-excluded="delay_js"/g)?.length).toBe(1);
  });

  it('keeps ordinary scripts whose content merely mentions nearby tokens', () => {
    const html = [
      '<script>navigator.userAgent.match(/x/i);</script>',
      '<script>const run = "RocketLazyLoadScripts";</script>'
    ].join('');
    const result = delayJsTransform(html, setWithRows([], true));
    expect(result.html).toBe(html);
    expect(result.report.regionRemovals).toBe(0);
  });

  it('still validates rows of a disabled feature — a broken row is surfaced, never silently inert', () => {
    expect(() => delayJsTransform(OLD_TYPE, setWithRows(['(bad['], true))).toThrow(
      ExclusionValidationError
    );
  });
});

describe('delayJsTransform — marker accumulation', () => {
  it('appends the feature id to an existing marker value', () => {
    const html =
      '<script type="rocketlazyloadscript" data-rocket-src="u.js" data-wpr-fdt-excluded="defer_all_js"></script>';
    const result = delayJsTransform(html, setWithRows(['u\\.js']));
    expect(result.html).toContain('data-wpr-fdt-excluded="defer_all_js, delay_js"');
  });

  it('leaves a marker that already lists the id untouched', () => {
    const html =
      '<script type="rocketlazyloadscript" data-rocket-src="u.js" data-wpr-fdt-excluded="delay_js"></script>';
    const result = delayJsTransform(html, setWithRows(['u\\.js']));
    expect(result.html).toContain('data-wpr-fdt-excluded="delay_js"');
    expect(result.html).not.toContain('delay_js,delay_js');
  });
});

// The scanner is the transform's candidate source — a malformed input that
// crashes it crashes the transform; pin the two together here.
describe('delayJsTransform — scanner parity', () => {
  it('tokenizes the restored output again (idempotence of scanning, not of transforming)', () => {
    const result = delayJsTransform(NEW_TYPE, setWithRows(['b.js']));
    const tags = scanTags(result.html);
    const restored = tags.find((tag) => tag.name === 'script');
    expect(restored?.attrs.map((attr) => attr.name)).toEqual([
      'type',
      'id',
      'src',
      'data-wpr-fdt-excluded'
    ]);
  });
});

describe('delayJsTransform — the subject after the Defer JS inline-jQuery pass (WP Rocket 3.23.5.1, run)', () => {
  // Served with no rows: Defer JS wrapped the inline body before Delay JS ran.
  const SERVED =
    '<script type="text/rocketlazyloadscript" id="d">' +
    "window.addEventListener('DOMContentLoaded', function() {jQuery(1)});</script>";
  const ROW = 'script id="d">jQuery';

  /** The Delay JS row plus the given Defer JS rows / toggle. */
  function withDefer(deferJs: string[], disableDeferJs = false): ExclusionSet {
    return {
      rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs: [ROW], deferJs },
      disable: { ...EMPTY_EXCLUSION_SET.disable, deferJs: disableDeferJs }
    };
  }

  it('matches the wrapped body while the Defer JS pass still wraps it', () => {
    const result = delayJsTransform(SERVED, withDefer([]));
    expect(result.html).toBe(SERVED);
    expect(result.report.unmatchedRows).toEqual([ROW]);
  });

  it('matches the unwrapped body when the Defer JS rows or toggle turn the pass off', () => {
    for (const set of [withDefer(['jquery.js']), withDefer([], true)]) {
      const result = delayJsTransform(SERVED, set);
      expect(result.report.matchedRows).toEqual([{ row: ROW, rowKind: 'pattern', matches: 1 }]);
      // The body itself is the Defer JS transform's to restore.
      expect(result.html).toBe(
        '<script id="d" data-wpr-fdt-excluded="delay_js">' +
          "window.addEventListener('DOMContentLoaded', function() {jQuery(1)});</script>"
      );
    }
  });

  it('is undetermined when the pass depends on the live rows and the readings disagree', () => {
    const result = delayJsTransform(SERVED, withDefer(['foo.js']));
    expect(result.html).toBe(SERVED);
    expect(result.report).toMatchObject({ candidates: 1, rewritten: 0, undetermined: 1 });
  });

  it('answers when the pass depends on the live rows but both readings agree', () => {
    const set = {
      rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs: ['jQuery\\(1\\)'], deferJs: ['foo.js'] },
      disable: EMPTY_EXCLUSION_SET.disable
    };
    const result = delayJsTransform(SERVED, set);
    expect(result.report.undetermined).toBeUndefined();
    expect(result.report.rewritten).toBe(1);
  });
});

describe('delayJsTransform — a Defer JS wrapper spanning scripts (WP Rocket 3.23.5.1, run)', () => {
  // `<script id="i1">jQuery(1)</script >` + an empty script, served through
  // Defer JS and Delay JS: the wrapper opens in i1 and closes in f.
  const SERVED = parityRow('match-defer-inline-spaced-end-delayed').served;

  /** These Delay JS rows, with Defer JS rows (by default one turning the inline pass off). */
  function withRows(delayJs: string[], deferJs = ['jquery.min.js']): ExclusionSet {
    return {
      rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs, deferJs },
      disable: EMPTY_EXCLUSION_SET.disable
    };
  }

  it('is undetermined where a row tells the readings apart, never a confident restore', () => {
    // WP Rocket keeps both delayed: `{jQuery` and `});<` are gone once unwrapped.
    for (const row of ['\\{jQuery', '\\}\\);<']) {
      const result = delayJsTransform(SERVED, withRows([row]));
      expect(result.html).toBe(SERVED);
      expect(result.report).toMatchObject({ candidates: 2, rewritten: 0, undetermined: 1 });
    }
  });

  it('answers where every reading agrees', () => {
    // WP Rocket restores i1 under `jQuery\(1\)`, wrapped or not.
    const result = delayJsTransform(SERVED, withRows(['jQuery\\(1\\)']));
    expect(result.report).toMatchObject({ rewritten: 1 });
    expect(result.report.undetermined).toBeUndefined();
  });

  it('reads the page as served while the pass runs', () => {
    const result = delayJsTransform(SERVED, withRows(['\\{jQuery'], []));
    expect(result.report).toMatchObject({ rewritten: 1 });
    expect(result.report.undetermined).toBeUndefined();
  });
});

describe('wpBodyStart', () => {
  /** The body as WP Rocket's script regexes read it, for the first script of `html`. */
  const body = (html: string): string => {
    const tag = scanTags(html).find((candidate) => candidate.name === 'script');
    if (tag === undefined) throw new Error('no script');
    return html.slice(wpBodyStart(html, tag, tag.contentEnd), tag.contentEnd);
  };

  it('starts past the opening tag’s first `>`, inside an attribute value when it holds one', () => {
    expect(body('<script id="a">x()</script>')).toBe('x()');
    expect(body('<script data-x="a>b">x()</script>')).toBe('b">x()');
  });
});

describe('delayScriptMatch — the script as WP Rocket’s Delay JS regex matched it', () => {
  /** The match of the first script of `html`, as text. */
  const matched = (html: string): string => {
    const tag = scanTags(html).find((candidate) => candidate.name === 'script');
    if (tag === undefined) throw new Error('no script');
    const { contentEnd, end } = delayScriptMatch(html, tag);
    return `${html.slice(tag.start, contentEnd)}|${html.slice(contentEnd, end)}`;
  };

  it('is the HTML element when the regex accepts its end tag', () => {
    expect(matched('<script id="a">x()</script><script>y()</script>')).toBe(
      '<script id="a">x()|</script>'
    );
    expect(matched('<script>x()</SCRIPT >')).toBe('<script>x()|</SCRIPT >');
  });

  it.each([
    ['</script/>', '<script>x()</script/><script>y()|</script>'],
    ['</script x>', '<script>x()</script x><script>y()|</script>'],
    ['</SCRIPT\tdata-x>', '<script>x()</SCRIPT\tdata-x><script>y()|</script>']
  ])('reads on past %s, which HTML accepts and the regex refuses', (end, expected) => {
    expect(matched(`<script>x()${end}<script>y()</script>`)).toBe(expected);
  });

  it('ends at any end tag the regex accepts (`< / script >`)', () => {
    expect(matched('<script>x()</script/>a< / script ><script>y()</script>')).toBe(
      '<script>x()</script/>a|< / script >'
    );
  });

  it('starts reading after the opening tag’s first `>`, quoted or not', () => {
    expect(matched('<script data-x="a>b</script/>c">x()</script>')).toBe(
      '<script data-x="a>b</script/>c">x()|</script>'
    );
  });

  it('is the HTML element when the regex finds no end', () => {
    expect(matched('<script>x()</script/>tail')).toBe('<script>x()|</script/>');
  });
});

describe('delayScriptMatch — over the regions Delay JS masks', () => {
  /** The match of the first script of `html` over its masked regions, and how many it holds. */
  const matched = (html: string): string => {
    const tag = scanTags(html).find((candidate) => candidate.name === 'script');
    if (tag === undefined) throw new Error('no script');
    const { contentEnd, end, regions } = delayScriptMatch(html, tag, delayMaskedRegions(html));
    return `${html.slice(tag.start, contentEnd)}|${html.slice(contentEnd, end)}|${String(regions.length)}`;
  };

  it('skips an end tag a region hides and holds that region', () => {
    expect(matched(`<script>a='<svg>';</script><script>b='</svg>';</script>`)).toBe(
      `<script>a='<svg>';</script><script>b='</svg>';|</script>|1`
    );
  });

  it('skips every hidden end tag, across several regions', () => {
    const html = `<script>a='<svg>';</script>b='</svg>'<xmp></script></xmp>`;
    expect(matched(`${html}</script>`)).toBe(`${html}|</script>|2`);
  });

  it('ends the opening tag at a region starting inside it (its placeholder’s `-->`)', () => {
    expect(matched(`<script data-x="<svg>">x()</script><i>'</svg>'</i></script>`)).toBe(
      `<script data-x="<svg>">x()</script><i>'</svg>'</i>|</script>|1`
    );
  });

  it('stays linear over many regions and scripts (regions are found by binary search)', () => {
    const html = Array.from(
      { length: 5000 },
      (_, n) =>
        `<script type="text/rocketlazyloadscript" id="s${String(n)}">x()</script><svg><use/></svg>`
    ).join('');
    const started = performance.now();
    expect(delayJsTransform(html, setWithRows(['WPR_SVG'])).report.undetermined).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(250);
  });

  it('is the HTML element, holding nothing, when no region touches it', () => {
    expect(matched('<script>x()</script><svg>1</svg>')).toBe('<script>x()|</script>|0');
  });
});

describe('delayJsTransform — rows over a masked region’s placeholder', () => {
  // As served: a's match held the svg region (a's end tag and b's opening),
  // so Delay JS rewrote a's opening only and b kept its own.
  const SERVED =
    `<script type="text/rocketlazyloadscript" id="a">var q='<svg>';</script>` +
    `<script id="b">var r='</svg>';</script>`;

  it('answers a row matching the placeholder whatever its id', () => {
    const result = delayJsTransform(SERVED, setWithRows(['WPR_SVG_']));
    expect(result.report.undetermined).toBeUndefined();
    expect(result.report.matchedRows).toEqual([
      { row: 'WPR_SVG_', rowKind: 'pattern', matches: 1 }
    ]);
  });

  it('is undetermined for a row that matches some ids only (the id is unknowable)', () => {
    const result = delayJsTransform(SERVED, setWithRows(['WPR_SVG_0']));
    expect(result.html).toBe(SERVED);
    expect(result.report).toMatchObject({ rewritten: 0, undetermined: 1 });
  });

  it('is undetermined for a hex fragment of today’s ids, which no id sample holds (S13c, run)', () => {
    // WP Rocket's uniqid() ids start with clock digits (`6adf…` in 2026): these
    // rows excluded `a` on the real plugin then, and will not in a few years.
    const served = parityRow('match-delay-mask-svg-string-unclosed').served;
    for (const row of ['6adf', '_.ad', '6ad']) {
      const result = delayJsTransform(served, setWithRows([row]));
      expect(result.html, row).toBe(served);
      expect(result.report, row).toMatchObject({ rewritten: 0, undetermined: 1 });
    }
  });

  it('decides 500 rows over 1 000 masked matches without running each through the ids', () => {
    // Each row is checked once for whether it can step into an id at all.
    const served = Array.from(
      { length: 2000 },
      (_, n) =>
        `<script type="text/rocketlazyloadscript" id="s${String(n)}">var q='${n % 2 === 0 ? '<svg>' : '</svg>'}';</script>`
    ).join('');
    const rows = Array.from({ length: 500 }, (_, n) =>
      n % 2 === 0 ? `jquery-ui-${String(n)}` : `/wp-content/plugins/p${String(n)}/[a-z]*\\.js`
    );
    const { result, shares, spent, compiles } = withProbeWork(() =>
      delayJsTransform(served, setWithRows(rows))
    );
    expect(result.report.undetermined).toBeUndefined();
    // Work, not wall clock: the probing path ran (budgets were handed out),
    // each row's probe was built once for the document (not once per
    // script), and no row stepped through an id (not one step spent).
    expect(shares.length).toBeGreaterThan(0);
    expect(compiles).toBeLessThanOrEqual(rows.length);
    expect(Math.max(...spent)).toBe(0);
  });

  it('caps the id runs per document: costly rows leave scripts undetermined, never guessed', () => {
    // Every row here can step through an id, so each runs over every masked match.
    const served = Array.from(
      { length: 1000 },
      (_, n) =>
        `<script type="text/rocketlazyloadscript" id="s${String(n)}">var q='<svg><path/></svg>';${'a1b2c3'.repeat(10)}x(${String(n)});</script>`
    ).join('');
    const rows = Array.from(
      { length: 500 },
      (_, n) => `_[0-9a-f]{0,13} -->[^z]{0,40}q${String(n)}`
    );
    const { result, shares, spent } = withProbeWork(() =>
      delayJsTransform(served, setWithRows(rows))
    );
    // Work, not wall clock (uncapped, this input ran ~55 s; capped, ~0.3 s):
    // one budget per masked script, each its even share of the document's...
    const share = ID_PROBE_LIMITS.documentSteps / 1000;
    expect(shares).toEqual(Array.from({ length: 1000 }, () => share));
    // ...each spent to its end (these rows outlast any share)...
    expect(Math.min(...spent)).toBeGreaterThanOrEqual(share);
    // ...and past it by at most one subject byte's work of one row (the
    // probe checks its budget between bytes; 140 steps measured), so the
    // document stays within its cap.
    const overrun = share / 20;
    expect(Math.max(...spent)).toBeLessThanOrEqual(share + overrun);
    expect(spent.reduce((total, steps) => total + steps, 0)).toBeLessThanOrEqual(
      ID_PROBE_LIMITS.documentSteps + 1000 * overrun
    );
    // Out of work, a script is left undetermined, never guessed.
    expect(result.report.undetermined).toBeGreaterThan(0);
    expect(result.report.rewritten).toBe(0);
  });

  /** `count` delayed scripts, each `size` bytes holding an svg string; every 7th names `name`. */
  const svgScripts = (count: number, size: number, name: (n: number) => string): string[] =>
    Array.from({ length: count }, (_, n) => {
      const filler = 'el.cls="btn-a1";'.repeat(Math.ceil(size / 16));
      const named = n % 7 === 3 ? `${name(n)}();` : '';
      return `<script type="text/rocketlazyloadscript" id="s${String(n)}">var icon='<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';${filler}${named}go(${String(n)});</script>`;
    });

  it.each([
    ['60 × 3 KB, 10 `.*pluginN`', 60, 3000, 10, (n: number) => `.*plugin${String(n)}`],
    ['30 × 20 KB, 5 `.*pluginN.*`', 30, 20_000, 5, (n: number) => `.*plugin${String(n)}.*`],
    ['1 000 × 500 B, 1 `.*plugin0.*`', 1000, 500, 1, (n: number) => `.*plugin${String(n)}.*`]
  ])(
    'answers `.*`-edged rows on large masked pages exactly: %s',
    (_, count, size, rowCount, row) => {
      const rows = Array.from({ length: rowCount }, (_unused, n) => row(n));
      const scripts = svgScripts(count, size, (n) => `plugin${String(n % rowCount)}`);
      const started = performance.now();
      const result = delayJsTransform(scripts.join('\n'), setWithRows(rows));
      expect(performance.now() - started).toBeLessThan(2000);
      expect(result.report.undetermined).toBeUndefined();
      // Exactly the scripts naming a row's plugin are restored.
      expect(result.report.rewritten).toBe(scripts.filter((_s, n) => n % 7 === 3).length);
    }
  );

  it('answers each masked script the same whatever the order of the others', () => {
    // Rows that step through ids, over small and large masked scripts: each
    // script gets the same share of the probe work, so the large ones (and
    // only they) run out of it — wherever they stand on the page. Uncapped,
    // the large ones alone outrun the document's budget, so a budget spent
    // first-come would answer differently by order. Few large scripts keep
    // the work spent (≈ a quarter of the document's budget per order) small.
    const rows = Array.from({ length: 5 }, (_, n) => `_[0-9a-f]{0,13} -->[^z]{0,40}q${String(n)}`);
    const large = (n: number): boolean => n % 6 === 0;
    const scripts = Array.from(
      { length: 42 },
      (_, n) => svgScripts(1, large(n) ? 64_000 : 300, () => '')[0] ?? ''
    );
    const share = ID_PROBE_LIMITS.documentSteps / scripts.length;
    /** Undetermined scripts over `order`; each large one spends its share, each small one less. */
    const undetermined = (order: readonly number[]): number | undefined => {
      const { result, spent } = withProbeWork(() =>
        delayJsTransform(order.map((n) => scripts[n]).join('\n'), setWithRows(rows))
      );
      expect(spent).toHaveLength(order.length);
      expect(order.filter((n, at) => large(n) !== (spent[at] ?? 0) >= share)).toEqual([]);
      return result.report.undetermined;
    };
    const order = scripts.map((_, n) => n);
    expect(undetermined(order)).toBe(7);
    expect(undetermined([...order].reverse())).toBe(7);
    expect(undetermined([...order.slice(21), ...order.slice(0, 21)])).toBe(7);
  });

  it('answers rows that read no id byte, or match for every id', () => {
    const served = parityRow('match-delay-mask-svg-string-unclosed').served;
    expect(delayJsTransform(served, setWithRows(['gtag'])).report.undetermined).toBeUndefined();
    const all = delayJsTransform(served, setWithRows(['WPR_SVG_[0-9a-f]{13} --']));
    expect(all.report).toMatchObject({ rewritten: 1 });
    expect(all.report.undetermined).toBeUndefined();
  });

  it('reads a wrapper opening written into an attribute value as spanning (run)', () => {
    // i1's `>` in an attribute: WP Rocket wrote the opening there; f holds the closing.
    const served = parityRow('match-delay-wrapper-in-attribute-skipped').served;
    for (const deferJs of [['jquery.min.js'], ['foo.js']]) {
      const set: ExclusionSet = {
        rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs: ['\\}\\);'], deferJs },
        disable: EMPTY_EXCLUSION_SET.disable
      };
      const result = delayJsTransform(served, set);
      expect(result.html, deferJs.join()).toBe(served);
      expect(result.report, deferJs.join()).toMatchObject({ rewritten: 0, undetermined: 1 });
    }
  });

  it('reads the inline pass before masking: a wrapper opening inside a region (run)', () => {
    // b's wrapper opening sits in the svg region a's match holds; under rows
    // that leave the pass unknown, b may hold `});` or not.
    const served = parityRow('match-delay-mask-inline-unknown').served;
    const set: ExclusionSet = {
      rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs: ['\\}\\);'], deferJs: ['jquery', 'app.js'] },
      disable: EMPTY_EXCLUSION_SET.disable
    };
    const result = delayJsTransform(served, set);
    expect(result.html).toBe(served);
    expect(result.report).toMatchObject({ rewritten: 0, undetermined: 1 });
  });

  it('never tests a row against the region’s own text', () => {
    const result = delayJsTransform(SERVED, setWithRows(["q='.svg"]));
    expect(result.html).toBe(SERVED);
    expect(result.report.undetermined).toBeUndefined();
    expect(result.report.unmatchedRows).toEqual(["q='.svg"]);
  });
});
