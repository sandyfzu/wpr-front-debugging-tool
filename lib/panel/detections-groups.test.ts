/**
 * The Grouped layout model: the placement table (every row lands in exactly
 * one place, nothing dropped), group order, per-group counts under the
 * summary's rule, the all-or-nothing evidence norm and the header's count line.
 */
import { describe, expect, it } from 'vitest';
import { HUD_FEATURES, HUD_GROUPS } from '../detection/hud';
import {
  DETECTION_GROUPS,
  evidenceNormOf,
  groupDetections,
  groupSummaryText,
  placementOf,
  PLACEMENTS,
  showsOwnSource
} from './detections-groups';
import { filterStatusItems } from './detections-filter';
import { summarizeFdtData } from './detections-summary';
import type { StatusItem, StatusItemId } from './detections-view-model';
import { makeReportData } from './support-report.fixtures';

/** A row with just the fields grouping reads. */
function item(
  id: StatusItemId,
  status: StatusItem['status'],
  extra?: Partial<StatusItem>
): StatusItem {
  return { id, name: id, status, ...extra };
}

/** The ids of a row list. */
const ids = (items: readonly StatusItem[]): StatusItemId[] => items.map((row) => row.id);

describe('placementOf', () => {
  it('puts every HUD feature in its own HUD group', () => {
    for (const feature of HUD_FEATURES) expect(placementOf(feature.row)).toBe(feature.group);
  });

  it('places every non-feature row by the table (tiles state the page facts)', () => {
    expect(Object.fromEntries(PLACEMENTS)).toEqual({
      wpr: 'tile',
      cached: 'tile',
      server: 'tile',
      'known-platform': 'tile',
      priority_elements_beacon: 'features',
      'host-layers': 'page'
    });
    for (const [id, placement] of PLACEMENTS) expect(placementOf(id)).toBe(placement);
  });

  it('never lets the table shadow a HUD feature (the HUD group wins, one declaring site)', () => {
    for (const feature of HUD_FEATURES) expect(PLACEMENTS.has(feature.row)).toBe(false);
  });

  it('places an unknown future row under Other detections (never dropped)', () => {
    expect(placementOf('future_row' as StatusItemId)).toBe('other');
  });

  it('places every row of a full real page by a table, never the Other fallback', () => {
    const { items } = summarizeFdtData(makeReportData());
    expect(items.length).toBeGreaterThan(0);
    // `other` is only for rows no table knows: a real row there is a missing placement.
    expect(items.filter((row) => placementOf(row.id) === 'other').map((row) => row.id)).toEqual([]);
  });
});

describe('DETECTION_GROUPS', () => {
  it('lists the HUD groups in their order, then Other detections, then Page', () => {
    expect(DETECTION_GROUPS).toEqual([
      ...HUD_GROUPS,
      { id: 'other', heading: 'Other detections' },
      { id: 'page', heading: 'Page' }
    ]);
  });
});

describe('groupDetections', () => {
  const ROWS: readonly StatusItem[] = [
    item('server', 'active'),
    item('host-layers', 'active'),
    item('wpr', 'active'),
    item('cached', 'active'),
    item('remove_unused_css', 'collecting', { source: 'meta' }),
    item('delay_js', 'active', { source: 'meta' }),
    item('minify_js', 'not-active', { source: 'footprint' }),
    item('lazyload', 'active', { builder: { off: 'feature' }, source: 'meta' }),
    item('mobile_cache', 'not-active'),
    item('priority_elements_beacon', 'not-active'),
    item('future_row' as StatusItemId, 'unknown')
  ];

  it('builds the non-empty groups in declared order, rows in input order, tiles left out', () => {
    const groups = groupDetections(ROWS, ROWS);
    expect(groups.map((group) => [group.id, ids(group.items)])).toEqual([
      ['file-optimization', ['remove_unused_css', 'delay_js', 'minify_js']],
      ['media', ['lazyload']],
      ['features', ['mobile_cache', 'priority_elements_beacon']],
      ['other', ['future_row']],
      ['page', ['host-layers']]
    ]);
    // Every row lands exactly once: in a group, or as a tile.
    const placed = groups.flatMap((group) => ids(group.items));
    const tiles = ids(ROWS).filter((id) => placementOf(id) === 'tile');
    expect([...placed, ...tiles].sort()).toEqual(ids(ROWS).sort());
  });

  it('counts optimization rows only, active by the summary rule (builder-off is not active)', () => {
    const groups = new Map(groupDetections(ROWS, ROWS).map((group) => [group.id, group]));
    expect(groups.get('file-optimization')).toMatchObject({ active: 1, total: 3 });
    expect(groups.get('media')).toMatchObject({ active: 0, total: 1 });
    // mobile_cache and the beacon are no optimizations: no "N of M".
    expect(groups.get('features')).toMatchObject({ active: 0, total: 0 });
    expect(groups.get('other')).toMatchObject({ active: 0, total: 1 });
    expect(groups.get('page')).toMatchObject({ active: 0, total: 0 });
  });

  it('keeps counts and norm on the full list while a filter narrows the rows', () => {
    const shown = filterStatusItems(ROWS, 'active');
    const groups = groupDetections(ROWS, shown);
    const files = groups.find((group) => group.id === 'file-optimization');
    expect(files && ids(files.items)).toEqual(['delay_js']);
    // The shown row alone is Meta; the full group mixes sources, so no norm.
    expect(files).toMatchObject({ active: 1, total: 3, evidenceNorm: null });
    // A group the filter emptied of rows is not rendered.
    expect(groups.map((group) => group.id)).not.toContain('media');
    // Page-context rows survive every filter.
    expect(groups.map((group) => group.id)).toContain('page');
  });

  it('returns no group for no rows, or for tile rows only', () => {
    expect(groupDetections([], [])).toEqual([]);
    const tiles = [item('wpr', 'active'), item('server', 'active')];
    expect(groupDetections(tiles, tiles)).toEqual([]);
  });

  it('agrees with the summary over a real page: group sums equal the score tile', () => {
    const { items, summary } = summarizeFdtData(makeReportData());
    const groups = groupDetections(items, items);
    const sum = (key: 'active' | 'total'): number =>
      groups.reduce((total, group) => total + group[key], 0);
    expect(sum('active')).toBe(summary.optimizations.active);
    expect(sum('total')).toBe(summary.optimizations.total);
  });
});

describe('evidenceNormOf / showsOwnSource', () => {
  const meta = item('delay_js', 'active', { source: 'meta' });
  const metaToo = item('lazyload', 'active', { source: 'meta' });
  const foot = item('minify_js', 'active', { source: 'footprint' });
  const none = item('priority_elements_beacon', 'active');

  /** Which rows of a group show their own chip under its norm. */
  const ownChips = (rows: readonly StatusItem[]): StatusItemId[] => {
    const norm = evidenceNormOf(rows);
    return ids(rows.filter((row) => showsOwnSource(row, norm)));
  };

  it('states the norm when every row carries the same source, no row repeats it', () => {
    expect(evidenceNormOf([meta, metaToo])).toBe('meta');
    expect(evidenceNormOf([meta])).toBe('meta');
    expect(ownChips([meta, metaToo])).toEqual([]);
  });

  it('drops the norm when one row differs: each row shows its own', () => {
    expect(evidenceNormOf([meta, metaToo, foot])).toBeNull();
    expect(evidenceNormOf([foot, meta, metaToo])).toBeNull();
    expect(ownChips([meta, metaToo, foot])).toEqual(['delay_js', 'lazyload', 'minify_js']);
  });

  it('drops the norm when one row has no source: the others show theirs, it shows none', () => {
    expect(evidenceNormOf([meta, metaToo, none])).toBeNull();
    // First row sourceless too (the norm never reads only the first row).
    expect(evidenceNormOf([none, meta])).toBeNull();
    expect(evidenceNormOf([none])).toBeNull();
    expect(ownChips([meta, metaToo, none])).toEqual(['delay_js', 'lazyload']);
  });

  it('has no norm for no rows', () => {
    expect(evidenceNormOf([])).toBeNull();
  });

  it('shows a row its own chip only when it carries one and the header states another', () => {
    expect(showsOwnSource(meta, 'meta')).toBe(false);
    expect(showsOwnSource(foot, 'meta')).toBe(true);
    expect(showsOwnSource(meta, null)).toBe(true);
    expect(showsOwnSource(none, null)).toBe(false);
    expect(showsOwnSource(none, 'meta')).toBe(false);
  });
});

describe('groupSummaryText', () => {
  it('words the count, or nothing for a group with no optimization', () => {
    expect(groupSummaryText({ active: 3, total: 6 })).toBe('3 of 6 optimizations active');
    expect(groupSummaryText({ active: 0, total: 1 })).toBe('0 of 1 optimizations active');
    expect(groupSummaryText({ active: 0, total: 0 })).toBeNull();
  });
});
