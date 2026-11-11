import { describe, expect, it } from 'vitest';
import type { LazyloadImageResource } from '../../../../lib/panel/resources-view-model';
import { FDT_EXCLUDED_RESOURCE } from '../../../../lib/wp-rocket/constants';
import { NO_STATE_CHIPS, UNVERIFIED_SIMULATION_SUFFIX } from '../resource-list/state-chips';
import {
  exclusionReasons,
  LAZY_MARKUP_NOTE,
  LAZYLOAD_CHIP_SOURCES,
  LAZYLOAD_ROW_ESTIMATE,
  LAZYLOAD_ROW_WITH_REASONS_ESTIMATE,
  lazyloadChipFacts,
  lazyloadChipSplit,
  lazyloadChipTable,
  lazyloadNotes,
  lazyloadRowEstimate,
  lazyloadRowView,
  NO_LAZYLOAD_CHIP_FACTS,
  PAGE_LAZY_MARKUP_TITLE,
  sameImageRow,
  sameImageRowView,
  sameLazyloadChipFacts,
  showLazyloadReasons,
  type LazyloadChipTable,
  type LazyloadRowView
} from './lazyload-rows';
import type { SimulationFact } from '../../../../lib/wp-rocket/types';

/** One image row with overrides. */
function row(overrides: Partial<LazyloadImageResource> = {}): LazyloadImageResource {
  return {
    id: 0,
    src: 'https://cdn.example/a.jpg',
    lazyloaded: false,
    excludedReasons: [],
    ...overrides
  };
}

/** The chip table for a fact set (WP Rocket's LazyLoad detected unless said otherwise). */
function table(simulation: SimulationFact | null = null, present = true): LazyloadChipTable {
  return lazyloadChipTable({ present, simulation });
}

describe('lazyloadChipSplit', () => {
  const lazy = row({ lazyloaded: true });
  const marked = row({ excludedReasons: ['data-src', FDT_EXCLUDED_RESOURCE] });

  it('WP Rocket’s LazyLoad detected, no marker: a lazyloaded image is WP Rocket’s, named with the feature', () => {
    expect(lazyloadChipSplit(lazy, table())).toEqual({
      visible: [
        {
          id: 'lazyloaded',
          label: 'Lazyloaded',
          source: 'wp-rocket',
          title: 'Lazyloaded by WP Rocket (LazyLoad for images)'
        }
      ],
      overflow: null
    });
  });

  it('WP Rocket’s LazyLoad not detected: the lazy markup is the page’s own (any plugin writes it)', () => {
    expect(lazyloadChipSplit(lazy, table(null, false)).visible).toEqual([
      { id: 'lazyloaded', label: 'Lazyloaded', source: 'page', title: PAGE_LAZY_MARKUP_TITLE }
    ]);
    expect(PAGE_LAZY_MARKUP_TITLE).toBe(
      "Lazy markup on the page (WP Rocket's LazyLoad not detected)"
    );
    // An unverified marker vouches for nothing either; the hover still flags it.
    expect(lazyloadChipSplit(lazy, table('unverified', false)).visible).toEqual([
      {
        id: 'lazyloaded',
        label: 'Lazyloaded',
        source: 'page',
        title: `${PAGE_LAZY_MARKUP_TITLE}${UNVERIFIED_SIMULATION_SUFFIX}`
      }
    ]);
  });

  it('a verified simulation produced it: the simulation’s source and title (WP Rocket absent)', () => {
    expect(lazyloadChipSplit(lazy, table('simulated', false)).visible).toEqual([
      {
        id: 'lazyloaded',
        label: 'Lazyloaded',
        source: 'simulated',
        title: "Lazyloaded by the FDT's LazyLoad for images simulation"
      }
    ]);
  });

  it('an unverified marker on a detected page keeps WP Rocket and flags the title', () => {
    const [chip] = lazyloadChipSplit(lazy, table('unverified')).visible;
    expect(chip?.source).toBe('wp-rocket');
    expect(chip?.title).toBe(
      `Lazyloaded by WP Rocket (LazyLoad for images)${UNVERIFIED_SIMULATION_SUFFIX}`
    );
  });

  it.each([
    [null, true],
    [null, false],
    ['simulated', false],
    ['unverified', true]
  ] as const)(
    'the FDT marker reads Excluded (FDT exclusion) whatever the facts (%s, %s)',
    (fact, present) => {
      expect(lazyloadChipSplit(marked, table(fact, present)).visible).toEqual([
        {
          id: 'excluded',
          label: 'Excluded',
          source: 'excluded',
          title: 'Excluded by FDT from LazyLoad for images'
        }
      ]);
    }
  );

  it('a non-lazyloaded image without the marker shows no chip (the filter keeps it)', () => {
    expect(lazyloadChipSplit(row(), table())).toBe(NO_STATE_CHIPS);
    expect(lazyloadChipSplit(row({ excludedReasons: ['skip-lazy'] }), table('simulated'))).toBe(
      NO_STATE_CHIPS
    );
  });

  it('every chip source is one the legend declares, and every declared source is reachable', () => {
    const seen = new Set<string>();
    for (const fact of [null, 'simulated', 'unverified'] as const) {
      for (const present of [true, false]) {
        for (const image of [lazy, marked]) {
          for (const chip of lazyloadChipSplit(image, table(fact, present)).visible) {
            expect(LAZYLOAD_CHIP_SOURCES).toContain(chip.source);
            seen.add(chip.source);
          }
        }
      }
    }
    expect([...seen].sort()).toEqual([...LAZYLOAD_CHIP_SOURCES].sort());
    expect(LAZYLOAD_CHIP_SOURCES).toEqual(['wp-rocket', 'simulated', 'excluded', 'page']);
  });
});

describe('chip facts and row views', () => {
  it('reads the facts off the detection, none while no data is mounted', () => {
    expect(lazyloadChipFacts(null)).toBe(NO_LAZYLOAD_CHIP_FACTS);
    expect(lazyloadChipFacts({ present: true, images: [] })).toEqual({
      present: true,
      simulation: null
    });
    expect(lazyloadChipFacts({ present: false, simulation: 'simulated', images: [] })).toEqual({
      present: false,
      simulation: 'simulated'
    });
  });

  it('compares fact sets field by field', () => {
    const base = { present: true, simulation: null };
    expect(sameLazyloadChipFacts(base, { ...base })).toBe(true);
    expect(sameLazyloadChipFacts(base, { ...base, present: false })).toBe(false);
    expect(sameLazyloadChipFacts(base, { ...base, simulation: 'unverified' })).toBe(false);
  });

  it('a row view carries its row and its split', () => {
    const chips = table();
    const view = lazyloadRowView(row({ lazyloaded: true }), chips);
    expect(view.lazyloaded).toBe(true);
    expect(view.chips.visible).toEqual([chips.lazyloaded]);
  });

  it('views match only with the same data and chips that read the same', () => {
    const chips = table();
    const a = lazyloadRowView(row({ lazyloaded: true }), chips);
    expect(sameImageRowView(a, lazyloadRowView(row({ lazyloaded: true }), chips))).toBe(true);
    // A new fact set builds a new table: every view re-derives.
    expect(
      sameImageRowView(a, lazyloadRowView(row({ lazyloaded: true }), table('simulated')))
    ).toBe(false);
    expect(sameImageRowView(a, lazyloadRowView(row(), chips))).toBe(false);
    const plain = lazyloadRowView(row(), chips);
    expect(sameImageRowView(plain, lazyloadRowView(row(), table('simulated')))).toBe(true);
  });

  it('views with a "+N" chip compare its title', () => {
    const chips = table();
    const base = lazyloadRowView(row({ lazyloaded: true }), chips);
    const overflow = (title: string): LazyloadRowView => ({
      ...base,
      chips: { visible: base.chips.visible, overflow: { label: '+1', title, hidesWpRocket: false } }
    });
    expect(sameImageRowView(overflow('Also: A (page)'), overflow('Also: A (page)'))).toBe(true);
    expect(sameImageRowView(overflow('Also: A (page)'), overflow('Also: B (page)'))).toBe(false);
    expect(sameImageRowView(base, overflow('Also: A (page)'))).toBe(false);
  });
});

describe('exclusionReasons', () => {
  it('pulls the tool marker out and keeps every other reason in order', () => {
    expect(
      exclusionReasons(row({ excludedReasons: ['data-src', FDT_EXCLUDED_RESOURCE, 'skip-lazy'] }))
    ).toEqual({ excludedByTool: true, reasons: ['data-src', 'skip-lazy'] });
  });

  it('reports no marker and no reasons for an empty list', () => {
    expect(exclusionReasons(row())).toEqual({ excludedByTool: false, reasons: [] });
  });

  it('keeps the page reasons when the marker is absent', () => {
    expect(exclusionReasons(row({ excludedReasons: ['loading="eager"'] }))).toEqual({
      excludedByTool: false,
      reasons: ['loading="eager"']
    });
  });
});

describe('showLazyloadReasons', () => {
  it.each([
    [true, true, false],
    [true, false, true],
    [false, true, false],
    [false, false, false]
  ])('feature present %s, image lazyloaded %s → reasons %s', (present, lazyloaded, expected) => {
    const image = row({ lazyloaded });
    expect(showLazyloadReasons(image, present)).toBe(expected);
    expect(lazyloadRowEstimate(image, present)).toBe(
      expected ? LAZYLOAD_ROW_WITH_REASONS_ESTIMATE : LAZYLOAD_ROW_ESTIMATE
    );
  });

  it('the marker alone is no reasons line (its chip says it); beside page reasons the line stays', () => {
    const only = row({ excludedReasons: [FDT_EXCLUDED_RESOURCE] });
    expect(showLazyloadReasons(only, true)).toBe(false);
    expect(lazyloadRowEstimate(only, true)).toBe(LAZYLOAD_ROW_ESTIMATE);
    const both = row({ excludedReasons: ['skip-lazy', FDT_EXCLUDED_RESOURCE] });
    expect(showLazyloadReasons(both, true)).toBe(true);
    expect(showLazyloadReasons(both, false)).toBe(false);
  });
});

describe('lazyloadRowEstimate', () => {
  it('seeds lazyloaded rows without the reasons line', () => {
    expect(lazyloadRowEstimate(row({ lazyloaded: true }), true)).toBe(LAZYLOAD_ROW_ESTIMATE);
    expect(lazyloadRowEstimate(row(), true)).toBe(LAZYLOAD_ROW_WITH_REASONS_ESTIMATE);
    expect(LAZYLOAD_ROW_WITH_REASONS_ESTIMATE).toBeGreaterThan(LAZYLOAD_ROW_ESTIMATE);
  });
});

describe('sameImageRow', () => {
  it('matches only rows that look the same', () => {
    const base = row({ excludedReasons: ['data-src', 'skip-lazy'] });
    expect(sameImageRow(base, { ...base, excludedReasons: ['data-src', 'skip-lazy'] })).toBe(true);
    expect(sameImageRow(base, { ...base, src: 'https://cdn.example/b.jpg' })).toBe(false);
    expect(sameImageRow(base, { ...base, lazyloaded: true })).toBe(false);
    expect(sameImageRow(base, { ...base, excludedReasons: ['skip-lazy', 'data-src'] })).toBe(false);
    expect(sameImageRow(base, { ...base, excludedReasons: ['data-src'] })).toBe(false);
  });
});

describe('lazyloadNotes', () => {
  const image = {
    src: 'https://cdn.example/a.jpg',
    lazyloadDetected: false,
    excludedReasonsFound: []
  };

  it('says nothing for a complete, consistent detection', () => {
    expect(lazyloadNotes({ present: true, images: [image] })).toEqual([]);
    expect(lazyloadNotes({ present: false, images: [image] })).toEqual([]);
  });

  it('notes the cap only with the mark and a list at its cap', () => {
    const full = Array.from({ length: 5000 }, () => image);
    expect(lazyloadNotes({ present: true, images: full, truncated: true })).toEqual([
      'The list was capped at the first 5,000 images; counts cover these rows.'
    ]);
    expect(lazyloadNotes({ present: true, images: full })).toEqual([]);
    expect(lazyloadNotes({ present: true, images: [image], truncated: true })).toEqual([]);
  });

  it('says a verified simulation runs LazyLoad, never that its script is missing', () => {
    const images = [{ ...image, lazyloadDetected: true }];
    expect(lazyloadNotes({ present: false, simulation: 'simulated', images })).toEqual([
      "Simulated in this tab by the extension — not the site's configuration; its own WP Rocket exclusions aren't included."
    ]);
    // An unverified marker proves nothing: the page reads as served.
    expect(lazyloadNotes({ present: false, simulation: 'unverified', images })).toEqual([
      LAZY_MARKUP_NOTE
    ]);
  });

  it('explains lazyloaded images while the feature reads absent', () => {
    const notes = lazyloadNotes({ present: false, images: [{ ...image, lazyloadDetected: true }] });
    expect(notes).toEqual([LAZY_MARKUP_NOTE]);
    // Names no author for the markup, and claims nothing about the script.
    expect(LAZY_MARKUP_NOTE).toBe(
      "Some images carry lazy-load markup, but WP Rocket's LazyLoad was not detected on this page."
    );
  });
});
