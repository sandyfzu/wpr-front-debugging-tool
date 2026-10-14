/**
 * The strip registry's shape pins: every row is a unique (id, label, group),
 * labels come exactly from the verified label set, groups are the study's
 * set, count units are declared where they matter and never where they do
 * not, and the grouping renders only groups owning rows.
 */
import { describe, expect, it } from 'vitest';
import { STRIP_GROUPS, STRIP_ITEMS, stripGroupedRows } from './strip-items';
import {
  LABEL_DELAY_JAVASCRIPT_EXECUTION,
  LABEL_IMAGE_LAZYLOAD,
  LABEL_PRIORITY_ELEMENTS_BEACON,
  LABEL_WP_ROCKET
} from '../../../lib/detection/labels';
import type { PageAnalysisReport } from '../../../lib/detection/describe';

/** A minimal report shaped for the two rows the read-selectors are pinned on. */
const REPORT: PageAnalysisReport = {
  [LABEL_WP_ROCKET]: {
    'plugin detected': true,
    'page served from cache': true,
    version: '3.23.5.1',
    'cache generated at': null
  },
  ...Object.fromEntries(
    STRIP_ITEMS.map((row) => [
      row.label,
      { state: row.id === 'delay-js' ? 'applied' : 'not applied' }
    ])
  ),
  [LABEL_PRIORITY_ELEMENTS_BEACON]: {
    detected: false,
    'configured device': 'unknown',
    'enabled features': []
  },
  [LABEL_DELAY_JAVASCRIPT_EXECUTION]: {
    state: 'applied',
    'delayed scripts': 4,
    'delay library version': null
  },
  [LABEL_IMAGE_LAZYLOAD]: {
    state: 'applied',
    'lazy-loaded images': 2
  }
} as unknown as PageAnalysisReport;

describe('the strip registry', () => {
  it('rows carry one (id, label) each and the verified labels only', () => {
    const ids = STRIP_ITEMS.map((row) => row.id);
    const labels = STRIP_ITEMS.map((row) => row.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
    // The identity row and the beacon row never appear: not features.
    expect(labels).not.toContain(LABEL_WP_ROCKET);
    expect(labels).not.toContain(LABEL_PRIORITY_ELEMENTS_BEACON);
  });

  it('the count units are declared exactly where the engine measures one', () => {
    // The counted rows read their engine-provided numbers.
    const delayRow = STRIP_ITEMS.find((item) => item.id === 'delay-js');
    expect(delayRow?.read(REPORT)).toEqual({ state: 'applied', count: 4 });
    const lazyRow = STRIP_ITEMS.find((item) => item.id === 'lazyload');
    expect(lazyRow?.read(REPORT)).toEqual({ state: 'applied', count: 2 });
    // Rows without a unit never fabricate a count.
    for (const row of STRIP_ITEMS.filter((item) => item.unit === null)) {
      expect(row.read(REPORT).count, `${row.id} without a unit reads null`).toBeNull();
    }
  });

  it('the grouped rendering has the study groups only for owned rows', () => {
    const grouped = stripGroupedRows();
    expect(grouped.map((group) => group.id)).toEqual(STRIP_GROUPS.map((group) => group.id));
    expect(grouped.map((group) => group.heading)).toEqual([
      'File Optimization',
      'Media',
      'Preload',
      'CDN',
      'Features'
    ]);
    const groupedIds = new Set(grouped.flatMap((group) => group.rows.map((row) => row.id)));
    expect(groupedIds.size).toBe(STRIP_ITEMS.length);
  });

  it('the delay-js reading reads its count from the same report row it names', () => {
    const row = STRIP_ITEMS.find((item) => item.id === 'delay-js');
    expect(row?.label).toBe(LABEL_DELAY_JAVASCRIPT_EXECUTION);
    expect(row?.read(REPORT)).toEqual({ state: 'applied', count: 4 });
  });

  it('the grouping carries each row body group once, cache excluded', () => {
    const grouped = stripGroupedRows();
    expect(grouped.some((group) => group.id === 'cache')).toBe(false);
    expect(grouped.find((group) => group.id === 'media')?.rows.map((row) => row.id)).toEqual([
      'lazyload',
      'lazyload-iframes',
      'lazyload-css-bg-img'
    ]);
  });
});
