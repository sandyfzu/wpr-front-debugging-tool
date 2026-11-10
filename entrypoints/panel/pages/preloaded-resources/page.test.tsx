/**
 * Render suite of the Preloaded Resources page: its summary ("WP Rocket
 * hints" badge, total, notes), the kind and attribution chips, the inventory
 * order (WP Rocket first), the chip filters, its search field and the two
 * distinct empty states. The shared body's search/focus/refresh behavior is
 * pinned once, by the Lazyload suite.
 */
import { cleanup, fireEvent, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DNS_PREFETCH_LIMIT } from '../../../../lib/detection/hud';
import type { FdtData, PreloadedResources } from '../../../../lib/wp-rocket/types';
import { SEARCH_DEBOUNCE_MS } from '../../state/search';
import { makeFdtData } from '../../state/fixtures';
import { renderPage } from '../resource-list/page-harness';
import { PreloadedResourcesPage } from './page';

/** A payload carrying the given report (Optimize Critical Images detected unless told). */
function withReport(preloadedResources: PreloadedResources, oci = true): FdtData {
  const data = makeFdtData({ preloadedResources });
  data.wprDetections.rocket_above_the_fold_optimization.present = oci;
  return data;
}

/**
 * The standard fixture, capture order: a plain DNS hint, stamped image
 * preloads (one srcset-only), a plain image preload, a stamped font preload,
 * a plain module preload, a stamped preconnect.
 */
function fixture(): FdtData {
  return withReport({
    present: true,
    resources: [],
    hints: [
      { rel: 'dns-prefetch', href: 'https://dns.example/', as: '' },
      { rel: 'preload', href: 'https://cdn.example/wp/hero.webp', as: 'image', mark: 'preload' },
      { rel: 'preload', href: 'https://cdn.example/wp/logo.png', as: 'image' },
      { rel: 'preload', href: 'https://cdn.example/wp/inter.woff2', as: 'font', mark: 'preload' },
      { rel: 'modulepreload', href: 'https://cdn.example/wp/app.js', as: '' },
      { rel: 'preconnect', href: 'https://fonts.example/', as: '', mark: 'preconnect' },
      { rel: 'preload', href: '', as: 'image', mark: 'preload' }
    ]
  });
}

/** The chip button for an id. */
function chip(root: HTMLElement, id: string): HTMLButtonElement {
  const found = root.querySelector<HTMLButtonElement>(`[data-fdt-filter-chip="${id}"]`);
  if (found === null) throw new Error(`no chip ${id}`);
  return found;
}

/** The visible row names, in order. */
function rowNames(root: HTMLElement): string[] {
  return [...root.querySelectorAll('[data-fdt="resource-name"]')].map((n) => n.textContent);
}

/** Each row's kind chip and attribution chip text, in order. */
function rowChips(): string[][] {
  return screen
    .getAllByRole('listitem')
    .map((item) => [
      item.querySelector('[data-fdt="hint-kind"]')?.parentElement?.textContent ?? '',
      item.querySelector('[data-fdt="state-chip"]')?.textContent ?? ''
    ]);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('PreloadedResourcesPage', () => {
  it('renders the frame, the "WP Rocket hints" badge and the hint total', () => {
    const { root } = renderPage(PreloadedResourcesPage, fixture());
    expect(root.getAttribute('data-fdt-page')).toBe('preloaded-resources');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Preloaded Resources');
    const summary = root.querySelector('[data-fdt="resource-summary"]');
    expect(summary?.textContent).toContain('WP Rocket hints');
    expect(summary?.textContent).toContain('detected');
    expect(root.querySelector('[data-fdt="resource-total"]')?.textContent).toBe('7 hints');
    expect(root.querySelectorAll('[data-fdt="resource-note"]')).toHaveLength(0);
  });

  it('keeps WP Rocket hints apart, first, grouped by kind; names features only on proof', () => {
    renderPage(PreloadedResourcesPage, fixture());
    expect(rowChips()).toEqual([
      ['preload · image', 'WP Rocket (Optimize Critical Images)'],
      ['preload · image', 'WP Rocket (Optimize Critical Images)'],
      // Preload fonts is not detected: the shared stamp names WP Rocket only.
      ['preload · font', 'WP Rocket'],
      ['preconnect', 'WP Rocket (Preconnect to External Domains)'],
      ['preload · image', 'Unattributed'],
      ['modulepreload', 'Unattributed'],
      ['dns-prefetch', 'Unattributed']
    ]);
  });

  it('names no feature on an image preload without the critical-images row', () => {
    const data = fixture();
    data.wprDetections.rocket_above_the_fold_optimization.present = false;
    renderPage(PreloadedResourcesPage, data);
    expect(rowChips()[0]).toEqual(['preload · image', 'WP Rocket']);
  });

  it('counts every chip in one pass over the rows', () => {
    const { root } = renderPage(PreloadedResourcesPage, fixture());
    const counts = Object.fromEntries(
      [...root.querySelectorAll<HTMLElement>('[data-fdt-filter-chip]')].map(
        (button): [string, string | undefined] => [
          button.dataset['fdtFilterChip'] ?? '',
          button.querySelector('[data-fdt-filter-count]')?.textContent
        ]
      )
    );
    expect(counts).toEqual({
      all: '7',
      'wp-rocket': '4',
      unattributed: '3',
      preload: '4',
      images: '3',
      fonts: '1',
      modulepreload: '1',
      preconnect: '1',
      'dns-prefetch': '1'
    });
    expect(screen.getByRole('button', { name: 'Show all 7 matching' })).toBe(chip(root, 'all'));
  });

  it('links absolute URLs, offers a "URL" copy, and is honest about a missing href', () => {
    renderPage(PreloadedResourcesPage, fixture());
    expect(screen.getAllByRole('link')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'URL (hero.webp) — copy' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^URL \(.+\) — copy$/ })).toHaveLength(6);
    expect(
      within(screen.getAllByRole('listitem')[1] as HTMLElement).getByText('No URL (srcset only)')
    ).toBeTruthy();
  });

  it('filters by attribution and kind, then searches by href', () => {
    const { root } = renderPage(PreloadedResourcesPage, fixture());
    fireEvent.click(chip(root, 'unattributed'));
    expect(rowNames(root)).toEqual(['logo.png', 'app.js', 'dns.example']);
    fireEvent.click(chip(root, 'images'));
    expect(rowNames(root)).toEqual(['hero.webp', 'logo.png']);
    fireEvent.click(chip(root, 'all'));
    const field = screen.getByRole('searchbox', { name: 'Search hint URLs' });
    fireEvent.input(field, { target: { value: 'WOFF2' } });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(rowNames(root)).toEqual(['inter.woff2']);
  });

  it('notes the DNS prefetch limit when the row is declared beside plain DNS hints', () => {
    const data = fixture();
    data.wprDetections.dns_prefetch.present = true;
    const { root } = renderPage(PreloadedResourcesPage, data);
    expect(
      [...root.querySelectorAll('[data-fdt="resource-note"]')].map((note) => note.textContent)
    ).toEqual([DNS_PREFETCH_LIMIT]);
  });

  it('shows plain hints alone without any WP Rocket wording', () => {
    const { root } = renderPage(
      PreloadedResourcesPage,
      withReport({
        present: false,
        hints: [{ rel: 'modulepreload', href: 'https://site.example/m.js', as: '' }]
      })
    );
    expect(root.querySelector('[data-fdt="resource-summary"]')?.textContent).toContain(
      'not detected'
    );
    expect(rowChips()).toEqual([['modulepreload', 'Unattributed']]);
    expect(root.querySelector('[data-fdt="state-chip-mark"]')).toBeNull();
  });

  it('reads a capture without the inventory as its WP Rocket preloads, and says so', () => {
    const { root } = renderPage(
      PreloadedResourcesPage,
      withReport({ present: true, resources: [{ href: 'https://a.example/x.png', type: 'IMAGE' }] })
    );
    expect(rowChips()).toEqual([['preload · image', 'WP Rocket (Optimize Critical Images)']]);
    expect(root.querySelector('[data-fdt="resource-note"]')?.textContent).toBe(
      "This capture lists WP Rocket's preloads only. Reload the inspected page to list every resource hint."
    );
  });

  it('says "No resource hints on this page" without any hint', () => {
    const { root } = renderPage(PreloadedResourcesPage, withReport({ present: false, hints: [] }));
    expect(screen.getByText('No resource hints on this page')).toBeTruthy();
    expect(screen.queryByText('Hint inventory not collected')).toBeNull();
    expect(root.querySelector('[data-fdt="filter-bar"]')).toBeNull();
    expect(root.querySelector('[data-fdt="resource-summary"]')?.textContent).toContain(
      'not detected'
    );
    // No "0 hints" beside an empty state that already says so.
    expect(root.querySelector('[data-fdt="resource-total"]')).toBeNull();
  });

  it('says "not collected" for a capture without a hint list, marker or not', () => {
    const page = renderPage(PreloadedResourcesPage, withReport({ present: false }));
    for (const report of [{ present: false }, { present: true }]) {
      page.refresh(withReport(report));
      expect(screen.getByText('Hint inventory not collected')).toBeTruthy();
      expect(
        screen.getByText(
          'This capture carries no hint list. Reload the inspected page to list every resource hint.'
        )
      ).toBeTruthy();
      expect(screen.queryByText('No resource hints on this page')).toBeNull();
    }
  });

  it('follows a refresh from rows to the empty state and back', () => {
    const page = renderPage(PreloadedResourcesPage, fixture());
    page.refresh(withReport({ present: false, hints: [] }));
    expect(screen.getByText('No resource hints on this page')).toBeTruthy();
    page.refresh(fixture());
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
  });

  describe('find navigation (the resource-list body’s side)', () => {
    /** The row carrying the find's current match, if any. */
    function currentRow(): HTMLElement | null {
      return document.querySelector<HTMLElement>('[role="listitem"][aria-current="true"]');
    }

    it('reports the match count and marks the cursor’s row under a live query', () => {
      const page = renderPage(PreloadedResourcesPage, fixture());
      page.search.perform('cdn.example');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(4); // hero, inter, logo, app
      expect(page.search.matchCount()).toBe(4);
      expect(currentRow()).toBe(items[0]);
      page.search.advance(1);
      expect(currentRow()).toBe(screen.getAllByRole('listitem')[1]);
      page.search.advance(-1);
      page.search.advance(-1); // backward wrap: first → last
      expect(currentRow()).toBe(items[3]);
      page.search.cancel();
      expect(page.search.matchCount()).toBe(0);
      expect(currentRow()).toBeNull();
    });
  });
});
