/**
 * The on-page command palette's keyboard chord: the stored binding plus the
 * pure rules every consumer shares — validation, capture from a keystroke,
 * matching a keystroke, and platform notation.
 *
 * Model: a physical key (`KeyboardEvent.code`, so the chord stays put
 * whatever character the layout or a held Option produces) plus modifier
 * flags. `mod` is the platform's command modifier — Command on macOS, Ctrl
 * elsewhere; `alt` is the browser's `altKey` (Option on macOS, Alt
 * elsewhere); `shift` is Shift. Matching reads the event's modifier flags,
 * which already carry an OS-level modifier remap, so a remapped key fires
 * what it is remapped to — never its printed label. Matching is exact: a
 * held modifier the chord does not name (Ctrl on macOS and Meta elsewhere
 * included) is a different keystroke.
 *
 * The capture listener intercepts the host page for this one combination,
 * so the binding must never steal typing: a chord needs `mod` or `alt`, or
 * a function key on its own. Shift alone does not qualify — Shift + letter
 * is ordinary typing. Stored values that break any rule (corrupt, foreign,
 * unknown key) read as {@link DEFAULT_PALETTE_CHORD}.
 */
import { storage } from 'wxt/utils/storage';
import { isRecord, ownValue } from '../../utils/is-record';

/** The `sync:palette-chord` store key, single-sourced. */
export const PALETTE_CHORD_KEY = 'sync:palette-chord';

/** The keyboard convention a chord is matched and written in. */
export type ChordPlatform = 'mac' | 'other';

/** A palette chord: one physical key plus the modifier flags that must be held. */
export interface PaletteChord {
  /** The physical key, a `KeyboardEvent.code` from {@link CHORD_KEY_LABELS}. */
  readonly code: string;
  /** The command modifier: Command on macOS, Ctrl elsewhere. */
  readonly mod?: boolean;
  /** `altKey`: Option on macOS, Alt elsewhere. */
  readonly alt?: boolean;
  /** Shift (never enough on its own). */
  readonly shift?: boolean;
}

/**
 * The default binding, Alt+K (⌥K on macOS): Cmd/Ctrl+K is left alone because
 * many sites' own palettes (code hosts, docs, chat, the WordPress editor)
 * already own it — it stays selectable.
 */
export const DEFAULT_PALETTE_CHORD: PaletteChord = Object.freeze({ code: 'KeyK', alt: true });

/** Function-key codes that may stand alone (no modifier needed). */
const FUNCTION_KEYS = Array.from({ length: 12 }, (_, index) => `F${String(index + 1)}`);

/**
 * The bindable keys: `KeyboardEvent.code` → the label notation shows. Labels
 * are the US-layout legends of the physical keys (the code's own naming).
 * Keys that navigate or edit (Escape, Tab, Enter, Space, arrows) are left
 * out: the palette and the page need them.
 */
export const CHORD_KEY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(
    Array.from({ length: 26 }, (_, index) => {
      const letter = String.fromCharCode(65 + index);
      return [`Key${letter}`, letter];
    })
  ),
  ...Object.fromEntries(
    Array.from({ length: 10 }, (_, digit) => [`Digit${String(digit)}`, String(digit)])
  ),
  ...Object.fromEntries(FUNCTION_KEYS.map((code) => [code, code])),
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/'
});

/**
 * Whether a code is one of the bindable keys.
 *
 * @param code A `KeyboardEvent.code`.
 */
function isChordKey(code: string): boolean {
  return Object.hasOwn(CHORD_KEY_LABELS, code);
}

/**
 * Whether a chord satisfies the no-typing-theft rule: `mod` or `alt` held,
 * or a function key alone.
 *
 * @param chord A chord whose key is already known bindable.
 */
function hasRequiredModifier(chord: PaletteChord): boolean {
  return chord.mod === true || chord.alt === true || FUNCTION_KEYS.includes(chord.code);
}

/**
 * The canonical form of a chord: only `true` flags are kept, so equal chords
 * are deep-equal and the stored JSON stays minimal.
 *
 * @param code The physical key.
 * @param flags The modifier flags.
 */
function canonicalChord(
  code: string,
  flags: { mod: boolean; alt: boolean; shift: boolean }
): PaletteChord {
  return {
    code,
    ...(flags.mod ? { mod: true } : {}),
    ...(flags.alt ? { alt: true } : {}),
    ...(flags.shift ? { shift: true } : {})
  };
}

/**
 * Validate a raw (possibly corrupt or foreign) chord. The key must be
 * bindable, each present flag a boolean, and the chord must pass the
 * no-typing-theft rule; unknown extra fields are ignored (additive
 * tolerance). A wrong-typed flag rejects the chord rather than guessing it
 * away — a different flag set is a different chord.
 *
 * @param input Any storage- or caller-delivered value.
 * @returns The canonical chord, or null when the value is not a valid chord.
 */
export function parsePaletteChord(input: unknown): PaletteChord | null {
  if (!isRecord(input)) return null;
  const code = ownValue(input, 'code');
  if (typeof code !== 'string' || !isChordKey(code)) return null;
  const flags = { mod: false, alt: false, shift: false };
  for (const name of ['mod', 'alt', 'shift'] as const) {
    const value = ownValue(input, name);
    if (value === undefined) continue;
    if (typeof value !== 'boolean') return null;
    flags[name] = value;
  }
  const chord = canonicalChord(code, flags);
  return hasRequiredModifier(chord) ? chord : null;
}

/**
 * The keystroke fields the chord rules read (a `KeyboardEvent` satisfies it).
 * `repeat`/`isComposing` are optional so plain test objects stay small.
 */
export interface ChordKeystroke {
  readonly code: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly repeat?: boolean;
  readonly isComposing?: boolean;
}

/**
 * Split Ctrl/Meta into the platform's command modifier and the one outside
 * the chord vocabulary (Ctrl on macOS, Meta elsewhere).
 *
 * @param keystroke The keystroke.
 * @param platform The keyboard convention.
 * @returns `[command, foreign]` held states.
 */
function commandModifiers(
  keystroke: ChordKeystroke,
  platform: ChordPlatform
): readonly [command: boolean, foreign: boolean] {
  return platform === 'mac'
    ? [keystroke.metaKey, keystroke.ctrlKey]
    : [keystroke.ctrlKey, keystroke.metaKey];
}

/**
 * Whether a keystroke fires the chord: same physical key, exactly the
 * chord's modifiers, not an auto-repeat and not part of an IME composition.
 *
 * @param keystroke The keydown (or a keystroke-shaped object).
 * @param chord A validated chord.
 * @param platform The keyboard convention (see {@link detectChordPlatform}).
 */
export function matchesChord(
  keystroke: ChordKeystroke,
  chord: PaletteChord,
  platform: ChordPlatform
): boolean {
  if (keystroke.repeat === true || keystroke.isComposing === true) return false;
  const [command, foreign] = commandModifiers(keystroke, platform);
  return (
    keystroke.code === chord.code &&
    keystroke.altKey === (chord.alt === true) &&
    keystroke.shiftKey === (chord.shift === true) &&
    command === (chord.mod === true) &&
    !foreign
  );
}

/** Why a captured keystroke cannot become the chord. */
export type ChordCaptureRejection =
  /** A key outside {@link CHORD_KEY_LABELS} (a lone modifier press included). */
  | 'unsupported-key'
  /** A bindable key without `mod`/`alt` that is not a function key. */
  | 'needs-modifier'
  /** Ctrl held on macOS or Meta held elsewhere — not part of the chord vocabulary. */
  | 'unsupported-modifier';

/** A capture's outcome: the chord, or the reason it was refused. */
export type ChordCaptureResult =
  | { readonly ok: true; readonly chord: PaletteChord }
  | { readonly ok: false; readonly reason: ChordCaptureRejection };

/**
 * Turn a pressed combination into a chord (the rebinding field's rule), with
 * the same validation stored chords pass.
 *
 * @param keystroke The keydown the capture field received.
 * @param platform The keyboard convention.
 * @returns The canonical chord, or why it was refused.
 */
export function captureChord(
  keystroke: ChordKeystroke,
  platform: ChordPlatform
): ChordCaptureResult {
  if (!isChordKey(keystroke.code)) return { ok: false, reason: 'unsupported-key' };
  const [command, foreign] = commandModifiers(keystroke, platform);
  if (foreign) return { ok: false, reason: 'unsupported-modifier' };
  const chord = canonicalChord(keystroke.code, {
    mod: command,
    alt: keystroke.altKey,
    shift: keystroke.shiftKey
  });
  return hasRequiredModifier(chord) ? { ok: true, chord } : { ok: false, reason: 'needs-modifier' };
}

/** How {@link formatChord} writes modifiers. */
export type ChordNotation = 'symbols' | 'words';

/**
 * Write a chord in the platform's notation. macOS `symbols` uses Apple's
 * glyphs in Apple's order (⌥⇧⌘K); `words` spells them (Option+Shift+Command+K)
 * for accessible names, since screen readers announce the glyphs poorly.
 * Elsewhere both notations read Ctrl+Alt+Shift+K.
 *
 * @param chord A validated chord.
 * @param platform The keyboard convention.
 * @param notation Glyphs (default) or spelled-out modifier names.
 * @returns The display string.
 */
export function formatChord(
  chord: PaletteChord,
  platform: ChordPlatform,
  notation: ChordNotation = 'symbols'
): string {
  const key = CHORD_KEY_LABELS[chord.code] ?? chord.code;
  if (platform === 'mac') {
    const modifiers: Array<[boolean, string, string]> = [
      [chord.alt === true, '⌥', 'Option'],
      [chord.shift === true, '⇧', 'Shift'],
      [chord.mod === true, '⌘', 'Command']
    ];
    const held = modifiers.filter(([on]) => on);
    return notation === 'symbols'
      ? `${held.map(([, glyph]) => glyph).join('')}${key}`
      : [...held.map(([, , word]) => word), key].join('+');
  }
  const held = [
    chord.mod === true ? 'Ctrl' : null,
    chord.alt === true ? 'Alt' : null,
    chord.shift === true ? 'Shift' : null
  ].filter((name): name is string => name !== null);
  return [...held, key].join('+');
}

/** The navigator fields {@link detectChordPlatform} reads. */
export interface ChordPlatformSource {
  /** User-Agent Client Hints platform (Chromium). */
  readonly userAgentData?: { readonly platform?: string };
  /** The legacy platform string (every engine; deprecated but still populated). */
  readonly platform?: string;
}

/**
 * The keyboard convention of the running OS. Modifier conventions cannot be
 * feature-detected, so this one read of the platform name is the deliberate
 * exception: Apple platforms use Command, everything else Ctrl.
 *
 * @param source The navigator (or a test double).
 */
export function detectChordPlatform(source: ChordPlatformSource): ChordPlatform {
  const name = source.userAgentData?.platform || source.platform || '';
  return /mac|iphone|ipad|ipod/i.test(name) ? 'mac' : 'other';
}

/** The raw storage item (reads, writes and watches go through the helpers below). */
export const paletteChordStore = storage.defineItem<PaletteChord>(PALETTE_CHORD_KEY, {
  fallback: DEFAULT_PALETTE_CHORD
});

/**
 * Validate a stored value, degrading to the default chord.
 *
 * @param input Any storage-delivered value.
 */
function storedChordOrDefault(input: unknown): PaletteChord {
  return parsePaletteChord(input) ?? DEFAULT_PALETTE_CHORD;
}

/**
 * Read the binding through the validator.
 *
 * @returns The stored chord, or the default when nothing valid is stored.
 * @throws The storage read rejects as the platform does — callers branch.
 */
export async function readPaletteChord(): Promise<PaletteChord> {
  return storedChordOrDefault(await paletteChordStore.getValue());
}

/**
 * Persist a new binding in canonical form.
 *
 * @param chord The chord to store.
 * @throws {@link Error} when the chord fails validation (bad input names
 *   itself — capture through {@link captureChord} first); the storage write
 *   rejects as the platform does.
 */
export async function setPaletteChord(chord: PaletteChord): Promise<void> {
  const valid = parsePaletteChord(chord);
  if (valid === null) {
    throw new Error(`[WPR FDT] Refused an invalid palette chord: ${JSON.stringify(chord)}`);
  }
  await paletteChordStore.setValue(valid);
}

/**
 * Follow the binding: every write reaches the callback validated (corrupt
 * writes and removals as the default chord), so the listener re-arms on a
 * chord that can never steal typing. The same chord may arrive twice —
 * consumers re-arm idempotently.
 *
 * @param onChange Receives the validated chord after each write.
 * @returns The unsubscribe handle (idempotent).
 */
export function watchPaletteChord(onChange: (chord: PaletteChord) => void): () => void {
  return paletteChordStore.watch((raw: unknown) => {
    onChange(storedChordOrDefault(raw));
  });
}
