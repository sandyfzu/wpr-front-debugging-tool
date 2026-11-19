/**
 * The Runtime states rows: keys (by the script, never its state or
 * position; duplicates by occurrence), names (file name, inline ordinals),
 * the preview line, the facets (skipped and unknown under State Any only),
 * the searched text, row sameness across re-reads, and the detail's pure
 * view (kind, clipped URL, whole and kept code, copy, facts, language, code note).
 */
import { describe, expect, it } from 'vitest';
import { exclusivityViolations } from '../../../../lib/panel/facet-parity.fixtures';
import { applyFacets, facetCounts } from '../../../../lib/panel/resource-facets';
import { FIELD_MAX, FULL_TEXT_MAX } from '../../../../lib/script-runtime/classify';
import type { LiveScriptRecord } from '../../../../lib/script-runtime/read-live';
import { codeNote } from '../../../../lib/script-runtime/outcome-view';
import { capText } from '../../../../utils/cap-text';
import { DELAYED, liveScript } from './runtime-fixtures';
import {
  EMPTY_CODE_COPY,
  INLINE_SOURCE_COPY,
  keptCode,
  NONE_VALUE,
  outsideFilterCounts,
  PARTIAL_CODE_COPY_LABEL,
  PARTIAL_COPY_NOTE,
  RUNTIME_FACETS,
  RUNTIME_GROUPS,
  runtimeCodeLanguage,
  runtimeCodeNote,
  runtimeCopy,
  runtimeFacts,
  runtimeKind,
  runtimePreview,
  runtimeRows,
  runtimeSearchField,
  runtimeSignature,
  sameRuntimeRow,
  urlClipped,
  wholeCode
} from './runtime-rows';

/** One script per state and group. */
function scripts(): LiveScriptRecord[] {
  return [
    liveScript({
      type: DELAYED,
      delayedSrc: 'https://a.test/wp-content/themes/t/main.js?ver=1',
      status: 'executed'
    }),
    liveScript({
      type: DELAYED,
      src: 'https://a.test/wp-content/plugins/p/x.js',
      status: 'failed-network'
    }),
    liveScript({ type: DELAYED, text: 'pending();', id: 'boot', classes: ['a', 'b'] }),
    liveScript({ src: 'https://cdn.test/lib.js' }),
    liveScript({ type: 'application/ld+json', text: '{"@type":"Thing"}' }),
    liveScript({ type: DELAYED, src: 'https://a.test/legacy.js', status: 'skipped' }),
    liveScript({ type: DELAYED, text: 'later();', status: 'later' })
  ];
}

/**
 * The row keys of a read's rows.
 *
 * @param list The scripts.
 */
function keys(list: readonly LiveScriptRecord[]): string[] {
  return runtimeRows(list).map((row) => row.key);
}

describe('runtimeRows', () => {
  it('names URLs by file and inline scripts by ordinal, in document order', () => {
    expect(runtimeRows(scripts()).map((row) => row.name)).toEqual([
      'main.js',
      'x.js',
      'Inline script 1',
      'lib.js',
      'Inline script 2',
      'legacy.js',
      'Inline script 3'
    ]);
  });

  it('keys each script by its URL or the start of its code, unique and position-free', () => {
    const list = scripts();
    const before = keys(list);
    expect(new Set(before).size).toBe(list.length);
    expect(before[0]).toBe('u|https://a.test/wp-content/themes/t/main.js?ver=1#0');
    expect(before[2]).toBe('i|pending();#0');
    // A script inserted above shifts no other key.
    const inserted = keys([liveScript({ src: 'https://a.test/new.js' }), ...list]);
    expect(inserted.slice(1)).toEqual(before);
  });

  it('keeps the key when the state changes (Read again keeps the detail open)', () => {
    const pending = liveScript({ type: DELAYED, delayedSrc: 'https://a.test/p.js' });
    const ran = liveScript({
      type: DELAYED,
      delayedSrc: 'https://a.test/p.js',
      status: 'executed'
    });
    expect(keys([pending])).toEqual(keys([ran]));
    const code = liveScript({ type: DELAYED, text: 'run();' });
    // The shared text budget left only the preview: same key.
    const cut = liveScript({ type: DELAYED, text: 'run();', status: 'executed' }, true);
    expect(keys([code])).toEqual(keys([cut]));
  });

  it('tells duplicates apart by occurrence, URL and code signatures never collide', () => {
    const twice = liveScript({ src: 'https://a.test/dup.js' });
    expect(keys([twice, twice])).toEqual([
      'u|https://a.test/dup.js#0',
      'u|https://a.test/dup.js#1'
    ]);
    // Code that reads like a URL is still code.
    expect(runtimeSignature(liveScript({ text: 'https://a.test/dup.js' }))).toBe(
      'i|https://a.test/dup.js'
    );
    expect(keys([liveScript(), liveScript()])).toEqual(['i|#0', 'i|#1']);
  });

  it('previews the URL without its scheme, else the code, else the empty words; #id first', () => {
    const rows = runtimeRows(scripts());
    expect(rows[0]?.preview).toBe('a.test/wp-content/themes/t/main.js?ver=1');
    expect(rows[2]?.preview).toBe('#boot · pending();');
    expect(runtimePreview(liveScript())).toBe(EMPTY_CODE_COPY);
    expect(runtimePreview(liveScript({ id: 'x', src: 'https://a.test/x.js' }))).toBe(
      '#x · a.test/x.js'
    );
  });
});

describe('RUNTIME_FACETS', () => {
  const rows = runtimeRows(scripts());
  const search = (query: string) => ({ field: runtimeSearchField, query });

  it('narrows by source and state together, with the search', () => {
    const names = (selection: Parameters<typeof applyFacets>[2], query = '') =>
      applyFacets(rows, RUNTIME_FACETS, selection, search(query)).map((row) => row.name);
    expect(names({ state: 'not-delayed' })).toEqual(['lib.js', 'Inline script 2']);
    expect(names({ source: 'other', state: 'not-delayed' })).toEqual(['lib.js']);
    expect(names({ source: 'inline' })).toEqual([
      'Inline script 1',
      'Inline script 2',
      'Inline script 3'
    ]);
    // Skipped and unknown match no State value.
    expect(names({ state: 'pending' })).toEqual(['Inline script 1']);
    expect(names({}, 'pending')).toEqual(['Inline script 1']);
    expect(names({ source: 'theme' }, 'nothing')).toEqual([]);
  });

  it('keeps one source and one state per script', () => {
    expect(exclusivityViolations(rows, RUNTIME_FACETS)).toEqual([]);
  });

  it('declares the groups in order', () => {
    expect(RUNTIME_GROUPS).toEqual(['theme', 'plugin', 'inline', 'other']);
    expect(RUNTIME_FACETS.byId.get('source')?.values.map((value) => value.label)).toEqual([
      'Theme',
      'Plugins',
      'Inline',
      'Other'
    ]);
  });

  it('counts each facet given the other (skipped and unknown under Any only)', () => {
    expect(facetCounts(rows, RUNTIME_FACETS, {}, search('')).byFacet.state).toEqual({
      any: 7,
      executed: 1,
      failed: 1,
      pending: 1,
      'not-delayed': 2
    });
    const inline = facetCounts(rows, RUNTIME_FACETS, { source: 'inline' }, search(''));
    expect(inline.byFacet.state).toEqual({
      any: 3,
      executed: 0,
      failed: 0,
      pending: 1,
      'not-delayed': 1
    });
    expect(
      facetCounts(rows, RUNTIME_FACETS, { state: 'not-delayed' }, search('')).byFacet.source
    ).toEqual({ any: 2, theme: 0, plugin: 0, inline: 1, other: 1 });
  });

  it('searches the URL, id, classes and code', () => {
    const [, , inline] = rows;
    if (inline === undefined) throw new Error('fixture');
    expect(runtimeSearchField(inline)).toBe('\nboot\na b\npending();');
  });
});

describe('outsideFilterCounts', () => {
  it('counts the skipped and unknown scripts', () => {
    expect(outsideFilterCounts(runtimeRows(scripts()))).toEqual({ skipped: 1, unknown: 1 });
    expect(outsideFilterCounts([])).toEqual({ skipped: 0, unknown: 0 });
  });
});

describe('sameRuntimeRow', () => {
  it('holds for an identical re-read and breaks on any shown field', () => {
    const [a] = runtimeRows(scripts());
    const [b] = runtimeRows(scripts());
    if (a === undefined || b === undefined) throw new Error('fixture');
    expect(sameRuntimeRow(a, b)).toBe(true);
    const variants: Partial<LiveScriptRecord>[] = [
      { state: 'failed' },
      { rawStatus: 'x' },
      { group: 'other' },
      { structuredData: true },
      { sourceKind: 'inline' },
      { source: 'y' },
      { id: 'z' },
      { fullText: 't' },
      { fullTextCut: true },
      { classes: ['c'] }
    ];
    for (const change of variants) {
      expect(sameRuntimeRow(a, { ...b, script: { ...b.script, ...change } })).toBe(false);
    }
    expect(sameRuntimeRow(a, { ...b, name: 'other.js' })).toBe(false);
    const withClasses = { ...a, script: { ...a.script, classes: ['p', 'q'] } };
    expect(
      sameRuntimeRow(withClasses, { ...a, script: { ...a.script, classes: ['p', 'r'] } })
    ).toBe(false);
  });
});

describe('detail view', () => {
  const [theme, , inline, , jsonLd] = runtimeRows(scripts());
  if (theme === undefined || inline === undefined || jsonLd === undefined) {
    throw new Error('fixture');
  }

  it('names the kind: structured data, external, inline', () => {
    expect(runtimeKind(jsonLd)).toBe('Structured data');
    expect(runtimeKind(theme)).toBe('External script');
    expect(runtimeKind(inline)).toBe('Inline script');
  });

  it('flags a URL cut at the field cap, never an inline script', () => {
    const long = `https://a.test/${'p'.repeat(FIELD_MAX)}.js`;
    expect(urlClipped(liveScript({ src: long }))).toBe(true);
    expect(urlClipped(liveScript({ src: 'https://a.test/x.js' }))).toBe(false);
    expect(urlClipped(liveScript({ text: capText('x'.repeat(FIELD_MAX + 5), FIELD_MAX) }))).toBe(
      false
    );
  });

  it('holds the whole code unless the budget or the cap cut it', () => {
    expect(wholeCode(liveScript({ text: 'a();' }))).toBe(true);
    expect(wholeCode(liveScript({ text: 'a();' }, true))).toBe(false);
    expect(wholeCode(liveScript({ text: 'x'.repeat(FULL_TEXT_MAX + 1) }))).toBe(false);
  });

  it('keeps the code as the page holds it: a cut drops only the ellipsis it appended', () => {
    // Whole code: verbatim, its own trailing ellipsis included.
    expect(keptCode(liveScript({ text: 'wait…' }))).toBe('wait…');
    // Capped: the cap's code points, without the appended ellipsis.
    expect(keptCode(liveScript({ text: 'x'.repeat(FULL_TEXT_MAX + 1) }))).toBe(
      'x'.repeat(FULL_TEXT_MAX)
    );
    // Budget-cut: the start that arrived, without its ellipsis.
    expect(keptCode(liveScript({ text: 'cut…' }, true))).toBe('cut');
    expect(keptCode(liveScript({ text: 'a();' }, true))).toBe('a();');
  });

  it('copies the URL or the whole code; a cut code only under its partial name; nothing else', () => {
    expect(runtimeCopy(theme)).toEqual({
      text: 'https://a.test/wp-content/themes/t/main.js?ver=1',
      label: 'Script URL'
    });
    expect(runtimeCopy(inline)).toEqual({ text: 'pending();', label: 'Inline script' });
    const rows = runtimeRows([
      liveScript({ text: 'start…' }, true),
      liveScript({ text: 'x'.repeat(FULL_TEXT_MAX + 1) }),
      liveScript(),
      liveScript({ src: `https://a.test/${'p'.repeat(FIELD_MAX)}.js` })
    ]);
    expect(rows.map((row) => runtimeCopy(row))).toEqual([
      { text: 'start', label: PARTIAL_CODE_COPY_LABEL },
      { text: 'x'.repeat(FULL_TEXT_MAX), label: PARTIAL_CODE_COPY_LABEL },
      undefined,
      undefined
    ]);
    // The partial name never claims the script.
    expect(PARTIAL_CODE_COPY_LABEL).not.toMatch(/script/iu);
  });

  it('lists the status attribute always, the source of inline code, id and classes when set', () => {
    expect(runtimeFacts(theme.script)).toEqual([
      { label: 'Status attribute', value: 'executed', mono: true }
    ]);
    expect(runtimeFacts(inline.script)).toEqual([
      { label: 'Status attribute', value: NONE_VALUE, mono: true },
      { label: 'Source', value: INLINE_SOURCE_COPY.inline, mono: false },
      { label: 'ID', value: 'boot', mono: true },
      { label: 'Classes', value: 'a b', mono: true }
    ]);
    const converted = liveScript({
      type: DELAYED,
      src: 'data:text/javascript;base64,YSgp',
      status: 'executed'
    });
    expect(runtimeFacts(converted)[1]).toEqual({
      label: 'Source',
      value: INLINE_SOURCE_COPY['converted-inline'],
      mono: false
    });
  });

  it('reads structured data as JSON, the rest as JavaScript', () => {
    expect(runtimeCodeLanguage(jsonLd.script)).toBe('json');
    expect(runtimeCodeLanguage(inline.script)).toBe('javascript');
  });

  it('notes a cut code with what copy takes; whole code gets no note', () => {
    const cut = liveScript({ text: 'a();' }, true);
    const capped = liveScript({ text: 'x'.repeat(FULL_TEXT_MAX + 1) });
    expect(runtimeCodeNote(cut)).toBe(`${String(codeNote(cut))} ${PARTIAL_COPY_NOTE}`);
    expect(runtimeCodeNote(capped)).toBe(`${String(codeNote(capped))} ${PARTIAL_COPY_NOTE}`);
    expect(runtimeCodeNote(liveScript({ text: 'a();' }))).toBeNull();
  });
});
