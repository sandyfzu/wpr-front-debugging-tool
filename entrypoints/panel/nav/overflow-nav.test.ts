/**
 * The overflow menu's grouping: hidden rows land in their journey groups in
 * the nav's order, and groups without hidden rows stay out. The trigger and
 * menu renders (both forms) are pinned by `adaptive-nav.test.tsx`.
 */
import { describe, expect, it } from 'vitest';
import type { RouteId } from '../routes';
import { hiddenGroups } from './overflow-nav';

/** Hidden boxes for route ids (geometry is irrelevant to grouping). */
function boxes(...routes: RouteId[]): { route: RouteId; top: number; height: number }[] {
  return routes.map((route) => ({ route, top: 0, height: 32 }));
}

describe('hiddenGroups', () => {
  it('is empty when nothing is hidden', () => {
    expect(hiddenGroups([])).toEqual([]);
  });

  it('groups the hidden rows in the nav order, skipping groups without any', () => {
    const groups = hiddenGroups(boxes('lcp-vitals', 'headers-cookies', 'beacon-tester'));
    expect(groups.map((entry) => entry.group)).toEqual(['Inspect', 'Tools']);
    expect(groups.map((entry) => entry.rows.map((row) => row.id))).toEqual([
      ['headers-cookies'],
      ['beacon-tester', 'lcp-vitals']
    ]);
  });
});
