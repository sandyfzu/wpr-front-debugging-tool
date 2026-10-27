/**
 * The palette chord's keyboard convention, kept apart from the chord module
 * so the background (which answers it) bundles this mapping only, not the
 * key tables and the store.
 */

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
