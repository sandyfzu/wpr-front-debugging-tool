import { describe, expect, it } from 'vitest';
import type { LazyloadImageResource } from '../../../../lib/panel/resources-view-model';
import { FDT_EXCLUDED_RESOURCE } from '../../../../lib/wp-rocket/constants';
import {
  exclusionReasons,
  LAZYLOAD_ROW_ESTIMATE,
  LAZYLOAD_ROW_WITH_REASONS_ESTIMATE,
  lazyloadRowEstimate,
  lazyloadStateBadge
} from './lazyload-rows';

/** One image row with overrides. */
function row(overrides: Partial<LazyloadImageResource> = {}): LazyloadImageResource {
  return {
    id: 0,
    src: 'https://cdn.example/a.jpg',
    lazyloaded: false,
    excludedReasons: [],
    ...overrides
  };
}

describe('lazyloadStateBadge', () => {
  it('reads lazyloaded as info and the rest as neutral (never an error)', () => {
    expect(lazyloadStateBadge(row({ lazyloaded: true }))).toEqual({
      kind: 'info',
      label: 'Lazyloaded'
    });
    expect(lazyloadStateBadge(row())).toEqual({ kind: 'neutral', label: 'Not lazyloaded' });
  });
});

describe('exclusionReasons', () => {
  it('pulls the tool marker out and keeps every other reason in order', () => {
    expect(
      exclusionReasons(row({ excludedReasons: ['data-src', FDT_EXCLUDED_RESOURCE, 'skip-lazy'] }))
    ).toEqual({ excludedByTool: true, reasons: ['data-src', 'skip-lazy'] });
  });

  it('reports no marker and no reasons for an empty list', () => {
    expect(exclusionReasons(row())).toEqual({ excludedByTool: false, reasons: [] });
  });

  it('keeps the page reasons when the marker is absent', () => {
    expect(exclusionReasons(row({ excludedReasons: ['loading="eager"'] }))).toEqual({
      excludedByTool: false,
      reasons: ['loading="eager"']
    });
  });
});

describe('lazyloadRowEstimate', () => {
  it('seeds lazyloaded rows without the reasons line', () => {
    expect(lazyloadRowEstimate(row({ lazyloaded: true }))).toBe(LAZYLOAD_ROW_ESTIMATE);
    expect(lazyloadRowEstimate(row())).toBe(LAZYLOAD_ROW_WITH_REASONS_ESTIMATE);
    expect(LAZYLOAD_ROW_WITH_REASONS_ESTIMATE).toBeGreaterThan(LAZYLOAD_ROW_ESTIMATE);
  });
});
