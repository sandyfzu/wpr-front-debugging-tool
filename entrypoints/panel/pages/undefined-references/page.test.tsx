/**
 * The page over the shell's data context: one body per state (trigger
 * conditions through real data shapes), the error → Retry path, the results
 * list's live updates (append in place, DOM and focus kept, one polite
 * announcement), the rescan control, a soft refresh, and the list-size pin
 * that keeps the plain (non-virtual) list honest.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOTION_REVEAL } from '../../../../components/ui/classes';
import { toast, toastItems } from '../../../../components/ui/toast-store';
import { ERROR_WORD_LIMIT } from '../../../../lib/messaging/validate';
import type { InlineScriptSource, ScriptAsset } from '../../../../lib/panel/undefined-refs';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import type { DataState } from '../../state/fdt-state-machine';
import { makeDelayScript, makeFdtData } from '../../state/fixtures';
import { FdtDataContext, type FdtDataStore } from '../../state/use-fdt-data';
import type { ScriptLoader } from './inspected-scripts';
import {
  MONITORING_DESCRIPTION,
  SETTLED_DESCRIPTION,
  UNSEARCHED_NOTICE,
  UndefinedReferencesPage,
  WAITING_DESCRIPTION
} from './page';
import { COPY_LABEL } from './word-card';

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

/** Let promise reactions (the loader's settle) run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
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
  /** `null` = the browser cannot list scripts. Default: a controllable loader. */
  loader?: ScriptLoader | null;
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
  const loader: ScriptLoader | null =
    options.loader === undefined
      ? (inline) =>
          new Promise((resolve, reject) => {
            reads.push({ inline, resolve, reject });
          })
      : options.loader;
  const onCopy = vi.fn();
  render(() => (
    <FdtDataContext.Provider value={store}>
      <UndefinedReferencesPage deps={{ loadScripts: loader }} onCopy={onCopy} />
    </FdtDataContext.Provider>
  ));
  /** Patch the loaded data like a push does (same page, same fetch stamp). */
  const push = (patch: Partial<FdtData>): void => {
    const current = state();
    if (current.status !== 'ready') throw new Error('push needs a ready state');
    setState({ ...current, data: { ...current.data, ...patch } });
  };
  return { reads, push, setState, state, onCopy };
}

/** The page's polite status line. */
function statusLine(): HTMLElement {
  const node = document.querySelector<HTMLElement>('[data-fdt="undefined-refs-status"]');
  if (!node) throw new Error('no status line');
  return node;
}

describe('UndefinedReferencesPage — states', () => {
  it('renders inside the page frame with its single h1', () => {
    mount({ data: pageData() });
    expect(document.querySelector('[data-fdt-page="undefined-references"]')).not.toBeNull();
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Undefined References');
    expect(statusLine().getAttribute('role')).toBe('status');
  });

  it('waits for interaction while Delay JS holds the scripts (no read yet)', () => {
    const { reads } = mount({ data: pageData({ delay: true, words: ['alpha'] }) });
    expect(screen.getByText('Waiting for page interaction')).toBeTruthy();
    expect(screen.getByText(WAITING_DESCRIPTION)).toBeTruthy();
    expect(WAITING_DESCRIPTION).toContain('Delay JavaScript execution');
    expect(reads).toHaveLength(0);
  });

  it('shows skeleton cards while the real read is in flight, then the results at once', async () => {
    const { reads } = mount({ data: pageData({ delay: true, loaded: true, words: ['alpha'] }) });
    const processing = document.querySelector('[data-fdt="undefined-refs-processing"]');
    expect(processing?.getAttribute('aria-busy')).toBe('true');
    expect(processing?.querySelectorAll('[data-fdt="card"]')).toHaveLength(2);
    expect(reads[0]?.inline).toEqual([
      { ...makeDelayScript({ inline: true, content: 'beta = 2;' }) }
    ]);
    reads[0]?.resolve(ASSETS);
    await flush();
    expect(document.querySelector('[data-fdt="undefined-refs-processing"]')).toBeNull();
    expect(screen.getByText('alpha')).toBeTruthy();
  });

  it('names a failed read and recovers through Retry', async () => {
    const { reads } = mount({ data: pageData({ words: ['alpha'] }) });
    reads[0]?.reject(new Error('Inspected target navigated or closed'));
    await flush();
    const error = document.querySelector('[data-fdt="error-state"]');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(screen.getByText("Couldn't read the page's scripts")).toBeTruthy();
    expect(screen.getByText("DevTools could not list the inspected page's scripts.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reads).toHaveLength(2);
    reads[1]?.resolve(ASSETS);
    await flush();
    expect(document.querySelector('[data-fdt="undefined-refs-results"]')).not.toBeNull();
  });

  it('shows the empty state — monitoring until Delay JS reports its scripts loaded', () => {
    mount({ data: pageData() });
    expect(screen.getByText('No undefined references detected')).toBeTruthy();
    expect(screen.getByText(MONITORING_DESCRIPTION)).toBeTruthy();
    expect(MONITORING_DESCRIPTION.startsWith('Monitoring')).toBe(true);
    cleanup();
    mount({ data: pageData({ delay: true, loaded: true }) });
    expect(screen.getByText(SETTLED_DESCRIPTION)).toBeTruthy();
  });

  it('lists unsearched words under the notice when the browser cannot read scripts', () => {
    mount({ data: pageData({ words: ['alpha'] }), loader: null });
    expect(screen.getByText(UNSEARCHED_NOTICE)).toBeTruthy();
    expect(screen.getByText('Not searched')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Rescan/ })).toBeNull();
    expect(document.querySelector('[data-fdt="undefined-refs-summary"]')?.textContent).toBe(
      '1 undefined reference'
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
    await withResults(['alpha', 'beta', 'nope']);
    const results = document.querySelector<HTMLElement>('[data-fdt="undefined-refs-results"]');
    for (const token of MOTION_REVEAL.split(' ')) expect(results?.classList).toContain(token);
    const list = screen.getByRole('list', { name: 'Undefined references' });
    expect(list.querySelectorAll(':scope > li')).toHaveLength(3);
    // No per-card entrance: nothing below the container carries a transition.
    expect(list.querySelector('[class*="transition"]')).toBeNull();
    expect(document.querySelector('[data-fdt="virtual-list"]')).toBeNull();
    expect(document.querySelector('[data-fdt="undefined-refs-summary"]')?.textContent).toBe(
      '3 undefined references · 2 with a possible definition'
    );
    expect(screen.getByText('Inline Script')).toBeTruthy();
  });

  it('appends pushed words in place: existing cards keep their DOM and focus, one announcement', async () => {
    const { push, onCopy } = await withResults(['alpha']);
    const firstCard = screen.getByText('alpha').closest('li');
    const copy = screen.getByRole('button', { name: COPY_LABEL });
    copy.focus();
    expect(statusLine().textContent).toBe('');

    push({ undefinedReferencesOnPage: ['alpha', 'beta', 'gamma'] });
    const items = screen.getByRole('list', { name: 'Undefined references' }).children;
    expect([...items].map((li) => li.querySelector('[data-fdt-word]')?.textContent)).toEqual([
      'alpha',
      'beta',
      'gamma'
    ]);
    expect(screen.getByText('alpha').closest('li')).toBe(firstCard);
    expect(document.activeElement).toBe(copy);
    // Successive messages alternate a trailing no-break space, so even an
    // identical sentence is a DOM change the screen reader announces.
    expect(statusLine().textContent).toBe('2 new undefined references\u00a0');

    push({ undefinedReferencesOnPage: ['alpha', 'beta', 'gamma', 'delta'] });
    expect(statusLine().textContent).toBe('1 new undefined reference');
    fireEvent.click(copy);
    expect(onCopy).toHaveBeenCalledWith(URL_A);
  });

  it('rescans with the results and focus kept, busy shown as text', async () => {
    const { reads } = await withResults(['alpha']);
    const rescan = document.querySelector<HTMLButtonElement>('[data-fdt="undefined-refs-rescan"]');
    if (!rescan) throw new Error('no rescan control');
    rescan.focus();
    fireEvent.click(rescan);
    expect(reads).toHaveLength(2);
    expect(rescan.getAttribute('aria-busy')).toBe('true');
    expect(rescan.disabled).toBe(false);
    expect(rescan.textContent).toBe('Rescanning…');
    expect(document.activeElement).toBe(rescan);
    expect(screen.getByText('alpha')).toBeTruthy();
    reads[1]?.resolve(ASSETS);
    await flush();
    expect(rescan.textContent).toBe('Rescan');
    expect(rescan.hasAttribute('aria-busy')).toBe(false);
  });

  it('toasts a failed rescan and keeps the previous results', async () => {
    const { reads } = await withResults(['alpha']);
    fireEvent.click(screen.getByRole('button', { name: /Rescan/ }));
    reads[1]?.reject(new Error('boom'));
    await flush();
    expect(toastItems()[0]).toMatchObject({
      tone: 'error',
      title: "Couldn't rescan the page's scripts"
    });
    expect(toastItems()[0]?.description).toContain('The previous results stay listed.');
    expect(screen.getByText('alpha')).toBeTruthy();
  });

  it('re-reads the scripts after a soft refresh while the page stays mounted', async () => {
    const { reads, setState, state } = await withResults(['alpha']);
    const heading = screen.getByRole('heading', { level: 1 });
    const current = state();
    if (current.status !== 'ready') throw new Error('expected ready');
    setState({ status: 'refreshing', data: current.data, requestedAt: 2 });
    expect(reads).toHaveLength(1);
    setState({ status: 'ready', data: pageData({ words: ['zeta'] }), fetchedAt: 3 });
    expect(reads).toHaveLength(2);
    expect(screen.getByRole('heading', { level: 1 })).toBe(heading);
    reads[1]?.resolve([{ origin: { kind: 'inline' }, content: 'var zeta;' }]);
    await flush();
    expect(screen.getByText('zeta')).toBeTruthy();
    expect(statusLine().textContent).toBe('');
  });

  it('keeps the plain list honest: the capture caps a page well under the virtualization bar', () => {
    // Above 100 rows the UI/UX bar requires the virtual list; this page
    // renders every card because the word contract caps the list.
    expect(ERROR_WORD_LIMIT).toBeLessThanOrEqual(100);
  });
});
