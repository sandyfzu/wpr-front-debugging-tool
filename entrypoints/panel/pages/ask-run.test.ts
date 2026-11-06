/**
 * The panel's ask machine: idle → pending → shown, the shown answer kept
 * while a newer ask is pending, one ask at a time, a throwing ask shown as
 * the failure outcome and logged, a failure kept beside a good answer (never
 * replacing it), stale once the page load changes, provisional stamps for
 * asks started mid-refetch, nothing recorded after disposal.
 */
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../../lib/logger';
import { ASK_THREW, createAskRun, isPageUnreachable } from './ask-run';

/** A promise the test settles. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** A silent logger. */
function logDouble(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('createAskRun', () => {
  it('goes idle → pending → shown, keeping the shown answer while asking again', async () => {
    await createRoot(async (dispose) => {
      const [page] = createSignal<string | null>('p1');
      const answers = [deferred<string>(), deferred<string>()];
      let call = 0;
      const run = createAskRun<string>({
        ask: () => (answers[call++] as { promise: Promise<string> }).promise,
        threw: 'threw',
        isFailure: (outcome) => outcome === 'threw',
        pageSettled: () => true,
        pageId: page,
        log: logDouble(),
        label: 'Test'
      });
      expect(run.state()).toEqual({ pending: false, shown: null, failure: null });
      const first = run.start();
      expect(run.state()).toEqual({ pending: true, shown: null, failure: null });
      answers[0]?.resolve('one');
      await first;
      expect(run.state()).toEqual({
        pending: false,
        shown: { outcome: 'one', page: 'p1', provisional: false, sequence: 1 },
        failure: null
      });
      const second = run.start();
      expect(run.state().pending).toBe(true);
      expect(run.state().shown?.outcome).toBe('one');
      answers[1]?.resolve('two');
      await second;
      expect(run.state().shown).toEqual({
        outcome: 'two',
        page: 'p1',
        provisional: false,
        sequence: 2
      });
      dispose();
    });
  });

  it('asks once at a time', async () => {
    await createRoot(async (dispose) => {
      const answer = deferred<string>();
      const ask = vi.fn(() => answer.promise);
      const run = createAskRun<string>({
        ask,
        threw: 'threw',
        isFailure: (outcome) => outcome === 'threw',
        pageSettled: () => true,
        pageId: () => null,
        log: logDouble(),
        label: 'Test'
      });
      const first = run.start();
      await run.start();
      expect(ask).toHaveBeenCalledTimes(1);
      answer.resolve('one');
      await first;
      dispose();
    });
  });

  it('shows a throwing ask as its failure outcome and logs it', async () => {
    await createRoot(async (dispose) => {
      const error = vi.fn<Logger['error']>();
      const run = createAskRun<string>({
        ask: () => Promise.reject(new Error('boom')),
        threw: 'threw',
        isFailure: (outcome) => outcome === 'threw',
        pageSettled: () => true,
        pageId: () => null,
        log: { ...logDouble(), error },
        label: 'Test'
      });
      await run.start();
      expect(run.state().shown?.outcome).toBe('threw');
      expect(error).toHaveBeenCalledWith('Test: the ask threw', 'boom');
      dispose();
    });
  });

  it('reads stale only once a known page load differs from the answer’s', async () => {
    await createRoot(async (dispose) => {
      const [page, setPage] = createSignal<string | null>(null);
      const run = createAskRun<string>({
        ask: () => Promise.resolve('one'),
        threw: 'threw',
        isFailure: (outcome) => outcome === 'threw',
        pageSettled: () => true,
        pageId: page,
        log: logDouble(),
        label: 'Test'
      });
      expect(run.stale()).toBe(false);
      await run.start();
      setPage('p2');
      expect(run.stale()).toBe(false); // the answer's page was unknown
      await run.start();
      expect(run.stale()).toBe(false);
      setPage(null);
      expect(run.stale()).toBe(false); // no payload: nothing proves a reload
      setPage('p3');
      expect(run.stale()).toBe(true);
      dispose();
    });
  });

  it('keeps the good answer when a re-ask fails, and clears the failure on the next good one', async () => {
    await createRoot(async (dispose) => {
      const outcomes = ['one', 'threw', 'threw', 'two'];
      let call = 0;
      const run = createAskRun<string>({
        ask: () => Promise.resolve(outcomes[call++] ?? 'none'),
        threw: 'threw',
        isFailure: (outcome) => outcome === 'threw',
        pageId: () => 'p1',
        pageSettled: () => true,
        log: logDouble(),
        label: 'Test'
      });
      await run.start();
      await run.start();
      expect(run.state().shown?.outcome).toBe('one');
      expect(run.state().failure).toMatchObject({ outcome: 'threw', sequence: 2 });
      await run.start();
      expect(run.state().shown).toMatchObject({ outcome: 'one', sequence: 1 });
      expect(run.state().failure?.sequence).toBe(3);
      await run.start();
      expect(run.state().shown).toMatchObject({ outcome: 'two', sequence: 4 });
      expect(run.state().failure).toBeNull();
      dispose();
    });
  });

  it('shows a failure as the answer while no good answer exists, then replaces it', async () => {
    await createRoot(async (dispose) => {
      const outcomes = ['threw', 'threw', 'one'];
      let call = 0;
      const run = createAskRun<string>({
        ask: () => Promise.resolve(outcomes[call++] ?? 'none'),
        threw: 'threw',
        isFailure: (outcome) => outcome === 'threw',
        pageId: () => 'p1',
        pageSettled: () => true,
        log: logDouble(),
        label: 'Test'
      });
      await run.start();
      expect(run.state()).toMatchObject({ shown: { outcome: 'threw' }, failure: null });
      await run.start();
      expect(run.state()).toMatchObject({ shown: { sequence: 2 }, failure: null });
      await run.start();
      expect(run.state()).toMatchObject({ shown: { outcome: 'one' }, failure: null });
      dispose();
    });
  });

  it('stamps an ask started mid-refetch with the load the shell settles on', async () => {
    await createRoot(async (dispose) => {
      // The page reloaded: the shell still shows the old load while it refetches.
      const [page, setPage] = createSignal<string | null>('old');
      const [settled, setSettled] = createSignal(false);
      const answer = deferred<string>();
      const run = createAskRun<string>({
        ask: () => answer.promise,
        threw: 'threw',
        isFailure: (outcome) => outcome === 'threw',
        pageId: page,
        pageSettled: settled,
        log: logDouble(),
        label: 'Test'
      });
      const asked = run.start();
      answer.resolve('fresh');
      await asked;
      expect(run.state().shown).toMatchObject({ page: null, provisional: true });
      expect(run.stale()).toBe(false);
      // The refetch lands: the answer belongs to the new load, not the old one.
      setPage('new');
      setSettled(true);
      expect(run.state().shown).toMatchObject({ page: 'new', provisional: false });
      expect(run.stale()).toBe(false);
      // A later reload reads as stale (the stamp no longer moves).
      setPage('newer');
      expect(run.stale()).toBe(true);
      dispose();
    });
  });

  it('settles a mid-refetch stamp at the answer when the refetch landed during the ask', async () => {
    await createRoot(async (dispose) => {
      const [page, setPage] = createSignal<string | null>('old');
      const [settled, setSettled] = createSignal(false);
      const answer = deferred<string>();
      const run = createAskRun<string>({
        ask: () => answer.promise,
        threw: 'threw',
        isFailure: (outcome) => outcome === 'threw',
        pageId: page,
        pageSettled: settled,
        log: logDouble(),
        label: 'Test'
      });
      const asked = run.start();
      setPage('new');
      setSettled(true);
      answer.resolve('fresh');
      await asked;
      expect(run.state().shown).toMatchObject({ page: 'new', provisional: false });
      dispose();
    });
  });

  it('keeps a settled stamp when the page reloads during the ask (stale is the safe side)', async () => {
    await createRoot(async (dispose) => {
      const [page, setPage] = createSignal<string | null>('p1');
      const answer = deferred<string>();
      const run = createAskRun<string>({
        ask: () => answer.promise,
        threw: 'threw',
        isFailure: (outcome) => outcome === 'threw',
        pageId: page,
        pageSettled: () => true,
        log: logDouble(),
        label: 'Test'
      });
      const asked = run.start();
      setPage('p2');
      answer.resolve('one');
      await asked;
      expect(run.state().shown?.page).toBe('p1');
      expect(run.stale()).toBe(true);
      dispose();
    });
  });

  it('treats the shared page-unreachable shape as the failure', () => {
    expect(isPageUnreachable(ASK_THREW)).toBe(true);
    expect(isPageUnreachable({ kind: 'read' })).toBe(false);
  });

  it('records nothing once disposed', async () => {
    await createRoot(async (dispose) => {
      const answer = deferred<string>();
      const run = createAskRun<string>({
        ask: () => answer.promise,
        threw: 'threw',
        isFailure: (outcome) => outcome === 'threw',
        pageSettled: () => true,
        pageId: () => null,
        log: logDouble(),
        label: 'Test'
      });
      const pending = run.start();
      run.dispose();
      answer.resolve('late');
      await pending;
      expect(run.state().shown).toBeNull();
      dispose();
    });
  });
});
