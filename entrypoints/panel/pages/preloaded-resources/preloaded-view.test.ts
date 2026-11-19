import { describe, expect, it } from 'vitest';
import { DNS_PREFETCH_LIMIT } from '../../../../lib/detection/hud';
import { UNATTRIBUTED } from '../../../../lib/panel/hint-attribution';
import type { PreloadedResource } from '../../../../lib/panel/resources-view-model';
import { emptyDetections } from '../../../../lib/panel/support-report.fixtures';
import type { ResourceHint } from '../../../../lib/wp-rocket/types';
import {
  attributionChip,
  hintFacts,
  hintFetchesFile,
  hintIcon,
  hintKind,
  hintKindChip,
  hintPreview,
  missingUrlLabel,
  missingUrlNote,
  NO_URL_LABEL,
  NO_URL_NOTE,
  preloadedInventory,
  preloadedNotes,
  preloadedRowKeys,
  preloadedRowViews,
  preloadedSearchField,
  PRELOADED_VIEW_FACETS,
  samePreloadedRow,
  samePreloadedView,
  SRCSET_ONLY_LABEL,
  SRCSET_ONLY_NOTE,
  stampMarkup,
  wpRocketHintsPresent,
  type PreloadedRowView
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

describe('row views', () => {
  /**
   * One view of one row.
   *
   * @param overrides The row's overrides.
   * @param clipped The clip mark.
   */
  function view(overrides: Partial<PreloadedResource> = {}, clipped = false): PreloadedRowView {
    const [built] = preloadedRowViews([row(overrides)], () => clipped);
    if (built === undefined) throw new Error('no view');
    return built;
  }

  it('leads with an icon by what the hint fetches', () => {
    expect(
      [
        row(),
        row({ as: 'font' }),
        row({ as: 'style' }),
        row({ as: 'script' }),
        row({ as: 'fetch' }),
        row({ as: '' }),
        row({ rel: 'modulepreload', as: '' }),
        row({ rel: 'modulepreload', as: 'image' }),
        row({ rel: 'preconnect', as: 'image' }),
        row({ rel: 'dns-prefetch' })
      ].map(hintIcon)
    ).toEqual([
      'image',
      'font',
      'style',
      'script',
      'file',
      'file',
      'script',
      'script',
      'origin',
      'origin'
    ]);
  });

  it('previews the kind, a preload’s type, then the URL without its scheme', () => {
    expect(hintPreview(row({ href: 'https://cdn.test/a/hero.webp?v=1' }))).toBe(
      'preload · image · cdn.test/a/hero.webp?v=1'
    );
    expect(hintPreview(row({ rel: 'preconnect', as: 'font', href: 'https://fonts.test' }))).toBe(
      'preconnect · fonts.test/'
    );
    expect(hintPreview(row({ href: '' }))).toBe('preload · image');
  });

  it('names a row by its file (or host), else by the missing-URL words', () => {
    expect(view({ href: 'https://cdn.test/a/hero.webp' }).name).toBe('hero.webp');
    expect(view({ rel: 'preconnect', as: '', href: 'https://fonts.test' }).name).toBe('fonts.test');
    expect(view({ href: '' }).name).toBe(SRCSET_ONLY_LABEL);
    expect(view({ rel: 'modulepreload', as: '', href: '' }).name).toBe(NO_URL_LABEL);
  });

  it('carries the clip mark and the attribution chip', () => {
    const stamped = view(
      { attribution: { by: 'wp-rocket', mark: 'preload', feature: 'Preload fonts' } },
      true
    );
    expect(stamped.clipped).toBe(true);
    expect(stamped.attribution).toEqual(
      attributionChip({ by: 'wp-rocket', mark: 'preload', feature: 'Preload fonts' })
    );
    expect(view().attribution.id).toBe('unattributed');
  });

  it('keys rows by kind, type, URL and occurrence, never position', () => {
    const rows = [row(), row({ as: 'font' }), row(), row({ rel: 'modulepreload' })];
    const keys = preloadedRowKeys(rows);
    expect(new Set(keys).size).toBe(4);
    expect(preloadedRowKeys([row({ href: 'https://x/new' }), ...rows]).slice(1)).toEqual(keys);
  });

  it('keys hints of one URL apart by kind and by type, so removing one keeps the other', () => {
    // Same URL, same type, different kind; then same URL, same kind, different type.
    for (const [first, second] of [
      [row({ rel: 'preconnect', as: '' }), row({ rel: 'dns-prefetch', as: '' })],
      [row({ as: 'image' }), row({ as: 'font' })]
    ] as const) {
      const [, secondKey] = preloadedRowKeys([first, second]);
      expect(preloadedRowKeys([second])).toEqual([secondKey]);
    }
  });

  it('views match on the row data and the clip mark only', () => {
    expect(samePreloadedView(view(), view({ id: 7 }))).toBe(true);
    expect(samePreloadedView(view(), view({}, true))).toBe(false);
    expect(
      samePreloadedView(
        view(),
        view({ attribution: { by: 'wp-rocket', mark: 'preload', feature: null } })
      )
    ).toBe(false);
  });

  it('searches the URL and filters by the lifted facets', () => {
    const image = view();
    const dns = view({ rel: 'dns-prefetch', as: '', href: 'https://d.test' });
    expect(preloadedSearchField(dns)).toBe('https://d.test');
    const hintValues = PRELOADED_VIEW_FACETS.byId
      .get('hint')
      ?.values.filter((value) => value.predicate(dns))
      .map((value) => value.id);
    expect(hintValues).toEqual(['dns-prefetch']);
    const typeValues = PRELOADED_VIEW_FACETS.byId
      .get('preload-type')
      ?.values.filter((value) => value.predicate(image))
      .map((value) => value.id);
    expect(typeValues).toEqual(['images']);
  });

  it('names the detail by the hint kind', () => {
    expect(
      (['preload', 'modulepreload', 'preconnect', 'dns-prefetch'] as const).map((rel) =>
        hintKind(view({ rel }))
      )
    ).toEqual(['Preload', 'Module preload', 'Preconnect', 'DNS prefetch']);
  });
});

describe('detail rules', () => {
  it('opens files in Sources, never an origin', () => {
    expect(hintFetchesFile(row())).toBe(true);
    expect(hintFetchesFile(row({ rel: 'modulepreload' }))).toBe(true);
    expect(hintFetchesFile(row({ rel: 'preconnect' }))).toBe(false);
    expect(hintFetchesFile(row({ rel: 'dns-prefetch' }))).toBe(false);
  });

  it('says why a hint has no URL', () => {
    expect(missingUrlNote(row({ href: '' }))).toBe(SRCSET_ONLY_NOTE);
    expect(missingUrlNote(row({ as: 'font', href: '' }))).toBe(NO_URL_NOTE);
    expect(missingUrlNote(row({ rel: 'modulepreload', as: 'image', href: '' }))).toBe(NO_URL_NOTE);
  });

  it('writes each stamp as the tag carries it', () => {
    expect(stampMarkup('preload')).toBe('data-rocket-preload');
    expect(stampMarkup('async')).toBe('data-rocket-async="style"');
    expect(stampMarkup('preconnect')).toBe('data-rocket-preconnect');
    expect(stampMarkup('prefetch')).toBe('data-rocket-prefetch');
  });

  it('lists rel, a non-empty as, the stamp and a proven feature', () => {
    expect(hintFacts(row())).toEqual([
      { label: 'Rel', value: 'preload', mono: true },
      { label: 'As', value: 'image', mono: true }
    ]);
    expect(hintFacts(row({ rel: 'dns-prefetch', as: '' }))).toEqual([
      { label: 'Rel', value: 'dns-prefetch', mono: true }
    ]);
    expect(
      hintFacts(
        row({ as: 'style', attribution: { by: 'wp-rocket', mark: 'async', feature: null } })
      )
    ).toEqual([
      { label: 'Rel', value: 'preload', mono: true },
      { label: 'As', value: 'style', mono: true },
      { label: 'WP Rocket stamp', value: 'data-rocket-async="style"', mono: true }
    ]);
    expect(
      hintFacts(
        row({
          rel: 'preconnect',
          as: '',
          attribution: {
            by: 'wp-rocket',
            mark: 'preconnect',
            feature: 'Preconnect to External Domains'
          }
        })
      )
    ).toEqual([
      { label: 'Rel', value: 'preconnect', mono: true },
      { label: 'WP Rocket stamp', value: 'data-rocket-preconnect', mono: true },
      { label: 'Feature', value: 'Preconnect to External Domains', mono: false }
    ]);
  });
});
