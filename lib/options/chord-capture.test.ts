/**
 * The shortcut field's rules: keystroke verdicts while recording (cancel,
 * pass, wait, captured, rejected with the pressed chord), the refusal copy
 * per reason and per platform (the reserved group named, chords spelled in
 * words with the supplied legend), the prompt, and the Ctrl+Alt caveat per
 * platform.
 */
import { describe, expect, it } from 'vitest';
import { CHORD_KEY_LABELS, type ChordKeystroke, type PaletteChord } from '../storage/palette-chord';
import {
  CAPTURE_CANCELLED,
  capturePrompt,
  captureRejectionMessage,
  chordFiringCaveat,
  classifyCaptureKey,
  type CaptureVerdict
} from './chord-capture';

/** A keystroke with every modifier released unless overridden. */
function key(code: string, held: Partial<ChordKeystroke> = {}): ChordKeystroke {
  return { code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...held };
}

/** The US legend (what the field shows without a layout map). */
const usLegend = (chord: PaletteChord): string => CHORD_KEY_LABELS[chord.code];

/** Narrow a verdict to a refusal, failing loudly otherwise. */
function rejected(verdict: CaptureVerdict): Extract<CaptureVerdict, { kind: 'rejected' }> {
  if (verdict.kind !== 'rejected') throw new Error(`expected a refusal, got ${verdict.kind}`);
  return verdict;
}

describe('classifyCaptureKey', () => {
  it('Escape cancels and Tab passes, whatever is held', () => {
    expect(classifyCaptureKey(key('Escape'), 'mac')).toEqual({ kind: 'cancel' });
    expect(classifyCaptureKey(key('Escape', { altKey: true }), 'other')).toEqual({
      kind: 'cancel'
    });
    expect(classifyCaptureKey(key('Tab'), 'other')).toEqual({ kind: 'pass' });
    expect(classifyCaptureKey(key('Tab', { shiftKey: true }), 'mac')).toEqual({ kind: 'pass' });
  });

  it('waits on lone modifiers, lock keys, auto-repeat and IME keystrokes', () => {
    for (const code of ['ShiftLeft', 'AltRight', 'MetaLeft', 'ControlRight', 'CapsLock', 'Fn']) {
      expect(classifyCaptureKey(key(code, { altKey: true }), 'other')).toEqual({ kind: 'wait' });
    }
    expect(classifyCaptureKey(key('KeyK', { altKey: true, repeat: true }), 'mac')).toEqual({
      kind: 'wait'
    });
    expect(classifyCaptureKey(key('KeyK', { altKey: true, isComposing: true }), 'mac')).toEqual({
      kind: 'wait'
    });
    expect(classifyCaptureKey(key('KeyK', { altKey: true, keyCode: 229 }), 'other')).toEqual({
      kind: 'wait'
    });
  });

  it('captures a valid combination canonically', () => {
    expect(classifyCaptureKey(key('KeyL', { metaKey: true, shiftKey: true }), 'mac')).toEqual({
      kind: 'captured',
      chord: { code: 'KeyL', mod: true, shift: true }
    });
    expect(classifyCaptureKey(key('F8'), 'other')).toEqual({
      kind: 'captured',
      chord: { code: 'F8' }
    });
  });

  it('refuses with the reason and the pressed chord when it spells one', () => {
    expect(classifyCaptureKey(key('KeyC', { metaKey: true }), 'mac')).toEqual({
      kind: 'rejected',
      reason: 'reserved',
      chord: { code: 'KeyC', mod: true }
    });
    expect(classifyCaptureKey(key('KeyK'), 'other')).toEqual({
      kind: 'rejected',
      reason: 'needs-modifier',
      chord: { code: 'KeyK' }
    });
    expect(classifyCaptureKey(key('Enter', { altKey: true }), 'other')).toEqual({
      kind: 'rejected',
      reason: 'unsupported-key',
      chord: null
    });
    expect(classifyCaptureKey(key('KeyK', { ctrlKey: true }), 'mac')).toEqual({
      kind: 'rejected',
      reason: 'unsupported-modifier',
      chord: null
    });
  });
});

describe('captureRejectionMessage', () => {
  it('names the reserved group and spells the chord in words', () => {
    const copy = rejected(classifyCaptureKey(key('KeyC', { metaKey: true }), 'mac'));
    expect(captureRejectionMessage(copy, 'mac', usLegend)).toBe(
      'Command+C is taken by text editing — choose another one'
    );
    const zoom = rejected(classifyCaptureKey(key('Minus', { ctrlKey: true }), 'other'));
    expect(captureRejectionMessage(zoom, 'other', usLegend)).toBe(
      'Ctrl+- is taken by page zoom — choose another one'
    );
    for (const [press, platform, owner] of [
      [key('KeyF', { ctrlKey: true }), 'other', 'a browser command'],
      [key('F12'), 'other', 'the developer tools'],
      [key('KeyQ', { metaKey: true }), 'mac', 'the operating system']
    ] as const) {
      expect(
        captureRejectionMessage(rejected(classifyCaptureKey(press, platform)), platform, usLegend)
      ).toContain(`is taken by ${owner}`);
    }
  });

  it('spells the key with the supplied (layout) legend', () => {
    const copy = rejected(classifyCaptureKey(key('KeyC', { ctrlKey: true }), 'other'));
    expect(captureRejectionMessage(copy, 'other', () => 'Ç')).toBe(
      'Ctrl+Ç is taken by text editing — choose another one'
    );
  });

  it('explains the other refusals per platform', () => {
    const bare = rejected(classifyCaptureKey(key('KeyK'), 'mac'));
    expect(captureRejectionMessage(bare, 'mac', usLegend)).toBe(
      'Hold Option or Command with the key, or use F1–F12 alone'
    );
    expect(captureRejectionMessage(bare, 'other', usLegend)).toBe(
      'Hold Alt or Ctrl with the key, or use F1–F12 alone'
    );
    const foreignMac = rejected(classifyCaptureKey(key('KeyK', { ctrlKey: true }), 'mac'));
    expect(captureRejectionMessage(foreignMac, 'mac', usLegend)).toContain('Control cannot');
    const foreignOther = rejected(classifyCaptureKey(key('KeyK', { metaKey: true }), 'other'));
    expect(captureRejectionMessage(foreignOther, 'other', usLegend)).toContain(
      'Windows or Super key cannot'
    );
    const unbindable = rejected(classifyCaptureKey(key('Space', { altKey: true }), 'other'));
    expect(captureRejectionMessage(unbindable, 'other', usLegend)).toContain(
      'That key cannot be part of the shortcut'
    );
  });

  it('falls back to a generic line for a reserved verdict without a chord (belt)', () => {
    expect(
      captureRejectionMessage(
        { kind: 'rejected', reason: 'reserved', chord: null },
        'mac',
        usLegend
      )
    ).toBe('That shortcut is taken — choose another one');
    // A chord no group owns (a hand-built verdict) takes the same line.
    expect(
      captureRejectionMessage(
        { kind: 'rejected', reason: 'reserved', chord: { code: 'KeyK', alt: true } },
        'mac',
        usLegend
      )
    ).toBe('That shortcut is taken — choose another one');
  });
});

describe('the prompt and the cancel line', () => {
  it('names the platform modifiers and the way out', () => {
    expect(capturePrompt('mac')).toContain('Option or Command');
    expect(capturePrompt('other')).toContain('Alt or Ctrl');
    expect(capturePrompt('other')).toContain('Escape cancels');
    expect(CAPTURE_CANCELLED).toBe('Shortcut unchanged');
  });
});

describe('chordFiringCaveat', () => {
  const ctrlAlt: PaletteChord = { code: 'KeyP', mod: true, alt: true };

  it('warns on a Ctrl+Alt binding outside macOS', () => {
    const caveat = chordFiringCaveat(ctrlAlt, 'other', usLegend);
    expect(caveat).toContain('Ctrl+Alt shortcuts may never fire on Windows');
    expect(caveat).toContain('AltGr');
    expect(caveat).toContain('The shortcut is saved');
  });

  it('warns on macOS too, naming the synced Windows chord', () => {
    expect(chordFiringCaveat(ctrlAlt, 'mac', usLegend)).toContain(
      'On Windows this shortcut is Ctrl+Alt+P'
    );
    expect(chordFiringCaveat({ ...ctrlAlt, shift: true }, 'mac', () => 'Ü')).toContain(
      'Ctrl+Alt+Shift+Ü'
    );
  });

  it('stays quiet for every other binding', () => {
    for (const chord of [
      { code: 'KeyK', alt: true },
      { code: 'KeyK', mod: true },
      { code: 'KeyK', mod: true, shift: true },
      { code: 'F8' }
    ] as const satisfies readonly PaletteChord[]) {
      expect(chordFiringCaveat(chord, 'other', usLegend)).toBeNull();
      expect(chordFiringCaveat(chord, 'mac', usLegend)).toBeNull();
    }
  });
});
