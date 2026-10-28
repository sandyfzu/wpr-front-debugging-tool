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
import {
  contextScheduler,
  WINDOW_TIMERS,
  type TimerContext,
  type TimerFunctions
} from '../../../utils/context-timers';

/**
 * The binding's seams: the chord store, the platform ask and the timers its
 * deadline runs on (tests inject doubles; {@link realPanelChordDeps} in
 * production). The ask's `schedule` is not a seam: the binding derives it
 * from `timers`, scoped to its own lifetime.
 */
export interface PanelChordDeps extends ChordSource, Omit<ChordPlatformAsk, 'schedule'> {
  /** The platform timers behind the ask's deadline (cleared on stop); the window's by default. */
  readonly timers?: TimerFunctions;
}

/** A {@link TimerContext} ended by hand: what the binding's timers die with. */
interface Lifetime extends TimerContext {
  /** Invalidate (idempotent): runs and drops every registered cleanup. */
  end(): void;
}

/**
 * Create a lifetime for the binding's timers, so `stop()` clears a still
 * armed deadline instead of leaving it to fire into a stopped binding.
 *
 * @param log Receives a failing cleanup (one never blocks the others).
 */
function createLifetime(log: Pick<Logger, 'warn'>): Lifetime {
  let valid = true;
  const cleanups = new Set<() => void>();
  return {
    get isValid() {
      return valid;
    },
    onInvalidated: (cleanup) => {
      cleanups.add(cleanup);
      return () => {
        cleanups.delete(cleanup);
      };
    },
    end: () => {
      if (!valid) return;
      valid = false;
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch (cause) {
          log.warn('Clearing a palette chord timer failed', cause);
        }
      }
      cleanups.clear();
    }
  };
}

/** The followed binding plus its teardown. */
export interface PanelChordBinding {
  /** The resolved binding, or null until both the chord and the convention are known. */
  readonly binding: Accessor<ChordBinding | null>;
  /** Stop following (idempotent): clears the ask's deadline; late answers are dropped. */
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
  const lifetime = createLifetime(deps.log);

  const unwatch = followPaletteChord(deps, (next) => {
    if (!stopped) setChord(next);
  });
  // The deadline dies with the binding: stop clears it rather than letting it fire.
  const schedule = contextScheduler(lifetime, deps.timers ?? WINDOW_TIMERS);
  void askChordPlatform({ ...deps, schedule }).then((resolved) => {
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
      lifetime.end();
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
 * have in every browser) and the navigator stand-in; the deadline runs on
 * the window's timers.
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
