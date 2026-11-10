/**
 * Hint attribution: a stamp reads WP Rocket, a feature is named only where
 * the `as` type plus a detected row prove it, a plain hint is never claimed;
 * and the inventory rank (WP Rocket first, then kind, preloads by type).
 */
import { describe, expect, it } from 'vitest';
import { hintAttribution, hintRank, UNATTRIBUTED } from './hint-attribution';
import { emptyDetections } from './support-report.fixtures';
import type { ResourceHint, ResourceHintMark, WprDetections } from '../wp-rocket/types';

/** Detections with the named rows present. */
function withRows(...rows: (keyof WprDetections)[]): WprDetections {
  const detections = emptyDetections();
  for (const row of rows) detections[row].present = true;
  return detections;
}

/** A stamped hint. */
function stamped(mark: ResourceHintMark, rel: ResourceHint['rel'], as = ''): ResourceHint {
  return { rel, href: 'https://a.example/x', as, mark };
}

describe('hintAttribution', () => {
  it('never claims a plain hint, whatever the rows say', () => {
    const all = withRows(
      'rocket_above_the_fold_optimization',
      'auto_preload_fonts',
      'async_css',
      'preconnect_external_domains',
      'dns_prefetch'
    );
    for (const rel of ['preload', 'modulepreload', 'preconnect', 'dns-prefetch'] as const) {
      expect(hintAttribution({ rel, href: '/x', as: 'image' }, all)).toBe(UNATTRIBUTED);
    }
  });

  it.each([
    // as × rows → feature (null = "WP Rocket" only)
    ['image', [], null],
    ['image', ['rocket_above_the_fold_optimization'], 'Optimize Critical Images'],
    ['image', ['auto_preload_fonts'], null],
    ['font', [], null],
    ['font', ['auto_preload_fonts'], 'Preload fonts'],
    // Preload fonts switches RUCSS's font preloads off wherever it applies.
    ['font', ['auto_preload_fonts', 'remove_unused_css'], 'Preload fonts'],
    // RUCSS's font preloads are opt-in (a site filter): never claimed.
    ['font', ['remove_unused_css'], null],
    ['font', ['rocket_above_the_fold_optimization'], null],
    // Google Fonts' style preload has no row; any other type names nothing.
    ['style', ['rocket_above_the_fold_optimization', 'auto_preload_fonts', 'async_css'], null],
    ['script', ['rocket_above_the_fold_optimization'], null],
    ['', ['rocket_above_the_fold_optimization', 'auto_preload_fonts'], null]
  ] as const)('a data-rocket-preload %j with %j names %j', (as, rows, feature) => {
    expect(hintAttribution(stamped('preload', 'preload', as), withRows(...rows))).toEqual({
      by: 'wp-rocket',
      mark: 'preload',
      feature
    });
  });

  it('names Load CSS asynchronously on its stamp only with the row detected', () => {
    const hint = stamped('async', 'preload', 'style');
    expect(hintAttribution(hint, withRows('async_css'))).toEqual({
      by: 'wp-rocket',
      mark: 'async',
      feature: 'Load CSS asynchronously'
    });
    expect(hintAttribution(hint, emptyDetections())).toEqual({
      by: 'wp-rocket',
      mark: 'async',
      feature: null
    });
  });

  it('names Preconnect to External Domains on both of its stamps, row or not', () => {
    for (const [mark, rel] of [
      ['preconnect', 'preconnect'],
      ['prefetch', 'dns-prefetch']
    ] as const) {
      expect(hintAttribution(stamped(mark, rel), emptyDetections())).toEqual({
        by: 'wp-rocket',
        mark,
        feature: 'Preconnect to External Domains'
      });
    }
  });
});

describe('hintRank', () => {
  /** Rank of a hint read with its own attribution. */
  const rank = (hint: ResourceHint): number =>
    hintRank(hint, hintAttribution(hint, emptyDetections()));

  it('orders WP Rocket before unattributed, then kind, preloads by type', () => {
    const order: ResourceHint[] = [
      stamped('preload', 'preload', 'image'),
      stamped('preload', 'preload', 'font'),
      stamped('preload', 'preload', 'style'),
      stamped('preload', 'preload', 'script'),
      stamped('preload', 'preload', 'fetch'),
      stamped('preload', 'preload', 'json'),
      stamped('preload', 'preload', ''),
      stamped('preconnect', 'preconnect'),
      stamped('prefetch', 'dns-prefetch'),
      { rel: 'preload', href: '', as: 'image' },
      { rel: 'preload', href: '', as: 'video' },
      { rel: 'preload', href: '', as: '' },
      { rel: 'modulepreload', href: '', as: 'script' },
      { rel: 'preconnect', href: '', as: 'image' },
      { rel: 'dns-prefetch', href: '', as: '' }
    ];
    const ranks = order.map(rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('ignores `as` on non-preload kinds and ranks unknown preload types together', () => {
    expect(rank({ rel: 'modulepreload', href: '', as: 'image' })).toBe(
      rank({ rel: 'modulepreload', href: '', as: '' })
    );
    expect(rank({ rel: 'preload', href: '', as: 'audio' })).toBe(
      rank({ rel: 'preload', href: '', as: 'track' })
    );
  });
});
