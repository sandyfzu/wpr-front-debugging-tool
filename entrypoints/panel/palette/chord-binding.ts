/**
 * The user's chosen palette chord, as the panel follows it: the stored chord
 * (watched first, then read — live on every rebinding) and the keyboard
 * convention from the runtime's platform report (the navigator's on
 * failure), exposed as one reactive binding the keyboard layer and the
 * shortcuts overlay read.
 */
import { createSignal, type Accessor } from 'solid-js';
import type { Logger } from '../../../lib/logger';
import {
  followPaletteChord,
  navigatorChordPlatform,
  type ChordSource
} from '../../../lib/palette-chord/follow';
import type { ChordBinding } from '../../../lib/palette-chord/keydown';
import {
  readPaletteChord,
  watchPaletteChord,
  type PaletteChord
} from '../../../lib/storage/palette-chord';
import {
  resolveChordPlatform,
  type ChordPlatform
} from '../../../lib/storage/palette-chord-platform';

/** The binding's seams (tests inject doubles; {@link realPanelChordDeps} in production). */
export interface PanelChordDeps extends ChordSource {
  /** The runtime's platform report (may reject). */
  getPlatformInfo(): Promise<{ readonly os: string }>;
  /** The navigator's convention: the stand-in when the report fails. */
  fallbackPlatform(): ChordPlatform;
  readonly log: Pick<Logger, 'warn'>;
}

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
  void resolveChordPlatform({
    getPlatformInfo: () => deps.getPlatformInfo(),
    fallback: () => deps.fallbackPlatform(),
    log: deps.log
  }).then((resolved) => {
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
 * The production seams: the validated chord store, the runtime's platform
 * report (extension pages may call it directly) and the navigator stand-in.
 *
 * @param log The panel's logger.
 */
export function realPanelChordDeps(log: Pick<Logger, 'warn'>): PanelChordDeps {
  return {
    readChord: readPaletteChord,
    watchChord: watchPaletteChord,
    getPlatformInfo: () => browser.runtime.getPlatformInfo(),
    fallbackPlatform: () => navigatorChordPlatform(navigator),
    log
  };
}
