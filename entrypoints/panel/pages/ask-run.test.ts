/**
 * The panel's ask machine: idle → pending → shown, the shown answer kept
 * while a newer ask is pending, one ask at a time, a throwing ask shown as
 * the failure outcome and logged, stale once the page load changes, nothing
 * recorded after disposal.
 */
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../../lib/logger';
import { createAskRun } from './ask-run';

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
        pageId: page,
        log: logDouble(),
        label: 'Test'
      });
      expect(run.state()).toEqual({ pending: false, shown: null });
      const first = run.start();
      expect(run.state()).toEqual({ pending: true, shown: null });
      answers[0]?.resolve('one');
      await first;
      expect(run.state()).toEqual({
        pending: false,
        shown: { outcome: 'one', page: 'p1', sequence: 1 }
      });
      const second = run.start();
      expect(run.state().pending).toBe(true);
      expect(run.state().shown?.outcome).toBe('one');
      answers[1]?.resolve('two');
      await second;
      expect(run.state().shown).toEqual({ outcome: 'two', page: 'p1', sequence: 2 });
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

  it('records nothing once disposed', async () => {
    await createRoot(async (dispose) => {
      const answer = deferred<string>();
      const run = createAskRun<string>({
        ask: () => answer.promise,
        threw: 'threw',
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
