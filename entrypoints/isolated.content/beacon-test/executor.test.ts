/**
 * The page's beacon executor over a fake runner: the runner is loaded only
 * when missing, every end becomes its typed reply (results count-bounded,
 * messages capped), the outer bound answers `timed-out` with the partial
 * results and stops the watchdog, one run at a time, and disposal stops a
 * running test.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { ScheduleTimer } from '../../../lib/messaging/bounded-ask';
import { BEACON_TEST_DEFAULTS } from '../../../lib/beacon-test/config';
import { BEACON_RUN_TIMEOUT_MS } from '../../../lib/beacon-test/deadlines';
import { RESULT_RECORDS_MAX } from '../../../lib/beacon-test/results';
import type {
  BeaconRunEnd,
  BeaconRunHandle,
  BeaconRunner
} from '../../../lib/beacon-test/runner-bridge';
import { boundRawResults, createBeaconTestExecutor } from './executor';

const REQUEST = {
  config: { ...BEACON_TEST_DEFAULTS, features: { aboveTheFold: false, lazyRender: true } }
};

/**
 * A handle whose end the test decides.
 *
 * @param partial - The handle's partial-results read.
 * @returns The handle, its `cancel` spy, and the trigger ending its run.
 */
function handleDouble(partial: () => unknown = () => ({ lcp: [], lrc: ['h'] })): {
  handle: BeaconRunHandle;
  cancel: Mock<() => void>;
  end: (value: BeaconRunEnd) => void;
} {
  let end: (value: BeaconRunEnd) => void = () => undefined;
  const cancel = vi.fn<() => void>();
  const handle: BeaconRunHandle = {
    done: new Promise<BeaconRunEnd>((resolve) => {
      end = resolve;
    }),
    partial,
    cancel
  };
  return {
    handle,
    cancel,
    end: (value) => {
      end(value);
    }
  };
}

/**
 * A runner starting the given handle.
 *
 * @param handle - What every `start` returns.
 * @returns The runner and its `start` spy.
 */
function runnerDouble(handle: BeaconRunHandle): {
  runner: BeaconRunner;
  start: Mock<BeaconRunner['start']>;
} {
  const start = vi.fn<BeaconRunner['start']>(() => handle);
  return { runner: { alive: () => true, start }, start };
}

/** A timer seam the test fires by hand. */
function manualTimer(): { schedule: ScheduleTimer; fire: () => void; armed: () => number[] } {
  const timers: { run: () => void; ms: number; live: boolean }[] = [];
  return {
    schedule: (run, ms) => {
      const timer = { run, ms, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    fire: () => {
      for (const timer of timers.filter((entry) => entry.live)) {
        timer.live = false;
        timer.run();
      }
    },
    armed: () => timers.filter((entry) => entry.live).map((entry) => entry.ms)
  };
}

describe('boundRawResults', () => {
  it('keeps one entry past the validator’s cap per feature list', () => {
    const lcp = Array.from({ length: RESULT_RECORDS_MAX + 10 }, (_, index) => index);
    const bounded = boundRawResults({ lcp, lrc: ['a'], extra: 1 }) as { lcp: number[] };
    expect(bounded).toEqual({ lcp: lcp.slice(0, RESULT_RECORDS_MAX + 1), lrc: ['a'] });
  });

  it('keeps non-list features and non-record results as they are', () => {
    expect(boundRawResults({ lcp: null })).toEqual({ lcp: null, lrc: undefined });
    expect(boundRawResults('raw')).toBe('raw');
    expect(boundRawResults(null)).toBeNull();
  });

  it('reads own fields only', () => {
    const inherited = Object.create({ lcp: ['smuggled'] }) as object;
    expect(boundRawResults(inherited)).toEqual({ lcp: undefined, lrc: undefined });
  });
});

describe('createBeaconTestExecutor', () => {
  it('runs a live runner without loading it, and answers its completed end', async () => {
    const { handle, end } = handleDouble();
    const { runner, start } = runnerDouble(handle);
    const loadRunner = vi.fn(() => Promise.resolve(true));
    const executor = createBeaconTestExecutor({ readRunner: () => runner, loadRunner });
    const reply = executor.run(REQUEST);
    await vi.waitFor(() => {
      expect(start).toHaveBeenCalledWith(REQUEST.config);
    });
    const lcp = Array<unknown>(RESULT_RECORDS_MAX + 5).fill({ type: 'img' });
    const scriptErrors = ['lazyRender'] as const;
    end({ kind: 'completed', results: { lcp, lrc: [] }, scriptErrors });
    const answer = await reply;
    expect(answer).toEqual({
      kind: 'completed',
      results: { lcp: lcp.slice(0, RESULT_RECORDS_MAX + 1), lrc: [] },
      scriptErrors: ['lazyRender']
    });
    expect(answer.kind === 'completed' && answer.scriptErrors).not.toBe(scriptErrors);
    expect(loadRunner).not.toHaveBeenCalled();
  });

  it('loads a missing runner, then runs it', async () => {
    const { handle, end } = handleDouble();
    const { runner, start } = runnerDouble(handle);
    let injected = false;
    const executor = createBeaconTestExecutor({
      readRunner: () => (injected ? runner : null),
      loadRunner: () => {
        injected = true;
        return Promise.resolve(true);
      }
    });
    const reply = executor.run(REQUEST);
    await vi.waitFor(() => {
      expect(start).toHaveBeenCalled();
    });
    end({ kind: 'bailed', reason: 'page-scrolled' });
    await expect(reply).resolves.toEqual({ kind: 'bailed', reason: 'page-scrolled' });
  });

  it('answers runner-unavailable when the load fails or publishes nothing', async () => {
    const failed = createBeaconTestExecutor({
      readRunner: () => null,
      loadRunner: () => Promise.resolve(false)
    });
    await expect(failed.run(REQUEST)).resolves.toEqual({ kind: 'runner-unavailable' });
    const empty = createBeaconTestExecutor({
      readRunner: () => null,
      loadRunner: () => Promise.resolve(true)
    });
    await expect(empty.run(REQUEST)).resolves.toEqual({ kind: 'runner-unavailable' });
  });

  it('answers a run refused or broken by the runner as failed, capped', async () => {
    const throwing: BeaconRunner = {
      alive: () => true,
      start: () => {
        throw new Error('x'.repeat(400));
      }
    };
    const executor = createBeaconTestExecutor({
      readRunner: () => throwing,
      loadRunner: () => Promise.resolve(true)
    });
    await expect(executor.run(REQUEST)).resolves.toEqual({
      kind: 'failed',
      message: `${'x'.repeat(300)}…`
    });

    const { handle, end } = handleDouble();
    const refused = createBeaconTestExecutor({
      readRunner: () => runnerDouble(handle).runner,
      loadRunner: () => Promise.resolve(true)
    });
    const reply = refused.run(REQUEST);
    await Promise.resolve();
    end({ kind: 'failed', message: 'Invalid beacon test configuration (no-feature)' });
    await expect(reply).resolves.toEqual({
      kind: 'failed',
      message: 'Invalid beacon test configuration (no-feature)'
    });
  });

  it('answers a rejecting run (a broken runner bundle) as failed', async () => {
    const handle: BeaconRunHandle = {
      done: Promise.reject(new Error('broken')),
      partial: () => null,
      cancel: () => undefined
    };
    const executor = createBeaconTestExecutor({
      readRunner: () => runnerDouble(handle).runner,
      loadRunner: () => Promise.resolve(true)
    });
    await expect(executor.run(REQUEST)).resolves.toEqual({ kind: 'failed', message: 'broken' });
    const plain: BeaconRunHandle = {
      done: Promise.reject(new Error('plain')),
      partial: () => null,
      cancel: () => undefined
    };
    const other = createBeaconTestExecutor({
      readRunner: () => runnerDouble(plain).runner,
      loadRunner: () => Promise.resolve(true)
    });
    await expect(other.run(REQUEST)).resolves.toMatchObject({ kind: 'failed' });
  });

  it('answers timed-out with the partial results past the outer bound, and stops the watchdog', async () => {
    const timer = manualTimer();
    const lrc = Array<string>(RESULT_RECORDS_MAX + 3).fill('h');
    const { handle, cancel, end } = handleDouble(() => ({ lcp: null, lrc }));
    const executor = createBeaconTestExecutor({
      readRunner: () => runnerDouble(handle).runner,
      loadRunner: () => Promise.resolve(true),
      schedule: timer.schedule
    });
    const reply = executor.run(REQUEST);
    await vi.waitFor(() => {
      expect(timer.armed()).toEqual([BEACON_RUN_TIMEOUT_MS]);
    });
    timer.fire();
    await expect(reply).resolves.toEqual({
      kind: 'timed-out',
      partial: { lcp: null, lrc: lrc.slice(0, RESULT_RECORDS_MAX + 1) }
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    // A late end changes nothing.
    end({ kind: 'bailed', reason: 'screen-size' });
  });

  it('answers timed-out with nothing collected when the partial read throws', async () => {
    const timer = manualTimer();
    const { handle } = handleDouble(() => {
      throw new Error('gone');
    });
    const executor = createBeaconTestExecutor({
      readRunner: () => runnerDouble(handle).runner,
      loadRunner: () => Promise.resolve(true),
      schedule: timer.schedule
    });
    const reply = executor.run(REQUEST);
    await vi.waitFor(() => {
      expect(timer.armed()).toHaveLength(1);
    });
    timer.fire();
    await expect(reply).resolves.toEqual({ kind: 'timed-out', partial: null });
  });

  it('clears the outer bound once the run ends in time', async () => {
    const timer = manualTimer();
    const { handle, cancel, end } = handleDouble();
    const executor = createBeaconTestExecutor({
      readRunner: () => runnerDouble(handle).runner,
      loadRunner: () => Promise.resolve(true),
      schedule: timer.schedule
    });
    const reply = executor.run(REQUEST);
    await vi.waitFor(() => {
      expect(timer.armed()).toHaveLength(1);
    });
    end({ kind: 'bailed', reason: 'screen-size' });
    await reply;
    expect(timer.armed()).toEqual([]);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('answers busy while a run is in flight, and runs again once it ended', async () => {
    const first = handleDouble();
    const second = handleDouble();
    const handles = [first.handle, second.handle];
    const runner: BeaconRunner = {
      alive: () => true,
      start: () => {
        const next = handles.shift();
        if (!next) throw new Error('no handle left for this start');
        return next;
      }
    };
    let loaded: (value: boolean) => void = () => undefined;
    const executor = createBeaconTestExecutor({
      readRunner: () => runner,
      loadRunner: () =>
        new Promise((resolve) => {
          loaded = resolve;
        })
    });
    const running = executor.run(REQUEST);
    await expect(executor.run(REQUEST)).resolves.toEqual({ kind: 'busy' });
    first.end({ kind: 'bailed', reason: 'screen-size' });
    await running;
    const again = executor.run(REQUEST);
    second.end({ kind: 'bailed', reason: 'page-scrolled' });
    await expect(again).resolves.toEqual({ kind: 'bailed', reason: 'page-scrolled' });
    loaded(true);
  });

  it('is busy during the runner load too', async () => {
    let loaded: (value: boolean) => void = () => undefined;
    const executor = createBeaconTestExecutor({
      readRunner: () => null,
      loadRunner: () =>
        new Promise((resolve) => {
          loaded = resolve;
        })
    });
    const first = executor.run(REQUEST);
    await expect(executor.run(REQUEST)).resolves.toEqual({ kind: 'busy' });
    loaded(false);
    await expect(first).resolves.toEqual({ kind: 'runner-unavailable' });
  });

  it('stops a running test’s watchdog on disposal (and is a no-op without one)', async () => {
    const { handle, cancel, end } = handleDouble();
    const executor = createBeaconTestExecutor({
      readRunner: () => runnerDouble(handle).runner,
      loadRunner: () => Promise.resolve(true)
    });
    executor.dispose();
    const reply = executor.run(REQUEST);
    await vi.waitFor(() => {
      executor.dispose();
      expect(cancel).toHaveBeenCalledTimes(1);
    });
    end({ kind: 'bailed', reason: 'screen-size' });
    await reply;
  });
});
