/**
 * The LCP & Vitals session: the highlight choice reaching the analysis
 * request, the vitals read once on demand and again on show once stale, a
 * thrown ask shown as a failed page ask (the ask machine itself:
 * `../ask-run.test.ts`).
 */
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { LcpAnalysisOutcome } from '../../../../lib/lcp-analysis/run-analysis';
import type { Logger } from '../../../../lib/logger';
import type { CurrentVisitOutcome } from '../../../../lib/web-vitals/read-current-visit';
import { ASK_THREW } from '../ask-run';
import { createLcpVitalsSession, type LcpVitalsSessionDeps } from './session';

/** A silent logger. */
function logDouble(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const UNSUPPORTED: LcpAnalysisOutcome = { kind: 'unsupported' };
const READ: CurrentVisitOutcome = {
  kind: 'read',
  vitals: { lcp: { state: 'no-data' }, cls: { state: 'no-data' }, inp: { state: 'no-data' } },
  capped: false
};

describe('createLcpVitalsSession', () => {
  /** Deps with spies. */
  function deps(): LcpVitalsSessionDeps & {
    analyse: ReturnType<typeof vi.fn<LcpVitalsSessionDeps['analyse']>>;
    readVitals: ReturnType<typeof vi.fn<LcpVitalsSessionDeps['readVitals']>>;
  } {
    return {
      analyse: vi.fn<LcpVitalsSessionDeps['analyse']>(() => Promise.resolve(UNSUPPORTED)),
      readVitals: vi.fn<LcpVitalsSessionDeps['readVitals']>(() => Promise.resolve(READ)),
      pageId: () => 'p1',
      pageSettled: () => true,
      log: logDouble()
    };
  }

  it('asks the analysis with the highlight as chosen, off by default', async () => {
    await createRoot(async (dispose) => {
      const d = deps();
      const session = createLcpVitalsSession(d);
      expect(session.highlight()).toBe(false);
      await session.analysis.start();
      session.setHighlight(true);
      await session.analysis.start();
      expect(d.analyse.mock.calls).toEqual([[{ highlight: false }], [{ highlight: true }]]);
      expect(session.analysis.state().shown?.outcome).toBe(UNSUPPORTED);
      dispose();
    });
  });

  it('reads the vitals once on demand, then only on refresh', async () => {
    await createRoot(async (dispose) => {
      const d = deps();
      const session = createLcpVitalsSession(d);
      session.ensureVitals();
      session.ensureVitals(); // pending: not asked twice
      await Promise.resolve();
      await Promise.resolve();
      expect(session.vitals.state().shown?.outcome).toBe(READ);
      session.ensureVitals(); // shown: not asked again
      expect(d.readVitals).toHaveBeenCalledTimes(1);
      await session.vitals.start();
      expect(d.readVitals).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('re-reads the vitals on show once the shown read is stale (the page reloaded)', async () => {
    await createRoot(async (dispose) => {
      const [page, setPage] = createSignal<string | null>('p1');
      const d = { ...deps(), pageId: page };
      const session = createLcpVitalsSession(d);
      session.ensureVitals();
      await Promise.resolve();
      expect(d.readVitals).toHaveBeenCalledTimes(1);
      session.ensureVitals(); // current: not read again
      expect(d.readVitals).toHaveBeenCalledTimes(1);
      setPage('p2');
      expect(session.vitals.stale()).toBe(true);
      session.ensureVitals();
      await Promise.resolve();
      expect(d.readVitals).toHaveBeenCalledTimes(2);
      expect(session.vitals.stale()).toBe(false);
      dispose();
    });
  });

  it('shows a thrown ask as a failed page ask', async () => {
    await createRoot(async (dispose) => {
      const d = deps();
      d.readVitals.mockRejectedValueOnce(new Error('gone'));
      const session = createLcpVitalsSession(d);
      await session.vitals.start();
      expect(session.vitals.state().shown?.outcome).toEqual(ASK_THREW);
      session.dispose();
      dispose();
    });
  });
});
