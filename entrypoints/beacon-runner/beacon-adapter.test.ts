/**
 * The beacon adapter: per-instance overrides over a fake beacon class (no
 * site request, no save, no completion mark, silent logger, watchdog only
 * finalizes, bails and failures named), then the real installed package run
 * in the test DOM to prove the same with its actual code — no fetch, no
 * console output, no prototype patch, and no throw on a page without
 * WP Rocket's beacon script.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import BeaconManager from 'wp-rocket-scripts/src/BeaconManager.js';
import type { BeaconPackageOptions } from '../../lib/beacon-test/config';
import { startBeaconRun, testRunClass, type BeaconManagerClass } from './beacon-adapter';

/** Options that fit the test DOM's viewport on desktop. */
const OPTIONS: BeaconPackageOptions = {
  is_mobile: false,
  elements: 'img,div',
  width_threshold: 1,
  height_threshold: 1,
  lrc_threshold: 1800,
  debug: true,
  status: { atf: true, lrc: true }
};

/** What a fake run should do inside `init`. */
interface FakeScript {
  readonly preconditions?: boolean;
  readonly scrolled?: boolean;
  readonly throws?: Error;
  readonly lcp?: unknown;
  readonly lrc?: unknown;
  readonly lcpError?: boolean;
}

/**
 * A fake beacon class mirroring the package's `init` control flow (bail on
 * preconditions → bail on scroll → watchdog → generated-before → features →
 * save), recording what the base methods would have done.
 */
function fakeBase(script: FakeScript, calls: string[]): BeaconManagerClass {
  class Fake {
    config: object;
    lcpBeacon: { getResults(): unknown; errorCode?: string } | null = null;
    lrcBeacon: { getResults(): unknown; errorCode?: string } | null = null;
    infiniteLoopId: ReturnType<typeof setTimeout> | null = null;
    logger = {
      logMessage: (label: unknown) => calls.push(`base-log:${String(label)}`),
      logColoredMessage: (message: string) => calls.push(`base-log:${message}`)
    };

    constructor(config: object) {
      this.config = config;
    }

    async init(): Promise<void> {
      this.logger.logMessage('start');
      if (script.throws) throw script.throws;
      if (!(await this._isValidPreconditions())) {
        this._finalize();
        return;
      }
      if (script.scrolled === true) {
        this._finalize();
        return;
      }
      this.infiniteLoopId = setTimeout(() => {
        this._handleInfiniteLoop();
      }, 10_000);
      calls.push(`generated-before:${String(await this._getGeneratedBefore())}`);
      this.lcpBeacon = {
        getResults: () => script.lcp ?? [],
        ...(script.lcpError === true && { errorCode: 'script_error' })
      };
      this.lrcBeacon = { getResults: () => script.lrc ?? [] };
      this._saveFinalResultIntoDB();
    }

    _isValidPreconditions(): Promise<boolean> {
      return Promise.resolve(script.preconditions ?? true);
    }
    _getGeneratedBefore(): Promise<unknown> {
      calls.push('base-generated-before');
      return Promise.resolve({ lcp: true });
    }
    _saveFinalResultIntoDB(): void {
      calls.push('base-save');
    }
    _handleInfiniteLoop(): void {
      calls.push('base-watchdog');
    }
    _finalize(): void {
      calls.push('base-finalize');
    }
  }
  return Fake;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('test run over a fake beacon', () => {
  it('completes with the raw results and touches no base side effect', async () => {
    const calls: string[] = [];
    const handle = startBeaconRun(OPTIONS, fakeBase({ lcp: [{ type: 'img' }], lrc: ['h'] }, calls));
    await expect(handle.done).resolves.toEqual({
      kind: 'completed',
      results: { lcp: [{ type: 'img' }], lrc: ['h'] },
      scriptErrors: []
    });
    expect(calls).toEqual(['generated-before:false']);
  });

  it('names a feature whose scan threw', async () => {
    const handle = startBeaconRun(OPTIONS, fakeBase({ lcpError: true }, []));
    await expect(handle.done).resolves.toMatchObject({ scriptErrors: ['aboveTheFold'] });
  });

  it('names the viewport bail, then the scroll bail', async () => {
    const calls: string[] = [];
    await expect(
      startBeaconRun(OPTIONS, fakeBase({ preconditions: false }, calls)).done
    ).resolves.toEqual({ kind: 'bailed', reason: 'screen-size' });
    await expect(
      startBeaconRun(OPTIONS, fakeBase({ scrolled: true }, calls)).done
    ).resolves.toEqual({
      kind: 'bailed',
      reason: 'page-scrolled'
    });
    expect(calls).toEqual([]);
  });

  it('turns a rejected init into a bounded failure', async () => {
    const handle = startBeaconRun(OPTIONS, fakeBase({ throws: new Error('x'.repeat(400)) }, []));
    const end = await handle.done;
    expect(end.kind).toBe('failed');
    expect(end.kind === 'failed' && end.message).toBe(`${'x'.repeat(300)}…`);
    const other = startBeaconRun(OPTIONS, fakeBase({ throws: 'plain' as unknown as Error }, []));
    await expect(other.done).resolves.toEqual({ kind: 'failed', message: 'plain' });
  });

  it('silences the logger the base created', () => {
    const calls: string[] = [];
    const run = new (testRunClass(fakeBase({}, calls)))(OPTIONS) as unknown as {
      logger: { logMessage(label: unknown): void };
    };
    run.logger.logMessage('anything');
    expect(calls).toEqual([]);
  });

  it('reports partial results and stops the watchdog on cancel', () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const Base = fakeBase({ lcp: [{ type: 'img' }] }, calls);
    // A beacon stuck after arming its watchdog: init never returns.
    const Stuck = class extends Base {
      override async init(): Promise<void> {
        this.infiniteLoopId = setTimeout(() => {
          this._handleInfiniteLoop();
        }, 10_000);
        this.lcpBeacon = { getResults: () => [{ type: 'img' }] };
        await new Promise<never>(() => undefined);
      }
    };
    const handle = startBeaconRun(OPTIONS, Stuck);
    expect(handle.partial()).toEqual({ lcp: [{ type: 'img' }], lrc: null });
    handle.cancel();
    expect(vi.getTimerCount()).toBe(0);
    expect(calls).toEqual([]);
  });

  it('lets the watchdog only finalize (no save)', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const Base = fakeBase({}, calls);
    let resolveInit = (): void => undefined;
    const Slow = class extends Base {
      override async init(): Promise<void> {
        this.infiniteLoopId = setTimeout(() => {
          this._handleInfiniteLoop();
        }, 10_000);
        await new Promise<void>((resolve) => {
          resolveInit = resolve;
        });
      }
    };
    const handle = startBeaconRun(OPTIONS, Slow);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toEqual([]);
    resolveInit();
    // Init returned without saving: an unsaved end reads as the scroll bail.
    await expect(handle.done).resolves.toEqual({ kind: 'bailed', reason: 'page-scrolled' });
  });
});

describe('test run over the installed package', () => {
  it('runs both features without any request, console output or page mark', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const logSpy = vi.spyOn(console, 'log');
    const prototypeBefore = Object.getOwnPropertyNames(BeaconManager.prototype).map((name) => [
      name,
      Reflect.get(BeaconManager.prototype, name) as unknown
    ]);
    // A page without WP Rocket's beacon script: the package's own finalize would throw here.
    document.body.innerHTML = '<div data-rocket-location-hash="h1"></div><img src="a.jpg">';

    const end = await startBeaconRun(OPTIONS).done;

    expect(end).toEqual({ kind: 'completed', results: { lcp: [], lrc: [] }, scriptErrors: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(document.querySelector('[beacon-completed]')).toBeNull();
    expect(
      Object.getOwnPropertyNames(BeaconManager.prototype).map((name) => [
        name,
        Reflect.get(BeaconManager.prototype, name) as unknown
      ])
    ).toEqual(prototypeBefore);
  });

  it('bails on the viewport check with real thresholds', async () => {
    const end = await startBeaconRun({ ...OPTIONS, width_threshold: 100_000 }).done;
    expect(end).toEqual({ kind: 'bailed', reason: 'screen-size' });
  });

  it('reports a scan that threw on an invalid selector list', async () => {
    const end = await startBeaconRun({ ...OPTIONS, elements: 'div[' }).done;
    expect(end).toMatchObject({ kind: 'completed', scriptErrors: ['aboveTheFold'] });
  });

  it('leaves the gate script of a WP Rocket page untouched', async () => {
    document.body.innerHTML = '<script data-name="wpr-wpr-beacon"></script>';
    await startBeaconRun(OPTIONS).done;
    expect(
      document.querySelector('[data-name="wpr-wpr-beacon"]')?.hasAttribute('beacon-completed')
    ).toBe(false);
  });
});
