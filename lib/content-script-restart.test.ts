/**
 * The restart guard against WXT's real content-script context: the forgery
 * is real without the guard (control), refused with it; a newer same-world
 * start and a dead extension context still end the older instance.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import {
  LIVE_INSTANCES_GLOBAL,
  QUIET_START,
  guardRestartSignal,
  installRestartGuard,
  restartEventName,
  type RestartGuardDeps
} from './content-script-restart';

/** The entrypoint name the contexts below share. */
const NAME = 'isolated';

/** WXT's own event name in this runner (its `ENTRYPOINT` is this bundle's). */
const EVENT = restartEventName(fakeBrowser.runtime.id, import.meta.env.ENTRYPOINT);

/** A fresh isolated-world stand-in per test (no table leaks between tests). */
let world: Record<string, unknown> = {};

/** A silent logger. */
const log = { debug: vi.fn() };

/**
 * Guard a context the way the entrypoints do, over this test's world.
 *
 * @param ctx The context.
 * @param overrides Dependency overrides.
 */
function guard(ctx: ContentScriptContext, overrides: Partial<RestartGuardDeps> = {}): void {
  guardRestartSignal({
    ctx,
    entrypoint: NAME,
    eventName: EVENT,
    target: window,
    world,
    log,
    ...overrides
  });
}

/** Dispatch the start event a page would forge: foreign message id, same name. */
function forge(): void {
  document.dispatchEvent(
    new CustomEvent(EVENT, { detail: { contentScriptName: NAME, messageId: 'forged' } })
  );
}

/** Make `runtime.id` read as gone (an extension reload) until restored. */
function killExtensionContext(): () => void {
  const id = fakeBrowser.runtime.id;
  Object.defineProperty(fakeBrowser.runtime, 'id', { value: undefined, configurable: true });
  return () => {
    Object.defineProperty(fakeBrowser.runtime, 'id', { value: id, configurable: true });
  };
}

/** Contexts created by a test, ended after it (their document listeners go with them). */
const created: ContentScriptContext[] = [];

/** A real WXT context named {@link NAME}. */
function context(): ContentScriptContext {
  const ctx = new ContentScriptContext(NAME);
  created.push(ctx);
  return ctx;
}

afterEach(() => {
  created.splice(0).forEach((ctx) => {
    ctx.abort('test over');
  });
  world = {};
  log.debug.mockReset();
});

describe('restartEventName', () => {
  it('is WXT name shape: id, entrypoint, the started suffix', () => {
    expect(restartEventName('abc', 'ua-relay')).toBe('abc:ua-relay:wxt:content-script-started');
  });
});

describe('QUIET_START', () => {
  it('turns WXT start broadcast off', () => {
    expect(QUIET_START).toEqual({ noScriptStartedPostMessage: true });
  });

  it('really silences the broadcast on a WXT context', () => {
    const post = vi.spyOn(window, 'postMessage');
    created.push(new ContentScriptContext(NAME, QUIET_START));
    expect(post).not.toHaveBeenCalled();
    created.push(new ContentScriptContext(NAME));
    expect(post).toHaveBeenCalledOnce();
    post.mockRestore();
  });
});

describe('guardRestartSignal', () => {
  it('control: without the guard, a forged event ends a live context', () => {
    const ctx = context();
    forge();
    expect(ctx.isValid).toBe(false);
  });

  it('a forged event leaves a guarded live context running', () => {
    const ctx = context();
    guard(ctx);
    forge();
    forge();
    expect(ctx.isValid).toBe(true);
  });

  it('stops the event before any later listener sees it', () => {
    const ctx = context();
    guard(ctx);
    const later = vi.fn();
    window.addEventListener(EVENT, later, { capture: true });
    document.addEventListener(EVENT, later);
    forge();
    expect(later).not.toHaveBeenCalled();
    window.removeEventListener(EVENT, later, { capture: true });
    document.removeEventListener(EVENT, later);
  });

  it('a newer same-world start ends the older instance, not itself', () => {
    const older = context();
    guard(older);
    const newer = context();
    // WXT's own dispatch from the newer constructor was stopped by the older guard.
    expect(older.isValid).toBe(true);
    guard(newer);
    expect(older.isValid).toBe(false);
    expect(newer.isValid).toBe(true);
    expect((world[LIVE_INSTANCES_GLOBAL] as Map<string, unknown>).size).toBe(1);
  });

  it('another entrypoint in the same world is left alone', () => {
    const relay = context();
    guard(relay, { entrypoint: 'ua-relay' });
    guard(context());
    expect(relay.isValid).toBe(true);
  });

  it('an ended instance leaves the table; a replaced one does not remove its successor', () => {
    const older = context();
    guard(older);
    const newer = context();
    guard(newer);
    const table = world[LIVE_INSTANCES_GLOBAL] as Map<string, unknown>;
    expect(table.has(NAME)).toBe(true);
    newer.abort('closed');
    expect(table.has(NAME)).toBe(false);
  });

  it('after the extension context died, the start event reaches WXT and ends the instance', () => {
    const ctx = context();
    guard(ctx);
    const restore = killExtensionContext();
    try {
      forge();
      expect(ctx.signal.aborted).toBe(true);
    } finally {
      restore();
    }
  });

  it('an ended context installs nothing', () => {
    const ctx = context();
    ctx.abort('ended early');
    guard(ctx);
    expect(world[LIVE_INSTANCES_GLOBAL]).toBeUndefined();
  });

  it('an older instance whose end throws is logged and the newer still starts', () => {
    world[LIVE_INSTANCES_GLOBAL] = new Map([
      [
        NAME,
        () => {
          throw new Error('dead world');
        }
      ]
    ]);
    const ctx = context();
    guard(ctx);
    expect(ctx.isValid).toBe(true);
    expect(log.debug).toHaveBeenCalledOnce();
  });

  it('a forged event fired while the older instance ends cannot end the newer one', () => {
    // An older teardown can run page listeners synchronously (e.g. focus
    // events of a removed host); the newer filter must already be in place.
    world[LIVE_INSTANCES_GLOBAL] = new Map([[NAME, forge]]);
    const ctx = context();
    guard(ctx);
    expect(ctx.isValid).toBe(true);
  });

  it('a foreign value at the table key is replaced, never called', () => {
    world[LIVE_INSTANCES_GLOBAL] = { [NAME]: vi.fn() };
    const ctx = context();
    guard(ctx);
    expect(world[LIVE_INSTANCES_GLOBAL]).toBeInstanceOf(Map);
    expect(ctx.isValid).toBe(true);
  });
});

describe('installRestartGuard', () => {
  it('guards the running script by its bundle name and extension id', () => {
    const ctx = context();
    installRestartGuard(ctx, log);
    forge();
    expect(ctx.isValid).toBe(true);
    const table = (globalThis as unknown as Record<string, unknown>)[LIVE_INSTANCES_GLOBAL];
    expect(table).toBeInstanceOf(Map);
    ctx.abort('done');
    expect((table as Map<string, unknown>).size).toBe(0);
  });
});
