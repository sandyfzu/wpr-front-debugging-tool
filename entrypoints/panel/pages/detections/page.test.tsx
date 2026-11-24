/**
 * The Detections page, over the List layout (every row, page facts included,
 * in view-model order; Grouped and Cards: `page-layout.test.tsx`): frame +
 * heading, the rows with their page links (only mapped ids carry one, the
 * row itself is never a control), the status vocabulary, the tooltip
 * subtitles, the overview's agreement with the cards, the absence of a
 * duplicate header inventory, `Copy report`, refresh stability (rows keep
 * their DOM and focus), the optimization status filter (All / Active /
 * Collecting / Off), and the store wiring.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast, toastItems } from '../../../../components/ui/toast-store';
import { buildStatusItems } from '../../../../lib/panel/detections-view-model';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { makeFdtData } from '../../state/fixtures';
import type { DataState } from '../../state/fdt-state-machine';
import {
  createDetectionsLayout,
  DetectionsLayoutContext,
  type DetectionsLayoutStore
} from '../../state/detections-layout';
import { createSearchStore, SEARCH_DEBOUNCE_MS, type SearchStore } from '../../state/search';
import { FdtDataContext, SearchContext, type FdtDataStore } from '../../state/use-fdt-data';
import { CARD_PAGE_LINKS } from './card-presentation';
import { DNS_PREFETCH_LIMIT, MOBILE_CACHE_LIMIT } from '../../../../lib/detection/hud';
import { isOptimizationCard } from '../../../../lib/panel/detections-summary';
import { platformSegment, wprSegment } from '../../top-bar/selectors';
import { CARDS_BODY } from './entry-layout';
import {
  DETECTIONS_SUBTITLE,
  DetectionsPage,
  DETECTIONS_SEARCH,
  DetectionsView,
  filterOptions,
  SHOW_ALL_OPTIMIZATIONS
} from './page';

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

/** A layout store on List: the flat full row set these tests read. */
function listLayout(): DetectionsLayoutStore {
  const store = createDetectionsLayout();
  store.setLayout('list');
  return store;
}

/** One entry's page link, or null. */
const link = (id: string): HTMLAnchorElement | null =>
  card(id).querySelector<HTMLAnchorElement>('a[data-fdt-card-link]');

describe('DetectionsView', () => {
  it('renders the frame: one h1, the intro line, the Copy report action', () => {
    render(() => <DetectionsView layoutStore={listLayout()} data={richData()} now={NOW} />);
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
    render(() => <DetectionsView layoutStore={listLayout()} data={data} now={NOW} />);
    expect(cards().map((el) => el.dataset.fdtCardId)).toEqual(
      buildStatusItems(data).map((item) => item.id)
    );
    expect(screen.getByRole('list', { name: 'Detection results' }).children).toHaveLength(
      cards().length
    );
  });

  it('links only the mapped rows to their page; a row is never a control', () => {
    render(() => <DetectionsView layoutStore={listLayout()} data={richData()} now={NOW} />);
    for (const el of cards()) {
      const id = el.dataset.fdtCardId ?? '';
      const route = CARD_PAGE_LINKS.get(id as never);
      expect(el.tagName).toBe('DIV');
      expect(el.hasAttribute('tabindex')).toBe(false);
      const anchors = el.querySelectorAll('a');
      if (route === undefined) {
        expect(anchors).toHaveLength(0);
      } else {
        // Exactly one control: the page link, with the focus ring.
        expect(anchors).toHaveLength(1);
        expect(el.querySelectorAll('button')).toHaveLength(0);
        expect(link(id)?.getAttribute('href')).toBe(`#/${route}`);
        expect(link(id)?.className).toContain('focus-visible:outline-2');
      }
    }
    // The link's name is its own visible text plus the row it belongs to
    // (WCAG 2.5.3: the visible label is part of the name; several rows link
    // the same page).
    expect(link('delay_js')?.hasAttribute('aria-label')).toBe(false);
    expect(link('delay_js')?.textContent).toBe('Open JavaScript, Delay JavaScript execution');
    expect(link('lazyload')?.textContent).toBe('Open LazyLoad, LazyLoad for images');
    // The row reads name, notes, state, then the link.
    expect(card('delay_js').textContent).toBe(
      'Delay JavaScript executionVersion 2.0, ActiveOpen JavaScript, Delay JavaScript execution'
    );
    expect(card('defer_all_js').textContent).toBe(
      'Load JavaScript deferred, OffOpen JavaScript, Load JavaScript deferred'
    );
  });

  it('maps verdicts to the vocabulary: active → ok "Active" pill, off → the quiet "Off"', () => {
    render(() => <DetectionsView layoutStore={listLayout()} data={richData()} now={NOW} />);
    const badge = (id: string) => card(id).querySelector<HTMLElement>('[data-fdt="status-badge"]');
    expect(badge('wpr')?.textContent).toBe('Active');
    expect(badge('wpr')?.className).toContain('text-status-ok');
    // Off is plain muted text, no pill: twelve off rows are no twelve chips.
    expect(badge('minify_css')).toBeNull();
    const off = card('minify_css').querySelector<HTMLElement>('[data-fdt-card-state]');
    expect(off?.dataset.fdtCardState).toBe('not-active');
    expect(off?.textContent).toBe(', Off');
    expect(off?.querySelector('.text-fg-muted')?.textContent).toBe('Off');
    expect(document.querySelector('.text-status-error')).toBeNull();
    expect(card('minify_css').querySelector('svg')?.getAttribute('class')).toContain(
      'text-status-neutral'
    );
  });

  it('renders the evidence line: source chips, amber unsure verdicts and their why, no extra tab stops', () => {
    const base = richData();
    render(() => (
      <DetectionsView
        layoutStore={listLayout()}
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
    render(() => <DetectionsView layoutStore={listLayout()} data={richData()} now={NOW} />);
    expect(card('wpr').querySelector('.font-mono')?.textContent).toBe('3.20.1');
    expect(card('server').querySelector('.font-mono')?.textContent).toBe('nginx');
    const cachedTrigger = card('cached').querySelector('[data-fdt="tooltip-trigger"]');
    expect(cachedTrigger?.textContent).toBe('Generated 3 h ago');
    const platformTrigger = card('known-platform').querySelector('[data-fdt="tooltip-trigger"]');
    expect(platformTrigger?.textContent).toBe('Kinsta');
    expect(card('lazyload_iframes').querySelector('[data-fdt-card-subtitle]')).toBeNull();
  });

  it('renders the Host layers subtitle as a tooltip trigger naming the headers and the add-on caveat', async () => {
    const base = richData().pageHeaders ?? [];
    render(() => (
      <DetectionsView
        layoutStore={listLayout()}
        data={richData({
          pageHeaders: [
            ...base,
            { name: 'cf-cache-status', value: 'DYNAMIC' },
            { name: 'CF-RAY', value: 'abc-SJC' }
          ]
        })}
        now={NOW}
      />
    ));
    const trigger = card('host-layers').querySelector<HTMLElement>('[data-fdt="tooltip-trigger"]');
    expect(trigger?.textContent).toBe('Cloudflare: no cache hit');
    // Static card: the trigger is the card's only focus stop.
    expect(card('host-layers').tagName).toBe('DIV');
    if (trigger === null) throw new Error('no tooltip trigger');
    fireEvent.focus(trigger);
    const content = (await screen.findByRole('tooltip')).textContent;
    expect(content).toContain('Identified by the cf-cache-status, CF-RAY response headers.');
    expect(content).toContain("WP Rocket's Cloudflare, Sucuri or Varnish add-on");
  });

  it('shows no Host layers card when no host-layer header was captured', () => {
    render(() => <DetectionsView layoutStore={listLayout()} data={richData()} now={NOW} />);
    expect(document.querySelector('[data-fdt-card-id="host-layers"]')).toBeNull();
  });

  it('renders the mobile cache render device as a tooltip trigger carrying the proof limit', async () => {
    const base = richData();
    render(() => (
      <DetectionsView
        layoutStore={listLayout()}
        data={{
          ...base,
          wprDetections: {
            ...base.wprDetections,
            mobile_cache: {
              present: true,
              variant: 'desktop',
              source: 'meta'
            }
          }
        }}
        now={NOW}
      />
    ));
    const trigger = card('mobile_cache').querySelector<HTMLElement>('[data-fdt="tooltip-trigger"]');
    expect(trigger?.textContent).toBe('Rendered for desktop');
    trigger?.focus();
    expect(await screen.findByText(MOBILE_CACHE_LIMIT)).toBeTruthy();
  });

  it('renders the DNS prefetch hints as a tooltip trigger carrying the proof limit', async () => {
    const base = richData();
    render(() => (
      <DetectionsView
        layoutStore={listLayout()}
        data={{
          ...base,
          wprDetections: {
            ...base.wprDetections,
            dns_prefetch: { present: true, domains: ['https://a.example/'], source: 'meta' }
          }
        }}
        now={NOW}
      />
    ));
    const trigger = card('dns_prefetch').querySelector<HTMLElement>('[data-fdt="tooltip-trigger"]');
    expect(trigger?.textContent).toBe('1 domain hinted');
    trigger?.focus();
    expect(await screen.findByText(DNS_PREFETCH_LIMIT)).toBeTruthy();
  });

  it('ages the cached subtitle as the clock advances', () => {
    const [now, setNow] = createSignal(NOW);
    render(() => <DetectionsView layoutStore={listLayout()} data={richData()} now={now()} />);
    const trigger = () => card('cached').querySelector('[data-fdt="tooltip-trigger"]');
    expect(trigger()?.textContent).toBe('Generated 3 h ago');
    setNow(NOW + 24 * 3_600_000);
    expect(trigger()?.textContent).toBe('Generated 1 d ago');
  });

  it('heads the page with the overview tiles, agreeing with the cards and the top bar', () => {
    const data = richData();
    render(() => <DetectionsView layoutStore={listLayout()} data={data} now={NOW} />);
    const headline = document.querySelector('[data-fdt-summary-headline]');
    const activeOptimizations = cards().filter(
      (el) =>
        isOptimizationCard(el.dataset.fdtCardId as never) &&
        el.querySelector('[data-fdt="status-badge"]')?.textContent === 'Active'
    ).length;
    expect(headline?.textContent).toBe(
      `${activeOptimizations.toString()} of 18 optimizations active`
    );
    expect(document.querySelector('[data-fdt-summary-fact="cache"]')?.textContent).toBe(
      'Cache generated 2023-11-14 22:13:20 UTC'
    );
    // The tiles restate the bar's answers through its own selectors (never a
    // second reading), as tile text — no badge — and the absolute stamp, no age.
    const tiles = document.querySelector('[data-fdt="detections-summary"]');
    const server = platformSegment(data);
    expect(server.kind).toBe('captured');
    expect(tiles?.querySelector('[data-fdt-overview-server]')?.textContent).toBe(
      server.kind === 'captured' ? server.value : null
    );
    const wpr = wprSegment(data);
    expect(
      tiles?.querySelector('[data-fdt-overview-tile="wpr"] [data-fdt="stat-tile-value"]')
        ?.textContent
    ).toBe(wpr.kind === 'detected' ? wpr.version : null);
    expect(tiles?.querySelector('[data-fdt="status-badge"]')).toBeNull();
    expect(tiles?.textContent).not.toContain('ago');
  });

  it('still renders every card when the plugin is absent', () => {
    const data = makeFdtData();
    render(() => <DetectionsView layoutStore={listLayout()} data={data} now={NOW} />);
    expect(document.querySelector('[data-fdt-summary-fact="wpr"]')).not.toBeNull();
    expect(cards()).toHaveLength(buildStatusItems(data).length);
  });

  it('lays Cards out as calm rows at compact, a 15 rem card grid from regular', () => {
    const store = createDetectionsLayout();
    store.setLayout('cards');
    render(() => <DetectionsView layoutStore={store} data={richData()} now={NOW} />);
    const grid = screen.getByRole('list', { name: 'Detection results' });
    expect(grid.className).toBe(CARDS_BODY);
    expect(CARDS_BODY).not.toContain('divide-y');
    expect(CARDS_BODY).toContain('@regular:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]');
    // The card surface pair from the regular tier.
    expect(card('wpr').className).toContain('@regular:bg-surface-2');
    expect(card('wpr').className).toContain('@regular:border-line-1');
  });

  it('omits the header-derived cards when nothing was captured', () => {
    render(() => (
      <DetectionsView layoutStore={listLayout()} data={richData({ pageHeaders: null })} now={NOW} />
    ));
    expect(document.querySelector('[data-fdt-card-id="server"]')).toBeNull();
    expect(document.querySelector('[data-fdt-card-id="known-platform"]')).toBeNull();
  });

  it.each([null, [], richData().pageHeaders])(
    'leaves the header inventory to Headers & Cookies for capture %j',
    (pageHeaders) => {
      render(() => (
        <DetectionsView layoutStore={listLayout()} data={richData({ pageHeaders })} now={NOW} />
      ));
      expect(screen.queryByText('Response headers')).toBeNull();
      expect(screen.queryByRole('button', { name: /Response headers/ })).toBeNull();
      expect(screen.queryByText('max-age=60')).toBeNull();
    }
  );

  it('keeps card nodes and focus across a data refresh', () => {
    const [data, setData] = createSignal(richData());
    render(() => <DetectionsView layoutStore={listLayout()} data={data()} now={NOW} />);
    const before = card('wpr');
    const lazyLink = link('lazyload');
    lazyLink?.focus();
    expect(document.activeElement).toBe(lazyLink);
    setData(richData({ undefinedReferencesOnPage: ['jQuery'] }));
    expect(card('wpr')).toBe(before);
    expect(document.activeElement).toBe(lazyLink);
  });

  it('copies the report from the page action', async () => {
    const writeText = vi.fn((): Promise<void> => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      render(() => <DetectionsView layoutStore={listLayout()} data={richData()} now={NOW} />);
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

/** One status filter segment's radio by id. */
function segment(id: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(
    `[data-fdt="detections-filter"] [data-fdt-choice-value="${id}"] input`
  );
  if (!found) throw new Error(`no segment ${id}`);
  return found;
}

/** Pick a status filter segment (its label, as a pointer would). */
function pick(id: string): void {
  const label = segment(id).closest('[data-fdt="choice"]')?.querySelector('label');
  if (!label) throw new Error(`no label for ${id}`);
  fireEvent.click(label);
}

/** A segment's visible count. */
function segmentCount(id: string): string | null | undefined {
  return segment(id).closest('[data-fdt="choice"]')?.querySelector('[data-fdt-choice-count]')
    ?.textContent;
}

/** The rendered card ids, in DOM order. */
function cardIds(): string[] {
  return cards().map((el) => el.dataset.fdtCardId ?? '');
}

/** The rendered card ids that are page context (never narrowed). */
function pageFactIds(): string[] {
  return cardIds().filter((id) => !isOptimizationCard(id as never));
}

/** A payload where nothing is active but the plugin and the cache card. */
function noneActive(): FdtData {
  const base = makeFdtData();
  return makeFdtData({
    pageHeaders: richData().pageHeaders,
    wprDetections: { ...base.wprDetections, wpr: richData().wprDetections.wpr }
  });
}

/** {@link richData} plus a beacon still collecting (Collecting rows exist). */
function collectingData(): FdtData {
  const base = richData();
  return richData({
    wprDetections: {
      ...base.wprDetections,
      priority_elements_beacon: { present: true, status: { lrc: true }, isMobile: null }
    }
  });
}

describe('DetectionsView status filter', () => {
  it('renders All / Active / Collecting / Off with counts over the optimization rows', () => {
    const data = collectingData();
    render(() => <DetectionsView layoutStore={listLayout()} data={data} now={NOW} />);
    const group = screen.getByRole('radiogroup', { name: 'Optimization status' });
    const ids = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map(
      (el) => el.value
    );
    expect(ids).toEqual(['all', 'active', 'collecting', 'off']);
    const items = buildStatusItems(data).filter((item) => isOptimizationCard(item.id));
    const active = items.filter((item) => item.status === 'active').length;
    const collecting = items.filter((item) => item.status === 'collecting').length;
    expect(collecting).toBeGreaterThan(0);
    expect(segmentCount('all')).toBe(String(items.length));
    expect(segmentCount('active')).toBe(String(active));
    expect(segmentCount('collecting')).toBe(String(collecting));
    expect(segmentCount('off')).toBe(String(items.length - active - collecting));
    expect(segment('all').checked).toBe(true);
    // The segmented look, not the tiles.
    expect(group.className).toContain('bg-surface-3');
    // The status filter is radios only; the page's one text input is its
    // search field, a separate control (the find protocol's field).
    expect(group.querySelector('input:not([type="radio"])')).toBeNull();
    expect(
      [
        ...document.querySelectorAll('[data-fdt="detections-controls"] input:not([type="radio"])')
      ].map((input) => input.getAttribute('type'))
    ).toEqual(['search']);
    expect(group.textContent).not.toMatch(/enabled|disabled/i);
  });

  it('builds the segments with counts, disabling only an empty unselected bucket', () => {
    const counts = { all: 0, active: 0, collecting: 2, off: 0 };
    expect(filterOptions(counts, 'all')).toEqual([
      { value: 'all', label: 'All', count: 0, disabled: false },
      { value: 'active', label: 'Active', count: 0, disabled: true },
      { value: 'collecting', label: 'Collecting', count: 2, disabled: false },
      { value: 'off', label: 'Off', count: 0, disabled: true }
    ]);
    expect(filterOptions(counts, 'off').map((option) => option.disabled)).toEqual([
      false,
      true,
      false,
      false
    ]);
  });

  it('narrows only optimization cards; page facts, badges and why stay', () => {
    const data = collectingData();
    render(() => <DetectionsView layoutStore={listLayout()} data={data} now={NOW} />);
    const facts = pageFactIds();
    const all = cardIds();
    const wprNode = card('wpr');
    pick('active');
    expect(segment('active').checked).toBe(true);
    expect(pageFactIds()).toEqual(facts);
    expect(card('wpr')).toBe(wprNode);
    const activeIds = cardIds().filter((id) => isOptimizationCard(id as never));
    expect(activeIds).toContain('delay_js');
    for (const id of activeIds) {
      expect(card(id).querySelector('[data-fdt="status-badge"]')?.textContent).toBe('Active');
    }
    pick('collecting');
    const collectingIds = cardIds().filter((id) => isOptimizationCard(id as never));
    expect(collectingIds.length).toBeGreaterThan(0);
    for (const id of collectingIds) {
      expect(card(id).querySelector('[data-fdt="status-badge"]')?.textContent).toBe('Collecting');
      // The why travels with the row.
      expect(card(id).querySelector('[data-fdt-card-why]')).not.toBeNull();
    }
    pick('off');
    const offIds = cardIds().filter((id) => isOptimizationCard(id as never));
    expect(offIds).not.toContain('delay_js');
    for (const id of offIds) {
      expect(card(id).querySelector('[data-fdt="status-badge"]')?.textContent).not.toBe('Active');
      expect(card(id).querySelector('[data-fdt="status-badge"]')?.textContent).not.toBe(
        'Collecting'
      );
    }
    expect(pageFactIds()).toEqual(facts);
    pick('all');
    expect(cardIds()).toEqual(all);
  });

  it('keeps the overview byte-identical under every filter', () => {
    render(() => <DetectionsView layoutStore={listLayout()} data={richData()} now={NOW} />);
    const overview = () => document.querySelector('[data-fdt="detections-summary"]')?.outerHTML;
    const before = overview();
    expect(before).toContain('data-fdt-summary-headline');
    for (const id of ['off', 'collecting', 'active', 'all']) {
      pick(id);
      expect(overview()).toBe(before);
    }
  });

  it('disables an empty bucket unless it is the selected one', () => {
    render(() => <DetectionsView layoutStore={listLayout()} data={noneActive()} now={NOW} />);
    expect(segmentCount('active')).toBe('0');
    expect(segment('active').disabled).toBe(true);
    expect(segment('all').disabled).toBe(false);
    expect(segment('off').disabled).toBe(false);
    expect(document.querySelector('[data-fdt="detections-filtered-empty"]')).toBeNull();
  });

  it('keeps the selection, card nodes and focus across a refresh', () => {
    const [data, setData] = createSignal(richData());
    render(() => <DetectionsView layoutStore={listLayout()} data={data()} now={NOW} />);
    pick('active');
    const delay = card('delay_js');
    const delayLink = link('delay_js');
    delayLink?.focus();
    const segmentNode = segment('active');
    setData(richData({ undefinedReferencesOnPage: ['jQuery'] }));
    expect(segment('active')).toBe(segmentNode);
    expect(segment('active').checked).toBe(true);
    expect(card('delay_js')).toBe(delay);
    expect(document.activeElement).toBe(delayLink);
  });

  it('keeps a bucket a refresh emptied selected, says so, and leads back to All', () => {
    const [data, setData] = createSignal(richData());
    render(() => <DetectionsView layoutStore={listLayout()} data={data()} now={NOW} />);
    pick('active');
    const facts = pageFactIds();
    setData(noneActive());
    expect(segment('active').checked).toBe(true);
    // The selected segment stays reachable at zero.
    expect(segment('active').disabled).toBe(false);
    const empty = document.querySelector('[data-fdt="detections-filtered-empty"]');
    expect(empty?.textContent).toContain('"Active"');
    expect(pageFactIds()).toEqual(facts);
    expect(cardIds().filter((id) => isOptimizationCard(id as never))).toEqual([]);
    const back = screen.getByRole('button', { name: SHOW_ALL_OPTIMIZATIONS });
    back.focus();
    fireEvent.click(back);
    expect(segment('all').checked).toBe(true);
    expect(document.querySelector('[data-fdt="detections-filtered-empty"]')).toBeNull();
    expect(document.activeElement).toBe(segment('all'));
    expect(cardIds().length).toBe(buildStatusItems(noneActive()).length);
  });

  it('copies the same report whatever the filter', async () => {
    const writeText = vi.fn((): Promise<void> => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    try {
      const data = richData();
      render(() => <DetectionsView layoutStore={listLayout()} data={data} now={NOW} />);
      fireEvent.click(screen.getByRole('button', { name: 'Copy report' }));
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledTimes(1);
      });
      cleanup();
      render(() => <DetectionsView layoutStore={listLayout()} data={data} now={NOW} />);
      pick('active');
      fireEvent.click(screen.getByRole('button', { name: 'Copy report' }));
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledTimes(2);
      });
      expect(writeText.mock.calls[1]).toEqual(writeText.mock.calls[0]);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it('resets to All on remount', () => {
    const data = richData();
    render(() => <DetectionsView layoutStore={listLayout()} data={data} now={NOW} />);
    pick('off');
    cleanup();
    render(() => <DetectionsView layoutStore={listLayout()} data={data} now={NOW} />);
    expect(segment('all').checked).toBe(true);
  });
});

describe('DetectionsView search', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Type into the page's field and let the store commit. */
  function type(text: string): void {
    fireEvent.input(screen.getByRole('searchbox', { name: DETECTIONS_SEARCH.label }), {
      target: { value: text }
    });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  }

  /** The name of a row of `data`. */
  function nameOf(data: FdtData, id: string): string {
    const found = buildStatusItems(data).find((item) => item.id === id);
    if (found === undefined) throw new Error(`no row ${id}`);
    return found.name;
  }

  /** Render with a given store and layout. */
  function show(search: SearchStore, data = richData(), layout = listLayout()): void {
    render(() => <DetectionsView layoutStore={layout} data={data} now={NOW} search={search} />);
  }

  it('narrows every row by name, page facts included, on top of the status filter', () => {
    vi.useFakeTimers();
    const data = richData();
    show(createSearchStore(), data);
    const field = screen.getByRole('searchbox', { name: DETECTIONS_SEARCH.label });
    expect(field.getAttribute('placeholder')).toBe(DETECTIONS_SEARCH.placeholder);
    type(nameOf(data, 'delay_js').toUpperCase());
    expect(cardIds()).toEqual(['delay_js']);
    type('server');
    expect(cardIds()).toEqual(['server']);
    pick('active');
    type(nameOf(data, 'lazyload'));
    expect(cardIds()).toEqual(['lazyload']);
    type('');
    expect(cardIds().length).toBeGreaterThan(2);
  });

  it('narrows the Grouped layout, dropping the groups left empty', () => {
    vi.useFakeTimers();
    const data = richData();
    show(createSearchStore(), data, createDetectionsLayout());
    const groupsBefore = document.querySelectorAll('[data-fdt="detections-group"]').length;
    type(nameOf(data, 'delay_js'));
    expect(cardIds()).toEqual(['delay_js']);
    expect(document.querySelectorAll('[data-fdt="detections-group"]')).toHaveLength(1);
    expect(groupsBefore).toBeGreaterThan(1);
  });

  it('says when nothing matches, and Clear search brings every row back to the field', () => {
    vi.useFakeTimers();
    show(createSearchStore());
    const all = cardIds();
    pick('active');
    type('no such feature');
    const empty = document.querySelector('[data-fdt="detections-filtered-empty"]');
    expect(empty?.textContent).toContain('no such feature');
    expect(cardIds()).toEqual([]);
    // Both ways back: the search and the picked status.
    expect(screen.getByRole('button', { name: SHOW_ALL_OPTIMIZATIONS })).toBeTruthy();
    const clear = screen.getByRole('button', { name: 'Clear search' });
    clear.focus();
    fireEvent.click(clear);
    expect(document.querySelector('[data-fdt="detections-filtered-empty"]')).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('searchbox', { name: DETECTIONS_SEARCH.label })
    );
    pick('all');
    expect(cardIds()).toEqual(all);
  });

  it('joins the find: reports the rendered matches, marks and scrolls the cursor’s row', () => {
    vi.useFakeTimers();
    const scrolled: string[] = [];
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (
      this: HTMLElement
    ) {
      scrolled.push(this.dataset.fdtEntryId ?? '');
    });
    const search = createSearchStore();
    show(search);
    // The DevTools find bar's delivery: the field adopts it, the rows narrow.
    search.perform('a');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    const matches = cardIds();
    expect(search.matchCount()).toBe(matches.length);
    expect(
      screen.getByRole<HTMLInputElement>('searchbox', { name: DETECTIONS_SEARCH.label }).value
    ).toBe('a');
    const marked = (): string[] =>
      [...document.querySelectorAll<HTMLElement>('[data-fdt-entry-id][aria-current="true"]')].map(
        (item) => item.dataset.fdtEntryId ?? ''
      );
    expect(marked()).toEqual([matches[0]]);
    expect(scrolled).toEqual([matches[0]]);
    search.advance(1);
    expect(marked()).toEqual([matches[1]]);
    expect(scrolled).toEqual([matches[0], matches[1]]);
  });

  it('keeps the query and the narrowed rows across a refresh', () => {
    vi.useFakeTimers();
    const [data, setData] = createSignal(richData());
    const search = createSearchStore();
    render(() => (
      <DetectionsView layoutStore={listLayout()} data={data()} now={NOW} search={search} />
    ));
    const name = nameOf(richData(), 'delay_js');
    type(name);
    const row = card('delay_js');
    setData(richData({ undefinedReferencesOnPage: ['jQuery'] }));
    expect(cardIds()).toEqual(['delay_js']);
    expect(card('delay_js')).toBe(row);
    expect(search.query()).toBe(name);
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
        <DetectionsLayoutContext.Provider value={listLayout()}>
          <SearchContext.Provider value={createSearchStore()}>
            <DetectionsPage />
          </SearchContext.Provider>
        </DetectionsLayoutContext.Provider>
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
