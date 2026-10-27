/**
 * The on-page command palette's keyboard chord: the stored binding plus the
 * pure rules every consumer shares — validation, capture from a keystroke,
 * matching a keystroke, typing safety, and platform notation.
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
 * Typing safety, in two layers. Stored chords need `mod` or `alt`, or a
 * function key on its own — a bare key or Shift + key is ordinary typing on
 * every layout. That alone is not enough: Option + key on macOS and
 * Ctrl+Alt (AltGr) on Windows type characters on many layouts (⌥K is "˚"),
 * so {@link chordMayTypeText} names those chords and the listener lets them
 * through untouched inside editable fields; AltGr keystrokes and IME input
 * never match at all. Chords the browser, the OS or editing already own
 * ({@link RESERVED_CHORDS}) are refused too. Stored values that break any
 * rule (corrupt, foreign, unknown key, reserved) read as
 * {@link DEFAULT_PALETTE_CHORD}.
 */
import { storage } from 'wxt/utils/storage';
import { isRecord, ownValue } from '../../utils/is-record';
import type { ChordPlatform } from './palette-chord-platform';

/** The `sync:palette-chord` store key, single-sourced. */
export const PALETTE_CHORD_KEY = 'sync:palette-chord';

/** Letter keys (`Key<Letter>` codes). */
const LETTERS = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z'
] as const;

/** Top-row digit keys (`Digit<n>` codes). */
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** Function keys — the only keys that may stand alone (no modifier needed). */
const FUNCTION_KEYS = [
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12'
] as const;

/**
 * Punctuation keys → label: the US-layout legend of the physical key (the
 * code's own naming). `IntlBackslash` is the extra ISO key beside left
 * Shift, which has no US legend.
 */
const PUNCTUATION_LABELS = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  IntlBackslash: '\\ (ISO)',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/'
} as const;

/** A function-key code. */
type FunctionKeyCode = (typeof FUNCTION_KEYS)[number];

/** A bindable physical key: a `KeyboardEvent.code` from {@link CHORD_KEY_LABELS}. */
export type ChordKeyCode =
  | `Key${(typeof LETTERS)[number]}`
  | `Digit${(typeof DIGITS)[number]}`
  | FunctionKeyCode
  | keyof typeof PUNCTUATION_LABELS;

/**
 * The bindable keys: `KeyboardEvent.code` → the label notation shows. Keys
 * that navigate or edit (Escape, Tab, Enter, Space, arrows) are left out:
 * the palette and the page need them.
 */
export const CHORD_KEY_LABELS: Readonly<Record<ChordKeyCode, string>> = Object.freeze({
  ...(Object.fromEntries(LETTERS.map((letter) => [`Key${letter}`, letter])) as Record<
    `Key${(typeof LETTERS)[number]}`,
    string
  >),
  ...(Object.fromEntries(DIGITS.map((digit) => [`Digit${digit}`, digit])) as Record<
    `Digit${(typeof DIGITS)[number]}`,
    string
  >),
  ...(Object.fromEntries(FUNCTION_KEYS.map((code) => [code, code])) as Record<
    FunctionKeyCode,
    string
  >),
  ...PUNCTUATION_LABELS
});

/** A palette chord: one physical key plus the modifier flags that must be held. */
export interface PaletteChord {
  /** The physical key. */
  readonly code: ChordKeyCode;
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
 * already own it — it stays selectable. ⌥K types "˚" on macOS layouts, so
 * inside editable fields it types; everywhere else on the page it opens the
 * palette (see {@link chordMayTypeText}).
 */
export const DEFAULT_PALETTE_CHORD: PaletteChord = Object.freeze({ code: 'KeyK', alt: true });

/**
 * Whether a string is one of the bindable keys.
 *
 * @param code A `KeyboardEvent.code`.
 */
function isChordKey(code: string): code is ChordKeyCode {
  return Object.hasOwn(CHORD_KEY_LABELS, code);
}

/**
 * Whether a key is a function key.
 *
 * @param code A bindable key.
 */
function isFunctionKey(code: ChordKeyCode): boolean {
  return (FUNCTION_KEYS as readonly string[]).includes(code);
}

/**
 * The canonical form of a chord: only `true` flags are kept, so equal chords
 * are deep-equal and the stored JSON stays minimal; frozen like the default,
 * so no consumer can mutate a chord another one holds.
 *
 * @param code The physical key.
 * @param flags The modifier flags.
 */
function canonicalChord(
  code: ChordKeyCode,
  flags: { mod?: boolean; alt?: boolean; shift?: boolean }
): PaletteChord {
  return Object.freeze({
    code,
    ...(flags.mod === true ? { mod: true } : {}),
    ...(flags.alt === true ? { alt: true } : {}),
    ...(flags.shift === true ? { shift: true } : {})
  });
}

/**
 * One identity string per distinct chord (key + the three flags).
 *
 * @param chord Any chord.
 */
function chordIdentity(chord: PaletteChord): string {
  const flag = (on: boolean | undefined): string => (on === true ? '1' : '0');
  return `${chord.code}:${flag(chord.mod)}${flag(chord.alt)}${flag(chord.shift)}`;
}

/** Why a reserved chord group is off-limits (see {@link RESERVED_CHORDS}). */
export type ReservedChordGroup = 'editing' | 'browser' | 'zoom' | 'devtools' | 'system';

/**
 * Build `mod` (+ extra flag) chords over several keys.
 *
 * @param codes The keys.
 * @param extra Flags held with `mod`.
 */
function withMod(
  codes: readonly ChordKeyCode[],
  extra: { alt?: boolean; shift?: boolean } = {}
): PaletteChord[] {
  return codes.map((code) => canonicalChord(code, { mod: true, ...extra }));
}

/**
 * Chords the palette may never take, by owner. The binding is synced, so
 * one stored chord reaches every OS the user signs in on: a chord reserved
 * on any platform is refused everywhere (`mod` is the same intent on each —
 * ⌘C and Ctrl+C are one row). Binding any of these would either never fire
 * (the browser or OS consumes it first) or take a command the user relies
 * on away from every page.
 */
export const RESERVED_CHORDS: Readonly<Record<ReservedChordGroup, readonly PaletteChord[]>> =
  Object.freeze({
    /**
     * Clipboard, select-all, undo/redo — every field on the page needs them —
     * and bold/italic/underline in rich-text editors (contenteditable, e.g.
     * the WordPress block editor). `mod` + B and + U also carry browser
     * commands (Firefox bookmarks sidebar, page source); one owner per chord.
     * Alt+F10 moves focus to the block editor's nearest toolbar.
     */
    editing: Object.freeze([
      ...withMod(['KeyC', 'KeyV', 'KeyX', 'KeyA', 'KeyZ', 'KeyY', 'KeyB', 'KeyI', 'KeyU']),
      ...withMod(['KeyZ'], { shift: true }),
      canonicalChord('F10', { alt: true })
    ]),
    /**
     * Browser commands: find, save, print, reload, address bar, tabs and
     * windows (new/close/reopen/private), tab switching by number, Ctrl+F4
     * tab close (Windows/Linux), Ctrl+H history; bookmark page (D), open
     * file (O), downloads (J), find next/previous (G, Shift+G), settings
     * (⌘,); Shift + A add-ons, B bookmarks bar, O bookmarks manager/library,
     * P private window (Firefox), D bookmark all tabs (also the block
     * editor's duplicate block), H history library (Firefox), Y downloads
     * (Firefox, Linux); `mod` + Alt + R reader view (Firefox: Ctrl+Alt+R,
     * ⌘⌥R). Lone keys: F1 help, F3 find next, F5 reload, F6 focus
     * toolbars/address bar, F7 caret browsing, F9 reader view (Firefox),
     * F10 menu bar/toolbar focus.
     */
    browser: Object.freeze([
      ...withMod(['KeyF', 'KeyS', 'KeyP', 'KeyR', 'KeyL', 'KeyW', 'KeyT', 'KeyN', 'KeyH', 'F4']),
      ...withMod(['KeyD', 'KeyO', 'KeyJ', 'KeyG', 'Comma']),
      ...withMod(['KeyR', 'KeyT', 'KeyN', 'KeyW'], { shift: true }),
      ...withMod(['KeyG', 'KeyA', 'KeyB', 'KeyO', 'KeyP'], { shift: true }),
      ...withMod(['KeyD', 'KeyH', 'KeyY'], { shift: true }),
      ...withMod(['KeyR'], { alt: true }),
      ...withMod(DIGITS.filter((digit) => digit !== '0').map((digit) => `Digit${digit}` as const)),
      ...(['F1', 'F3', 'F5', 'F6', 'F7', 'F9', 'F10'] as const).map((code) =>
        canonicalChord(code, {})
      )
    ]),
    /** Page zoom in/out/reset (`mod` + `=`, `+` via Shift on US, `-`, `0`). */
    zoom: Object.freeze([
      ...withMod(['Equal', 'Minus', 'Digit0']),
      ...withMod(['Equal'], { shift: true })
    ]),
    /**
     * Developer tools: F12; Ctrl+Shift+I/J/C (Chromium, Windows/Linux) and
     * ⌘⌥I/J/C + ⌘⇧C (Chromium, macOS); the console, responsive-design and
     * network chords K/M/E (Firefox: Ctrl+Shift on Windows/Linux, ⌘⌥ on
     * macOS).
     */
    devtools: Object.freeze([
      canonicalChord('F12', {}),
      ...withMod(['KeyI', 'KeyJ', 'KeyC', 'KeyK', 'KeyM', 'KeyE'], { shift: true }),
      ...withMod(['KeyI', 'KeyJ', 'KeyC', 'KeyK', 'KeyM', 'KeyE'], { alt: true })
    ]),
    /**
     * OS window commands: quit (⌘Q; Ctrl+Q on Linux), hide (⌘H), minimize
     * (⌘M), close window (Alt+F4, Windows/Linux), full screen (F11).
     */
    system: Object.freeze([
      ...withMod(['KeyQ', 'KeyM']),
      canonicalChord('F4', { alt: true }),
      canonicalChord('F11', {})
    ])
  });

/** {@link RESERVED_CHORDS} indexed by chord identity (each chord has one owner). */
const RESERVED_INDEX: ReadonlyMap<string, ReservedChordGroup> = new Map(
  (Object.entries(RESERVED_CHORDS) as Array<[ReservedChordGroup, readonly PaletteChord[]]>).flatMap(
    ([group, chords]) => chords.map((chord) => [chordIdentity(chord), group] as const)
  )
);

/**
 * Which reserved group owns a chord, if any.
 *
 * @param chord Any chord.
 * @returns The owning group, or null when the chord is free.
 */
export function reservedChordGroup(chord: PaletteChord): ReservedChordGroup | null {
  return RESERVED_INDEX.get(chordIdentity(chord)) ?? null;
}

/**
 * Whether a chord satisfies the no-typing-theft rule: `mod` or `alt` held,
 * or a function key alone.
 *
 * @param chord A chord whose key is already known bindable.
 */
function hasRequiredModifier(chord: PaletteChord): boolean {
  return chord.mod === true || chord.alt === true || isFunctionKey(chord.code);
}

/** Why a captured keystroke cannot become the chord. */
export type ChordCaptureRejection =
  /** A key outside {@link CHORD_KEY_LABELS} (a lone modifier press included). */
  | 'unsupported-key'
  /** A bindable key without `mod`/`alt` that is not a function key. */
  | 'needs-modifier'
  /** Ctrl held on macOS or Meta held elsewhere — not part of the chord vocabulary. */
  | 'unsupported-modifier'
  /** A chord in {@link RESERVED_CHORDS}. */
  | 'reserved';

/**
 * The rule checks a canonical chord with a bindable key must pass — shared
 * by stored values and captures so both refuse the same chords.
 *
 * @param chord A canonical chord.
 * @returns The refusal, or null when the chord is valid.
 */
function chordRejection(chord: PaletteChord): ChordCaptureRejection | null {
  if (!hasRequiredModifier(chord)) return 'needs-modifier';
  if (reservedChordGroup(chord) !== null) return 'reserved';
  return null;
}

/**
 * Validate a raw (possibly corrupt or foreign) chord. The key must be
 * bindable, each present flag a boolean, the chord must pass the
 * no-typing-theft rule and not be reserved; unknown extra fields are ignored
 * (additive tolerance). A wrong-typed flag rejects the chord rather than
 * guessing it away — a different flag set is a different chord.
 *
 * @param input Any storage- or caller-delivered value.
 * @returns The canonical (frozen) chord, or null when the value is not a valid chord.
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
  return chordRejection(chord) === null ? chord : null;
}

/**
 * The keystroke fields the chord rules read (a `KeyboardEvent` satisfies it).
 * Everything past the five core fields is optional so plain test objects
 * stay small.
 */
export interface ChordKeystroke {
  readonly code: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly repeat?: boolean;
  readonly isComposing?: boolean;
  /** Legacy key code: 229 marks a keystroke an IME is processing. */
  readonly keyCode?: number;
  /** Modifier-state probe (`AltGraph` marks a character-level keystroke). */
  getModifierState?(key: string): boolean;
}

/** The legacy `keyCode` every engine reports for a keystroke an IME is processing. */
const IME_PROCESS_KEY_CODE = 229;

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
 * Whether a keystroke is text input rather than a command: an auto-repeat,
 * an IME composition (flag or key code 229), or — outside macOS — an AltGr
 * press (Windows reports AltGr as Ctrl+Alt). On macOS Firefox reports
 * `AltGraph` for every Option press, so there it is the chord's own `alt`,
 * not a reason to refuse.
 *
 * @param keystroke The keystroke.
 * @param platform The keyboard convention.
 */
function isTextKeystroke(keystroke: ChordKeystroke, platform: ChordPlatform): boolean {
  if (keystroke.repeat === true || keystroke.isComposing === true) return true;
  if (keystroke.keyCode === IME_PROCESS_KEY_CODE) return true;
  return platform !== 'mac' && keystroke.getModifierState?.('AltGraph') === true;
}

/**
 * Whether a keystroke fires the chord: same physical key, exactly the
 * chord's modifiers, and not text input (see {@link isTextKeystroke}).
 * Editable targets are the listener's call — see {@link chordMayTypeText}.
 *
 * @param keystroke The keydown (or a keystroke-shaped object).
 * @param chord A validated chord.
 * @param platform The keyboard convention (see `chordPlatformFromOs`).
 */
export function matchesChord(
  keystroke: ChordKeystroke,
  chord: PaletteChord,
  platform: ChordPlatform
): boolean {
  if (isTextKeystroke(keystroke, platform)) return false;
  const [command, foreign] = commandModifiers(keystroke, platform);
  return (
    keystroke.code === chord.code &&
    keystroke.altKey === (chord.alt === true) &&
    keystroke.shiftKey === (chord.shift === true) &&
    command === (chord.mod === true) &&
    !foreign
  );
}

/**
 * Whether the chord may type a character on some layout: any chord without
 * `mod` (Option + key on macOS, Alt + key on several Linux/Windows layouts)
 * and, outside macOS, Ctrl+Alt chords (AltGr on Windows); a function key
 * never types. The listener must not intercept such a chord while focus is
 * in an editable element (input, textarea, contenteditable) — there it
 * types as usual; elsewhere on the page it opens the palette.
 *
 * @param chord A validated chord.
 * @param platform The keyboard convention.
 */
export function chordMayTypeText(chord: PaletteChord, platform: ChordPlatform): boolean {
  if (isFunctionKey(chord.code)) return false;
  if (chord.mod !== true) return true;
  return platform !== 'mac' && chord.alt === true;
}

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
  const reason = chordRejection(chord);
  return reason === null ? { ok: true, chord } : { ok: false, reason };
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
  const key = CHORD_KEY_LABELS[chord.code];
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
 * Describe an untrusted value for an error message without ever throwing
 * (circular structures, BigInts, hostile `toJSON`/`toString`).
 *
 * @param value Any value.
 */
function describeValue(value: unknown): string {
  try {
    // Typed `string`, but `undefined`, functions and symbols serialize to undefined.
    const json = JSON.stringify(value) as string | undefined;
    return json ?? String(value);
  } catch {
    // The value cannot be serialized; the message still names the refusal.
    return '[unserializable value]';
  }
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
    throw new Error(`[WPR FDT] Refused an invalid palette chord: ${describeValue(chord)}`);
  }
  await paletteChordStore.setValue(valid);
}

/**
 * Follow the binding: every write reaches the callback validated (corrupt
 * writes and removals as the default chord), so the listener re-arms on a
 * chord that passes every rule above. The same chord may arrive twice —
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
