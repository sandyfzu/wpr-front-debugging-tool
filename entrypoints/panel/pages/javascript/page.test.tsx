/**
 * Render tests for the JavaScript page: summary, chip counts and the
 * zero-count rule, the inline/external row branches, the collapse toggle
 * (state owned by the page: survives a virtual unmount, pruned on refresh),
 * the field ↔ store sync both ways, the filtered-empty and empty states, and
 * the route body's data gate. Geometry comes from a virtualizer double —
 * happy-dom has no layout — that renders a controllable window of rows.
 */
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import type { Accessor, Setter } from 'solid-js';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntersectionGate } from '../../../../components/ui/code-block';
import type { VirtualItem, VirtualizerFactory } from '../../../../components/ui/virtual-list';
import type { DelayedScriptRecord, FdtData } from '../../../../lib/wp-rocket/types';
import type { DataState } from '../../state/fdt-state-machine';
import { makeDelayScript, makeFdtData } from '../../state/fixtures';
import { createSearchStore, SEARCH_DEBOUNCE_MS, type SearchStore } from '../../state/search';
import { FdtDataContext, SearchContext, type FdtDataStore } from '../../state/use-fdt-data';
import { JavaScriptPage, JavaScriptView, listCutNote } from './page';
import { PREVIEW_LINE_CHARS } from './script-view';
import type { CodeBlockSeams } from './script-row';
import { PAYLOAD_LIMITS } from '../../../../lib/messaging/payload-bounds';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  clampClips = false;
  areaScrolls = false;
});

/** A virtualizer double rendering rows `[from, to)` of the current count. */
function windowedVirtualizer(): {
  factory: VirtualizerFactory;
  setWindow: Setter<[number, number]>;
} {
  // A bounded window, as a real list renders: a 5,000-row page mounts 40 rows.
  const [range, setWindow] = createSignal<[number, number]>([0, 40]);
  const factory: VirtualizerFactory = (options) => ({
    getVirtualItems: (): VirtualItem[] => {
      const [from, to] = range();
      const items: VirtualItem[] = [];
      for (let index = from; index < Math.min(to, options.count); index += 1) {
        // Honours the page's keys, as the real virtualizer does.
        items.push({
          key: options.getItemKey?.(index) ?? index,
          index,
          start: index * 40,
          end: index * 40 + 40,
          size: 40,
          lane: 0
        });
      }
      return items;
    },
    getTotalSize: () => options.count * 40,
    measureElement: () => undefined
  });
  return { factory, setWindow };
}

/**
 * The clamp-clip state every block's clip watch reports at mount (tests flip
 * it to model a wrapped long line folding past the clamp).
 */
let clampClips = false;

/** The scroll state every block's area watch reports (focusable + named when true). */
let areaScrolls = false;

/** Code-block seams: no highlighter load, no observer (raw text stays). */
const CODE_SEAMS: CodeBlockSeams = {
  createObserver: (): IntersectionGate => ({
    observe: () => undefined,
    disconnect: () => undefined
  }),
  loadHighlighter: () => new Promise<never>(() => undefined),
  watchOverflow: (_box, _content, onChange, measure) => {
    // The clip watch is the one with a custom measure.
    onChange(measure === undefined ? areaScrolls : clampClips);
    return () => undefined;
  }
};

/** The page's fixture scripts: every row shape the page renders. */
function scripts(): DelayedScriptRecord[] {
  return [
    makeDelayScript({ src: 'https://example.test/jquery.js', delayed: true }),
    makeDelayScript({
      src: 'https://example.test/cart.js',
      delayed: false,
      deferred: true,
      deferredByWPR: true
    }),
    makeDelayScript({ src: '', delayed: false }),
    {
      inline: true,
      content: 'line1();\nline2();\nline3();\nline4();\nline5();',
      delayed: true,
      deferred: false,
      deferredByWPR: false,
      fdtExcluded: null
    },
    {
      inline: true,
      content: 'tiny();',
      delayed: false,
      deferred: false,
      deferredByWPR: false,
      fdtExcluded: 'delay_js'
    },
    {
      inline: true,
      content: '',
      delayed: false,
      deferred: false,
      deferredByWPR: false,
      fdtExcluded: null
    }
  ];
}

/** Page data around a script list. */
function dataWith(
  list: DelayedScriptRecord[],
  present = true,
  version: string | null = '2.0.4'
): FdtData {
  const base = makeFdtData();
  return makeFdtData({
    wprDetections: {
      ...base.wprDetections,
      delay_js: {
        present,
        scripts: list,
        version,
        delayedScripts: list.filter((s) => s.delayed).length
      }
    }
  });
}

/** Render the view over a data signal. */
function renderView(initial: FdtData = dataWith(scripts())): {
  setData: Setter<FdtData>;
  search: SearchStore;
  virtualizer: ReturnType<typeof windowedVirtualizer>;
} {
  const [data, setData] = createSignal(initial);
  const search = createSearchStore();
  const virtualizer = windowedVirtualizer();
  render(() => (
    <JavaScriptView
      data={data}
      search={search}
      createVirtualizer={virtualizer.factory}
      codeBlock={CODE_SEAMS}
    />
  ));
  return { setData, search, virtualizer };
}

/** The chip button for a filter id. */
function chip(id: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`[data-fdt-filter-chip="${id}"]`);
  if (!button) throw new Error(`no chip ${id}`);
  return button;
}

/** Every rendered row. */
function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-fdt="script-row"]')];
}

/** The search field. */
function field(): HTMLInputElement {
  return screen.getByRole('searchbox', { name: 'Search scripts' });
}

describe('JavaScriptView — summary and chips', () => {
  it('renders the Delay JS state, its version and the script total', () => {
    renderView();
    const summary = document.querySelector<HTMLElement>('[data-fdt="script-summary"]');
    expect(summary?.textContent).toContain('Delay JavaScript execution');
    expect(summary?.textContent).toContain('Detected');
    expect(summary?.textContent).toContain('Version');
    expect(summary?.textContent).toContain('2.0.4');
    expect(summary?.querySelector('[data-fdt="script-total"]')?.textContent).toBe('6 scripts');
  });

  it('renders "Not detected" (neutral) without a version when Delay JS is absent', () => {
    renderView(dataWith(scripts(), false, '1.0'));
    const summary = document.querySelector<HTMLElement>('[data-fdt="script-summary"]');
    expect(summary?.textContent).toContain('Not detected');
    expect(summary?.textContent).not.toContain('1.0');
    expect(summary?.querySelector('.text-status-neutral')).not.toBeNull();
  });

  it('counts every chip over all rows', () => {
    renderView();
    const counts: Record<string, string | null | undefined> = Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>('[data-fdt-filter-chip]')].map(
        (button): [string, string | null | undefined] => [
          button.dataset.fdtFilterChip ?? '',
          button.querySelector('[data-fdt-filter-count]')?.textContent
        ]
      )
    );
    expect(counts).toEqual({
      all: '6',
      delayed: '2',
      'non-delayed': '4',
      deferred: '1',
      'non-deferred': '5',
      inline: '3',
      external: '3'
    });
  });

  it('disables a zero-count chip, but keeps a selected chip a refresh emptied', () => {
    const external = scripts().filter((s) => !s.inline);
    const { setData } = renderView(dataWith(external));
    expect(chip('inline').disabled).toBe(true);
    expect(chip('all').disabled).toBe(false);
    fireEvent.click(chip('delayed'));
    expect(chip('delayed').getAttribute('aria-pressed')).toBe('true');
    // A refresh leaves no delayed script: the chip stays selected and usable.
    setData(dataWith(external.map((s) => ({ ...s, delayed: false }))));
    expect(chip('delayed').getAttribute('aria-pressed')).toBe('true');
    expect(chip('delayed').disabled).toBe(false);
    expect(screen.getByText('No matches')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(chip('all').getAttribute('aria-pressed')).toBe('true');
    expect(rows()).toHaveLength(3);
  });

  it('keeps chip buttons mounted across a selection (focus survives)', () => {
    renderView();
    const delayed = chip('delayed');
    delayed.focus();
    fireEvent.click(delayed);
    expect(chip('delayed')).toBe(delayed);
    expect(document.activeElement).toBe(delayed);
  });
});

describe('JavaScriptView — rows', () => {
  it('renders the list semantics, one row per script', () => {
    renderView();
    const list = screen.getByRole('list', { name: 'Scripts' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(6);
    expect(items[0]?.getAttribute('aria-setsize')).toBe('6');
    expect(items[5]?.getAttribute('aria-posinset')).toBe('6');
  });

  it('renders an external row: chips, safe link and URL copy', () => {
    renderView();
    const row = rows()[1] as HTMLElement;
    expect(row.dataset.fdtScriptType).toBe('external');
    expect(row.textContent).toContain('External');
    expect(row.textContent).toContain('Not delayed');
    expect(row.textContent).toContain('Deferred (By WP Rocket)');
    const link = within(row).getByRole('link');
    expect(link.getAttribute('href')).toBe('https://example.test/cart.js');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(within(row).getByRole('button', { name: 'Script URL — copy' })).toBeTruthy();
  });

  it('names an empty src instead of rendering an empty link', () => {
    renderView();
    const row = rows()[2] as HTMLElement;
    expect(row.textContent).toContain('Empty src attribute');
    expect(within(row).queryByRole('link')).toBeNull();
    expect(within(row).queryByRole('button', { name: /copy/ })).toBeNull();
  });

  it('renders an inline row: chips, line count, copy, clamped preview and toggle', () => {
    renderView();
    const row = rows()[3] as HTMLElement;
    expect(row.textContent).toContain('Inline');
    expect(row.textContent).toContain('Delayed');
    expect(row.textContent).toContain('5 lines');
    expect(within(row).getByRole('button', { name: 'Inline script — copy' })).toBeTruthy();
    const block = row.querySelector<HTMLElement>('[data-fdt="code-block"]');
    expect(block?.querySelector('[data-fdt-code-area]')?.hasAttribute('data-fdt-clamped')).toBe(
      true
    );
    expect(block?.textContent).toContain('line3();');
    expect(block?.textContent).not.toContain('line4();');
    const toggle = within(row).getByRole('button', { name: 'Show all 5 lines' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(block?.id);
  });

  it('marks the local exclusion as a warning and omits the toggle for short code', () => {
    renderView();
    const row = rows()[4] as HTMLElement;
    const badge = within(row).getByText('Not delayed (Excluded by FDT)');
    expect(badge.className).toContain('text-status-warn');
    expect(within(row).queryByRole('button', { expanded: false })).toBeNull();
  });

  it('offers Expand on short code only when the clamp clips it', () => {
    clampClips = true;
    renderView();
    const row = rows()[4] as HTMLElement;
    expect(within(row).getByRole('button', { name: 'Expand' })).toBeTruthy();
  });

  it('keeps the toggle, and focus on it, once expanding ends the clamp that offered it', () => {
    clampClips = true;
    renderView();
    const row = rows()[4] as HTMLElement;
    const expand = within(row).getByRole('button', { name: 'Expand' });
    expand.focus();
    fireEvent.click(expand);
    // Unclamped now, the block reports no clipping — the toggle must stay.
    expect(row.querySelector('[data-fdt-code-area]')?.hasAttribute('data-fdt-clamped')).toBe(false);
    expect(expand.isConnected).toBe(true);
    expect(expand.textContent).toBe('Collapse');
    expect(document.activeElement).toBe(expand);
  });

  it('marks a preview line cut at its cap with an ellipsis outside the code', () => {
    const long = `var cfg = "${'z'.repeat(PREVIEW_LINE_CHARS + 50)}";`;
    renderView(
      dataWith([
        {
          inline: true,
          content: long,
          delayed: false,
          deferred: false,
          deferredByWPR: false,
          fdtExcluded: null
        }
      ])
    );
    const row = rows()[0] as HTMLElement;
    const cut = row.querySelector('[data-fdt-code-fallback] .line[data-fdt-cut]');
    expect(cut?.textContent).toBe(long.slice(0, PREVIEW_LINE_CHARS));
    expect(within(row).getByRole('button', { name: 'Show full lines' })).toBeTruthy();
  });

  it('names each inline block by its inline ordinal', () => {
    areaScrolls = true;
    renderView();
    const labels = [...document.querySelectorAll('[data-fdt-code-area]')].map((area) =>
      area.getAttribute('aria-label')
    );
    expect(labels).toEqual(['Inline script 1', 'Inline script 2']);
    const ids = rows().map((row) => row.querySelector('[data-fdt="code-block"]')?.id);
    expect(ids.filter((id) => id !== undefined)).toHaveLength(2);
  });

  it('draws the hairline under every row but the last', () => {
    renderView();
    const all = rows();
    expect(all.slice(0, -1).every((row) => row.className.includes('border-b'))).toBe(true);
    expect(all.at(-1)?.className).not.toContain('border-b');
  });

  it('renders a blank inline script as a note, without code or copy', () => {
    renderView();
    const row = rows()[5] as HTMLElement;
    expect(row.textContent).toContain('Empty inline script');
    expect(row.querySelector('[data-fdt="code-block"]')).toBeNull();
    expect(within(row).queryByRole('button', { name: /copy/ })).toBeNull();
  });
});

describe('JavaScriptView — expand state', () => {
  /** The inline 5-line row's toggle. */
  function toggle(): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>('[data-fdt="script-code-toggle"]');
    if (!button) throw new Error('no toggle');
    return button;
  }

  it('expands to the full code and collapses back, keeping focus on the toggle', () => {
    renderView();
    const button = toggle();
    const scroll = vi.fn();
    button.scrollIntoView = scroll;
    button.focus();
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.textContent).toBe('Collapse');
    const block = document.getElementById(button.getAttribute('aria-controls') ?? '');
    expect(block?.textContent).toContain('line5();');
    expect(block?.querySelector('[data-fdt-code-area]')?.hasAttribute('data-fdt-clamped')).toBe(
      false
    );
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    expect(document.activeElement).toBe(button);
  });

  it('survives the row unmounting on scroll', () => {
    const { virtualizer } = renderView();
    fireEvent.click(toggle());
    virtualizer.setWindow([0, 2]);
    expect(document.querySelector('[data-fdt="script-code-toggle"]')).toBeNull();
    virtualizer.setWindow([0, 40]);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('is pruned when a refresh removes the row', () => {
    const { setData } = renderView();
    fireEvent.click(toggle());
    const list = scripts();
    setData(dataWith(list.slice(0, 3)));
    expect(document.querySelector('[data-fdt="script-code-toggle"]')).toBeNull();
    setData(dataWith(list));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps an expanded row and its DOM across an unchanged refresh', () => {
    const { setData } = renderView();
    fireEvent.click(toggle());
    const before = toggle();
    setData(dataWith(scripts()));
    expect(toggle()).toBe(before);
    expect(before.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('JavaScriptView — search', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('filters by the committed query, composed with the chip', () => {
    renderView();
    fireEvent.input(field(), { target: { value: 'example.test' } });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(rows()).toHaveLength(2);
    fireEvent.click(chip('delayed'));
    expect(rows()).toHaveLength(1);
    expect(document.querySelector('[data-fdt="script-results-status"]')?.textContent).toBe(
      '1 of 6 scripts shown'
    );
  });

  it('searches inline code and ignores surrounding whitespace', () => {
    renderView();
    fireEvent.input(field(), { target: { value: '  LINE4  ' } });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(rows()).toHaveLength(1);
    fireEvent.input(field(), { target: { value: '   ' } });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(rows()).toHaveLength(6);
    expect(document.querySelector('[data-fdt="script-results-status"]')?.textContent).toBe('');
  });

  it('shows a DevTools-box query in the field and clears with a cancel', () => {
    const { search } = renderView();
    search.perform('cart');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(field().value).toBe('cart');
    expect(rows()).toHaveLength(1);
    search.cancel();
    expect(field().value).toBe('');
    expect(rows()).toHaveLength(6);
  });

  it('clears on Escape in the field', () => {
    const { search } = renderView();
    fireEvent.input(field(), { target: { value: 'cart' } });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(search.query()).toBe('');
    expect(field().value).toBe('');
  });

  it('offers the way back from no matches and lands focus on the field', () => {
    renderView();
    fireEvent.input(field(), { target: { value: 'nothing-matches' } });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(screen.getByText('No matches')).toBeTruthy();
    expect(screen.getByText('Nothing matches "nothing-matches".')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Scripts' })).toBeNull();
    const clear = screen.getByRole('button', { name: 'Clear search' });
    clear.focus();
    fireEvent.click(clear);
    expect(rows()).toHaveLength(6);
    expect(document.activeElement).toBe(field());
  });
});

describe('JavaScriptView — empty page', () => {
  it('renders the empty state without filters or list', () => {
    renderView(dataWith([], false, null));
    expect(screen.getByText('No scripts on this page')).toBeTruthy();
    expect(document.querySelector('[data-fdt="filter-bar"]')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
    expect(document.querySelector('[data-fdt="script-total"]')?.textContent).toBe('0 scripts');
  });
});

describe('JavaScriptPage', () => {
  /** A data store double over a state signal. */
  function dataStore(state: Accessor<DataState>): FdtDataStore {
    return {
      state,
      start: () => undefined,
      stop: () => undefined,
      retry: () => undefined,
      reload: () => undefined
    };
  }

  it('renders the view while data is loaded, and nothing otherwise', () => {
    const [state, setState] = createSignal<DataState>({ status: 'fetching' });
    // eslint-disable-next-line solid/reactivity -- the accessor itself is handed over, read inside the page's memo
    const store = dataStore(state);
    render(() => (
      <FdtDataContext.Provider value={store}>
        <SearchContext.Provider value={createSearchStore()}>
          <JavaScriptPage />
        </SearchContext.Provider>
      </FdtDataContext.Provider>
    ));
    expect(document.querySelector('[data-fdt-page="javascript"]')).toBeNull();
    setState({ status: 'ready', data: dataWith([]), fetchedAt: 1 });
    expect(screen.getByRole('heading', { level: 1, name: 'JavaScript' })).toBeTruthy();
    setState({ status: 'refreshing', data: dataWith([]), requestedAt: 2 });
    expect(document.querySelector('[data-fdt-page="javascript"]')).not.toBeNull();
  });
});

describe('JavaScriptView — copy', () => {
  it('copies the full inline source, not the collapsed preview', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderView();
    const row = rows()[3] as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Inline script — copy' }));
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('line1();\nline2();\nline3();\nline4();\nline5();');
    });
  });
});

describe('JavaScriptView — capture bounds', () => {
  const CAPS = PAYLOAD_LIMITS.delayScripts;

  /** Data whose Delay JS row the producer marked truncated. */
  function truncatedData(list: DelayedScriptRecord[]): FdtData {
    const data = dataWith(list);
    return {
      ...data,
      wprDetections: {
        ...data.wprDetections,
        delay_js: { ...data.wprDetections.delay_js, truncated: true }
      }
    };
  }

  it('notes a list cut at its cap and floors the total', () => {
    const full = Array.from({ length: CAPS.count }, (_, i) =>
      makeDelayScript({ src: `https://example.test/${String(i)}.js` })
    );
    renderView(truncatedData(full));
    expect(document.querySelector('[data-fdt="script-list-cut"]')?.textContent).toBe(
      listCutNote(CAPS.count)
    );
    expect(listCutNote(CAPS.count)).toBe('Showing the first 5,000 scripts — the page has more.');
    expect(document.querySelector('[data-fdt="script-total"]')?.textContent).toBe('5,000+ scripts');
  });

  it('shows no cut note for a marked list below its cap', () => {
    renderView(truncatedData(scripts()));
    expect(document.querySelector('[data-fdt="script-list-cut"]')).toBeNull();
    expect(document.querySelector('[data-fdt="script-total"]')?.textContent).toBe('6 scripts');
  });

  it('marks clipped text, warns on copy, and names text the budget left out', () => {
    const big = 'x'.repeat(CAPS.content);
    const spent = Array.from({ length: CAPS.contentTotal / CAPS.content }, () => ({
      inline: true,
      content: big,
      delayed: false,
      deferred: false,
      deferredByWPR: false,
      fdtExcluded: null
    }));
    const left = { ...(spent[0] as DelayedScriptRecord), content: '' };
    renderView(truncatedData([...spent, left]));
    const first = rows()[0] as HTMLElement;
    expect(within(first).getByText('Content clipped')).toBeTruthy();
    expect(
      within(first).getByRole('button', { name: 'Clipped inline script — copy' })
    ).toBeTruthy();
    const last = rows().at(-1) as HTMLElement;
    expect(last.textContent).toContain('Content not captured (size budget)');
    expect(last.textContent).not.toContain('Empty inline script');
    expect(within(last).queryByRole('button', { name: /copy/ })).toBeNull();
  });
});

describe('JavaScriptView — identity across refreshes', () => {
  it('keeps the expanded script expanded and other rows mounted when a script lands on top', () => {
    const { setData } = renderView();
    const toggle = document.querySelector<HTMLButtonElement>('[data-fdt="script-code-toggle"]');
    if (!toggle) throw new Error('no toggle');
    fireEvent.click(toggle);
    const before = rows();
    const added = makeDelayScript({ src: 'https://example.test/new.js' });
    setData(dataWith([added, ...scripts()]));
    const after = rows();
    expect(after).toHaveLength(7);
    // Every pre-existing row is the same element, one position lower.
    expect(after.slice(1)).toEqual(before);
    expect(toggle.isConnected).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(after[4]?.getAttribute('aria-posinset')).toBe('5');
  });

  it('collapses a script whose text changed under the same key', () => {
    const { setData } = renderView();
    const toggle = document.querySelector<HTMLButtonElement>('[data-fdt="script-code-toggle"]');
    if (!toggle) throw new Error('no toggle');
    fireEvent.click(toggle);
    const list = scripts();
    const edited = list.map((script, index) =>
      index === 3 ? { ...script, delayed: false } : script
    );
    setData(dataWith(edited));
    const next = document.querySelector<HTMLButtonElement>('[data-fdt="script-code-toggle"]');
    expect(next?.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('JavaScriptView — keyboard and announcements', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('leaves Escape alone when the field is empty, takes it when not', () => {
    renderView();
    const idle = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    field().dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);
    fireEvent.input(field(), { target: { value: 'cart' } });
    const busy = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    field().dispatchEvent(busy);
    expect(busy.defaultPrevented).toBe(true);
    expect(field().value).toBe('');
    const other = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    fireEvent.input(field(), { target: { value: 'cart' } });
    field().dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  it('announces a committed query, and refreshes the count silently on a data refresh', () => {
    const { setData } = renderView();
    const region = (): HTMLElement | null =>
      document.querySelector<HTMLElement>('[data-fdt="script-results-status"]');
    expect(region()?.textContent).toBe('');
    fireEvent.input(field(), { target: { value: 'example.test' } });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(region()?.textContent).toBe('2 of 6 scripts shown');
    expect(region()?.getAttribute('aria-live')).toBe('polite');
    setData(dataWith(scripts().slice(0, 1)));
    // Current, but muted: a refresh is not the user's action.
    expect(region()?.textContent).toBe('1 of 1 script shown');
    expect(region()?.getAttribute('aria-live')).toBe('off');
    fireEvent.click(chip('delayed'));
    expect(region()?.getAttribute('aria-live')).toBe('polite');
  });

  it('lands focus on the "all" chip after Show all', () => {
    renderView();
    fireEvent.click(chip('external'));
    fireEvent.input(field(), { target: { value: 'nothing-matches' } });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    const showAll = screen.getByRole('button', { name: 'Show all' });
    showAll.focus();
    fireEvent.click(showAll);
    expect(document.activeElement).toBe(chip('all'));
  });
});
