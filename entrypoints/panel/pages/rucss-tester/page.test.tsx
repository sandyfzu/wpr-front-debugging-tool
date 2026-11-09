/**
 * The RUCSS Tester page over a session with injected doubles: the form's
 * load states, live pattern validation and pair effects, the disclosure
 * before Run, the run's states (running, finished with copyable request
 * and counts, typed recovery, repeat question), TEST MODE, the style
 * inventory tab, a data refresh that keeps everything, and a page-changing
 * outcome read as stale once the page reloads or navigates.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VirtualItem, VirtualizerFactory } from '../../../../components/ui/virtual-list';
import type { AskOutcome } from '../../../../lib/messaging/bounded-ask';
import type { PageStylesReply } from '../../../../lib/messaging/page-styles';
import {
  DEFAULT_RUCSS_TESTER_CONFIG,
  type RucssTesterConfig
} from '../../../../lib/rucss-tester/config';
import { RUCSS_REQUEST_DISCLOSURE } from '../../../../lib/rucss-tester/endpoint';
import type { RucssTestOutcome } from '../../../../lib/rucss-tester/run-test';
import { RUCSS_RESULT_STYLE_ID } from '../../../../lib/rucss-tester/run-plan';
import {
  RUCSS_TEST_MODE_TAG,
  RUCSS_UNCONFIRMED_REPEAT_WARNING
} from '../../../../lib/rucss-tester/test-mode';
import type { DataState } from '../../state/fdt-state-machine';
import { makeFdtData } from '../../state/fixtures';
import { pageIdOf, pageSettledOf } from '../../state/page-identity';
import { FdtDataContext, type FdtDataStore } from '../../state/use-fdt-data';
import { PAIR_EFFECT_COPY } from './form';
import { createRucssTesterHandle, RucssTesterPage } from './page';
import { pageRunsOf } from './real-deps';
import { RUNNING_COPY } from './run-panel';
import { STATUS_SOFT_CLASSES } from '../../../../components/ui/status-badge';
import { RUCSS_STALE_TITLE as STALE_TITLE } from '../../../../lib/rucss-tester/outcome-view';
import { createRucssTesterSession, type RucssTesterSessionDeps } from './session';

const URL = 'https://mega.wp-rocket.me/support/wpr-rucss-v2.php?url=https://a.test/?1';

const APPLIED: RucssTestOutcome = {
  kind: 'applied',
  requestUrl: URL,
  summary: { removed: 7, preserved: 2, excluded: 1, gone: 0, cssChars: 120 },
  applied: [{ index: 0, count: 4 }]
};

const STYLES: PageStylesReply = {
  styles: [
    {
      kind: 'link',
      id: 'theme-css',
      className: '',
      href: 'https://a.test/theme.css',
      media: '',
      preview: '',
      chars: 0
    },
    {
      kind: 'inline',
      id: RUCSS_RESULT_STYLE_ID,
      className: '',
      href: '',
      media: '',
      preview: '.used{}',
      chars: 7
    }
  ],
  total: 2
};

/** Every row, at a fixed pitch (no layout in the test DOM). */
const everyRow: VirtualizerFactory = (options) => ({
  getVirtualItems: (): VirtualItem[] =>
    Array.from({ length: options.count }, (_, index) => ({
      key: index,
      index,
      start: index * 44,
      end: index * 44 + 44,
      size: 44,
      lane: 0
    })),
  getTotalSize: () => options.count * 44,
  measureElement: () => undefined
});

/** Let queued promise callbacks run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}

afterEach(() => {
  cleanup();
});

/** Render the page with doubles; returns the controls a test drives. */
function renderPage(
  options: {
    runTest?: () => Promise<RucssTestOutcome>;
    listStyles?: () => Promise<AskOutcome<PageStylesReply>>;
    readConfig?: () => Promise<RucssTesterConfig>;
    runs?: number;
    reload?: (() => void) | null;
    /** The first payload's load identity (none by default). */
    pageId?: string;
  } = {}
) {
  const [state, setState] = createSignal<DataState>({
    status: 'ready',
    data: makeFdtData({
      ...(options.runs ? { rucssTestMode: { runs: options.runs } } : {}),
      ...(options.pageId === undefined ? {} : { scriptSnapshotId: options.pageId })
    }),
    fetchedAt: 0
  } as DataState);
  const reloadData = vi.fn();
  const store: FdtDataStore = {
    state,
    start: vi.fn(),
    stop: vi.fn(),
    retry: vi.fn(),
    reload: reloadData
  };
  const deps: RucssTesterSessionDeps = {
    readConfig:
      options.readConfig ??
      (() => Promise.resolve({ ...DEFAULT_RUCSS_TESTER_CONFIG, replacements: [] })),
    writeConfig: vi.fn(() => Promise.resolve()),
    watchConfig: () => () => undefined,
    runTest: options.runTest ?? (() => Promise.resolve(APPLIED)),
    listStyles:
      options.listStyles ?? (() => Promise.resolve({ kind: 'reply', reply: STYLES } as const)),
    pageRuns: () => pageRunsOf(state()),
    pageId: () => pageIdOf(state()),
    pageSettled: () => pageSettledOf(state()),
    onApplied: () => {
      store.reload();
    },
    schedule: () => () => undefined,
    saveDelayMs: 400,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  };
  const handle = createRucssTesterHandle(() => createRucssTesterSession(deps));
  const reload = options.reload === null ? null : (options.reload ?? vi.fn());
  render(() => (
    <FdtDataContext.Provider value={store}>
      <RucssTesterPage handle={handle} reloadInspectedPage={reload} createVirtualizer={everyRow} />
    </FdtDataContext.Provider>
  ));
  return { handle, reloadData, setState, deps, reload };
}

/** The Run button. */
function runButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>('[data-fdt-rucss-run]');
  if (button === null) throw new Error('no Run button');
  return button;
}

describe('RucssTesterPage — form', () => {
  it('holds Run while the settings load, then shows the form and the disclosure', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'RUCSS Tester' })).toBeTruthy();
    expect(runButton().disabled).toBe(true);
    expect(document.querySelector('[data-fdt-rucss-form-loading]')).not.toBeNull();
    await settle();
    expect(runButton().disabled).toBe(false);
    expect(document.querySelector('[data-fdt-rucss-disclosure]')?.textContent).toBe(
      RUCSS_REQUEST_DISCLOSURE
    );
    expect(screen.getByLabelText('Safelist')).toBeTruthy();
    expect(screen.getByLabelText('Stylesheets to keep')).toBeTruthy();
  });

  it('shows an unreadable store with a working retry', async () => {
    const readConfig = vi
      .fn<() => Promise<RucssTesterConfig>>()
      .mockRejectedValueOnce(new Error('dead'))
      .mockResolvedValue(DEFAULT_RUCSS_TESTER_CONFIG);
    renderPage({ readConfig });
    await settle();
    expect(screen.getByText("Couldn't load the test settings")).toBeTruthy();
    expect(runButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await settle();
    expect(screen.getByLabelText('Safelist')).toBeTruthy();
  });

  it('validates stylesheet patterns live, naming the line', async () => {
    renderPage();
    await settle();
    const field = screen.getByLabelText<HTMLTextAreaElement>('Stylesheets to keep');
    fireEvent.input(field, { target: { value: 'ok\n(broken' } });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.querySelector('[data-fdt-field-error]')?.textContent).toMatch(
      /^Line 2 \(“\(broken”\) is not a valid pattern: /
    );
    fireEvent.input(field, { target: { value: 'ok' } });
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect(document.querySelector('[data-fdt-field-error]')).toBeNull();
  });

  it('adds, explains and removes ordered replacements', async () => {
    const { handle } = renderPage();
    await settle();
    expect(screen.getByText('No replacements.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add replacement' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add replacement' }));
    // An unfinished row is skipped; an empty replacement deletes.
    expect(document.querySelector('[data-fdt-rucss-pair-note="skipped"]')?.textContent).toBe(
      PAIR_EFFECT_COPY.skipped
    );
    const search = screen.getByLabelText<HTMLInputElement>('Replacement 1 search');
    fireEvent.input(search, { target: { value: 'color:red' } });
    expect(
      document.querySelector('[data-fdt-rucss-pair="0"] [data-fdt-rucss-pair-note="deletes"]')
        ?.textContent
    ).toBe(PAIR_EFFECT_COPY.deletes);
    fireEvent.input(screen.getByLabelText('Replacement 1 text'), {
      target: { value: 'color:blue' }
    });
    expect(
      document.querySelector('[data-fdt-rucss-pair="0"] [data-fdt-rucss-pair-note]')
    ).toBeNull();
    fireEvent.input(screen.getByLabelText('Replacement 2 search'), { target: { value: '(' } });
    expect(
      document.querySelector('[data-fdt-rucss-pair="1"] [data-fdt-field-error]')?.textContent
    ).toMatch(/^Invalid pattern: /);
    fireEvent.click(screen.getByRole('button', { name: 'Remove replacement 1' }));
    expect(handle.session.form.replacements).toEqual([{ search: '(', replacement: '' }]);
    expect(document.querySelector('[data-fdt-save]')?.getAttribute('data-fdt-save')).toBe(
      'pending'
    );
  });
});

describe('RucssTesterPage — run', () => {
  it('runs, then shows the counts, each pair’s matches and the copyable request', async () => {
    let finish: (outcome: RucssTestOutcome) => void = () => undefined;
    const { reloadData } = renderPage({
      runTest: () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    });
    await settle();
    fireEvent.click(runButton());
    await settle();
    expect(runButton().getAttribute('aria-busy')).toBe('true');
    expect(document.querySelector('[data-fdt-rucss-running]')?.textContent).toBe(RUNNING_COPY);
    // The honest worst case: start, build and apply in turn.
    expect(RUNNING_COPY).toContain('up to 125 s');
    finish(APPLIED);
    await settle();
    const outcome = document.querySelector('[data-fdt="rucss-outcome"]');
    expect(outcome?.getAttribute('data-fdt-rucss-outcome')).toBe('applied');
    expect(screen.getByText('Test applied')).toBeTruthy();
    expect(document.querySelector('[data-fdt="rucss-summary"]')?.textContent).toContain(
      'Styles removed'
    );
    expect(document.querySelector('[data-fdt="rucss-pair-counts"]')?.textContent).toBe(
      'Replacement 1: 4 matches'
    );
    expect(document.querySelector('[data-fdt-rucss-request]')?.textContent).toBe(URL);
    expect(screen.getByRole('button', { name: 'Copy request address' })).toBeTruthy();
    expect(reloadData).toHaveBeenCalledTimes(1);
  });

  it('renders a typed failure with its recoveries, and Run again reruns', async () => {
    const runTest = vi
      .fn<() => Promise<RucssTestOutcome>>()
      .mockResolvedValueOnce({ kind: 'page-unreachable', step: 'start', miss: 'no-receiver' })
      .mockResolvedValue(APPLIED);
    const { reload } = renderPage({ runTest });
    await settle();
    fireEvent.click(runButton());
    await settle();
    expect(screen.getByText("The page isn't listening")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(reload).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
    await settle();
    expect(runTest).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Test applied')).toBeTruthy();
  });

  it('leaves the reload out where the context cannot reload', async () => {
    renderPage({
      reload: null,
      runTest: () => Promise.resolve({ kind: 'apply-failed', failure: 'no-document' })
    });
    await settle();
    fireEvent.click(runButton());
    await settle();
    expect(screen.getByText("This page has nowhere to put the test's CSS")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reload page' })).toBeNull();
  });

  it('leads a pattern failure to its field', async () => {
    renderPage({
      runTest: () =>
        Promise.resolve({
          kind: 'build-failed',
          requestUrl: URL,
          failure: { ok: false, problem: 'exclusion-failed', line: 'a+', message: 'boom' }
        })
    });
    await settle();
    fireEvent.click(runButton());
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Review patterns' }));
    await settle();
    expect(document.activeElement).toBe(screen.getByLabelText('Stylesheets to keep'));
  });

  it('shows TEST MODE for an earlier test and asks before running on top', async () => {
    const runTest = vi.fn(() => Promise.resolve(APPLIED));
    const { reload } = renderPage({ runs: 1, runTest });
    await settle();
    expect(document.querySelector('[data-fdt="test-mode-notice"]')?.textContent).toContain(
      RUCSS_TEST_MODE_TAG
    );
    fireEvent.click(runButton());
    await settle();
    expect(document.querySelector('[data-fdt-rucss-repeat]')).not.toBeNull();
    expect(runTest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload for a clean run' }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-fdt-rucss-repeat]')).toBeNull();
    fireEvent.click(runButton());
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Run on top' }));
    await settle();
    expect(runTest).toHaveBeenCalledTimes(1);
  });

  it('after an unconfirmed apply, Run again asks first; Cancel brings the outcome back', async () => {
    const runTest = vi.fn(() =>
      Promise.resolve<RucssTestOutcome>({
        kind: 'page-unreachable',
        step: 'apply',
        miss: 'timeout'
      })
    );
    const { reloadData } = renderPage({ runTest });
    await settle();
    fireEvent.click(runButton());
    await settle();
    expect(screen.getByText("The page didn't confirm the test")).toBeTruthy();
    expect(reloadData).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
    await settle();
    expect(runTest).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-fdt-rucss-repeat]')?.textContent).toContain(
      RUCSS_UNCONFIRMED_REPEAT_WARNING
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.querySelector('[data-fdt-rucss-repeat]')).toBeNull();
    expect(screen.getByText("The page didn't confirm the test")).toBeTruthy();
  });

  it('a data refresh keeps the form, the outcome and the tab', async () => {
    const { setState, handle } = renderPage({ pageId: 'page-1' });
    await settle();
    fireEvent.input(screen.getByLabelText('Safelist'), { target: { value: '.keep' } });
    fireEvent.click(runButton());
    await settle();
    const outcome = document.querySelector('[data-fdt="rucss-outcome"]');
    setState({
      status: 'ready',
      data: makeFdtData({ scriptSnapshotId: 'page-1', rucssTestMode: { runs: 1 } }),
      fetchedAt: 1
    } as DataState);
    expect(document.querySelector('[data-fdt="rucss-outcome"]')).toBe(outcome);
    expect(screen.getByLabelText<HTMLTextAreaElement>('Safelist').value).toBe('.keep');
    // The page reloads: the result is gone, said once.
    setState({
      status: 'ready',
      data: makeFdtData({ scriptSnapshotId: 'page-2' }),
      fetchedAt: 2
    } as DataState);
    expect(document.querySelector('[data-fdt-rucss-stale]')).not.toBeNull();
    expect(handle.tab()).toBe('test');
  });
});

describe('RucssTesterPage — after the page reloads or navigates', () => {
  /** The shown outcome notice. */
  function notice(): HTMLElement {
    const element = document.querySelector<HTMLElement>('[data-fdt="rucss-outcome"]');
    if (element === null) throw new Error('no outcome notice');
    return element;
  }

  /** The inspected page's next load lands: the shell refetches, then settles on it. */
  function nextLoad(setState: (state: DataState) => void, id: string): void {
    setState({
      status: 'refreshing',
      data: makeFdtData({ scriptSnapshotId: 'page-1', rucssTestMode: { runs: 1 } }),
      requestedAt: 3
    });
    setState({
      status: 'ready',
      data: makeFdtData({ scriptSnapshotId: id }),
      fetchedAt: 4
    });
  }

  it('an applied test no longer reads as a current success, its details kept', async () => {
    const { setState } = renderPage({ pageId: 'page-1' });
    await settle();
    fireEvent.click(runButton());
    await settle();
    // The payload refresh after the apply lands: the result is on the page.
    setState({
      status: 'ready',
      data: makeFdtData({ scriptSnapshotId: 'page-1', rucssTestMode: { runs: 1 } }),
      fetchedAt: 1
    } as DataState);
    expect(screen.getByText('Test applied')).toBeTruthy();
    expect(notice().className).toContain(STATUS_SOFT_CLASSES.ok);
    nextLoad(setState, 'page-2');
    expect(screen.queryByText('Test applied')).toBeNull();
    expect(notice().className).not.toContain(STATUS_SOFT_CLASSES.ok);
    expect(notice().className).toContain(STATUS_SOFT_CLASSES.neutral);
    expect(notice().hasAttribute('data-fdt-rucss-stale')).toBe(true);
    expect(screen.getByText(STALE_TITLE)).toBeTruthy();
    // The run's details stay readable; the next step is a new run, not a reload.
    expect(document.querySelector('[data-fdt-rucss-request]')?.textContent).toBe(URL);
    expect(document.querySelector('[data-fdt="rucss-summary"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Reload page' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
    await settle();
    // A clean page: no repeat question, a fresh current result.
    expect(document.querySelector('[data-fdt-rucss-repeat]')).toBeNull();
    expect(screen.getByText('Test applied')).toBeTruthy();
    expect(notice().hasAttribute('data-fdt-rucss-stale')).toBe(false);
  });

  it('reads stale even when the reload lands before the payload showed the result', async () => {
    const { setState } = renderPage({ pageId: 'page-1' });
    await settle();
    fireEvent.click(runButton());
    await settle();
    setState({
      status: 'ready',
      data: makeFdtData({ scriptSnapshotId: 'page-2' }),
      fetchedAt: 1
    } as DataState);
    expect(screen.queryByText('Test applied')).toBeNull();
    expect(screen.getByText(STALE_TITLE)).toBeTruthy();
  });

  it('an empty result and an unconfirmed apply read stale too', async () => {
    const empty: RucssTestOutcome = {
      ...APPLIED,
      summary: { ...APPLIED.summary, cssChars: 0 }
    };
    const outcomes: RucssTestOutcome[] = [
      empty,
      { kind: 'page-unreachable', step: 'apply', miss: 'timeout' }
    ];
    for (const outcome of outcomes) {
      const { setState } = renderPage({
        pageId: 'page-1',
        runTest: () => Promise.resolve(outcome)
      });
      await settle();
      fireEvent.click(runButton());
      await settle();
      expect(screen.queryByText(STALE_TITLE)).toBeNull();
      nextLoad(setState, 'page-2');
      expect(screen.getByText(STALE_TITLE)).toBeTruthy();
      expect(notice().className).toContain(STATUS_SOFT_CLASSES.neutral);
      expect(screen.queryByRole('button', { name: 'Reload page' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Run again' })).toBeTruthy();
      cleanup();
    }
  });

  it('a repeat question left open closes once the reloaded page carries no test', async () => {
    const { setState } = renderPage({ pageId: 'page-1' });
    await settle();
    fireEvent.click(runButton());
    await settle();
    fireEvent.click(runButton());
    await settle();
    expect(document.querySelector('[data-fdt-rucss-repeat]')).not.toBeNull();
    nextLoad(setState, 'page-2');
    // No sentence about an earlier test on a clean page: the earlier outcome, read stale.
    expect(document.querySelector('[data-fdt-rucss-repeat]')).toBeNull();
    expect(screen.queryByText(RUCSS_UNCONFIRMED_REPEAT_WARNING)).toBeNull();
    expect(screen.getByText(STALE_TITLE)).toBeTruthy();
  });

  it('a failure that left the page untouched keeps its words', async () => {
    const { setState } = renderPage({
      pageId: 'page-1',
      runTest: () => Promise.resolve({ kind: 'apply-failed', failure: 'css-blocked' })
    });
    await settle();
    fireEvent.click(runButton());
    await settle();
    const title = "This page's security policy blocked the test's CSS";
    expect(screen.getByText(title)).toBeTruthy();
    nextLoad(setState, 'page-2');
    expect(screen.getByText(title)).toBeTruthy();
    expect(notice().hasAttribute('data-fdt-rucss-stale')).toBe(false);
  });
});

describe('RucssTesterPage — page styles', () => {
  it('reads the inventory on demand and marks the test result', async () => {
    renderPage();
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: /Page styles/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Inspect page styles' }));
    await settle();
    expect(document.querySelector('[data-fdt-rucss-styles-summary]')?.textContent).toBe(
      '2 styles · 1 inline · 1 stylesheet link'
    );
    const rows = document.querySelectorAll('[data-fdt="rucss-style-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('https://a.test/theme.css');
    expect(rows[0]?.textContent).toContain('#theme-css');
    expect(rows[1]?.textContent).toContain('Test result');
    expect(rows[1]?.textContent).toContain('.used{}');
    // The tab carries the count.
    expect(screen.getByRole('tab', { name: /Page styles/ }).textContent).toContain('2');
  });

  it('names a miss with a retry, and an empty page', async () => {
    const listStyles = vi
      .fn<() => Promise<AskOutcome<PageStylesReply>>>()
      .mockResolvedValueOnce({ kind: 'no-receiver' })
      .mockResolvedValue({ kind: 'reply', reply: { styles: [], total: 0 } });
    renderPage({ listStyles });
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: /Page styles/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Inspect page styles' }));
    await settle();
    expect(screen.getByText("Couldn't read the page's styles")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await settle();
    expect(screen.getByText('No styles on this page')).toBeTruthy();
  });

  it('drops a list of an earlier page load back to idle', async () => {
    const { setState } = renderPage();
    setState({
      status: 'ready',
      data: makeFdtData({ scriptSnapshotId: 'load-1' }),
      fetchedAt: 0
    } as DataState);
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: /Page styles/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Inspect page styles' }));
    await settle();
    expect(document.querySelectorAll('[data-fdt="rucss-style-row"]')).toHaveLength(2);
    // The page reloads: its capture identity changes.
    setState({
      status: 'ready',
      data: makeFdtData({ scriptSnapshotId: 'load-2' }),
      fetchedAt: 1
    } as DataState);
    expect(document.querySelectorAll('[data-fdt="rucss-style-row"]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Inspect page styles' })).toBeTruthy();
  });

  it('offers the inventory from a too-many-styles failure', async () => {
    const { handle } = renderPage({
      runTest: () => Promise.resolve({ kind: 'start-failed', failure: { kind: 'too-many-styles' } })
    });
    await settle();
    fireEvent.click(runButton());
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect page styles' }));
    await settle();
    expect(handle.tab()).toBe('styles');
    expect(handle.session.inventory().status).toBe('ready');
  });
});

describe('pageRunsOf', () => {
  it('reads the TEST MODE fact from loaded data only', () => {
    expect(pageRunsOf({ status: 'idle' })).toBe(0);
    expect(pageRunsOf({ status: 'ready', data: makeFdtData(), fetchedAt: 0 })).toBe(0);
    expect(
      pageRunsOf({
        status: 'refreshing',
        data: makeFdtData({ rucssTestMode: { runs: 3 } })
      } as DataState)
    ).toBe(3);
  });
});
