/**
 * Layout-true key legends for the shortcut field: the Keyboard Map API
 * (`navigator.keyboard.getLayoutMap()`, Chromium) names what a physical key
 * types on the active layout — `KeyQ` reads "A" on AZERTY — where the chord
 * tables only know the US legend. Feature-detected; every miss (no API,
 * a rejected read, an unusable legend) falls back to the US legend.
 */
import type { Logger } from '../logger';
import { CHORD_KEY_LABELS, type ChordKeyCode } from '../storage/palette-chord';

/** The read side of a `KeyboardLayoutMap` (not in the TypeScript DOM lib). */
export interface KeyLayoutLookup {
  /** The character a `KeyboardEvent.code` types on the active layout, when known. */
  get(code: string): string | undefined;
}

/** The slice of `navigator` the probe reads (structural: absent members feature-detect). */
export interface KeyboardNavigator {
  readonly keyboard?: { readonly getLayoutMap?: () => Promise<KeyLayoutLookup> };
}

/**
 * Read the active layout's map.
 *
 * @param nav The navigator to probe (the page's `navigator`).
 * @param log Receives the degrade note when the read rejects.
 * @returns The map, or null when the API is absent or the read rejected
 *   (permission policy, a non-top-level document) — callers use the US legends.
 */
export async function readKeyboardLayout(
  nav: KeyboardNavigator,
  log: Pick<Logger, 'debug'>
): Promise<KeyLayoutLookup | null> {
  const getLayoutMap = nav.keyboard?.getLayoutMap;
  if (typeof getLayoutMap !== 'function') return null;
  try {
    return await getLayoutMap.call(nav.keyboard);
  } catch (cause) {
    log.debug('Keyboard layout map unavailable — showing US key legends', cause);
    return null;
  }
}

/** Exactly one code point that is neither whitespace, a control/format character nor a combining mark. */
const VISIBLE_CHARACTER = /^[^\s\p{C}\p{M}]$/u;

/**
 * The legend to show for a key: the layout's own character, upper-cased
 * like a keycap, when it is one visible character; the US legend otherwise
 * (keys the map does not name — function keys —, whitespace, combining or
 * control characters, multi-character values, no map).
 *
 * @param code A bindable key.
 * @param layout The active layout's map, or null.
 */
export function keyLegend(code: ChordKeyCode, layout: KeyLayoutLookup | null): string {
  const fallback = CHORD_KEY_LABELS[code];
  const typed = layout?.get(code);
  if (typed === undefined || !VISIBLE_CHARACTER.test(typed)) return fallback;
  // Keycap style; a case mapping that grows the string (ß → SS) keeps the character.
  const upper = typed.toLocaleUpperCase();
  return VISIBLE_CHARACTER.test(upper) ? upper : typed;
}
