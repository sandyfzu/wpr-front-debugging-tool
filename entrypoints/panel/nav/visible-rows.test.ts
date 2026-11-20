/**
 * The overflow computation's tests: the measured-box partition across the
 * cases the affordance meets in the real rail — everything fits, exact
 * boundary fits, fractional device pixels, heights too small for even one
 * row (the rail is reduced to its trigger and the menu holds everything),
 * a group separator that does not fit hides its whole group behind the
 * rail's top edge, a mid-group cut and a cut inside the last row.
 * Contract violations throw with the offending value named.
 */
import { describe, expect, it } from 'vitest';
import type { RailRowBox } from './visible-rows';
import { visibleRowsInRail } from './visible-rows';

/**
 * Build a rail-like measured layout: 32px rows with 4px gaps inside each
 * group and a 13px group lead (6px margin + 1px hairline + 6px padding) —
 * the shipped rail's anatomy (browser-measured, 2026-10-13), so the
 * fixtures exercise the numbers the DOM really produces. Overviews'
 * first-group lead is 0 (no separator above the first).
 *
 * @param routeIds The registry-order routes to lay out.
 */
function railLayout(routeIds: readonly RailRowBox['route'][]): RailRowBox[] {
  const groups = new Map<string, RailRowBox['route'][]>();
  for (const route of routeIds) {
    const group = groupOf(route);
    groups.set(group, [...(groups.get(group) ?? []), route]);
  }
  let top = 0;
  const boxes: RailRowBox[] = [];
  let groupIndex = 0;
  for (const rows of groups.values()) {
    if (groupIndex > 0) top += 13; // the group separator's lead
    for (const [index, route] of rows.entries()) {
      boxes.push({ route, top, height: 32 });
      top += 32 + (index < rows.length - 1 ? 4 : 0);
    }
    groupIndex += 1;
  }
  return boxes;
}

/** The journey group the shipped registry puts a route in. */
function groupOf(route: RailRowBox['route']): string {
  switch (route) {
    case 'detections':
      return 'Overview';
    case 'javascript':
    case 'stylesheets':
    case 'lazyload':
    case 'preloaded-resources':
    case 'headers-cookies':
      return 'Inspect';
    case 'undefined-references':
      return 'Diagnose';
    case 'rucss-tester':
    case 'beacon-tester':
    case 'lcp-vitals':
      return 'Tools';
    default:
      throw new Error(`Unknown test route: ${String(route)}`);
  }
}

const ALL = railLayout([
  'detections',
  'javascript',
  'lazyload',
  'preloaded-resources',
  'rucss-tester',
  'beacon-tester'
]);

describe('visibleRowsInRail', () => {
  it('keeps every row when the height covers the full rail (no overflow, no trigger)', () => {
    // Overview 32 + Inspect 117 (13 + 3 × 32 + 2 × 4) + Tools 81 (13 + 2 × 32 + 4) = 230.
    const result = visibleRowsInRail(ALL, 230);
    expect(result.visible.map((row) => row.route)).toEqual(ALL.map((row) => row.route));
    expect(result.hidden).toEqual([]);
  });

  it('cuts the registry-order suffix: the visible rows are exactly the prefix that fits', () => {
    // The Beacon Tester row ends at 230; one whisker less hides exactly that row.
    const result = visibleRowsInRail(ALL, 229);
    expect(result.visible.map((row) => row.route)).toEqual([
      'detections',
      'javascript',
      'lazyload',
      'preloaded-resources',
      'rucss-tester'
    ]);
    expect(result.hidden.map((row) => row.route)).toEqual(['beacon-tester']);
  });

  it('pinned exact boundary: a row whose bottom edge equals the available height fits', () => {
    // The Beacon Tester row spans 198..230 — 230 exactly reaches its bottom.
    const result = visibleRowsInRail(ALL, 230);
    expect(result.hidden).toEqual([]);
  });

  it('fractional device-pixel boxes partition on the real measured value', () => {
    const fractional: RailRowBox[] = [
      { route: 'detections', top: 0, height: 32.5 },
      { route: 'javascript', top: 36.5, height: 32 }
    ];
    // 68.5 exactly fits; one whisker less hides the trailing row.
    expect(visibleRowsInRail(fractional, 68.5).hidden).toEqual([]);
    const cut = visibleRowsInRail(fractional, 68.499);
    expect(cut.visible.map((row) => row.route)).toEqual(['detections']);
    expect(cut.hidden.map((row) => row.route)).toEqual(['javascript']);
  });

  it('heights too small for one row leave nothing in the rail (the menu holds everything)', () => {
    // Smaller than one row: the rail is its overflow trigger alone; every row
    // is reachable through the menu instead.
    for (const available of [0, 1, 31.9]) {
      const result = visibleRowsInRail(ALL, available);
      expect(result.visible).toEqual([]);
      expect(result.hidden.map((row) => row.route)).toEqual(ALL.map((row) => row.route));
    }
  });

  it('a group separator that does not fit hides its whole group (no orphaned lead)', () => {
    // The rail behaves as if Overview's single row were absent: the Inspect
    // group starts after a 13px lead, so an available height that ends inside
    // that lead hides the lead and its group with it.
    const inspectAt = 32 + 13; // the first Inspect row's top (its lead's bottom)
    const result = visibleRowsInRail(ALL, inspectAt);
    expect(result.visible.map((row) => row.route)).toEqual(['detections']);
    expect(result.hidden.map((row) => row.route)).toEqual([
      'javascript',
      'lazyload',
      'preloaded-resources',
      'rucss-tester',
      'beacon-tester'
    ]);
  });

  it('an available height ending inside the lead hides its whole group (no orphaned lead)', () => {
    // The 230-anatomy: Overview's row ends at 32 and the Inspect lead spans
    // 32..45 (6px margin + 1px hairline + 6px padding) — a height inside
    // that lead (38) fits no Inspect row, so the lead and its group turn to
    // the menu together (the separator is part of the first row's measured
    // top; it never strands).
    const result = visibleRowsInRail(ALL, 38);
    expect(result.visible.map((row) => row.route)).toEqual(['detections']);
    expect(result.hidden.map((row) => row.route)).toEqual([
      'javascript',
      'lazyload',
      'preloaded-resources',
      'rucss-tester',
      'beacon-tester'
    ]);
  });

  it('the genuine mid-group cut keeps the lead and the first row (the second leaves)', () => {
    // A cut between JavaScript's box (45..77) and Lazyload's top (81): at 78
    // the group's lead and its first row stay (the fit line is per-row over
    // the measured boxes), Lazyload and everything after it leaves — the
    // render-tier pin carries the same case in the browser.
    const result = visibleRowsInRail(ALL, 78);
    expect(result.visible.map((row) => row.route)).toEqual(['detections', 'javascript']);
    expect(result.hidden.map((row) => row.route)).toEqual([
      'lazyload',
      'preloaded-resources',
      'rucss-tester',
      'beacon-tester'
    ]);
  });

  it('a height ending inside the last row hides that row alone', () => {
    // Available height ends inside the Beacon Tester row (198..230).
    const result = visibleRowsInRail(ALL, 199);
    expect(result.hidden.map((row) => row.route)).toEqual(['beacon-tester']);
    const oneMore = visibleRowsInRail(ALL, 230);
    expect(oneMore.hidden).toEqual([]);
  });

  it('returns empty partitions for an empty rail without reading the height', () => {
    const result = visibleRowsInRail([], 0);
    expect(result.visible).toEqual([]);
    expect(result.hidden).toEqual([]);
  });

  it('partitions preserve the input order even if the input is out of registry order', () => {
    const unsorted: RailRowBox[] = [
      { route: 'javascript', top: 0, height: 32 },
      { route: 'detections', top: 5, height: 32 }
    ];
    const result = visibleRowsInRail(unsorted, 32);
    expect(result.visible.map((row) => row.route)).toEqual(['javascript']);
    expect(result.hidden.map((row) => row.route)).toEqual(['detections']);
  });

  it('throws a failure that names the offending value for a broken height', () => {
    expect(() => visibleRowsInRail(ALL, Number.NaN)).toThrow(/NaN/);
    expect(() => visibleRowsInRail(ALL, -0.1)).toThrow(/-0\.1/);
    expect(() => visibleRowsInRail(ALL, Number.POSITIVE_INFINITY)).toThrow(/Infinity/);
  });

  it('throws naming the offending row for a broken measured box', () => {
    const broken: RailRowBox[] = [{ route: 'lazyload', top: 0, height: Number.NaN }];
    expect(() => visibleRowsInRail(broken, 100)).toThrow(/lazyload/);
    const negativeTop: RailRowBox[] = [{ route: 'lazyload', top: -4, height: 32 }];
    expect(() => visibleRowsInRail(negativeTop, 100)).toThrow(/-4/);
    const negativeHeight: RailRowBox[] = [{ route: 'preloaded-resources', top: 0, height: -1 }];
    expect(() => visibleRowsInRail(negativeHeight, 100)).toThrow(/preloaded-resources/);
  });
});
