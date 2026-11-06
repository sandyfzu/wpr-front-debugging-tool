/**
 * The beacon test end to end inside one isolated world, over a fake beacon
 * module and the installed package: the runner (as injected) publishes its
 * bridge, the page executor drives it, and the panel's reply guard
 * validates the answer. Proves the per-instance overrides (no site request,
 * no gate attribute, no prototype patch, no console), the beacon's own
 * watchdog only finalizing, the outer bound answering the partial
 * results, and disposal (the context's end) stopping the watchdog and the
 * outer bound before either fires.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import BeaconManager from 'wp-rocket-scripts/src/BeaconManager.js';
import { BEACON_TEST_DEFAULTS, type BeaconTestConfig } from '../../../lib/beacon-test/config';
import { BEACON_RUN_TIMEOUT_MS } from '../../../lib/beacon-test/deadlines';
import {
  publishBeaconRunner,
  readBeaconRunner,
  type IsolatedWorld
} from '../../../lib/beacon-test/runner-bridge';
import { parseBeaconTestReply } from '../../../lib/messaging/beacon-test';
import { startBeaconRun, type BeaconManagerClass } from '../../beacon-runner/beacon-adapter';
import { createRunner } from '../../beacon-runner/index';
import { createBeaconTestExecutor } from './executor';

/** A configuration the test DOM's viewport passes on desktop. */
const CONFIG: BeaconTestConfig = {
  ...BEACON_TEST_DEFAULTS,
  features: { aboveTheFold: true, lazyRender: true },
  widthThreshold: 1,
  heightThreshold: 1,
  selectors: ['img', 'div']
};

/**
 * A fake beacon module: the package's `init` order (preconditions, scroll,
 * watchdog, generated-before, features, save), whose feature scan never
 * finishes — a page the beacon cannot get through in time.
 */
function hangingBeacon(calls: string[]): BeaconManagerClass {
  class Hanging {
    config: object;
    lcpBeacon: { getResults(): unknown; errorCode?: string } | null = null;
    lrcBeacon: { getResults(): unknown; errorCode?: string } | null = null;
    infiniteLoopId: ReturnType<typeof setTimeout> | null = null;
    logger = { logMessage: () => undefined, logColoredMessage: () => undefined };

    constructor(config: object) {
      this.config = config;
    }

    async init(): Promise<void> {
      if (!(await this._isValidPreconditions())) return;
      this.infiniteLoopId = setTimeout(() => {
        this._handleInfiniteLoop();
      }, 10_000);
      await this._getGeneratedBefore();
      this.lcpBeacon = { getResults: () => [{ type: 'img', label: 'seen-so-far' }] };
      await new Promise(() => undefined);
    }

    _isValidPreconditions(): Promise<boolean> {
      return Promise.resolve(true);
    }
    _getGeneratedBefore(): Promise<unknown> {
      calls.push('site-generated-before');
      return Promise.resolve({});
    }
    _saveFinalResultIntoDB(): void {
      calls.push('site-save');
    }
    _handleInfiniteLoop(): void {
      calls.push('site-watchdog');
    }
    _finalize(): void {
      calls.push('site-finalize');
    }
  }
  return Hanging;
}

/** One isolated world: the runner published as the injected script does, the executor reading it. */
function world(start?: typeof startBeaconRun) {
  const global: IsolatedWorld = {};
  const loadRunner = vi.fn(() => {
    publishBeaconRunner(global, createRunner({ alive: () => true, document }, start));
    return Promise.resolve(true);
  });
  const executor = createBeaconTestExecutor({
    readRunner: () => readBeaconRunner(global),
    loadRunner
  });
  return { executor, loadRunner };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('beacon test over the installed package', () => {
  it('injects the runner once, measures, and writes nothing anywhere', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const logSpy = vi.spyOn(console, 'log');
    const prototypeBefore = Object.getOwnPropertyNames(BeaconManager.prototype).map(
      (name): unknown => Reflect.get(BeaconManager.prototype, name)
    );
    document.body.innerHTML =
      '<script data-name="wpr-wpr-beacon"></script><div data-rocket-location-hash="h1"></div>';
    const { executor, loadRunner } = world();

    const first = parseBeaconTestReply(await executor.run({ config: CONFIG }));
    const second = parseBeaconTestReply(await executor.run({ config: CONFIG }));

    expect(first).toMatchObject({
      kind: 'completed',
      scriptErrors: [],
      results: { aboveTheFold: { kind: 'ok' }, lazyRender: { kind: 'ok' } }
    });
    expect(second?.kind).toBe('completed');
    expect(loadRunner).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(
      document.querySelector('[data-name="wpr-wpr-beacon"]')?.hasAttribute('beacon-completed')
    ).toBe(false);
    expect(
      Object.getOwnPropertyNames(BeaconManager.prototype).map((name): unknown =>
        Reflect.get(BeaconManager.prototype, name)
      )
    ).toEqual(prototypeBefore);
  });

  it('runs every request with a fresh configuration (no sticky device)', async () => {
    const { executor } = world();
    const mobile = await executor.run({
      config: { ...CONFIG, mobile: true, widthThreshold: 1, heightThreshold: 1 }
    });
    const desktop = await executor.run({ config: CONFIG });
    // Mobile thresholds are maxima: a 1×1 limit refuses the test viewport; desktop's minima pass.
    expect(mobile).toEqual({ kind: 'bailed', reason: 'screen-size' });
    expect(desktop.kind).toBe('completed');
  });

  it('answers the runner’s own refusal of a configuration the page cannot parse', async () => {
    const { executor } = world();
    const reply = await executor.run({ config: { ...CONFIG, selectors: ['div['] } });
    expect(reply).toEqual({
      kind: 'failed',
      message: 'Invalid beacon test configuration (selector-invalid)'
    });
  });
});

describe('beacon test over a fake beacon module', () => {
  it('lets the beacon’s watchdog only finalize, then answers the partial results at the outer bound', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const { executor } = world((options) => startBeaconRun(options, hangingBeacon(calls)));

    const reply = executor.run({ config: CONFIG });
    await vi.advanceTimersByTimeAsync(10_000);
    // The beacon's own watchdog fired: finalized, never saved.
    expect(calls).toEqual([]);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(BEACON_RUN_TIMEOUT_MS - 10_000);
    const answer = parseBeaconTestReply(await reply);
    expect(answer).toMatchObject({
      kind: 'timed-out',
      partial: { aboveTheFold: { kind: 'ok', items: [{ label: 'seen-so-far' }] }, lazyRender: null }
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(calls).toEqual([]);
  });

  it('stops the watchdog and the outer bound on disposal before either fires', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const { executor } = world((options) => startBeaconRun(options, hangingBeacon(calls)));
    const reply = executor.run({ config: CONFIG });
    await vi.advanceTimersByTimeAsync(0);
    // The run's watchdog and the outer bound.
    expect(vi.getTimerCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(5_000);
    executor.dispose();
    // Nothing stays scheduled; the wait ends at once with what was seen.
    expect(vi.getTimerCount()).toBe(0);
    expect(parseBeaconTestReply(await reply)).toMatchObject({
      kind: 'timed-out',
      partial: { aboveTheFold: { kind: 'ok', items: [{ label: 'seen-so-far' }] } }
    });
    await vi.advanceTimersByTimeAsync(BEACON_RUN_TIMEOUT_MS);
    expect(vi.getTimerCount()).toBe(0);
    expect(calls).toEqual([]);
  });
});
