/**
 * Render suite of the Lazyload page — and, through it, of the shared
 * resource-list body (search wiring, chips, states, focus, announcements).
 */
import { cleanup, fireEvent, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FDT_EXCLUDED_RESOURCE } from '../../../../lib/wp-rocket/constants';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { SEARCH_DEBOUNCE_MS } from '../../state/search';
import { makeFdtData, makeLazyImage } from '../../state/fixtures';
import { laggedVirtualizer, renderPage, type PageHarness } from '../resource-list/page-harness';
import { LIST_WIDTH } from '../resource-list/resource-list';
import { LazyloadPage } from './page';

/** A payload with the given images and lazyload presence. */
function withImages(
  images: FdtData['wprDetections']['lazyload']['images'],
  present = true
): FdtData {
  const base = makeFdtData();
  return { ...base, wprDetections: { ...base.wprDetections, lazyload: { present, images } } };
}

/** The standard fixture: two lazyloaded, three not (tool marker, reasons, none). */
function fixture(): FdtData {
  return withImages([
    makeLazyImage({ src: 'https://cdn.example/up/hero.webp', lazyloadDetected: true }),
    makeLazyImage({
      src: 'https://cdn.example/up/logo.png',
      lazyloadDetected: false,
      excludedReasonsFound: ['data-skip-lazy', 'skip-lazy']
    }),
    makeLazyImage({
      src: 'https://cdn.example/up/excluded.jpg',
      lazyloadDetected: false,
      excludedReasonsFound: ['data-src', FDT_EXCLUDED_RESOURCE]
    }),
    makeLazyImage({ src: 'https://cdn.example/up/plain.jpg', lazyloadDetected: false }),
    makeLazyImage({ src: '/up/gallery.jpg', lazyloadDetected: true })
  ]);
}

/** The visible row names, in order. */
function rowNames(root: HTMLElement): string[] {
  return [...root.querySelectorAll('[data-fdt="resource-name"]')].map((n) => n.textContent);
}

/** The chip button for an id. */
function chip(root: HTMLElement, id: string): HTMLButtonElement {
  const found = root.querySelector<HTMLButtonElement>(`[data-fdt-filter-chip="${id}"]`);
  if (found === null) throw new Error(`no chip ${id}`);
  return found;
}

/** The page's search field. */
function field(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search image URLs' });
}

/** Type into the field and let the store commit. */
function type(text: string): void {
  fireEvent.input(field(), { target: { value: text } });
  vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
}

/** The polite results line. */
function announced(root: HTMLElement): string {
  return root.querySelector('[data-fdt="resource-results-status"]')?.textContent ?? '';
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('LazyloadPage — frame and summary', () => {
  it('renders the frame, the feature badge with its spelled-out state, and the total', () => {
    const { root } = renderPage(LazyloadPage, fixture());
    expect(root.getAttribute('data-fdt-page')).toBe('lazyload');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Lazyload');
    const summary = root.querySelector('[data-fdt="resource-summary"]');
    expect(summary?.textContent).toContain('Lazyload for images');
    expect(summary?.textContent).toContain('detected');
    expect(root.querySelector('[data-fdt="resource-total"]')?.textContent).toBe('5 images');
  });

  it('spells out an absent feature as "not detected" in the neutral tone', () => {
    const { root } = renderPage(LazyloadPage, withImages([makeLazyImage()], false));
    const badge = root.querySelector('[data-fdt="resource-summary"] [data-fdt="status-badge"]');
    expect(badge?.textContent).toContain('not detected');
    expect(badge?.className).toContain('text-status-neutral');
  });

  it('puts per-filter counts on the chips', () => {
    const { root } = renderPage(LazyloadPage, fixture());
    expect(screen.getByRole('button', { name: 'Show All 5 matching' })).toBe(chip(root, 'all'));
    expect(screen.getByRole('button', { name: 'Lazyloaded 2 matching' })).toBe(
      chip(root, 'lazyloaded')
    );
    expect(screen.getByRole('button', { name: 'Non-lazyloaded 3 matching' })).toBe(
      chip(root, 'non-lazyloaded')
    );
  });
});

describe('LazyloadPage — rows', () => {
  it('lists every image as a listitem with its set size and position', () => {
    renderPage(LazyloadPage, fixture());
    const list = screen.getByRole('list', { name: 'Images' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]?.getAttribute('aria-setsize')).toBe('5');
    expect(items[4]?.getAttribute('aria-posinset')).toBe('5');
  });

  it('shows the state badges: Lazyloaded as info, Not lazyloaded as neutral', () => {
    renderPage(LazyloadPage, fixture());
    const [first, second] = screen.getAllByRole('listitem');
    expect(within(first as HTMLElement).getByText('Lazyloaded').className).toContain(
      'text-status-info'
    );
    expect(within(second as HTMLElement).getByText('Not lazyloaded').className).toContain(
      'text-status-neutral'
    );
  });

  it('renders reasons as mono outline badges and the tool marker as a distinct warn badge', () => {
    renderPage(LazyloadPage, fixture());
    const items = screen.getAllByRole('listitem');
    const logo = within(items[1] as HTMLElement);
    expect(logo.getByText('data-skip-lazy').className).toContain('font-mono');
    expect(logo.getByText('skip-lazy').className).toContain('border');
    const excluded = within(items[2] as HTMLElement);
    const marker = excluded.getByText('Excluded by FDT');
    expect(marker.className).toContain('bg-status-warn-soft');
    expect(marker.className).not.toContain('font-mono');
    // The page's own reason stays visible beside the marker; the raw marker
    // attribute is never shown as a reason.
    expect(excluded.getByText('data-src')).toBeTruthy();
    expect(excluded.queryByText(FDT_EXCLUDED_RESOURCE)).toBeNull();
  });

  it('says "No reasons found" for a non-lazyloaded image without reasons, nothing for lazyloaded ones', () => {
    renderPage(LazyloadPage, fixture());
    const items = screen.getAllByRole('listitem');
    expect(within(items[3] as HTMLElement).getByText('No reasons found')).toBeTruthy();
    expect(within(items[0] as HTMLElement).queryByText('No reasons found')).toBeNull();
    expect(within(items[0] as HTMLElement).queryByText('Reasons')).toBeNull();
  });

  it('names rows by file and keeps relative URLs as plain text', () => {
    const { root } = renderPage(LazyloadPage, fixture());
    expect(rowNames(root)).toEqual([
      'hero.webp',
      'logo.png',
      'excluded.jpg',
      'plain.jpg',
      'gallery.jpg'
    ]);
    expect(screen.getAllByRole('link')).toHaveLength(4);
  });
});

describe('LazyloadPage — filters, search and states', () => {
  let page: PageHarness;

  beforeEach(() => {
    page = renderPage(LazyloadPage, fixture());
  });

  it('narrows by chip and announces the committed result', () => {
    fireEvent.click(chip(page.root, 'lazyloaded'));
    expect(rowNames(page.root)).toEqual(['hero.webp', 'gallery.jpg']);
    expect(chip(page.root, 'lazyloaded').getAttribute('aria-pressed')).toBe('true');
    expect(announced(page.root)).toBe('Showing 2 of 5 images');
  });

  it('keeps focus on a chip across its own selection and a refresh (stable chip buttons)', () => {
    const lazy = chip(page.root, 'lazyloaded');
    lazy.focus();
    fireEvent.click(lazy);
    expect(document.activeElement).toBe(lazy);
    expect(chip(page.root, 'lazyloaded')).toBe(lazy);
    page.refresh(fixture());
    expect(document.activeElement).toBe(lazy);
  });

  it('streams the field into the search store and composes the query with the chip', () => {
    type('JPG');
    expect(page.search.query()).toBe('JPG');
    expect(rowNames(page.root)).toEqual(['excluded.jpg', 'plain.jpg', 'gallery.jpg']);
    fireEvent.click(chip(page.root, 'non-lazyloaded'));
    expect(rowNames(page.root)).toEqual(['excluded.jpg', 'plain.jpg']);
    expect(announced(page.root)).toBe('Showing 2 of 5 images');
  });

  it('does not filter or announce before the debounce commits', () => {
    fireEvent.input(field(), { target: { value: 'hero' } });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(rowNames(page.root)).toHaveLength(5);
    expect(announced(page.root)).toBe('');
    vi.advanceTimersByTime(1);
    expect(rowNames(page.root)).toEqual(['hero.webp']);
  });

  it('follows the store when the DevTools find bar drives it, and clears with cancel', () => {
    page.search.perform('logo');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(field().value).toBe('logo');
    expect(rowNames(page.root)).toEqual(['logo.png']);
    page.search.cancel();
    expect(field().value).toBe('');
    expect(rowNames(page.root)).toHaveLength(5);
  });

  it('treats a blank query as no search (never a dead-end filtered view)', () => {
    type('   ');
    expect(page.search.query()).toBe('');
    expect(rowNames(page.root)).toHaveLength(5);
  });

  it('clears the search on Esc in the field', () => {
    type('hero');
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(field().value).toBe('');
    expect(page.search.query()).toBe('');
    expect(rowNames(page.root)).toHaveLength(5);
  });

  it('ignores Esc on an empty field and other keys', () => {
    const cancel = vi.spyOn(page.search, 'cancel');
    fireEvent.keyDown(field(), { key: 'Escape' });
    type('hero');
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(cancel).not.toHaveBeenCalled();
    expect(page.search.query()).toBe('hero');
  });

  it('renders NoMatches naming chip and query, with both ways back', () => {
    fireEvent.click(chip(page.root, 'lazyloaded'));
    type('zzz');
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText('No matches')).toBeTruthy();
    expect(screen.getByText('Nothing in "Lazyloaded" matches "zzz".')).toBeTruthy();
    expect(announced(page.root)).toBe('No images match');
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(chip(page.root, 'all').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Nothing matches "zzz".')).toBeTruthy();
  });

  it('hands focus to the search field after Clear search', () => {
    type('zzz');
    const clear = screen.getByRole('button', { name: 'Clear search' });
    clear.focus();
    fireEvent.click(clear);
    expect(document.activeElement).toBe(field());
    expect(field().value).toBe('');
    expect(rowNames(page.root)).toHaveLength(5);
  });

  it('hands focus to the default chip after Show all', () => {
    fireEvent.click(chip(page.root, 'lazyloaded'));
    page.refresh(withImages([makeLazyImage({ lazyloadDetected: false })]));
    const showAll = screen.getByRole('button', { name: 'Show all' });
    showAll.focus();
    fireEvent.click(showAll);
    expect(document.activeElement).toBe(chip(page.root, 'all'));
  });
});

describe('LazyloadPage — refresh and edge states', () => {
  it('keeps a focused row control (and its row) across a soft refresh', () => {
    const page = renderPage(LazyloadPage, fixture());
    const copy = screen.getByRole('button', { name: 'Image URL (logo.png) — copy' });
    copy.focus();
    page.refresh(fixture());
    expect(document.activeElement).toBe(copy);
    expect(copy.isConnected).toBe(true);
  });

  it('remounts only the row whose content changed on refresh', () => {
    const page = renderPage(LazyloadPage, fixture());
    const before = screen.getAllByRole('listitem');
    const next = fixture();
    const images = next.wprDetections.lazyload.images.map((image, index) =>
      index === 3 ? { ...image, excludedReasonsFound: ['data-src'] } : image
    );
    page.refresh(withImages(images));
    const after = screen.getAllByRole('listitem');
    expect(after.filter((item, index) => item === before[index])).toHaveLength(4);
    expect(after[3]).not.toBe(before[3]);
  });

  it('keeps every surviving row element through a chip change, with updated set positions', () => {
    const page = renderPage(LazyloadPage, fixture());
    const hero = screen.getAllByRole('listitem')[0];
    const gallery = screen.getAllByRole('listitem')[4];
    fireEvent.click(chip(page.root, 'lazyloaded'));
    const items = screen.getAllByRole('listitem');
    expect(items).toEqual([hero, gallery]);
    expect(items.map((item) => item.getAttribute('aria-setsize'))).toEqual(['2', '2']);
    expect(items.map((item) => item.getAttribute('aria-posinset'))).toEqual(['1', '2']);
  });

  it('keeps surviving rows mounted while the virtualizer lags a chip change (rows by key)', () => {
    const lagged = laggedVirtualizer();
    const page = renderPage(
      LazyloadPage,
      withImages([
        makeLazyImage({ src: 'https://a/0.jpg', lazyloadDetected: false }),
        makeLazyImage({ src: 'https://a/1.jpg', lazyloadDetected: true }),
        makeLazyImage({ src: 'https://a/2.jpg', lazyloadDetected: true })
      ]),
      lagged.factory
    );
    const rowNamed = (name: string): Element | undefined =>
      screen.getAllByRole('listitem').find((item) => item.textContent.includes(name));
    const before = rowNamed('2.jpg');
    fireEvent.click(chip(page.root, 'lazyloaded'));
    lagged.flush();
    expect(rowNamed('2.jpg')).toBe(before);
    expect(rowNames(page.root)).toEqual(['1.jpg', '2.jpg']);
  });

  it('caps the list width at the wide tier', () => {
    renderPage(LazyloadPage, fixture());
    expect(screen.getByRole('list', { name: 'Images' }).className).toContain(LIST_WIDTH);
  });

  it('notes a capped list only when the list sits at its cap', () => {
    const atCap = Array.from({ length: 5000 }, (_, index) =>
      makeLazyImage({ src: `https://cdn.example/${index.toString()}.jpg` })
    );
    const capped = withImages(atCap);
    capped.wprDetections.lazyload.truncated = true;
    const page = renderPage(LazyloadPage, capped);
    expect(page.root.querySelector('[data-fdt="resource-note"]')?.textContent).toBe(
      'The list was capped at the first 5,000 images; counts cover these rows.'
    );
    expect(page.root.querySelector('[data-fdt="resource-total"]')?.textContent).toBe(
      '5,000 images'
    );
    cleanup();
    const short = withImages([makeLazyImage()]);
    short.wprDetections.lazyload.truncated = true;
    const other = renderPage(LazyloadPage, short);
    expect(other.root.querySelector('[data-fdt="resource-note"]')).toBeNull();
  });

  it('explains lazyloaded rows when the feature reads not detected', () => {
    const { root } = renderPage(
      LazyloadPage,
      withImages([makeLazyImage({ lazyloadDetected: true })], false)
    );
    expect(root.querySelector('[data-fdt="resource-note"]')?.textContent).toContain(
      'lazyload script was not found'
    );
  });

  it('flags a clipped URL on a marked payload and links nothing', () => {
    const data = withImages([
      makeLazyImage({ src: `https://cdn.example/${'a'.repeat(4096 - 20)}` })
    ]);
    data.wprDetections.lazyload.truncated = true;
    renderPage(LazyloadPage, data);
    expect(screen.getByText('Clipped')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: /, clipped\) — copy$/ })).toBeTruthy();
  });

  it('keeps the chip, the query and the field text across a refresh', () => {
    const page = renderPage(LazyloadPage, fixture());
    fireEvent.click(chip(page.root, 'non-lazyloaded'));
    type('jpg');
    const next = withImages([
      makeLazyImage({ src: 'https://cdn.example/new.jpg', lazyloadDetected: false }),
      makeLazyImage({ src: 'https://cdn.example/new.png', lazyloadDetected: false })
    ]);
    page.refresh(next);
    expect(chip(page.root, 'non-lazyloaded').getAttribute('aria-pressed')).toBe('true');
    expect(field().value).toBe('jpg');
    expect(rowNames(page.root)).toEqual(['new.jpg']);
    // A refresh clears the line: its count would be stale.
    expect(announced(page.root)).toBe('');
  });

  it('disables an empty chip, but keeps a selected chip that a refresh emptied', () => {
    const page = renderPage(LazyloadPage, withImages([makeLazyImage({ lazyloadDetected: true })]));
    expect(chip(page.root, 'non-lazyloaded').disabled).toBe(true);
    fireEvent.click(chip(page.root, 'lazyloaded'));
    page.refresh(withImages([makeLazyImage({ lazyloadDetected: false })]));
    expect(chip(page.root, 'lazyloaded').disabled).toBe(false);
    expect(chip(page.root, 'lazyloaded').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Show all' })).toBeTruthy();
  });

  it('shows the page empty state without filters when there are no images', () => {
    const { root } = renderPage(LazyloadPage, withImages([]));
    expect(screen.getByText('No images on this page')).toBeTruthy();
    expect(root.querySelector('[data-fdt="filter-bar"]')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
    expect(root.querySelector('[data-fdt="resource-total"]')).toBeNull();
  });

  it('switches between empty and populated on refresh', () => {
    const page = renderPage(LazyloadPage, withImages([]));
    page.refresh(fixture());
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    page.refresh(withImages([]));
    expect(screen.getByText('No images on this page')).toBeTruthy();
  });

  it('keeps both rows when the same image appears twice (keys are positions, not URLs)', () => {
    const src = 'https://cdn.example/up/twice.jpg';
    const { root } = renderPage(
      LazyloadPage,
      withImages([makeLazyImage({ src }), makeLazyImage({ src })])
    );
    expect(rowNames(root)).toEqual(['twice.jpg', 'twice.jpg']);
  });

  it('says "No URL captured" for an image without a source', () => {
    renderPage(LazyloadPage, withImages([makeLazyImage({ src: '', lazyloadDetected: false })]));
    expect(screen.getByText('No URL captured')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /copy/ })).toBeNull();
  });
});
