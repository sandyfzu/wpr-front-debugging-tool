/**
 * The palette chord on the page (the shared keydown decision is pinned in
 * `lib/palette-chord/keydown.test.ts`): the platform reply's narrowing, and the trigger
 * over fake seams — watch-first binding resolution, live rebinding, degraded
 * reads, the bounded platform ask and its navigator stand-in, arm / disarm /
 * invalidation of the window listener, the hint, and page safety (a failing
 * handler never throws into the page; an orphaned context never consumes).
 */
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ChordKeydownFacts } from '../../../lib/palette-chord/keydown';
import type { PaletteChord } from '../../../lib/storage/palette-chord';
import {
  narrowChordPlatform,
  PLATFORM_ASK_TIMEOUT_MS,
  startChordTrigger,
  type ChordTriggerDeps
} from './chord';

afterEach(() => {
  document.body.innerHTML = '';
  document.designMode = 'off';
});

const ALT_K: PaletteChord = { code: 'KeyK', alt: true };
const MOD_K: PaletteChord = { code: 'KeyK', mod: true };

/** A trusted, unhandled keydown with no modifiers, overridden per case. */
function keydown(overrides: Partial<ChordKeydownFacts> = {}): ChordKeydownFacts {
  return {
    isTrusted: true,
    defaultPrevented: false,
    code: 'KeyK',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides
  };
}

describe('narrowChordPlatform', () => {
  it.each<[unknown, string]>([
    ['mac', 'mac'],
    ['other', 'other'],
    ['win', 'other'],
    ['MAC', 'other'],
    [undefined, 'other'],
    [{ os: 'mac' }, 'other']
  ])('%j → %s', (reply, expected) => {
    expect(narrowChordPlatform(reply)).toBe(expected);
  });
});

/** A deferred promise settled by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Wait for queued promise callbacks. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

/** A keydown the listener receives, with its consumption recorders. */
function pageKeydown(overrides: Partial<ChordKeydownFacts> = {}, path: EventTarget[] = []) {
  const preventDefault = vi.fn();
  const stopImmediatePropagation = vi.fn();
  const event = {
    ...keydown(overrides),
    composedPath: () => path,
    preventDefault,
    stopImmediatePropagation
  } as unknown as Event;
  return { event, preventDefault, stopImmediatePropagation };
}

/** The trigger over fake seams plus their controls. */
function harness(options: { platform?: Promise<unknown>; fallback?: 'mac' | 'other' } = {}) {
  const listeners = new Set<(event: Event) => void>();
  const add: Mock<(type: string, listener: unknown, capture: unknown) => void> = vi.fn(
    (_type, listener) => {
      listeners.add(listener as (event: Event) => void);
    }
  );
  const remove: Mock<(type: string, listener: unknown, capture: unknown) => void> = vi.fn(
    (_type, listener) => {
      listeners.delete(listener as (event: Event) => void);
    }
  );
  const read = deferred<PaletteChord>();
  const platform = deferred<unknown>();
  let watcher: ((chord: PaletteChord) => void) | null = null;
  const unwatch = vi.fn();
  const invalidation: Array<() => void> = [];
  const warn = vi.fn();
  const readChord = vi.fn(() => read.promise);
  const askPlatform = vi.fn(() => options.platform ?? platform.promise);
  const context = { live: true };
  const fallbackPlatform = vi.fn(() => options.fallback ?? 'other');
  /** Pending deadline timers (fired by the test). */
  const timers: Array<{ run: () => void; ms: number; cancelled: boolean }> = [];
  const schedule = vi.fn((run: () => void, ms: number) => {
    const timer = { run, ms, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  });
  const deps: ChordTriggerDeps = {
    target: {
      addEventListener: add,
      removeEventListener: remove
    },
    isLive: () => context.live,
    readChord,
    watchChord: vi.fn((onChange: (chord: PaletteChord) => void) => {
      watcher = onChange;
      return unwatch;
    }),
    askPlatform,
    fallbackPlatform,
    schedule,
    onInvalidated: (cleanup) => {
      invalidation.push(cleanup);
    },
    log: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }
  };
  const trigger = startChordTrigger(deps);
  return {
    deps,
    trigger,
    readChord,
    askPlatform,
    add,
    remove,
    read,
    platform,
    unwatch,
    warn,
    context,
    fallbackPlatform,
    schedule,
    /** How many deadlines are still pending (armed, not cancelled). */
    pendingTimers: () => timers.filter((timer) => !timer.cancelled).length,
    /** Fire every pending, uncancelled deadline. */
    expire: () => {
      for (const timer of timers) if (!timer.cancelled) timer.run();
    },
    listening: () => listeners.size,
    /** Deliver one keydown to every registered listener. */
    press: (overrides: Partial<ChordKeydownFacts> = {}, path: EventTarget[] = []) => {
      const key = pageKeydown(overrides, path);
      for (const listener of listeners) listener(key.event);
      return key;
    },
    write: (chord: PaletteChord) => watcher?.(chord),
    invalidate: () => {
      for (const cleanup of invalidation) cleanup();
    }
  };
}

/** A harness armed and resolved to `chord` on `platform`. */
async function resolved(chord: PaletteChord = ALT_K, platform: unknown = 'mac') {
  const h = harness();
  const onChord = vi.fn();
  const disarm = h.trigger.arm(onChord);
  h.read.resolve(chord);
  h.platform.resolve(platform);
  await settle();
  return { ...h, onChord, disarm };
}

describe('startChordTrigger', () => {
  it('is inert until armed: no listener, no read, no platform ask', () => {
    const h = harness();
    expect(h.listening()).toBe(0);
    expect(h.readChord).not.toHaveBeenCalled();
    expect(h.askPlatform).not.toHaveBeenCalled();
    expect(h.trigger.hint()).toBeNull();
  });

  it('arms one window-capture keydown listener and ignores keys until the binding resolves', async () => {
    const h = harness();
    const onChord = vi.fn();
    h.trigger.arm(onChord);
    expect(h.add).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(h.listening()).toBe(1);
    const early = h.press({ altKey: true });
    expect(early.preventDefault).not.toHaveBeenCalled();
    h.read.resolve(ALT_K);
    await settle();
    // Half resolved (no platform yet): still nothing.
    h.press({ altKey: true });
    expect(onChord).not.toHaveBeenCalled();
    h.platform.resolve('mac');
    await settle();
    const key = h.press({ altKey: true });
    expect(onChord).toHaveBeenCalledOnce();
    expect(key.preventDefault).toHaveBeenCalledOnce();
    expect(key.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it('leaves every other keystroke untouched', async () => {
    const h = await resolved();
    for (const overrides of [
      {},
      { code: 'KeyJ', altKey: true },
      { altKey: true, shiftKey: true }
    ]) {
      const key = h.press(overrides);
      expect(key.preventDefault).not.toHaveBeenCalled();
      expect(key.stopImmediatePropagation).not.toHaveBeenCalled();
    }
    expect(h.onChord).not.toHaveBeenCalled();
  });

  it('lets a may-type chord type in an editable target', async () => {
    const h = await resolved();
    const field = document.createElement('textarea');
    const key = h.press({ altKey: true }, [field]);
    expect(key.preventDefault).not.toHaveBeenCalled();
    expect(h.onChord).not.toHaveBeenCalled();
  });

  it('lets a watch delivery during the read win over the read result', async () => {
    const h = harness();
    h.trigger.arm(vi.fn());
    h.write(MOD_K);
    h.read.resolve(ALT_K);
    h.platform.resolve('mac');
    await settle();
    expect(h.trigger.binding()).toEqual({ chord: MOD_K, platform: 'mac' });
  });

  it('re-arms live on a rebinding: the old chord passes, the new one fires', async () => {
    const h = await resolved();
    h.write(MOD_K);
    expect(h.press({ altKey: true }).preventDefault).not.toHaveBeenCalled();
    expect(h.press({ metaKey: true }).preventDefault).toHaveBeenCalledOnce();
    expect(h.onChord).toHaveBeenCalledOnce();
    expect(h.trigger.hint()).toBe('⌘K');
  });

  it('formats the hint in the platform’s notation', async () => {
    expect((await resolved(ALT_K, 'mac')).trigger.hint()).toBe('⌥K');
    expect((await resolved(ALT_K, 'win')).trigger.hint()).toBe('Alt+K');
  });

  it('degrades a failed read to the default chord and an unanswered ask to the navigator’s convention', async () => {
    const h = harness({ fallback: 'mac' });
    h.trigger.arm(vi.fn());
    h.read.reject(new Error('Extension context invalidated.'));
    h.platform.reject(new Error('Could not establish connection. Receiving end does not exist.'));
    await settle();
    expect(h.trigger.binding()).toEqual({ chord: { code: 'KeyK', alt: true }, platform: 'mac' });
    expect(h.warn).toHaveBeenCalledWith(
      'Palette chord unread — using the default',
      new Error('Extension context invalidated.')
    );
    expect(h.warn).toHaveBeenCalledWith(
      "Keyboard convention unanswered — using the navigator's (mac)",
      'no-receiver'
    );
    // A ⌘ chord on macOS stays alive (a fixed Ctrl guess would kill it).
    h.write(MOD_K);
    expect(h.trigger.hint()).toBe('⌘K');
  });

  it('a real ask failure falls back too, logging its cause', async () => {
    const h = harness({ fallback: 'other' });
    h.trigger.arm(vi.fn());
    h.read.resolve(ALT_K);
    h.platform.reject(new Error('boom'));
    await settle();
    expect(h.trigger.binding()).toEqual({ chord: ALT_K, platform: 'other' });
    expect(h.warn).toHaveBeenCalledWith(
      "Keyboard convention unanswered — using the navigator's (other)",
      new Error('boom')
    );
  });

  it('bounds the platform ask: past the deadline the navigator’s convention stands, a late answer is dropped', async () => {
    const h = harness({ fallback: 'mac' });
    const onChord = vi.fn();
    h.trigger.arm(onChord);
    h.read.resolve(ALT_K);
    await settle();
    expect(h.schedule).toHaveBeenCalledWith(expect.any(Function), PLATFORM_ASK_TIMEOUT_MS);
    expect(h.trigger.binding()).toBeNull();
    h.expire();
    await settle();
    expect(h.trigger.binding()).toEqual({ chord: ALT_K, platform: 'mac' });
    expect(h.warn).toHaveBeenCalledWith(
      "Keyboard convention unanswered — using the navigator's (mac)",
      'timeout'
    );
    h.platform.resolve('other');
    await settle();
    expect(h.trigger.binding()).toEqual({ chord: ALT_K, platform: 'mac' });
    h.press({ altKey: true });
    expect(onChord).toHaveBeenCalledOnce();
  });

  it('an answered ask wins over the navigator and clears its deadline', async () => {
    const h = await resolved(ALT_K, 'other');
    expect(h.fallbackPlatform).not.toHaveBeenCalled();
    expect(h.schedule).toHaveBeenCalledOnce();
    expect(h.pendingTimers()).toBe(0);
    h.expire();
    await settle();
    expect(h.trigger.binding()).toEqual({ chord: ALT_K, platform: 'other' });
  });

  it('a throwing stand-in degrades to the Ctrl convention, never into the page', async () => {
    const h = harness();
    h.deps.fallbackPlatform = () => {
      throw new Error('no navigator');
    };
    h.trigger.arm(vi.fn());
    h.read.resolve(ALT_K);
    h.platform.reject(new Error('boom'));
    await settle();
    expect(h.trigger.binding()).toEqual({ chord: ALT_K, platform: 'other' });
    expect(h.warn).toHaveBeenCalledWith(
      'Keyboard convention unresolved — using the Ctrl convention',
      new Error('no navigator')
    );
  });

  it('an orphaned context lets the chord through and removes the listener', async () => {
    const h = await resolved();
    h.context.live = false;
    // A non-matching key never even reads the context.
    expect(h.press({ code: 'KeyJ', altKey: true }).preventDefault).not.toHaveBeenCalled();
    expect(h.listening()).toBe(1);
    const key = h.press({ altKey: true });
    expect(key.preventDefault).not.toHaveBeenCalled();
    expect(key.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(h.onChord).not.toHaveBeenCalled();
    expect(h.listening()).toBe(0);
  });

  it('a synchronously throwing seam degrades the same way', async () => {
    // A navigator answer other than the Ctrl default proves the stand-in is consulted.
    const h = harness({ fallback: 'mac' });
    h.deps.askPlatform = () => {
      throw new Error('no runtime');
    };
    h.deps.watchChord = () => {
      throw new Error('no storage');
    };
    h.trigger.arm(vi.fn());
    h.read.resolve(MOD_K);
    await settle();
    expect(h.trigger.binding()).toEqual({ chord: MOD_K, platform: 'mac' });
    expect(h.fallbackPlatform).toHaveBeenCalledOnce();
    expect(h.warn).toHaveBeenCalledWith(
      "Keyboard convention unanswered — using the navigator's (mac)",
      new Error('no runtime')
    );
    expect(h.warn).toHaveBeenCalledWith(
      'Palette chord unwatched — a rebinding applies after a reload',
      new Error('no storage')
    );
  });

  it('disarm removes the listener; a re-arm adds it back without resolving again', async () => {
    const h = await resolved();
    h.disarm();
    expect(h.remove).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(h.listening()).toBe(0);
    h.disarm();
    expect(h.remove).toHaveBeenCalledOnce();
    const onChord = vi.fn();
    h.trigger.arm(onChord);
    expect(h.listening()).toBe(1);
    h.press({ altKey: true });
    expect(onChord).toHaveBeenCalledOnce();
    expect(h.readChord).toHaveBeenCalledOnce();
    expect(h.askPlatform).toHaveBeenCalledOnce();
  });

  it('a second arm keeps one listener, and a stale disarm leaves the newer arm alone', async () => {
    const h = await resolved();
    const newer = vi.fn();
    h.trigger.arm(newer);
    expect(h.add).toHaveBeenCalledOnce();
    h.disarm();
    expect(h.listening()).toBe(1);
    h.press({ altKey: true });
    expect(newer).toHaveBeenCalledOnce();
    expect(h.onChord).not.toHaveBeenCalled();
  });

  it('invalidation removes the listener and the watch; a later arm does nothing', async () => {
    const h = await resolved();
    h.invalidate();
    expect(h.listening()).toBe(0);
    expect(h.unwatch).toHaveBeenCalledOnce();
    h.trigger.arm(vi.fn());
    expect(h.listening()).toBe(0);
  });

  it('a throwing open is logged, never thrown into the page', async () => {
    const h = harness();
    h.trigger.arm(() => {
      throw new Error('boom');
    });
    h.read.resolve(ALT_K);
    h.platform.resolve('mac');
    await settle();
    expect(() => h.press({ altKey: true })).not.toThrow();
    expect(h.warn).toHaveBeenCalledWith(
      'Handling a keystroke for the palette chord failed',
      new Error('boom')
    );
  });
});
