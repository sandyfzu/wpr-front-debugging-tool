/**
 * The Detections status filter: the chip registry, the Active/Inactive
 * buckets (the summary's in-tab rule, Exclusion Builder facts included),
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
import { isOptimizationCard, summarizeFdtData } from './detections-summary';
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
  it('declares All, Active, Inactive in that order, identity chip first', () => {
    expect(DETECTION_FILTERS.map((filter) => [filter.id, filter.label])).toEqual([
      ['all', 'All optimizations'],
      ['active', 'Active'],
      ['inactive', 'Inactive']
    ]);
    expect(DETECTION_FILTER_LABEL).toBe('Optimization status');
  });

  it('never words the inactive bucket as enabled/disabled', () => {
    for (const filter of DETECTION_FILTERS) expect(filter.label).not.toMatch(/enabled|disabled/i);
  });

  it('names each filter by its chip label, and refuses an undeclared id', () => {
    expect(detectionFilterLabel('active')).toBe('Active');
    expect(detectionFilterLabel('inactive')).toBe('Inactive');
    expect(() => detectionFilterLabel('paused' as DetectionFilterId)).toThrow(/"paused"/);
  });
});

describe('statusBucket', () => {
  it('puts only an active verdict under active; collecting, unknown and not active are inactive', () => {
    expect(statusBucket(item('delay_js', 'active'))).toBe('active');
    expect(statusBucket(item('delay_js', 'collecting'))).toBe('inactive');
    expect(statusBucket(item('delay_js', 'unknown'))).toBe('inactive');
    expect(statusBucket(item('delay_js', 'not-active'))).toBe('inactive');
  });

  it('follows the Exclusion Builder: off / page-off inactive, excluded active, no fact by status', () => {
    expect(statusBucket(item('delay_js', 'active', { builder: { off: 'feature' } }))).toBe(
      'inactive'
    );
    expect(statusBucket(item('defer_all_js', 'active', { builder: { off: 'page' } }))).toBe(
      'inactive'
    );
    expect(statusBucket(item('lazyload', 'active', { builder: { excluded: 2 } }))).toBe('active');
    expect(statusBucket(item('lazyload', 'not-active', { builder: { excluded: 2 } }))).toBe(
      'inactive'
    );
  });
});

describe('filterStatusItems', () => {
  it('returns the same array for all', () => {
    expect(filterStatusItems(ITEMS, 'all')).toBe(ITEMS);
  });

  it('narrows only optimization cards, keeping page context and order', () => {
    expect(ids(filterStatusItems(ITEMS, 'active'))).toEqual([
      'wpr',
      'cached',
      'server',
      'priority_elements_beacon',
      'delay_js',
      'mobile_cache'
    ]);
    expect(ids(filterStatusItems(ITEMS, 'inactive'))).toEqual([
      'wpr',
      'cached',
      'server',
      'priority_elements_beacon',
      'lazyload',
      'remove_unused_css',
      'defer_all_js',
      'mobile_cache'
    ]);
  });

  it('keeps the cards themselves (badges and why travel unchanged)', () => {
    const unsure = item('remove_unused_css', 'collecting', { why: 'Waiting for the beacon.' });
    expect(filterStatusItems([unsure], 'inactive')[0]).toBe(unsure);
  });

  it('leaves only page context when a bucket is empty, and nothing from nothing', () => {
    const allActive = ITEMS.filter(
      (card) => !isOptimizationCard(card.id) || card.status === 'active'
    );
    expect(ids(filterStatusItems(allActive, 'inactive'))).toEqual(
      ids(allActive.filter((card) => !isOptimizationCard(card.id)))
    );
    expect(filterStatusItems([], 'active')).toEqual([]);
  });

  it('treats an unknown future detection row as an optimization', () => {
    const future = item('future_row' as StatusItemId, 'active');
    expect(matchesDetectionFilter(future, 'active')).toBe(true);
    expect(matchesDetectionFilter(future, 'inactive')).toBe(false);
    expect(optimizationCounts([future])).toEqual({ all: 1, active: 1, inactive: 0 });
  });
});

describe('optimizationCounts', () => {
  it('counts optimization cards only, per bucket', () => {
    expect(optimizationCounts(ITEMS)).toEqual({ all: 4, active: 1, inactive: 3 });
  });

  it('counts zero buckets as zero', () => {
    expect(optimizationCounts([])).toEqual({ all: 0, active: 0, inactive: 0 });
    expect(optimizationCounts([item('wpr', 'active'), item('server', 'active')])).toEqual({
      all: 0,
      active: 0,
      inactive: 0
    });
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
    expect(counts.active).toBe(summary.optimizations.active);
    expect(counts.all).toBe(summary.optimizations.total);
    expect(counts.active + counts.inactive).toBe(counts.all);
    // The builder-off pair lands under inactive, the excluded row stays active.
    const inactive = ids(filterStatusItems(items, 'inactive'));
    expect(inactive).toContain('delay_js');
    expect(inactive).toContain('defer_all_js');
    expect(ids(filterStatusItems(items, 'active'))).toContain('lazyload');
    expect(buildStatusItems(data)).toEqual(items);
  });
});
