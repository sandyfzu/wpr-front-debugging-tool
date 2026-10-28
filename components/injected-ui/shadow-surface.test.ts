/**
 * The cycled shadow surface over WXT's REAL shadow-root factory (happy-dom,
 * a real content-script context): one instance per surface across
 * show/hide cycles, renders bound to their mount (a remove during the
 * appearance read or the render never leaks a tree or a late disposer),
 * failures reported with their original cause, guarded teardown, and the
 * dead-context removal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import {
  createShadowSurface,
  type ShadowSurfaceOptions,
  type ShadowUiHooks
} from './shadow-surface';
import { renders, resetRenders, settle } from './deferred-mount.testing';

/**
 * The shared mount is replaced by a deferred one (its own contract is
 * `mount.test.ts`'s): each call parks until the test settles it, which is
 * exactly the awaited appearance read + render window under test.
 */
vi.mock('./mount', () => import('./deferred-mount.testing'));

let contextSeq = 0;
let ctx: ContentScriptContext;

beforeEach(() => {
  resetRenders();
  // A unique name: a same-name context would invalidate the previous one.
  contextSeq += 1;
  ctx = new ContentScriptContext(`surface-test-${String(contextSeq)}`);
});

afterEach(() => {
  ctx.notifyInvalidated();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** Options over WXT's real factory, with a creation counter. */
function realOptions(overrides: Partial<ShadowSurfaceOptions> = {}): {
  options: ShadowSurfaceOptions;
  created: () => number;
} {
  let count = 0;
  const options: ShadowSurfaceOptions = {
    create: (hooks: ShadowUiHooks) => {
      count += 1;
      return createShadowRootUi(ctx, {
        name: 'surface-probe',
        position: 'inline',
        onMount: hooks.onMount,
        onRemove: hooks.onRemove
      });
    },
    view: () => document.createElement('div'),
    isInvalid: () => ctx.isInvalid,
    onRenderError: vi.fn(),
    ...overrides
  };
  return { options, created: () => count };
}

const hosts = (): number => document.querySelectorAll('surface-probe').length;

describe('createShadowSurface', () => {
  it('mounts, renders and reports the view up (normal mount)', async () => {
    const { options } = realOptions();
    const surface = createShadowSurface(options);
    await expect(surface.show(() => true)).resolves.toBe('shown');
    expect(hosts()).toBe(1);
    expect(surface.isShown()).toBe(true);
    const up = surface.rendered();
    renders[0]?.resolve();
    await expect(up).resolves.toBe(true);
    expect(renders[0]?.signal?.aborted).toBe(false);
  });

  it('reuses ONE shadow UI instance across repeated hide → show cycles', async () => {
    const { options, created } = realOptions();
    const surface = createShadowSurface(options);
    let firstHost: Element | null = null;
    for (let cycle = 0; cycle < 4; cycle += 1) {
      await surface.show(() => true);
      renders[cycle]?.resolve();
      await settle();
      const host = document.querySelector('surface-probe');
      firstHost ??= host;
      // The same host re-appended, its view re-rendered per mount.
      expect(host).toBe(firstHost);
      expect(host?.shadowRoot?.querySelectorAll('.probe-view')).toHaveLength(1);
      surface.hide();
      expect(hosts()).toBe(0);
      expect(renders[cycle]?.disposals).toBe(1);
    }
    expect(created()).toBe(1);
    expect(renders).toHaveLength(4);
  });

  it('a remove during the appearance read aborts that render; the late tree never sticks', async () => {
    const { options } = realOptions();
    const surface = createShadowSurface(options);
    await surface.show(() => true);
    const late = surface.rendered();
    surface.hide();
    // The render saw its removal before it could render (`./mount` skips it).
    expect(renders[0]?.signal?.aborted).toBe(true);
    // Even a render that resolves anyway is disposed at once, never stored.
    renders[0]?.resolve();
    await expect(late).resolves.toBe(false);
    expect(renders[0]?.disposals).toBe(1);
  });

  it('a late render never overwrites the next mount’s disposer (each disposed exactly once)', async () => {
    const { options } = realOptions();
    const surface = createShadowSurface(options);
    await surface.show(() => true);
    surface.hide();
    await surface.show(() => true);
    // The FIRST mount's render resolves after the second mount started.
    renders[0]?.resolve();
    renders[1]?.resolve();
    await settle();
    expect(renders[0]?.disposals).toBe(1);
    expect(renders[1]?.disposals).toBe(0);
    // The late disposal (Solid's: empties the shared container) spared the newer view.
    const shadow = document.querySelector('surface-probe')?.shadowRoot;
    expect(shadow?.querySelectorAll('.probe-view')).toHaveLength(1);
    surface.hide();
    expect(renders[1]?.disposals).toBe(1);
    // A further hide (and WXT's own stray remove) disposes nothing again.
    surface.hide();
    ctx.notifyInvalidated();
    expect(renders[0]?.disposals).toBe(1);
    expect(renders[1]?.disposals).toBe(1);
  });

  it('a remove in the same tick as the render disposes the late tree before the next mount renders', async () => {
    const { options } = realOptions();
    const surface = createShadowSurface(options);
    await surface.show(() => true);
    // Rendered, then removed before the resolution reached the surface.
    renders[0]?.resolve();
    surface.hide();
    await surface.show(() => true);
    await settle();
    expect(renders[0]?.disposals).toBe(1);
    renders[1]?.resolve();
    await settle();
    const shadow = document.querySelector('surface-probe')?.shadowRoot;
    expect(shadow?.querySelectorAll('.probe-view')).toHaveLength(1);
    expect(renders[1]?.disposals).toBe(0);
  });

  it('reports a failed render with its original cause; a removed one stays silent', async () => {
    const onRenderError = vi.fn();
    const { options } = realOptions({ onRenderError });
    const surface = createShadowSurface(options);
    await surface.show(() => true);
    const failure = new Error('render exploded');
    const up = surface.rendered();
    renders[0]?.reject(failure);
    await expect(up).resolves.toBe(false);
    expect(onRenderError).toHaveBeenCalledWith(failure);
    // The host is still removable, and the next show renders afresh.
    surface.hide();
    await surface.show(() => true);
    surface.hide();
    renders[1]?.reject(new Error('after removal'));
    await settle();
    expect(onRenderError).toHaveBeenCalledTimes(1);
  });

  it('a failed render removes its host: the surface reads hidden and the next show retries', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onRenderError = vi.fn();
    const onRemoved = vi.fn();
    const { options, created } = realOptions({ onRenderError, onRemoved });
    const surface = createShadowSurface(options);
    await surface.show(() => true);
    const failure = new Error('render exploded');
    renders[0]?.reject(failure);
    await settle();
    expect(onRenderError).toHaveBeenCalledWith(failure);
    expect(hosts()).toBe(0);
    expect(surface.isShown()).toBe(false);
    expect(onRemoved).toHaveBeenCalledTimes(1);
    expect(renders[0]?.signal?.aborted).toBe(true);
    expect(error).not.toHaveBeenCalled(); // the removal itself did not fail
    // Not 'already-shown': the retry mounts the same instance afresh.
    await expect(surface.show(() => true)).resolves.toBe('shown');
    renders[1]?.resolve();
    await expect(surface.rendered()).resolves.toBe(true);
    expect(created()).toBe(1);
  });

  it('runs every teardown step and removes the host even when one step throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onRemoved = vi.fn();
    const { options } = realOptions({ onRemoved });
    const surface = createShadowSurface(options);
    await surface.show(() => true);
    renders[0]?.resolve();
    await settle();
    // The view's disposer throws (a dead-context unwatch inside it).
    const pending = renders[0];
    if (pending === undefined) throw new Error('no render started');
    pending.failDispose = true;
    expect(() => {
      surface.hide();
    }).not.toThrow();
    expect(pending.disposals).toBe(1);
    expect(onRemoved).toHaveBeenCalledTimes(1);
    expect(hosts()).toBe(0);
    expect(String(error.mock.calls[0]?.[0])).toContain('[WPR FDT]');
  });

  it('a throwing removal hook does not stop the host removal', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { options } = realOptions({
      onRemoved: () => {
        throw new Error('hook exploded');
      }
    });
    const surface = createShadowSurface(options);
    await surface.show(() => true);
    expect(() => {
      surface.hide();
    }).not.toThrow();
    expect(hosts()).toBe(0);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('hands each mount a listener scope aborted at its removal', async () => {
    const signals: AbortSignal[] = [];
    const { options } = realOptions({
      onMounted: (mount) => {
        signals.push(mount.signal);
        expect(mount.shadow.host.isConnected).toBe(true);
      }
    });
    const surface = createShadowSurface(options);
    await surface.show(() => true);
    surface.hide();
    await surface.show(() => true);
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
  });

  it('re-checks after the creation wait: a hide or a dead context wins it', async () => {
    let allowed = true;
    const { options, created } = realOptions();
    const surface = createShadowSurface(options);
    const first = surface.show(() => allowed);
    allowed = false;
    await expect(first).resolves.toBe('refused');
    expect(hosts()).toBe(0);
    // The instance is kept: the next show mounts it without re-creating.
    allowed = true;
    await expect(surface.show(() => allowed)).resolves.toBe('shown');
    expect(created()).toBe(1);
    surface.hide();
    const dying = surface.show(() => true);
    ctx.notifyInvalidated();
    await expect(dying).resolves.toBe('refused');
    expect(hosts()).toBe(0);
  });

  it('concurrent shows share one creation and mount once', async () => {
    const { options, created } = realOptions();
    const surface = createShadowSurface(options);
    const outcomes = await Promise.all([surface.show(() => true), surface.show(() => true)]);
    expect(outcomes.sort()).toEqual(['already-shown', 'shown']);
    expect(created()).toBe(1);
    expect(hosts()).toBe(1);
    expect(renders).toHaveLength(1);
    await expect(surface.show(() => true)).resolves.toBe('already-shown');
  });

  it('dead-context teardown: the invalidation removes the live mount once, later shows refuse', async () => {
    const { options } = realOptions();
    const surface = createShadowSurface(options);
    await surface.show(() => true);
    renders[0]?.resolve();
    await settle();
    ctx.notifyInvalidated();
    expect(hosts()).toBe(0);
    expect(renders[0]?.disposals).toBe(1);
    expect(surface.isShown()).toBe(false);
    await expect(surface.show(() => true)).resolves.toBe('refused');
    await expect(surface.rendered()).resolves.toBe(false);
  });

  it('a failed creation rethrows and the next show retries it', async () => {
    let attempts = 0;
    const { options: base } = realOptions();
    const surface = createShadowSurface({
      ...base,
      create: (hooks) => {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error('stylesheet refused'));
        return base.create(hooks);
      }
    });
    await expect(surface.show(() => true)).rejects.toThrow('stylesheet refused');
    await expect(surface.show(() => true)).resolves.toBe('shown');
    expect(attempts).toBe(2);
  });

  it('a host that cannot be placed rethrows WXT’s anchor failure, nothing shown', async () => {
    const { options } = realOptions();
    const surface = createShadowSurface(options);
    const body = document.body;
    body.remove();
    try {
      await expect(surface.show(() => true)).rejects.toThrow('anchor');
      expect(surface.isShown()).toBe(false);
    } finally {
      document.documentElement.append(body);
    }
  });
});
