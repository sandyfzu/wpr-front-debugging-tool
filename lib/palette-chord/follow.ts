/**
 * How a listening surface learns the user's chosen chord and the keyboard
 * convention, shared by the page trigger and the DevTools panel so both
 * resolve the binding by the same rules.
 */
import { isMacPlatform, type PlatformFacts } from '../../utils/platform';
import { DEFAULT_PALETTE_CHORD, type PaletteChord } from '../storage/palette-chord';
import type { ChordPlatform } from '../storage/palette-chord-platform';
import type { Logger } from '../logger';

/** The chord store seams (production: `readPaletteChord` / `watchPaletteChord`). */
export interface ChordSource {
  /** Read the validated chord (may reject). */
  readChord(): Promise<PaletteChord>;
  /** Follow validated chord writes; returns the unwatch. */
  watchChord(onChange: (chord: PaletteChord) => void): () => void;
  readonly log: Pick<Logger, 'warn'>;
}

/**
 * Follow the chosen chord: watch first, so a write landing during the read
 * wins over the read's older value; then read. A failed read applies the
 * default chord (unless a write already arrived); a failed watch is logged —
 * the read still applies, a later rebinding waits for a reload.
 *
 * @param source See {@link ChordSource}.
 * @param apply Receives each validated chord (the read's, then every write's).
 * @returns The unwatch (a no-op when the watch failed).
 */
export function followPaletteChord(
  source: ChordSource,
  apply: (chord: PaletteChord) => void
): () => void {
  // An object, so the read's closure sees the watch's write.
  const watch = { delivered: false };
  let unwatch: () => void = () => undefined;
  try {
    unwatch = source.watchChord((next) => {
      watch.delivered = true;
      apply(next);
    });
  } catch (cause) {
    source.log.warn('Palette chord unwatched — a rebinding applies after a reload', cause);
  }
  // Async body: a seam throwing synchronously lands in the same catch.
  void (async (): Promise<void> => {
    try {
      const read = await source.readChord();
      if (!watch.delivered) apply(read);
    } catch (cause) {
      source.log.warn('Palette chord unread — using the default', cause);
      if (!watch.delivered) apply(DEFAULT_PALETTE_CHORD);
    }
  })();
  return unwatch;
}

/**
 * The navigator's keyboard convention: the synchronous stand-in a surface
 * uses when the extension's own platform report is unavailable — never a
 * fixed guess, which would kill a macOS ⌘ chord.
 *
 * @param facts The navigator (or a test double).
 */
export function navigatorChordPlatform(facts: PlatformFacts): ChordPlatform {
  return isMacPlatform(facts) ? 'mac' : 'other';
}
