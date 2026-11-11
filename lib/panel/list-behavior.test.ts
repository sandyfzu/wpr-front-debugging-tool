/** Shared list contracts, independently of page rendering and identity construction. */
import { describe, expect, it, vi } from 'vitest';
import { boundPreloadedResources, PAYLOAD_LIMITS } from '../messaging/payload-bounds';
import {
  buildFilterChips,
  countLabel,
  defaultChipId,
  fallbackRowKey,
  listCapped,
  normalizeQuery,
  pruneKeyedFlags,
  reconcileList,
  resultsAnnouncement,
  toggleRowFlag,
  type CountNoun
} from './list-behavior';
import {
  JS_PAGE_RESOURCES,
  LAZYLOAD_PAGE_RESOURCES,
  PRELOADED_PAGE_RESOURCES
} from './resources-view-model';

const IMAGES: CountNoun = { one: 'image', other: 'images' };
const SCRIPTS: CountNoun = { one: 'script', other: 'scripts' };

describe('countLabel (shared noun phrasing)', () => {
  it.each([
    [0, '0 images'],
    [1, '1 image'],
    [2, '2 images'],
    [5000, '5,000 images'],
    [1234567, '1,234,567 images']
  ])('%i → %s', (count, expected) => {
    expect(countLabel(count, IMAGES)).toBe(expected);
  });

  it('serves every noun from one rule', () => {
    expect(countLabel(0, SCRIPTS)).toBe('0 scripts');
    expect(countLabel(1, SCRIPTS)).toBe('1 script');
    expect(countLabel(1204, SCRIPTS)).toBe('1,204 scripts');
  });

  it('marks a cut total as a floor, always plural', () => {
    expect(countLabel(5000, SCRIPTS, true)).toBe('5,000+ scripts');
    // A cut list cannot truthfully hold exactly one row, so no singular form.
    expect(countLabel(1, IMAGES, true)).toBe('1+ images');
  });
});

describe('resultsAnnouncement (shared count line)', () => {
  it('says none, all, or "N of M"', () => {
    expect(resultsAnnouncement(0, 4, IMAGES)).toBe('No images match');
    expect(resultsAnnouncement(4, 4, IMAGES)).toBe('Showing all 4 images');
    expect(resultsAnnouncement(1, 1, IMAGES)).toBe('Showing all 1 image');
    expect(resultsAnnouncement(1, 4, IMAGES)).toBe('Showing 1 of 4 images');
    expect(resultsAnnouncement(1200, 5000, SCRIPTS)).toBe('Showing 1,200 of 5,000 scripts');
  });

  it('reserves "No … match" for a filter hiding existing rows; an empty page says nothing', () => {
    // shown === total === 0 is the page's own empty state, not a filtering result.
    expect(resultsAnnouncement(0, 0, IMAGES)).toBe('');
    expect(resultsAnnouncement(0, 3, SCRIPTS)).toBe('No scripts match');
  });
});

describe('shared chip rules', () => {
  it('pins sentence-case labels for every shipped inventory', () => {
    expect(JS_PAGE_RESOURCES.filters.map(({ label }) => label)).toEqual([
      'Show all',
      'Delayed',
      'Non-delayed',
      'Deferred',
      'Non-deferred',
      'Minified',
      'Combined',
      'Excluded',
      'Inline',
      'External'
    ]);
    expect(LAZYLOAD_PAGE_RESOURCES.filters.map(({ label }) => label)).toEqual([
      'Show all',
      'Lazyloaded',
      'Non-lazyloaded',
      'Excluded'
    ]);
    expect(PRELOADED_PAGE_RESOURCES.filters.map(({ label }) => label)).toEqual([
      'Show all',
      'WP Rocket',
      'Unattributed',
      'Preload',
      'Images',
      'Fonts',
      'Module preload',
      'Preconnect',
      'DNS prefetch'
    ]);
  });
  it('uses declaration order, not a hardcoded all id, for recovery', () => {
    const definition = {
      filters: [
        { id: 'everything', label: 'Everything' },
        { id: 'chosen', label: 'Chosen' },
        { id: 'other', label: 'Other' }
      ]
    } as const;
    expect(defaultChipId(definition)).toBe('everything');
    expect(
      buildFilterChips(definition, { everything: 0, chosen: 0, other: 0 }, 'chosen').map(
        ({ disabled }) => disabled
      )
    ).toEqual([false, false, true]);
    expect(() => defaultChipId({ filters: [] })).toThrow(/no filter chips/);
  });
});

describe('query and capture boundaries', () => {
  it.each([
    [' \n\t ', ''],
    ['  Ab c  ', 'Ab c'],
    ['', '']
  ])('normalizes %j', (raw, expected) => {
    expect(normalizeQuery(raw)).toBe(expected);
  });
  it('keys an unnamed index stably and uniquely (the shared fallback spelling)', () => {
    expect(fallbackRowKey(0)).toBe('index-0');
    expect(fallbackRowKey(17)).toBe('index-17');
    expect(fallbackRowKey(0)).not.toBe(fallbackRowKey(1));
  });
  it('requires both the capture mark and the list limit', () => {
    expect(listCapped(undefined, 5, 5)).toBe(false);
    expect(listCapped(true, 4, 5)).toBe(false);
    expect(listCapped(true, 5, 5)).toBe(true);
    expect(listCapped(true, 6, 5)).toBe(true);
  });

  it('keeps exact-cap ambiguity explicit when the producer clips only a string', () => {
    const cap = PAYLOAD_LIMITS.preloaded;
    const resources = Array.from({ length: cap.count }, (_, index) => ({
      href: index === 0 ? 'x'.repeat(cap.href + 1) : `/${String(index)}.js`,
      type: 'script'
    }));
    const bounded = boundPreloadedResources({ present: true, resources });
    expect(bounded.truncated).toBe(true);
    expect(bounded.resources).toHaveLength(resources.length);
    expect(bounded.resources?.[0]?.href).toHaveLength(cap.href);
    expect(listCapped(bounded.truncated, bounded.resources?.length ?? 0, cap.count)).toBe(true);
    const shorter = boundPreloadedResources({ present: true, resources: resources.slice(0, -1) });
    expect(shorter.truncated).toBe(true);
    expect(listCapped(shorter.truncated, shorter.resources?.length ?? 0, cap.count)).toBe(false);
  });
});

describe('reconcileList', () => {
  /** A resource-like input with explicit stable identity. */
  interface Row {
    readonly key: string;
    readonly value: string;
  }
  /** Rendered data deliberately differs from the incoming row shape. */
  interface View {
    readonly identity: string;
    readonly text: string;
  }
  /** Reconcile using caller-owned keys and content equality, not position. */
  function run(
    previous: readonly View[],
    rows: readonly Row[],
    create = (row: Row): View => ({ identity: row.key, text: row.value })
  ): readonly View[] {
    return reconcileList(
      previous,
      rows,
      (view) => view.identity,
      (row) => row.key,
      (view, row) => view.text === row.value,
      create
    );
  }
  const a = { identity: 'a', text: 'A' };
  const b = { identity: 'b', text: 'B' };
  it('returns the same array and skips derivation when unchanged', () => {
    const previous = [a, b];
    const create = vi.fn((row: Row): View => ({ identity: row.key, text: row.value }));
    expect(
      run(
        previous,
        [
          { key: 'a', value: 'A' },
          { key: 'b', value: 'B' }
        ],
        create
      )
    ).toBe(previous);
    expect(create).not.toHaveBeenCalled();
    const empty: View[] = [];
    expect(run(empty, [])).toBe(empty);
  });
  it('preserves unchanged objects through insertion, deletion and reorder', () => {
    const next = run(
      [a, b],
      [
        { key: 'c', value: 'C' },
        { key: 'b', value: 'B' },
        { key: 'a', value: 'A' }
      ]
    );
    expect(next[1]).toBe(b);
    expect(next[2]).toBe(a);
    expect(run(next, [{ key: 'a', value: 'A' }])[0]).toBe(a);
    expect(run([a, b], [])).toEqual([]);
  });
  it('replaces only changed data and respects occurrence-disambiguated keys', () => {
    const first = { identity: 'same#0', text: 'A' };
    const second = { identity: 'same#1', text: 'A' };
    const next = run(
      [first, second],
      [
        { key: 'same#0', value: 'edited' },
        { key: 'same#1', value: 'A' }
      ]
    );
    expect(next[0]).not.toBe(first);
    expect(next[0]?.text).toBe('edited');
    expect(next[1]).toBe(second);
  });

  it('matches an independent reuse oracle over repeated immutable refreshes', () => {
    let previous: readonly View[] = [];
    for (let round = 0; round < 100; round += 1) {
      const fresh = Object.freeze(
        Array.from({ length: 9 }, (_, index) => (index * 5 + round) % 9)
          .filter((key) => (key + round) % 4 !== 0)
          .map((key) =>
            Object.freeze({ key: String(key), value: String((key + Math.floor(round / 3)) % 3) })
          )
      );
      const create = vi.fn((row: Row): View =>
        Object.freeze({ identity: row.key, text: row.value })
      );
      const actual = run(Object.freeze(previous), fresh, create);
      let changedRows = 0;
      for (const [index, row] of fresh.entries()) {
        const reusable = previous.find(
          (view) => view.identity === row.key && view.text === row.value
        );
        expect(actual[index]).toEqual({ identity: row.key, text: row.value });
        if (reusable === undefined) changedRows += 1;
        else expect(actual[index]).toBe(reusable);
      }
      expect(create).toHaveBeenCalledTimes(changedRows);
      expect(actual).toHaveLength(fresh.length);
      previous = actual;
    }
  });
});

describe('pruneKeyedFlags / toggleRowFlag', () => {
  it('prunes any keyed rows by their key function (numeric keys too)', () => {
    const one = { id: 1 };
    const two = { id: 2 };
    const flags = new Set([1, 2]);
    const keyOf = (row: { id: number }): number => row.id;
    expect(pruneKeyedFlags(flags, [one, two], [two, one], keyOf)).toBe(flags);
    expect([...pruneKeyedFlags(flags, [one, two], [one, { id: 2 }], keyOf)]).toEqual([1]);
    expect([...pruneKeyedFlags(flags, [one, two], [two], keyOf)]).toEqual([2]);
  });

  it('toggles membership into a fresh set', () => {
    const empty = new Set<string>();
    const one = toggleRowFlag(empty, 'k');
    expect(one).not.toBe(empty);
    expect([...one]).toEqual(['k']);
    expect([...toggleRowFlag(one, 'k')]).toEqual([]);
  });
});
