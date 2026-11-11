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
import { createCurrentMatch } from '../current-match';
import { JAVASCRIPT_TAB_LABELS, JavaScriptPage, JavaScriptView, listCutNote } from './page';
import { PREVIEW_LINE_CHARS } from './script-view';
import { HIGHLIGHT_MAX_CHARS } from '../../../../components/ui/code-block';
import type { CodeBlockSeams } from './script-row';
import {
  readScriptSourceChunk,
  SCRIPT_SOURCE_CHUNK_CHARS,
  type ScriptSourceRequest
} from '../../../../lib/messaging/script-source';
import type { TabAsks } from '../../../../lib/messaging/tab-asks';
import { parseTabRelayRequest, type TabRelayRequest } from '../../../../lib/messaging/tab-relay';
import { relayTabAsks } from '../../../../lib/messaging/tab-relay-client';
import { createSourceChunkReader } from './source-chunk-reader';
import { boundWprDetections } from '../../../../lib/messaging/payload-bounds';
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
  /** Scroll orders the double received, in order (an opt-in assertion read). */
  landed: number[];
  /** Drop the record at a boundary the test owns (e.g. a remount). */
  clearScrolls: () => void;
} {
  // A bounded window, as a real list renders: a 5,000-row page mounts 40 rows.
  const [range, setWindow] = createSignal<[number, number]>([0, 40]);
  const landed: number[] = [];
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
    measureElement: () => undefined,
    scrollToIndex: (index) => {
      landed.push(index);
    }
  });
  return { factory, setWindow, landed, clearScrolls: () => landed.splice(0, landed.length) };
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
      fdtExcluded: null,
      minifyAttribute: false
    },
    {
      inline: true,
      content: 'tiny();',
      delayed: false,
      deferred: false,
      deferredByWPR: false,
      fdtExcluded: 'delay_js',
      minifyAttribute: false
    },
    {
      inline: true,
      content: '',
      delayed: false,
      deferred: false,
      deferredByWPR: false,
      fdtExcluded: null,
      minifyAttribute: false
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
function renderView(
  initial: FdtData = dataWith(scripts()),
  readSourceChunk?: (request: ScriptSourceRequest) => Promise<unknown>
): {
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
      readSourceChunk={readSourceChunk}
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

  it('says "Simulated", never "Not detected", while a verified simulation runs Delay JS', () => {
    const data = dataWith(scripts(), false, null);
    const simulated = { ...data.wprDetections.delay_js, simulation: 'simulated' as const };
    renderView(makeFdtData({ wprDetections: { ...data.wprDetections, delay_js: simulated } }));
    const summary = document.querySelector<HTMLElement>('[data-fdt="script-summary"]');
    expect(summary?.textContent).toContain('Simulated');
    expect(summary?.textContent).not.toContain('Not detected');
    expect(summary?.textContent).not.toContain('Version');
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
      minified: '0',
      combined: '0',
      excluded: '1',
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
    // Negative states are no chips any more; WP Rocket's defer shows by its source look.
    expect(row.textContent).not.toContain('Not delayed');
    const deferred = row.querySelector<HTMLElement>('[data-fdt-state="deferred"]');
    expect(deferred?.textContent).toBe('Deferred');
    expect(deferred?.dataset.fdtSource).toBe('wp-rocket');
    expect(deferred?.querySelector('svg')?.classList.contains('lucide-rocket')).toBe(true);
    // The file name leads; the full URL stays the link beneath it.
    expect(row.querySelector('[data-fdt="resource-name"]')?.textContent).toBe('cart.js');
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
    const badge = within(row).getByText('Excluded');
    expect(badge.className).toContain('text-status-warn');
    expect(badge.getAttribute('title')).toBe('Excluded by FDT from Delay JavaScript execution');
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
          fdtExcluded: null,
          minifyAttribute: false
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

describe('JavaScriptView — state chips', () => {
  const BUNDLE = 'https://s.test/wp-content/cache/min/1/5c03bce63bb3260466706a046cb00086.js';
  const MINIFIED = 'https://s.test/wp-content/cache/min/1/wp-includes/js/a.js';

  /** Page data whose detection verdicts the chips read. */
  function factsData(
    list: DelayedScriptRecord[],
    rows: Partial<FdtData['wprDetections']>
  ): FdtData {
    const data = dataWith(list);
    return { ...data, wprDetections: { ...data.wprDetections, ...rows } };
  }

  /** The visible state words of one row, in order. */
  function stateWords(row: HTMLElement): string[] {
    return [...row.querySelectorAll('[data-fdt="state-chip"]')].map((chip) => chip.textContent);
  }

  /** The sources of one row's visible chips, in order. */
  function stateSources(row: HTMLElement): (string | undefined)[] {
    return [...row.querySelectorAll<HTMLElement>('[data-fdt="state-chip"]')].map(
      (chip) => chip.dataset.fdtSource
    );
  }

  const meta = (present: boolean) => ({ present, source: 'meta' as const });

  it('reads Combined only on a meta-declared Combine JS page, else Minified (no meta)', () => {
    const list = [makeDelayScript({ src: BUNDLE, delayed: false, minifyAttribute: true })];
    const wpr = { ...makeFdtData().wprDetections.wpr, present: true };
    const { setData } = renderView(
      factsData(list, { wpr, minify_js: meta(false), minify_concatenate_js: meta(true) })
    );
    expect(stateWords(rows()[0] as HTMLElement)).toEqual(['Combined']);
    expect(chip('combined').querySelector('[data-fdt-filter-count]')?.textContent).toBe('1');
    // The same bundle on a page without the meta: Minify JS by footprint, no Combine JS.
    setData(
      factsData(list, {
        wpr,
        minify_js: { present: true, source: 'footprint' },
        minify_concatenate_js: { present: false }
      })
    );
    expect(stateWords(rows()[0] as HTMLElement)).toEqual(['Minified']);
    expect(chip('combined').disabled).toBe(true);
    // Refuted: neither (Minify JS refuted too, as the meta says when Combine JS is off).
    setData(factsData(list, { wpr, minify_js: meta(false), minify_concatenate_js: meta(false) }));
    expect(stateWords(rows()[0] as HTMLElement)).toEqual([]);
  });

  it('a minified, delayed, WP Rocket-deferred row shows three chips, most important first', () => {
    const list = [
      makeDelayScript({
        src: MINIFIED,
        delayed: true,
        deferred: true,
        deferredByWPR: true,
        originalType: 'module'
      })
    ];
    renderView(factsData(list, { minify_js: meta(true) }));
    const row = rows()[0] as HTMLElement;
    expect(stateWords(row)).toEqual(['Delayed', 'Deferred', 'Minified']);
    expect(stateSources(row)).toEqual(['wp-rocket', 'wp-rocket', 'wp-rocket']);
    expect(row.querySelector('[data-fdt="state-chip-overflow"]')).toBeNull();
    const detail = row.querySelector('[data-fdt="script-original-type"]');
    expect(detail?.textContent).toBe('type: module');
    expect(chip('minified').querySelector('[data-fdt-filter-count]')?.textContent).toBe('1');
  });

  it('attributes a verified simulation’s defer and delay to the simulation, re-deriving on change', () => {
    const list = [makeDelayScript({ delayed: true, deferred: true, deferredByWPR: true })];
    const data = dataWith(list);
    const simulated = 'simulated' as const;
    const { setData } = renderView(
      factsData(list, {
        defer_all_js: { ...data.wprDetections.defer_all_js, simulation: simulated }
      })
    );
    expect(stateWords(rows()[0] as HTMLElement)).toEqual(['Delayed', 'Deferred']);
    expect(stateSources(rows()[0] as HTMLElement)).toEqual(['wp-rocket', 'simulated']);
    // Delay JS simulated too: Delayed is the simulation's (dashed + flask), never WP Rocket's.
    setData(
      factsData(list, {
        delay_js: { ...data.wprDetections.delay_js, simulation: simulated },
        defer_all_js: { ...data.wprDetections.defer_all_js, simulation: simulated }
      })
    );
    const row = rows()[0] as HTMLElement;
    expect(stateSources(row)).toEqual(['simulated', 'simulated']);
    expect(row.querySelector('[data-fdt-state="delayed"] svg')?.classList).toContain(
      'lucide-flask-conical'
    );
    // An unverified marker proves nothing: the footprints stay WP Rocket's, flagged on hover.
    setData(
      factsData(list, {
        delay_js: { ...data.wprDetections.delay_js, simulation: 'unverified' },
        defer_all_js: { ...data.wprDetections.defer_all_js, simulation: 'unverified' }
      })
    );
    const flagged = rows()[0] as HTMLElement;
    expect(stateSources(flagged)).toEqual(['wp-rocket', 'wp-rocket']);
    expect(
      [...flagged.querySelectorAll('[data-fdt="state-chip"] [title]')].map((chip) =>
        chip.getAttribute('title')
      )
    ).toEqual([
      'Delayed by WP Rocket (Delay JavaScript execution) (simulation not verified)',
      'Deferred by WP Rocket (Load JavaScript deferred) (simulation not verified)'
    ]);
  });

  it('shows the source legend once, above the rows', () => {
    renderView();
    const legends = document.querySelectorAll('[data-fdt="state-source-legend"]');
    expect(legends).toHaveLength(1);
    expect(legends[0]?.textContent).toBe('WP RocketSimulated by FDTExcluded by FDTPage');
  });

  it('the Excluded filter lists the rows FDT kept out of a feature', () => {
    renderView();
    fireEvent.click(chip('excluded'));
    expect(rows()).toHaveLength(1);
    expect(stateWords(rows()[0] as HTMLElement)).toEqual(['Excluded']);
  });

  it('a plain row renders no state chip and no type detail', () => {
    renderView(dataWith([makeDelayScript({ delayed: false })]));
    const row = rows()[0] as HTMLElement;
    expect(stateWords(row)).toEqual([]);
    expect(row.querySelector('[data-fdt="script-original-type"]')).toBeNull();
  });
});

describe('JavaScriptView — compact code rows', () => {
  /** The row's one wrap toggle. */
  function wrap(row: HTMLElement): HTMLButtonElement {
    return within(row).getByRole('button', { name: 'Wrap' });
  }

  it('owns the language caption and exactly one Wrap on every code row', () => {
    renderView();
    // Every row with code: one caption ("javascript · N lines"), one Wrap.
    const inline = [rows()[3] as HTMLElement, rows()[4] as HTMLElement];
    for (const row of inline) {
      expect(row.textContent).toContain(`javascript ·`);
      expect(within(row).getAllByRole('button', { name: 'Wrap' })).toHaveLength(1);
    }
    // The first row's caption names its real line count.
    expect(within(rows()[3] as HTMLElement).getByText('javascript · 5 lines')).toBeTruthy();
    // External rows have no caption, no Wrap: the URL row keeps its copy only.
    const external = rows()[1] as HTMLElement;
    expect(external.textContent).not.toContain('javascript ·');
    expect(within(external).queryByRole('button', { name: 'Wrap' })).toBeNull();
    // A blank inline row says its empty note; no code, no caption, no Wrap.
    const blank = rows()[5] as HTMLElement;
    expect(blank.textContent).not.toContain('javascript ·');
    expect(within(blank).queryByRole('button', { name: 'Wrap' })).toBeNull();
  });

  it('wraps and unwraps the block through the page-owned state', () => {
    renderView();
    const row = rows()[3] as HTMLElement;
    const button = wrap(row);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(row.querySelector('[data-fdt-code-area]')?.className).toContain('whitespace-pre-wrap');
    fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the wrapped state when the row remounts on scroll', () => {
    const { virtualizer } = renderView();
    fireEvent.click(wrap(rows()[3] as HTMLElement));
    virtualizer.setWindow([0, 2]); // the wrapped row scrolls out of range
    expect(document.querySelector('[data-fdt="script-code-wrap"]')).toBeNull();
    virtualizer.setWindow([0, 40]);
    const row = rows()[3] as HTMLElement;
    expect(wrap(row).getAttribute('aria-pressed')).toBe('true');
    expect(row.querySelector('[data-fdt-code-area]')?.className).toContain('whitespace-pre-wrap');
    // Other rows never borrowed the flag.
    expect(wrap(rows()[4] as HTMLElement).getAttribute('aria-pressed')).toBe('false');
  });

  it('prunes the wrapped state when a refresh removes the row', () => {
    const { setData } = renderView();
    fireEvent.click(wrap(rows()[3] as HTMLElement));
    const list = scripts();
    setData(dataWith(list.slice(0, 3)));
    setData(dataWith(list));
    expect(wrap(rows()[3] as HTMLElement).getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the wrap flag across an expand/collapse round trip', () => {
    renderView();
    const row = rows()[3] as HTMLElement;
    fireEvent.click(wrap(row));
    fireEvent.click(within(row).getByRole('button', { name: 'Show all 5 lines' }));
    expect(row.querySelector('[data-fdt-code-area]')?.className).toContain('whitespace-pre-wrap');
    fireEvent.click(within(row).getByRole('button', { name: 'Collapse' }));
    expect(wrap(row).getAttribute('aria-pressed')).toBe('true');
    expect(row.querySelector('[data-fdt-code-area]')?.className).toContain('whitespace-pre-wrap');
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
      'Showing 1 of 6 scripts'
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
    // The count line is truthful always: an unfiltered list says "all".
    expect(document.querySelector('[data-fdt="script-results-status"]')?.textContent).toBe(
      'Showing all 6 scripts'
    );
  });

  it('drops a pending field echo when a cancel lands while the query is already empty', () => {
    const { search } = renderView();
    // Typing into the field with the committed query empty: the echo is
    // uncommitted (the debounce has not landed).
    fireEvent.input(field(), { target: { value: 'pending' } });
    expect(rows()).toHaveLength(6);
    search.cancel(); // from the DevTools side; the committed query never left ''
    expect(field().value).toBe('');
    // The cancelled burst commits nothing: the list was never narrowed twice.
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
    expect(search.query()).toBe('');
    expect(rows()).toHaveLength(6);
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

describe('JavaScriptView — find navigation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  /** The row carrying the find's current match, if any. */
  function currentRow(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="listitem"][aria-current="true"]');
  }

  it('reports the matching-row count and marks the cursor’s row (only for a live find)', () => {
    const { search } = renderView();
    search.perform('example.test');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(rows()).toHaveLength(2);
    expect(search.matchCount()).toBe(2);
    expect(currentRow()).toBe(rows()[0]); // the cursor sits on the first match

    search.perform(' ');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(rows()).toHaveLength(6);
    // No find is active: no count to navigate, no row named.
    expect(search.matchCount()).toBe(0);
    expect(currentRow()).toBeNull();
  });

  it('steps next/previous over the match set with both wraps', () => {
    const { search } = renderView();
    search.perform('example.test');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(currentRow()).toBe(rows()[0]);
    search.advance(1);
    expect(currentRow()).toBe(rows()[1]); // forward step
    search.advance(1);
    expect(currentRow()).toBe(rows()[0]); // forward wrap: last → first
    search.advance(-1);
    expect(currentRow()).toBe(rows()[1]); // backward wrap: first → last
    search.advance(-1);
    expect(currentRow()).toBe(rows()[0]);
  });

  it('a refresh shrinking the set re-reports and hides an out-of-range cursor; the step recovers', () => {
    const { search, setData } = renderView();
    search.perform('example.test');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    search.advance(1);
    expect(currentRow()).toBe(rows()[1]);

    // A refresh leaves one matching script (jquery.js is gone): the cursor
    // now points past the set — no row is the match; the count repairs.
    setData(dataWith([makeDelayScript({ src: 'https://example.test/cart.js', delayed: false })]));
    expect(search.matchCount()).toBe(1);
    expect(currentRow()).toBeNull();

    search.advance(1); // the wrap math snaps the stale cursor into range
    expect(currentRow()).toBe(rows()[0]); // the one matching row
  });

  it('cancel clears the find; unmount clears the page’s own report', () => {
    const { search } = renderView();
    search.perform('cart');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(search.matchCount()).toBe(1);
    expect(currentRow()).toBe(rows()[0]); // the only rendered match

    search.cancel();
    expect(search.matchCount()).toBe(0);
    expect(currentRow()).toBeNull();

    // Unmounting un-reports (the disposed page leaves no stale count).
    cleanup();
    expect(search.matchCount()).toBe(0);
  });

  it('a remount under a live find re-reports and marks, but never re-anchors', () => {
    // The refresh/retry lifecycle: the same store under a fresh page body.
    // The cursor (and live query) survive; the mount-time request is not a
    // scroll order (the wrapper's scrollTo contract), so the marker shows
    // wherever the fresh window is, and the next find event is the anchor.
    const search = createSearchStore();
    const virtualizer = windowedVirtualizer();
    const [data, setData] = createSignal(dataWith(scripts()));
    const mount = (): void => {
      render(() => (
        <JavaScriptView
          data={data}
          search={search}
          createVirtualizer={virtualizer.factory}
          codeBlock={CODE_SEAMS}
        />
      ));
    };

    mount();
    search.perform('example.test');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(rows()).toHaveLength(2);
    cleanup();
    expect(search.matchCount()).toBe(0);
    setData(dataWith(scripts())); // the retry re-feeds the same inventory

    virtualizer.clearScrolls(); // the remount begins here — expect silence
    mount();
    expect(search.matchCount()).toBe(2);
    expect(currentRow()).toBe(rows()[0]); // the cursor survives and drives the marker
    expect(virtualizer.landed).toEqual([]);
    search.advance(1);
    expect(virtualizer.landed).toEqual([1]); // the next find event re-anchors
    expect(currentRow()).toBe(rows()[1]);
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

describe('JavaScriptView — views', () => {
  it('opens on the served scripts and swaps in the Runtime states section on its tab', () => {
    const [data] = createSignal(dataWith(scripts()));
    render(() => (
      <JavaScriptView
        data={data}
        search={createSearchStore()}
        createVirtualizer={windowedVirtualizer().factory}
        codeBlock={CODE_SEAMS}
        runtimeStates={() => <p data-fdt-runtime-double>Runtime states double</p>}
      />
    ));
    const served = screen.getByRole('tab', { name: JAVASCRIPT_TAB_LABELS.served });
    expect(served.getAttribute('aria-selected')).toBe('true');
    expect(rows()).toHaveLength(6);
    expect(document.querySelector('[data-fdt-runtime-double]')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: JAVASCRIPT_TAB_LABELS.runtime }));
    // One list (and one find binding) at a time: the served list leaves.
    expect(document.querySelector('[data-fdt-runtime-double]')).not.toBeNull();
    expect(rows()).toHaveLength(0);
    expect(document.querySelector('[data-fdt="script-summary"]')).toBeNull();
    fireEvent.click(served);
    expect(rows()).toHaveLength(6);
    expect(document.querySelector('[data-fdt-runtime-double]')).toBeNull();
  });
});

describe('JavaScriptView — find across the views', () => {
  /** The other view's double: it binds the find as a shown list does, reporting `count` matches. */
  function findingRuntime(search: SearchStore, count: number) {
    return () => {
      createCurrentMatch(search, () => count);
      return <p data-fdt-runtime-double>Runtime states double</p>;
    };
  }

  /** Render the view with a find-binding Runtime states double. */
  function renderTabs(list: DelayedScriptRecord[] = scripts()) {
    vi.useFakeTimers();
    const search = createSearchStore();
    const [data, setData] = createSignal(dataWith(list));
    render(() => (
      <JavaScriptView
        data={data}
        search={search}
        createVirtualizer={windowedVirtualizer().factory}
        codeBlock={CODE_SEAMS}
        runtimeStates={findingRuntime(search, 5)}
      />
    ));
    const tab = (name: 'served' | 'runtime'): void => {
      fireEvent.click(screen.getByRole('tab', { name: JAVASCRIPT_TAB_LABELS[name] }));
    };
    return { search, setData, tab };
  }

  /** The row the find's cursor sits on. */
  function cursorRow(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="listitem"][aria-current="true"]');
  }

  it('counts the served matches again after a round trip through Runtime states, and steps them', () => {
    const { search, tab } = renderTabs();
    search.perform('example.test');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(search.matchCount()).toBe(2);
    tab('runtime');
    expect(search.matchCount()).toBe(5); // only the shown list reports
    tab('served');
    expect(search.matchCount()).toBe(2);
    expect(cursorRow()).toBe(rows()[0]);
    search.advance(1);
    expect(cursorRow()).toBe(rows()[1]);
    search.advance(-1);
    expect(cursorRow()).toBe(rows()[0]);
  });

  it('lets a data refresh while Runtime states is shown leave its count alone', () => {
    const { search, setData, tab } = renderTabs();
    search.perform('example.test');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    tab('runtime');
    setData(dataWith([makeDelayScript({ src: 'https://example.test/only.js', delayed: true })]));
    expect(search.matchCount()).toBe(5);
    tab('served');
    expect(search.matchCount()).toBe(1);
    expect(rows()).toHaveLength(1);
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

describe('JavaScriptView — complete snapshot copy', () => {
  it('copies a multi-chunk source through the background relay (no tabs API)', async () => {
    const snapshotId = 'fedcba98765432100123456789abcdef';
    // Three chunks: the relay carries every segment, the last one partial.
    const source = 'x'.repeat(2 * SCRIPT_SOURCE_CHUNK_CHARS + 123);
    const raw = [makeDelayScript({ inline: true, src: undefined, content: source })];
    const data = dataWith(raw);
    const bounded = {
      ...data,
      scriptSnapshotId: snapshotId,
      wprDetections: boundWprDetections(data.wprDetections)
    };
    // The background's side, contract-true: validate, then forward to the tab.
    const tab: TabAsks = {
      processPageData: () => Promise.resolve(true),
      getFdtData: () => Promise.resolve(null),
      getScriptSourceChunk: (_tabId, request) =>
        Promise.resolve(readScriptSourceChunk(raw, snapshotId, request)),
      startRucssTest: () => Promise.resolve(null),
      applyRucssTest: () => Promise.resolve(null),
      runBeaconTest: () => Promise.resolve(null),
      runLcpAnalysis: () => Promise.resolve(null),
      getScriptRuntimeStatuses: () => Promise.resolve(null),
      getCurrentVisitVitals: () => Promise.resolve(null),
      listPageStyles: () => Promise.resolve(null),
      listPageStylesheets: () => Promise.resolve(null)
    };
    const relayed: TabRelayRequest[] = [];
    const reader = createSourceChunkReader({
      asks: () =>
        relayTabAsks(async (request) => {
          relayed.push(request);
          const valid = parseTabRelayRequest(request);
          return valid === null
            ? { ok: false, failure: 'invalid-request' }
            : { ok: true, answer: await valid.forward(tab) };
        }),
      inspectedTabId: () => 9
    });
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderView(bounded, reader);
    fireEvent.click(
      within(rows()[0] as HTMLElement).getByRole('button', { name: 'Inline script — copy' })
    );
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(source);
    });
    expect(relayed.map((request) => [request.tabId, request.ask])).toEqual([
      [9, 'getScriptSourceChunk'],
      [9, 'getScriptSourceChunk'],
      [9, 'getScriptSourceChunk']
    ]);
  });

  it('copies the complete captured inline content and URL after real upstream truncation', async () => {
    const snapshotId = '12345678123412341234123456789abc';
    const source =
      '/*' + 'a'.repeat(PAYLOAD_LIMITS.delayScripts.content + 1) + '🛰️*/\r\n// final...';
    const url = 'https://example.test/script.js?q=' + 'x'.repeat(5000) + '&exact=%20#end...';
    const raw = [
      makeDelayScript({ inline: true, src: undefined, content: source }),
      makeDelayScript({ src: url })
    ];
    const data = dataWith(raw);
    const bounded = {
      ...data,
      scriptSnapshotId: snapshotId,
      wprDetections: boundWprDetections(data.wprDetections)
    };
    expect(bounded.wprDetections.delay_js.scripts[0]?.content?.length).toBeLessThan(source.length);
    expect(bounded.wprDetections.delay_js.scripts[1]?.src?.length).toBeLessThan(url.length);
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderView(bounded, (request) =>
      Promise.resolve(readScriptSourceChunk(raw, snapshotId, request))
    );
    fireEvent.click(
      within(rows()[0] as HTMLElement).getByRole('button', { name: 'Inline script — copy' })
    );
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(source);
    });
    fireEvent.click(
      within(rows()[1] as HTMLElement).getByRole('button', { name: 'Script URL — copy' })
    );
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(url);
    });
    expect(rows()[0]?.textContent.length).toBeLessThan(2000);
  });

  it('never silently copies bounded text from a payload without source provenance', async () => {
    const data = dataWith([
      makeDelayScript({
        inline: true,
        src: undefined,
        content: 'a'.repeat(PAYLOAD_LIMITS.delayScripts.content)
      })
    ]);
    data.wprDetections.delay_js.truncated = true;
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderView(data);
    const button = within(rows()[0] as HTMLElement).getByRole('button', {
      name: 'Inline script — copy'
    });
    fireEvent.click(button);
    await vi.waitFor(() => {
      expect(button.hasAttribute('disabled')).toBe(false);
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies full content when the entire inline inventory budget was spent before its row', async () => {
    const snapshotId = '12345678123412341234123456789abc';
    const content = 'a'.repeat(PAYLOAD_LIMITS.delayScripts.content);
    const raw = Array.from({ length: 16 }, () =>
      makeDelayScript({ inline: true, src: undefined, content })
    );
    raw.push(makeDelayScript({ inline: true, src: undefined, content: 'after the budget 🛰️...' }));
    const data = dataWith(raw);
    const bounded = {
      ...data,
      scriptSnapshotId: snapshotId,
      wprDetections: boundWprDetections(data.wprDetections)
    };
    expect(bounded.wprDetections.delay_js.scripts[16]?.content).toBe('');
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderView(bounded, (request) =>
      Promise.resolve(readScriptSourceChunk(raw, snapshotId, request))
    );
    fireEvent.click(
      within(rows()[16] as HTMLElement).getByRole('button', { name: 'Inline script — copy' })
    );
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('after the budget 🛰️...');
    });
  });

  it('keeps the current document index when unchanged row objects survive insertions', async () => {
    const snapshotId = '12345678123412341234123456789abc';
    const read = vi.fn(() => Promise.resolve({ status: 'ok', text: 'current', total: 7 }));
    const data = {
      ...dataWith([makeDelayScript({ src: 'first.js' })]),
      scriptSnapshotId: snapshotId
    };
    const { setData } = renderView(data, read);
    setData({
      ...dataWith([makeDelayScript({ src: 'new.js' }), makeDelayScript({ src: 'first.js' })]),
      scriptSnapshotId: snapshotId
    });
    fireEvent.click(
      within(rows()[1] as HTMLElement).getByRole('button', { name: 'Script URL — copy' })
    );
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalledWith({ snapshotId, scriptIndex: 1, offset: 0 });
    });
  });
});

describe('JavaScriptView — very large scripts', () => {
  it('expands to the first part of a script past the render limit, copying the whole', async () => {
    const big = Array.from(
      { length: 2_000 },
      (_, i) => `step(${String(i)}); // ${'c'.repeat(10)}`
    ).join('\n');
    expect(big.length).toBeGreaterThan(HIGHLIGHT_MAX_CHARS);
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderView(
      dataWith([
        {
          inline: true,
          content: big,
          delayed: false,
          deferred: false,
          deferredByWPR: false,
          fdtExcluded: null,
          minifyAttribute: false
        }
      ])
    );
    const row = rows()[0] as HTMLElement;
    expect(row.querySelector('[data-fdt="script-expanded-cut"]')).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: /Show all/ }));
    const shown = row.querySelector('[data-fdt-code-fallback]')?.textContent ?? '';
    expect(shown).toBe(big.slice(0, HIGHLIGHT_MAX_CHARS));
    expect(row.querySelector('[data-fdt="script-expanded-cut"]')?.textContent).toBe(
      'Showing the first 20,000 characters — copy gets the full script.'
    );
    fireEvent.click(within(row).getByRole('button', { name: 'Inline script — copy' }));
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(big);
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
    expect(listCutNote(CAPS.count)).toBe('Showing the first 5,000 scripts — more may exist.');
    expect(document.querySelector('[data-fdt="script-total"]')?.textContent).toBe('5,000+ scripts');
  });

  it('shows no cut note for a marked list below its cap', () => {
    renderView(truncatedData(scripts()));
    expect(document.querySelector('[data-fdt="script-list-cut"]')).toBeNull();
    expect(document.querySelector('[data-fdt="script-total"]')?.textContent).toBe('6 scripts');
  });

  it('marks bounded text and offers full-source copy even when the inventory budget left text out', () => {
    const big = 'x'.repeat(CAPS.content);
    const spent = Array.from({ length: CAPS.contentTotal / CAPS.content }, () => ({
      inline: true,
      content: big,
      delayed: false,
      deferred: false,
      deferredByWPR: false,
      fdtExcluded: null,
      minifyAttribute: false
    }));
    const left = { ...(spent[0] as DelayedScriptRecord), content: '' };
    renderView(truncatedData([...spent, left]));
    const first = rows()[0] as HTMLElement;
    expect(within(first).getByText('Content clipped')).toBeTruthy();
    expect(within(first).getByRole('button', { name: 'Inline script — copy' })).toBeTruthy();
    const last = rows().at(-1) as HTMLElement;
    expect(last.textContent).toContain('Content not captured (size budget)');
    expect(last.textContent).not.toContain('Empty inline script');
    expect(within(last).getByRole('button', { name: 'Inline script — copy' })).toBeTruthy();
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
    // Truthful from mount (rendered content; a live region announces only changes).
    expect(region()?.textContent).toBe('Showing all 6 scripts');
    expect(region()?.getAttribute('aria-live')).toBe('polite');
    fireEvent.input(field(), { target: { value: 'example.test' } });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(region()?.textContent).toBe('Showing 2 of 6 scripts');
    expect(region()?.getAttribute('aria-live')).toBe('polite');
    setData(dataWith(scripts().slice(0, 1)));
    // Current, but muted: a refresh is not the user's action.
    expect(region()?.textContent).toBe('Showing all 1 script');
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
