/**
 * The Runtime states section over a session with an injected read: the
 * label and first read on show, the loading state, every miss with typed
 * recoveries, the populated list (state chips, source chips with disabled
 * empty groups, notes for a cut list and for skipped/unknown scripts),
 * details (reason, fields, code, code notes), a re-read keeping chips and
 * the details of unchanged rows (closing changed ones), the source-empty
 * way back, an empty page, and the stale line after a reload.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntersectionGate } from '../../../../components/ui/code-block';
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
import type { DataState } from '../../state/fdt-state-machine';
import { makeFdtData } from '../../state/fixtures';
import { pageIdOf } from '../../state/page-identity';
import { createSearchStore } from '../../state/search';
import { FdtDataContext, SearchContext, type FdtDataStore } from '../../state/use-fdt-data';
import { DELAYED, liveScript } from './runtime-fixtures';
import { createRuntimeStatesHandle, RuntimeStatesSection } from './runtime-section';
import { createRuntimeStatesSession } from './runtime-session';
import type { CodeBlockSeams } from './script-row';

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
  return { kind: 'read', scripts, total, truncated: total > scripts.length };
}

/** Let queued promise callbacks run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}

afterEach(() => {
  cleanup();
});

/** Render the section with a read double; returns the controls a test drives. */
function renderSection(
  options: { read?: () => Promise<LiveScriptsOutcome>; reload?: (() => void) | null } = {}
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
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })
  );
  const reload = options.reload === null ? null : (options.reload ?? vi.fn());
  render(() => (
    <FdtDataContext.Provider value={store}>
      <SearchContext.Provider value={createSearchStore()}>
        <RuntimeStatesSection
          session={session}
          reloadInspectedPage={reload}
          createVirtualizer={everyRow}
          codeBlock={CODE_SEAMS}
        />
      </SearchContext.Provider>
    </FdtDataContext.Provider>
  ));
  return { read, reload, setState };
}

/** The rendered rows' names, in order. */
function rowNames(): string[] {
  return [...document.querySelectorAll('[data-fdt="runtime-row"]')].map(
    (row) => row.querySelector('.font-mono.text-xs')?.textContent ?? ''
  );
}

/** A chip of the state bar or the source bar. */
function chip(bar: 'state' | 'source', value: string): HTMLButtonElement {
  const scope =
    bar === 'source'
      ? document.querySelector('[data-fdt-runtime-sources]')
      : [...document.querySelectorAll('[data-fdt="filter-bar"]')].find(
          (node) => !node.hasAttribute('data-fdt-runtime-sources')
        );
  const button = scope?.querySelector<HTMLButtonElement>(`[data-fdt-filter-chip="${value}"]`);
  if (button === null || button === undefined) throw new Error(`no ${bar} chip ${value}`);
  return button;
}

/** The Details toggle of a row by name. */
function toggleOf(name: string): HTMLButtonElement {
  const row = [...document.querySelectorAll('[data-fdt="runtime-row"]')].find((node) =>
    node.textContent.includes(name)
  );
  const button = row?.querySelector<HTMLButtonElement>('[data-fdt-runtime-toggle]');
  if (button === null || button === undefined) throw new Error(`no row ${name}`);
  return button;
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

  it('lists every script with its state, group, source and identity', async () => {
    renderSection();
    await settle();
    expect(rowNames()).toEqual(['main.js', 'x.js', 'Inline script 1', 'lib.js', 'old.js']);
    const rows = [...document.querySelectorAll<HTMLElement>('[data-fdt-runtime-state]')];
    expect(rows.map((row) => row.dataset.fdtRuntimeState)).toEqual([
      'executed',
      'failed',
      'pending',
      'not-delayed',
      'skipped'
    ]);
    expect(rows.map((row) => row.dataset.fdtRuntimeGroup)).toEqual([
      'theme',
      'plugin',
      'inline',
      'other',
      'other'
    ]);
    expect(rows[2]?.textContent).toContain('boot();');
    expect(rows[2]?.textContent).toContain('#boot .early');
    expect(rows[0]?.textContent).toContain('https://a.test/wp-content/themes/t/main.js');
  });

  it('filters by state chip and by source chip together; empty groups are held', async () => {
    renderSection();
    await settle();
    expect(chip('state', 'pending').textContent).toContain('1');
    expect(chip('source', 'theme').disabled).toBe(false);
    fireEvent.click(chip('state', 'not-delayed'));
    expect(rowNames()).toEqual(['lib.js']);
    fireEvent.click(chip('state', 'all'));
    fireEvent.click(chip('source', 'other'));
    expect(rowNames()).toEqual(['lib.js', 'old.js']);
    // The state chips count within the chosen source.
    expect(chip('state', 'executed').textContent).toContain('0');
    cleanup();
    renderSection({ read: () => Promise.resolve(readOf([OTHER])) });
    await settle();
    expect(chip('source', 'theme').disabled).toBe(true);
  });

  it('notes a cut list and the scripts no state chip covers', async () => {
    renderSection({ read: () => Promise.resolve(readOf([THEME, SKIPPED], 1500)) });
    await settle();
    const notes = [...document.querySelectorAll('[data-fdt-runtime-note]')].map(
      (node) => node.textContent
    );
    expect(notes).toEqual([
      'The page has 1,500 scripts; the first 2 are listed.',
      '1 skipped script (a nomodule fallback this browser doesn’t need): listed under “All states” only.'
    ]);
  });

  it('opens details with the reason, every field and the code (with its notes)', async () => {
    const cut = liveScript({ type: DELAYED, text: 'cut();' }, true);
    const capped = liveScript({ text: 'x'.repeat(FULL_TEXT_MAX + 1) });
    renderSection({ read: () => Promise.resolve(readOf([PLUGIN, PENDING, cut, capped])) });
    await settle();
    fireEvent.click(toggleOf('x.js'));
    const detail = document.querySelector('[data-fdt-runtime-detail]');
    expect(toggleOf('x.js').getAttribute('aria-expanded')).toBe('true');
    expect(detail?.textContent).toContain('its file failed to load');
    expect(detail?.textContent).toContain('failed-network');
    expect(detail?.textContent).toContain('https://a.test/wp-content/plugins/p/x.js');
    fireEvent.click(toggleOf('Inline script 1'));
    expect(document.body.textContent).toContain('boot();');
    fireEvent.click(toggleOf('Inline script 2'));
    fireEvent.click(toggleOf('Inline script 3'));
    const codeNotes = [...document.querySelectorAll('[data-fdt-runtime-code-note]')].map(
      (node) => node.textContent
    );
    expect(codeNotes).toEqual([TEXT_CUT_NOTE, TEXT_CAPPED_NOTE]);
    fireEvent.click(toggleOf('x.js'));
    expect(toggleOf('x.js').getAttribute('aria-expanded')).toBe('false');
  });

  it('re-reads on Read again, keeping chips and the details of unchanged rows', async () => {
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
    fireEvent.click(chip('state', 'all'));
    fireEvent.click(toggleOf('main.js'));
    fireEvent.click(toggleOf('Inline script 1'));
    const before = document.querySelector('[data-fdt="runtime-row"]');
    fireEvent.click(document.querySelector('[data-fdt-runtime-read]') as HTMLButtonElement);
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    // The unchanged row kept its element and its open details; the changed one closed.
    expect(document.querySelector('[data-fdt="runtime-row"]')).toBe(before);
    expect(toggleOf('main.js').getAttribute('aria-expanded')).toBe('true');
    expect(toggleOf('Inline script 1').getAttribute('aria-expanded')).toBe('false');
    expect(chip('state', 'executed').textContent).toContain('2');
  });

  it('offers the way back when the chosen source emptied on a re-read', async () => {
    const reads = [readOf([THEME, OTHER]), readOf([OTHER])];
    renderSection({ read: () => Promise.resolve(reads.shift() ?? readOf([])) });
    await settle();
    fireEvent.click(chip('source', 'theme'));
    fireEvent.click(document.querySelector('[data-fdt-runtime-read]') as HTMLButtonElement);
    await settle();
    expect(screen.getByText('No theme scripts in this read')).toBeTruthy();
    // The chosen (now empty) chip stays selectable; the way back shows every source.
    expect(chip('source', 'theme').disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Show all sources' }));
    expect(rowNames()).toEqual(['lib.js']);
  });

  it('shows an empty page as such, without chips', async () => {
    renderSection({ read: () => Promise.resolve(readOf([])) });
    await settle();
    expect(screen.getByText('No scripts on the page now')).toBeTruthy();
    expect(document.querySelector('[data-fdt="filter-bar"]')).toBeNull();
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
  });
});
