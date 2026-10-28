/**
 * The background's answer to `getChordPlatform`: the keyboard convention
 * content scripts and the DevTools panel need for the palette chord, read
 * from `runtime.getPlatformInfo` (an API content scripts never reach, nor
 * Firefox's DevTools pages). No sender guard: the panel asks tab-less.
 */
import { createLogger } from '../../lib/logger';
import { onMessage } from '../../lib/messaging';
import {
  resolveChordPlatform,
  type ChordPlatform,
  type ChordPlatformSource
} from '../../lib/storage/palette-chord-platform';

const log = createLogger('chord-platform');

/** What the answer runs against (tests inject doubles). */
export type ChordPlatformDeps = ChordPlatformSource;

/**
 * Resolve the keyboard convention for the asking surface (a content script
 * or the DevTools panel). Never rejects: a platform-info failure is logged
 * and answers `'other'` (see {@link resolveChordPlatform}).
 *
 * @param deps See {@link ChordPlatformSource}.
 */
export function answerChordPlatform(deps: ChordPlatformDeps): Promise<ChordPlatform> {
  return resolveChordPlatform(deps);
}

/** Register the channel (once per background start). */
export function registerChordPlatform(): void {
  const deps: ChordPlatformDeps = {
    getPlatformInfo: () => browser.runtime.getPlatformInfo(),
    log
  };
  onMessage('getChordPlatform', () => answerChordPlatform(deps));
}
