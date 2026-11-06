/**
 * The LCP & Vitals page over a session with injected doubles: the analysis
 * card's states (never analysed, pending keeping the shown answer, every
 * miss with typed recoveries, unsupported, no LCP, no navigation, the
 * breakdown with its total and notes, the candidates with the LCP marked),
 * the highlight choice, the vitals card's states (first read on open,
 * per-metric values/ratings/unsupported/no data, restored and capped notes,
 * misses, refresh keeping the values), stale answers after a reload, and a
 * data refresh keeping the view.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LCP_PARTS } from '../../../../lib/lcp-analysis/breakdown';
import { LCP_HIGHLIGHT_NOTES, LCP_RESOURCE_NOTES } from '../../../../lib/lcp-analysis/outcome-view';
import type { LcpAnalysisOutcome } from '../../../../lib/lcp-analysis/run-analysis';
import type { LcpCandidateFacts } from '../../../../lib/messaging/lcp-analysis';
import type { CurrentVisitOutcome } from '../../../../lib/web-vitals/read-current-visit';
import {
  CAPPED_NOTE,
  RESTORED_LCP_NOTE,
  RESTORED_NOTE,
  UNSUPPORTED_NOTES,
  VISIT_SCOPE_NOTE
} from '../../../../lib/web-vitals/vitals-view';
import type { DataState } from '../../state/fdt-state-machine';
import { makeFdtData } from '../../state/fixtures';
import { pageIdOf, pageSettledOf } from '../../state/page-identity';
import { FdtDataContext, type FdtDataStore } from '../../state/use-fdt-data';
import { HIGHLIGHT_LABEL, LCP_DISCLOSURE, LCP_STALE_COPY } from './lcp-card';
import { createLcpVitalsHandle, LCP_VITALS_SUBTITLE, LcpVitalsPage } from './page';
import { createLcpVitalsSession, type LcpVitalsSessionDeps } from './session';
import { VITALS_STALE_COPY } from './vitals-card';

const IMAGE: LcpCandidateFacts = {
  startTime: 1200,
  renderTime: 1200,
  loadTime: 900,
  size: 50_000,
  url: 'https://a.test/hero.jpg',
  element: { tag: 'img', id: 'hero', classes: ['wide'] }
};
const TEXT: LcpCandidateFacts = { ...IMAGE, startTime: 400, url: '', element: null };

const ANALYSED: LcpAnalysisOutcome = {
  kind: 'analysed',
  breakdown: {
    kind: 'breakdown',
    total: 1200,
    resource: 'found',
    parts: [
      { key: 'timeToFirstByte', duration: 200, percent: 16.7 },
      { key: 'resourceLoadDelay', duration: 150, percent: 12.5 },
      { key: 'resourceLoadDuration', duration: 550, percent: 45.8 },
      { key: 'elementRenderDelay', duration: 300, percent: 25 }
    ]
  },
  candidates: [TEXT, IMAGE],
  activationStart: 0,
  highlight: 'off'
};

const READ: CurrentVisitOutcome = {
  kind: 'read',
  vitals: {
    lcp: { state: 'measured', value: 1200, rating: 'good' },
    cls: { state: 'unsupported' },
    inp: { state: 'no-data' }
  },
  capped: false
};

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
    analyse?: LcpVitalsSessionDeps['analyse'];
    readVitals?: LcpVitalsSessionDeps['readVitals'];
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
  const analyse = vi.fn(options.analyse ?? (() => Promise.resolve(ANALYSED)));
  const readVitals = vi.fn(options.readVitals ?? (() => Promise.resolve(READ)));
  const session = createLcpVitalsHandle(() =>
    createLcpVitalsSession({
      analyse,
      readVitals,
      pageId: () => pageIdOf(state()),
      pageSettled: () => pageSettledOf(state()),
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })
  );
  const reload = options.reload === null ? null : (options.reload ?? vi.fn());
  render(() => (
    <FdtDataContext.Provider value={store}>
      <LcpVitalsPage session={session} reloadInspectedPage={reload} />
    </FdtDataContext.Provider>
  ));
  return { session, setState, analyse, readVitals, reload };
}

/** An element by selector, or a failure naming it. */
function find(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`no ${selector}`);
  return element;
}

/** Analyse and let the answer land. */
async function analyseNow(): Promise<void> {
  fireEvent.click(find('[data-fdt-lcp-analyse]'));
  await settle();
}

describe('LcpVitalsPage — LCP analysis', () => {
  it('waits for Analyse, saying what it does', async () => {
    const { analyse } = renderPage();
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: 'LCP & Vitals' })).toBeTruthy();
    expect(screen.getByText(LCP_VITALS_SUBTITLE)).toBeTruthy();
    expect(screen.getByText(LCP_DISCLOSURE)).toBeTruthy();
    expect(analyse).not.toHaveBeenCalled();
    expect(document.querySelector('[data-fdt="lcp-outcome"]')).toBeNull();
  });

  it('shows the breakdown, its total and the candidates with the LCP marked', async () => {
    renderPage();
    await analyseNow();
    expect(find('[data-fdt="lcp-outcome"]').textContent).toContain('LCP at 1,200 ms');
    const parts = [...document.querySelectorAll('[data-fdt-lcp-part]')];
    expect(parts.map((part) => part.getAttribute('data-fdt-lcp-part'))).toEqual([...LCP_PARTS]);
    expect(parts[2]?.textContent).toContain('Resource load time');
    expect(parts[2]?.textContent).toContain('550 ms');
    expect(parts[2]?.textContent).toContain('45.8%');
    expect(find('[data-fdt-lcp-total]').textContent).toContain('1,200 ms');
    const candidates = [...document.querySelectorAll('[data-fdt-lcp-candidate]')];
    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.textContent).toContain('Element no longer on the page');
    expect(candidates[0]?.textContent).toContain('Text');
    expect(candidates[0]?.textContent).not.toContain('LCP');
    expect(candidates[1]?.textContent).toContain('img#hero.wide');
    expect(candidates[1]?.textContent).toContain('https://a.test/hero.jpg');
    expect(candidates[1]?.textContent).toContain('LCP');
  });

  it('asks the highlight only when switched on, and says how it went', async () => {
    const { analyse } = renderPage({
      analyse: (request) =>
        Promise.resolve({ ...ANALYSED, highlight: request.highlight ? 'unavailable' : 'off' })
    });
    await analyseNow();
    expect(screen.queryByText(LCP_HIGHLIGHT_NOTES.unavailable ?? '')).toBeNull();
    fireEvent.click(screen.getByLabelText(HIGHLIGHT_LABEL));
    await analyseNow();
    expect(analyse.mock.calls).toEqual([[{ highlight: false }], [{ highlight: true }]]);
    expect(screen.getByText(LCP_HIGHLIGHT_NOTES.unavailable ?? '')).toBeTruthy();
  });

  it('notes a missing resource and a prerendered page', async () => {
    renderPage({
      analyse: () =>
        Promise.resolve({
          ...ANALYSED,
          activationStart: 300,
          breakdown: { ...(ANALYSED as { breakdown: object }).breakdown, resource: 'missing' }
        } as LcpAnalysisOutcome)
    });
    await analyseNow();
    expect(screen.getByText(LCP_RESOURCE_NOTES.missing ?? '')).toBeTruthy();
    expect(
      screen.getByText(/Prerendered page: times count from when it was shown, 300 ms/)
    ).toBeTruthy();
    // Candidate times read from the activation too.
    expect(find('[data-fdt-lcp-candidate="2"]').textContent).toContain('900 ms');
  });

  it('keeps the shown analysis while analysing again', async () => {
    let finish: (outcome: LcpAnalysisOutcome) => void = () => undefined;
    let call = 0;
    renderPage({
      analyse: () =>
        call++ === 0
          ? Promise.resolve(ANALYSED)
          : new Promise((resolve) => {
              finish = resolve;
            })
    });
    await analyseNow();
    fireEvent.click(find('[data-fdt-lcp-analyse]'));
    await settle();
    expect(find('[data-fdt-lcp-analyse]').textContent).toContain('Analysing…');
    expect(document.querySelector('[data-fdt="lcp-breakdown"]')).not.toBeNull();
    finish({ kind: 'unsupported' });
    await settle();
    expect(find('[data-fdt="lcp-outcome"]').textContent).toContain('LCP not supported');
    expect(document.querySelector('[data-fdt="lcp-breakdown"]')).toBeNull();
  });

  it('keeps the shown analysis under a failed re-analysis’s notice', async () => {
    const answers: LcpAnalysisOutcome[] = [ANALYSED, { kind: 'page-unreachable', miss: 'timeout' }];
    renderPage({ analyse: () => Promise.resolve(answers.shift() ?? ANALYSED) });
    await analyseNow();
    const breakdown = find('[data-fdt="lcp-breakdown"]');
    await analyseNow();
    const failure = find('[data-fdt="lcp-failure"]');
    expect(failure.getAttribute('data-fdt-lcp-outcome')).toBe('page-unreachable');
    expect(failure.querySelector('[data-fdt-recovery="lcp-failure:retry"]')).not.toBeNull();
    expect(find('[data-fdt="lcp-outcome"]').textContent).toContain('LCP at 1,200 ms');
    expect(find('[data-fdt="lcp-breakdown"]')).toBe(breakdown);
    await analyseNow();
    expect(document.querySelector('[data-fdt="lcp-failure"]')).toBeNull();
  });

  it('offers typed recoveries for a miss, without Reload where the page cannot reload', async () => {
    const reload = vi.fn();
    const { analyse } = renderPage({
      analyse: () => Promise.resolve({ kind: 'page-unreachable', miss: 'no-receiver' }),
      reload
    });
    await analyseNow();
    expect(find('[data-fdt="lcp-outcome"]').getAttribute('data-fdt-lcp-outcome')).toBe(
      'page-unreachable'
    );
    fireEvent.click(find('[data-fdt-recovery="lcp:reload-page"]'));
    expect(reload).toHaveBeenCalledTimes(1);
    fireEvent.click(find('[data-fdt-recovery="lcp:retry"]'));
    await settle();
    expect(analyse).toHaveBeenCalledTimes(2);
    cleanup();

    renderPage({
      analyse: () => Promise.resolve({ kind: 'page-unreachable', miss: 'failed' }),
      reload: null
    });
    await analyseNow();
    expect(document.querySelector('[data-fdt-recovery="lcp:reload-page"]')).toBeNull();
    expect(find('[data-fdt-recovery="lcp:retry"]').className).toContain('bg-accent-strong');
  });

  it('shows the no-LCP and no-navigation gaps, the latter with its candidates', async () => {
    renderPage({
      analyse: () =>
        Promise.resolve({ ...ANALYSED, breakdown: { kind: 'no-navigation' } } as LcpAnalysisOutcome)
    });
    await analyseNow();
    expect(find('[data-fdt="lcp-outcome"]').textContent).toContain("Can't break the LCP down");
    expect(document.querySelector('[data-fdt="lcp-breakdown"]')).toBeNull();
    expect(document.querySelectorAll('[data-fdt-lcp-candidate]')).toHaveLength(2);
    cleanup();

    renderPage({
      analyse: () =>
        Promise.resolve({
          ...ANALYSED,
          breakdown: { kind: 'no-lcp' },
          candidates: []
        } as LcpAnalysisOutcome)
    });
    await analyseNow();
    expect(find('[data-fdt="lcp-outcome"]').textContent).toContain('No LCP yet');
    expect(document.querySelector('[data-fdt="lcp-candidates"]')).toBeNull();
  });
});

describe('LcpVitalsPage — current-visit vitals', () => {
  it('reads the vitals on open, each metric with its value, rating or state', async () => {
    const { readVitals } = renderPage();
    expect(document.querySelector('[data-fdt-vitals-loading]')).not.toBeNull();
    await settle();
    expect(readVitals).toHaveBeenCalledTimes(1);
    expect(screen.getByText(VISIT_SCOPE_NOTE)).toBeTruthy();
    expect(find('[data-fdt-vital="lcp"]').textContent).toContain('1,200 ms');
    expect(find('[data-fdt-vital="lcp"]').textContent).toContain('Good');
    expect(find('[data-fdt-vital="cls"]').getAttribute('data-fdt-vital-state')).toBe('unsupported');
    expect(find('[data-fdt-vital="cls"]').textContent).toContain(UNSUPPORTED_NOTES.cls);
    expect(find('[data-fdt-vital="inp"]').getAttribute('data-fdt-vital-state')).toBe('no-data');
    expect(document.querySelector('[data-fdt-vitals-note]')).toBeNull();
  });

  it('notes a restored visit (LCP not measured again) and a capped one', async () => {
    renderPage({
      readVitals: () =>
        Promise.resolve({
          kind: 'read',
          vitals: {
            ...(READ as { vitals: object }).vitals,
            lcp: { state: 'no-data' },
            restored: true
          },
          capped: true
        } as CurrentVisitOutcome)
    });
    await settle();
    expect(find('[data-fdt-vital="lcp"]').textContent).toContain(RESTORED_LCP_NOTE);
    const notes = [...document.querySelectorAll('[data-fdt-vitals-note]')].map(
      (note) => note.textContent
    );
    expect(notes).toEqual([RESTORED_NOTE, CAPPED_NOTE]);
  });

  it('refreshes on demand, keeping the shown values while it reads', async () => {
    let finish: (outcome: CurrentVisitOutcome) => void = () => undefined;
    let call = 0;
    const { readVitals } = renderPage({
      readVitals: () =>
        call++ === 0
          ? Promise.resolve(READ)
          : new Promise((resolve) => {
              finish = resolve;
            })
    });
    await settle();
    fireEvent.click(find('[data-fdt-vitals-refresh]'));
    await settle();
    expect(readVitals).toHaveBeenCalledTimes(2);
    expect(find('[data-fdt-vital="lcp"]').textContent).toContain('1,200 ms');
    finish({
      ...READ,
      vitals: {
        ...(READ as { vitals: object }).vitals,
        lcp: { state: 'measured', value: 4100, rating: 'poor' }
      }
    } as CurrentVisitOutcome);
    await settle();
    expect(find('[data-fdt-vital="lcp"]').textContent).toContain('4,100 ms');
    expect(find('[data-fdt-vital="lcp"]').textContent).toContain('Poor');
  });

  it('keeps the shown values under a failed refresh’s notice, until a good read', async () => {
    const reads: CurrentVisitOutcome[] = [
      READ,
      { kind: 'page-unreachable', miss: 'timeout' },
      READ
    ];
    renderPage({ readVitals: () => Promise.resolve(reads.shift() ?? READ) });
    await settle();
    const rows = find('[data-fdt="vitals-rows"]');
    fireEvent.click(find('[data-fdt-vitals-refresh]'));
    await settle();
    expect(find('[data-fdt="vitals-outcome"]').getAttribute('data-fdt-vitals-miss')).toBe(
      'timeout'
    );
    expect(find('[data-fdt="vitals-rows"]')).toBe(rows);
    expect(find('[data-fdt-vital="lcp"]').textContent).toContain('1,200 ms');
    fireEvent.click(find('[data-fdt-recovery="vitals:retry"]'));
    await settle();
    expect(document.querySelector('[data-fdt="vitals-outcome"]')).toBeNull();
    expect(find('[data-fdt-vital="lcp"]').textContent).toContain('1,200 ms');
  });

  it('names a missed read with its recoveries', async () => {
    const reload = vi.fn();
    const { readVitals } = renderPage({
      readVitals: () => Promise.resolve({ kind: 'page-unreachable', miss: 'timeout' }),
      reload
    });
    await settle();
    const notice = find('[data-fdt="vitals-outcome"]');
    expect(notice.getAttribute('data-fdt-vitals-miss')).toBe('timeout');
    expect(notice.textContent).toContain("The page didn't answer in time");
    fireEvent.click(find('[data-fdt-recovery="vitals:retry"]'));
    await settle();
    expect(readVitals).toHaveBeenCalledTimes(2);
    fireEvent.click(find('[data-fdt-recovery="vitals:reload-page"]'));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('LcpVitalsPage — page loads and refreshes', () => {
  it('marks both answers stale once the page reloaded, and keeps them through a data refresh', async () => {
    const { setState } = renderPage();
    await analyseNow();
    setState({
      status: 'refreshing',
      data: makeFdtData({ scriptSnapshotId: 'page-1' }),
      requestedAt: 1
    });
    expect(document.querySelector('[data-fdt-lcp-stale]')).toBeNull();
    expect(document.querySelector('[data-fdt="lcp-breakdown"]')).not.toBeNull();
    setState({
      status: 'ready',
      data: makeFdtData({ scriptSnapshotId: 'page-2' }),
      fetchedAt: 2
    } as DataState);
    expect(screen.getByText(LCP_STALE_COPY)).toBeTruthy();
    expect(screen.getByText(VITALS_STALE_COPY)).toBeTruthy();
    // A navigation changes the load too: the lines name both.
    expect(LCP_STALE_COPY).toMatch(/^The page reloaded or changed since this analysis/);
    expect(VITALS_STALE_COPY).toMatch(/^The page reloaded or changed since this read/);
  });
});
