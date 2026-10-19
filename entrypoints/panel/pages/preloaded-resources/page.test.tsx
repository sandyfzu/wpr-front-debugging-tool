/**
 * Render suite of the Preloaded Resources page: its summary (the "Preload"
 * badge), the `as` chips, the image/font filters, its search field and the two
 * distinct empty states. The shared body's search/focus/refresh behavior is
 * pinned once, by the Lazyload suite.
 */
import { cleanup, fireEvent, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FdtData, PreloadedResources } from '../../../../lib/wp-rocket/types';
import { SEARCH_DEBOUNCE_MS } from '../../state/search';
import { makeFdtData } from '../../state/fixtures';
import { renderPage } from '../resource-list/page-harness';
import { PreloadedResourcesPage } from './page';

/** A payload carrying the given report. */
function withReport(preloadedResources: PreloadedResources): FdtData {
  return makeFdtData({ preloadedResources });
}

/** The standard fixture: images (mixed casing), fonts, other types, no type, no href. */
function fixture(): FdtData {
  return withReport({
    present: true,
    resources: [
      { href: 'https://cdn.example/wp/hero.webp', type: 'image' },
      { href: 'https://cdn.example/wp/logo.png', type: 'IMAGE' },
      { href: 'https://cdn.example/wp/inter.woff2', type: 'font' },
      { href: 'https://cdn.example/wp/app.js', type: 'script' },
      { href: 'https://cdn.example/wp/blob.bin', type: '' },
      { href: '', type: 'image' }
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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('PreloadedResourcesPage', () => {
  it('renders the frame and the feature badge as "Preload hints" (never "Lazyload")', () => {
    const { root } = renderPage(PreloadedResourcesPage, fixture());
    expect(root.getAttribute('data-fdt-page')).toBe('preloaded-resources');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Preloaded Resources');
    const summary = root.querySelector('[data-fdt="resource-summary"]');
    expect(summary?.textContent).toContain('Preload hints');
    expect(summary?.textContent).toContain('detected');
    expect(summary?.textContent).not.toContain('Lazyload');
    expect(root.querySelector('[data-fdt="resource-total"]')?.textContent).toBe('6 resources');
  });

  it('counts images and fonts case-insensitively on the chips', () => {
    const { root } = renderPage(PreloadedResourcesPage, fixture());
    expect(screen.getByRole('button', { name: 'Show all 6 matching' })).toBe(chip(root, 'all'));
    expect(screen.getByRole('button', { name: 'Images 3 matching' })).toBe(chip(root, 'images'));
    expect(screen.getByRole('button', { name: 'Fonts 1 matching' })).toBe(chip(root, 'fonts'));
  });

  it('leads each row with its lower-cased `as` chip, "—" (read as "No type") when absent', () => {
    renderPage(PreloadedResourcesPage, fixture());
    const items = screen.getAllByRole('listitem');
    expect(within(items[1] as HTMLElement).getByText('image')).toBeTruthy();
    expect(within(items[3] as HTMLElement).getByText('script')).toBeTruthy();
    const untyped = within(items[4] as HTMLElement);
    expect(untyped.getByText('—').getAttribute('aria-hidden')).toBe('true');
    expect(untyped.getByText('No type').className).toContain('sr-only');
  });

  it('links absolute URLs, offers a "URL" copy, and is honest about a missing href', () => {
    renderPage(PreloadedResourcesPage, fixture());
    expect(screen.getAllByRole('link')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'URL (hero.webp) — copy' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^URL \(.+\) — copy$/ })).toHaveLength(5);
    expect(
      within(screen.getAllByRole('listitem')[5] as HTMLElement).getByText('No URL (srcset only)')
    ).toBeTruthy();
  });

  it('filters fonts, then searches by href', () => {
    const { root } = renderPage(PreloadedResourcesPage, fixture());
    fireEvent.click(chip(root, 'images'));
    expect(rowNames(root)).toEqual(['hero.webp', 'logo.png']);
    fireEvent.click(chip(root, 'all'));
    const field = screen.getByRole('searchbox', { name: 'Search resource URLs' });
    fireEvent.input(field, { target: { value: 'WOFF2' } });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(rowNames(root)).toEqual(['inter.woff2']);
  });

  it('says "No preloaded resources on this page" when nothing carries the marker', () => {
    const { root } = renderPage(PreloadedResourcesPage, withReport({ present: false }));
    expect(screen.getByText('No preloaded resources on this page')).toBeTruthy();
    expect(screen.queryByText('Preload inventory not collected')).toBeNull();
    expect(root.querySelector('[data-fdt="filter-bar"]')).toBeNull();
    expect(root.querySelector('[data-fdt="resource-summary"]')?.textContent).toContain(
      'not detected'
    );
    // No "0 resources" beside an empty state that already says so.
    expect(root.querySelector('[data-fdt="resource-total"]')).toBeNull();
  });

  it('says the same for a collected but empty list', () => {
    renderPage(PreloadedResourcesPage, withReport({ present: true, resources: [] }));
    expect(screen.getByText('No preloaded resources on this page')).toBeTruthy();
  });

  it('tells a present feature without a collected list apart ("not collected")', () => {
    renderPage(PreloadedResourcesPage, withReport({ present: true }));
    expect(screen.getByText('Preload inventory not collected')).toBeTruthy();
    expect(screen.queryByText('No preloaded resources on this page')).toBeNull();
  });

  it('follows a refresh from rows to the empty state and back', () => {
    const page = renderPage(PreloadedResourcesPage, fixture());
    page.refresh(withReport({ present: false }));
    expect(screen.getByText('No preloaded resources on this page')).toBeTruthy();
    page.refresh(fixture());
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
  });

  describe('find navigation (the resource-list body’s side)', () => {
    /** The refresh handle plus the store this body reads. */
    function findPage(): ReturnType<typeof renderPage> {
      return renderPage(PreloadedResourcesPage, fixture());
    }

    /** The row carrying the find's current match, if any. */
    function currentRow(): HTMLElement | null {
      return document.querySelector<HTMLElement>('[role="listitem"][aria-current="true"]');
    }

    it('reports the match count and marks the cursor’s row under a live query', () => {
      const page = findPage();
      page.search.perform('cdn.example');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(5); // every row with an href
      expect(page.search.matchCount()).toBe(5);
      expect(currentRow()).toBe(items[0]); // hero.webp

      page.search.advance(1);
      expect(currentRow()).toBe(screen.getAllByRole('listitem')[1]); // logo.png

      page.search.advance(-1);
      expect(currentRow()).toBe(items[0]);
      page.search.advance(-1); // backward wrap: first → last (blob.bin)
      expect(currentRow()).toBe(items[4]);

      page.search.cancel();
      expect(page.search.matchCount()).toBe(0);
      expect(currentRow()).toBeNull();
    });

    it('a refresh shrinking the set re-reports and hides an out-of-range cursor', () => {
      const page = findPage();
      page.search.perform('cdn.example');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      page.search.advance(1); // cursor on the third row (inter.woff2)
      page.search.advance(1);
      expect(currentRow()).toBeTruthy();

      // The refresh keeps two of the five href rows: the cursor (2) is past
      // the set — no row is named, and the reported count follows the list.
      page.refresh(
        withReport({
          present: true,
          resources: [
            { href: 'https://cdn.example/wp/hero.webp', type: 'image' },
            { href: 'https://cdn.example/wp/logo.png', type: 'IMAGE' }
          ]
        })
      );
      expect(page.search.matchCount()).toBe(2);
      expect(currentRow()).toBeNull();

      page.search.advance(1); // snaps the stale cursor into range
      expect(currentRow()).toBe(screen.getAllByRole('listitem')[0]);
    });
  });
});
