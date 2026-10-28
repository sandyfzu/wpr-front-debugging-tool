/**
 * The palette chord's keyboard convention, kept apart from the chord module
 * so the surfaces that resolve it (the background, the options page) bundle
 * this mapping only, not the key tables and the store.
 *
 * Not `utils/platform.ts`: that is a synchronous `navigator` read for UI
 * code that must agree with a library's own platform check inside an event
 * handler. This convention comes from `runtime.getPlatformInfo` (async,
 * extension contexts only; content scripts ask the background), resolved
 * once per surface.
 */
import type { Logger } from '../logger';

/** The keyboard convention a chord is matched and written in. */
export type ChordPlatform = 'mac' | 'other';

/**
 * The keyboard convention of an OS name as `runtime.getPlatformInfo().os`
 * reports it (`mac`, `win`, `linux`, `cros`, `android`, `openbsd`,
 * `fuchsia`): only macOS uses Command as its command modifier.
 *
 * @param os The platform-info OS name.
 */
export function chordPlatformFromOs(os: string): ChordPlatform {
  return os === 'mac' ? 'mac' : 'other';
}

/** What {@link resolveChordPlatform} runs against (tests inject doubles). */
export interface ChordPlatformSource {
  /** Production: `browser.runtime.getPlatformInfo` (extension pages and the background only). */
  readonly getPlatformInfo: () => Promise<{ readonly os: string }>;
  /** Receives the degrade warning. */
  readonly log: Pick<Logger, 'warn'>;
  /**
   * The stand-in convention when platform info fails (a surface whose
   * listener must match ⌘ chords passes the navigator's); absent, `'other'`.
   */
  readonly fallback?: () => ChordPlatform;
}

/**
 * The source's stand-in convention, `'other'` when it has none or its read
 * throws (the resolver never rejects).
 *
 * @param source See {@link ChordPlatformSource}.
 */
function fallbackConvention(source: ChordPlatformSource): ChordPlatform {
  try {
    return source.fallback?.() ?? 'other';
  } catch (cause) {
    source.log.warn('Fallback keyboard convention unreadable — using the Ctrl convention', cause);
    return 'other';
  }
}

/**
 * Resolve the keyboard convention. Never rejects: a platform-info failure is
 * logged and resolves the source's fallback, else `'other'` — Ctrl-based
 * notation is the majority convention, and for a surface that only labels
 * the chord a wrong guess mislabels it, never breaks it.
 *
 * @param source See {@link ChordPlatformSource}.
 */
export async function resolveChordPlatform(source: ChordPlatformSource): Promise<ChordPlatform> {
  try {
    const info = await source.getPlatformInfo();
    return chordPlatformFromOs(info.os);
  } catch (cause) {
    const fallback = fallbackConvention(source);
    source.log.warn(
      `Platform info unavailable — using the ${fallback === 'mac' ? 'Command' : 'Ctrl'} convention`,
      cause
    );
    return fallback;
  }
}
