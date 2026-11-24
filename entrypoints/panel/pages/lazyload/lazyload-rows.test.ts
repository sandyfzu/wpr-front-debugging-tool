import { describe, expect, it } from 'vitest';
import type { LazyloadImageResource } from '../../../../lib/panel/resources-view-model';
import { FDT_EXCLUDED_RESOURCE } from '../../../../lib/wp-rocket/constants';
import { NO_STATE_CHIPS, UNVERIFIED_SIMULATION_SUFFIX } from '../resource-list/state-chips';
import {
  exclusionReasons,
  LAZY_MARKUP_NOTE,
  LAZYLOAD_CHIP_SOURCES,
  LAZYLOAD_VIEW_FACETS,
  lazyloadChipFacts,
  lazyloadChipTable,
  lazyloadFacts,
  lazyloadNotes,
  lazyloadReasonsView,
  lazyloadRowKeys,
  lazyloadRowViews,
  lazyloadSearchField,
  lazyloadStateChips,
  NO_IMAGE_URL_NAME,
  NO_LAZYLOAD_CHIP_FACTS,
  PAGE_LAZY_MARKUP_TITLE,
  sameImageRow,
  sameImageRowView,
  sameLazyloadChipFacts,
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

describe('lazyloadStateChips', () => {
  const lazy = row({ lazyloaded: true });
  const marked = row({ excludedReasons: ['data-src', FDT_EXCLUDED_RESOURCE] });

  it('WP Rocket’s LazyLoad detected, no marker: a lazyloaded image is WP Rocket’s, named with the feature', () => {
    expect(lazyloadStateChips(lazy, table())).toEqual([
      {
        id: 'lazyloaded',
        label: 'Lazy loaded',
        source: 'wp-rocket',
        title: 'Lazy loaded by WP Rocket (LazyLoad for images)'
      }
    ]);
  });

  it('WP Rocket’s LazyLoad not detected: the lazy markup is the page’s own (any plugin writes it)', () => {
    expect(lazyloadStateChips(lazy, table(null, false))).toEqual([
      { id: 'lazyloaded', label: 'Lazy loaded', source: 'page', title: PAGE_LAZY_MARKUP_TITLE }
    ]);
    expect(PAGE_LAZY_MARKUP_TITLE).toBe(
      "Lazy markup on the page (WP Rocket's LazyLoad not detected)"
    );
    // An unverified marker vouches for nothing either; the hover still flags it.
    expect(lazyloadStateChips(lazy, table('unverified', false))).toEqual([
      {
        id: 'lazyloaded',
        label: 'Lazy loaded',
        source: 'page',
        title: `${PAGE_LAZY_MARKUP_TITLE}${UNVERIFIED_SIMULATION_SUFFIX}`
      }
    ]);
  });

  it('a verified simulation produced it: the simulation’s source and title (WP Rocket absent)', () => {
    expect(lazyloadStateChips(lazy, table('simulated', false))).toEqual([
      {
        id: 'lazyloaded',
        label: 'Lazy loaded',
        source: 'simulated',
        title: "Lazy loaded by the FDT's LazyLoad for images simulation"
      }
    ]);
  });

  it('an unverified marker on a detected page keeps WP Rocket and flags the title', () => {
    const [chip] = lazyloadStateChips(lazy, table('unverified'));
    expect(chip?.source).toBe('wp-rocket');
    expect(chip?.title).toBe(
      `Lazy loaded by WP Rocket (LazyLoad for images)${UNVERIFIED_SIMULATION_SUFFIX}`
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
      expect(lazyloadStateChips(marked, table(fact, present))).toEqual([
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
    expect(lazyloadStateChips(row(), table())).toEqual([]);
    expect(lazyloadStateChips(row({ excludedReasons: ['skip-lazy'] }), table('simulated'))).toEqual(
      []
    );
  });

  it('every chip source is one the legend declares, and every declared source is reachable', () => {
    const seen = new Set<string>();
    for (const fact of [null, 'simulated', 'unverified'] as const) {
      for (const present of [true, false]) {
        for (const image of [lazy, marked]) {
          for (const chip of lazyloadStateChips(image, table(fact, present))) {
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

  it('keys rows by URL and occurrence, never position', () => {
    const rows = [row({ src: 'a' }), row({ src: 'b' }), row({ src: 'a' }), row({ src: '' })];
    const keys = lazyloadRowKeys(rows);
    expect(new Set(keys).size).toBe(4);
    // An image added above shifts no key.
    const shifted = lazyloadRowKeys([row({ src: 'new' }), ...rows]).slice(1);
    expect(shifted).toEqual(keys);
    expect(lazyloadRowKeys([])).toEqual([]);
  });

  it('builds a view per row: name, preview, clip mark, every chip and the calm split', () => {
    const chips = table();
    const [lazyView, plain, empty] = lazyloadRowViews(
      [
        row({ src: 'https://cdn.example/a/hero.jpg?v=2', lazyloaded: true }),
        row({ src: '/rel/plain.png' }),
        row({ src: '' })
      ],
      chips,
      (src) => src.endsWith('?v=2')
    );
    expect(lazyView).toMatchObject({
      name: 'hero.jpg',
      preview: 'cdn.example/a/hero.jpg?v=2',
      clipped: true,
      chips: [chips.lazyloaded],
      rowChips: { visible: [chips.lazyloaded], overflow: null }
    });
    // A relative URL is previewed as captured (no scheme to drop).
    expect(plain).toMatchObject({ name: 'plain.png', preview: '/rel/plain.png', clipped: false });
    expect(plain?.rowChips).toBe(NO_STATE_CHIPS);
    expect(empty).toMatchObject({ name: NO_IMAGE_URL_NAME, preview: undefined });
    expect(NO_IMAGE_URL_NAME).toBe('No URL captured');
  });

  it('views match only with the same data, clip mark and chips that read the same', () => {
    const chips = table();
    const view = (
      image: LazyloadImageResource,
      facts: LazyloadChipTable = chips,
      clipped = false
    ): LazyloadRowView => {
      const [built] = lazyloadRowViews([image], facts, () => clipped);
      if (built === undefined) throw new Error('no view');
      return built;
    };
    const a = view(row({ lazyloaded: true }));
    expect(sameImageRowView(a, view(row({ lazyloaded: true })))).toBe(true);
    // A new fact set builds a new table: a chip that reads differently re-derives.
    expect(sameImageRowView(a, view(row({ lazyloaded: true }), table('simulated')))).toBe(false);
    expect(sameImageRowView(a, view(row()))).toBe(false);
    expect(sameImageRowView(a, view(row({ lazyloaded: true }), chips, true))).toBe(false);
    // Position is no content: a moved image is the same view.
    expect(sameImageRowView(a, view(row({ id: 9, lazyloaded: true })))).toBe(true);
    const plain = view(row());
    expect(sameImageRowView(plain, view(row(), table('simulated')))).toBe(true);
  });

  it('searches the image URL and filters by the lifted facets', () => {
    const [lazyView, plain] = lazyloadRowViews(
      [row({ src: 'a.jpg', lazyloaded: true }), row({ src: 'b.jpg' })],
      table(),
      () => false
    );
    if (lazyView === undefined || plain === undefined) throw new Error('no views');
    expect(lazyloadSearchField(lazyView)).toBe('a.jpg');
    const values = LAZYLOAD_VIEW_FACETS.byId
      .get('lazyload')
      ?.values.map((value) => [value.id, value.predicate(lazyView), value.predicate(plain)]);
    expect(values).toEqual([
      ['lazyloaded', true, false],
      ['non-lazyloaded', false, true]
    ]);
  });

  it('lists whether the image is lazyloaded as its one fact', () => {
    expect(lazyloadFacts(row({ lazyloaded: true }))).toEqual([
      { label: 'Lazy loaded', value: 'Yes', mono: false }
    ]);
    expect(lazyloadFacts(row())).toEqual([{ label: 'Lazy loaded', value: 'No', mono: false }]);
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

describe('lazyloadReasonsView', () => {
  it('a lazyloaded image says nothing, running or not', () => {
    const lazy = row({ lazyloaded: true, excludedReasons: ['skip-lazy'] });
    expect(lazyloadReasonsView(lazy, true)).toEqual({ kind: 'hidden' });
    expect(lazyloadReasonsView(lazy, false)).toEqual({ kind: 'hidden' });
  });

  it('lazyload not running: says so instead of listing reasons', () => {
    expect(lazyloadReasonsView(row({ excludedReasons: ['skip-lazy'] }), false)).toEqual({
      kind: 'off'
    });
    expect(lazyloadReasonsView(row(), false)).toEqual({ kind: 'off' });
  });

  it('running: the page reasons in order, else "none found"', () => {
    const reasons = ['data-src', FDT_EXCLUDED_RESOURCE, 'skip'];
    expect(lazyloadReasonsView(row({ excludedReasons: reasons }), true)).toEqual({
      kind: 'reasons',
      reasons: ['data-src', 'skip']
    });
    expect(lazyloadReasonsView(row(), true)).toEqual({ kind: 'none-found' });
  });

  it('the marker alone is no reasons section (its chip says it)', () => {
    expect(lazyloadReasonsView(row({ excludedReasons: [FDT_EXCLUDED_RESOURCE] }), true)).toEqual({
      kind: 'hidden'
    });
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
