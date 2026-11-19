import { describe, expect, it } from 'vitest';
import { capTitle, TITLE_MAX } from '../../../../utils/cap-text';
import {
  LAZYLOAD_PAGE_RESOURCES,
  PRELOADED_PAGE_RESOURCES,
  type ResourcePageDefinition
} from '../../../../lib/panel/resources-view-model';
import {
  buildFilterChips,
  listCapped,
  reconcileRows,
  urlClipped,
  urlPreview,
  defaultChipId,
  narrowingChipLabel,
  normalizeQuery,
  resourceName
} from './resource-list-view';

describe('defaultChipId', () => {
  it('is the first chip of each shipped definition ("all")', () => {
    expect(defaultChipId(LAZYLOAD_PAGE_RESOURCES)).toBe('all');
    expect(defaultChipId(PRELOADED_PAGE_RESOURCES)).toBe('all');
  });

  it('throws for a definition without chips (wiring bug, named)', () => {
    const empty: ResourcePageDefinition<number, string> = { filters: [], searchField: String };
    expect(() => defaultChipId(empty)).toThrow(/no filter chips/);
  });
});

describe('buildFilterChips', () => {
  it('maps every chip in order with its count and label', () => {
    const chips = buildFilterChips(
      LAZYLOAD_PAGE_RESOURCES,
      { all: 3, lazyloaded: 2, 'non-lazyloaded': 1, excluded: 0 },
      'all'
    );
    expect(chips).toEqual([
      { value: 'all', label: 'Show all', count: 3, disabled: false },
      { value: 'lazyloaded', label: 'Lazyloaded', count: 2, disabled: false },
      { value: 'non-lazyloaded', label: 'Non-lazyloaded', count: 1, disabled: false },
      { value: 'excluded', label: 'Excluded', count: 0, disabled: true }
    ]);
  });

  it('disables zero-count chips but never the default or the selected one', () => {
    const chips = buildFilterChips(
      PRELOADED_PAGE_RESOURCES,
      {
        all: 0,
        'wp-rocket': 0,
        unattributed: 2,
        preload: 0,
        images: 0,
        fonts: 0,
        modulepreload: 0,
        preconnect: 0,
        'dns-prefetch': 0
      },
      'fonts'
    );
    expect(chips.map((chip) => [chip.value, chip.disabled])).toEqual([
      ['all', false],
      ['wp-rocket', true],
      ['unattributed', false],
      ['preload', true],
      ['images', true],
      ['fonts', false],
      ['modulepreload', true],
      ['preconnect', true],
      ['dns-prefetch', true]
    ]);
  });
});

describe('narrowingChipLabel', () => {
  it('names a narrowing chip and stays silent for the default one', () => {
    expect(narrowingChipLabel(LAZYLOAD_PAGE_RESOURCES, 'all')).toBeUndefined();
    expect(narrowingChipLabel(LAZYLOAD_PAGE_RESOURCES, 'non-lazyloaded')).toBe('Non-lazyloaded');
  });
});

describe('normalizeQuery', () => {
  it.each([
    ['', ''],
    ['   ', ''],
    ['  hero.webp ', 'hero.webp'],
    ['a b', 'a b']
  ])('%j → %j', (raw, expected) => {
    expect(normalizeQuery(raw)).toBe(expected);
  });
});

describe('resourceName', () => {
  it.each([
    ['https://cdn.example/wp-content/uploads/hero.webp', 'hero.webp'],
    ['https://cdn.example/uploads/hero.webp?ver=1#x', 'hero.webp'],
    ['https://cdn.example/uploads/folder/', 'folder'],
    ['https://cdn.example/', 'cdn.example'],
    ['https://cdn.example:8443', 'cdn.example:8443'],
    ['/wp-content/uploads/relative.jpg', 'relative.jpg'],
    ['relative.jpg', 'relative.jpg'],
    ['//cdn.example/protocol-relative.png', 'protocol-relative.png'],
    ['//cdn.example', 'cdn.example'],
    ['/', '/'],
    ['https://site.test/wp-includes/js/jquery/jquery.min.js?ver=3.7.1', 'jquery.min.js'],
    ['https://site.test/wp-content/themes/t/style.css?ver=6.5#main', 'style.css'],
    ['https://site.test/a%20b%2Fc.css', 'a b/c.css'],
    ['data:text/css,/*a*/', 'data:text/css'],
    ['https://cdn.example/caf%C3%A9.jpg', 'café.jpg'],
    ['https://cdn.example/bad%E0%A4%A.jpg', 'bad%E0%A4%A.jpg'],
    ['data:image/svg+xml,%3Csvg%3E%3C/svg%3E', 'data:image/svg+xml'],
    ['DATA:image/png;base64,AAAA', 'data:image/png'],
    ['data:,hello', 'data:'],
    ['?only-a-query', '?only-a-query'],
    ['  https://cdn.example/spaced.png  ', 'spaced.png'],
    ['', ''],
    ['   ', '']
  ])('%j → %j', (url, expected) => {
    expect(resourceName(url)).toBe(expected);
  });

  it('keeps unparseable input as text', () => {
    expect(resourceName('http://[bad')).toBe('http://[bad');
  });

  it('names a non-web scheme by its scheme (no fake file name)', () => {
    expect(resourceName('javascript:alert(1)')).toBe('javascript: URL');
    expect(resourceName('mailto:a@b.example')).toBe('mailto: URL');
  });

  it('names a blob URL by its last segment', () => {
    expect(resourceName('blob:https://cdn.example/3f2a')).toBe('3f2a');
  });
});

describe('capTitle', () => {
  it('keeps short text and elides long text by code point', () => {
    expect(capTitle('a.jpg')).toBe('a.jpg');
    const long = '😀'.repeat(TITLE_MAX + 5);
    const capped = capTitle(long);
    expect(Array.from(capped)).toHaveLength(TITLE_MAX + 1);
    expect(capped.endsWith('…')).toBe(true);
    expect(capTitle('x'.repeat(TITLE_MAX))).toBe('x'.repeat(TITLE_MAX));
  });
});

describe('reconcileRows', () => {
  interface Row {
    readonly id: number;
    readonly v: string;
  }
  const same = (a: Row, b: Row): boolean => a.v === b.v;

  it('returns the previous array when nothing changed', () => {
    const previous: Row[] = [
      { id: 0, v: 'a' },
      { id: 1, v: 'b' }
    ];
    expect(
      reconcileRows(
        previous,
        [
          { id: 0, v: 'a' },
          { id: 1, v: 'b' }
        ],
        same
      )
    ).toBe(previous);
  });

  it('keeps unchanged row objects and takes fresh ones for changed or new rows', () => {
    const a = { id: 0, v: 'a' };
    const b = { id: 1, v: 'b' };
    const changed = { id: 1, v: 'B' };
    const added = { id: 2, v: 'c' };
    const next = reconcileRows([a, b], [{ id: 0, v: 'a' }, changed, added], same);
    expect(next[0]).toBe(a);
    expect(next[1]).toBe(changed);
    expect(next[2]).toBe(added);
  });

  it('reports a reorder or a removal as a change', () => {
    const a = { id: 0, v: 'a' };
    const b = { id: 1, v: 'b' };
    const reordered = reconcileRows(
      [a, b],
      [
        { id: 1, v: 'b' },
        { id: 0, v: 'a' }
      ],
      same
    );
    expect(reordered).toEqual([b, a]);
    expect(reordered[0]).toBe(b);
    expect(reconcileRows([a, b], [{ id: 0, v: 'a' }], same)).toEqual([a]);
  });

  it('starts from an empty previous list', () => {
    const next = [{ id: 0, v: 'a' }];
    expect(reconcileRows([], next, same)[0]).toBe(next[0]);
  });
});

describe('listCapped', () => {
  it('needs the mark AND a list at its cap (a clipped string alone sets the mark)', () => {
    expect(listCapped(true, 5000, 5000)).toBe(true);
    expect(listCapped(true, 4999, 5000)).toBe(false);
    expect(listCapped(undefined, 5000, 5000)).toBe(false);
  });
});

describe('urlClipped', () => {
  it('flags a marked URL at the cap or one unit short (surrogate-safe clip)', () => {
    expect(urlClipped(true, 'x'.repeat(4096), 4096)).toBe(true);
    expect(urlClipped(true, 'x'.repeat(4095), 4096)).toBe(true);
    expect(urlClipped(true, 'x'.repeat(4094), 4096)).toBe(false);
    expect(urlClipped(undefined, 'x'.repeat(4096), 4096)).toBe(false);
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
