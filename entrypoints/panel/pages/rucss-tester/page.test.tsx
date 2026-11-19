/**
 * The RUCSS Tester page over a session with injected doubles: the tool
 * layout (result column first, settings beside it from @wide, one heading
 * tree, the save state in the settings heading), the folding sections
 * (summaries, problems kept in view, seeded open state, remembered across a
 * remount), the form's load states, live pattern validation and pair
 * effects, the disclosure before Run, the run's states (never run, running
 * skeleton, finished with copyable request and counts, typed recovery,
 * repeat question, held by a save failure), TEST MODE, the style inventory
 * tab on calm rows, a data refresh that keeps everything, and a
 * page-changing outcome read as stale once the page reloads or navigates.
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
import { createRucssTesterHandle, reviewTarget, RucssTesterPage } from './page';
import { pageRunsOf } from './real-deps';
import { BLOCKED_COPY, HELD_COPY, RESULT_EMPTY, RESULT_PREVIEW, RUNNING_COPY } from './run-panel';
import { STATUS_SOFT_CLASSES, STATUS_TEXT_CLASSES } from '../../../../components/ui/status-badge';
import {
  RUCSS_STALE_TITLE as STALE_TITLE,
  type RucssOutcomeView
} from '../../../../lib/rucss-tester/outcome-view';
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

/**
 * A settings section's disclosure button.
 *
 * @param section The section id.
 */
function sectionToggle(section: 'request' | 'keep' | 'adjust'): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    `[data-fdt-rucss-section="${section}"] [data-fdt-rucss-section-toggle]`
  );
  if (button === null) throw new Error(`no ${section} section`);
  return button;
}

/**
 * Open a folded settings section (fails when it is already open).
 *
 * @param section The section id.
 */
function openSection(section: 'request' | 'keep' | 'adjust'): void {
  expect(sectionToggle(section).getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(sectionToggle(section));
  expect(sectionToggle(section).getAttribute('aria-expanded')).toBe('true');
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
    // Default settings: the advanced sections start folded, their fields one click away.
    expect(screen.queryByLabelText('Stylesheets to keep')).toBeNull();
    openSection('keep');
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
    openSection('keep');
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
    openSection('adjust');
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

  it('renders the styles as calm list-kit rows under a column header', async () => {
    renderPage();
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: /Page styles/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Inspect page styles' }));
    await settle();
    expect(document.querySelector('[data-fdt="rucss-styles"]')?.className).toContain('@container');
    expect(document.querySelector('[data-fdt="list-head"]')?.textContent).toBe('StyleCharsTest');
    const rows = [...document.querySelectorAll<HTMLElement>('[data-fdt="rucss-style-row"]')];
    // Static calm rows: no hairlines, no hover promise, no open button.
    for (const row of rows) {
      expect(row.getAttribute('role')).toBe('listitem');
      expect(row.className).toContain('min-h-14.5');
      expect(row.className).not.toContain('border');
      expect(row.className).not.toContain('hover:');
      expect(row.querySelector('[data-fdt-row-open]')).toBeNull();
    }
    const names = rows.map((row) => row.querySelector('[data-fdt="list-row-name"]')?.textContent);
    expect(names).toEqual(['theme.css', `#${RUCSS_RESULT_STYLE_ID}`]);
    expect(rows[0]?.querySelector('[data-fdt="list-row-preview"]')?.textContent).toBe(
      '#theme-css · https://a.test/theme.css'
    );
    // A link's characters are never read: its size cell stays empty.
    expect(rows[0]?.querySelector('[data-fdt="list-row-size"]')).toBeNull();
    expect(rows[1]?.querySelector('[data-fdt="list-row-size"]')?.textContent).toBe('7');
    const chip = rows[1]?.querySelector('[data-fdt="state-chip"]');
    expect(chip?.getAttribute('data-fdt-state')).toBe('test-result');
    expect(chip?.getAttribute('data-fdt-source')).toBe('simulated');
    expect(rows[0]?.querySelector('[data-fdt="state-chip"]')).toBeNull();
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

describe('RucssTesterPage — tool layout', () => {
  it('puts the result column (run bar first) before the settings column', async () => {
    renderPage();
    await settle();
    const result = document.querySelector('[data-fdt="rucss-result-column"]');
    const settings = document.querySelector('[data-fdt="rucss-settings"]');
    expect(result?.getAttribute('aria-label')).toBe('Test result');
    expect(result?.firstElementChild?.querySelector('[data-fdt="rucss-run"]')).not.toBeNull();
    // DOM order: the run bar leads the single column; from @wide the grid places settings left.
    expect(
      result !== null &&
        settings !== null &&
        result.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(result?.className).toContain('@wide:[grid-area:result]');
    expect(settings?.className).toContain('@wide:[grid-area:settings]');
    expect(settings?.className).toContain('@wide:overflow-y-auto');
    expect(result?.parentElement?.className).toContain('@wide:grid-cols-[21.25rem_minmax(0,1fr)]');
  });

  it('keeps one heading tree: the page h1, the Settings h2, a section h3 each', async () => {
    renderPage();
    await settle();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Settings' })).toBeTruthy();
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
    ).toEqual([
      expect.stringContaining('Request'),
      expect.stringContaining('Styles to keep'),
      expect.stringContaining('Adjust the result')
    ]);
  });

  it('shows the save state beside the Settings heading once loaded, never in a card footer', async () => {
    renderPage();
    expect(document.querySelector('[data-fdt-save]')).toBeNull();
    await settle();
    const save = document.querySelector('[data-fdt-save]');
    expect(save?.getAttribute('data-fdt-save')).toBe('saved');
    expect(save?.textContent).toBe('Saved');
    expect(save?.closest('[data-fdt="rucss-settings"]')).not.toBeNull();
    expect(document.querySelector('[data-fdt="card-footer"]')).toBeNull();
    fireEvent.input(screen.getByLabelText('Safelist'), { target: { value: '.a' } });
    expect(document.querySelector('[data-fdt-save]')?.getAttribute('data-fdt-save')).toBe(
      'pending'
    );
  });

  it('holds the settings skeleton, one bar per section, while they load', () => {
    renderPage({ readConfig: () => new Promise(() => undefined) });
    const loading = document.querySelector('[data-fdt-rucss-form-loading]');
    expect(loading?.children).toHaveLength(3);
    expect(document.querySelector('[data-fdt="rucss-form"]')).toBeNull();
  });
});

describe('RucssTesterPage — settings sections', () => {
  it('sums up each section in its header, live', async () => {
    renderPage();
    await settle();
    /** A section's summary words. */
    const summary = (section: 'request' | 'keep' | 'adjust') =>
      sectionToggle(section).querySelector('[data-fdt-rucss-section-summary]')?.textContent;
    expect(summary('request')).toBe('Desktop');
    expect(summary('keep')).toBe('5 always kept');
    expect(summary('adjust')).toBe('Empty');
    fireEvent.input(screen.getByLabelText('Safelist'), { target: { value: '.a\n.b' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Mobile' }));
    expect(summary('request')).toBe('Mobile · 2 safelist entries');
    openSection('adjust');
    fireEvent.click(screen.getByRole('button', { name: 'Add replacement' }));
    expect(summary('adjust')).toBe('1 replacement');
  });

  it('keeps a pattern problem in view in the folded header', async () => {
    renderPage();
    await settle();
    openSection('keep');
    fireEvent.input(screen.getByLabelText('Stylesheets to keep'), { target: { value: '(' } });
    fireEvent.click(sectionToggle('keep'));
    expect(sectionToggle('keep').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Stylesheets to keep')).toBeNull();
    const problem = sectionToggle('keep').querySelector('[data-fdt-rucss-section-problem]');
    expect(problem?.textContent).toBe('1 invalid pattern');
    expect(problem?.className).toContain(STATUS_TEXT_CLASSES.error);
    expect(sectionToggle('adjust').querySelector('[data-fdt-rucss-section-problem]')).toBeNull();
  });

  it('counts a repeated invalid pattern once, as its pattern count does', async () => {
    renderPage();
    await settle();
    openSection('keep');
    fireEvent.input(screen.getByLabelText('Stylesheets to keep'), { target: { value: '(\n(' } });
    // Each typed line keeps its own error line; the header counts patterns.
    expect(screen.getAllByText(/is not a valid pattern/)).toHaveLength(2);
    fireEvent.click(sectionToggle('keep'));
    const header = sectionToggle('keep');
    expect(header.querySelector('[data-fdt-rucss-section-summary]')?.textContent).toBe('1 pattern');
    expect(header.querySelector('[data-fdt-rucss-section-problem]')?.textContent).toBe(
      '1 invalid pattern'
    );
  });

  it('keeps the invalid replacement searches in view in the folded header', async () => {
    renderPage({
      readConfig: () =>
        Promise.resolve({
          ...DEFAULT_RUCSS_TESTER_CONFIG,
          replacements: [
            { search: '(', replacement: '' },
            { search: 'ok', replacement: 'x' },
            { search: '[', replacement: 'y' },
            { search: '', replacement: 'z' }
          ]
        })
    });
    await settle();
    // Filled, so open: fold it to read the header alone.
    fireEvent.click(sectionToggle('adjust'));
    expect(sectionToggle('adjust').getAttribute('aria-expanded')).toBe('false');
    const problem = sectionToggle('adjust').querySelector('[data-fdt-rucss-section-problem]');
    // Only the two searches that do not compile: the valid and the unfinished rows count as none.
    expect(problem?.textContent).toBe('2 invalid patterns');
    expect(problem?.className).toContain(STATUS_TEXT_CLASSES.error);
    expect(sectionToggle('keep').querySelector('[data-fdt-rucss-section-problem]')).toBeNull();
  });

  it('opens a section that holds settings, wires the button to its body', async () => {
    renderPage({
      readConfig: () =>
        Promise.resolve({
          ...DEFAULT_RUCSS_TESTER_CONFIG,
          excludeFiles: 'theme\\.css',
          replacements: []
        })
    });
    await settle();
    expect(sectionToggle('request').getAttribute('aria-expanded')).toBe('true');
    expect(sectionToggle('keep').getAttribute('aria-expanded')).toBe('true');
    expect(sectionToggle('adjust').getAttribute('aria-expanded')).toBe('false');
    const body = document.getElementById(sectionToggle('keep').getAttribute('aria-controls') ?? '');
    expect(body?.contains(screen.getByLabelText('Stylesheets to keep'))).toBe(true);
    // The chevron turns with the token motion (open = rotated).
    expect(sectionToggle('keep').querySelector('svg')?.getAttribute('class')).toContain(
      'rotate-90'
    );
    expect(sectionToggle('adjust').querySelector('svg')?.getAttribute('class')).not.toContain(
      'rotate-90'
    );
  });

  it('never folds a section while typing, and remembers the choice across a remount', async () => {
    const { handle } = renderPage();
    await settle();
    openSection('keep');
    const field = screen.getByLabelText('Stylesheets to keep');
    fireEvent.input(field, { target: { value: 'x' } });
    fireEvent.input(field, { target: { value: '' } });
    expect(sectionToggle('keep').getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(sectionToggle('request'));
    cleanup();
    // Unmounting the tabs is not a tab choice: the Test tab stays the remembered one.
    expect(handle.tab()).toBe('test');
    // The route is left and visited again: the same handle, the same sections.
    render(() => (
      <FdtDataContext.Provider
        value={{
          state: () => ({ status: 'ready', data: makeFdtData(), fetchedAt: 0 }),
          start: vi.fn(),
          stop: vi.fn(),
          retry: vi.fn(),
          reload: vi.fn()
        }}
      >
        <RucssTesterPage handle={handle} reloadInspectedPage={null} createVirtualizer={everyRow} />
      </FdtDataContext.Provider>
    ));
    expect(sectionToggle('keep').getAttribute('aria-expanded')).toBe('true');
    expect(sectionToggle('request').getAttribute('aria-expanded')).toBe('false');
  });

  it('a review-patterns recovery opens the folded section of its pair', async () => {
    renderPage({
      readConfig: () =>
        Promise.resolve({
          ...DEFAULT_RUCSS_TESTER_CONFIG,
          replacements: [{ search: '(', replacement: '' }]
        }),
      runTest: () =>
        Promise.resolve({
          kind: 'invalid-config',
          problems: [{ kind: 'replacement-pattern', index: 0, search: '(', message: 'bad' }]
        })
    });
    await settle();
    // Filled, so open: fold it to prove the recovery unfolds it.
    fireEvent.click(sectionToggle('adjust'));
    fireEvent.click(runButton());
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Review patterns' }));
    await settle();
    expect(sectionToggle('adjust').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(screen.getByLabelText('Replacement 1 search'));
  });
});

describe('RucssTesterPage — result side', () => {
  it('names what a test produces before any run, then gives way to the outcome', async () => {
    renderPage();
    await settle();
    const empty = document.querySelector('[data-fdt="rucss-empty"]');
    expect(empty?.textContent).toContain(RESULT_EMPTY.title);
    expect(empty?.textContent).toContain(RESULT_EMPTY.description);
    expect(empty?.querySelectorAll('li')).toHaveLength(RESULT_PREVIEW.length);
    // Painted, not transparent: its text keeps a computable background below the fold.
    expect(empty?.closest('[data-fdt="card"]')?.className).toContain('bg-surface-0');
    fireEvent.click(runButton());
    await settle();
    expect(document.querySelector('[data-fdt="rucss-empty"]')).toBeNull();
    const result = document.querySelector('[data-fdt="rucss-result"]');
    // The counts and the request sit on the result card, beside the notice, not in its tint.
    expect(
      result?.querySelector('[data-fdt="rucss-outcome"] [data-fdt="rucss-summary"]')
    ).toBeNull();
    expect(result?.querySelector(':scope > [data-fdt="rucss-outcome"]')).not.toBeNull();
    expect(result?.querySelector('[data-fdt="rucss-summary"]')).not.toBeNull();
    expect(result?.querySelector('[data-fdt-rucss-request]')).not.toBeNull();
  });

  it('offers the empty card only once Run is available', async () => {
    let load: (config: RucssTesterConfig) => void = () => undefined;
    renderPage({
      readConfig: () =>
        new Promise((resolve) => {
          load = resolve;
        })
    });
    await settle();
    expect(runButton().disabled).toBe(true);
    expect(document.querySelector('[data-fdt="rucss-empty"]')).toBeNull();
    expect(document.querySelector('[data-fdt-rucss-result-held="loading"]')).not.toBeNull();
    load(DEFAULT_RUCSS_TESTER_CONFIG);
    await settle();
    expect(runButton().disabled).toBe(false);
    expect(document.querySelector('[data-fdt-rucss-result-held]')).toBeNull();
    expect(document.querySelector('[data-fdt="rucss-empty"]')).not.toBeNull();
  });

  it('says Run is held where the result goes when the settings fail to load', async () => {
    const readConfig = vi
      .fn<() => Promise<RucssTesterConfig>>()
      .mockRejectedValueOnce(new Error('dead'))
      .mockResolvedValue(DEFAULT_RUCSS_TESTER_CONFIG);
    renderPage({ readConfig });
    await settle();
    expect(runButton().disabled).toBe(true);
    expect(document.querySelector('[data-fdt="rucss-empty"]')).toBeNull();
    const held = document.querySelector('[data-fdt-rucss-result-held="failed"]');
    expect(held?.textContent).toBe(HELD_COPY);
    expect(held?.closest('[data-fdt="rucss-result-column"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await settle();
    expect(document.querySelector('[data-fdt-rucss-result-held]')).toBeNull();
    expect(document.querySelector('[data-fdt="rucss-empty"]')).not.toBeNull();
  });

  it('shows a result-shaped skeleton during the run only, with no Cancel', async () => {
    let finish: (outcome: RucssTestOutcome) => void = () => undefined;
    renderPage({
      runTest: () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    });
    await settle();
    expect(document.querySelector('[data-fdt-rucss-result-loading]')).toBeNull();
    fireEvent.click(runButton());
    await settle();
    const loading = document.querySelector('[data-fdt-rucss-result-loading]');
    // The notice, one line per count, the request line.
    expect(loading?.children).toHaveLength(3);
    expect(loading?.children[1]?.children).toHaveLength(5);
    expect(document.querySelector('[data-fdt="rucss-empty"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    finish(APPLIED);
    await settle();
    expect(document.querySelector('[data-fdt-rucss-result-loading]')).toBeNull();
    expect(document.querySelector('[data-fdt="rucss-outcome"]')).not.toBeNull();
  });

  it('says a run held by a save failure where the result goes', async () => {
    const { deps } = renderPage();
    await settle();
    vi.mocked(deps.writeConfig).mockRejectedValue(new Error('quota'));
    fireEvent.input(screen.getByLabelText('Safelist'), { target: { value: '.a' } });
    fireEvent.click(runButton());
    await settle();
    const blocked = document.querySelector('[data-fdt-rucss-blocked]');
    expect(blocked?.textContent).toBe(BLOCKED_COPY);
    expect(blocked?.closest('[data-fdt="rucss-result-column"]')).not.toBeNull();
    // The heading's save state names the failure the line points to.
    expect(document.querySelector('[data-fdt-save]')?.getAttribute('data-fdt-save')).toBe('failed');
  });
});

describe('reviewTarget', () => {
  /** A view focusing `focus` (the other fields don't matter here). */
  const view = (focus: RucssOutcomeView['focus']): RucssOutcomeView =>
    ({ focus }) as RucssOutcomeView;

  it('names each focused field with the section that holds it', () => {
    expect(reviewTarget(view({ field: 'excludeFiles' }))).toEqual({
      id: 'rucss-field-excludeFiles',
      section: 'keep'
    });
    expect(reviewTarget(view({ field: 'prepend' }))).toEqual({
      id: 'rucss-field-prepend',
      section: 'adjust'
    });
    expect(reviewTarget(view({ field: 'replacement', index: 2 }))).toEqual({
      id: 'rucss-pair-2-search',
      section: 'adjust'
    });
  });

  it('falls back to the stylesheet patterns when no field is named', () => {
    expect(reviewTarget(view(null))).toEqual({ id: 'rucss-field-excludeFiles', section: 'keep' });
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
