/**
 * The palette chord's keydown decision, shared by every surface that listens
 * for the user's chosen chord (the page trigger, the DevTools panel): one
 * rule for what fires, and one read of whether a keystroke is headed for a
 * field that takes typed text.
 */
import {
  chordMayTypeText,
  matchesChord,
  type ChordKeystroke,
  type PaletteChord
} from '../storage/palette-chord';
import type { ChordPlatform } from '../storage/palette-chord-platform';

/** A resolved binding: what fires, in which keyboard convention. */
export interface ChordBinding {
  readonly chord: PaletteChord;
  readonly platform: ChordPlatform;
}

/** The keydown fields the decision reads (a `KeyboardEvent` satisfies it). */
export interface ChordKeydownFacts extends ChordKeystroke {
  /** False for script-dispatched events: a page can never fake the chord. */
  readonly isTrusted: boolean;
  /** Set when an earlier listener already handled the keystroke. */
  readonly defaultPrevented: boolean;
}

/** What the listener does with one keydown. */
export type ChordKeydownAction = 'open' | 'pass';

/**
 * Decide one keydown: open only for a trusted, not yet handled keystroke
 * that matches the binding exactly (repeats, IME and AltGr input never
 * match) — and, for a chord that may type a character, only outside an
 * editable field, where the keystroke types as usual.
 *
 * @param event The keydown.
 * @param binding The resolved binding.
 * @param inEditable Whether the event's target is editable (asked only when
 *   it decides the outcome — reading the event path is the costly part).
 * @returns `open` to consume the keystroke and open the palette, else `pass`.
 */
export function chordKeydownAction(
  event: ChordKeydownFacts,
  binding: ChordBinding,
  inEditable: () => boolean
): ChordKeydownAction {
  if (!event.isTrusted || event.defaultPrevented) return 'pass';
  if (!matchesChord(event, binding.chord, binding.platform)) return 'pass';
  if (chordMayTypeText(binding.chord, binding.platform) && inEditable()) return 'pass';
  return 'open';
}

/** `<input>` types that never take typed text (everything else does, `text` by default). */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit'
]);

/** The element fields {@link takesTypedText} reads (an `Element` satisfies it). */
interface EditableFacts {
  readonly nodeType: number;
  readonly localName?: string;
  readonly type?: unknown;
  readonly isContentEditable?: boolean;
  readonly ownerDocument?: { readonly designMode?: string } | null;
}

/**
 * Whether a keydown's target takes typed text: the deepest element on its
 * composed path (inside open shadow roots too) is a `<textarea>`, a text-like
 * `<input>` or editable content (`contenteditable`, inherited by descendants,
 * or a whole `designMode` document — read directly, since engines disagree
 * on `isContentEditable` there).
 *
 * @param path The event's `composedPath()` (deepest target first).
 */
export function takesTypedText(path: readonly EventTarget[]): boolean {
  const target = path.find(
    (entry): entry is EventTarget & EditableFacts =>
      (entry as Partial<EditableFacts>).nodeType === Node.ELEMENT_NODE
  );
  if (target === undefined) return false;
  if (target.isContentEditable === true || target.localName === 'textarea') return true;
  if (target.ownerDocument?.designMode === 'on') return true;
  if (target.localName !== 'input') return false;
  const type = typeof target.type === 'string' ? target.type.toLowerCase() : 'text';
  return !NON_TEXT_INPUT_TYPES.has(type);
}
