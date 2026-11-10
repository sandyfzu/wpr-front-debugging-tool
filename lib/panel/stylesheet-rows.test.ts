/**
 * The Stylesheets page's rows: the Critical placement (live row / snapshot
 * row / never both / nowhere without the snapshot fact / never on a cut
 * list), the copied fields and searched text, and the page's filters (a
 * filter selects exactly the rows showing its chip).
 */
import { describe, expect, it } from 'vitest';
import { filterCounts } from './resources-view-model';
import { ALL, MINIFIED, inline, link, rows, statesOf } from './stylesheet.fixtures';
import {
  CRITICAL_SNAPSHOT_ROW_ID,
  CSS_PAGE_RESOURCES,
  buildStylesheetRows
} from './stylesheet-rows';
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
