/**
 * The default variant of the panel's filter/search/list body (`FilteredList`
 * without `variant`), rendered as a page over a payload's image rows with
 * their single-select chips: search wiring (field ↔ store, debounce, find
 * bar, Esc, echoes), chips + announcements, the filtered-empty ways back
 * and focus, refresh reuse and keys, and the empty state. The calm variant
 * has its own suite (`calm-list.test.tsx`).
 */
import { cleanup, fireEvent, screen, within } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { createMemo } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VirtualizerFactory } from '../../../../components/ui/virtual-list';
import { IMAGE_NOUN } from '../../../../lib/detection/count-nouns';
import {
  buildLazyloadRows,
  LAZYLOAD_PAGE_RESOURCES,
  type LazyloadImageResource
} from '../../../../lib/panel/resources-view-model';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { makeFdtData, makeLazyImage } from '../../state/fixtures';
import { SEARCH_DEBOUNCE_MS } from '../../state/search';
import { useFdtData } from '../../state/use-fdt-data';
import { PageFrame } from '../page-frame';
import { FilteredList } from './filtered-list';
import { laggedVirtualizer, renderPage, type PageHarness } from './page-harness';
import { resourceName } from './resource-list-view';

/**
 * Whether two image rows carry the same data.
 *
 * @param a One row.
 * @param b The other.
 */
function sameRow(a: LazyloadImageResource, b: LazyloadImageResource): boolean {
  return (
    a.src === b.src &&
    a.lazyloaded === b.lazyloaded &&
    a.excludedReasons.join('\n') === b.excludedReasons.join('\n')
  );
}

/**
 * A page body over the payload's images: the default list with the image
 * chips, each row a name and one focusable control.
 *
 * @param props.createVirtualizer The virtualizer double.
 */
function ImagesPage(props: { createVirtualizer?: VirtualizerFactory }): JSX.Element {
  const store = useFdtData();
  const rows = createMemo(() => {
    const state = store.state();
    return state.status === 'ready' || state.status === 'refreshing'
      ? buildLazyloadRows(state.data.wprDetections.lazyload)
      : [];
  });
  return (
    <PageFrame id="lazyload" title="Images" subtitle="Test list" fill>
      <FilteredList
        definition={LAZYLOAD_PAGE_RESOURCES}
        rows={rows()}
        sameRow={sameRow}
        empty={<p>No images</p>}
        noun={IMAGE_NOUN}
        listLabel="Images"
        searchLabel="Search image URLs"
        searchPlaceholder="Search image URLs…"
        estimateSize={() => 40}
        renderRow={(row) => (
          <span>
            <span data-fdt="resource-name">{resourceName(row.src)}</span>
            <button type="button">{`Copy ${resourceName(row.src)}`}</button>
          </span>
        )}
        createVirtualizer={props.createVirtualizer}
      />
    </PageFrame>
  );
}

/** A payload with the given images. */
function withImages(images: FdtData['wprDetections']['lazyload']['images']): FdtData {
  const base = makeFdtData();
  return { ...base, wprDetections: { ...base.wprDetections, lazyload: { present: true, images } } };
}

/** The standard fixture: two lazyloaded, three not (tool marker, reasons, none). */
function fixture(): FdtData {
  return withImages([
    makeLazyImage({ src: 'https://cdn.example/up/hero.webp', lazyloadDetected: true }),
    makeLazyImage({
      src: 'https://cdn.example/up/logo.png',
      lazyloadDetected: false,
      excludedReasonsFound: ['data-skip-lazy']
    }),
    makeLazyImage({ src: 'https://cdn.example/up/excluded.jpg', lazyloadDetected: false }),
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

/** The list's search field. */
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

describe('FilteredList (default) — chips, search and states', () => {
  let page: PageHarness;

  beforeEach(() => {
    page = renderPage(ImagesPage, fixture());
  });

  it('lists every row as a listitem with its set size and position', () => {
    const items = within(screen.getByRole('list', { name: 'Images' })).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]?.getAttribute('aria-setsize')).toBe('5');
    expect(items[4]?.getAttribute('aria-posinset')).toBe('5');
  });

  it('puts per-chip counts on the chips', () => {
    expect(screen.getByRole('button', { name: 'Show all 5 matching' })).toBe(
      chip(page.root, 'all')
    );
    expect(screen.getByRole('button', { name: 'Lazyloaded 2 matching' })).toBe(
      chip(page.root, 'lazyloaded')
    );
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
    // The count line states the unfiltered page from mount (rendered content,
    // never a keystroke announcement); it changes only with the commit.
    expect(announced(page.root)).toBe('Showing all 5 images');
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

  it('marks the find cursor’s row and moves it with the find', () => {
    const current = (): HTMLElement | null =>
      document.querySelector<HTMLElement>('[role="listitem"][aria-current="true"]');
    page.search.perform('cdn.example');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(page.search.matchCount()).toBe(4);
    expect(current()).toBe(items[0]);
    page.search.advance(1);
    expect(current()).toBe(items[1]);
    page.search.advance(-1);
    page.search.advance(-1); // backward wrap: first → last
    expect(current()).toBe(items[3]);
    page.search.cancel();
    expect(page.search.matchCount()).toBe(0);
    expect(current()).toBeNull();
  });

  it('treats a blank query as no search (never a dead-end filtered view)', () => {
    type('   ');
    // The echo commits as typed; the list normalizes it away — all rows stay.
    expect(page.search.query()).toBe('   ');
    expect(rowNames(page.root)).toHaveLength(5);
  });

  it('clears the search on Esc in the field', () => {
    type('hero');
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(field().value).toBe('');
    expect(page.search.query()).toBe('');
    expect(rowNames(page.root)).toHaveLength(5);
  });

  it('drops a pending field echo when a cancel lands while the query is already empty', () => {
    fireEvent.input(field(), { target: { value: 'pending' } });
    expect(page.search.query()).toBe(''); // the echo has not committed
    page.search.cancel(); // from the DevTools side; no query change is involved
    expect(field().value).toBe('');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
    expect(page.search.query()).toBe(''); // the cancelled burst commits nothing
    expect(rowNames(page.root)).toHaveLength(5);
  });

  it('a foreign keystroke takes query ownership at once, dropping a pending echo', () => {
    fireEvent.input(field(), { target: { value: 'pending' } });
    page.search.perform('logo');
    expect(field().value).toBe(''); // the committed query, not the stale echo
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(page.search.query()).toBe('logo');
    expect(rowNames(page.root)).toEqual(['logo.png']);
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

describe('FilteredList (default) — refresh and edge states', () => {
  it('keeps a focused row control (and its row) across a soft refresh', () => {
    const page = renderPage(ImagesPage, fixture());
    const copy = screen.getByRole('button', { name: 'Copy logo.png' });
    copy.focus();
    page.refresh(fixture());
    expect(document.activeElement).toBe(copy);
    expect(copy.isConnected).toBe(true);
  });

  it('remounts only the row whose content changed on refresh', () => {
    const page = renderPage(ImagesPage, fixture());
    const before = screen.getAllByRole('listitem');
    const images = fixture().wprDetections.lazyload.images.map((image, index) =>
      index === 3 ? { ...image, excludedReasonsFound: ['data-src'] } : image
    );
    page.refresh(withImages(images));
    const after = screen.getAllByRole('listitem');
    expect(after.filter((item, index) => item === before[index])).toHaveLength(4);
    expect(after[3]).not.toBe(before[3]);
  });

  it('keeps every surviving row element through a chip change, with updated set positions', () => {
    const page = renderPage(ImagesPage, fixture());
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
      ImagesPage,
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

  it('leaves list width to the page frame', () => {
    renderPage(ImagesPage, fixture());
    expect(screen.getByRole('list', { name: 'Images' }).className).not.toContain('max-w-');
  });

  it('keeps the chip, the query and the field text across a refresh', () => {
    const page = renderPage(ImagesPage, fixture());
    fireEvent.click(chip(page.root, 'non-lazyloaded'));
    type('jpg');
    page.refresh(
      withImages([
        makeLazyImage({ src: 'https://cdn.example/new.jpg', lazyloadDetected: false }),
        makeLazyImage({ src: 'https://cdn.example/new.png', lazyloadDetected: false })
      ])
    );
    expect(chip(page.root, 'non-lazyloaded').getAttribute('aria-pressed')).toBe('true');
    expect(field().value).toBe('jpg');
    expect(rowNames(page.root)).toEqual(['new.jpg']);
    // The line stays truthful through a refresh (the refreshed count is
    // correct to read), but silent: `aria-live` is off for that update.
    expect(announced(page.root)).toBe('Showing 1 of 2 images');
    expect(
      page.root.querySelector('[data-fdt="resource-results-status"]')?.getAttribute('aria-live')
    ).toBe('off');
  });

  it('disables an empty chip, but keeps a selected chip that a refresh emptied', () => {
    const page = renderPage(ImagesPage, withImages([makeLazyImage({ lazyloadDetected: true })]));
    expect(chip(page.root, 'non-lazyloaded').disabled).toBe(true);
    fireEvent.click(chip(page.root, 'lazyloaded'));
    page.refresh(withImages([makeLazyImage({ lazyloadDetected: false })]));
    expect(chip(page.root, 'lazyloaded').disabled).toBe(false);
    expect(chip(page.root, 'lazyloaded').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Show all' })).toBeTruthy();
  });

  it('shows the empty view without filters, and switches with refreshes', () => {
    const page = renderPage(ImagesPage, withImages([]));
    expect(screen.getByText('No images')).toBeTruthy();
    expect(page.root.querySelector('[data-fdt="filter-bar"]')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
    page.refresh(fixture());
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    page.refresh(withImages([]));
    expect(screen.getByText('No images')).toBeTruthy();
  });

  it('keeps both rows when the same image appears twice (keys are positions, not URLs)', () => {
    const src = 'https://cdn.example/up/twice.jpg';
    const { root } = renderPage(
      ImagesPage,
      withImages([makeLazyImage({ src }), makeLazyImage({ src })])
    );
    expect(rowNames(root)).toEqual(['twice.jpg', 'twice.jpg']);
  });
});
