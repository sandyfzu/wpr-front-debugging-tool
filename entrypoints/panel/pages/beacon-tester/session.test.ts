/**
 * The beacon tester session over injected doubles: settings load and edits
 * (device switch resets the thresholds, selector reset), live issues, the
 * run (the form's draft as shown at Run, ignored while running or loading,
 * a throwing run ends), results of each outcome, and stale results after a
 * page reload.
 */
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BeaconTestDraft } from '../../../../lib/beacon-test/config';
import type { BeaconTestResults } from '../../../../lib/beacon-test/results';
import type { BeaconTestOutcome } from '../../../../lib/beacon-test/run-test';
import {
  DEFAULT_BEACON_TEST_SETTINGS,
  type BeaconTestSettings
} from '../../../../lib/beacon-test/settings';
import {
  BEACON_RUN_THREW_OUTCOME,
  createBeaconTesterSession,
  resultsOf,
  type BeaconTesterSessionDeps
} from './session';

const RESULTS: BeaconTestResults = {
  aboveTheFold: { kind: 'ok', items: [], dropped: 0, truncated: false },
  lazyRender: null
};
const COMPLETED: BeaconTestOutcome = { kind: 'completed', results: RESULTS, scriptErrors: [] };

/** Stored settings that can run. */
const STORED: BeaconTestSettings = { ...DEFAULT_BEACON_TEST_SETTINGS, aboveTheFold: true };

/** Let queued promise callbacks run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

/** Build a session in a root with doubles; returns the doubles too. */
function setup(overrides: Partial<BeaconTesterSessionDeps> = {}) {
  const [pageId, setPageId] = createSignal<string | null>('page-1');
  const error = vi.fn();
  const deps = {
    readSettings: vi.fn(() => Promise.resolve(STORED)),
    writeSettings: vi.fn<(settings: BeaconTestSettings) => Promise<void>>(() => Promise.resolve()),
    watchSettings: () => () => undefined,
    runTest: vi.fn<(draft: BeaconTestDraft) => Promise<BeaconTestOutcome>>(() =>
      Promise.resolve(COMPLETED)
    ),
    // A parser double: bare tag names and their lists only (the defaults are tag names).
    isValidSelector: (selector: string) => /^[a-z]+(,[a-z]+)*$/.test(selector),
    pageId,
    schedule: () => () => undefined,
    saveDelayMs: 400,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error },
    ...overrides
  };
  const session = createRoot((dispose) => {
    disposers.push(dispose);
    return createBeaconTesterSession(deps);
  });
  disposers.push(session.dispose);
  return { session, deps, setPageId, error };
}

describe('createBeaconTesterSession — settings', () => {
  it('loads the stored settings and writes edits (flush)', async () => {
    const { session, deps } = setup();
    expect(session.load()).toEqual({ status: 'loading' });
    await settle();
    expect(session.load()).toEqual({ status: 'ready' });
    expect(session.form.aboveTheFold).toBe(true);
    session.setText('lazyRenderThreshold', '2400');
    session.setFlag('lazyRender', true);
    await expect(session.flush()).resolves.toBe(true);
    expect(deps.writeSettings).toHaveBeenLastCalledWith({
      ...STORED,
      lazyRender: true,
      lazyRenderThreshold: '2400'
    });
  });

  it('switching the device resets the viewport thresholds to its defaults (a same value does not)', async () => {
    const { session } = setup();
    await settle();
    session.setText('widthThreshold', '1234');
    session.setFlag('mobile', true);
    expect([
      session.form.mobile,
      session.form.widthThreshold,
      session.form.heightThreshold
    ]).toEqual([true, '393', '830']);
    session.setText('widthThreshold', '400');
    session.setFlag('mobile', true);
    expect(session.form.widthThreshold).toBe('400');
    session.setFlag('mobile', false);
    expect([session.form.widthThreshold, session.form.heightThreshold]).toEqual(['1600', '700']);
  });

  it('restores the default selectors', async () => {
    const { session } = setup();
    await settle();
    session.setText('selectorText', 'img');
    session.resetSelectors();
    expect(session.form.selectorText).toBe(DEFAULT_BEACON_TEST_SETTINGS.selectorText);
  });

  it('checks the settings live with the run’s own check', async () => {
    const { session } = setup();
    await settle();
    expect(session.issues()).toEqual([]);
    session.setFlag('aboveTheFold', false);
    expect(session.issues().map((issue) => issue.kind)).toEqual(['no-feature']);
    session.setFlag('lazyRender', true);
    session.setText('heightThreshold', '7O0');
    expect(session.issues()).toEqual([{ kind: 'threshold', field: 'heightThreshold' }]);
    session.setFlag('aboveTheFold', true);
    session.setText('heightThreshold', '700');
    session.setText('selectorText', 'img\n\ndiv[x');
    expect(session.issues()).toEqual([{ kind: 'selector-invalid', selector: 'div[x' }]);
  });
});

describe('createBeaconTesterSession — run', () => {
  it('tests the form as shown at Run and keeps the draft and page with the outcome', async () => {
    const { session, deps } = setup();
    await settle();
    session.setText('widthThreshold', '1200');
    const run = session.start();
    expect(session.run()).toEqual({ status: 'running' });
    expect(deps.runTest).toHaveBeenCalledWith(
      expect.objectContaining({
        widthThreshold: 1200,
        features: { aboveTheFold: true, lazyRender: false }
      })
    );
    await run;
    expect(session.run()).toMatchObject({
      status: 'finished',
      outcome: COMPLETED,
      page: 'page-1',
      sequence: 1
    });
    expect(session.results()).toBe(RESULTS);
    // The run saved the edit too (without waiting for it).
    expect(deps.writeSettings).toHaveBeenCalledWith(
      expect.objectContaining({ widthThreshold: '1200' })
    );
  });

  it('ignores Run while loading and while a run is in the air', async () => {
    let finish: (outcome: BeaconTestOutcome) => void = () => undefined;
    const runTest = vi.fn(() => new Promise<BeaconTestOutcome>((done) => (finish = done)));
    const { session } = setup({ runTest });
    await session.start();
    expect(runTest).not.toHaveBeenCalled();
    await settle();
    const first = session.start();
    void session.start();
    expect(runTest).toHaveBeenCalledTimes(1);
    finish({ kind: 'busy' });
    await first;
    expect(session.run()).toMatchObject({ status: 'finished', outcome: { kind: 'busy' } });
    expect(session.results()).toBeNull();
  });

  it('ends a run that throws as a failed ask, logged', async () => {
    const { session, error } = setup({ runTest: () => Promise.reject(new Error('boom')) });
    await settle();
    await session.start();
    expect(session.run()).toMatchObject({ status: 'finished', outcome: BEACON_RUN_THREW_OUTCOME });
    expect(error).toHaveBeenCalledWith('Beacon tester: the run threw', 'boom');
  });

  it('marks the results stale once the page loads again (an unknown page proves nothing)', async () => {
    const { session, setPageId } = setup();
    await settle();
    await session.start();
    expect(session.stale()).toBe(false);
    setPageId(null);
    expect(session.stale()).toBe(false);
    setPageId('page-2');
    expect(session.stale()).toBe(true);
  });

  it('drops an answer that lands after dispose', async () => {
    let finish: (outcome: BeaconTestOutcome) => void = () => undefined;
    const { session } = setup({
      runTest: () => new Promise<BeaconTestOutcome>((done) => (finish = done))
    });
    await settle();
    const run = session.start();
    session.dispose();
    finish(COMPLETED);
    await run;
    expect(session.run()).toEqual({ status: 'running' });
  });
});

describe('resultsOf', () => {
  it('shows completed and partial results only', () => {
    expect(resultsOf(COMPLETED)).toBe(RESULTS);
    expect(resultsOf({ kind: 'timed-out', partial: RESULTS })).toBe(RESULTS);
    expect(resultsOf({ kind: 'timed-out', partial: null })).toBeNull();
    expect(resultsOf({ kind: 'bailed', reason: 'page-scrolled' })).toBeNull();
    expect(resultsOf({ kind: 'invalid-config', issues: [] })).toBeNull();
  });
});
