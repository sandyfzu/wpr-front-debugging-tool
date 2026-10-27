/**
 * The palette chord's keyboard convention, kept apart from the chord module
 * so the surfaces that resolve it (the background, the options page) bundle
 * this mapping only, not the key tables and the store.
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
}

/**
 * Resolve the keyboard convention. Never rejects: a platform-info failure is
 * logged and resolves `'other'` — Ctrl-based notation is the majority
 * convention, and a wrong guess only mislabels the chord, never breaks a
 * surface.
 *
 * @param source See {@link ChordPlatformSource}.
 */
export async function resolveChordPlatform(source: ChordPlatformSource): Promise<ChordPlatform> {
  try {
    const info = await source.getPlatformInfo();
    return chordPlatformFromOs(info.os);
  } catch (cause) {
    source.log.warn('Platform info unavailable — using the Ctrl convention', cause);
    return 'other';
  }
}
