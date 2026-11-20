/**
 * The Stylesheets page's rows: the Critical placement (live row / snapshot
 * row / never both / nowhere without the snapshot fact / never on a cut
 * list), the copied fields and searched text, and the page's facets (a
 * value selects exactly the rows showing its chip).
 */
import { describe, expect, it } from 'vitest';
import {
  exclusivityViolations,
  selectionMismatches,
  type SelectionCase
} from './facet-checks.fixtures';
import { applyFacets, facetCounts, type FacetSelection } from './resource-facets';
import { ALL, MINIFIED, inline, link, rows, statesOf } from './stylesheet.fixtures';
import {
  CRITICAL_SNAPSHOT_ROW_ID,
  CSS_PAGE_FACETS,
  buildStylesheetRows,
  cssStyleSearchField,
  type CssFacetId
} from './stylesheet-rows';
import {
  LAZYLOAD_BG_CONTAINER_ID,
  LAZYLOAD_BG_EXCLUSION_ID,
  RUCSS_USED_CSS_ID
} from '../wp-rocket/constants';
import {
  CSS_STYLE_STATES,
  NO_STYLESHEET_PAGE_FACTS,
  type CssStateId,
  type CssStyleResource
} from './style-states';

describe('buildStylesheetRows — Critical placement', () => {
  it('puts the chip on the live style when the page still has it (no snapshot row)', () => {
    const built = rows([link(), inline({ id: 'rocket-critical-css' })]);
    expect(built.map((row) => [row.id, row.source, row.critical])).toEqual([
      [0, 'live', false],
      [1, 'live', true]
    ]);
  });

  it('adds one leading snapshot row when the page removed it', () => {
    const built = rows([link()]);
    expect(built).toHaveLength(2);
    expect(built[0]).toMatchObject({
      id: CRITICAL_SNAPSHOT_ROW_ID,
      source: 'snapshot',
      type: 'inline',
      elementId: 'rocket-critical-css',
      preview: '',
      chars: 0,
      critical: true
    });
    expect(built.filter((row) => row.critical)).toHaveLength(1);
    // A page with no styles left still shows what the snapshot saw.
    expect(rows([]).map((row) => row.source)).toEqual(['snapshot']);
  });

  it('shows Critical nowhere when the snapshot saw no critical style', () => {
    const late = rows([inline({ id: 'rocket-critical-css' })], { ...ALL, criticalStyle: false });
    expect(late.map((row) => row.critical)).toEqual([false]);
    expect(rows([link()], NO_STYLESHEET_PAGE_FACTS).map((row) => row.source)).toEqual(['live']);
  });
});

describe('buildStylesheetRows — a cut list', () => {
  it('never adds the snapshot row: the live style may sit past the cut', () => {
    const cutReply = { styles: [link()], total: 2_001 };
    expect(buildStylesheetRows(cutReply, ALL).map((row) => row.source)).toEqual(['live']);
    // A listed live critical style still reads Critical on a cut list.
    const listed = { styles: [inline({ id: 'rocket-critical-css' })], total: 2_001 };
    expect(buildStylesheetRows(listed, ALL).map((row) => row.critical)).toEqual([true]);
  });

  it('keeps the row count to the listed styles', () => {
    const styles = [link(), inline()];
    expect(buildStylesheetRows({ styles, total: 3 }, ALL)).toHaveLength(2);
    // Uncut (total equals the list): the snapshot row leads.
    expect(buildStylesheetRows({ styles, total: 2 }, ALL)).toHaveLength(3);
  });
});

describe('buildStylesheetRows — fields and search', () => {
  it('copies the entry fields and searches a link by URL, an inline style by identity and CSS', () => {
    const [external, style] = rows(
      [
        link({ href: MINIFIED, media: 'print', rocketAsync: true, hostedFont: true }),
        inline({ id: 'theme', className: 'a b', preview: '.x{}' })
      ],
      { ...ALL, criticalStyle: false }
    );
    expect(external).toMatchObject({
      type: 'external',
      href: MINIFIED,
      media: 'print',
      content: MINIFIED,
      minified: true,
      rocketAsync: true,
      hostedFont: true
    });
    expect(style).toMatchObject({ type: 'inline', content: '#theme.a.b .x{}', chars: 4 });
    expect(rows([inline({ preview: '' })], NO_STYLESHEET_PAGE_FACTS)[0]?.content).toBe('');
  });
});

/** Each style state → the facet selection that keeps its rows (a value of WP Rocket CSS, or a toggle). */
const STATE_SELECTIONS: Readonly<Record<CssStateId, FacetSelection<CssFacetId>>> = {
  critical: { 'rocket-css': 'critical' },
  rucss: { 'rocket-css': 'rucss' },
  'lazy-bg': { 'rocket-css': 'lazy-bg' },
  async: { async: 'yes' },
  minified: { minified: 'yes' },
  font: { font: 'yes' }
};

describe('the state values', () => {
  it('has a value per state, labeled as its chip, each keeping exactly the rows showing that chip', () => {
    const built = rows([
      inline({ id: 'wpr-usedcss' }),
      inline({ id: 'wpr-lazyload-bg-container' }),
      link({ href: MINIFIED, rocketAsync: true }),
      link({ hostedFont: true }),
      link()
    ]);
    const labels = new Map(
      CSS_PAGE_FACETS.facets.flatMap((facet) =>
        facet.values.map((value) => [facet.kind === 'toggle' ? facet.id : value.id, value.label])
      )
    );
    for (const state of CSS_STYLE_STATES) {
      expect(labels.get(state.id), state.id).toBe(state.label);
      expect(
        applyFacets(built, CSS_PAGE_FACETS, STATE_SELECTIONS[state.id], {
          field: cssStyleSearchField,
          query: ''
        })
      ).toEqual(built.filter((row) => statesOf(row).includes(state.id)));
    }
  });

  it('counts every value from one pass, the snapshot row as an inline style; the field is the content', () => {
    const counts = facetCounts(
      rows([link({ href: MINIFIED, rocketAsync: true }), inline({ id: 'wpr-usedcss' })]),
      CSS_PAGE_FACETS,
      {},
      { field: cssStyleSearchField, query: '' }
    );
    expect(counts.matched).toBe(3);
    expect(counts.byFacet).toEqual({
      type: { any: 3, inline: 2, external: 1 },
      'rocket-css': { any: 3, critical: 1, rucss: 1, 'lazy-bg': 0 },
      async: { any: 3, yes: 1 },
      minified: { any: 3, yes: 1 },
      font: { any: 3, yes: 0 }
    });
    expect(cssStyleSearchField(rows([link()])[1] as CssStyleResource)).toBe(
      'https://s.test/plain.css'
    );
  });
});

describe('CSS_PAGE_FACETS', () => {
  /**
   * Edge rows: every state, stacked link states, a link wearing RUCSS's
   * reserved id, plain rows — plus a second list whose critical style is the
   * snapshot row (the two Critical placements in one fixture).
   */
  const STYLES: readonly CssStyleResource[] = [
    ...rows([
      link({ href: 'https://cdn.test/plain.css' }),
      link({ href: MINIFIED }),
      link({ href: MINIFIED, rocketAsync: true }),
      link({ hostedFont: true }),
      link({ rocketAsync: true, hostedFont: true }),
      inline({ id: 'rocket-critical-css' }),
      inline({ id: RUCSS_USED_CSS_ID }),
      inline({ id: LAZYLOAD_BG_CONTAINER_ID }),
      inline({ id: LAZYLOAD_BG_EXCLUSION_ID }),
      // A link with the reserved id is no used-CSS style.
      link({ id: RUCSS_USED_CSS_ID }),
      inline()
    ]),
    ...rows([link(), inline({ preview: '.cdn{}' })])
  ];

  /** Each single value (and no selection) → the {@link STYLES} it keeps. */
  const CSS_CASES: Readonly<Record<string, SelectionCase<CssFacetId>>> = {
    any: { selection: {}, rows: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] },
    // Both Critical placements: the live style and the second list's snapshot row.
    critical: { selection: { 'rocket-css': 'critical' }, rows: [5, 11] },
    // A link wearing the reserved id is no used-CSS style.
    rucss: { selection: { 'rocket-css': 'rucss' }, rows: [6] },
    'lazy-bg': { selection: { 'rocket-css': 'lazy-bg' }, rows: [7, 8] },
    async: { selection: { async: 'yes' }, rows: [2, 4] },
    minified: { selection: { minified: 'yes' }, rows: [1, 2] },
    font: { selection: { font: 'yes' }, rows: [3, 4] },
    inline: { selection: { type: 'inline' }, rows: [5, 6, 7, 8, 10, 11, 13] },
    external: { selection: { type: 'external' }, rows: [0, 1, 2, 3, 4, 9, 12] }
  };

  it('holds both Critical placements in the fixture', () => {
    expect(STYLES.filter((row) => row.critical).map((row) => row.source)).toEqual([
      'live',
      'snapshot'
    ]);
  });

  it('keeps exactly its rows under each single value (with and without a query)', () => {
    for (const query of ['', 'cdn', 'WPR-']) {
      expect(
        selectionMismatches(STYLES, CSS_PAGE_FACETS, cssStyleSearchField, CSS_CASES, query)
      ).toEqual([]);
    }
  });

  it('keeps the WP Rocket CSS values exclusive; the link states stack (toggles)', () => {
    expect(exclusivityViolations(STYLES, CSS_PAGE_FACETS)).toEqual([]);
    const stacked = applyFacets(
      STYLES,
      CSS_PAGE_FACETS,
      { async: 'yes', minified: 'yes' },
      { field: (row) => row.content, query: '' }
    );
    expect(stacked.map((row) => row.href)).toEqual([MINIFIED]);
  });

  it('counts the link toggles given the Type selection', () => {
    const counts = facetCounts(
      STYLES,
      CSS_PAGE_FACETS,
      { type: 'inline' },
      { field: (row) => row.content, query: '' }
    );
    expect(counts.byFacet.async).toEqual({ any: 7, yes: 0 });
    expect(counts.byFacet['rocket-css']).toEqual({ any: 7, critical: 2, rucss: 1, 'lazy-bg': 2 });
  });
});
