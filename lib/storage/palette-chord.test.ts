/**
 * The palette chord contract: validation (no-typing-theft rule, bindable
 * keys, wrong-typed flags, canonical form), capture from keystrokes, exact
 * per-platform matching (repeat/IME refused), notation, platform detection,
 * and the storage item's default-tolerant reads, guarded writes and
 * validated watch.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHORD_KEY_LABELS,
  DEFAULT_PALETTE_CHORD,
  PALETTE_CHORD_KEY,
  captureChord,
  detectChordPlatform,
  formatChord,
  matchesChord,
  paletteChordStore,
  parsePaletteChord,
  readPaletteChord,
  setPaletteChord,
  watchPaletteChord,
  type ChordKeystroke,
  type PaletteChord
} from './palette-chord';

/** The bare key under the sync area. */
const SYNC_KEY = PALETTE_CHORD_KEY.replace(/^sync:/, '');

/** A keystroke with every modifier released unless overridden. */
function key(code: string, held: Partial<ChordKeystroke> = {}): ChordKeystroke {
  return { code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...held };
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe('the bindable key table', () => {
  it('covers letters, digits, F1–F12 and US punctuation, and nothing that navigates', () => {
    expect(CHORD_KEY_LABELS.KeyA).toBe('A');
    expect(CHORD_KEY_LABELS.KeyZ).toBe('Z');
    expect(CHORD_KEY_LABELS.Digit0).toBe('0');
    expect(CHORD_KEY_LABELS.F12).toBe('F12');
    expect(CHORD_KEY_LABELS.Slash).toBe('/');
    expect(Object.keys(CHORD_KEY_LABELS)).toHaveLength(26 + 10 + 12 + 11);
    for (const excluded of ['Escape', 'Tab', 'Enter', 'Space', 'ArrowUp', 'F13', 'AltLeft']) {
      expect(Object.hasOwn(CHORD_KEY_LABELS, excluded)).toBe(false);
    }
  });
});

describe('parsePaletteChord', () => {
  it('accepts the default and keeps it canonical', () => {
    expect(DEFAULT_PALETTE_CHORD).toEqual({ code: 'KeyK', alt: true });
    expect(parsePaletteChord(DEFAULT_PALETTE_CHORD)).toEqual({ code: 'KeyK', alt: true });
  });

  it('drops false flags and ignores unknown fields (canonical, additive-tolerant)', () => {
    expect(
      parsePaletteChord({ code: 'KeyP', mod: true, alt: false, shift: true, future: 1 })
    ).toEqual({ code: 'KeyP', mod: true, shift: true });
  });

  it('allows a function key alone', () => {
    expect(parsePaletteChord({ code: 'F2' })).toEqual({ code: 'F2' });
    expect(parsePaletteChord({ code: 'F12', shift: false })).toEqual({ code: 'F12' });
  });

  it('refuses a bare key or Shift alone (they would steal typing)', () => {
    expect(parsePaletteChord({ code: 'KeyK' })).toBeNull();
    expect(parsePaletteChord({ code: 'KeyK', shift: true })).toBeNull();
    expect(parsePaletteChord({ code: 'Digit1', mod: false, alt: false })).toBeNull();
  });

  it('refuses unknown keys, wrong-typed flags and non-records', () => {
    for (const rejected of [
      null,
      'alt+k',
      42,
      [],
      {},
      { code: 'Escape', mod: true },
      { code: 'keyk', alt: true },
      { code: 7, alt: true },
      { code: 'KeyK', alt: 'yes' },
      { code: 'KeyK', mod: 1 },
      { code: 'toString', alt: true }
    ]) {
      expect(parsePaletteChord(rejected)).toBeNull();
    }
  });

  it('never reads inherited fields', () => {
    const inherited = Object.create({ code: 'KeyK', alt: true }) as unknown;
    expect(parsePaletteChord(inherited)).toBeNull();
  });
});

describe('matchesChord', () => {
  const altK: PaletteChord = { code: 'KeyK', alt: true };
  const modShiftP: PaletteChord = { code: 'KeyP', mod: true, shift: true };

  it('matches the exact physical key and modifiers', () => {
    expect(matchesChord(key('KeyK', { altKey: true }), altK, 'mac')).toBe(true);
    expect(matchesChord(key('KeyK', { altKey: true }), altK, 'other')).toBe(true);
  });

  it('refuses extra or missing modifiers', () => {
    expect(matchesChord(key('KeyK'), altK, 'other')).toBe(false);
    expect(matchesChord(key('KeyK', { altKey: true, shiftKey: true }), altK, 'other')).toBe(false);
    expect(matchesChord(key('KeyK', { altKey: true, ctrlKey: true }), altK, 'other')).toBe(false);
    expect(matchesChord(key('KeyK', { altKey: true, metaKey: true }), altK, 'mac')).toBe(false);
    expect(matchesChord(key('KeyJ', { altKey: true }), altK, 'other')).toBe(false);
  });

  it('maps mod to Command on macOS and Ctrl elsewhere, refusing the other one', () => {
    const macPress = key('KeyP', { metaKey: true, shiftKey: true });
    const otherPress = key('KeyP', { ctrlKey: true, shiftKey: true });
    expect(matchesChord(macPress, modShiftP, 'mac')).toBe(true);
    expect(matchesChord(otherPress, modShiftP, 'mac')).toBe(false);
    expect(matchesChord(otherPress, modShiftP, 'other')).toBe(true);
    expect(matchesChord(macPress, modShiftP, 'other')).toBe(false);
    // Both held is neither platform's chord.
    const both = key('KeyP', { metaKey: true, ctrlKey: true, shiftKey: true });
    expect(matchesChord(both, modShiftP, 'mac')).toBe(false);
    expect(matchesChord(both, modShiftP, 'other')).toBe(false);
  });

  it('refuses auto-repeats and IME compositions', () => {
    expect(matchesChord(key('KeyK', { altKey: true, repeat: true }), altK, 'other')).toBe(false);
    expect(matchesChord(key('KeyK', { altKey: true, isComposing: true }), altK, 'mac')).toBe(false);
  });

  it('matches a lone function key only with no modifier held', () => {
    const f2: PaletteChord = { code: 'F2' };
    expect(matchesChord(key('F2'), f2, 'other')).toBe(true);
    expect(matchesChord(key('F2', { shiftKey: true }), f2, 'other')).toBe(false);
  });
});

describe('captureChord', () => {
  it('captures a valid press canonically per platform', () => {
    expect(captureChord(key('KeyK', { altKey: true }), 'mac')).toEqual({
      ok: true,
      chord: { code: 'KeyK', alt: true }
    });
    expect(captureChord(key('KeyP', { metaKey: true, shiftKey: true }), 'mac')).toEqual({
      ok: true,
      chord: { code: 'KeyP', mod: true, shift: true }
    });
    expect(captureChord(key('KeyP', { ctrlKey: true }), 'other')).toEqual({
      ok: true,
      chord: { code: 'KeyP', mod: true }
    });
    expect(captureChord(key('F4'), 'other')).toEqual({ ok: true, chord: { code: 'F4' } });
  });

  it('names why a press cannot bind', () => {
    expect(captureChord(key('AltLeft', { altKey: true }), 'other')).toEqual({
      ok: false,
      reason: 'unsupported-key'
    });
    expect(captureChord(key('Escape', { ctrlKey: true }), 'other')).toEqual({
      ok: false,
      reason: 'unsupported-key'
    });
    expect(captureChord(key('KeyK', { shiftKey: true }), 'mac')).toEqual({
      ok: false,
      reason: 'needs-modifier'
    });
    expect(captureChord(key('KeyK', { ctrlKey: true }), 'mac')).toEqual({
      ok: false,
      reason: 'unsupported-modifier'
    });
    expect(captureChord(key('KeyK', { metaKey: true, altKey: true }), 'other')).toEqual({
      ok: false,
      reason: 'unsupported-modifier'
    });
  });

  it('round-trips: a captured chord parses and matches the press that made it', () => {
    const press = key('Digit3', { altKey: true, shiftKey: true });
    const result = captureChord(press, 'other');
    if (!result.ok) throw new Error('expected a chord');
    expect(parsePaletteChord(result.chord)).toEqual(result.chord);
    expect(matchesChord(press, result.chord, 'other')).toBe(true);
  });
});

describe('formatChord', () => {
  const all: PaletteChord = { code: 'KeyK', mod: true, alt: true, shift: true };

  it('writes macOS glyphs in Apple order, or spelled words', () => {
    expect(formatChord(DEFAULT_PALETTE_CHORD, 'mac')).toBe('⌥K');
    expect(formatChord(all, 'mac')).toBe('⌥⇧⌘K');
    expect(formatChord(all, 'mac', 'words')).toBe('Option+Shift+Command+K');
    expect(formatChord({ code: 'F2' }, 'mac', 'words')).toBe('F2');
  });

  it('writes Ctrl/Alt/Shift elsewhere, whatever the notation', () => {
    expect(formatChord(DEFAULT_PALETTE_CHORD, 'other')).toBe('Alt+K');
    expect(formatChord(all, 'other')).toBe('Ctrl+Alt+Shift+K');
    expect(formatChord(all, 'other', 'words')).toBe('Ctrl+Alt+Shift+K');
    expect(formatChord({ code: 'Slash', mod: true }, 'other')).toBe('Ctrl+/');
  });
});

describe('detectChordPlatform', () => {
  it('prefers client hints, falls back to the platform string', () => {
    expect(detectChordPlatform({ userAgentData: { platform: 'macOS' } })).toBe('mac');
    expect(detectChordPlatform({ userAgentData: { platform: 'Windows' } })).toBe('other');
    expect(detectChordPlatform({ userAgentData: { platform: '' }, platform: 'MacIntel' })).toBe(
      'mac'
    );
    expect(detectChordPlatform({ platform: 'Linux x86_64' })).toBe('other');
    expect(detectChordPlatform({ platform: 'iPad' })).toBe('mac');
    expect(detectChordPlatform({})).toBe('other');
  });
});

describe('the chord store', () => {
  it('reads the default on a fresh install, a removed key, and corrupt values', async () => {
    expect(await readPaletteChord()).toEqual(DEFAULT_PALETTE_CHORD);
    for (const corrupt of ['alt+k', { code: 'KeyK' }, { code: 'KeyK', alt: 'yes' }, null]) {
      await fakeBrowser.storage.sync.set({ [SYNC_KEY]: corrupt });
      expect(await readPaletteChord()).toEqual(DEFAULT_PALETTE_CHORD);
    }
    await setPaletteChord({ code: 'KeyJ', mod: true });
    await paletteChordStore.removeValue();
    expect(await readPaletteChord()).toEqual(DEFAULT_PALETTE_CHORD);
  });

  it('stores the canonical form and reads it back', async () => {
    await setPaletteChord({ code: 'KeyJ', mod: true, alt: false });
    expect(await fakeBrowser.storage.sync.get(SYNC_KEY)).toEqual({
      [SYNC_KEY]: { code: 'KeyJ', mod: true }
    });
    expect(await readPaletteChord()).toEqual({ code: 'KeyJ', mod: true });
  });

  it('refuses to write an invalid chord, leaving the stored one untouched', async () => {
    await setPaletteChord({ code: 'KeyJ', mod: true });
    await expect(setPaletteChord({ code: 'KeyK' })).rejects.toThrow(
      'Refused an invalid palette chord: {"code":"KeyK"}'
    );
    expect(await readPaletteChord()).toEqual({ code: 'KeyJ', mod: true });
  });

  it('watches validated writes (corrupt and removed as the default) until unsubscribed', async () => {
    const onChange = vi.fn<(chord: PaletteChord) => void>();
    const unwatch = watchPaletteChord(onChange);
    await setPaletteChord({ code: 'KeyJ', mod: true });
    await fakeBrowser.storage.sync.set({ [SYNC_KEY]: { code: 'KeyJ' } });
    await setPaletteChord({ code: 'F2' });
    await paletteChordStore.removeValue();
    expect(onChange.mock.calls).toEqual([
      [{ code: 'KeyJ', mod: true }],
      [DEFAULT_PALETTE_CHORD],
      [{ code: 'F2' }],
      [DEFAULT_PALETTE_CHORD]
    ]);
    unwatch();
    unwatch();
    await setPaletteChord({ code: 'KeyJ', mod: true });
    expect(onChange).toHaveBeenCalledTimes(4);
  });
});
