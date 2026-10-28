/**
 * The user's chosen palette chord, as the panel follows it: the stored chord
 * (watched first, then read — live on every rebinding) and the keyboard
 * convention, exposed as one reactive binding the keyboard layer and the
 * shortcuts overlay read.
 *
 * The convention comes from the background (the page trigger's bounded ask;
 * the navigator's convention when unanswered), never from
 * `runtime.getPlatformInfo` here: Firefox gives DevTools pages only the
 * content-script API set plus `devtools.*`, so the panel cannot call it
 * there. One path for every browser — the answer is the same one.
 */
import { createSignal, type Accessor } from 'solid-js';
import type { Logger } from '../../../lib/logger';
import { sendMessage } from '../../../lib/messaging';
import {
  followPaletteChord,
  navigatorChordPlatform,
  type ChordSource
} from '../../../lib/palette-chord/follow';
import { askChordPlatform, type ChordPlatformAsk } from '../../../lib/palette-chord/platform-ask';
import type { ChordBinding } from '../../../lib/palette-chord/keydown';
import {
  readPaletteChord,
  watchPaletteChord,
  type PaletteChord
} from '../../../lib/storage/palette-chord';
import type { ChordPlatform } from '../../../lib/storage/palette-chord-platform';

/**
 * The binding's seams: the chord store and the platform ask (tests inject
 * doubles; {@link realPanelChordDeps} in production).
 */
export interface PanelChordDeps extends ChordSource, ChordPlatformAsk {}

/** The followed binding plus its teardown. */
export interface PanelChordBinding {
  /** The resolved binding, or null until both the chord and the convention are known. */
  readonly binding: Accessor<ChordBinding | null>;
  /** Stop following (idempotent); late answers are dropped. */
  stop(): void;
}

/**
 * Start following the chosen chord. Until both halves resolve the binding
 * is null (the chosen chord matches nothing; the fixed chord still works).
 *
 * @param deps See {@link PanelChordDeps}.
 */
export function createPanelChordBinding(deps: PanelChordDeps): PanelChordBinding {
  const [chord, setChord] = createSignal<PaletteChord | null>(null);
  const [platform, setPlatform] = createSignal<ChordPlatform | null>(null);
  let stopped = false;

  const unwatch = followPaletteChord(deps, (next) => {
    if (!stopped) setChord(next);
  });
  void askChordPlatform(deps).then((resolved) => {
    if (!stopped) setPlatform(resolved);
  });

  return {
    binding: () => {
      const currentChord = chord();
      const currentPlatform = platform();
      return currentChord === null || currentPlatform === null
        ? null
        : { chord: currentChord, platform: currentPlatform };
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      try {
        unwatch();
      } catch (cause) {
        deps.log.warn('Unwatching the palette chord failed', cause);
      }
    }
  };
}

/**
 * The production seams: the validated chord store, the background's
 * `getChordPlatform` answer (`runtime.sendMessage`, which DevTools pages
 * have in every browser) and the navigator stand-in.
 *
 * @param log The panel's logger.
 */
export function realPanelChordDeps(log: Pick<Logger, 'warn'>): PanelChordDeps {
  return {
    readChord: readPaletteChord,
    watchChord: watchPaletteChord,
    askPlatform: () => sendMessage('getChordPlatform'),
    fallbackPlatform: () => navigatorChordPlatform(navigator),
    log
  };
}
