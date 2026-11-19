/**
 * The JavaScript page's pure view layer: state chips, the calm row's name,
 * preview, size and chip split, the detail's facts and code language, the
 * facets over views, line counting and the bounded detail text.
 */
import { describe, expect, it } from 'vitest';
import type { JsScriptResource } from '../../../../lib/panel/resources-view-model';
import type { ScriptSimulation } from '../../../../lib/panel/script-states';
import { JS_PAGE_FACETS } from '../../../../lib/panel/resources-view-model';
import { applyFacets } from '../../../../lib/panel/resource-facets';
import { formatCount } from '../../../../utils/format-count';
import {
  EMPTY_SRC_NAME,
  JS_CHIP_SOURCES,
  JS_VIEW_FACETS,
  NO_CODE_PREVIEW,
  PREVIEW_CHARS,
  collapsedPreview,
  countLines,
  delaySummaryBadge,
  expandedCutNote,
  expandedText,
  lineCount,
  notableScriptType,
  sameScript,
  scriptCodeLanguage,
  scriptFacts,
  scriptKind,
  scriptName,
  scriptPreview,
  scriptRowView,
  scriptSearchField,
  scriptSize,
  scriptStateChips,
  urlPreview
} from './script-view';
import { UNVERIFIED_SIMULATION_SUFFIX } from '../resource-list/state-chips';

/** A classified script with overrides. */
function script(overrides: Partial<JsScriptResource> = {}): JsScriptResource {
  return {
    id: 0,
    type: 'external',
    content: 'https://example.test/a.js',
    delayed: false,
    deferred: false,
    deferredByWPR: false,
    fdtExcluded: null,
    minified: false,
    combined: false,
    minifyAttribute: false,
    originalType: null,
    ...overrides
  };
}

describe('delaySummaryBadge', () => {
  it('served, simulated (never "Not detected"), absent', () => {
    expect(delaySummaryBadge(true, false)).toEqual({ label: 'Detected', kind: 'ok' });
    expect(delaySummaryBadge(false, true)).toEqual({ label: 'Simulated', kind: 'info' });
    expect(delaySummaryBadge(false, false)).toEqual({ label: 'Not detected', kind: 'neutral' });
  });
});

/** Delay JS and Defer JS both run by a verified simulation. */
const BOTH_SIMULATED: ScriptSimulation = { delay: 'simulated', defer: 'simulated' };

/** The chips in order, each as `label/source`. */
function words(row: JsScriptResource, simulation?: ScriptSimulation): string[] {
  return scriptStateChips(row, simulation).map((chip) => `${chip.label}/${chip.source}`);
}

describe('scriptStateChips', () => {
  it.each([
    [{}, []],
    [{ type: 'inline' as const }, []],
    [{ delayed: true }, ['Delayed/wp-rocket']],
    // The page's own defer.
    [{ deferred: true }, ['Deferred/page']],
    [{ deferredByWPR: true, deferred: true }, ['Deferred/wp-rocket']],
    // The stamp alone still reads WP Rocket's defer.
    [{ deferredByWPR: true }, ['Deferred/wp-rocket']],
    [{ minified: true }, ['Minified/wp-rocket']],
    [{ combined: true }, ['Combined/wp-rocket']],
    [{ fdtExcluded: 'delay_js' }, ['Excluded/excluded']],
    [{ fdtExcluded: 'defer_all_js' }, ['Excluded/excluded']],
    // A marker naming a feature that applied anyway is no exclusion.
    [{ fdtExcluded: 'delay_js', delayed: true }, ['Delayed/wp-rocket']],
    [{ fdtExcluded: 'defer_all_js', deferred: true }, ['Deferred/page']],
    // An inline script cannot be deferred: no Deferred chip, no defer exclusion.
    [{ type: 'inline' as const, deferred: true, fdtExcluded: 'defer_all_js' }, []],
    // Most important first: the exclusion, then Delay JS, Defer JS, the file states.
    [
      { fdtExcluded: 'defer_all_js', delayed: true, minified: true },
      ['Excluded/excluded', 'Delayed/wp-rocket', 'Minified/wp-rocket']
    ],
    [
      { delayed: true, deferred: true, deferredByWPR: true, combined: true },
      ['Delayed/wp-rocket', 'Deferred/wp-rocket', 'Combined/wp-rocket']
    ]
  ] as const)('%j → %j', (overrides, expected) => {
    expect(words(script(overrides))).toEqual(expected);
  });

  it('negative states are no chips (the filters keep them)', () => {
    const labels = scriptStateChips(script({ fdtExcluded: 'delay_js,defer_all_js' })).map(
      (chip) => chip.label
    );
    expect(labels).toEqual(['Excluded']);
    expect(labels.join(' ')).not.toMatch(/Not /);
  });

  it('attributes Deferred per who deferred: WP Rocket, a verified simulation, the page', () => {
    const stamped = script({ deferredByWPR: true, deferred: true });
    expect(words(stamped, { delay: null, defer: 'simulated' })).toEqual(['Deferred/simulated']);
    expect(words(stamped, { delay: 'simulated', defer: null })).toEqual(['Deferred/wp-rocket']);
    // The page's own defer stays the page's, simulation or not.
    expect(words(script({ deferred: true }), BOTH_SIMULATED)).toEqual(['Deferred/page']);
    const [own] = scriptStateChips(script({ deferred: true }));
    expect(own).toEqual({
      id: 'deferred',
      label: 'Deferred',
      source: 'page',
      title: "The page's own defer attribute"
    });
    expect(scriptStateChips(stamped, BOTH_SIMULATED)[0]?.title).toBe(
      "Deferred by the FDT's Load JavaScript deferred simulation"
    );
    expect(scriptStateChips(stamped)[0]?.title).toBe(
      'Deferred by WP Rocket (Load JavaScript deferred)'
    );
  });

  it('attributes Delayed to a verified Delay JS simulation, else to WP Rocket', () => {
    const delayed = script({ delayed: true });
    expect(words(delayed, { delay: 'simulated', defer: null })).toEqual(['Delayed/simulated']);
    // Only the Delay JS fact moves Delayed.
    expect(words(delayed, { delay: null, defer: 'simulated' })).toEqual(['Delayed/wp-rocket']);
    expect(scriptStateChips(delayed, BOTH_SIMULATED)[0]?.title).toBe(
      "Delayed by the FDT's Delay JavaScript execution simulation"
    );
    expect(scriptStateChips(delayed)[0]?.title).toBe(
      'Delayed by WP Rocket (Delay JavaScript execution)'
    );
  });

  it("keeps an unverified marker's states WP Rocket's, flagged on hover", () => {
    const row = script({ delayed: true, deferred: true, deferredByWPR: true });
    const chips = scriptStateChips(row, { delay: 'unverified', defer: 'unverified' });
    expect(chips.map((chip) => [chip.source, chip.title])).toEqual([
      ['wp-rocket', 'Delayed by WP Rocket (Delay JavaScript execution) (simulation not verified)'],
      ['wp-rocket', 'Deferred by WP Rocket (Load JavaScript deferred) (simulation not verified)']
    ]);
    // Each flag follows its own feature's fact only.
    const [delayed, deferred] = scriptStateChips(row, { delay: 'unverified', defer: null });
    expect(delayed?.title?.endsWith(UNVERIFIED_SIMULATION_SUFFIX)).toBe(true);
    expect(deferred?.title).toBe('Deferred by WP Rocket (Load JavaScript deferred)');
    // The page's own defer is never flagged.
    expect(
      scriptStateChips(script({ deferred: true }), { delay: null, defer: 'unverified' })[0]?.title
    ).toBe("The page's own defer attribute");
  });

  it('declares all four sources for the legend', () => {
    expect(JS_CHIP_SOURCES).toEqual(['wp-rocket', 'simulated', 'excluded', 'page']);
  });

  it('never moves the exclusion or the file states under a simulation', () => {
    expect(
      words(script({ fdtExcluded: 'defer_all_js', delayed: true, minified: true }), BOTH_SIMULATED)
    ).toEqual(['Excluded/excluded', 'Delayed/simulated', 'Minified/wp-rocket']);
    expect(words(script({ combined: true }), BOTH_SIMULATED)).toEqual(['Combined/wp-rocket']);
  });

  it('names the excluded features in the Excluded chip’s title', () => {
    const chip = (fdtExcluded: string, delayed = false) =>
      scriptStateChips(script({ fdtExcluded, delayed }))[0];
    expect(chip('delay_js')).toMatchObject({
      source: 'excluded',
      title: 'Excluded by FDT from Delay JavaScript execution'
    });
    expect(chip('defer_all_js')?.title).toBe('Excluded by FDT from Load JavaScript deferred');
    expect(chip('delay_js,defer_all_js')?.title).toBe(
      'Excluded by FDT from Delay JavaScript execution and Load JavaScript deferred'
    );
    // Delayed anyway: only the defer exclusion is named.
    expect(chip('delay_js defer_all_js', true)?.title).toBe(
      'Excluded by FDT from Load JavaScript deferred'
    );
  });

  it('titles the file states with their feature names', () => {
    expect(scriptStateChips(script({ minified: true }))[0]).toMatchObject({
      source: 'wp-rocket',
      title: 'Minified by WP Rocket (Minify JavaScript files)'
    });
    expect(scriptStateChips(script({ combined: true }))[0]).toMatchObject({
      source: 'wp-rocket',
      title: 'Bundle built by WP Rocket (Combine JavaScript files)'
    });
    // Delayed now names its source and feature on hover too (it had no title).
    expect(scriptStateChips(script({ delayed: true }))[0]).toEqual({
      id: 'delayed',
      label: 'Delayed',
      source: 'wp-rocket',
      title: 'Delayed by WP Rocket (Delay JavaScript execution)'
    });
  });
});

describe('scriptRowView', () => {
  it('splits the chips at two for the row and keeps them all for the detail', () => {
    const view = scriptRowView(
      script({ delayed: true, deferred: true, deferredByWPR: true, minified: true }),
      'k'
    );
    expect(view.chips.map((chip) => chip.label)).toEqual(['Delayed', 'Deferred', 'Minified']);
    expect(view.rowChips.visible.map((chip) => chip.label)).toEqual(['Delayed', 'Deferred']);
    expect(view.rowChips.overflow?.label).toBe('+1');
    expect(view).toMatchObject({ key: 'k', capture: 'complete', preview: 'example.test/a.js' });
  });

  it('attributes a stamped defer to a verified simulation', () => {
    const stamped = script({ deferredByWPR: true, deferred: true });
    expect(scriptRowView(stamped, 'e', 'complete', BOTH_SIMULATED).chips[0]?.source).toBe(
      'simulated'
    );
    expect(scriptRowView(stamped, 'e').chips[0]?.source).toBe('wp-rocket');
  });
});

describe('notableScriptType', () => {
  it.each(['text/javascript', ' Text/JavaScript ', 'application/javascript', ' ', '\t\n'])(
    'hides a classic or blank type (%j)',
    (originalType) => {
      expect(notableScriptType(script({ delayed: true, originalType }))).toBeNull();
    }
  );

  it('names module, JSON and data-block types as written; none without one', () => {
    expect(notableScriptType(script({ delayed: true, originalType: 'Module' }))).toBe('Module');
    expect(notableScriptType(script({ delayed: true, originalType: 'importmap' }))).toBe(
      'importmap'
    );
    expect(
      notableScriptType(script({ delayed: true, originalType: 'text/javascript; charset=utf-8' }))
    ).toBe('text/javascript; charset=utf-8');
    expect(notableScriptType(script({ delayed: true }))).toBeNull();
  });
});

describe('collapsedPreview', () => {
  it('collapses every whitespace run to one space and trims both ends', () => {
    expect(collapsedPreview('  if (a) {\n\t  b();\r\n}  ')).toBe('if (a) { b(); }');
    expect(collapsedPreview('\n\n')).toBe('');
  });

  it('keeps at most the cap, never ending on half a surrogate pair', () => {
    expect(collapsedPreview('x'.repeat(PREVIEW_CHARS + 50))).toHaveLength(PREVIEW_CHARS);
    const astral = `${'x'.repeat(PREVIEW_CHARS - 1)}😀tail`;
    expect(collapsedPreview(astral)).toBe('x'.repeat(PREVIEW_CHARS - 1));
  });

  it('scans a huge script only as far as its preview', () => {
    const huge = `a${' '.repeat(5)}b${'c'.repeat(600_000)}`;
    expect(collapsedPreview(huge)).toBe(`a b${'c'.repeat(PREVIEW_CHARS - 3)}`);
  });
});

describe('urlPreview', () => {
  it('drops the scheme of an http(s) URL and keeps host, path, query and fragment', () => {
    expect(urlPreview('https://cdn.test:8080/js/a.min.js?ver=1#x')).toBe(
      'cdn.test:8080/js/a.min.js?ver=1#x'
    );
  });

  it('keeps anything else as captured', () => {
    expect(urlPreview('/relative.js')).toBe('/relative.js');
    expect(urlPreview('data:text/javascript,1')).toBe('data:text/javascript,1');
    expect(urlPreview('')).toBe('');
  });
});

describe('scriptPreview', () => {
  it('prefixes the notable type to code and URLs alike', () => {
    expect(
      scriptPreview(
        script({
          type: 'inline',
          content: '{"imports":{}}',
          delayed: true,
          originalType: 'importmap'
        }),
        'complete'
      )
    ).toBe('importmap · {"imports":{}}');
    expect(scriptPreview(script({ delayed: true, originalType: 'module' }), 'complete')).toBe(
      'module · example.test/a.js'
    );
  });

  it('tells a blank script from text the size budget left out', () => {
    expect(scriptPreview(script({ type: 'inline', content: '  ' }), 'complete')).toBe(
      NO_CODE_PREVIEW.blank
    );
    expect(scriptPreview(script({ type: 'inline', content: '' }), 'not-captured')).toBe(
      NO_CODE_PREVIEW['not-captured']
    );
  });
});

describe('scriptName / scriptKind', () => {
  it('names an external script by its file, an inline one by its ordinal', () => {
    expect(scriptName(scriptRowView(script(), 'e'), 0)).toBe('a.js');
    expect(scriptName(scriptRowView(script({ content: '' }), 'e'), 0)).toBe(EMPTY_SRC_NAME);
    expect(scriptName(scriptRowView(script({ type: 'inline', content: 'x()' }), 'i'), 3)).toBe(
      'Inline script #3'
    );
    expect(scriptKind(scriptRowView(script(), 'e'))).toBe('External script');
    expect(scriptKind(scriptRowView(script({ type: 'inline' }), 'i'))).toBe('Inline script');
  });
});

describe('scriptSize', () => {
  const inline = (content: string): JsScriptResource => script({ type: 'inline', content });

  it('counts an inline script compactly, floored when clipped', () => {
    expect(scriptSize(scriptRowView(inline('x'.repeat(742)), 'i'))).toBe('742');
    expect(scriptSize(scriptRowView(inline('x'.repeat(18_611)), 'i'))).toBe('18.6K');
    expect(scriptSize(scriptRowView(inline('x'.repeat(2000)), 'i', 'clipped'))).toBe('≥ 2K');
  });

  it('rounds a clipped size down, so the floor never reads above the text', () => {
    const clipped = (chars: number): string | undefined =>
      scriptSize(scriptRowView(inline('x'.repeat(chars)), 'i', 'clipped'));
    expect(clipped(524_288)).toBe('≥ 524.2K');
    expect(clipped(999_960)).toBe('≥ 999.9K');
    // A whole (unclipped) count still rounds to nearest.
    expect(scriptSize(scriptRowView(inline('x'.repeat(524_288)), 'i'))).toBe('524.3K');
  });

  it('leaves the cell empty for an external script or text left out', () => {
    expect(scriptSize(scriptRowView(script(), 'e'))).toBeUndefined();
    expect(scriptSize(scriptRowView(inline(''), 'i', 'not-captured'))).toBeUndefined();
  });
});

describe('scriptFacts', () => {
  it('lists only the facts that hold', () => {
    expect(scriptFacts(scriptRowView(script(), 'e'))).toEqual([]);
  });

  it('lists every marker in reading order, attribute values mono', () => {
    const facts = scriptFacts(
      scriptRowView(
        script({
          delayed: true,
          originalType: 'module',
          deferred: true,
          deferredByWPR: true,
          minifyAttribute: true,
          fdtExcluded: 'defer_all_js'
        }),
        'e'
      )
    );
    expect(facts).toEqual([
      { label: 'Delayed', value: 'Delay JS type', mono: false },
      { label: 'Original type', value: 'module', mono: true },
      { label: 'Defer', value: 'defer', mono: true },
      { label: 'WP Rocket defer', value: 'data-rocket-defer', mono: true },
      { label: 'Minify stamp', value: 'data-minify="1"', mono: true },
      { label: 'FDT exclusion', value: 'data-wpr-fdt-excluded="defer_all_js"', mono: true }
    ]);
  });

  it('sizes an inline script exactly, floored when clipped, never when left out', () => {
    const inline = script({ type: 'inline', content: 'x'.repeat(1200) });
    expect(scriptFacts(scriptRowView(inline, 'i')).at(-1)).toEqual({
      label: 'Size',
      value: '1,200 characters',
      mono: false
    });
    expect(scriptFacts(scriptRowView(inline, 'i', 'clipped')).at(-1)?.value).toBe(
      '≥ 1,200 characters (clipped)'
    );
    expect(
      scriptFacts(scriptRowView(script({ type: 'inline', content: '' }), 'i', 'not-captured'))
    ).toEqual([]);
  });
});

describe('scriptCodeLanguage', () => {
  it('reads a delayed script by its original type, at once', () => {
    expect(scriptCodeLanguage(script({ delayed: true }), undefined, false)).toBe('javascript');
    expect(
      scriptCodeLanguage(
        script({ delayed: true, originalType: 'application/ld+json' }),
        undefined,
        false
      )
    ).toBe('json');
  });

  it('waits for the served type of an undelayed script, then reads it', () => {
    const row = script({ type: 'inline' });
    expect(scriptCodeLanguage(row, undefined, false)).toBeUndefined();
    expect(scriptCodeLanguage(row, 'importmap', true)).toBe('json');
    expect(scriptCodeLanguage(row, 'module', true)).toBe('javascript');
    expect(scriptCodeLanguage(row, null, true)).toBe('javascript');
  });

  it('falls back to JavaScript once a failed read settled', () => {
    expect(scriptCodeLanguage(script({ type: 'inline' }), undefined, true)).toBe('javascript');
  });
});

describe('JS_VIEW_FACETS / scriptSearchField', () => {
  it('lifts the shared facets through the row (ids, labels and predicates unchanged)', () => {
    expect(
      JS_VIEW_FACETS.facets.map((facet) => [facet.id, facet.values.map((v) => v.label)])
    ).toEqual(JS_PAGE_FACETS.facets.map((facet) => [facet.id, facet.values.map((v) => v.label)]));
    const views = [
      scriptRowView(script({ delayed: true }), 'a'),
      scriptRowView(script({ type: 'inline', content: 'needle()' }), 'b')
    ];
    const search = { field: scriptSearchField, query: '' };
    expect(applyFacets(views, JS_VIEW_FACETS, { delay: 'delayed' }, search)).toEqual([views[0]]);
    expect(applyFacets(views, JS_VIEW_FACETS, {}, { ...search, query: 'needle' })).toEqual([
      views[1]
    ]);
    expect(views.map(scriptSearchField)).toEqual(['https://example.test/a.js', 'needle()']);
  });
});

describe('countLines', () => {
  it.each([
    ['', 0],
    ['a', 1],
    ['abc\nde', 2],
    ['a\nb\n', 2],
    ['a\n\n', 2],
    ['\n', 1],
    ['a\r\nbc', 2]
  ])('%j → %i lines', (text, lines) => {
    expect(countLines(text)).toBe(lines);
  });

  it('counts a large script', () => {
    expect(countLines(Array.from({ length: 10_000 }, () => 'x = 1;').join('\n'))).toBe(10_000);
  });
});

describe('sameScript', () => {
  it('compares every data field, never the position', () => {
    const base = script();
    expect(sameScript(base, { ...base, id: 9 })).toBe(true);
    for (const change of [
      { type: 'inline' as const },
      { content: 'other' },
      { delayed: true },
      { deferred: true },
      { deferredByWPR: true },
      { fdtExcluded: 'delay_js' },
      { minified: true },
      { combined: true },
      { minifyAttribute: true },
      { originalType: 'module' }
    ]) {
      expect(sameScript(base, { ...base, ...change })).toBe(false);
    }
  });
});

describe('phrases', () => {
  it('formats counts with thousands separators', () => {
    expect(formatCount(5000)).toBe('5,000');
    expect(lineCount(1)).toBe('1 line');
    expect(lineCount(1040)).toBe('1,040 lines');
  });
});

describe('expandedText', () => {
  it('keeps a source within the limit whole', () => {
    expect(expandedText('abc', 3)).toEqual({ text: 'abc', cut: false });
  });

  it('cuts a longer source at the limit, never splitting a surrogate pair', () => {
    expect(expandedText('abcd', 3)).toEqual({ text: 'abc', cut: true });
    // '😀' is two UTF-16 units: a cut through it keeps neither half.
    expect(expandedText('ab😀cd', 3)).toEqual({ text: 'ab', cut: true });
    expect(expandedText('ab😀cd', 4)).toEqual({ text: 'ab😀', cut: true });
  });

  it('names the limit in its note', () => {
    expect(expandedCutNote(20_000)).toBe(
      'Showing the first 20,000 characters — copy gets the full script.'
    );
  });
});
