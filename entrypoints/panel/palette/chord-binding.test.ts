/**
 * The panel's chosen-chord binding: null until both the chord and the
 * convention resolve, live on rebinding, the platform report's failure
 * falling back to the navigator's convention, a failed read to the default
 * chord, and stop dropping late answers and unwatching once.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PALETTE_CHORD, type PaletteChord } from '../../../lib/storage/palette-chord';
import { createPanelChordBinding, type PanelChordDeps } from './chord-binding';

const ALT_P: PaletteChord = { code: 'KeyP', alt: true };
const MOD_ALT_O: PaletteChord = { code: 'KeyO', mod: true, alt: true };

/** Wait for queued promise callbacks. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

/** Seams over a hand-settled read and platform report. */
function harness(
  options: { read?: Promise<PaletteChord>; os?: Promise<{ os: string }>; fallback?: 'mac' } = {}
) {
  let watcher: ((chord: PaletteChord) => void) | null = null;
  const unwatch = vi.fn();
  const fallbackPlatform = vi.fn(() => options.fallback ?? 'other');
  const deps: PanelChordDeps = {
    readChord: vi.fn(() => options.read ?? Promise.resolve(ALT_P)),
    watchChord: vi.fn((onChange: (chord: PaletteChord) => void) => {
      watcher = onChange;
      return unwatch;
    }),
    getPlatformInfo: vi.fn(() => options.os ?? Promise.resolve({ os: 'mac' })),
    fallbackPlatform,
    log: { warn: vi.fn() }
  };
  return { deps, unwatch, fallbackPlatform, write: (chord: PaletteChord) => watcher?.(chord) };
}

describe('createPanelChordBinding', () => {
  it('stays null until both halves resolve, then names the stored chord', async () => {
    let answer!: (info: { os: string }) => void;
    const h = harness({ os: new Promise((resolve) => (answer = resolve)) });
    const chord = createPanelChordBinding(h.deps);
    await settle();
    expect(chord.binding()).toBeNull();
    answer({ os: 'win' });
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

  it('a failed platform report falls back to the navigator’s convention', async () => {
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
    let answer!: (info: { os: string }) => void;
    const h = harness({ os: new Promise((resolve) => (answer = resolve)) });
    const chord = createPanelChordBinding(h.deps);
    await settle();
    chord.stop();
    chord.stop();
    expect(h.unwatch).toHaveBeenCalledOnce();
    answer({ os: 'mac' });
    h.write(MOD_ALT_O);
    await settle();
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
