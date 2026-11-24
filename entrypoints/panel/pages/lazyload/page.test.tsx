/**
 * The Lazyload page on the calm list: summary (feature state, total, notes),
 * the source legend, rows (file name, URL preview, state chips by source),
 * facets and search, the detail (chips, the URL's tile, the lazyloaded
 * fact, the exclusion reasons only while lazyload runs), refreshes keeping
 * facets/query/selection by content key, and the empty state. The list
 * kit's own behavior is pinned by `calm-list.test.tsx` + `calm-list-search.test.tsx`.
 */
import { cleanup, fireEvent, screen, within } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAYLOAD_LIMITS } from '../../../../lib/messaging/payload-bounds';
import { FDT_EXCLUDED_RESOURCE } from '../../../../lib/wp-rocket/constants';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { makeFdtData, makeLazyImage } from '../../state/fixtures';
import { SEARCH_DEBOUNCE_MS } from '../../state/search';
import type { OpenResource } from '../open-resource';
import {
  installFakeResizeObserver,
  type FakeResizeObservers
} from '../resource-list/fake-resize-observer';
import { renderPage, type PageHarness } from '../resource-list/page-harness';
import { NO_IMAGE_URL_NOTE, NO_REASONS_FOUND, REASONS_OFF_NOTE } from './lazyload-detail';
import { LAZY_MARKUP_NOTE } from './lazyload-rows';
import { LazyloadPage, LAZYLOAD_SUBTITLE, type LazyloadPageProps } from './page';

/** A payload with the given images and lazyload presence. */
function withImages(
  images: FdtData['wprDetections']['lazyload']['images'],
  present = true
): FdtData {
  const base = makeFdtData();
  return { ...base, wprDetections: { ...base.wprDetections, lazyload: { present, images } } };
}

/** The standard fixture: two lazyloaded, three not (reasons, marker + reason, none). */
function fixture(present = true): FdtData {
  return withImages(
    [
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
    ],
    present
  );
}

/** A payload whose LazyLoad row carries a simulation fact. */
function withSimulation(fact: 'simulated' | 'unverified'): FdtData {
  const data = fixture(fact !== 'simulated');
  data.wprDetections.lazyload.simulation = fact;
  return data;
}

let observers: FakeResizeObservers;

beforeEach(() => {
  vi.useFakeTimers();
  observers = installFakeResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * Render the page at a list width (pane from 830).
 *
 * @param data The payload.
 * @param options The list width and seams.
 */
function mount(
  data: FdtData = fixture(),
  options: { width?: number; seams?: LazyloadPageProps } = {}
): PageHarness {
  const harness = renderPage(
    (props): JSX.Element => <LazyloadPage {...props} openResource={null} {...options.seams} />,
    data
  );
  observers.resize(options.width ?? 1000);
  return harness;
}

/** Every rendered row. */
function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-fdt="lazyload-row"]')];
}

/**
 * A field's text in a row.
 *
 * @param row The row.
 * @param hook The field's hook.
 */
function field(row: HTMLElement | undefined, hook: string): string | undefined {
  return row?.querySelector(`[data-fdt="${hook}"]`)?.textContent ?? undefined;
}

/** The rendered rows' names, in order. */
function names(): string[] {
  return rows().map((row) => field(row, 'list-row-name') ?? '');
}

/** Each state chip in a scope as `label/source`. */
function chipSources(scope: Element): string[] {
  return [...scope.querySelectorAll<HTMLElement>('[data-fdt="state-chip"]')].map(
    (chip) => `${chip.textContent}/${chip.dataset.fdtSource ?? ''}`
  );
}

/** A row by its name. */
function rowNamed(name: string): HTMLElement {
  const row = rows().find((candidate) => field(candidate, 'list-row-name') === name);
  if (row === undefined) throw new Error(`no row ${name}`);
  return row;
}

/** Open a row's detail by its name. */
function open(name: string): void {
  const button = rowNamed(name).querySelector<HTMLButtonElement>('[data-fdt-row-open]');
  if (button === null) throw new Error(`no open button on ${name}`);
  fireEvent.click(button);
}

/** The side pane (throws when closed). */
function pane(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[data-fdt="detail-pane"]');
  if (found === null) throw new Error('no detail pane');
  return found;
}

/** A facet segment's radio. */
function segment(value: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    `[data-fdt="facet-bar"] [data-fdt-choice-value="${value}"] input`
  );
  if (input === null) throw new Error(`no segment ${value}`);
  return input;
}

/** A facet segment's count. */
function count(value: string): string | undefined {
  return (
    document.querySelector(
      `[data-fdt="facet-bar"] [data-fdt-choice-value="${value}"] [data-fdt-choice-count]`
    )?.textContent ?? undefined
  );
}

/** The Excluded toggle. */
function excludedToggle(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[data-fdt-toggle-chip="excluded"]');
  if (found === null) throw new Error('no Excluded toggle');
  return found;
}

/** Type into the page's search field and let the store commit. */
function type(text: string): void {
  fireEvent.input(screen.getByRole('searchbox', { name: 'Search image URLs' }), {
    target: { value: text }
  });
  vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
}

/** The open detail's reasons section text, or null without one. */
function reasons(): string | null {
  return pane().querySelector('[data-fdt="lazyload-reasons"]')?.textContent ?? null;
}

describe('LazyloadPage — summary', () => {
  it('renders the frame, the feature with its spelled-out state, and the total', () => {
    const { root } = mount();
    expect(root.getAttribute('data-fdt-page')).toBe('lazyload');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('LazyLoad');
    expect(screen.getByText(LAZYLOAD_SUBTITLE)).toBeTruthy();
    const summary = root.querySelector('[data-fdt="resource-summary"]');
    expect(summary?.textContent).toContain('LazyLoad for images');
    const badge = summary?.querySelector('[data-fdt="status-badge"]');
    expect(badge?.textContent).toBe('Detected');
    expect(badge?.className).toContain('text-status-ok');
    expect(root.querySelector('[data-fdt="resource-total"]')?.textContent).toBe('5 images');
    expect(root.querySelector('[data-fdt="resource-note"]')).toBeNull();
  });

  it('spells out an absent feature as "Not detected" in the neutral tone', () => {
    const { root } = mount(withImages([makeLazyImage()], false));
    const badge = root.querySelector('[data-fdt="resource-summary"] [data-fdt="status-badge"]');
    expect(badge?.textContent).toBe('Not detected');
    expect(badge?.className).toContain('text-status-neutral');
  });

  it('spells out a verified simulation as "Simulated" (info), said who did it', () => {
    const { root } = mount(withSimulation('simulated'));
    const badge = root.querySelector('[data-fdt="resource-summary"] [data-fdt="status-badge"]');
    expect(badge?.textContent).toBe('Simulated');
    expect(badge?.className).toContain('text-status-info');
    expect(root.querySelector('[data-fdt="resource-note"]')?.textContent).toBe(
      "Simulated in this tab by the extension — not the site's configuration; its own WP Rocket exclusions aren't included."
    );
  });

  it('notes a capped list only when the list sits at its cap', () => {
    const atCap = Array.from({ length: PAYLOAD_LIMITS.images.count }, (_, index) =>
      makeLazyImage({ src: `https://cdn.example/${index.toString()}.jpg` })
    );
    const capped = withImages(atCap);
    capped.wprDetections.lazyload.truncated = true;
    const page = mount(capped);
    expect(page.root.querySelector('[data-fdt="resource-note"]')?.textContent).toBe(
      'The list was capped at the first 5,000 images; counts cover these rows.'
    );
    expect(page.root.querySelector('[data-fdt="resource-total"]')?.textContent).toBe(
      '5,000 images'
    );
    cleanup();
    const short = withImages([makeLazyImage()]);
    short.wprDetections.lazyload.truncated = true;
    const other = mount(short);
    expect(other.root.querySelector('[data-fdt="resource-note"]')).toBeNull();
  });

  it('explains lazy rows when the feature reads not detected', () => {
    const { root } = mount(withImages([makeLazyImage({ lazyloadDetected: true })], false));
    expect(root.querySelector('[data-fdt="resource-note"]')?.textContent).toBe(LAZY_MARKUP_NOTE);
  });

  it('shows the source legend once, listing only the sources its chips can show', () => {
    const { root } = mount();
    const legends = root.querySelectorAll('[data-fdt="state-source-legend"]');
    expect(legends).toHaveLength(1);
    expect(legends[0]?.textContent).toBe('WP RocketSimulated by FDTExcluded by FDTPage');
  });
});

describe('LazyloadPage — rows', () => {
  it('leads each row with the file name over its URL without scheme, under the column head', () => {
    mount();
    expect(names()).toEqual(['hero.webp', 'logo.png', 'excluded.jpg', 'plain.jpg', 'gallery.jpg']);
    expect(rows().map((row) => field(row, 'list-row-preview'))).toEqual([
      'cdn.example/up/hero.webp',
      'cdn.example/up/logo.png',
      'cdn.example/up/excluded.jpg',
      'cdn.example/up/plain.jpg',
      // A relative URL is shown as captured.
      '/up/gallery.jpg'
    ]);
    expect(document.querySelector('[data-fdt="list-head"]')?.textContent).toBe('ImageWP Rocket');
    expect(rows()[0]?.querySelector('[data-fdt="list-row-icon"] svg')).not.toBeNull();
    // Reasons live in the detail only.
    expect(document.querySelector('[data-fdt="lazyload-reasons"]')).toBeNull();
    const list = screen.getByRole('list', { name: 'Images' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
  });

  it('shows one-word state chips by source: Lazy loaded (WP Rocket), Excluded (FDT); none for a plain image', () => {
    mount();
    expect(rows().map(chipSources)).toEqual([
      ['Lazy loaded/wp-rocket'],
      [],
      ['Excluded/excluded'],
      [],
      ['Lazy loaded/wp-rocket']
    ]);
    const lazy = rows()[0]?.querySelector('[data-fdt="state-chip"] [data-fdt="badge"]');
    expect(lazy?.getAttribute('title')).toBe('Lazy loaded by WP Rocket (LazyLoad for images)');
    expect(lazy?.className).toContain('text-status-info');
    const excluded = rows()[2]?.querySelector('[data-fdt="state-chip"] [data-fdt="badge"]');
    expect(excluded?.getAttribute('title')).toBe('Excluded by FDT from LazyLoad for images');
    expect(excluded?.className).toContain('bg-status-warn-soft');
  });

  it('reads a verified simulation’s lazy rows as simulated, an unverified one as WP Rocket flagged', () => {
    mount(withSimulation('simulated'));
    const title = (): string | null | undefined =>
      rowNamed('hero.webp').querySelector('[data-fdt="state-chip"] [title]')?.getAttribute('title');
    expect(chipSources(rowNamed('hero.webp'))).toEqual(['Lazy loaded/simulated']);
    expect(title()).toBe("Lazy loaded by the FDT's LazyLoad for images simulation");
    cleanup();
    mount(withSimulation('unverified'));
    expect(chipSources(rowNamed('hero.webp'))).toEqual(['Lazy loaded/wp-rocket']);
    expect(title()).toBe(
      'Lazy loaded by WP Rocket (LazyLoad for images) (simulation not verified)'
    );
  });

  it('reads lazy markup as the page’s own while LazyLoad is not detected', () => {
    mount(fixture(false));
    expect(rows().map(chipSources)).toEqual([
      ['Lazy loaded/page'],
      [],
      ['Excluded/excluded'],
      [],
      ['Lazy loaded/page']
    ]);
  });

  it('flags a clipped URL on a marked payload, in the row and the detail tile', () => {
    const data = withImages([
      makeLazyImage({ src: `https://cdn.example/${'a'.repeat(PAYLOAD_LIMITS.images.src - 20)}` })
    ]);
    data.wprDetections.lazyload.truncated = true;
    mount(data);
    expect(within(rows()[0] as HTMLElement).getByText('Clipped')).toBeTruthy();
    fireEvent.click(rows()[0]?.querySelector('[data-fdt-row-open]') as HTMLElement);
    expect(within(pane()).getByText('Clipped')).toBeTruthy();
    expect(pane().querySelector('[data-fdt="source-link"] a')).toBeNull();
  });

  it('names an image without a URL, says so in the detail and offers no copy', () => {
    mount(withImages([makeLazyImage({ src: '', lazyloadDetected: false })]));
    expect(names()).toEqual(['No URL captured']);
    expect(field(rows()[0], 'list-row-preview')).toBeUndefined();
    open('No URL captured');
    expect(pane().querySelector('[data-fdt="lazyload-no-url"]')?.textContent).toBe(
      NO_IMAGE_URL_NOTE
    );
    expect(pane().querySelector('[data-fdt="source-link"]')).toBeNull();
    expect(within(pane()).queryByRole('button', { name: /copy/ })).toBeNull();
  });

  it('keeps both rows when the same image appears twice (keyed by URL + occurrence)', () => {
    const src = 'https://cdn.example/up/twice.jpg';
    mount(withImages([makeLazyImage({ src }), makeLazyImage({ src })]));
    expect(names()).toEqual(['twice.jpg', 'twice.jpg']);
    const keys = rows().map((row) => row.getAttribute('data-fdt-row-key'));
    expect(new Set(keys).size).toBe(2);
  });
});

describe('LazyloadPage — facets and search', () => {
  it('counts each facet value and narrows by LazyLoad', () => {
    mount();
    expect([count('any'), count('lazyloaded'), count('non-lazyloaded')]).toEqual(['5', '2', '3']);
    expect(excludedToggle().querySelector('[data-fdt-toggle-count]')?.textContent).toBe('1');
    fireEvent.click(segment('lazyloaded'));
    expect(names()).toEqual(['hero.webp', 'gallery.jpg']);
  });

  it('the Excluded toggle selects exactly the rows showing the Excluded chip', () => {
    mount();
    fireEvent.click(excludedToggle());
    expect(names()).toEqual(['excluded.jpg']);
    expect(rows().map(chipSources)).toEqual([['Excluded/excluded']]);
  });

  it('searches image URLs, composing with the facets', () => {
    mount();
    type('JPG');
    expect(names()).toEqual(['excluded.jpg', 'plain.jpg', 'gallery.jpg']);
    fireEvent.click(segment('non-lazyloaded'));
    expect(names()).toEqual(['excluded.jpg', 'plain.jpg']);
  });

  it('names the facet and the query when nothing matches, with Clear filters', () => {
    mount();
    fireEvent.click(segment('lazyloaded'));
    type('zzz');
    expect(screen.getByText('Nothing in "Lazy loaded" matches "zzz".')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(names()).toHaveLength(5);
  });
});

describe('LazyloadPage — detail', () => {
  it('opens an image: kind, name, every chip, the URL tile, the lazyloaded fact, copy', () => {
    mount();
    open('hero.webp');
    expect(pane().querySelector('[data-fdt="detail-kind"]')?.textContent).toBe('Image');
    expect(pane().querySelector('[data-fdt="detail-title"]')?.textContent).toBe('hero.webp');
    expect(chipSources(pane())).toEqual(['Lazy loaded/wp-rocket']);
    // No "Open in Sources" here (the seam is null): the tile opens a new tab.
    const tile = pane().querySelector('[data-fdt="source-link-open"]');
    expect(tile?.getAttribute('href')).toBe('https://cdn.example/up/hero.webp');
    expect(pane().querySelector('[data-fdt="lazyload-facts"]')?.textContent).toBe('Lazy loadedYes');
    // A lazyloaded image has no exclusion to explain.
    expect(reasons()).toBeNull();
    expect(pane().querySelector('[data-fdt="lazyload-reasons-off"]')).toBeNull();
    expect(within(pane()).getByRole('button', { name: 'Image URL — copy' })).toBeTruthy();
  });

  it('offers "Open in Sources" where DevTools has it', () => {
    const openResource: OpenResource = vi.fn();
    mount(fixture(), { seams: { openResource } });
    open('hero.webp');
    expect(
      pane().querySelector('[data-fdt="source-link-open"]')?.getAttribute('data-fdt-action')
    ).toBe('sources');
  });

  it('lists the page’s reasons as mono outline badges; the tool marker is the chip, never a reason', () => {
    mount();
    open('logo.png');
    expect(pane().querySelector('[data-fdt="lazyload-facts"]')?.textContent).toBe('Lazy loadedNo');
    const logo = within(pane());
    expect(logo.getByText('data-skip-lazy').className).toContain('font-mono');
    expect(logo.getByText('skip-lazy').className).toContain('border');
    open('excluded.jpg');
    expect(chipSources(pane())).toEqual(['Excluded/excluded']);
    expect(reasons()).toBe('Exclusion reasonsdata-src');
    expect(within(pane()).queryByText(FDT_EXCLUDED_RESOURCE)).toBeNull();
  });

  it('says "No reasons found" for a skipped image without one; nothing for a marker-only image', () => {
    mount(
      withImages([
        makeLazyImage({ src: '/plain.jpg', lazyloadDetected: false }),
        makeLazyImage({
          src: '/marked.jpg',
          lazyloadDetected: false,
          excludedReasonsFound: [FDT_EXCLUDED_RESOURCE]
        })
      ])
    );
    open('plain.jpg');
    expect(reasons()).toBe(`Exclusion reasons${NO_REASONS_FOUND}`);
    open('marked.jpg');
    expect(chipSources(pane())).toEqual(['Excluded/excluded']);
    expect(reasons()).toBeNull();
    expect(within(pane()).queryByText(NO_REASONS_FOUND)).toBeNull();
  });

  it('keeps the reasons while a verified simulation lazy loads the page', () => {
    mount(withSimulation('simulated'));
    open('logo.png');
    expect(reasons()).toBe('Exclusion reasonsdata-skip-lazyskip-lazy');
  });

  it('says no exclusion applies while lazyload does not run, never listing reasons', () => {
    mount(fixture(false));
    open('logo.png');
    expect(reasons()).toBeNull();
    expect(pane().querySelector('[data-fdt="lazyload-reasons-off"]')?.textContent).toBe(
      REASONS_OFF_NOTE
    );
    expect(REASONS_OFF_NOTE).toBe(
      "LazyLoad for images doesn't run on this page, so no exclusion applies."
    );
    expect(within(pane()).queryByText('data-skip-lazy')).toBeNull();
  });
});

describe('LazyloadPage — refresh and states', () => {
  it('follows detection-only refreshes: unchanged rows stay mounted, the open detail and focus kept', () => {
    const page = mount(fixture(false));
    open('logo.png');
    const before = rows();
    const button = rowNamed('logo.png').querySelector<HTMLElement>('[data-fdt-row-open]');
    button?.focus();
    for (const present of [true, false, true]) {
      page.refresh(fixture(present));
      expect(reasons() !== null).toBe(present);
      const after = rows();
      // Rows whose chips did not change keep their element.
      expect(after.slice(1, 4)).toEqual(before.slice(1, 4));
      const source = present ? 'wp-rocket' : 'page';
      expect([after[0], after[4]].map((row) => chipSources(row as HTMLElement))).toEqual([
        [`Lazy loaded/${source}`],
        [`Lazy loaded/${source}`]
      ]);
      expect(document.activeElement).toBe(button);
    }
  });

  it('a changed simulation fact re-derives the chips; a new marker only the title', () => {
    const page = mount();
    page.refresh(withSimulation('unverified'));
    expect(chipSources(rowNamed('hero.webp'))).toEqual(['Lazy loaded/wp-rocket']);
    page.refresh(withSimulation('simulated'));
    expect(chipSources(rowNamed('hero.webp'))).toEqual(['Lazy loaded/simulated']);
  });

  it('keeps facets, query and the selection when an image is added above', () => {
    const page = mount();
    fireEvent.click(segment('non-lazyloaded'));
    type('png');
    open('logo.png');
    const next = fixture();
    next.wprDetections.lazyload.images.unshift(
      makeLazyImage({ src: 'https://cdn.example/new.png', lazyloadDetected: false })
    );
    page.refresh(next);
    expect(segment('non-lazyloaded').checked).toBe(true);
    expect(names()).toEqual(['new.png', 'logo.png']);
    expect(pane().querySelector('[data-fdt="detail-title"]')?.textContent).toBe('logo.png');
    expect(rowNamed('logo.png').getAttribute('data-selected')).not.toBeNull();
  });

  it('shows a removed image as no longer on the page', () => {
    const page = mount();
    open('plain.jpg');
    const next = fixture();
    next.wprDetections.lazyload.images.splice(3, 1);
    page.refresh(next);
    expect(pane().querySelector('[data-fdt="detail-gone"]')).not.toBeNull();
  });

  it('shows a compact empty state without facets, legend or total, and switches on refresh', () => {
    const page = mount(withImages([]));
    expect(screen.getByText('No images on this page')).toBeTruthy();
    expect(page.root.querySelector('[data-fdt="facet-bar"]')).toBeNull();
    expect(page.root.querySelector('[data-fdt="state-source-legend"]')).toBeNull();
    expect(page.root.querySelector('[data-fdt="resource-total"]')).toBeNull();
    // Compact: the empty state is not centered in the whole list region.
    expect(page.root.querySelector('[data-fdt="empty-state"]')?.className).not.toContain(
      'self-center'
    );
    page.refresh(fixture());
    observers.resize(1000);
    expect(rows()).toHaveLength(5);
    page.refresh(withImages([]));
    expect(screen.getByText('No images on this page')).toBeTruthy();
  });
});
