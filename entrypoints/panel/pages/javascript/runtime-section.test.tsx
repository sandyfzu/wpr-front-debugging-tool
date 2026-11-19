/**
 * The Runtime states section over a session with an injected read: the
 * label and first read on show, the loading state, every miss with typed
 * recoveries, the populated calm list (rows with state + group, Source ×
 * State facets with counts and held empty values, notes for a cut list and
 * for skipped/unknown scripts), the detail (reason, tile, facts, code, code
 * notes, copy; pane and drill-in), a re-read keeping facets and the
 * selection by script (its detail updates in place), the filtered-empty way
 * back, an empty page, and the stale line after a reload.
 */
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntersectionGate } from '../../../../components/ui/code-block';
import { HIGHLIGHT_MAX_CHARS, PLAIN_NOTES } from '../../../../components/ui/code-block';
import type { VirtualItem, VirtualizerFactory } from '../../../../components/ui/virtual-list';
import {
  LIVE_STATE_LABEL,
  RUNTIME_STALE_COPY,
  TEXT_CAPPED_NOTE,
  TEXT_CUT_NOTE
} from '../../../../lib/script-runtime/outcome-view';
import type {
  LiveScriptRecord,
  LiveScriptsOutcome
} from '../../../../lib/script-runtime/read-live';
import { FULL_TEXT_MAX } from '../../../../lib/script-runtime/classify';
import { createDetailPresence, DetailPresenceContext } from '../../state/detail-presence';
import type { DataState } from '../../state/fdt-state-machine';
import { makeFdtData } from '../../state/fixtures';
import { pageIdOf, pageSettledOf } from '../../state/page-identity';
import { createSearchStore } from '../../state/search';
import { FdtDataContext, SearchContext, type FdtDataStore } from '../../state/use-fdt-data';
import type { OpenResource } from '../open-resource';
import {
  installFakeResizeObserver,
  type FakeResizeObservers
} from '../resource-list/fake-resize-observer';
import { DELAYED, liveScript } from './runtime-fixtures';
import { PARTIAL_CODE_COPY_LABEL, PARTIAL_COPY_NOTE } from './runtime-rows';
import { createRuntimeStatesHandle, RuntimeStatesSection } from './runtime-section';
import { createRuntimeStatesSession } from './runtime-session';
import type { CodeBlockSeams } from './code-seams';

/** Every row, keyed as the list keys them (no layout in the test DOM). */
const everyRow: VirtualizerFactory = (options) => ({
  getVirtualItems: (): VirtualItem[] =>
    Array.from({ length: options.count }, (_, index) => ({
      key: options.getItemKey?.(index) ?? index,
      index,
      start: index * 40,
      end: index * 40 + 40,
      size: 40,
      lane: 0
    })),
  getTotalSize: () => options.count * 40,
  measureElement: () => undefined
});

/** Code blocks stay plain text (no highlighter, no observers). */
const CODE_SEAMS: CodeBlockSeams = {
  createObserver: (): IntersectionGate => ({
    observe: () => undefined,
    disconnect: () => undefined
  }),
  loadHighlighter: () => new Promise<never>(() => undefined),
  watchOverflow: () => () => undefined
};

const THEME = liveScript({
  type: DELAYED,
  delayedSrc: 'https://a.test/wp-content/themes/t/main.js',
  status: 'executed'
});
const PLUGIN = liveScript({
  type: DELAYED,
  src: 'https://a.test/wp-content/plugins/p/x.js',
  status: 'failed-network'
});
const PENDING = liveScript({ type: DELAYED, text: 'boot();', id: 'boot', classes: ['early'] });
const OTHER = liveScript({ src: 'https://cdn.test/lib.js' });
const SKIPPED = liveScript({ type: DELAYED, src: 'https://cdn.test/old.js', status: 'skipped' });

/** A read of these scripts. */
function readOf(scripts: readonly LiveScriptRecord[], total = scripts.length): LiveScriptsOutcome {
  return { kind: 'read', scripts, total, truncated: total > scripts.length, baseUrl: null };
}

/** Let queued promise callbacks run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}

let observers: FakeResizeObservers;

beforeEach(() => {
  observers = installFakeResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Render the section with a read double; returns the controls a test drives. */
function renderSection(
  options: {
    read?: () => Promise<LiveScriptsOutcome>;
    reload?: (() => void) | null;
    openResource?: OpenResource | null;
    width?: number;
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
  const read = vi.fn(
    options.read ?? (() => Promise.resolve(readOf([THEME, PLUGIN, PENDING, OTHER, SKIPPED])))
  );
  const session = createRuntimeStatesHandle(() =>
    createRuntimeStatesSession({
      read,
      pageId: () => pageIdOf(state()),
      pageSettled: () => pageSettledOf(state()),
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })
  );
  const reload = options.reload === null ? null : (options.reload ?? vi.fn());
  render(() => (
    <FdtDataContext.Provider value={store}>
      <SearchContext.Provider value={createSearchStore()}>
        <DetailPresenceContext.Provider value={createDetailPresence(() => 'javascript')}>
          <RuntimeStatesSection
            session={session}
            reloadInspectedPage={reload}
            openResource={options.openResource === undefined ? null : options.openResource}
            createVirtualizer={everyRow}
            codeBlock={CODE_SEAMS}
          />
        </DetailPresenceContext.Provider>
      </SearchContext.Provider>
    </FdtDataContext.Provider>
  ));
  return { read, reload, setState };
}

/** Let the list measure its width once its rows are in (pane from 830). */
function layOut(width = 1000): void {
  observers.resize(width);
}

/** Every rendered row. */
function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-fdt="runtime-row"]')];
}

/** The rendered rows' names, in order. */
function rowNames(): string[] {
  return rows().map((row) => row.querySelector('[data-fdt="list-row-name"]')?.textContent ?? '');
}

/** A row by its name. */
function rowNamed(name: string): HTMLElement {
  const row = rows().find(
    (node) => node.querySelector('[data-fdt="list-row-name"]')?.textContent === name
  );
  if (row === undefined) throw new Error(`no row ${name}`);
  return row;
}

/** Open a row's detail by its name. */
function open(name: string): void {
  const button = rowNamed(name).querySelector<HTMLButtonElement>('[data-fdt-row-open]');
  if (button === null) throw new Error(`no open button on ${name}`);
  fireEvent.click(button);
}

/** The open detail (pane or drill-in), or null. */
function detail(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-fdt="detail-pane"], [data-fdt="drill-detail"]');
}

/** The open detail (throws when none). */
function shownDetail(): HTMLElement {
  const found = detail();
  if (found === null) throw new Error('no detail');
  return found;
}

/** A facet value's radio input. */
function facetInput(value: string, facet?: 'Source' | 'State'): HTMLInputElement {
  const scope = facet === undefined ? document : screen.getByRole('radiogroup', { name: facet });
  const input = scope.querySelector<HTMLInputElement>(
    `[data-fdt="choice"][data-fdt-choice-value="${value}"] input`
  );
  if (input === null) throw new Error(`no facet value ${value}`);
  return input;
}

/** Pick a facet value. */
function pick(value: string, facet?: 'Source' | 'State'): void {
  fireEvent.click(facetInput(value, facet));
}

/** A facet value's count. */
function countOf(value: string, facet?: 'Source' | 'State'): string {
  return (
    facetInput(value, facet)
      .closest('[data-fdt="choice"]')
      ?.querySelector('[data-fdt-choice-count]')?.textContent ?? ''
  );
}

describe('RuntimeStatesSection', () => {
  it('carries the live-state label and reads on show, skeleton until the answer', async () => {
    let answer: (outcome: LiveScriptsOutcome) => void = () => undefined;
    const { read } = renderSection({
      read: () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    });
    expect(screen.getByRole('heading', { level: 2, name: LIVE_STATE_LABEL })).toBeTruthy();
    expect(document.querySelector('[data-fdt-runtime-loading]')).not.toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    answer(readOf([THEME]));
    await settle();
    expect(document.querySelector('[data-fdt-runtime-loading]')).toBeNull();
    expect(rowNames()).toEqual(['main.js']);
  });

  it('lists every script on a calm row: name, preview, state and group', async () => {
    renderSection();
    await settle();
    expect(rowNames()).toEqual(['main.js', 'x.js', 'Inline script 1', 'lib.js', 'old.js']);
    const states = [...document.querySelectorAll<HTMLElement>('[data-fdt-runtime-state]')];
    expect(states.map((row) => row.dataset.fdtRuntimeState)).toEqual([
      'executed',
      'failed',
      'pending',
      'not-delayed',
      'skipped'
    ]);
    expect(states.map((row) => row.dataset.fdtRuntimeGroup)).toEqual([
      'theme',
      'plugin',
      'inline',
      'other',
      'other'
    ]);
    // The state in words with its group, never color alone.
    expect(states[2]?.textContent).toBe('PendingInline');
    const preview = (name: string) =>
      rowNamed(name).querySelector('[data-fdt="list-row-preview"]')?.textContent;
    expect(preview('Inline script 1')).toBe('#boot · boot();');
    expect(preview('main.js')).toBe('a.test/wp-content/themes/t/main.js');
    // Rows are text only: no code block, no disclosure.
    expect(document.querySelector('[data-fdt="runtime-row"] [data-fdt="code-block"]')).toBeNull();
    expect(document.querySelector('[data-fdt-runtime-toggle]')).toBeNull();
  });

  it('filters by Source and State together; counts follow the other facet; empty values held', async () => {
    renderSection();
    await settle();
    layOut();
    expect(countOf('pending')).toBe('1');
    expect(facetInput('theme').disabled).toBe(false);
    pick('not-delayed');
    expect(rowNames()).toEqual(['lib.js']);
    pick('any', 'State');
    pick('other');
    expect(rowNames()).toEqual(['lib.js', 'old.js']);
    // The State counts follow the chosen source.
    expect(countOf('executed')).toBe('0');
    cleanup();
    renderSection({ read: () => Promise.resolve(readOf([OTHER])) });
    await settle();
    layOut();
    expect(facetInput('theme').disabled).toBe(true);
  });

  it('notes a cut list and the scripts no State value covers', async () => {
    renderSection({ read: () => Promise.resolve(readOf([THEME, SKIPPED], 1500)) });
    await settle();
    const notes = [...document.querySelectorAll('[data-fdt-runtime-note]')].map(
      (node) => node.textContent
    );
    expect(notes).toEqual([
      'The page has 1,500 scripts; the first 2 are listed.',
      '1 skipped script (a nomodule fallback this browser doesn’t need): shown only while State is “Any”.'
    ]);
  });

  it('opens a URL script: state + reason, the tile, the status attribute, the URL copy', async () => {
    renderSection({ openResource: () => Promise.resolve() });
    await settle();
    layOut();
    open('x.js');
    const pane = shownDetail();
    expect(pane.getAttribute('data-fdt')).toBe('detail-pane');
    expect(pane.querySelector('[data-fdt="detail-kind"]')?.textContent).toBe('External script');
    expect(pane.querySelector('[data-fdt="detail-title"]')?.textContent).toBe('x.js');
    const body = pane.querySelector<HTMLElement>('[data-fdt-runtime-detail]');
    expect(body?.querySelector('[data-fdt-runtime-state]')?.textContent).toBe('FailedPlugins');
    expect(body?.querySelector('[data-fdt="runtime-reason"]')?.textContent).toContain(
      'its file failed to load'
    );
    expect(pane.querySelector('[data-fdt="source-link-open"]')?.textContent).toContain(
      'Open in Sources'
    );
    expect(pane.querySelector('[data-fdt="runtime-facts"]')?.textContent).toContain(
      'failed-network'
    );
    // No inline code: no code section.
    expect(pane.querySelector('[data-fdt="runtime-code"]')).toBeNull();
    expect(within(pane).getByRole('button', { name: 'Script URL — copy' })).toBeTruthy();
  });

  it('keeps a row’s badges on one line: the group leaves a compact row, never the detail', async () => {
    renderSection({ openResource: null });
    await settle();
    layOut();
    const rowLine = document.querySelector<HTMLElement>(
      '[data-fdt="runtime-row"] [data-fdt-runtime-state]'
    );
    expect(rowLine?.className).toContain('flex-nowrap');
    expect(rowLine?.lastElementChild?.className).toContain('@max-regular:hidden');
    open('x.js');
    const detailLine = shownDetail().querySelector<HTMLElement>(
      '[data-fdt-runtime-detail] [data-fdt-runtime-state]'
    );
    expect(detailLine?.className).toContain('flex-wrap');
    expect(detailLine?.lastElementChild?.className ?? '').not.toContain('hidden');
  });

  it('resolves a relative URL against the page base: the tile opens it', async () => {
    const relative = liveScript({ src: 'js/rel.js?ver=3' });
    renderSection({
      openResource: () => Promise.resolve(),
      read: () => Promise.resolve({ ...readOf([relative]), baseUrl: 'https://a.test/shop/' })
    });
    await settle();
    layOut();
    open('rel.js');
    const pane = shownDetail();
    expect(pane.querySelector('[data-fdt="source-link-open"]')?.textContent).toContain(
      'Open in Sources'
    );
    expect(pane.querySelector('[data-fdt="source-link"]')?.textContent).toContain(
      'a.test/shop/js/rel.js'
    );
  });

  it('opens inline code: facts, all the code kept (JSON-LD as data), its notes, a partial copy named so', async () => {
    const cut = liveScript({ type: DELAYED, text: 'cut();' }, true);
    const capped = liveScript({ text: 'x'.repeat(FULL_TEXT_MAX + 1) });
    const json = liveScript({ type: 'application/ld+json', text: '{"@type":"Thing"}' });
    renderSection({
      read: () => Promise.resolve(readOf([PLUGIN, PENDING, cut, capped, json, liveScript()]))
    });
    await settle();
    layOut();
    open('Inline script 1');
    const facts = shownDetail().querySelector('[data-fdt="runtime-facts"]')?.textContent ?? '';
    expect(facts).toContain('Inline code');
    expect(facts).toContain('boot');
    expect(facts).toContain('early');
    expect(shownDetail().querySelector('[data-fdt="runtime-code"]')?.textContent).toContain(
      'boot();'
    );
    expect(shownDetail().querySelector('[data-fdt="runtime-code"] h3')?.textContent).toBe(
      'Code1 line'
    );
    expect(
      within(shownDetail()).getByRole('button', { name: 'Inline script — copy' })
    ).toBeTruthy();
    open('Inline script 2');
    expect(shownDetail().querySelector('[data-fdt-runtime-code-note]')?.textContent).toBe(
      `${TEXT_CUT_NOTE} ${PARTIAL_COPY_NOTE}`
    );
    // A cut code is copied as what it is — never as the inline script.
    expect(
      within(shownDetail()).getByRole('button', { name: `${PARTIAL_CODE_COPY_LABEL} — copy` })
    ).toBeTruthy();
    expect(
      within(shownDetail()).queryByRole('button', { name: 'Inline script — copy' })
    ).toBeNull();
    open('Inline script 3');
    expect(shownDetail().querySelector('[data-fdt-runtime-code-note]')?.textContent).toBe(
      `${TEXT_CAPPED_NOTE} ${PARTIAL_COPY_NOTE}`
    );
    // Past the highlight limit: every kept character shows (plain, the block says so).
    const block = shownDetail().querySelector('[data-fdt="runtime-code"] [data-fdt="code-block"]');
    expect(block?.querySelector('[data-fdt-code-fallback]')?.textContent).toBe(capped.fullText);
    expect(capped.fullText.length).toBeGreaterThan(HIGHLIGHT_MAX_CHARS);
    expect(block?.querySelector('[data-fdt-code-block-plain]')?.textContent).toBe(
      PLAIN_NOTES['too-large']
    );
    expect(shownDetail().querySelector('[data-fdt="runtime-code-cut"]')).toBeNull();
    expect(
      within(shownDetail()).getByRole('button', { name: `${PARTIAL_CODE_COPY_LABEL} — copy` })
    ).toBeTruthy();
    open('Inline script 4');
    expect(shownDetail().querySelector('[data-fdt="detail-kind"]')?.textContent).toBe(
      'Structured data'
    );
    expect(shownDetail().querySelector('[data-fdt="runtime-reason"]')?.textContent).toBe(
      'Structured data (JSON-LD): read as data, never run.'
    );
    open('Inline script 5');
    expect(shownDetail().querySelector('[data-fdt="runtime-code"]')?.textContent).toContain(
      'No code in the tag.'
    );
  });

  it('drills in below the split width, Back returns to the list', async () => {
    renderSection();
    await settle();
    layOut(600);
    open('main.js');
    expect(shownDetail().getAttribute('data-fdt')).toBe('drill-detail');
    const back = document.querySelector<HTMLButtonElement>('[data-fdt="drill-back"]');
    expect(back?.textContent).toContain('Live scripts');
    fireEvent.click(back as HTMLButtonElement);
    expect(detail()).toBeNull();
  });

  it('re-reads on Read again, keeping facets, unchanged rows and the selection by script', async () => {
    const reads = [
      readOf([THEME, PENDING]),
      readOf([
        THEME,
        liveScript({
          type: DELAYED,
          text: 'boot();',
          id: 'boot',
          classes: ['early'],
          status: 'executed'
        })
      ])
    ];
    const { read } = renderSection({ read: () => Promise.resolve(reads.shift() ?? readOf([])) });
    await settle();
    layOut();
    open('Inline script 1');
    expect(
      shownDetail().querySelector('[data-fdt-runtime-detail] [data-fdt-runtime-state]')?.textContent
    ).toBe('PendingInline');
    const before = rowNamed('main.js');
    fireEvent.click(document.querySelector('[data-fdt-runtime-read]') as HTMLButtonElement);
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    // The unchanged row kept its element; the run script's detail stays open and updates.
    expect(rowNamed('main.js')).toBe(before);
    expect(shownDetail().querySelector('[data-fdt="detail-title"]')?.textContent).toBe(
      'Inline script 1'
    );
    expect(
      shownDetail().querySelector('[data-fdt-runtime-detail] [data-fdt-runtime-state]')?.textContent
    ).toBe('ExecutedInline');
    expect(countOf('executed')).toBe('2');
  });

  it('keeps the list mounted under a failed re-read’s notice, then clears it on a good one', async () => {
    const reads: LiveScriptsOutcome[] = [
      readOf([THEME, PENDING]),
      { kind: 'page-unreachable', miss: 'timeout' },
      readOf([THEME, PENDING])
    ];
    renderSection({ read: () => Promise.resolve(reads.shift() ?? readOf([])) });
    await settle();
    layOut();
    pick('theme');
    open('main.js');
    const before = rowNamed('main.js');
    fireEvent.click(document.querySelector('[data-fdt-runtime-read]') as HTMLButtonElement);
    await settle();
    // The failure is named above the kept list; facet, selection and row survive.
    expect(
      document.querySelector('[data-fdt="runtime-outcome"]')?.getAttribute('data-fdt-runtime-miss')
    ).toBe('timeout');
    expect(rowNamed('main.js')).toBe(before);
    expect(rowNames()).toEqual(['main.js']);
    expect(shownDetail().querySelector('[data-fdt="detail-title"]')?.textContent).toBe('main.js');
    fireEvent.click(document.querySelector('[data-fdt-recovery="runtime:retry"]') as HTMLElement);
    await settle();
    expect(document.querySelector('[data-fdt="runtime-outcome"]')).toBeNull();
    expect(rowNamed('main.js')).toBe(before);
    expect(rowNames()).toEqual(['main.js']);
  });

  it('offers Clear filters when the chosen source emptied on a re-read', async () => {
    const reads = [readOf([THEME, OTHER]), readOf([OTHER])];
    renderSection({ read: () => Promise.resolve(reads.shift() ?? readOf([])) });
    await settle();
    layOut();
    pick('theme');
    fireEvent.click(document.querySelector('[data-fdt-runtime-read]') as HTMLButtonElement);
    await settle();
    expect(rowNames()).toEqual([]);
    // The chosen (now empty) value stays selectable; Clear filters shows every script.
    expect(facetInput('theme').disabled).toBe(false);
    fireEvent.click(
      document.querySelector('[data-fdt-no-matches-action="clear-filters"]') as HTMLElement
    );
    expect(rowNames()).toEqual(['lib.js']);
  });

  it('shows an empty page as such, without facets', async () => {
    renderSection({ read: () => Promise.resolve(readOf([])) });
    await settle();
    expect(screen.getByText('No scripts on the page now')).toBeTruthy();
    expect(document.querySelector('[data-fdt="facet-bar"]')).toBeNull();
  });

  it.each([
    ['no-receiver', ['runtime:reload-page', 'runtime:retry']],
    ['timeout', ['runtime:retry', 'runtime:reload-page']],
    ['invalid-reply', ['runtime:reload-page', 'runtime:retry']],
    ['failed', ['runtime:reload-page', 'runtime:retry']]
  ] as const)('words the %s miss with its recoveries', async (miss, recoveries) => {
    const { read, reload } = renderSection({
      read: () => Promise.resolve({ kind: 'page-unreachable', miss })
    });
    await settle();
    expect(
      document.querySelector('[data-fdt="runtime-outcome"]')?.getAttribute('data-fdt-runtime-miss')
    ).toBe(miss);
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-fdt-recovery]')];
    expect(buttons.map((button) => button.dataset.fdtRecovery)).toEqual(recoveries);
    fireEvent.click(document.querySelector('[data-fdt-recovery="runtime:retry"]') as HTMLElement);
    fireEvent.click(
      document.querySelector('[data-fdt-recovery="runtime:reload-page"]') as HTMLElement
    );
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('leaves the reload out where DevTools cannot reload', async () => {
    renderSection({
      read: () => Promise.resolve({ kind: 'page-unreachable', miss: 'no-receiver' }),
      reload: null
    });
    await settle();
    expect(document.querySelector('[data-fdt-recovery="runtime:reload-page"]')).toBeNull();
  });

  it('marks the shown read stale once the page reloaded', async () => {
    const { setState } = renderSection();
    await settle();
    expect(document.querySelector('[data-fdt-runtime-stale]')).toBeNull();
    setState({
      status: 'ready',
      data: makeFdtData({ scriptSnapshotId: 'page-2' }),
      fetchedAt: 1
    } as DataState);
    expect(document.querySelector('[data-fdt-runtime-stale]')?.textContent).toBe(
      RUNTIME_STALE_COPY
    );
    // The list stays while stale.
    expect(rowNames()).toHaveLength(5);
    // A navigation changes the load too: the line names both.
    expect(RUNTIME_STALE_COPY).toMatch(/^The page reloaded or changed since this read/);
  });
});
