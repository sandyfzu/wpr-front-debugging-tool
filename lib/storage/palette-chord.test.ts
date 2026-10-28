/**
 * The palette chord contract: validation (no-typing-theft rule, bindable
 * keys, reserved chords, wrong-typed flags, canonical form), capture from
 * keystrokes, exact per-platform matching (repeat/IME/AltGr refused), the
 * typing-safety predicate, notation, and the storage item's
 * default-tolerant reads, guarded writes and validated watch.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHORD_KEY_LABELS,
  DEFAULT_PALETTE_CHORD,
  PALETTE_CHORD_KEY,
  RESERVED_CHORDS,
  captureChord,
  chordMayTypeText,
  chordsEqual,
  formatChord,
  keystrokeChord,
  matchesChord,
  paletteChordStore,
  parsePaletteChord,
  reservedChordGroup,
  readPaletteChord,
  setPaletteChord,
  textKeystrokeKind,
  watchPaletteChord,
  type ChordKeystroke,
  type PaletteChord,
  type ReservedChordGroup
} from './palette-chord';
import type { ChordPlatform } from './palette-chord-platform';

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
  it('covers letters, digits, F1–F12, US punctuation + the ISO key, and nothing that navigates', () => {
    expect(CHORD_KEY_LABELS.KeyA).toBe('A');
    expect(CHORD_KEY_LABELS.KeyZ).toBe('Z');
    expect(CHORD_KEY_LABELS.Digit0).toBe('0');
    expect(CHORD_KEY_LABELS.F12).toBe('F12');
    expect(CHORD_KEY_LABELS.Slash).toBe('/');
    expect(CHORD_KEY_LABELS.IntlBackslash).toBe('\\ (ISO)');
    expect(Object.keys(CHORD_KEY_LABELS)).toHaveLength(26 + 10 + 12 + 12);
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

  it('returns frozen chords', () => {
    const chord = parsePaletteChord({ code: 'KeyK', mod: true });
    // `Object.isFrozen(null)` is true too — pin that the chord parsed first.
    expect(chord).toEqual({ code: 'KeyK', mod: true });
    expect(Object.isFrozen(chord)).toBe(true);
  });

  it('binds the ISO key like any other punctuation key', () => {
    expect(parsePaletteChord({ code: 'IntlBackslash', alt: true })).toEqual({
      code: 'IntlBackslash',
      alt: true
    });
    expect(formatChord({ code: 'IntlBackslash', mod: true }, 'other')).toBe('Ctrl+\\ (ISO)');
  });

  it('drops false flags and ignores unknown fields (canonical, additive-tolerant)', () => {
    expect(
      parsePaletteChord({ code: 'KeyL', mod: true, alt: false, shift: true, future: 1 })
    ).toEqual({ code: 'KeyL', mod: true, shift: true });
  });

  it('allows a function key alone', () => {
    expect(parsePaletteChord({ code: 'F2' })).toEqual({ code: 'F2' });
    expect(parsePaletteChord({ code: 'F8', shift: false })).toEqual({ code: 'F8' });
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

  it('refuses auto-repeats and IME compositions (flag or key code 229)', () => {
    expect(matchesChord(key('KeyK', { altKey: true, repeat: true }), altK, 'other')).toBe(false);
    expect(matchesChord(key('KeyK', { altKey: true, isComposing: true }), altK, 'mac')).toBe(false);
    expect(matchesChord(key('KeyK', { altKey: true, keyCode: 229 }), altK, 'mac')).toBe(false);
    expect(matchesChord(key('KeyK', { altKey: true, keyCode: 75 }), altK, 'mac')).toBe(true);
  });

  it('refuses AltGr outside macOS, but not Option reported as AltGraph on macOS', () => {
    const ctrlAltK: PaletteChord = { code: 'KeyK', mod: true, alt: true };
    const altGraph = (held: string): boolean => held === 'AltGraph';
    const none = (): boolean => false;
    const altGr = key('KeyK', { ctrlKey: true, altKey: true, getModifierState: altGraph });
    expect(matchesChord(altGr, ctrlAltK, 'other')).toBe(false);
    expect(matchesChord({ ...altGr, getModifierState: none }, ctrlAltK, 'other')).toBe(true);
    // Firefox on macOS reports AltGraph for every Option press.
    const option = key('KeyK', { altKey: true, getModifierState: altGraph });
    expect(matchesChord(option, altK, 'mac')).toBe(true);
  });

  it('names why a keystroke is text input (the shared predicate)', () => {
    const altGraph = (held: string): boolean => held === 'AltGraph';
    expect(textKeystrokeKind(key('KeyK', { altKey: true, repeat: true }), 'mac')).toBe('repeat');
    expect(textKeystrokeKind(key('KeyK', { isComposing: true }), 'other')).toBe('composition');
    expect(textKeystrokeKind(key('KeyK', { keyCode: 229 }), 'mac')).toBe('composition');
    const altGr = key('KeyK', { ctrlKey: true, altKey: true, getModifierState: altGraph });
    expect(textKeystrokeKind(altGr, 'other')).toBe('altgraph');
    // macOS: Firefox's AltGraph is the chord's own Option.
    expect(textKeystrokeKind(altGr, 'mac')).toBeNull();
    // A probe-less keystroke (plain object) and a command keystroke.
    expect(textKeystrokeKind(key('KeyK', { ctrlKey: true, altKey: true }), 'other')).toBeNull();
    expect(textKeystrokeKind(key('KeyK', { altKey: true, keyCode: 75 }), 'other')).toBeNull();
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
    expect(captureChord(key('KeyL', { metaKey: true, shiftKey: true }), 'mac')).toEqual({
      ok: true,
      chord: { code: 'KeyL', mod: true, shift: true }
    });
    expect(captureChord(key('Slash', { ctrlKey: true }), 'other')).toEqual({
      ok: true,
      chord: { code: 'Slash', mod: true }
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
    expect(captureChord(key('KeyC', { metaKey: true }), 'mac')).toEqual({
      ok: false,
      reason: 'reserved'
    });
    expect(captureChord(key('F12'), 'other')).toEqual({ ok: false, reason: 'reserved' });
  });

  it('round-trips: a captured chord parses and matches the press that made it', () => {
    const press = key('KeyK', { altKey: true, shiftKey: true });
    const result = captureChord(press, 'other');
    if (!result.ok) throw new Error('expected a chord');
    expect(parsePaletteChord(result.chord)).toEqual(result.chord);
    expect(matchesChord(press, result.chord, 'other')).toBe(true);
  });
});

describe('chordsEqual', () => {
  it('compares key and flags, treating an absent flag as false', () => {
    expect(
      chordsEqual({ code: 'KeyK', alt: true }, { code: 'KeyK', alt: true, shift: false })
    ).toBe(true);
    expect(chordsEqual({ code: 'KeyK', alt: true }, { code: 'KeyK', alt: true, shift: true })).toBe(
      false
    );
    expect(chordsEqual({ code: 'KeyK', alt: true }, { code: 'KeyJ', alt: true })).toBe(false);
    expect(chordsEqual({ code: 'KeyK', mod: true }, { code: 'KeyK', alt: true })).toBe(false);
  });
});

describe('keystrokeChord', () => {
  it('spells the canonical chord of a press before the rules run (reserved and bare keys included)', () => {
    expect(keystrokeChord(key('KeyC', { metaKey: true }), 'mac')).toEqual({
      code: 'KeyC',
      mod: true
    });
    expect(keystrokeChord(key('KeyC', { ctrlKey: true }), 'other')).toEqual({
      code: 'KeyC',
      mod: true
    });
    expect(keystrokeChord(key('KeyK'), 'other')).toEqual({ code: 'KeyK' });
    expect(Object.isFrozen(keystrokeChord(key('KeyK', { altKey: true }), 'mac'))).toBe(true);
  });

  it('is null for an unbindable key or a modifier outside the vocabulary', () => {
    expect(keystrokeChord(key('Escape', { altKey: true }), 'other')).toBeNull();
    expect(keystrokeChord(key('KeyK', { ctrlKey: true }), 'mac')).toBeNull();
    expect(keystrokeChord(key('KeyK', { metaKey: true }), 'other')).toBeNull();
  });
});

/** The keystroke that presses a chord on a platform. */
function press(chord: PaletteChord, platform: ChordPlatform): ChordKeystroke {
  const command = chord.mod === true;
  return key(chord.code, {
    altKey: chord.alt === true,
    shiftKey: chord.shift === true,
    ...(platform === 'mac' ? { metaKey: command } : { ctrlKey: command })
  });
}

/** `mod` chords over several keys (test-local spelling of the expectations). */
function mods(codes: readonly PaletteChord['code'][], extra: Partial<PaletteChord> = {}) {
  return codes.map((code): PaletteChord => ({ code, mod: true, ...extra }));
}

describe('reserved chords', () => {
  const expected: Record<ReservedChordGroup, readonly PaletteChord[]> = {
    editing: [
      ...mods(['KeyC', 'KeyV', 'KeyX', 'KeyA', 'KeyZ', 'KeyY', 'KeyB', 'KeyI', 'KeyU']),
      ...mods(['KeyZ'], { shift: true }),
      { code: 'F10', alt: true },
      ...mods(['KeyT', 'KeyY', 'KeyV', 'KeyX'], { alt: true }),
      ...mods(['Comma', 'Backslash'], { shift: true }),
      ...mods(['KeyT', 'KeyY', 'KeyM', 'KeyF'], { alt: true, shift: true }),
      ...(
        [
          'KeyO',
          'KeyZ',
          'KeyP',
          'KeyH',
          'Digit0',
          'Digit1',
          'Digit2',
          'Digit3',
          'Digit4',
          'Digit5',
          'Digit6',
          'Digit7',
          'Digit8',
          'Digit9',
          'KeyX',
          'KeyD',
          'KeyC',
          'KeyR',
          'KeyL',
          'KeyJ',
          'KeyQ',
          'KeyU',
          'KeyM',
          'KeyS',
          'KeyW'
        ] as const
      ).map((code): PaletteChord => ({ code, alt: true, shift: true })),
      ...(['KeyL', 'F8', 'F9', 'F11'] as const).map((code): PaletteChord => ({ code, alt: true })),
      ...mods(['F9'])
    ],
    browser: [
      ...mods(['KeyF', 'KeyS', 'KeyP', 'KeyR', 'KeyL', 'KeyW', 'KeyT', 'KeyN', 'KeyH', 'F4']),
      ...mods(['KeyD', 'KeyO', 'KeyJ', 'KeyG', 'Comma', 'KeyE']),
      ...mods(['KeyR', 'KeyT', 'KeyN', 'KeyW'], { shift: true }),
      ...mods(['KeyG', 'KeyA', 'KeyB', 'KeyO', 'KeyP'], { shift: true }),
      ...mods(['KeyD', 'KeyH', 'KeyY'], { shift: true }),
      ...mods(['BracketLeft', 'BracketRight', 'Period', 'F5', 'F6']),
      ...mods(['KeyF', 'KeyS', 'KeyX', 'KeyQ', 'BracketRight'], { shift: true }),
      ...mods(['KeyR', 'KeyF', 'KeyU', 'KeyB', 'KeyP', 'KeyN', 'KeyZ'], { alt: true }),
      ...mods(['KeyA', 'KeyI', 'BracketRight'], { alt: true, shift: true }),
      ...(['KeyE', 'KeyF', 'KeyD'] as const).map((code): PaletteChord => ({ code, alt: true })),
      ...(['KeyT', 'KeyA', 'KeyN', 'KeyI'] as const).map((code): PaletteChord => ({
        code,
        alt: true,
        shift: true
      })),
      ...mods([
        'Digit1',
        'Digit2',
        'Digit3',
        'Digit4',
        'Digit5',
        'Digit6',
        'Digit7',
        'Digit8',
        'Digit9'
      ]),
      ...(
        [
          'Digit1',
          'Digit2',
          'Digit3',
          'Digit4',
          'Digit5',
          'Digit6',
          'Digit7',
          'Digit8',
          'Digit9'
        ] as const
      ).map((code): PaletteChord => ({ code, alt: true })),
      ...(['F1', 'F3', 'F5', 'F6', 'F7', 'F9', 'F10'] as const).map((code): PaletteChord => ({
        code
      })),
      ...(['F3', 'F5', 'F7', 'F9'] as const).map((code): PaletteChord => ({ code, shift: true }))
    ],
    zoom: [...mods(['Equal', 'Minus', 'Digit0']), ...mods(['Equal'], { shift: true })],
    devtools: [
      { code: 'F12' },
      ...mods(['KeyI', 'KeyJ', 'KeyC', 'KeyK', 'KeyM', 'KeyE'], { shift: true }),
      ...mods(['KeyI', 'KeyJ', 'KeyC', 'KeyK', 'KeyM', 'KeyE'], { alt: true })
    ],
    system: [
      ...mods(['KeyQ', 'KeyM', 'Backquote']),
      ...mods(['Backquote'], { shift: true }),
      ...mods(['KeyH'], { alt: true }),
      { code: 'F4', alt: true },
      { code: 'F11' }
    ]
  };

  for (const [group, chords] of Object.entries(expected) as Array<
    [ReservedChordGroup, readonly PaletteChord[]]
  >) {
    it(`refuses every ${group} chord in parse and in capture on both platforms`, () => {
      for (const chord of chords) {
        expect(reservedChordGroup(chord)).toBe(group);
        expect(parsePaletteChord(chord)).toBeNull();
        for (const platform of ['mac', 'other'] as const) {
          expect(captureChord(press(chord, platform), platform)).toEqual({
            ok: false,
            reason: 'reserved'
          });
        }
      }
    });
  }

  it('is exactly the expected table: one owner per chord, every row otherwise bindable', () => {
    expect(RESERVED_CHORDS).toEqual(expected);
    const identities = Object.values(RESERVED_CHORDS)
      .flat()
      .map((chord) => JSON.stringify(chord));
    expect(new Set(identities).size).toBe(identities.length);
  });

  it('keeps the default, Cmd/Ctrl+K and other free chords valid', () => {
    for (const free of [
      DEFAULT_PALETTE_CHORD,
      { code: 'KeyK', mod: true },
      { code: 'KeyK', alt: true, shift: true },
      { code: 'KeyL', mod: true, shift: true },
      { code: 'Digit1', mod: true, shift: true },
      { code: 'F2' },
      { code: 'F4' },
      { code: 'F8' },
      { code: 'F10', shift: true },
      { code: 'KeyR', alt: true },
      { code: 'KeyW', alt: true },
      { code: 'Comma', mod: true, alt: true },
      { code: 'KeyO', mod: true, alt: true }
    ] satisfies PaletteChord[]) {
      expect(reservedChordGroup(free)).toBeNull();
      expect(parsePaletteChord(free)).toEqual(free);
    }
  });
});

describe('chordMayTypeText', () => {
  it('flags chords without mod (Option/Alt + key types on many layouts)', () => {
    for (const platform of ['mac', 'other'] as const) {
      expect(chordMayTypeText(DEFAULT_PALETTE_CHORD, platform)).toBe(true);
      expect(chordMayTypeText({ code: 'KeyK', alt: true, shift: true }, platform)).toBe(true);
    }
  });

  it('flags Ctrl+Alt outside macOS only (AltGr), never Command+Option', () => {
    const modAlt: PaletteChord = { code: 'KeyL', mod: true, alt: true };
    expect(chordMayTypeText(modAlt, 'other')).toBe(true);
    expect(chordMayTypeText(modAlt, 'mac')).toBe(false);
  });

  it('clears mod chords and function keys', () => {
    for (const platform of ['mac', 'other'] as const) {
      expect(chordMayTypeText({ code: 'KeyK', mod: true }, platform)).toBe(false);
      expect(chordMayTypeText({ code: 'KeyK', mod: true, shift: true }, platform)).toBe(false);
      expect(chordMayTypeText({ code: 'F2' }, platform)).toBe(false);
      expect(chordMayTypeText({ code: 'F2', alt: true }, platform)).toBe(false);
    }
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

  it('writes a caller-supplied key legend in place of the US one', () => {
    expect(formatChord({ code: 'KeyQ', alt: true }, 'mac', 'symbols', 'A')).toBe('⌥A');
    expect(formatChord({ code: 'KeyQ', alt: true }, 'other', 'words', 'A')).toBe('Alt+A');
  });
});

describe('the chord store', () => {
  it('reads the default on a fresh install, a removed key, and corrupt values', async () => {
    expect(await readPaletteChord()).toEqual(DEFAULT_PALETTE_CHORD);
    for (const corrupt of ['alt+k', { code: 'KeyK' }, { code: 'KeyK', alt: 'yes' }, null]) {
      await fakeBrowser.storage.sync.set({ [SYNC_KEY]: corrupt });
      expect(await readPaletteChord()).toEqual(DEFAULT_PALETTE_CHORD);
    }
    await setPaletteChord({ code: 'KeyL', mod: true, shift: true });
    await paletteChordStore.removeValue();
    expect(await readPaletteChord()).toEqual(DEFAULT_PALETTE_CHORD);
  });

  it('reads the default, live too, for a stored chord that a later version reserves', async () => {
    // Written raw, as an older version validated it (⌘⌥P / Ctrl+Alt+P, now page setup).
    const nowReserved = { code: 'KeyP', mod: true, alt: true };
    const seen: PaletteChord[] = [];
    const unwatch = watchPaletteChord((chord) => seen.push(chord));
    await fakeBrowser.storage.sync.set({ [SYNC_KEY]: nowReserved });
    expect(await readPaletteChord()).toEqual(DEFAULT_PALETTE_CHORD);
    expect(seen).toEqual([DEFAULT_PALETTE_CHORD]);
    unwatch();
  });

  it('stores the canonical form and reads it back', async () => {
    await setPaletteChord({ code: 'KeyL', mod: true, alt: false, shift: true });
    expect(await fakeBrowser.storage.sync.get(SYNC_KEY)).toEqual({
      [SYNC_KEY]: { code: 'KeyL', mod: true, shift: true }
    });
    expect(await readPaletteChord()).toEqual({ code: 'KeyL', mod: true, shift: true });
  });

  it('refuses to write an invalid chord, leaving the stored one untouched', async () => {
    await setPaletteChord({ code: 'KeyL', mod: true, shift: true });
    await expect(setPaletteChord({ code: 'KeyK' })).rejects.toThrow(
      'Refused an invalid palette chord: {"code":"KeyK"}'
    );
    await expect(setPaletteChord({ code: 'KeyC', mod: true })).rejects.toThrow(
      'Refused an invalid palette chord: {"code":"KeyC","mod":true}'
    );
    expect(await readPaletteChord()).toEqual({ code: 'KeyL', mod: true, shift: true });
  });

  it('names hostile input without throwing while describing it', async () => {
    const circular: Record<string, unknown> = { code: 'Escape' };
    circular.self = circular;
    await expect(setPaletteChord(circular as unknown as PaletteChord)).rejects.toThrow(
      'Refused an invalid palette chord: [unserializable value]'
    );
    await expect(setPaletteChord(undefined as unknown as PaletteChord)).rejects.toThrow(
      'Refused an invalid palette chord: undefined'
    );
  });

  it('reads a stored reserved chord as the default', async () => {
    await fakeBrowser.storage.sync.set({ [SYNC_KEY]: { code: 'KeyV', mod: true } });
    expect(await readPaletteChord()).toEqual(DEFAULT_PALETTE_CHORD);
  });

  it('watches validated writes (corrupt and removed as the default) until unsubscribed', async () => {
    const onChange = vi.fn<(chord: PaletteChord) => void>();
    const unwatch = watchPaletteChord(onChange);
    await setPaletteChord({ code: 'KeyL', mod: true, shift: true });
    await fakeBrowser.storage.sync.set({ [SYNC_KEY]: { code: 'KeyJ' } });
    await setPaletteChord({ code: 'F2' });
    await paletteChordStore.removeValue();
    expect(onChange.mock.calls).toEqual([
      [{ code: 'KeyL', mod: true, shift: true }],
      [DEFAULT_PALETTE_CHORD],
      [{ code: 'F2' }],
      [DEFAULT_PALETTE_CHORD]
    ]);
    unwatch();
    unwatch();
    await setPaletteChord({ code: 'KeyL', mod: true, shift: true });
    expect(onChange).toHaveBeenCalledTimes(4);
  });
});
