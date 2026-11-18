/**
 * The Stylesheets page's rows: the Critical placement (live row / snapshot
 * row / never both / nowhere without the snapshot fact / never on a cut
 * list), the copied fields and searched text, and the page's filters (a
 * filter selects exactly the rows showing its chip).
 */
import { describe, expect, it } from 'vitest';
import { chipParityMismatches, exclusivityViolations } from './facet-parity.fixtures';
import { applyFacets, facetCounts, type FacetSelection } from './resource-facets';
import { filterCounts } from './resources-view-model';
import { ALL, MINIFIED, inline, link, rows, statesOf } from './stylesheet.fixtures';
import {
  CRITICAL_SNAPSHOT_ROW_ID,
  CSS_PAGE_FACETS,
  CSS_PAGE_RESOURCES,
  buildStylesheetRows,
  type CssFacetId,
  type CssFilterId
} from './stylesheet-rows';
import {
  LAZYLOAD_BG_CONTAINER_ID,
  LAZYLOAD_BG_EXCLUSION_ID,
  RUCSS_USED_CSS_ID
} from '../wp-rocket/constants';
import { CSS_STYLE_STATES, NO_STYLESHEET_PAGE_FACTS, type CssStyleResource } from './style-states';

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

describe('CSS_PAGE_RESOURCES', () => {
  it('has a filter per state, each selecting exactly the rows showing that chip', () => {
    const built = rows([
      inline({ id: 'wpr-usedcss' }),
      inline({ id: 'wpr-lazyload-bg-container' }),
      link({ href: MINIFIED, rocketAsync: true }),
      link({ hostedFont: true }),
      link()
    ]);
    for (const state of CSS_STYLE_STATES) {
      const filter = CSS_PAGE_RESOURCES.filters.find((row) => row.id === state.id);
      expect(filter?.label, state.id).toBe(state.label);
      expect(built.filter((row) => filter?.predicate(row) === true)).toEqual(
        built.filter((row) => statesOf(row).includes(state.id))
      );
    }
  });

  it('counts every chip from one pass, the snapshot row as an inline style', () => {
    expect(
      filterCounts(
        rows([link({ href: MINIFIED, rocketAsync: true }), inline({ id: 'wpr-usedcss' })]),
        CSS_PAGE_RESOURCES
      )
    ).toEqual({
      all: 3,
      critical: 1,
      rucss: 1,
      'lazy-bg': 0,
      async: 1,
      minified: 1,
      font: 0,
      inline: 2,
      external: 1
    });
    expect(CSS_PAGE_RESOURCES.searchField(rows([link()])[1] as CssStyleResource)).toBe(
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

  /** Old Stylesheets chip → its one facet selection (every chip reachable as one selection). */
  const CSS_CHIP_MAP: Record<CssFilterId, FacetSelection<CssFacetId>> = {
    all: {},
    critical: { 'rocket-css': 'critical' },
    rucss: { 'rocket-css': 'rucss' },
    'lazy-bg': { 'rocket-css': 'lazy-bg' },
    async: { async: 'yes' },
    minified: { minified: 'yes' },
    font: { font: 'yes' },
    inline: { type: 'inline' },
    external: { type: 'external' }
  };

  it('holds both Critical placements in the fixture', () => {
    expect(STYLES.filter((row) => row.critical).map((row) => row.source)).toEqual([
      'live',
      'snapshot'
    ]);
  });

  it('reaches every chip as one selection with the same rows (with and without a query)', () => {
    for (const query of ['', 'cdn', 'WPR-']) {
      expect(
        chipParityMismatches(STYLES, CSS_PAGE_RESOURCES, CSS_PAGE_FACETS, CSS_CHIP_MAP, query)
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
