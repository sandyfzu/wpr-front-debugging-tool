/**
 * The tester session's machines over injected doubles: the settings load
 * (and its retry), edits written through the debounced writer, the run
 * (repeat question, held by an unsaved form, finished outcome, the payload
 * refresh after an applied test), the derived stale reading and its stamp, the
 * foreign-write watch, and the style inventory.
 */
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskOutcome, ScheduleTimer } from '../../../../lib/messaging/bounded-ask';
import type { PageStylesReply } from '../../../../lib/messaging/page-styles';
import {
  DEFAULT_RUCSS_TESTER_CONFIG,
  RUCSS_CONFIG_LIMITS,
  type RucssTesterConfig
} from '../../../../lib/rucss-tester/config';
import type { RucssTestOutcome } from '../../../../lib/rucss-tester/run-test';
import {
  consentAnswerEffect,
  consentAnswerWaits,
  createRucssTesterSession,
  dropAnsweredQuestion,
  RUN_THREW_OUTCOME,
  settleLocalTests,
  settleRunStamp,
  type FinishedRun,
  type LocalTest,
  type RucssTesterSessionDeps
} from './session';

const APPLIED: RucssTestOutcome = {
  kind: 'applied',
  requestUrl: 'https://mega.test/?url=x',
  summary: { removed: 1, preserved: 0, excluded: 0, gone: 0, cssChars: 3 },
  applied: []
};

const STYLES: PageStylesReply = {
  styles: [
    { kind: 'inline', id: '', className: '', href: '', media: '', preview: 'a{}', chars: 3 }
  ],
  total: 1
};

/** A timer that never fires on its own (flushes write). */
const idleTimer: ScheduleTimer = () => () => undefined;

/** Let queued promise callbacks run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

/** Build a session in a root with doubles; returns the doubles too. */
function setup(overrides: Partial<RucssTesterSessionDeps> = {}) {
  const [pageRuns, setPageRuns] = createSignal(0);
  const [pageId, setPageId] = createSignal<string | null>('page-1');
  const [pageSettled, setPageSettled] = createSignal(true);
  let watcher: ((config: RucssTesterConfig) => void) | null = null;
  const warn = vi.fn();
  const error = vi.fn();
  const deps = {
    readConfig: vi.fn(() =>
      Promise.resolve<RucssTesterConfig>({ ...DEFAULT_RUCSS_TESTER_CONFIG, safelist: 'stored' })
    ),
    writeConfig: vi.fn<(config: RucssTesterConfig) => Promise<void>>(() => Promise.resolve()),
    watchConfig: vi.fn((onChange: (config: RucssTesterConfig) => void) => {
      watcher = onChange;
      return () => {
        watcher = null;
      };
    }),
    runTest: vi.fn(() => Promise.resolve(APPLIED)),
    listStyles: vi.fn(() =>
      Promise.resolve<AskOutcome<PageStylesReply>>({ kind: 'reply', reply: STYLES })
    ),
    pageRuns,
    pageId,
    pageSettled,
    onApplied: vi.fn(),
    schedule: idleTimer,
    saveDelayMs: 400,
    log: { debug: vi.fn(), info: vi.fn(), warn, error },
    ...overrides
  };
  const session = createRoot((dispose) => {
    disposers.push(dispose);
    return createRucssTesterSession(deps);
  });
  disposers.push(() => {
    session.dispose();
  });
  return {
    session,
    deps,
    warn,
    error,
    setPageRuns,
    setPageId,
    setPageSettled,
    foreignWrite: (config: RucssTesterConfig) => watcher?.(config)
  };
}

/** A loaded session. */
async function loaded(overrides: Partial<RucssTesterSessionDeps> = {}) {
  const built = setup(overrides);
  await settle();
  return built;
}

describe('load', () => {
  it('reads the stored settings into the form', async () => {
    const { session } = setup();
    expect(session.load()).toEqual({ status: 'loading' });
    await settle();
    expect(session.load()).toEqual({ status: 'ready' });
    expect(session.form.safelist).toBe('stored');
  });

  it('fails visibly and recovers on retry', async () => {
    const readConfig = vi
      .fn<() => Promise<RucssTesterConfig>>()
      .mockRejectedValueOnce(new Error('Extension context invalidated.'))
      .mockResolvedValue(DEFAULT_RUCSS_TESTER_CONFIG);
    const { session, warn } = setup({ readConfig });
    await settle();
    expect(session.load()).toEqual({ status: 'failed' });
    expect(warn).toHaveBeenCalled();
    session.retryLoad();
    await settle();
    expect(session.load()).toEqual({ status: 'ready' });
  });

  it('holds a run until the settings are loaded', async () => {
    const { session, deps } = setup();
    await session.start();
    expect(deps.runTest).not.toHaveBeenCalled();
    expect(session.run()).toEqual({ status: 'idle' });
  });
});

describe('edits', () => {
  it('writes every kind of edit, within the caps', async () => {
    const { session, deps } = await loaded();
    session.setText('excludeFiles', 'theme\\.css');
    session.setFlag('mobile', true);
    session.addPair();
    session.setPair(0, 'search', 'a');
    session.addPair();
    session.removePair(0);
    // Out-of-range pair edits are ignored.
    session.setPair(5, 'search', 'x');
    expect(session.save()).toEqual({ status: 'pending' });
    await session.flush();
    expect(deps.writeConfig).toHaveBeenCalledTimes(1);
    expect(deps.writeConfig).toHaveBeenCalledWith({
      ...DEFAULT_RUCSS_TESTER_CONFIG,
      safelist: 'stored',
      excludeFiles: 'theme\\.css',
      mobile: true,
      replacements: [{ search: '', replacement: '' }]
    });
    expect(session.save()).toEqual({ status: 'saved' });
  });

  it('adds no pair past the cap', async () => {
    const { session } = await loaded();
    for (let index = 0; index < RUCSS_CONFIG_LIMITS.replacements + 2; index++) session.addPair();
    expect(session.form.replacements).toHaveLength(RUCSS_CONFIG_LIMITS.replacements);
  });

  it('takes another window’s write while saved, never over local edits in flight', async () => {
    const { session, foreignWrite } = await loaded();
    foreignWrite({ ...DEFAULT_RUCSS_TESTER_CONFIG, safelist: 'theirs' });
    expect(session.form.safelist).toBe('theirs');
    session.setText('safelist', 'mine');
    foreignWrite({ ...DEFAULT_RUCSS_TESTER_CONFIG, safelist: 'theirs again' });
    expect(session.form.safelist).toBe('mine');
  });
});

describe('run', () => {
  it('writes the form first, runs, refreshes the payload after an applied test', async () => {
    const order: string[] = [];
    const { session, deps } = await loaded({
      writeConfig: vi.fn(() => {
        order.push('write');
        return Promise.resolve();
      }),
      runTest: vi.fn(() => {
        order.push('run');
        return Promise.resolve(APPLIED);
      })
    });
    session.setText('safelist', 'x');
    const running = session.start();
    expect(session.run()).toEqual({ status: 'running' });
    await running;
    expect(order).toEqual(['write', 'run']);
    expect(session.run()).toEqual({
      status: 'finished',
      outcome: APPLIED,
      page: 'page-1',
      provisional: false,
      sequence: 1
    });
    expect(deps.onApplied).toHaveBeenCalledTimes(1);
  });

  it('does not refresh the payload after a failed test, and ignores a second start while running', async () => {
    let finish: (outcome: RucssTestOutcome) => void = () => undefined;
    const runTest = vi.fn(
      () =>
        new Promise<RucssTestOutcome>((resolve) => {
          finish = resolve;
        })
    );
    const { session, deps } = await loaded({ runTest });
    const first = session.start();
    await settle();
    await session.start();
    expect(runTest).toHaveBeenCalledTimes(1);
    finish({ kind: 'apply-failed', failure: 'css-blocked' });
    await first;
    expect(session.run()).toMatchObject({ status: 'finished', outcome: { kind: 'apply-failed' } });
    expect(deps.onApplied).not.toHaveBeenCalled();
  });

  it('asks before a second destructive pass: cancel, or run on top', async () => {
    const { session, deps, setPageRuns } = await loaded();
    setPageRuns(1);
    await session.start();
    expect(session.run()).toEqual({ status: 'confirm-repeat', previous: null });
    expect(deps.runTest).not.toHaveBeenCalled();
    session.cancelRepeat();
    expect(session.run()).toEqual({ status: 'idle' });
    await session.start();
    await session.start({ force: true });
    expect(deps.runTest).toHaveBeenCalledTimes(1);
    expect(session.run()).toMatchObject({ status: 'finished', sequence: 1 });
    // Cancel only leaves the question.
    session.cancelRepeat();
    expect(session.run().status).toBe('finished');
  });

  it('is held when the settings cannot be saved (it would run with old ones)', async () => {
    const { session, deps } = await loaded({
      writeConfig: vi.fn(() => Promise.reject(new Error('QUOTA_BYTES')))
    });
    session.setText('safelist', 'y');
    await session.start();
    expect(session.run()).toEqual({ status: 'blocked' });
    expect(deps.runTest).not.toHaveBeenCalled();
    expect(session.save().status).toBe('failed');
  });

  it('never reads stale while the page load is unknown, only once another load is known', async () => {
    const { session, setPageRuns, setPageId } = await loaded();
    await session.start();
    setPageRuns(1);
    expect(session.stale()).toBe(false);
    // A later refresh fails (no payload, so no count and no id): the test is still on the page.
    setPageId(null);
    setPageRuns(0);
    expect(session.stale()).toBe(false);
    // The reload: another load, no test on it.
    setPageId('page-2');
    expect(session.stale()).toBe(true);
    // A newer run starts over.
    await session.start();
    expect(session.run()).toMatchObject({ status: 'finished', sequence: 2 });
    expect(session.stale()).toBe(false);
  });

  it('reads stale on another page load, before any payload refresh landed', async () => {
    const { session, setPageId } = await loaded();
    await session.start();
    expect(session.run()).toMatchObject({ page: 'page-1', provisional: false });
    expect(session.stale()).toBe(false);
    setPageId('page-2');
    expect(session.stale()).toBe(true);
  });

  it('reads an unconfirmed apply stale on another load; an untouched page never', async () => {
    const outcomes: [RucssTestOutcome, boolean][] = [
      [{ kind: 'page-unreachable', step: 'apply', miss: 'timeout' }, true],
      [{ kind: 'apply-failed', failure: 'css-blocked' }, false]
    ];
    for (const [outcome, stale] of outcomes) {
      const { session, setPageId } = await loaded({
        runTest: vi.fn(() => Promise.resolve(outcome))
      });
      await session.start({ force: true });
      setPageId('page-2');
      expect(session.stale(), outcome.kind).toBe(stale);
    }
  });

  it('a run started mid-refetch takes the load the shell settles on', async () => {
    const { session, setPageId, setPageSettled } = await loaded();
    setPageSettled(false);
    await session.start();
    expect(session.run()).toMatchObject({ page: null, provisional: true });
    // The refetch settles on the load the run ran on: not stale.
    setPageId('page-2');
    setPageSettled(true);
    expect(session.run()).toMatchObject({ page: 'page-2', provisional: false });
    expect(session.stale()).toBe(false);
    // A later load is another one.
    setPageId('page-3');
    expect(session.stale()).toBe(true);
  });

  it('settles the stamp the repeat question holds', () => {
    const previous: FinishedRun = {
      status: 'finished',
      outcome: APPLIED,
      page: null,
      provisional: true,
      sequence: 1
    };
    const held = { status: 'confirm-repeat', previous } as const;
    expect(settleRunStamp(held, 'page-1', false)).toBe(held);
    expect(settleRunStamp(held, 'page-1', true)).toEqual({
      status: 'confirm-repeat',
      previous: { ...previous, page: 'page-1', provisional: false }
    });
    const none = { status: 'confirm-repeat', previous: null } as const;
    expect(settleRunStamp(none, 'page-1', true)).toBe(none);
    const idle = { status: 'idle' } as const;
    expect(settleRunStamp(idle, 'page-1', true)).toBe(idle);
    const settledRun = { ...previous, page: 'page-1', provisional: false };
    expect(settleRunStamp(settledRun, 'page-2', true)).toBe(settledRun);
  });

  it('settles only the provisional records, and only once the shell settles', () => {
    const kept: LocalTest = { page: 'page-1', provisional: false, change: 'applied' };
    const pending: LocalTest = { page: null, provisional: true, change: 'unconfirmed' };
    const tests = [kept, pending];
    expect(settleLocalTests(tests, 'page-2', false)).toBe(tests);
    expect(settleLocalTests([kept], 'page-2', true)).toEqual([kept]);
    expect(settleLocalTests(tests, 'page-2', true)).toEqual([
      kept,
      { page: 'page-2', provisional: false, change: 'unconfirmed' }
    ]);
  });

  it('drops a question only on a settled load with no earlier test', () => {
    const previous: FinishedRun = {
      status: 'finished',
      outcome: APPLIED,
      page: 'page-1',
      provisional: false,
      sequence: 1
    };
    const none = { applied: 0, unconfirmed: 0 };
    const held = { status: 'confirm-repeat', previous } as const;
    expect(dropAnsweredQuestion(held, none, true)).toBe(previous);
    expect(dropAnsweredQuestion({ status: 'confirm-repeat', previous: null }, none, true)).toEqual({
      status: 'idle'
    });
    expect(dropAnsweredQuestion(held, none, false)).toBe(held);
    expect(dropAnsweredQuestion(held, { applied: 1, unconfirmed: 0 }, true)).toBe(held);
    expect(dropAnsweredQuestion(held, { applied: 0, unconfirmed: 1 }, true)).toBe(held);
    expect(dropAnsweredQuestion(previous, none, true)).toBe(previous);
  });

  it('refreshes a shown inventory after an applied test', async () => {
    const { session, deps } = await loaded();
    await session.inspect();
    expect(deps.listStyles).toHaveBeenCalledTimes(1);
    await session.start();
    await settle();
    expect(deps.listStyles).toHaveBeenCalledTimes(2);
  });
});

describe('run — earlier tests on the page', () => {
  const APPLY_MISS: RucssTestOutcome = { kind: 'page-unreachable', step: 'apply', miss: 'timeout' };

  it('after an unconfirmed apply: refreshes the payload and asks before the next run', async () => {
    const { session, deps } = await loaded({ runTest: vi.fn(() => Promise.resolve(APPLY_MISS)) });
    await session.start();
    expect(deps.onApplied).toHaveBeenCalledTimes(1);
    expect(session.priorTests()).toEqual({ applied: 0, unconfirmed: 1 });
    // "Run again" goes through the question, never straight to a second pass.
    await session.start();
    expect(session.run()).toMatchObject({ status: 'confirm-repeat' });
    expect(deps.runTest).toHaveBeenCalledTimes(1);
  });

  it('asks after an applied test even when the payload refresh never lands', async () => {
    const { session, deps } = await loaded();
    await session.start();
    // pageRuns stays 0 (the refresh was dropped): the session's own count asks.
    expect(session.priorTests()).toEqual({ applied: 1, unconfirmed: 0 });
    await session.start();
    expect(session.run()).toMatchObject({ status: 'confirm-repeat' });
    expect(deps.runTest).toHaveBeenCalledTimes(1);
  });

  it('takes the larger of the payload count and its own', async () => {
    const { session, setPageRuns } = await loaded();
    await session.start();
    setPageRuns(3);
    expect(session.priorTests()).toEqual({ applied: 3, unconfirmed: 0 });
  });

  it('forgets its own counts once the page reloads (a new page identity), not before', async () => {
    const { session, deps, setPageId } = await loaded({
      runTest: vi.fn(() => Promise.resolve(APPLY_MISS))
    });
    await session.start();
    // No payload for a moment (fetching): the count stays — asking is the safe side.
    setPageId(null);
    expect(session.priorTests()).toEqual({ applied: 0, unconfirmed: 1 });
    setPageId('page-2');
    expect(session.priorTests()).toEqual({ applied: 0, unconfirmed: 0 });
    await session.start();
    expect(deps.runTest).toHaveBeenCalledTimes(2);
    expect(session.priorTests()).toEqual({ applied: 0, unconfirmed: 1 });
  });

  it('counts a run against the page it started on (a reload mid-run leaves the new page clean)', async () => {
    let finish: (outcome: RucssTestOutcome) => void = () => undefined;
    const runTest = vi.fn(
      () =>
        new Promise<RucssTestOutcome>((resolve) => {
          finish = resolve;
        })
    );
    const { session, setPageId } = await loaded({ runTest });
    const running = session.start();
    await settle();
    setPageId('page-2');
    finish(APPLY_MISS);
    await running;
    expect(session.priorTests()).toEqual({ applied: 0, unconfirmed: 0 });
  });

  it('counts a run that finished mid-refetch against the load the shell settles on', async () => {
    const { session, deps, setPageId, setPageSettled } = await loaded();
    // A reload: the shell refetches, still showing the earlier load.
    setPageSettled(false);
    await session.start();
    // Its refetch was answered before the apply: the payload never counts this test.
    setPageId('page-2');
    setPageSettled(true);
    expect(session.priorTests()).toEqual({ applied: 1, unconfirmed: 0 });
    await session.start();
    expect(session.run()).toMatchObject({ status: 'confirm-repeat' });
    expect(deps.runTest).toHaveBeenCalledTimes(1);
  });

  it('adds a mid-refetch run to the earlier ones when the shell settles on the same load', async () => {
    const { session, setPageSettled } = await loaded();
    await session.start();
    // The post-apply refresh is in flight; a second run lands on top.
    setPageSettled(false);
    await session.start({ force: true });
    // Unsettled: the provisional run still counts (asking is the safe side).
    expect(session.priorTests()).toEqual({ applied: 2, unconfirmed: 0 });
    setPageSettled(true);
    expect(session.priorTests()).toEqual({ applied: 2, unconfirmed: 0 });
  });

  it('drops an open repeat question once the page settles on a load without tests', async () => {
    for (const shownFirst of [true, false]) {
      const { session, setPageRuns, setPageId, setPageSettled } = await loaded();
      if (shownFirst) await session.start();
      else setPageRuns(1);
      const shown = session.run();
      setPageRuns(1);
      await session.start();
      expect(session.run()).toMatchObject({ status: 'confirm-repeat' });
      // The shell refetches, then has no payload for a moment: the question stays.
      setPageSettled(false);
      expect(session.run()).toMatchObject({ status: 'confirm-repeat' });
      setPageId(null);
      setPageRuns(0);
      expect(session.run()).toMatchObject({ status: 'confirm-repeat' });
      // The clean load settles: no earlier test remains to ask about.
      setPageId('page-2');
      setPageSettled(true);
      expect(session.run()).toEqual(shownFirst ? shown : { status: 'idle' });
      expect(session.stale()).toBe(shownFirst);
    }
  });

  it('keeps an open repeat question while the settled page still carries a test', async () => {
    const { session, setPageRuns, setPageId } = await loaded();
    setPageRuns(1);
    await session.start();
    // Navigated to a load that carries a test of its own.
    setPageId('page-2');
    expect(session.run()).toEqual({ status: 'confirm-repeat', previous: null });
  });

  it('keeps the shown outcome under the repeat question; Cancel brings it back', async () => {
    const { session, setPageRuns } = await loaded();
    await session.start();
    const shown = session.run();
    expect(shown.status).toBe('finished');
    setPageRuns(1);
    await session.start();
    expect(session.run()).toEqual({ status: 'confirm-repeat', previous: shown });
    // Asking again keeps the same previous outcome.
    await session.start();
    expect(session.run()).toEqual({ status: 'confirm-repeat', previous: shown });
    session.cancelRepeat();
    expect(session.run()).toBe(shown);
  });
});

describe('run — never stuck', () => {
  it('a run that throws is logged, ends as an unconfirmed apply and is counted', async () => {
    const { session, deps, error } = await loaded({
      runTest: vi.fn(() => Promise.reject(new Error('boom')))
    });
    await expect(session.start()).resolves.toBeUndefined();
    expect(session.run()).toMatchObject({ status: 'finished', outcome: RUN_THREW_OUTCOME });
    expect(error).toHaveBeenCalledWith(
      'RUCSS tester: the run threw; the page state is unknown',
      'boom'
    );
    expect(deps.onApplied).toHaveBeenCalledTimes(1);
    expect(session.priorTests().unconfirmed).toBe(1);
  });

  it('a run that throws synchronously is caught the same way', async () => {
    const { session } = await loaded({
      runTest: vi.fn(() => {
        throw new Error('sync');
      })
    });
    await session.start();
    expect(session.run()).toMatchObject({ status: 'finished', outcome: RUN_THREW_OUTCOME });
  });

  it('an edit typed while the run saves does not hold the run', async () => {
    let release = (): void => undefined;
    const writeConfig = vi
      .fn<(config: RucssTesterConfig) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      )
      .mockResolvedValue(undefined);
    const { session, deps } = await loaded({ writeConfig });
    session.setText('safelist', 'at-run');
    const running = session.start();
    await settle();
    session.setText('safelist', 'typed-meanwhile');
    release();
    await running;
    expect(deps.runTest).toHaveBeenCalledTimes(1);
    expect(session.run().status).toBe('finished');
    // The newer edit is still the form's, saved on its own pause.
    expect(session.save()).toEqual({ status: 'pending' });
    expect(writeConfig).toHaveBeenCalledTimes(1);
  });
});

describe('inventory', () => {
  it('goes loading → ready, or names the miss', async () => {
    const listStyles = vi
      .fn<() => Promise<AskOutcome<PageStylesReply>>>()
      .mockResolvedValueOnce({ kind: 'timeout' })
      .mockResolvedValue({ kind: 'reply', reply: STYLES });
    const { session } = await loaded({ listStyles });
    expect(session.inventory()).toEqual({ status: 'idle' });
    const reading = session.inspect();
    expect(session.inventory()).toEqual({ status: 'loading' });
    // A second ask while one is in flight is dropped.
    await session.inspect();
    await reading;
    expect(session.inventory()).toEqual({ status: 'failed', miss: 'timeout' });
    await session.inspect();
    expect(session.inventory()).toEqual({ status: 'ready', reply: STYLES });
    expect(listStyles).toHaveBeenCalledTimes(2);
  });

  it('reads idle once the page reloads or navigates (a list of an earlier load is stale)', async () => {
    const { session, setPageId } = await loaded({
      listStyles: vi.fn(() => Promise.resolve<AskOutcome<PageStylesReply>>({ kind: 'timeout' }))
    });
    await session.inspect();
    expect(session.inventory().status).toBe('failed');
    setPageId('page-2');
    expect(session.inventory()).toEqual({ status: 'idle' });
  });

  it('a ready list goes idle on a new page, and a read there shows again', async () => {
    const { session, setPageId } = await loaded();
    await session.inspect();
    expect(session.inventory()).toEqual({ status: 'ready', reply: STYLES });
    setPageId('page-2');
    expect(session.inventory()).toEqual({ status: 'idle' });
    await session.inspect();
    expect(session.inventory()).toEqual({ status: 'ready', reply: STYLES });
  });

  it('reads once more when a test may have applied during a read', async () => {
    const after: PageStylesReply = { styles: [], total: 0 };
    let answer: (outcome: AskOutcome<PageStylesReply>) => void = () => undefined;
    const listStyles = vi
      .fn<() => Promise<AskOutcome<PageStylesReply>>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          })
      )
      .mockResolvedValue({ kind: 'reply', reply: after });
    const { session } = await loaded({ listStyles });
    const reading = session.inspect();
    await session.start();
    answer({ kind: 'reply', reply: STYLES });
    await reading;
    await settle();
    expect(listStyles).toHaveBeenCalledTimes(2);
    expect(session.inventory()).toEqual({ status: 'ready', reply: after });
  });

  it('a read that throws is logged and named as failed', async () => {
    const { session, error } = await loaded({
      listStyles: vi.fn(() => Promise.reject(new Error('gone')))
    });
    await session.inspect();
    expect(session.inventory()).toEqual({ status: 'failed', miss: 'failed' });
    expect(error).toHaveBeenCalled();
  });
});

describe('dispose', () => {
  it('stops following foreign writes and drops a queued edit', async () => {
    const { session, deps } = await loaded();
    session.setText('safelist', 'unsent');
    session.dispose();
    await session.flush();
    expect(deps.writeConfig).not.toHaveBeenCalled();
    expect(deps.watchConfig).toHaveBeenCalledTimes(1);
  });
});

describe('data consent', () => {
  const ASKING: RucssTestOutcome = { kind: 'consent-needed', reason: 'asking' };

  /** A loaded session whose consent watch hands its listener out. */
  async function withConsentWatch(runTest: RucssTesterSessionDeps['runTest']) {
    const watch: {
      answer?: (granted: boolean) => void;
      stop: ReturnType<typeof vi.fn<() => void>>;
    } = { stop: vi.fn<() => void>() };
    const built = await loaded({
      runTest,
      watchConsentAnswers: (onAnswer) => {
        watch.answer = onAnswer;
        return watch.stop;
      }
    });
    return { ...built, watch };
  }

  it('a run waiting on the consent starts again once allowed', async () => {
    const runTest = vi
      .fn<() => Promise<RucssTestOutcome>>()
      .mockResolvedValueOnce(ASKING)
      .mockResolvedValue(APPLIED);
    const { session, watch } = await withConsentWatch(runTest);
    await session.start();
    expect(session.run()).toMatchObject({ status: 'finished', outcome: ASKING });
    watch.answer?.(true);
    await settle();
    expect(runTest).toHaveBeenCalledTimes(2);
    expect(session.run()).toMatchObject({ status: 'finished', outcome: APPLIED });
  });

  it('a decline turns the waiting run into the declined state (no new run)', async () => {
    const runTest = vi.fn(() => Promise.resolve(ASKING));
    const { session, watch } = await withConsentWatch(runTest);
    await session.start();
    watch.answer?.(false);
    expect(session.run()).toMatchObject({
      status: 'finished',
      outcome: { kind: 'consent-needed', reason: 'declined' }
    });
    expect(runTest).toHaveBeenCalledOnce();
  });

  it('an answer with no run waiting on it changes nothing', async () => {
    const { session, watch, deps } = await withConsentWatch(vi.fn(() => Promise.resolve(APPLIED)));
    watch.answer?.(true);
    expect(session.run()).toEqual({ status: 'idle' });
    await session.start();
    const finished = session.run();
    watch.answer?.(true);
    watch.answer?.(false);
    expect(session.run()).toBe(finished);
    expect(deps.runTest).toHaveBeenCalledOnce();
  });

  it('a grant restarts nothing once the run was declined or its ask failed', async () => {
    const runTest = vi.fn(() => Promise.resolve(ASKING));
    const { session, watch } = await withConsentWatch(runTest);
    await session.start();
    watch.answer?.(false);
    watch.answer?.(true);
    await settle();
    expect(session.run()).toMatchObject({ outcome: { reason: 'declined' } });
    expect(runTest).toHaveBeenCalledOnce();

    const failed = await withConsentWatch(
      vi.fn(() =>
        Promise.resolve<RucssTestOutcome>({ kind: 'consent-needed', reason: 'ask-failed' })
      )
    );
    await failed.session.start();
    const shown = failed.session.run();
    failed.watch.answer?.(true);
    failed.watch.answer?.(false);
    await settle();
    expect(failed.session.run()).toBe(shown);
    expect(failed.deps.runTest).toHaveBeenCalledOnce();
  });

  it('a grant after the page reloaded or navigated starts no test on the new load', async () => {
    const runTest = vi.fn(() => Promise.resolve(ASKING));
    const { session, watch, setPageId } = await withConsentWatch(runTest);
    await session.start();
    const shown = session.run();
    setPageId('page-2');
    await settle();
    watch.answer?.(true);
    await settle();
    expect(runTest).toHaveBeenCalledOnce();
    expect(session.run()).toBe(shown);
  });

  it('a grant while the page identity is refetching starts nothing', async () => {
    const runTest = vi.fn(() => Promise.resolve(ASKING));
    const { session, watch, setPageSettled } = await withConsentWatch(runTest);
    await session.start();
    setPageSettled(false);
    watch.answer?.(true);
    await settle();
    expect(runTest).toHaveBeenCalledOnce();
  });

  it('dispose stops the watch; an answer after it is ignored', async () => {
    const runTest = vi.fn(() => Promise.resolve(ASKING));
    const { session, watch } = await withConsentWatch(runTest);
    await session.start();
    session.dispose();
    expect(watch.stop).toHaveBeenCalledOnce();
    watch.answer?.(true);
    expect(runTest).toHaveBeenCalledOnce();
  });

  it('an answer reaching a disposed session (the watch not yet stopped) changes nothing', async () => {
    const runTest = vi.fn(() => Promise.resolve(ASKING));
    const { session, watch } = await withConsentWatch(runTest);
    await session.start();
    const shown = session.run();
    session.dispose();
    watch.answer?.(false);
    watch.answer?.(true);
    await settle();
    expect(session.run()).toBe(shown);
    expect(runTest).toHaveBeenCalledOnce();
  });

  it('a forced run restarts forced: the repeat question is not asked twice', async () => {
    const runTest = vi
      .fn<() => Promise<RucssTestOutcome>>()
      .mockResolvedValueOnce(ASKING)
      .mockResolvedValue(APPLIED);
    const { session, watch, setPageRuns } = await withConsentWatch(runTest);
    setPageRuns(1);
    await session.start();
    expect(session.run()).toMatchObject({ status: 'confirm-repeat' });
    await session.start({ force: true });
    watch.answer?.(true);
    await settle();
    expect(runTest).toHaveBeenCalledTimes(2);
    expect(session.run()).toMatchObject({ status: 'finished', outcome: APPLIED });
  });

  it('an unforced run restarts unforced: a test applied meanwhile is still asked about', async () => {
    const runTest = vi.fn(() => Promise.resolve(ASKING));
    const { session, watch, setPageRuns } = await withConsentWatch(runTest);
    await session.start();
    setPageRuns(1);
    watch.answer?.(true);
    await settle();
    expect(runTest).toHaveBeenCalledOnce();
    expect(session.run()).toMatchObject({ status: 'confirm-repeat' });
  });

  it('a grant heard while the page identity refetches restarts once it settles on the same load', async () => {
    const runTest = vi
      .fn<() => Promise<RucssTestOutcome>>()
      .mockResolvedValueOnce(ASKING)
      .mockResolvedValue(APPLIED);
    const { session, watch, setPageSettled } = await withConsentWatch(runTest);
    await session.start();
    setPageSettled(false);
    watch.answer?.(true);
    await settle();
    expect(runTest).toHaveBeenCalledOnce();
    setPageSettled(true);
    await settle();
    expect(runTest).toHaveBeenCalledTimes(2);
    expect(session.run()).toMatchObject({ status: 'finished', outcome: APPLIED });
  });

  it('a held grant starts nothing when the refetch settles on another load (and is gone)', async () => {
    const runTest = vi.fn(() => Promise.resolve(ASKING));
    const { session, watch, setPageId, setPageSettled } = await withConsentWatch(runTest);
    await session.start();
    setPageSettled(false);
    watch.answer?.(true);
    setPageId('page-2');
    setPageSettled(true);
    await settle();
    setPageId('page-1');
    setPageSettled(false);
    setPageSettled(true);
    await settle();
    expect(runTest).toHaveBeenCalledOnce();
  });

  it("an answer heard while the run's own ask is in flight is judged once it lands", async () => {
    const lands: ((outcome: RucssTestOutcome) => void)[] = [];
    const runTest = vi.fn(
      () =>
        new Promise<RucssTestOutcome>((resolve) => {
          lands.push(resolve);
        })
    );
    const { session, watch } = await withConsentWatch(runTest);
    const first = session.start();
    await settle();
    watch.answer?.(true);
    lands[0]?.(ASKING);
    await first;
    await settle();
    expect(runTest).toHaveBeenCalledTimes(2);
    lands[1]?.(ASKING);
    await settle();
    watch.answer?.(false);
    expect(session.run()).toMatchObject({ outcome: { reason: 'declined' } });

    const declined = await withConsentWatch(vi.fn(() => Promise.resolve<RucssTestOutcome>(ASKING)));
    const run = declined.session.start();
    declined.watch.answer?.(false);
    await run;
    await settle();
    expect(declined.session.run()).toMatchObject({ outcome: { reason: 'declined' } });
    expect(declined.deps.runTest).toHaveBeenCalledOnce();
  });

  it('an answer held for an earlier run is dropped by a new run', async () => {
    const runTest = vi.fn(() => Promise.resolve(ASKING));
    const { session, watch, setPageSettled } = await withConsentWatch(runTest);
    await session.start();
    setPageSettled(false);
    watch.answer?.(true);
    await session.start();
    setPageSettled(true);
    await settle();
    expect(runTest).toHaveBeenCalledTimes(2);
    expect(session.run()).toMatchObject({ outcome: ASKING });
  });

  it('an answer held until dispose is never acted on', async () => {
    const runTest = vi.fn(() => Promise.resolve(ASKING));
    const { session, watch, setPageSettled } = await withConsentWatch(runTest);
    await session.start();
    setPageSettled(false);
    watch.answer?.(true);
    session.dispose();
    setPageSettled(true);
    await settle();
    expect(runTest).toHaveBeenCalledOnce();
  });
});

describe('consentAnswerWaits', () => {
  const finished = (provisional: boolean): FinishedRun => ({
    status: 'finished',
    outcome: { kind: 'consent-needed', reason: 'asking' },
    page: 'page-1',
    provisional,
    sequence: 1
  });

  it('every answer waits for a run in flight', () => {
    for (const granted of [true, false]) {
      expect(consentAnswerWaits({ status: 'running' }, granted, true)).toBe(true);
    }
  });

  it('a grant waits while the load is unknown: a refetch or a provisional stamp', () => {
    expect(consentAnswerWaits(finished(false), true, false)).toBe(true);
    expect(consentAnswerWaits(finished(true), true, true)).toBe(true);
    expect(consentAnswerWaits({ status: 'idle' }, true, false)).toBe(true);
    expect(consentAnswerWaits(finished(false), true, true)).toBe(false);
    expect(consentAnswerWaits({ status: 'idle' }, true, true)).toBe(false);
  });

  it('a decline never waits for the load', () => {
    expect(consentAnswerWaits(finished(false), false, false)).toBe(false);
    expect(consentAnswerWaits(finished(true), false, true)).toBe(false);
  });
});

describe('consentAnswerEffect', () => {
  const asking = (overrides: Partial<FinishedRun> = {}): FinishedRun => ({
    status: 'finished',
    outcome: { kind: 'consent-needed', reason: 'asking' },
    page: 'page-1',
    provisional: false,
    sequence: 1,
    ...overrides
  });

  it('restarts a run waiting on its ask, on its own settled load only', () => {
    expect(consentAnswerEffect(asking(), true, 'page-1', true)).toBe('restart');
    expect(consentAnswerEffect(asking(), true, 'page-2', true)).toBe('keep');
    expect(consentAnswerEffect(asking(), true, 'page-1', false)).toBe('keep');
    expect(consentAnswerEffect(asking(), true, null, true)).toBe('keep');
    expect(consentAnswerEffect(asking({ page: null }), true, null, true)).toBe('keep');
    expect(consentAnswerEffect(asking({ provisional: true }), true, 'page-1', true)).toBe('keep');
  });

  it('a decline marks a waiting run, whatever the load', () => {
    expect(consentAnswerEffect(asking(), false, 'page-1', true)).toBe('declined');
    expect(consentAnswerEffect(asking(), false, 'page-2', false)).toBe('declined');
  });

  it('keeps every run not waiting on its ask', () => {
    for (const reason of ['declined', 'ask-failed'] as const) {
      const run = asking({ outcome: { kind: 'consent-needed', reason } });
      expect(consentAnswerEffect(run, true, 'page-1', true)).toBe('keep');
      expect(consentAnswerEffect(run, false, 'page-1', true)).toBe('keep');
    }
    expect(consentAnswerEffect(asking({ outcome: APPLIED }), true, 'page-1', true)).toBe('keep');
    for (const state of [
      { status: 'idle' },
      { status: 'running' },
      { status: 'blocked' },
      { status: 'confirm-repeat', previous: asking() }
    ] as const) {
      expect(consentAnswerEffect(state, true, 'page-1', true)).toBe('keep');
    }
  });
});
