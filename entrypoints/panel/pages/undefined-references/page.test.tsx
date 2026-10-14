/**
 * The page over the shell's data context: one body per state (trigger
 * conditions through real data shapes), the failure notice over the
 * unsearched words with Retry and its focus hand-off, the results list's live
 * updates (append in place, DOM and focus kept, one polite announcement), a
 * same-page data refresh that keeps cards and focus, the rescan control's
 * busy/done feedback, the stale-scripts hint, and the list-size pin that
 * keeps the plain (non-virtual) list honest. User-facing copy is pinned
 * literally.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOTION_REVEAL } from '../../../../components/ui/classes';
import { toast, toastItems } from '../../../../components/ui/toast-store';
import { ERROR_WORD_LIMIT } from '../../../../lib/messaging/validate';
import type { InlineScriptSource, ScriptAsset } from '../../../../lib/panel/undefined-refs';
import { UNDEFINED_REFERENCE_EXTERNAL_ERROR } from '../../../../lib/wp-rocket/constants';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import type { DataState } from '../../state/fdt-state-machine';
import { makeDelayScript, makeFdtData } from '../../state/fixtures';
import { FdtDataContext, type FdtDataStore } from '../../state/use-fdt-data';
import type { InspectedScripts } from './inspected-scripts';
import { UndefinedReferencesPage } from './page';

const PAGE = 'https://x.test';
const URL_A = 'https://x.test/wp-content/plugins/p/a.js';
const ASSETS: ScriptAsset[] = [
  { origin: { kind: 'url', url: URL_A }, content: 'var alpha = 1;' },
  { origin: { kind: 'inline' }, content: 'beta = 2;' }
];

beforeEach(() => {
  toast.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  toast.clear();
  vi.restoreAllMocks();
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
    resolve: (a: ScriptAsset[]) => void;
    reject: (c: unknown) => void;
  }[] = [];
  const added: ((url: string) => void)[] = [];
  const inspected: InspectedScripts = {
    load: (inline) =>
      new Promise((resolve, reject) => {
        reads.push({ inline, resolve, reject });
      }),
    readPageOrigin: () => Promise.resolve(PAGE),
    watchAddedScripts: (onAdded) => {
      added.push(onAdded);
      return () => undefined;
    }
  };
  const onCopy = vi.fn<(pattern: string) => Promise<'copied' | 'failed'>>(() =>
    Promise.resolve('copied')
  );
  render(() => (
    <FdtDataContext.Provider value={store}>
      <UndefinedReferencesPage
        deps={{
          inspected: options.unsupported ? null : inspected,
          yieldToMain: () => Promise.resolve()
        }}
        onCopy={onCopy}
      />
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
  return { reads, added, push, refresh, onCopy };
}

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

/** The card list item holding a word. */
function cardOf(word: string): HTMLElement | null {
  return screen.getByText(word).closest('li');
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

  it('shows skeleton cards while the real read is in flight, then the results', async () => {
    const { reads } = mount({ data: pageData({ delay: true, loaded: true, words: ['alpha'] }) });
    const processing = document.querySelector('[data-fdt="undefined-refs-processing"]');
    expect(processing?.getAttribute('aria-busy')).toBe('true');
    expect(processing?.querySelectorAll('[data-fdt="card"]')).toHaveLength(2);
    expect(screen.getByText("Reading the page's scripts…")).toBeTruthy();
    expect(reads[0]?.inline).toEqual([makeDelayScript({ inline: true, content: 'beta = 2;' })]);
    reads[0]?.resolve(ASSETS);
    await flush();
    expect(document.querySelector('[data-fdt="undefined-refs-processing"]')).toBeNull();
    expect(screen.getByText('alpha')).toBeTruthy();
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
    expect(screen.getByText('Not searched')).toBeTruthy();
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
    expect(screen.getAllByText('Not searched')).toHaveLength(2);
    expect(screen.getByText('alpha')).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    fireEvent.click(retry);
    expect(reads).toHaveLength(2);
    expect(document.querySelector('[data-fdt="undefined-refs-processing"]')).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    reads[1]?.resolve(ASSETS);
    await flush();
    expect(document.querySelector('[data-fdt="undefined-refs-failure"]')).toBeNull();
    expect(screen.getAllByText('In 1 script')).toHaveLength(2);
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
  /** Mount with results showing for `words`. */
  async function withResults(words: string[]) {
    const controls = mount({ data: pageData({ words }) });
    controls.reads[0]?.resolve(ASSETS);
    await flush();
    return controls;
  }

  it('renders one card per word with the summary, fading in once as a whole', async () => {
    await withResults(['alpha', 'beta', 'nope', UNDEFINED_REFERENCE_EXTERNAL_ERROR]);
    const results = document.querySelector<HTMLElement>('[data-fdt="undefined-refs-results"]');
    for (const token of MOTION_REVEAL.split(' ')) expect(results?.classList).toContain(token);
    // Capped on the wide tier, so actions sit near their links.
    expect(results?.classList).toContain('@wide:max-w-4xl');
    const list = screen.getByRole('list', { name: 'Undefined references' });
    expect(list.querySelectorAll(':scope > li')).toHaveLength(4);
    // No per-card entrance: nothing below the container carries a transition but the chevrons.
    expect(list.querySelector('[class*="transition-opacity"]')).toBeNull();
    expect(document.querySelector('[data-fdt="virtual-list"]')).toBeNull();
    expect(summary()).toBe(
      '3 undefined references · 2 with a possible definition · 1 cross-origin error'
    );
    expect(screen.getByText('Inline Script')).toBeTruthy();
  });

  it('copies the same-origin path through the row action', async () => {
    const { onCopy } = await withResults(['alpha']);
    fireEvent.click(screen.getByRole('button', { name: 'Copy as exclusion: a.js' }));
    await vi.waitFor(() => {
      expect(onCopy).toHaveBeenCalledWith('/wp-content/plugins/p/a.js');
    });
    expect(document.querySelector('[data-fdt="script-location"]')?.textContent).toBe(
      '/wp-content/plugins/p/'
    );
  });

  it('appends pushed words in place: existing cards keep their DOM and focus, one announcement', async () => {
    const { push } = await withResults(['alpha']);
    const firstCard = cardOf('alpha');
    const copy = screen.getByRole('button', { name: 'Copy as exclusion: a.js' });
    copy.focus();
    expect(statusLine().textContent).toBe('');
    push({ undefinedReferencesOnPage: ['alpha', 'beta', 'gamma'] });
    await flush();
    const items = screen.getByRole('list', { name: 'Undefined references' }).children;
    expect([...items].map((li) => li.querySelector('[data-fdt-word]')?.textContent)).toEqual([
      'alpha',
      'beta',
      'gamma'
    ]);
    expect(cardOf('alpha')).toBe(firstCard);
    expect(document.activeElement).toBe(copy);
    // Successive messages alternate a trailing no-break space, so even an
    // identical sentence is a DOM change the screen reader announces.
    expect(statusLine().textContent).toBe('2 new undefined references ');
    push({ undefinedReferencesOnPage: ['alpha', 'beta', 'gamma', 'delta'] });
    expect(statusLine().textContent).toBe('1 new undefined reference');
  });

  it('a same-page data refresh keeps the cards, their rows and focus — no skeleton', async () => {
    const { reads, refresh } = await withResults(['alpha']);
    const card = cardOf('alpha');
    const row = document.querySelector('[data-fdt-definition="url"]');
    const copy = screen.getByRole('button', { name: 'Copy as exclusion: a.js' });
    copy.focus();
    refresh(pageData({ words: ['alpha'] }), 2);
    expect(reads).toHaveLength(2);
    expect(document.querySelector('[data-fdt="undefined-refs-processing"]')).toBeNull();
    expect(cardOf('alpha')).toBe(card);
    reads[1]?.resolve([...ASSETS]);
    await flush();
    expect(cardOf('alpha')).toBe(card);
    expect(document.querySelector('[data-fdt-definition="url"]')).toBe(row);
    expect(document.activeElement).toBe(copy);
    expect(statusLine().textContent).toBe('');
  });

  it('a refresh whose read fails keeps the cards under the failure notice', async () => {
    const { reads, refresh } = await withResults(['alpha']);
    const card = cardOf('alpha');
    refresh(pageData({ words: ['alpha'] }), 2);
    reads[1]?.reject(new Error('boom'));
    await flush();
    expect(document.querySelector('[data-fdt="undefined-refs-failure"]')).not.toBeNull();
    expect(cardOf('alpha')).toBe(card);
    expect(screen.getByText('Not searched')).toBeTruthy();
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
    expect(screen.getByText('In 1 script')).toBeTruthy();
  });

  it('hints at a rescan when the page loaded scripts after the read', async () => {
    const { added } = await withResults(['alpha']);
    expect(document.querySelector('[data-fdt="undefined-refs-stale"]')).toBeNull();
    for (const listener of added) listener('https://x.test/late.js');
    expect(document.querySelector('[data-fdt="undefined-refs-stale"]')?.textContent).toBe(
      'New scripts loaded since the last read.'
    );
  });

  it('keeps the plain list honest: the capture caps a page well under the virtualization bar', () => {
    // Above 100 rows the UI/UX bar requires the virtual list; this page
    // renders every card because the word contract caps the list.
    expect(ERROR_WORD_LIMIT).toBeLessThanOrEqual(100);
  });
});
