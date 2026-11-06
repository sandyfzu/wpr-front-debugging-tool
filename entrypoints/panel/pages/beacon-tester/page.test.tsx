/**
 * The Beacon Tester page over a session with injected doubles: the form's
 * load states, feature names and live issues, the run card's states and
 * typed recoveries, the results tabs (no results, not part of the run, the
 * candidate table with its LCP chip and search, the lazy-render list, the
 * list notes), stale results after a reload, and a refresh keeping the view.
 */
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VirtualItem, VirtualizerFactory } from '../../../../components/ui/virtual-list';
import type { BeaconTestDraft } from '../../../../lib/beacon-test/config';
import type { AboveTheFoldCandidate, BeaconTestResults } from '../../../../lib/beacon-test/results';
import { runBeaconTest, type BeaconTestOutcome } from '../../../../lib/beacon-test/run-test';
import {
  DEFAULT_BEACON_TEST_SETTINGS,
  type BeaconTestSettings
} from '../../../../lib/beacon-test/settings';
import type { DataState } from '../../state/fdt-state-machine';
import { makeFdtData } from '../../state/fixtures';
import { pageIdOf } from '../../state/page-identity';
import { createSearchStore, SEARCH_DEBOUNCE_MS } from '../../state/search';
import { FdtDataContext, SearchContext, type FdtDataStore } from '../../state/use-fdt-data';
import { NO_FEATURE_NOTE } from './form';
import {
  BEACON_TESTER_SUBTITLE,
  createBeaconTesterHandle,
  BeaconTesterPage,
  LOAD_FAILED_COPY
} from './page';
import { NO_RESULTS_COPY } from './results';
import { RUN_DISCLOSURE, RUNNING_COPY, STALE_COPY } from './run-panel';
import { createBeaconTesterSession, type BeaconTesterSessionDeps } from './session';

/** A candidate with every field empty but the overrides. */
function candidate(overrides: Partial<AboveTheFoldCandidate>): AboveTheFoldCandidate {
  return {
    label: 'above-the-fold',
    kind: 'img',
    src: '',
    srcset: '',
    sizes: '',
    currentSrc: '',
    sources: [],
    backgroundUrls: [],
    extra: {},
    ...overrides
  };
}

const RESULTS: BeaconTestResults = {
  aboveTheFold: {
    kind: 'ok',
    items: [
      candidate({ label: 'lcp', src: 'https://a.test/hero.jpg' }),
      candidate({ kind: 'bg-img', backgroundUrls: ['https://a.test/bg.webp'] })
    ],
    dropped: 2,
    truncated: false
  },
  lazyRender: { kind: 'ok', items: ['hash-one', 'hash-two'], dropped: 0, truncated: false }
};
const COMPLETED: BeaconTestOutcome = { kind: 'completed', results: RESULTS, scriptErrors: [] };

/** Settings that can run both features. */
const STORED: BeaconTestSettings = {
  ...DEFAULT_BEACON_TEST_SETTINGS,
  aboveTheFold: true,
  lazyRender: true
};

/** Every row, at a fixed pitch, keyed as the list keys them (no layout in the test DOM). */
const everyRow: VirtualizerFactory = (options) => ({
  getVirtualItems: (): VirtualItem[] =>
    Array.from({ length: options.count }, (_, index) => ({
      key: options.getItemKey?.(index) ?? index,
      index,
      start: index * 36,
      end: index * 36 + 36,
      size: 36,
      lane: 0
    })),
  getTotalSize: () => options.count * 36,
  measureElement: () => undefined
});

/** Let queued promise callbacks run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Render the page with doubles; returns the controls a test drives. */
function renderPage(
  options: {
    runTest?: (draft: BeaconTestDraft) => Promise<BeaconTestOutcome>;
    readSettings?: () => Promise<BeaconTestSettings>;
    reload?: (() => void) | null;
  } = {}
) {
  const [state, setState] = createSignal<DataState>({
    status: 'ready',
    data: makeFdtData({ scriptSnapshotId: 'page-1' }),
    fetchedAt: 0
  } as DataState);
  const store: FdtDataStore = {
    state,
    start: vi.fn(),
    stop: vi.fn(),
    retry: vi.fn(),
    reload: vi.fn()
  };
  const runTest = vi.fn(options.runTest ?? (() => Promise.resolve(COMPLETED)));
  const deps: BeaconTesterSessionDeps = {
    readSettings: options.readSettings ?? (() => Promise.resolve(STORED)),
    writeSettings: vi.fn(() => Promise.resolve()),
    watchSettings: () => () => undefined,
    runTest,
    isValidSelector: (selector) => /^[a-z]+(,[a-z]+)*$/.test(selector),
    pageId: () => pageIdOf(state()),
    schedule: () => () => undefined,
    saveDelayMs: 400,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  };
  const handle = createBeaconTesterHandle(() => createBeaconTesterSession(deps));
  const reload = options.reload === null ? null : (options.reload ?? vi.fn());
  const search = createSearchStore();
  render(() => (
    <FdtDataContext.Provider value={store}>
      <SearchContext.Provider value={search}>
        <BeaconTesterPage
          handle={handle}
          reloadInspectedPage={reload}
          createVirtualizer={everyRow}
        />
      </SearchContext.Provider>
    </FdtDataContext.Provider>
  ));
  return { handle, setState, runTest, reload };
}

/** The Run button. */
function runButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>('[data-fdt-beacon-run]');
  if (button === null) throw new Error('no Run button');
  return button;
}

/** The finished outcome block. */
function outcome(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-fdt="beacon-outcome"]');
}

/** The selected tab's panel (in the test DOM a deselected panel can stay mounted). */
function shownPanel(): HTMLElement {
  const panel = document.querySelector<HTMLElement>('[role="tabpanel"][data-selected]');
  if (panel === null) throw new Error('no selected tab panel');
  return panel;
}

/** Run and let the answer land. */
async function run(): Promise<void> {
  fireEvent.click(runButton());
  await settle();
}

describe('BeaconTesterPage — settings', () => {
  it('holds Run while the settings load, then shows the form with WP Rocket’s feature names', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Beacon Tester' })).toBeTruthy();
    expect(screen.getByText(BEACON_TESTER_SUBTITLE)).toBeTruthy();
    expect(runButton().disabled).toBe(true);
    expect(document.querySelector('[data-fdt-beacon-form-loading]')).not.toBeNull();
    await settle();
    expect(runButton().disabled).toBe(false);
    expect(screen.getByText(RUN_DISCLOSURE)).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Optimize Critical Images' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Automatic Lazy Rendering' })).toBeTruthy();
    expect(screen.getByLabelText('Viewport width (px)')).toBeTruthy();
    expect(screen.getByLabelText('Candidate elements')).toBeTruthy();
    expect(screen.getByLabelText('Lazy-render distance (px)')).toBeTruthy();
    expect(document.querySelector('[data-fdt-save]')?.getAttribute('data-fdt-save')).toBe('saved');
  });

  it('shows a failed load with Retry, Run held', async () => {
    const readSettings = vi
      .fn<() => Promise<BeaconTestSettings>>()
      .mockRejectedValueOnce(new Error('dead'))
      .mockResolvedValueOnce(STORED);
    renderPage({ readSettings });
    await settle();
    expect(screen.getByText(LOAD_FAILED_COPY)).toBeTruthy();
    expect(runButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await settle();
    expect(screen.getByLabelText('Candidate elements')).toBeTruthy();
  });

  it('names live issues at their field, the missing feature as a note', async () => {
    renderPage({ readSettings: () => Promise.resolve(DEFAULT_BEACON_TEST_SETTINGS) });
    await settle();
    expect(screen.getByText(NO_FEATURE_NOTE)).toBeTruthy();
    const width = screen.getByLabelText<HTMLInputElement>('Viewport width (px)');
    fireEvent.input(width, { target: { value: '12a' } });
    expect(width.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(/^Viewport width must be a whole number/)).toBeTruthy();
    expect(document.querySelector('[data-fdt-save]')?.getAttribute('data-fdt-save')).toBe(
      'pending'
    );
  });

  it('switches the viewport hint and thresholds with the device', async () => {
    renderPage();
    await settle();
    expect(screen.getByText(/desktop beacon measures only in a viewport at least/)).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Mobile' }));
    expect(screen.getByLabelText<HTMLInputElement>('Viewport width (px)').value).toBe('393');
    expect(screen.getByText(/mobile beacon measures only in a viewport at most/)).toBeTruthy();
  });

  it('restores the default selectors (held while they are the defaults)', async () => {
    renderPage();
    await settle();
    const restore = screen.getByRole<HTMLButtonElement>('button', { name: 'Restore defaults' });
    expect(restore.disabled).toBe(true);
    const field = screen.getByLabelText<HTMLTextAreaElement>('Candidate elements');
    fireEvent.input(field, { target: { value: 'img' } });
    expect(restore.disabled).toBe(false);
    fireEvent.click(restore);
    expect(field.value).toBe(DEFAULT_BEACON_TEST_SETTINGS.selectorText);
  });
});

describe('BeaconTesterPage — run', () => {
  it('shows the bounded wait while running, then the outcome and the first results tab', async () => {
    let finish: (value: BeaconTestOutcome) => void = () => undefined;
    const { handle } = renderPage({
      runTest: () => new Promise<BeaconTestOutcome>((done) => (finish = done))
    });
    await settle();
    fireEvent.click(runButton());
    expect(screen.getByText(RUNNING_COPY)).toBeTruthy();
    expect(RUNNING_COPY).toContain('up to 30 s');
    expect(runButton().getAttribute('aria-busy')).toBe('true');
    finish(COMPLETED);
    await settle();
    expect(outcome()?.getAttribute('data-fdt-beacon-outcome')).toBe('completed');
    expect(outcome()?.textContent).toContain('Beacon test complete');
    expect(handle.tab()).toBe('above-the-fold');
    expect(document.querySelectorAll('[data-fdt="beacon-candidate-row"]')).toHaveLength(2);
  });

  it('lists a refused configuration’s issues and leads to the field', async () => {
    // The production run: the draft is checked before anything is sent.
    const send = vi.fn(() => Promise.resolve({ kind: 'reply', reply: COMPLETED } as const));
    const { handle } = renderPage({
      readSettings: () => Promise.resolve({ ...STORED, heightThreshold: '' }),
      runTest: (draft) =>
        runBeaconTest(draft, {
          isValidSelector: () => true,
          run: send,
          log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
        })
    });
    await settle();
    await run();
    expect(outcome()?.getAttribute('data-fdt-beacon-outcome')).toBe('invalid-config');
    expect(outcome()?.textContent).toContain('Viewport height must be a whole number');
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Review settings' }));
    await settle();
    expect(handle.tab()).toBe('settings');
    expect(document.activeElement).toBe(screen.getByLabelText('Viewport height (px)'));
  });

  it('offers Reload page only where the context can reload', async () => {
    const reload = vi.fn();
    renderPage({
      runTest: () => Promise.resolve({ kind: 'bailed', reason: 'page-scrolled' }),
      reload
    });
    await settle();
    await run();
    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(reload).toHaveBeenCalledTimes(1);
    cleanup();
    renderPage({
      runTest: () => Promise.resolve({ kind: 'bailed', reason: 'page-scrolled' }),
      reload: null
    });
    await settle();
    await run();
    expect(screen.queryByRole('button', { name: 'Reload page' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Run again' })).toBeTruthy();
  });

  it('says when results describe an earlier page load', async () => {
    const { setState } = renderPage();
    await settle();
    await run();
    expect(screen.queryByText(STALE_COPY)).toBeNull();
    setState({ status: 'ready', data: makeFdtData({ scriptSnapshotId: 'page-2' }), fetchedAt: 1 });
    expect(screen.getByText(STALE_COPY)).toBeTruthy();
  });
});

describe('BeaconTesterPage — results', () => {
  it('offers Run on a results tab before any test, and says why after one without results', async () => {
    const { handle, runTest } = renderPage({
      runTest: () => Promise.resolve({ kind: 'busy' })
    });
    await settle();
    handle.setTab('lazy-render');
    expect(screen.getByText(NO_RESULTS_COPY.description)).toBeTruthy();
    fireEvent.click(within(shownPanel()).getByRole('button', { name: 'Run test' }));
    await settle();
    expect(runTest).toHaveBeenCalledTimes(1);
    expect(screen.getByText(NO_RESULTS_COPY.ended)).toBeTruthy();
  });

  it('leads a feature that was not part of the run back to the settings', async () => {
    const { handle } = renderPage({
      runTest: () => Promise.resolve({ ...COMPLETED, results: { ...RESULTS, aboveTheFold: null } })
    });
    await settle();
    await run();
    expect(handle.tab()).toBe('lazy-render');
    handle.setTab('above-the-fold');
    expect(screen.getByText('Not part of this test')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(handle.tab()).toBe('settings');
  });

  it('renders the candidate table with counts, the left-out note, LCP chip and search', async () => {
    vi.useFakeTimers();
    renderPage();
    await settle();
    await run();
    expect(screen.getByRole('tab', { name: /Critical images/ }).textContent).toContain('2');
    expect(document.querySelector('[data-fdt-beacon-list-note]')?.textContent).toContain(
      '2 entries the beacon could not describe left out'
    );
    const rows = () =>
      [...document.querySelectorAll('[data-fdt="beacon-candidate-row"]')].map((row) =>
        row.textContent.replace(/\s+/g, ' ')
      );
    expect(rows()).toEqual([
      'https://a.test/hero.jpgimglcp',
      'https://a.test/bg.webpbg-imgabove-the-fold'
    ]);
    fireEvent.click(document.querySelector('[data-fdt-filter-chip="lcp"]') as HTMLElement);
    expect(rows()).toHaveLength(1);
    fireEvent.click(document.querySelector('[data-fdt-filter-chip="all"]') as HTMLElement);
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'webp' } });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(rows()).toEqual(['https://a.test/bg.webpbg-imgabove-the-fold']);
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'nothing-here' } });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('lists the lazy-render hashes without chips', async () => {
    const { handle } = renderPage();
    await settle();
    await run();
    handle.setTab('lazy-render');
    expect(
      [...document.querySelectorAll('[data-fdt="beacon-lazy-row"]')].map((row) => row.textContent)
    ).toEqual(['hash-one', 'hash-two']);
    expect(shownPanel().querySelector('[data-fdt-filter-chip]')).toBeNull();
  });

  it('shows a timed-out run’s partial results and an empty list’s explanation', async () => {
    const { handle } = renderPage({
      runTest: () =>
        Promise.resolve({
          kind: 'timed-out',
          partial: {
            aboveTheFold: { kind: 'ok', items: [], dropped: 0, truncated: false },
            lazyRender: { kind: 'malformed' }
          }
        })
    });
    await settle();
    await run();
    expect(outcome()?.getAttribute('data-fdt-beacon-outcome')).toBe('timed-out');
    expect(screen.getByText('No critical image candidates')).toBeTruthy();
    handle.setTab('lazy-render');
    expect(screen.getByText("The beacon's list was unreadable")).toBeTruthy();
  });

  it('keeps the tab, the outcome and the form across a data refresh', async () => {
    const { handle, setState } = renderPage();
    await settle();
    await run();
    handle.setTab('lazy-render');
    setState({
      status: 'refreshing',
      data: makeFdtData({ scriptSnapshotId: 'page-1' }),
      requestedAt: 1
    });
    setState({ status: 'ready', data: makeFdtData({ scriptSnapshotId: 'page-1' }), fetchedAt: 2 });
    expect(handle.tab()).toBe('lazy-render');
    expect(outcome()).not.toBeNull();
    expect(document.querySelectorAll('[data-fdt="beacon-lazy-row"]')).toHaveLength(2);
  });
});
