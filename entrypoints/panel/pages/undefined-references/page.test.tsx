/**
 * The page over the shell's contexts (data, search, detail presence): one
 * body per state (trigger conditions through real data shapes), the failure
 * notice over the unsearched words with Retry and its focus hand-off, the
 * calm list's rows (name, count, preview) and their detail (pane and drill),
 * live updates (append in place, DOM and focus kept, one polite
 * announcement), a same-page data refresh that keeps rows, the open detail
 * and focus, the search, the rescan control's busy/done feedback and the
 * stale-scripts hint. User-facing copy is pinned literally.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOTION_REVEAL } from '../../../../components/ui/classes';
import { toast, toastItems } from '../../../../components/ui/toast-store';
import { PAYLOAD_LIMITS } from '../../../../lib/messaging/payload-bounds';
import type { InlineScriptSource, ScriptAsset } from '../../../../lib/panel/undefined-refs';
import { UNDEFINED_REFERENCE_EXTERNAL_ERROR } from '../../../../lib/wp-rocket/constants';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import type { DataState } from '../../state/fdt-state-machine';
import { makeDelayScript, makeFdtData } from '../../state/fixtures';
import { createDetailPresence, DetailPresenceContext } from '../../state/detail-presence';
import { SEARCH_DEBOUNCE_MS, createSearchStore, type SearchStore } from '../../state/search';
import { FdtDataContext, SearchContext, type FdtDataStore } from '../../state/use-fdt-data';
import {
  installFakeResizeObserver,
  type FakeResizeObservers
} from '../resource-list/fake-resize-observer';
import { calmRowClass } from '../resource-list/list-row';
import { renderWindowedRows } from '../resource-list/page-harness';
import type { InspectedScripts } from './inspected-scripts';
import { UndefinedReferencesPage } from './page';

const PAGE = 'https://x.test';
const URL_A = 'https://x.test/wp-content/plugins/p/a.js';
const ASSETS: ScriptAsset[] = [
  { origin: { kind: 'url', url: URL_A }, content: 'var alpha = 1;' },
  { origin: { kind: 'inline' }, content: 'beta = 2;' }
];

let observers: FakeResizeObservers;

beforeEach(() => {
  toast.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  observers = installFakeResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  toast.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Let promise chains (reads, the search loop) run to quiescence. */
async function flush(): Promise<void> {
  for (let i = 0; i < 60; i += 1) await Promise.resolve();
}

/** A delay-JS detection row, present or not. */
function delayJs(present: boolean): FdtData['wprDetections']['delay_js'] {
  return {
    present,
    scripts: [makeDelayScript({ inline: true, content: 'beta = 2;' })],
    version: null,
    delayedScripts: present ? 1 : 0
  };
}

/** Page data with the fields this page reads. */
function pageData(options: { words?: string[]; delay?: boolean; loaded?: boolean } = {}): FdtData {
  const base = makeFdtData();
  return makeFdtData({
    allScriptsLoaded: options.loaded ?? false,
    undefinedReferencesOnPage: options.words ?? [],
    wprDetections: { ...base.wprDetections, delay_js: delayJs(options.delay ?? false) }
  });
}

interface MountOptions {
  data: FdtData;
  /** Render as a browser that cannot list scripts. */
  unsupported?: boolean;
}

/** Render the page inside a fake shell data store; returns its controls. */
function mount(options: MountOptions) {
  const [state, setState] = createSignal<DataState>({
    status: 'ready',
    data: options.data,
    fetchedAt: 1
  });
  const store: FdtDataStore = {
    state,
    start: () => undefined,
    stop: () => undefined,
    retry: () => undefined,
    reload: () => undefined
  };
  const reads: {
    inline: readonly InlineScriptSource[];
    resolve: (a: ScriptAsset[], unreadable?: number) => void;
    reject: (c: unknown) => void;
  }[] = [];
  const added: ((url: string) => void)[] = [];
  const inspected: InspectedScripts = {
    load: (inline) =>
      new Promise((resolve, reject) => {
        reads.push({
          inline,
          resolve: (assets, unreadable = 0) => {
            resolve({ assets, unreadable });
          },
          reject
        });
      }),
    readPageOrigin: () => Promise.resolve(PAGE),
    watchAddedScripts: (onAdded) => {
      added.push(onAdded);
      return () => undefined;
    }
  };
  // The rows' copy routes through the shared control's default clipboard;
  // the stub records what the rows write without touching the platform.
  const writeText = vi.fn<() => Promise<void>>(() => Promise.resolve());
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const search = createSearchStore();
  render(() => (
    <FdtDataContext.Provider value={store}>
      <SearchContext.Provider value={search}>
        <DetailPresenceContext.Provider value={createDetailPresence(() => 'undefined-references')}>
          <UndefinedReferencesPage
            deps={{
              inspected: options.unsupported ? null : inspected,
              yieldToMain: () => Promise.resolve()
            }}
            createVirtualizer={renderWindowedRows}
            openResource={null}
          />
        </DetailPresenceContext.Provider>
      </SearchContext.Provider>
    </FdtDataContext.Provider>
  ));
  /** Patch the loaded data like a push does (same fetch, same stamp). */
  const push = (patch: Partial<FdtData>): void => {
    const current = state();
    if (current.status !== 'ready') throw new Error('push needs a ready state');
    setState({ ...current, data: { ...current.data, ...patch } });
  };
  /** A soft refresh of the same page: refreshing, then ready with a new stamp. */
  const refresh = (data: FdtData, fetchedAt: number): void => {
    const current = state();
    if (current.status !== 'ready') throw new Error('refresh needs a ready state');
    setState({ status: 'refreshing', data: current.data, requestedAt: fetchedAt });
    setState({ status: 'ready', data, fetchedAt });
  };
  return { reads, added, push, refresh, writeText, search };
}

/** Mount controls (see {@link mount}). */
type Mounted = ReturnType<typeof mount>;

/** The page's polite status line. */
function statusLine(): HTMLElement {
  const node = document.querySelector<HTMLElement>('[data-fdt="undefined-refs-status"]');
  if (!node) throw new Error('no status line');
  return node;
}

/** The summary line's text. */
function summary(): string | null | undefined {
  return document.querySelector('[data-fdt="undefined-refs-summary"]')?.textContent;
}

/**
 * Commit a search query (the store debounces; the caller runs fake timers).
 *
 * @param search The page's search store.
 * @param query The raw query.
 */
function commit(search: SearchStore, query: string): void {
  search.perform(query);
  vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
}

/** Every rendered word row. */
function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-fdt="word-row"]')];
}

/** The rendered rows' names, in order. */
function names(): string[] {
  return rows().map((row) => row.querySelector('[data-fdt="list-row-name"]')?.textContent ?? '');
}

/** A row by its name (throws when absent). */
function rowOf(word: string): HTMLElement {
  const row = rows().find(
    (candidate) => candidate.querySelector('[data-fdt="list-row-name"]')?.textContent === word
  );
  if (row === undefined) throw new Error(`no row ${word}`);
  return row;
}

/** A row's cell text by hook (`list-row-size`, `list-row-preview`). */
function cell(word: string, hook: string): string | null | undefined {
  return rowOf(word).querySelector(`[data-fdt="${hook}"]`)?.textContent;
}

/** Open a row's detail by its name. */
function open(word: string): void {
  const button = rowOf(word).querySelector<HTMLButtonElement>('[data-fdt-row-open]');
  if (button === null) throw new Error(`no open button on ${word}`);
  fireEvent.click(button);
}

describe('UndefinedReferencesPage — states', () => {
  it('renders inside the page frame with its single h1', () => {
    mount({ data: pageData() });
    expect(document.querySelector('[data-fdt-page="undefined-references"]')).not.toBeNull();
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Undefined References');
    expect(
      screen.getByText('Missing names from page errors, and where they may be defined')
    ).toBeTruthy();
    expect(statusLine().getAttribute('role')).toBe('status');
  });

  it('waits for interaction while Delay JS holds the scripts (no read yet)', () => {
    const { reads } = mount({ data: pageData({ delay: true, words: ['alpha'] }) });
    expect(screen.getByText('Waiting for page interaction')).toBeTruthy();
    expect(
      screen.getByText(
        "Delay JavaScript execution holds the page's scripts until the first interaction — click or scroll the inspected page."
      )
    ).toBeTruthy();
    expect(reads).toHaveLength(0);
  });

  it('waits for interaction on a simulated page too (the injected runtime holds the scripts)', () => {
    const base = makeFdtData();
    const simulated = { ...delayJs(false), delayedScripts: 1, simulation: 'simulated' as const };
    const { reads } = mount({
      data: makeFdtData({
        undefinedReferencesOnPage: ['alpha'],
        wprDetections: { ...base.wprDetections, delay_js: simulated }
      })
    });
    expect(screen.getByText('Waiting for page interaction')).toBeTruthy();
    expect(reads).toHaveLength(0);
  });

  it('an unverified marker on a page without a runtime does not wait', () => {
    const base = makeFdtData();
    const unverified = { ...delayJs(false), simulation: 'unverified' as const };
    mount({
      data: makeFdtData({ wprDetections: { ...base.wprDetections, delay_js: unverified } })
    });
    expect(screen.queryByText('Waiting for page interaction')).toBeNull();
  });

  it('shows skeleton rows while the real read is in flight, then the results', async () => {
    const { reads } = mount({ data: pageData({ delay: true, loaded: true, words: ['alpha'] }) });
    const processing = document.querySelector('[data-fdt="undefined-refs-processing"]');
    expect(processing?.getAttribute('aria-busy')).toBe('true');
    // Shaped like the list's calm rows (58 px floor), two of them.
    const skeletons = processing?.querySelectorAll('[data-fdt="skeleton-row"]');
    expect(skeletons).toHaveLength(2);
    expect(skeletons?.[0]?.className).toContain('min-h-14.5');
    // The geometry is the list's own two-line row surface, never re-typed.
    const surface = calmRowClass({
      lines: 'two',
      interactive: false,
      selected: false,
      current: false
    });
    for (const token of surface.split(' ')) expect(skeletons?.[0]?.classList).toContain(token);
    expect(screen.getByText("Reading the page's scripts…")).toBeTruthy();
    expect(reads[0]?.inline).toEqual([makeDelayScript({ inline: true, content: 'beta = 2;' })]);
    reads[0]?.resolve(ASSETS);
    await flush();
    expect(document.querySelector('[data-fdt="undefined-refs-processing"]')).toBeNull();
    expect(names()).toEqual(['alpha']);
  });

  it('shows the empty state with no read — monitoring until Delay JS reports loaded', () => {
    const { reads } = mount({ data: pageData() });
    expect(reads).toHaveLength(0);
    expect(screen.getByText('No undefined references detected')).toBeTruthy();
    expect(
      screen.getByText('Monitoring — any that occur while the page runs appear here.')
    ).toBeTruthy();
    cleanup();
    mount({ data: pageData({ delay: true, loaded: true }) });
    expect(screen.getByText("The page's scripts ran without an undefined reference.")).toBeTruthy();
  });

  it('lists unsearched words under the notice when the browser cannot read scripts', () => {
    mount({ data: pageData({ words: ['alpha'] }), unsupported: true });
    expect(
      screen.getByText(
        "This browser can't list the inspected page's scripts, so no definition search runs. The names come straight from the page's errors."
      )
    ).toBeTruthy();
    expect(cell('alpha', 'list-row-preview')).toBe('Not searched');
    // No search runs, so no count to state.
    expect(cell('alpha', 'list-row-size')).toBeUndefined();
    expect(screen.queryByRole('button', { name: /Rescan/ })).toBeNull();
    expect(summary()).toBe('1 undefined reference');
  });
});

describe('UndefinedReferencesPage — failures', () => {
  it('keeps the words listed under the failure notice; Retry hands focus to the h1', async () => {
    const { reads } = mount({ data: pageData({ words: ['alpha', 'beta'] }) });
    reads[0]?.reject(new Error('Inspected target navigated or closed'));
    await flush();
    const notice = document.querySelector('[data-fdt="undefined-refs-failure"]');
    expect(notice?.getAttribute('role')).toBe('alert');
    expect(notice?.textContent).toBe(
      "Couldn't read the page's scriptsDevTools could not list the inspected page's scripts. The names below come straight from the page's errors, unsearched.Retry"
    );
    expect(
      rows().map((row) => row.querySelector('[data-fdt="list-row-preview"]')?.textContent)
    ).toEqual(['Not searched', 'Not searched']);
    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    fireEvent.click(retry);
    expect(reads).toHaveLength(2);
    expect(document.querySelector('[data-fdt="undefined-refs-processing"]')).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    reads[1]?.resolve(ASSETS);
    await flush();
    expect(document.querySelector('[data-fdt="undefined-refs-failure"]')).toBeNull();
    expect([cell('alpha', 'list-row-size'), cell('beta', 'list-row-size')]).toEqual(['1', '1']);
  });

  it('offers no Retry after an extension reload — only the reopen-DevTools remedy', async () => {
    const { reads } = mount({ data: pageData({ words: ['alpha'] }) });
    reads[0]?.reject(new Error('Extension context invalidated.'));
    await flush();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(document.querySelector('[data-fdt="undefined-refs-failure"]')?.textContent).toContain(
      'Close and reopen DevTools to reconnect.'
    );
  });
});

describe('UndefinedReferencesPage — results', () => {
  /** Mount with results showing for `words`, the list at a pane-wide width. */
  async function withResults(words: string[], width = 1000): Promise<Mounted> {
    const controls = mount({ data: pageData({ words }) });
    controls.reads[0]?.resolve(ASSETS);
    await flush();
    // The calm list mounts with the results: report its width now.
    observers.resize(width);
    return controls;
  }

  it('renders one calm row per word with the summary, fading in once as a whole', async () => {
    await withResults(['alpha', 'beta', 'nope', UNDEFINED_REFERENCE_EXTERNAL_ERROR]);
    const results = document.querySelector<HTMLElement>('[data-fdt="undefined-refs-results"]');
    for (const token of MOTION_REVEAL.split(' ')) expect(results?.classList).toContain(token);
    // The reading canvas cap stays.
    expect(results?.closest('[data-fdt="page-body"]')?.classList).toContain('max-w-4xl');
    const list = screen.getByRole('list', { name: 'Undefined references' });
    expect(list.querySelectorAll('[role="listitem"]')).toHaveLength(4);
    // No per-row entrance: no row carries a transition.
    expect(list.querySelector('[class*="transition-opacity"]')).toBeNull();
    expect(names()).toEqual(['alpha', 'beta', 'nope', 'Script error.']);
    expect(summary()).toBe(
      '3 undefined references · 2 with a possible definition · 1 cross-origin error'
    );
    // Rows: the number of defining scripts, then where (or the verdict's words).
    expect(
      rows().map((row) => row.querySelector('[data-fdt="list-row-size"]')?.textContent)
    ).toEqual(['1', '1', '0', undefined]);
    expect(
      rows().map((row) => row.querySelector('[data-fdt="list-row-preview"]')?.textContent)
    ).toEqual(['a.js', 'Inline script', 'No definition found', 'Details hidden']);
    // Words are identifiers (mono); the sentinel reads as the browser's message.
    const nameOf = (word: string): Element | null =>
      rowOf(word).querySelector('[data-fdt="list-row-name"]');
    expect(nameOf('alpha')?.className).toContain('font-mono');
    expect(nameOf('Script error.')?.className).not.toContain('font-mono');
    // Icon tile: a variable per word, eye-off for the hidden cross-origin error.
    const iconOf = (word: string): Element | null =>
      rowOf(word).querySelector('[data-fdt="list-row-icon"] svg');
    for (const word of ['alpha', 'beta', 'nope']) {
      expect(iconOf(word)?.classList).toContain('lucide-variable');
    }
    expect(iconOf('Script error.')?.classList).toContain('lucide-eye-off');
    expect(iconOf('Script error.')?.classList).not.toContain('lucide-variable');
    const head = document.querySelector('[data-fdt="list-head"]');
    expect(head?.textContent).toBe('NameScripts');
  });

  it('opens a word in the side pane: kind, title, definitions with their tile', async () => {
    await withResults(['alpha', UNDEFINED_REFERENCE_EXTERNAL_ERROR]);
    open('alpha');
    const pane = document.querySelector<HTMLElement>('[data-fdt="detail-pane"]');
    expect(pane).not.toBeNull();
    expect(pane?.querySelector('[data-fdt="detail-kind"]')?.textContent).toBe(
      'Undefined reference'
    );
    expect(pane?.querySelector('[data-fdt="detail-title"]')?.textContent).toBe('alpha');
    expect(pane?.querySelector('[data-fdt-verdict]')?.textContent).toBe('In 1 script');
    expect(pane?.querySelector('[data-fdt="source-link-open"]')?.getAttribute('href')).toBe(URL_A);
    expect(rowOf('alpha').hasAttribute('data-selected')).toBe(true);
    open('Script error.');
    expect(pane?.querySelector('[data-fdt="detail-kind"]')?.textContent).toBe('Cross-origin error');
    expect(pane?.querySelector('[data-fdt="detail-title"]')?.textContent).toBe('Script error.');
    expect(pane?.querySelector('[data-fdt-verdict]')?.textContent).toBe('Details hidden');
  });

  it('drills in below the split width, Back returns to the list', async () => {
    await withResults(['alpha'], 400);
    open('alpha');
    expect(document.querySelector('[data-fdt="detail-pane"]')).toBeNull();
    const drill = document.querySelector<HTMLElement>('[data-fdt="drill-detail"]');
    expect(drill?.querySelector('[data-fdt="drill-back"]')?.textContent).toContain('References');
    expect(drill?.querySelector('[data-fdt="drill-position"]')?.textContent).toBe('1 of 1');
    fireEvent.click(drill?.querySelector('[data-fdt="drill-back"]') as HTMLElement);
    expect(document.querySelector('[data-fdt="drill-detail"]')).toBeNull();
  });

  it('copies the same-origin path through the detail action', async () => {
    const { writeText } = await withResults(['alpha']);
    open('alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Copy as exclusion: a.js' }));
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('/wp-content/plugins/p/a.js');
    });
    expect(document.querySelector('[data-fdt="source-link-path"]')?.textContent).toBe(
      '/wp-content/plugins/p/a.js'
    );
  });

  it('searches the words by name', async () => {
    const { search } = await withResults(['alpha', 'beta']);
    vi.useFakeTimers();
    const field = screen.getByRole('searchbox', { name: 'Search undefined references' });
    expect(field.getAttribute('placeholder')).toBe('Search names…');
    commit(search, 'alp');
    expect(names()).toEqual(['alpha']);
    commit(search, 'zzz');
    expect(rows()).toHaveLength(0);
    // The filtered-empty view offers the way back.
    expect(document.querySelector('[data-fdt-no-matches-action="clear-search"]')?.textContent).toBe(
      'Clear search'
    );
  });

  it('appends pushed words in place: existing rows keep their DOM and focus, one announcement', async () => {
    const { push } = await withResults(['alpha']);
    const firstRow = rowOf('alpha');
    open('alpha');
    const copy = screen.getByRole('button', { name: 'Copy as exclusion: a.js' });
    copy.focus();
    expect(statusLine().textContent).toBe('');
    push({ undefinedReferencesOnPage: ['alpha', 'beta', 'gamma'] });
    await flush();
    expect(names()).toEqual(['alpha', 'beta', 'gamma']);
    expect(rowOf('alpha')).toBe(firstRow);
    expect(document.activeElement).toBe(copy);
    // Successive messages alternate a trailing no-break space, so even an
    // identical sentence is a DOM change the screen reader announces.
    expect(statusLine().textContent).toBe('2 new undefined references\u00a0');
    push({ undefinedReferencesOnPage: ['alpha', 'beta', 'gamma', 'delta'] });
    expect(statusLine().textContent).toBe('1 new undefined reference');
  });

  it('updates a row in place as its answer streams in: DOM and row focus kept', async () => {
    const { push } = await withResults(['alpha']);
    push({ undefinedReferencesOnPage: ['alpha', 'beta'] });
    // The search has not reached the pushed word yet.
    expect(cell('beta', 'list-row-preview')).toBe('Searching…');
    expect(cell('beta', 'list-row-size')).toBeUndefined();
    const row = rowOf('beta');
    const openButton = row.querySelector<HTMLElement>('[data-fdt-row-open]');
    openButton?.focus();
    await flush();
    expect(cell('beta', 'list-row-preview')).toBe('Inline script');
    expect(cell('beta', 'list-row-size')).toBe('1');
    expect(rowOf('beta')).toBe(row);
    expect(document.activeElement).toBe(openButton);
  });

  it('a same-page data refresh keeps the rows, the open detail and focus — no skeleton', async () => {
    const { reads, refresh } = await withResults(['alpha']);
    const row = rowOf('alpha');
    open('alpha');
    const definition = document.querySelector('[data-fdt-definition="url"]');
    const copy = screen.getByRole('button', { name: 'Copy as exclusion: a.js' });
    copy.focus();
    refresh(pageData({ words: ['alpha'] }), 2);
    expect(reads).toHaveLength(2);
    expect(document.querySelector('[data-fdt="undefined-refs-processing"]')).toBeNull();
    expect(rowOf('alpha')).toBe(row);
    reads[1]?.resolve([...ASSETS]);
    await flush();
    expect(rowOf('alpha')).toBe(row);
    expect(document.querySelector('[data-fdt-definition="url"]')).toBe(definition);
    expect(document.activeElement).toBe(copy);
    expect(statusLine().textContent).toBe('');
  });

  it('a refresh whose read fails keeps the rows under the failure notice', async () => {
    const { reads, refresh } = await withResults(['alpha']);
    const row = rowOf('alpha');
    refresh(pageData({ words: ['alpha'] }), 2);
    reads[1]?.reject(new Error('boom'));
    await flush();
    expect(document.querySelector('[data-fdt="undefined-refs-failure"]')).not.toBeNull();
    expect(rowOf('alpha')).toBe(row);
    expect(cell('alpha', 'list-row-preview')).toBe('Not searched');
  });

  it('renders a page-controlled word as inert text', async () => {
    const hostile = '<img src=x onerror="window.__pwned=1">';
    await withResults([hostile]);
    expect(names()).toEqual([hostile]);
    expect(document.querySelector('img')).toBeNull();
  });

  it('rescans with results and focus kept; busy and done show as text at every width', async () => {
    const { reads } = await withResults(['alpha']);
    const rescan = document.querySelector<HTMLButtonElement>('[data-fdt="undefined-refs-rescan"]');
    if (!rescan) throw new Error('no rescan control');
    const label = (): HTMLElement | null => rescan.querySelector('span');
    expect(label()?.textContent).toBe('Rescan');
    expect(label()?.className).toContain('@max-regular:sr-only');
    rescan.focus();
    fireEvent.click(rescan);
    expect(reads).toHaveLength(2);
    expect(rescan.getAttribute('aria-busy')).toBe('true');
    expect(rescan.disabled).toBe(false);
    expect(label()?.textContent).toBe('Rescanning…');
    expect(label()?.className).not.toContain('sr-only');
    expect(document.activeElement).toBe(rescan);
    reads[1]?.resolve(ASSETS);
    await flush();
    expect(rescan.hasAttribute('aria-busy')).toBe(false);
    expect(label()?.textContent).toBe('Rescanned');
    expect(label()?.className).not.toContain('sr-only');
  });

  it('toasts a failed rescan and keeps the previous results', async () => {
    const { reads } = await withResults(['alpha']);
    fireEvent.click(screen.getByRole('button', { name: /Rescan/ }));
    reads[1]?.reject(new Error('boom'));
    await flush();
    expect(toastItems()[0]).toMatchObject({
      tone: 'error',
      title: "Couldn't rescan the page's scripts",
      description:
        "DevTools could not list the inspected page's scripts. The previous results stay listed."
    });
    expect(cell('alpha', 'list-row-size')).toBe('1');
  });

  it('counts skipped scripts in the summary and softens not-found verdicts', async () => {
    const { reads } = mount({ data: pageData({ words: ['alpha', 'nope'] }) });
    reads[0]?.resolve(ASSETS, 2);
    await flush();
    expect(summary()).toBe(
      '2 undefined references · 1 with a possible definition · 2 scripts could not be read'
    );
    expect(cell('nope', 'list-row-preview')).toBe('No definition found in the readable scripts');
    // Each fact is unbreakable; lines break only between facts.
    const facts = document.querySelectorAll('[data-fdt="undefined-refs-summary"] > span');
    expect(facts).toHaveLength(3);
    for (const fact of facts) expect(fact.className).toContain('whitespace-nowrap');
  });

  it('says so when the capture cut the inline scripts (an inline text clipped to its cap)', async () => {
    const data = pageData({ words: ['nope'] });
    const cut = makeFdtData({
      ...data,
      wprDetections: {
        ...data.wprDetections,
        delay_js: {
          ...data.wprDetections.delay_js,
          scripts: [
            makeDelayScript({
              inline: true,
              content: 'x'.repeat(PAYLOAD_LIMITS.delayScripts.content)
            })
          ],
          truncated: true
        }
      }
    });
    const { reads } = mount({ data: cut });
    reads[0]?.resolve(ASSETS);
    await flush();
    expect(summary()).toBe(
      '1 undefined reference · 0 with a possible definition · inline scripts only partly captured'
    );
    expect(screen.getByText('No definition found in the readable scripts')).toBeTruthy();
  });

  it('keeps not-found verdicts whole when the mark covers only a non-inline cut', async () => {
    // A marked row whose inline text is whole: the cut was elsewhere (a
    // clipped URL, a dropped original type), so the inline search saw it all.
    const data = pageData({ words: ['nope'] });
    const marked = makeFdtData({
      ...data,
      wprDetections: {
        ...data.wprDetections,
        delay_js: { ...data.wprDetections.delay_js, truncated: true }
      }
    });
    const { reads } = mount({ data: marked });
    reads[0]?.resolve(ASSETS);
    await flush();
    expect(summary()).toBe('1 undefined reference · 0 with a possible definition');
    expect(screen.queryByText('No definition found in the readable scripts')).toBeNull();
  });

  it('hints at a rescan when the page loaded scripts after the read', async () => {
    const { added } = await withResults(['alpha']);
    expect(document.querySelector('[data-fdt="undefined-refs-stale"]')).toBeNull();
    for (const listener of added) listener('https://x.test/late.js');
    expect(document.querySelector('[data-fdt="undefined-refs-stale"]')?.textContent).toBe(
      'New scripts loaded since the last read.'
    );
  });
});
