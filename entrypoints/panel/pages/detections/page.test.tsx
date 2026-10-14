/**
 * The Detections page: frame + heading, the card grid in view-model order
 * with link vs static forms (only mapped ids are anchors; static cards take
 * no tab stop and carry no lift), the status vocabulary, the two tooltip
 * subtitles, the summary strip's agreement with the cards, the headers
 * section's omission on a missing capture, `Copy report`, refresh
 * stability (cards keep their DOM, the open disclosure stays open), and the
 * store wiring.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast, toastItems } from '../../../../components/ui/toast-store';
import { buildStatusItems } from '../../../../lib/panel/detections-view-model';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { makeFdtData } from '../../state/fixtures';
import type { DataState } from '../../state/fdt-state-machine';
import { FdtDataContext, type FdtDataStore } from '../../state/use-fdt-data';
import { CARD_PAGE_LINKS } from './card-presentation';
import { DETECTIONS_SUBTITLE, DetectionsPage, DetectionsView } from './page';

afterEach(() => {
  cleanup();
  toast.clear();
});

/** The stamp the fixture's cache card carries (2023-11-14 22:13:20 UTC). */
const STAMP = 1_700_000_000;

/** A populated payload: plugin cached, a platform, two linked features on. */
function richData(overrides?: Partial<FdtData>): FdtData {
  const base = makeFdtData();
  return makeFdtData({
    pageHeaders: [
      { name: 'Server', value: 'nginx' },
      { name: 'X-Kinsta-Cache', value: 'HIT' },
      { name: 'cache-control', value: 'max-age=60' }
    ],
    wprDetections: {
      ...base.wprDetections,
      wpr: { present: true, cached: true, version: '3.20.1', timeStamp: STAMP },
      delay_js: { present: true, scripts: [], version: '2.0', delayedScripts: 0 },
      lazyload: { present: true, images: [] }
    },
    ...overrides
  });
}

/** Every rendered card root, in DOM order. */
function cards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-fdt="status-card"]')];
}

/** One card root by its id. */
function card(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-fdt-card-id="${id}"]`);
  if (!found) throw new Error(`no card ${id}`);
  return found;
}

const NOW = STAMP * 1000 + 3 * 3_600_000;

describe('DetectionsView', () => {
  it('renders the frame: one h1, the intro line, the Copy report action', () => {
    render(() => <DetectionsView data={richData()} now={NOW} />);
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
      'Detections'
    ]);
    expect(screen.getByText(DETECTIONS_SUBTITLE)).toBeTruthy();
    expect(document.querySelector('[data-fdt-page="detections"]')).not.toBeNull();
    const copy = screen.getByRole('button', { name: 'Copy report' });
    expect(copy.className).toContain('bg-accent-strong');
  });

  it('renders one card per view-model item, in its order, as list items', () => {
    const data = richData();
    render(() => <DetectionsView data={data} now={NOW} />);
    expect(cards().map((el) => el.dataset.fdtCardId)).toEqual(
      buildStatusItems(data).map((item) => item.id)
    );
    expect(screen.getByRole('list', { name: 'Detection results' }).children).toHaveLength(
      cards().length
    );
  });

  it('makes only the mapped cards links, and static cards inert', () => {
    render(() => <DetectionsView data={richData()} now={NOW} />);
    for (const el of cards()) {
      const id = el.dataset.fdtCardId ?? '';
      const route = CARD_PAGE_LINKS.get(id as never);
      if (route === undefined) {
        expect(el.tagName).toBe('DIV');
        expect(el.hasAttribute('tabindex')).toBe(false);
        expect(el.className).not.toContain('hover:shadow-elev-2');
      } else {
        expect(el.tagName).toBe('A');
        expect(el.getAttribute('href')).toBe(`#/${route}`);
        expect(el.className).toContain('hover:shadow-elev-2');
        expect(el.className).toContain('focus-visible:outline-2');
        // Never a control nested inside the link.
        expect(el.querySelector('button, a')).toBeNull();
      }
    }
    // The link's name is its own visible content, spoken in reading order
    // (WCAG 2.5.3: the visible label is part of the accessible name).
    expect(card('delay_js').hasAttribute('aria-label')).toBe(false);
    expect(card('delay_js').textContent).toBe(
      'Delay JavaScript execution, Active, Version 2.0, Open JavaScript'
    );
    expect(card('lazyload').textContent).toBe('Lazyload for images, Active, Open Lazyload');
  });

  it('maps verdicts to the vocabulary: active → ok "Active", off → neutral "Not active"', () => {
    render(() => <DetectionsView data={richData()} now={NOW} />);
    const badge = (id: string) => card(id).querySelector<HTMLElement>('[data-fdt="status-badge"]');
    expect(badge('wpr')?.textContent).toBe('Active');
    expect(badge('wpr')?.className).toContain('text-status-ok');
    expect(badge('minify_css')?.textContent).toBe('Not active');
    expect(badge('minify_css')?.className).toContain('text-status-neutral');
    expect(document.querySelector('.text-status-error')).toBeNull();
    expect(card('minify_css').querySelector('svg')?.getAttribute('class')).toContain(
      'text-status-neutral'
    );
  });

  it('renders typed subtitles: mono versions/server, the cached age and platform as tooltip triggers', () => {
    render(() => <DetectionsView data={richData()} now={NOW} />);
    expect(card('wpr').querySelector('.font-mono')?.textContent).toBe('3.20.1');
    expect(card('server').querySelector('.font-mono')?.textContent).toBe('nginx');
    const cachedTrigger = card('cached').querySelector('[data-fdt="tooltip-trigger"]');
    expect(cachedTrigger?.textContent).toBe('Generated 3 h ago');
    const platformTrigger = card('known-platform').querySelector('[data-fdt="tooltip-trigger"]');
    expect(platformTrigger?.textContent).toBe('Kinsta');
    expect(card('lazyload_iframes').querySelector('[data-fdt-card-subtitle]')).toBeNull();
  });

  it('ages the cached subtitle as the clock advances', () => {
    const [now, setNow] = createSignal(NOW);
    render(() => <DetectionsView data={richData()} now={now()} />);
    const trigger = () => card('cached').querySelector('[data-fdt="tooltip-trigger"]');
    expect(trigger()?.textContent).toBe('Generated 3 h ago');
    setNow(NOW + 24 * 3_600_000);
    expect(trigger()?.textContent).toBe('Generated 1 d ago');
  });

  it('agrees with the cards in the summary strip', () => {
    render(() => <DetectionsView data={richData()} now={NOW} />);
    const strip = screen.getByRole('list', { name: 'Page summary' });
    expect(strip.textContent).toContain('WP Rocket 3.20.1');
    expect(strip.textContent).toContain('Cached3 h ago(2023-11-14 22:13:20 UTC)');
    expect(strip.textContent).toContain('Kinstavia X-Kinsta-Cache');
    expect(strip.textContent).toContain('Servernginx');
    expect(strip.textContent).toContain('2 of 14optimizations active');
  });

  it('says "WP Rocket not detected" when absent, and still renders every card', () => {
    const data = makeFdtData();
    render(() => <DetectionsView data={data} now={NOW} />);
    const strip = screen.getByRole('list', { name: 'Page summary' });
    expect(strip.textContent).toContain('WP Rocket not detected');
    expect(strip.querySelector('[data-fdt-summary-fact="cache"]')).toBeNull();
    expect(strip.textContent).toContain('0 of 14');
    expect(cards()).toHaveLength(buildStatusItems(data).length);
  });

  it('states "Not cached" for a present, uncached plugin', () => {
    const base = makeFdtData();
    render(() => (
      <DetectionsView
        data={makeFdtData({
          wprDetections: {
            ...base.wprDetections,
            wpr: { present: true, cached: false, version: null, timeStamp: null }
          }
        })}
        now={NOW}
      />
    ));
    expect(document.querySelector('[data-fdt-summary-fact="cache"]')?.textContent).toBe(
      'Not cached'
    );
  });

  it('omits the headers section (and the header cards) when nothing was captured', () => {
    render(() => <DetectionsView data={richData({ pageHeaders: null })} now={NOW} />);
    expect(document.querySelector('[data-fdt="headers-preview"]')).toBeNull();
    expect(document.querySelector('[data-fdt-card-id="server"]')).toBeNull();
    expect(document.querySelector('[data-fdt-card-id="known-platform"]')).toBeNull();
  });

  it('keeps card nodes and the open disclosure across a data refresh', () => {
    const [data, setData] = createSignal(richData());
    render(() => <DetectionsView data={data()} now={NOW} />);
    const before = card('wpr');
    fireEvent.click(screen.getByRole('button', { name: /Response headers/ }));
    setData(richData({ undefinedReferencesOnPage: ['jQuery'] }));
    expect(card('wpr')).toBe(before);
    expect(
      screen.getByRole('button', { name: /Response headers/ }).getAttribute('aria-expanded')
    ).toBe('true');
  });

  it('copies the report from the page action', async () => {
    const writeText = vi.fn((): Promise<void> => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      render(() => <DetectionsView data={richData()} now={NOW} />);
      fireEvent.click(screen.getByRole('button', { name: 'Copy report' }));
      await waitFor(() => {
        expect(toastItems().at(-1)?.title).toBe('Report copied');
      });
      expect(writeText).toHaveBeenCalledTimes(1);
      await waitFor(() => {
        expect(
          document.querySelector('[data-fdt="copy-report"]')?.hasAttribute('data-fdt-copied')
        ).toBe(true);
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('DetectionsPage (store wiring)', () => {
  /**
   * A minimal store over one state signal, plus the setter that drives it.
   *
   * @param initial The first machine state.
   */
  function controllableStore(initial: DataState): {
    store: FdtDataStore;
    setState: (next: DataState) => void;
  } {
    const [state, setState] = createSignal<DataState>(initial);
    const store: FdtDataStore = {
      state,
      start: vi.fn(),
      stop: vi.fn(),
      retry: vi.fn(),
      reload: vi.fn()
    };
    return { store, setState };
  }

  it('renders the view over ready and refreshing data, nothing otherwise', () => {
    const { store, setState } = controllableStore({
      status: 'ready',
      data: richData(),
      fetchedAt: 0
    });
    render(() => (
      <FdtDataContext.Provider value={store}>
        <DetectionsPage />
      </FdtDataContext.Provider>
    ));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Detections');
    const before = card('wpr');
    setState({ status: 'refreshing', data: richData(), requestedAt: 1 });
    expect(card('wpr')).toBe(before);
    setState({ status: 'fetching' });
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});
