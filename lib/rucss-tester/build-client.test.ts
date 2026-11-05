/**
 * The time-boxed build client: one fresh worker per build, always
 * terminated; a runaway build ends as `timeout`, never inline.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ScheduleTimer } from '../messaging/bounded-ask';
import type { RucssBuildInput } from './build';
import { buildRucssInWorker, type BuildWorkerLike } from './build-client';
import { DEFAULT_RUCSS_TESTER_CONFIG } from './config';
import { RUCSS_BUILD_TIMEOUT_MS } from './deadlines';

const INPUT: RucssBuildInput = {
  config: DEFAULT_RUCSS_TESTER_CONFIG,
  shakenCss: 'a{}',
  links: ['u']
};

/** A worker double; `answer` (when given) is posted back on the next microtask. */
function workerDouble(answer?: unknown): BuildWorkerLike & { posted: unknown[] } {
  const posted: unknown[] = [];
  const worker: BuildWorkerLike & { posted: unknown[] } = {
    posted,
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminate: vi.fn(),
    postMessage: vi.fn((message: unknown) => {
      posted.push(message);
      if (answer !== undefined) {
        queueMicrotask(() => worker.onmessage?.({ data: answer }));
      }
    })
  };
  return worker;
}

/** A timer seam whose deadline the test fires by hand. */
function manualTimer(): { schedule: ScheduleTimer; fire: () => void; ms: () => number } {
  let run = (): void => undefined;
  let armed = 0;
  return {
    schedule: (callback, ms) => {
      run = callback;
      armed = ms;
      return () => {
        run = () => undefined;
      };
    },
    fire: () => {
      run();
    },
    ms: () => armed
  };
}

describe('buildRucssInWorker', () => {
  it('posts the input and answers the worker’s result, then terminates it', async () => {
    const result = { ok: true, css: 'a{}', applied: [], keepLinks: [0] };
    const worker = workerDouble(result);
    const outcome = await buildRucssInWorker(INPUT, { createWorker: () => worker });
    expect(outcome).toEqual(result);
    expect(worker.posted).toEqual([INPUT]);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull();
  });

  it('passes a build failure through', async () => {
    const failure = { ok: false, problem: 'pattern-failed', index: 2, message: 'stack' };
    const outcome = await buildRucssInWorker(INPUT, { createWorker: () => workerDouble(failure) });
    expect(outcome).toEqual(failure);
  });

  it('stops a runaway build at the budget: terminated, `timeout`, late answers dropped', async () => {
    const worker = workerDouble();
    const timer = manualTimer();
    const pending = buildRucssInWorker(INPUT, {
      createWorker: () => worker,
      schedule: timer.schedule
    });
    expect(timer.ms()).toBe(RUCSS_BUILD_TIMEOUT_MS);
    const late = worker.onmessage;
    timer.fire();
    await expect(pending).resolves.toEqual({ ok: false, problem: 'timeout' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    late?.({ data: { ok: true, css: '', applied: [], keepLinks: [] } });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('honours a custom budget', () => {
    const timer = manualTimer();
    void buildRucssInWorker(INPUT, {
      createWorker: () => workerDouble(),
      schedule: timer.schedule,
      timeoutMs: 50
    });
    expect(timer.ms()).toBe(50);
    timer.fire();
  });

  it('is `unavailable` without a worker — the patterns never run inline', async () => {
    await expect(
      buildRucssInWorker(INPUT, {
        createWorker: () => {
          throw new Error('no Worker');
        }
      })
    ).resolves.toEqual({ ok: false, problem: 'unavailable' });
  });

  it('is `unavailable` on the real spawn where the platform has no Worker', async () => {
    vi.stubGlobal('Worker', undefined);
    try {
      await expect(buildRucssInWorker(INPUT)).resolves.toEqual({
        ok: false,
        problem: 'unavailable'
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('spawns the bundled module worker by default', async () => {
    const spawned: { url: string; options: unknown }[] = [];
    vi.stubGlobal(
      'Worker',
      class {
        onmessage: ((event: { data: unknown }) => void) | null = null;
        onerror: ((event: unknown) => void) | null = null;
        onmessageerror: ((event: unknown) => void) | null = null;
        constructor(url: URL, options: unknown) {
          spawned.push({ url: url.href, options });
        }
        postMessage(): void {
          queueMicrotask(() =>
            this.onmessage?.({ data: { ok: false, problem: 'invalid-config' } })
          );
        }
        terminate(): void {
          // Nothing to stop in the double.
        }
      }
    );
    try {
      await expect(buildRucssInWorker(INPUT)).resolves.toEqual({
        ok: false,
        problem: 'invalid-config'
      });
      expect(spawned).toHaveLength(1);
      expect(spawned[0]?.url).toContain('build.worker');
      expect(spawned[0]?.options).toEqual({ type: 'module' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('is `failed` on a worker error, an undeserializable or junk answer, or an uncloneable input', async () => {
    const erroring = workerDouble();
    const pending = buildRucssInWorker(INPUT, { createWorker: () => erroring });
    erroring.onerror?.(new Event('error'));
    await expect(pending).resolves.toEqual({ ok: false, problem: 'failed' });
    expect(erroring.terminate).toHaveBeenCalledTimes(1);

    // An answer that cannot be deserialized fails at once — the budget is never waited out.
    const timer = manualTimer();
    const unreadable = workerDouble();
    const unread = buildRucssInWorker(INPUT, {
      createWorker: () => unreadable,
      schedule: timer.schedule
    });
    unreadable.onmessageerror?.(new MessageEvent('messageerror'));
    await expect(unread).resolves.toEqual({ ok: false, problem: 'failed' });
    expect(unreadable.terminate).toHaveBeenCalledTimes(1);
    expect([unreadable.onmessage, unreadable.onerror, unreadable.onmessageerror]).toEqual([
      null,
      null,
      null
    ]);
    timer.fire();
    expect(unreadable.terminate).toHaveBeenCalledTimes(1);

    for (const junk of [
      null,
      'x',
      { ok: true },
      { ok: true, css: '', applied: [] },
      { ok: false }
    ]) {
      await expect(
        buildRucssInWorker(INPUT, { createWorker: () => workerDouble(junk) }),
        JSON.stringify(junk)
      ).resolves.toEqual({ ok: false, problem: 'failed' });
    }

    const throwing = workerDouble();
    throwing.postMessage = () => {
      throw new DOMException('could not be cloned', 'DataCloneError');
    };
    await expect(buildRucssInWorker(INPUT, { createWorker: () => throwing })).resolves.toEqual({
      ok: false,
      problem: 'failed'
    });
    expect(throwing.terminate).toHaveBeenCalledTimes(1);
  });
});
