/**
 * The panel's chosen-chord binding: null until both the chord and the
 * convention resolve, live on rebinding, the convention asked of the
 * background (never `runtime.getPlatformInfo`, which Firefox's DevTools pages
 * lack), an unanswered ask falling back to the navigator's convention, a
 * failed read to the default chord, and stop dropping late answers,
 * clearing the ask's deadline and unwatching once.
 */
import { describe, expect, it, vi } from 'vitest';
import { PLATFORM_ASK_TIMEOUT_MS } from '../../../lib/palette-chord/platform-ask';
import { DEFAULT_PALETTE_CHORD, type PaletteChord } from '../../../lib/storage/palette-chord';
import type { TimerFunctions } from '../../../utils/context-timers';
import { createPanelChordBinding, realPanelChordDeps, type PanelChordDeps } from './chord-binding';

const { sendMessage } = vi.hoisted(() => ({
  sendMessage: vi.fn((row: string): Promise<unknown> =>
    Promise.resolve(row === 'getChordPlatform' ? 'mac' : undefined)
  )
}));
vi.mock('../../../lib/messaging', () => ({ sendMessage }));

const ALT_P: PaletteChord = { code: 'KeyP', alt: true };
const MOD_ALT_O: PaletteChord = { code: 'KeyO', mod: true, alt: true };

/** Wait for queued promise callbacks. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

/** Seams over a hand-settled read and platform answer (the deadline timer never fires). */
function harness(
  options: { read?: Promise<PaletteChord>; os?: Promise<unknown>; fallback?: 'mac' } = {}
) {
  let watcher: ((chord: PaletteChord) => void) | null = null;
  const unwatch = vi.fn();
  const fallbackPlatform = vi.fn(() => options.fallback ?? 'other');
  const timers = {
    setTimeout: vi.fn<TimerFunctions['setTimeout']>(() => 7),
    clearTimeout: vi.fn<TimerFunctions['clearTimeout']>()
  };
  const deps: PanelChordDeps = {
    readChord: vi.fn(() => options.read ?? Promise.resolve(ALT_P)),
    watchChord: vi.fn((onChange: (chord: PaletteChord) => void) => {
      watcher = onChange;
      return unwatch;
    }),
    askPlatform: vi.fn(() => options.os ?? Promise.resolve('mac')),
    fallbackPlatform,
    timers,
    log: { warn: vi.fn() }
  };
  return {
    deps,
    unwatch,
    fallbackPlatform,
    timers,
    write: (chord: PaletteChord) => watcher?.(chord)
  };
}

describe('createPanelChordBinding', () => {
  it('stays null until both halves resolve, then names the stored chord', async () => {
    let answer!: (reply: unknown) => void;
    const h = harness({ os: new Promise((resolve) => (answer = resolve)) });
    const chord = createPanelChordBinding(h.deps);
    await settle();
    expect(chord.binding()).toBeNull();
    answer('other');
    await settle();
    expect(chord.binding()).toEqual({ chord: ALT_P, platform: 'other' });
    chord.stop();
  });

  it('follows a rebinding live (no reload)', async () => {
    const h = harness();
    const chord = createPanelChordBinding(h.deps);
    await settle();
    h.write(MOD_ALT_O);
    expect(chord.binding()).toEqual({ chord: MOD_ALT_O, platform: 'mac' });
    chord.stop();
  });

  it('an unanswered platform ask falls back to the navigator’s convention', async () => {
    const h = harness({ os: Promise.reject(new Error('gone')), fallback: 'mac' });
    const chord = createPanelChordBinding(h.deps);
    await settle();
    expect(chord.binding()?.platform).toBe('mac');
    expect(h.fallbackPlatform).toHaveBeenCalledOnce();
    chord.stop();
  });

  it('a failed read binds the default chord', async () => {
    const h = harness({ read: Promise.reject(new Error('dead')) });
    const chord = createPanelChordBinding(h.deps);
    await settle();
    expect(chord.binding()?.chord).toEqual(DEFAULT_PALETTE_CHORD);
    chord.stop();
  });

  it('stop unwatches once and drops late answers', async () => {
    let answer!: (reply: unknown) => void;
    const h = harness({ os: new Promise((resolve) => (answer = resolve)) });
    const chord = createPanelChordBinding(h.deps);
    await settle();
    chord.stop();
    chord.stop();
    expect(h.unwatch).toHaveBeenCalledOnce();
    answer('mac');
    h.write(MOD_ALT_O);
    await settle();
    expect(chord.binding()).toBeNull();
  });

  it('stop clears a still armed ask deadline, once', async () => {
    const h = harness({ os: new Promise<unknown>(() => undefined) });
    const chord = createPanelChordBinding(h.deps);
    await settle();
    expect(h.timers.setTimeout).toHaveBeenCalledWith(expect.any(Function), PLATFORM_ASK_TIMEOUT_MS);
    expect(h.timers.clearTimeout).not.toHaveBeenCalled();
    chord.stop();
    chord.stop();
    expect(h.timers.clearTimeout).toHaveBeenCalledOnce();
    expect(h.timers.clearTimeout).toHaveBeenCalledWith(7);
  });

  it('an answered ask clears its deadline before stop', async () => {
    const h = harness();
    const chord = createPanelChordBinding(h.deps);
    await settle();
    expect(h.timers.clearTimeout).toHaveBeenCalledOnce();
    chord.stop();
    expect(h.timers.clearTimeout).toHaveBeenCalledOnce();
  });

  it('a deadline firing after stop changes nothing', async () => {
    const h = harness({ os: new Promise<unknown>(() => undefined) });
    const chord = createPanelChordBinding(h.deps);
    await settle();
    const fire = h.timers.setTimeout.mock.calls[0]?.[0];
    expect(fire).toBeTypeOf('function');
    chord.stop();
    fire?.();
    await settle();
    expect(h.fallbackPlatform).not.toHaveBeenCalled();
    expect(chord.binding()).toBeNull();
  });

  it('a throwing unwatch is logged, never thrown', async () => {
    const h = harness();
    h.unwatch.mockImplementation(() => {
      throw new Error('gone');
    });
    const chord = createPanelChordBinding(h.deps);
    await settle();
    expect(() => {
      chord.stop();
    }).not.toThrow();
    expect(h.deps.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unwatching'),
      expect.any(Error)
    );
  });
});

describe('realPanelChordDeps', () => {
  it('asks the background for the convention, never runtime.getPlatformInfo', async () => {
    // Firefox's DevTools pages have no `runtime.getPlatformInfo`: calling it
    // there threw and logged a degrade warning on every panel open.
    const runtime = browser.runtime as { getPlatformInfo?: unknown };
    const original = runtime.getPlatformInfo;
    runtime.getPlatformInfo = undefined;
    try {
      const warn = vi.fn();
      const deps = realPanelChordDeps({ warn });
      await expect(deps.askPlatform()).resolves.toBe('mac');
      expect(sendMessage).toHaveBeenCalledWith('getChordPlatform');
      const chord = createPanelChordBinding({
        ...deps,
        readChord: () => Promise.resolve(ALT_P),
        watchChord: () => () => undefined
      });
      await settle();
      expect(chord.binding()).toEqual({ chord: ALT_P, platform: 'mac' });
      expect(warn).not.toHaveBeenCalled();
      chord.stop();
    } finally {
      runtime.getPlatformInfo = original;
    }
  });
});
