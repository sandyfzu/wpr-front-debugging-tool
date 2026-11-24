/**
 * The redirecting hook: its URL filter (built from the host patterns, a
 * malformed one refused by name), its answer per request — a redirect
 * only for a tab's top-frame request the host names, nothing otherwise,
 * a host fault logged and left to the site — and its per-tab holding: one
 * tab-filtered listener per tab whose live session simulates LazyLoad,
 * following arm / resume / disarm.
 */
import { describe, expect, it, vi } from 'vitest';
import type { InterceptionBackend } from './backend';
import {
  createRuntimeHooks,
  createRuntimeRedirect,
  needsRuntimeHook,
  runtimeRequestPatterns,
  withRuntimeHooks,
  type RuntimeHookEvent,
  type RuntimeHookListener
} from './runtime-redirect';

const URL =
  'https://site.test/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js';
const PACKAGED = 'moz-extension://id/wp-rocket-simulation/lazyload/17.8.3/lazyload.min.js';
const PAGE = 'https://site.test/post';
/** A top-frame request of tab 2's page for {@link URL}. */
const REQUEST = { tabId: 2, frameId: 0, url: URL, documentUrl: PAGE, type: 'script' };

describe('runtimeRequestPatterns', () => {
  it('matches the runtime name on every host and port of each scheme', () => {
    expect(runtimeRequestPatterns(['https://*/*', 'http://*/*'])).toEqual([
      'https://*/*/lazyload.min.js',
      'http://*/*/lazyload.min.js'
    ]);
  });

  it('refuses a host pattern of another form, naming it', () => {
    expect(() => runtimeRequestPatterns(['https://site.test/*'])).toThrow(
      'Host pattern not of the form <scheme>://*/*: https://site.test/*'
    );
  });
});

describe('createRuntimeRedirect', () => {
  /** A hook over a host naming {@link PACKAGED} for {@link URL} in tab 2. */
  function hook(
    simulatedRuntime = vi.fn((tabId: number, url: string, documentUrl: string) =>
      Promise.resolve(
        tabId === 2 && url === URL && documentUrl === PAGE
          ? { url: PACKAGED, bytes: new Uint8Array() }
          : null
      )
    )
  ) {
    const log = { error: vi.fn() };
    return {
      redirect: createRuntimeRedirect({ host: { simulatedRuntime }, log }),
      log,
      simulatedRuntime
    };
  }

  it('redirects the request the host names to the packaged copy', async () => {
    const { redirect, simulatedRuntime } = hook();
    await expect(redirect(REQUEST)).resolves.toEqual({ redirectUrl: PACKAGED });
    expect(simulatedRuntime).toHaveBeenCalledWith(2, URL, PAGE);
  });

  it('leaves a request the host names nothing for', async () => {
    await expect(hook().redirect({ ...REQUEST, url: `${URL}?v=2` })).resolves.toEqual({});
    await expect(
      hook().redirect({ ...REQUEST, documentUrl: 'https://other.test/post' })
    ).resolves.toEqual({});
  });

  it.each([
    ['a sub-frame', { ...REQUEST, frameId: 5 }],
    ['a tab-less request', { ...REQUEST, tabId: -1 }],
    ['malformed details', { ...REQUEST, tabId: '2' }],
    ['no requesting document', { ...REQUEST, documentUrl: undefined }],
    ['no details', null]
  ])('leaves %s without asking the host', async (_name, details) => {
    const { redirect, simulatedRuntime } = hook();
    await expect(redirect(details)).resolves.toEqual({});
    expect(simulatedRuntime).not.toHaveBeenCalled();
  });

  it('logs a host fault and leaves the request', async () => {
    const { redirect, log } = hook(vi.fn(() => Promise.reject(new Error('broke'))));
    await expect(redirect(REQUEST)).resolves.toEqual({});
    expect(log.error).toHaveBeenCalledWith(
      'Simulated runtime hook failed — request left to the site',
      expect.objectContaining({ tabId: 2 })
    );
  });
});

describe('needsRuntimeHook', () => {
  it('holds for a session simulating LazyLoad only', () => {
    expect(needsRuntimeHook({ features: ['delay_js', 'lazyload'] })).toBe(true);
    expect(needsRuntimeHook({ features: ['delay_js', 'defer_all_js'] })).toBe(false);
    expect(needsRuntimeHook({ features: [] })).toBe(false);
    expect(needsRuntimeHook(undefined)).toBe(false);
  });
});

/** A fake blocking event recording the live listeners and their filters. */
function fakeEvent(fail: { add?: boolean; remove?: boolean } = {}) {
  const live = new Map<RuntimeHookListener, unknown>();
  const event: RuntimeHookEvent = {
    addListener: (listener, filter, extra) => {
      if (fail.add === true) throw new Error('refused');
      live.set(listener, { filter, extra });
    },
    removeListener: (listener) => {
      if (fail.remove === true) throw new Error('refused');
      live.delete(listener);
    }
  };
  return { event, live };
}

describe('createRuntimeHooks', () => {
  const URLS = ['https://*/*/lazyload.min.js'];
  const make = (fail?: { add?: boolean; remove?: boolean }) => {
    const { event, live } = fakeEvent(fail);
    const hook = vi.fn(() => Promise.resolve({}));
    const log = { error: vi.fn() };
    return { hooks: createRuntimeHooks({ event, urls: URLS, hook, log }), live, hook, log };
  };

  it('holds one blocking listener per tab, filtered to that tab, idempotently', async () => {
    const { hooks, live, hook } = make();
    hooks.set(2, true);
    hooks.set(2, true);
    hooks.set(7, true);
    expect([...live.values()]).toEqual([
      { filter: { urls: URLS, types: ['script'], tabId: 2 }, extra: ['blocking'] },
      { filter: { urls: URLS, types: ['script'], tabId: 7 }, extra: ['blocking'] }
    ]);
    expect(hooks.heldTabs()).toEqual([2, 7]);
    // Each listener runs the one hook body.
    await [...live.keys()][0]?.(REQUEST);
    expect(hook).toHaveBeenCalledWith(REQUEST);
  });

  it('drops a tab’s listener only, and dropping an unheld tab is a no-op', () => {
    const { hooks, live } = make();
    hooks.set(2, true);
    hooks.set(7, true);
    hooks.set(2, false);
    hooks.set(9, false);
    expect([...live.values()]).toEqual([
      { filter: { urls: URLS, types: ['script'], tabId: 7 }, extra: ['blocking'] }
    ]);
    expect(hooks.heldTabs()).toEqual([7]);
  });

  it('logs a refused registration and holds nothing for the tab', () => {
    const { hooks, log } = make({ add: true });
    hooks.set(2, true);
    expect(hooks.heldTabs()).toEqual([]);
    expect(log.error).toHaveBeenCalledWith(
      'Simulated runtime hook not registered — runtime left to the site',
      expect.objectContaining({ tabId: 2 })
    );
  });

  it('logs a refused removal and forgets the tab', () => {
    const { hooks, log } = make({ remove: true });
    hooks.set(2, true);
    hooks.set(2, false);
    expect(hooks.heldTabs()).toEqual([]);
    expect(log.error).toHaveBeenCalledWith(
      'Simulated runtime hook not removed',
      expect.objectContaining({ tabId: 2 })
    );
  });
});

describe('withRuntimeHooks', () => {
  const LAZY = { features: ['lazyload' as const] };
  /** A backend arming / resuming per the flags, and a recording hook holder. */
  const make = (armed = true, live = true) => {
    const arm = vi.fn<InterceptionBackend['arm']>(() =>
      Promise.resolve(
        armed ? { armed: true as const } : { armed: false as const, cause: 'detached' as const }
      )
    );
    const resume = vi.fn<InterceptionBackend['resume']>(() => Promise.resolve(live));
    const disarm = vi.fn<InterceptionBackend['disarm']>(() => Promise.resolve());
    const backend: InterceptionBackend = { arm, resume, disarm, runner: vi.fn() };
    const set = vi.fn();
    return {
      wrapped: withRuntimeHooks(backend, { set, heldTabs: () => [] }),
      backend,
      arm,
      resume,
      disarm,
      set
    };
  };

  it('holds the hook on an arm or resume for a LazyLoad simulation, passing every argument on', async () => {
    const { wrapped, arm, resume, set } = make();
    await expect(wrapped.arm(2, 1, 'https://site.test', LAZY)).resolves.toEqual({ armed: true });
    expect(arm).toHaveBeenCalledWith(2, 1, 'https://site.test', LAZY);
    await expect(wrapped.resume(3, 1, 'https://site.test', LAZY)).resolves.toBe(true);
    expect(resume).toHaveBeenCalledWith(3, 1, 'https://site.test', LAZY);
    expect(set.mock.calls).toEqual([
      [2, true],
      [3, true]
    ]);
  });

  it('holds none for another simulation, a failed arm or a stale resume', async () => {
    const plain = make();
    await plain.wrapped.arm(2, 1, 'https://site.test', { features: ['delay_js'] });
    await plain.wrapped.arm(2, 1, 'https://site.test');
    const failing = make(false, false);
    await failing.wrapped.arm(2, 1, 'https://site.test', LAZY);
    await failing.wrapped.resume(2, 1, 'https://site.test', LAZY);
    expect([...plain.set.mock.calls, ...failing.set.mock.calls]).toEqual([
      [2, false],
      [2, false],
      [2, false],
      [2, false]
    ]);
  });

  it('drops the hook before disarming, and on a rejected arm or resume (rethrown)', async () => {
    const { wrapped, arm, resume, disarm, set } = make();
    await wrapped.disarm(2);
    expect(set).toHaveBeenCalledWith(2, false);
    expect(disarm).toHaveBeenCalledWith(2);
    arm.mockRejectedValueOnce(new Error('arm broke'));
    await expect(wrapped.arm(2, 1, 'https://site.test', LAZY)).rejects.toThrow('arm broke');
    resume.mockRejectedValueOnce(new Error('resume broke'));
    await expect(wrapped.resume(2, 1, 'https://site.test', LAZY)).rejects.toThrow('resume broke');
    expect(set.mock.calls).toEqual([
      [2, false],
      [2, false],
      [2, false]
    ]);
  });

  it('keeps the backend’s other members', () => {
    const runner = vi.fn();
    const backend = { ...make().backend, runner, extra: 1 };
    const wrapped = withRuntimeHooks(backend, { set: vi.fn(), heldTabs: () => [] });
    expect(wrapped.runner).toBe(runner);
    expect(wrapped.extra).toBe(1);
  });
});
