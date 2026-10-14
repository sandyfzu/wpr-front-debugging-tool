import { describe, expect, it } from 'vitest';
import type { LazyloadImageResource } from '../../../../lib/panel/resources-view-model';
import { FDT_EXCLUDED_RESOURCE } from '../../../../lib/wp-rocket/constants';
import {
  exclusionReasons,
  LAZYLOAD_ROW_ESTIMATE,
  LAZYLOAD_ROW_WITH_REASONS_ESTIMATE,
  lazyloadNotes,
  lazyloadRowEstimate,
  lazyloadStateBadge,
  sameImageRow
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

describe('sameImageRow', () => {
  it('matches only rows that look the same', () => {
    const base = row({ excludedReasons: ['data-src', 'skip-lazy'] });
    expect(sameImageRow(base, { ...base, excludedReasons: ['data-src', 'skip-lazy'] })).toBe(true);
    expect(sameImageRow(base, { ...base, src: 'https://cdn.example/b.jpg' })).toBe(false);
    expect(sameImageRow(base, { ...base, lazyloaded: true })).toBe(false);
    expect(sameImageRow(base, { ...base, excludedReasons: ['skip-lazy', 'data-src'] })).toBe(false);
    expect(sameImageRow(base, { ...base, excludedReasons: ['data-src'] })).toBe(false);
  });
});

describe('lazyloadNotes', () => {
  const image = {
    src: 'https://cdn.example/a.jpg',
    lazyloadDetected: false,
    excludedReasonsFound: []
  };

  it('says nothing for a complete, consistent detection', () => {
    expect(lazyloadNotes({ present: true, images: [image] })).toEqual([]);
    expect(lazyloadNotes({ present: false, images: [image] })).toEqual([]);
  });

  it('notes the cap only with the mark and a list at its cap', () => {
    const full = Array.from({ length: 5000 }, () => image);
    expect(lazyloadNotes({ present: true, images: full, truncated: true })).toEqual([
      'The list was capped at the first 5,000 images; counts cover these rows.'
    ]);
    expect(lazyloadNotes({ present: true, images: full })).toEqual([]);
    expect(lazyloadNotes({ present: true, images: [image], truncated: true })).toEqual([]);
  });

  it('explains lazyloaded images while the feature reads absent', () => {
    const notes = lazyloadNotes({ present: false, images: [{ ...image, lazyloadDetected: true }] });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('lazyload script was not found');
  });
});
