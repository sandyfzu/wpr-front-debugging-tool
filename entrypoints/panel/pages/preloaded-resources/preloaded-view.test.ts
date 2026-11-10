import { describe, expect, it } from 'vitest';
import { DNS_PREFETCH_LIMIT } from '../../../../lib/detection/hud';
import { UNATTRIBUTED } from '../../../../lib/panel/hint-attribution';
import type { PreloadedResource } from '../../../../lib/panel/resources-view-model';
import { emptyDetections } from '../../../../lib/panel/support-report.fixtures';
import type { ResourceHint } from '../../../../lib/wp-rocket/types';
import {
  attributionChip,
  hintKindChip,
  missingUrlLabel,
  NO_URL_LABEL,
  preloadedInventory,
  preloadedNotes,
  samePreloadedRow,
  SRCSET_ONLY_LABEL,
  wpRocketHintsPresent
} from './preloaded-view';

/** A plain row. */
function row(overrides: Partial<PreloadedResource> = {}): PreloadedResource {
  return {
    id: 0,
    rel: 'preload',
    as: 'image',
    href: 'https://a/b',
    attribution: UNATTRIBUTED,
    ...overrides
  };
}

const hint: ResourceHint = { rel: 'preconnect', href: 'https://a/', as: '' };

describe('preloadedInventory', () => {
  it('reads an empty hint list as "none"', () => {
    expect(preloadedInventory({ present: false, hints: [] })).toBe('none');
    expect(preloadedInventory({ present: true, resources: [], hints: [] })).toBe('none');
  });

  it('reads a capture without a hint list and nothing to show as "not collected"', () => {
    // Its hints were never read: "no hints" would be a claim it cannot back.
    expect(preloadedInventory({ present: false })).toBe('not-collected');
    expect(preloadedInventory({ present: true })).toBe('not-collected');
    expect(preloadedInventory({ present: true, resources: [] })).toBe('not-collected');
  });

  it('reads any hint as rows — plain hints alone included, and a preload-only capture', () => {
    expect(preloadedInventory({ present: false, hints: [hint] })).toBe('rows');
    expect(
      preloadedInventory({ present: true, resources: [{ href: 'https://a/b', type: 'font' }] })
    ).toBe('rows');
  });
});

describe('hintKindChip', () => {
  it('shows the rel, and the type on a preload only', () => {
    expect(hintKindChip(row())).toEqual({ rel: 'preload', as: 'image' });
    expect(hintKindChip(row({ as: '' }))).toEqual({ rel: 'preload', as: null });
    expect(hintKindChip(row({ rel: 'modulepreload', as: 'script' }))).toEqual({
      rel: 'modulepreload',
      as: null
    });
    expect(hintKindChip(row({ rel: 'dns-prefetch', as: '' }))).toEqual({
      rel: 'dns-prefetch',
      as: null
    });
  });
});

describe('missingUrlLabel', () => {
  it('reads an image preload as srcset-only, anything else as no URL', () => {
    expect(missingUrlLabel(row())).toBe(SRCSET_ONLY_LABEL);
    expect(missingUrlLabel(row({ as: 'font' }))).toBe(NO_URL_LABEL);
    expect(missingUrlLabel(row({ rel: 'preconnect', as: 'image' }))).toBe(NO_URL_LABEL);
  });
});

describe('samePreloadedRow', () => {
  it('compares kind, type, URL and attribution', () => {
    const wpr = {
      by: 'wp-rocket',
      mark: 'preload',
      feature: null
    } as const;
    const a = row({ attribution: wpr });
    expect(samePreloadedRow(a, { ...a })).toBe(true);
    expect(samePreloadedRow(a, { ...a, attribution: { ...wpr } })).toBe(true);
    expect(samePreloadedRow(a, { ...a, href: 'https://a/c' })).toBe(false);
    expect(samePreloadedRow(a, { ...a, as: 'font' })).toBe(false);
    expect(samePreloadedRow(a, { ...a, rel: 'modulepreload' })).toBe(false);
    expect(samePreloadedRow(a, { ...a, attribution: UNATTRIBUTED })).toBe(false);
    expect(samePreloadedRow(row(), row({ attribution: wpr }))).toBe(false);
    expect(samePreloadedRow(row(), row())).toBe(true);
    expect(samePreloadedRow(a, { ...a, attribution: { ...wpr, feature: 'Preload fonts' } })).toBe(
      false
    );
    expect(samePreloadedRow(a, { ...a, attribution: { ...wpr, mark: 'async' } })).toBe(false);
  });
});

describe('wpRocketHintsPresent', () => {
  it('holds when any row is WP Rocket', () => {
    expect(wpRocketHintsPresent([])).toBe(false);
    expect(wpRocketHintsPresent([row()])).toBe(false);
    expect(
      wpRocketHintsPresent([
        row(),
        row({ attribution: { by: 'wp-rocket', mark: 'prefetch', feature: null } })
      ])
    ).toBe(true);
  });
});

describe('attributionChip', () => {
  it('reads a plain hint "Unattributed", never claiming it', () => {
    expect(attributionChip(UNATTRIBUTED)).toEqual({
      id: 'unattributed',
      label: 'Unattributed',
      kind: 'neutral',
      title:
        'No WP Rocket stamp, so its author is unproven: WordPress core, the theme, a plugin, or WP Rocket itself (its DNS prefetch, Google Fonts and CDN hints carry no stamp).'
    });
  });

  it('marks a proven feature and names the stamp', () => {
    expect(
      attributionChip({ by: 'wp-rocket', mark: 'preload', feature: 'Optimize Critical Images' })
    ).toEqual({
      id: 'wp-rocket',
      label: 'WP Rocket',
      kind: 'info',
      mark: 'Optimize Critical Images',
      title: 'data-rocket-preload: written by Optimize Critical Images, detected on this page.'
    });
    expect(
      attributionChip({
        by: 'wp-rocket',
        mark: 'prefetch',
        feature: 'Preconnect to External Domains'
      }).title
    ).toBe(
      'data-rocket-prefetch: written by Preconnect to External Domains, detected on this page.'
    );
  });

  it('says why a shared stamp names no feature', () => {
    const preload = attributionChip({ by: 'wp-rocket', mark: 'preload', feature: null });
    expect(preload).toMatchObject({ label: 'WP Rocket', kind: 'info' });
    expect(preload.mark).toBeUndefined();
    expect(preload.title).toBe(
      'data-rocket-preload: several WP Rocket features write it (critical images, fonts, Google Fonts), and this page does not prove which.'
    );
    expect(attributionChip({ by: 'wp-rocket', mark: 'async', feature: null }).title).toBe(
      'data-rocket-async: Load CSS asynchronously writes it, but that feature is not detected on this page.'
    );
    // Never happens (Preconnect's stamps always name it); still worded.
    expect(attributionChip({ by: 'wp-rocket', mark: 'preconnect', feature: null }).title).toBe(
      'data-rocket-preconnect: written by WP Rocket.'
    );
  });
});

describe('preloadedNotes', () => {
  const none = emptyDetections();
  const full = Array.from({ length: 5000 }, () => hint);

  it('notes the hint cap only with its own mark and a list at its cap', () => {
    const note = 'The list was capped at the first 5,000 hints; counts cover these rows.';
    expect(preloadedNotes({ present: false, hints: full, hintsTruncated: true }, [], none)).toEqual(
      [note]
    );
    expect(preloadedNotes({ present: false, hints: full }, [], none)).toEqual([]);
    expect(
      preloadedNotes({ present: false, hints: [hint], hintsTruncated: true }, [], none)
    ).toEqual([]);
    // The preload list's mark is not the hints'.
    expect(
      preloadedNotes({ present: true, resources: [], truncated: true, hints: full }, [], none)
    ).toEqual([]);
    expect(preloadedNotes({ present: false }, [], none)).toEqual([]);
  });

  it('says a capture without the inventory lists preloads only (and reads its own cap)', () => {
    const resources = Array.from({ length: 5000 }, () => ({ href: 'https://a/b', type: 'font' }));
    expect(preloadedNotes({ present: true, resources, truncated: true }, [row()], none)).toEqual([
      'The list was capped at the first 5,000 hints; counts cover these rows.',
      "This capture lists WP Rocket's preloads only. Reload the inspected page to list every resource hint."
    ]);
    expect(preloadedNotes({ present: true, resources: [] }, [], none)).toEqual([]);
  });

  it('adds the DNS prefetch limit only when declared and a plain DNS hint is listed', () => {
    const declared = emptyDetections();
    declared.dns_prefetch.present = true;
    const report = { present: false, hints: [hint] };
    const plainDns = row({ rel: 'dns-prefetch', as: '' });
    const stampedDns = row({
      rel: 'dns-prefetch',
      as: '',
      attribution: { by: 'wp-rocket', mark: 'prefetch', feature: 'Preconnect to External Domains' }
    });
    expect(preloadedNotes(report, [plainDns], declared)).toEqual([DNS_PREFETCH_LIMIT]);
    expect(preloadedNotes(report, [plainDns], none)).toEqual([]);
    expect(preloadedNotes(report, [stampedDns], declared)).toEqual([]);
    expect(preloadedNotes(report, [row()], declared)).toEqual([]);
  });
});
