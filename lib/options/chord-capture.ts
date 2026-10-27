/**
 * The shortcut field's pure rules: what each keystroke means while the field
 * records (capture, refuse with a reason, cancel, let focus move on, or wait
 * for the rest of a combination), and the copy the field announces — prompt,
 * refusal reasons (the reserved group named), and the Ctrl+Alt caveat.
 * Validation itself is the chord contract's (`captureChord`); this module
 * only turns its verdicts into field behavior and words.
 */
import {
  captureChord,
  formatChord,
  IME_PROCESS_KEY_CODE,
  keystrokeChord,
  type ChordCaptureRejection,
  type ChordKeystroke,
  type PaletteChord,
  type ReservedChordGroup,
  reservedChordGroup
} from '../storage/palette-chord';
import type { ChordPlatform } from '../storage/palette-chord-platform';

/**
 * Keys that start or modify a combination without completing it: a lone
 * press waits for the key that follows (never a refusal mid-combination).
 */
const WAITING_CODES: ReadonlySet<string> = new Set([
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight',
  'ControlLeft',
  'ControlRight',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Fn',
  'FnLock'
]);

/** What one keydown means while the field records. */
export type CaptureVerdict =
  /** Escape: stop recording, keep the current shortcut. */
  | { readonly kind: 'cancel' }
  /** Tab: let focus move on (leaving the field stops recording). */
  | { readonly kind: 'pass' }
  /** A lone modifier, auto-repeat or IME keystroke: keep waiting. */
  | { readonly kind: 'wait' }
  /** A valid combination: the new shortcut. */
  | { readonly kind: 'captured'; readonly chord: PaletteChord }
  /**
   * A refused combination; `chord` is what was pressed when it spells one
   * (null for an unbindable key or a foreign modifier).
   */
  | {
      readonly kind: 'rejected';
      readonly reason: ChordCaptureRejection;
      readonly chord: PaletteChord | null;
    };

/**
 * Classify a keydown received while recording.
 *
 * @param keystroke The keydown (a `KeyboardEvent` satisfies it).
 * @param platform The keyboard convention.
 */
export function classifyCaptureKey(
  keystroke: ChordKeystroke,
  platform: ChordPlatform
): CaptureVerdict {
  if (keystroke.code === 'Escape') return { kind: 'cancel' };
  if (keystroke.code === 'Tab') return { kind: 'pass' };
  if (
    keystroke.repeat === true ||
    keystroke.isComposing === true ||
    keystroke.keyCode === IME_PROCESS_KEY_CODE ||
    WAITING_CODES.has(keystroke.code)
  ) {
    return { kind: 'wait' };
  }
  const result = captureChord(keystroke, platform);
  if (result.ok) return { kind: 'captured', chord: result.chord };
  return { kind: 'rejected', reason: result.reason, chord: keystrokeChord(keystroke, platform) };
}

/** Each reserved group's owner, as the refusal names it. */
const RESERVED_OWNERS: Readonly<Record<ReservedChordGroup, string>> = Object.freeze({
  editing: 'text editing',
  browser: 'a browser command',
  zoom: 'page zoom',
  devtools: 'the developer tools',
  system: 'the operating system'
});

/** The platform's two chord modifiers, spelled (macOS: Option/Command; elsewhere Alt/Ctrl). */
function modifierWords(platform: ChordPlatform): string {
  return platform === 'mac' ? 'Option or Command' : 'Alt or Ctrl';
}

/**
 * The field's recording prompt (announced when recording starts).
 *
 * @param platform The keyboard convention.
 */
export function capturePrompt(platform: ChordPlatform): string {
  return `Press the new shortcut — hold ${modifierWords(platform)} with a key, or press F1–F12 alone; Escape cancels`;
}

/** Announced when recording stops without a change. */
export const CAPTURE_CANCELLED = 'Shortcut unchanged';

/**
 * Why a combination was refused, in words (spoken by the field's live
 * region, so chords are spelled, never glyphs).
 *
 * @param verdict The refusal.
 * @param platform The keyboard convention.
 * @param legend The key legend to spell a chord's key with (layout-true when known).
 */
export function captureRejectionMessage(
  verdict: Extract<CaptureVerdict, { kind: 'rejected' }>,
  platform: ChordPlatform,
  legend: (chord: PaletteChord) => string
): string {
  switch (verdict.reason) {
    case 'unsupported-key':
      return 'That key cannot be part of the shortcut — use a letter, a digit, a punctuation key or F1–F12';
    case 'unsupported-modifier':
      return platform === 'mac'
        ? 'Control cannot be part of the shortcut on macOS — use Option or Command'
        : 'The Windows or Super key cannot be part of the shortcut — use Alt or Ctrl';
    case 'needs-modifier':
      return `Hold ${modifierWords(platform)} with the key, or use F1–F12 alone`;
    case 'reserved': {
      const chord = verdict.chord;
      const group = chord === null ? null : reservedChordGroup(chord);
      // A reserved verdict always spells a chord; the generic line is the belt.
      if (chord === null || group === null) return 'That shortcut is taken — choose another one';
      const spelled = formatChord(chord, platform, 'words', legend(chord));
      return `${spelled} is taken by ${RESERVED_OWNERS[group]} — choose another one`;
    }
  }
}

/**
 * The persistent caveat for a Ctrl+Alt binding (`mod` + `alt` — Ctrl+Alt on
 * Windows wherever it was captured, since the binding syncs): Firefox on
 * Windows (and possibly Chromium) reports Ctrl+Alt as AltGr, which the page
 * listener refuses as text input, so the shortcut may never fire there. The
 * binding still saves — the user decides.
 *
 * @param chord The bound chord.
 * @param platform The keyboard convention.
 * @param legend The key legend to spell the chord's key with.
 * @returns The caveat, or null when the chord is not a Ctrl+Alt one.
 */
export function chordFiringCaveat(
  chord: PaletteChord,
  platform: ChordPlatform,
  legend: (chord: PaletteChord) => string
): string | null {
  if (chord.mod !== true || chord.alt !== true) return null;
  const outcome = 'The shortcut is saved; pick another one if the palette does not open';
  if (platform === 'other') {
    return `Ctrl+Alt shortcuts may never fire on Windows — Firefox (and possibly Chrome) reads Ctrl+Alt as AltGr there. ${outcome}`;
  }
  const windows = formatChord(chord, 'other', 'words', legend(chord));
  return `On Windows this shortcut is ${windows}, which may never fire there — Firefox (and possibly Chrome) reads Ctrl+Alt as AltGr. ${outcome}`;
}
