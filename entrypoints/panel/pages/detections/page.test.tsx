/**
 * The Detections page: frame + heading, the card grid in view-model order
 * with link vs static forms (only mapped ids are anchors; static cards take
 * no tab stop and carry no lift), the status vocabulary, the two tooltip
 * subtitles, the summary strip's agreement with the cards, the absence of a
 * duplicate header inventory, `Copy report`, refresh stability (cards keep
 * their DOM and focus), and the
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
import { isOptimizationCard } from '../../../../lib/panel/detections-summary';
import { DETECTIONS_GRID, DETECTIONS_SUBTITLE, DetectionsPage, DetectionsView } from './page';
import { CARD_SURFACE_PAIR, STATUS_CARD_SURFACE } from './status-card';

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
      wpr: {
        present: true,
        cacheMarkerFound: true,
        cached: true,
        version: '3.20.1',
        timeStamp: STAMP
      },
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
        expect(el.className).toContain('focus-visible:outline-2');
        // Only a link to an active feature is presented as primary (lifts).
        const active = el.querySelector('[data-fdt="status-badge"]')?.textContent === 'Active';
        expect(el.className.includes('hover:shadow-elev-2')).toBe(active);
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
    expect(card('lazyload').textContent).toBe('LazyLoad for images, Active, Open Lazyload');
    // The off feature's link is quiet: no lift, secondary "Open" line.
    expect(card('defer_all_js').className).not.toContain('hover:shadow-elev-2');
    expect(card('defer_all_js').textContent).toBe(
      'Load JavaScript deferred, Not active, Open JavaScript'
    );
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

  it('renders the evidence line: source chips, amber unsure verdicts and their why, no extra tab stops', () => {
    const base = richData();
    render(() => (
      <DetectionsView
        data={richData({
          wprDetections: {
            ...base.wprDetections,
            delay_js: {
              present: true,
              scripts: [],
              version: '2.0',
              delayedScripts: 0,
              source: 'meta'
            },
            minify_css: { present: true, source: 'footprint' },
            priority_elements_beacon: { present: true, status: { lrc: true }, isMobile: null }
          }
        })}
        now={NOW}
      />
    ));
    const source = (id: string) => card(id).querySelector<HTMLElement>('[data-fdt-card-source]');
    // A link card and a static card both carry the chip; its meaning is spoken.
    expect(source('delay_js')?.textContent).toBe(
      ", Meta: Decided by WP Rocket's generator meta tag on this page."
    );
    expect(source('delay_js')?.title).toBe(
      "Decided by WP Rocket's generator meta tag on this page."
    );
    expect(source('minify_css')?.textContent).toContain('Footprint');
    expect(source('lazyload')).toBeNull();
    // Collecting: amber badge + its why, never the error red.
    const badge = (id: string) => card(id).querySelector<HTMLElement>('[data-fdt="status-badge"]');
    expect(badge('automatic_lazy_rendering')?.textContent).toBe('Collecting');
    expect(badge('automatic_lazy_rendering')?.className).toContain('text-status-warn');
    const why = card('automatic_lazy_rendering').querySelector('[data-fdt-card-why]');
    expect(why?.textContent).toBe(', Enabled, not yet applied on this page.');
    expect(why?.className).toContain('text-status-warn');
    // Undecided image dimensions on a WP Rocket page: unknown, explained.
    expect(badge('image_dimensions')?.textContent).toBe('Unknown');
    expect(card('image_dimensions').querySelector('[data-fdt-card-why]')?.textContent).toContain(
      'so its state is unknown.'
    );
    // Off features carry no evidence line at all.
    expect(card('rocket_cdn').querySelector('[data-fdt-card-evidence]')).toBeNull();
    // The decoration adds no focusable element (static cards stay inert).
    expect(card('minify_css').querySelectorAll('a, button, [tabindex]')).toHaveLength(0);
    expect(document.querySelector('.text-status-error')).toBeNull();
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

  it('heads the page with the strip, agreeing with the cards', () => {
    const data = richData();
    render(() => <DetectionsView data={data} now={NOW} />);
    const headline = document.querySelector('[data-fdt-summary-headline]');
    const activeOptimizations = cards().filter(
      (el) =>
        isOptimizationCard(el.dataset.fdtCardId as never) &&
        el.querySelector('[data-fdt="status-badge"]')?.textContent === 'Active'
    ).length;
    expect(headline?.textContent).toBe(
      `${activeOptimizations.toString()} of 17 optimizations active`
    );
    expect(document.querySelector('[data-fdt-summary-fact="cache"]')?.textContent).toBe(
      'Cache generated 2023-11-14 22:13:20 UTC'
    );
    // Nothing cloned from the status bar: no plugin badge, no server, no age.
    const strip = document.querySelector('[data-fdt="detections-summary"]');
    expect(strip?.querySelector('[data-fdt="status-badge"]')).toBeNull();
    expect(strip?.textContent).not.toContain('nginx');
    expect(strip?.textContent).not.toContain('ago');
  });

  it('still renders every card when the plugin is absent', () => {
    const data = makeFdtData();
    render(() => <DetectionsView data={data} now={NOW} />);
    expect(document.querySelector('[data-fdt-summary-fact="wpr"]')).not.toBeNull();
    expect(cards()).toHaveLength(buildStatusItems(data).length);
  });

  it('lays the cards out as divided rows at compact, a 15 rem card grid from regular', () => {
    render(() => <DetectionsView data={richData()} now={NOW} />);
    const grid = screen.getByRole('list', { name: 'Detection results' });
    expect(grid.className).toBe(DETECTIONS_GRID);
    expect(DETECTIONS_GRID).toContain('divide-y');
    expect(DETECTIONS_GRID).toContain('@regular:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]');
    // The regular-tier card mirrors the Card primitive's level-1 pair.
    expect(STATUS_CARD_SURFACE).toContain(`@regular:${CARD_SURFACE_PAIR.surface}`);
    expect(STATUS_CARD_SURFACE).toContain(`@regular:${CARD_SURFACE_PAIR.line}`);
  });

  it('omits the header-derived cards when nothing was captured', () => {
    render(() => <DetectionsView data={richData({ pageHeaders: null })} now={NOW} />);
    expect(document.querySelector('[data-fdt-card-id="server"]')).toBeNull();
    expect(document.querySelector('[data-fdt-card-id="known-platform"]')).toBeNull();
  });

  it.each([null, [], richData().pageHeaders])(
    'leaves the header inventory to Headers & Cookies for capture %j',
    (pageHeaders) => {
      render(() => <DetectionsView data={richData({ pageHeaders })} now={NOW} />);
      expect(screen.queryByText('Response headers')).toBeNull();
      expect(screen.queryByRole('button', { name: /Response headers/ })).toBeNull();
      expect(screen.queryByText('max-age=60')).toBeNull();
    }
  );

  it('keeps card nodes and focus across a data refresh', () => {
    const [data, setData] = createSignal(richData());
    render(() => <DetectionsView data={data()} now={NOW} />);
    const before = card('wpr');
    const link = card('lazyload');
    link.focus();
    setData(richData({ undefinedReferencesOnPage: ['jQuery'] }));
    expect(card('wpr')).toBe(before);
    expect(document.activeElement).toBe(link);
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
