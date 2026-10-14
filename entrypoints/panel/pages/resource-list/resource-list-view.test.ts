import { describe, expect, it } from 'vitest';
import {
  LAZYLOAD_PAGE_RESOURCES,
  PRELOADED_PAGE_RESOURCES,
  type ResourcePageDefinition
} from '../../../../lib/panel/resources-view-model';
import {
  buildFilterChips,
  countLabel,
  defaultChipId,
  narrowingChipLabel,
  normalizeQuery,
  resourceName,
  resultsAnnouncement
} from './resource-list-view';

const IMAGES = { one: 'image', other: 'images' };

describe('countLabel', () => {
  it.each([
    [0, '0 images'],
    [1, '1 image'],
    [2, '2 images'],
    [5000, '5000 images']
  ])('%i → %s', (count, expected) => {
    expect(countLabel(count, IMAGES)).toBe(expected);
  });
});

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
      { all: 3, lazyloaded: 2, 'non-lazyloaded': 1 },
      'all'
    );
    expect(chips).toEqual([
      { value: 'all', label: 'Show All', count: 3, disabled: false },
      { value: 'lazyloaded', label: 'Lazyloaded', count: 2, disabled: false },
      { value: 'non-lazyloaded', label: 'Non-lazyloaded', count: 1, disabled: false }
    ]);
  });

  it('disables zero-count chips but never the default or the selected one', () => {
    const chips = buildFilterChips(
      PRELOADED_PAGE_RESOURCES,
      { all: 0, images: 0, fonts: 0 },
      'fonts'
    );
    expect(chips.map((chip) => [chip.value, chip.disabled])).toEqual([
      ['all', false],
      ['images', true],
      ['fonts', false]
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

describe('resultsAnnouncement', () => {
  it('says none, all, or "N of M"', () => {
    expect(resultsAnnouncement(0, 4, IMAGES)).toBe('No images match');
    expect(resultsAnnouncement(4, 4, IMAGES)).toBe('Showing all 4 images');
    expect(resultsAnnouncement(1, 1, IMAGES)).toBe('Showing all 1 image');
    expect(resultsAnnouncement(1, 4, IMAGES)).toBe('Showing 1 of 4 images');
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

  it('names a scripted URL as plain text (never executed or linked)', () => {
    expect(resourceName('javascript:alert(1)')).toBe('alert(1)');
  });
});
