/**
 * The background's answer to `getChordPlatform`: the keyboard convention
 * content scripts need for the palette chord, read from
 * `runtime.getPlatformInfo` (an API content scripts cannot reach).
 */
import { createLogger, type Logger } from '../../lib/logger';
import { onMessage } from '../../lib/messaging';
import { chordPlatformFromOs, type ChordPlatform } from '../../lib/storage/palette-chord-platform';

const log = createLogger('chord-platform');

/** What the answer runs against (tests inject doubles). */
export interface ChordPlatformDeps {
  /** Production: `browser.runtime.getPlatformInfo`. */
  readonly getPlatformInfo: () => Promise<{ readonly os: string }>;
  readonly log: Logger;
}

/**
 * Resolve the keyboard convention. Never rejects: a platform-info failure
 * is logged and answers `'other'` — Ctrl-based notation is the majority
 * convention, and a wrong guess only mislabels the chord, never breaks
 * the page.
 *
 * @param deps See {@link ChordPlatformDeps}.
 */
export async function answerChordPlatform(deps: ChordPlatformDeps): Promise<ChordPlatform> {
  try {
    const info = await deps.getPlatformInfo();
    return chordPlatformFromOs(info.os);
  } catch (cause) {
    deps.log.warn('Platform info unavailable — answering the Ctrl convention', cause);
    return 'other';
  }
}

/** Register the channel (once per background start). */
export function registerChordPlatform(): void {
  const deps: ChordPlatformDeps = {
    getPlatformInfo: () => browser.runtime.getPlatformInfo(),
    log
  };
  onMessage('getChordPlatform', () => answerChordPlatform(deps));
}
