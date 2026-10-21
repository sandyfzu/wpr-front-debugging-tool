import { describe, expect, it } from 'vitest';
import {
  NAVIGATION_ANCHOR_GLOBAL,
  readNavigationAnchor,
  recordNavigationAnchor
} from './navigation-anchor';

describe('navigation anchor', () => {
  it('records the wall start once (the first, document_start reading wins)', () => {
    const scope: Record<string, unknown> = {};
    recordNavigationAnchor(
      scope,
      () => 1_000_000,
      () => 40
    );
    expect(readNavigationAnchor(scope)).toBe(999_960);
    // A later reading (after a sleep) never replaces it.
    recordNavigationAnchor(
      scope,
      () => 5_000_000,
      () => 50
    );
    expect(readNavigationAnchor(scope)).toBe(999_960);
  });

  it('answers null when nothing (or junk) was recorded', () => {
    expect(readNavigationAnchor({})).toBeNull();
    for (const junk of ['1', Number.NaN, Number.POSITIVE_INFINITY, null]) {
      expect(readNavigationAnchor({ [NAVIGATION_ANCHOR_GLOBAL]: junk })).toBeNull();
    }
  });
});
