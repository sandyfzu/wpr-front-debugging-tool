/**
 * The Detections status filter: the segment registry, the Active /
 * Collecting / Off buckets (the summary's rule, Exclusion Builder facts included),
 * page-context cards surviving every filter, the `all` identity, and counts
 * that agree with the overview.
 */
import { describe, expect, it } from 'vitest';
import { runDetection } from '../detection/run-detection';
import { BUILDER_MARKER_META_NAME } from '../wp-rocket/constants';
import type { WprDetections } from '../wp-rocket/types';
import {
  DETECTION_FILTER_LABEL,
  DETECTION_FILTERS,
  detectionFilterLabel,
  filterStatusItems,
  matchesDetectionFilter,
  optimizationCounts,
  statusBucket,
  type DetectionFilterId
} from './detections-filter';
import { isOptimizationCard, optimizationBucket, summarizeFdtData } from './detections-summary';
import { buildStatusItems, type StatusItem, type StatusItemId } from './detections-view-model';
import { makeReportData } from './support-report.fixtures';

/** A card with just the fields the filter reads. */
function item(
  id: StatusItemId,
  status: StatusItem['status'],
  extra?: Partial<StatusItem>
): StatusItem {
  return { id, name: id, status, ...extra };
}

/** A mixed list: page context first, then each optimization verdict. */
const ITEMS: readonly StatusItem[] = [
  item('wpr', 'active'),
  item('cached', 'active'),
  item('server', 'active'),
  item('priority_elements_beacon', 'not-active'),
  item('delay_js', 'active'),
  item('lazyload', 'not-active'),
  item('remove_unused_css', 'collecting'),
  item('defer_all_js', 'unknown'),
  item('mobile_cache', 'unknown')
];

/** The ids of a card list. */
function ids(items: readonly StatusItem[]): StatusItemId[] {
  return items.map((card) => card.id);
}

describe('DETECTION_FILTERS', () => {
  it('declares All, Active, Collecting, Off in that order, identity segment first', () => {
    expect(DETECTION_FILTERS.map((filter) => [filter.id, filter.label])).toEqual([
      ['all', 'All'],
      ['active', 'Active'],
      ['collecting', 'Collecting'],
      ['off', 'Off']
    ]);
    expect(DETECTION_FILTER_LABEL).toBe('Optimization status');
  });

  it('never words a bucket as enabled/disabled', () => {
    for (const filter of DETECTION_FILTERS) expect(filter.label).not.toMatch(/enabled|disabled/i);
  });

  it('names each filter by its segment label, and refuses an undeclared id', () => {
    expect(detectionFilterLabel('active')).toBe('Active');
    expect(detectionFilterLabel('collecting')).toBe('Collecting');
    expect(detectionFilterLabel('off')).toBe('Off');
    expect(() => detectionFilterLabel('inactive' as DetectionFilterId)).toThrow(/"inactive"/);
  });
});

describe('statusBucket', () => {
  it.each([
    ['active', 'active'],
    ['collecting', 'collecting'],
    ['unknown', 'off'],
    ['not-active', 'off']
  ] as const)('puts a %s verdict under %s', (status, bucket) => {
    expect(statusBucket(item('delay_js', status))).toBe(bucket);
  });

  it('follows the Exclusion Builder: off / page-off → off, excluded stays active', () => {
    expect(statusBucket(item('delay_js', 'active', { builder: { off: 'feature' } }))).toBe('off');
    expect(statusBucket(item('defer_all_js', 'active', { builder: { off: 'page' } }))).toBe('off');
    expect(statusBucket(item('lazyload', 'active', { builder: { excluded: 2 } }))).toBe('active');
    expect(statusBucket(item('lazyload', 'not-active', { builder: { excluded: 2 } }))).toBe('off');
    expect(
      statusBucket(item('remove_unused_css', 'collecting', { builder: { excluded: 1 } }))
    ).toBe('collecting');
  });

  it('is the summary rule itself (never re-coded)', () => {
    for (const card of ITEMS.filter((entry) => isOptimizationCard(entry.id)))
      expect(statusBucket(card)).toBe(optimizationBucket(card));
  });
});

describe('filterStatusItems', () => {
  it('returns the same array for all', () => {
    expect(filterStatusItems(ITEMS, 'all')).toBe(ITEMS);
  });

  it('narrows only optimization rows, keeping page context and order', () => {
    const context = ['wpr', 'cached', 'server', 'priority_elements_beacon'];
    expect(ids(filterStatusItems(ITEMS, 'active'))).toEqual([
      ...context,
      'delay_js',
      'mobile_cache'
    ]);
    expect(ids(filterStatusItems(ITEMS, 'collecting'))).toEqual([
      ...context,
      'remove_unused_css',
      'mobile_cache'
    ]);
    expect(ids(filterStatusItems(ITEMS, 'off'))).toEqual([
      ...context,
      'lazyload',
      'defer_all_js',
      'mobile_cache'
    ]);
  });

  it('keeps the rows themselves (state and why travel unchanged)', () => {
    const unsure = item('remove_unused_css', 'collecting', { why: 'Waiting for the beacon.' });
    expect(filterStatusItems([unsure], 'collecting')[0]).toBe(unsure);
  });

  it('leaves only page context when a bucket is empty, and nothing from nothing', () => {
    const allActive = ITEMS.filter(
      (card) => !isOptimizationCard(card.id) || card.status === 'active'
    );
    for (const filter of ['collecting', 'off'] as const)
      expect(ids(filterStatusItems(allActive, filter))).toEqual(
        ids(allActive.filter((card) => !isOptimizationCard(card.id)))
      );
    expect(filterStatusItems([], 'active')).toEqual([]);
  });

  it('treats an unknown future detection row as an optimization', () => {
    const future = item('future_row' as StatusItemId, 'active');
    expect(matchesDetectionFilter(future, 'active')).toBe(true);
    expect(matchesDetectionFilter(future, 'off')).toBe(false);
    expect(optimizationCounts([future])).toEqual({ all: 1, active: 1, collecting: 0, off: 0 });
  });
});

describe('optimizationCounts', () => {
  it('counts optimization rows only, per bucket, the buckets summing to all', () => {
    expect(optimizationCounts(ITEMS)).toEqual({ all: 4, active: 1, collecting: 1, off: 2 });
  });

  it('counts zero buckets as zero', () => {
    const zero = { all: 0, active: 0, collecting: 0, off: 0 };
    expect(optimizationCounts([])).toEqual(zero);
    expect(optimizationCounts([item('wpr', 'active'), item('server', 'active')])).toEqual(zero);
  });

  it('agrees with the overview over a real page with Exclusion Builder facts', () => {
    const declared =
      '<meta name="generator" content="WP Rocket 3.23.5.1" data-wpr-features="wpr_delay_js wpr_defer_js wpr_lazyload_images">';
    const marker = `<meta name="${BUILDER_MARKER_META_NAME}" content="v1 delay_js=off defer_all_js=page-off lazyload=excluded:2">`;
    const html = `<!doctype html><html><head>${declared}${marker}</head><body><img src="p.gif" data-lazy-src="r.jpg"></body></html>`;
    const base = makeReportData();
    const detections: WprDetections = runDetection(html).detections;
    const data = makeReportData({ wprDetections: { ...base.wprDetections, ...detections } });
    const { items, summary } = summarizeFdtData(data);
    const counts = optimizationCounts(items);
    // Each segment's count is the score tile's number, by construction.
    expect(counts.active).toBe(summary.optimizations.active);
    expect(counts.collecting).toBe(summary.optimizations.collecting);
    expect(counts.off).toBe(summary.optimizations.off);
    expect(counts.all).toBe(summary.optimizations.total);
    expect(counts.active + counts.collecting + counts.off).toBe(counts.all);
    // The builder-off pair lands under off, the excluded row stays active.
    const off = ids(filterStatusItems(items, 'off'));
    expect(off).toContain('delay_js');
    expect(off).toContain('defer_all_js');
    expect(ids(filterStatusItems(items, 'active'))).toContain('lazyload');
    expect(buildStatusItems(data)).toEqual(items);
  });
});
