/**
 * The palette's keyboard chord on the page: a window-capture `keydown`
 * listener (top frame, wired by the palette module) that opens the palette
 * on exactly the bound chord and leaves every other keystroke to the page.
 *
 * Decisions are pure (the shared keydown decision and typed-text read, and
 * {@link narrowChordPlatform}); {@link startChordTrigger} binds them to the
 * page and the extension:
 * - the binding (the stored chord + the keyboard convention) resolves on the
 *   first arm — the chord's watch-first read and the background's platform
 *   answer (bounded; unanswered, the navigator's platform stands in) — and
 *   follows chord writes live (no reload); until both are known no
 *   keystroke matches;
 * - the listener exists only while armed (the module arms it with the
 *   `openCommandPalette` receiver while the on-page UI gate is on) and is
 *   removed on disarm (gate off) and with the content script's context;
 * - a match is consumed (`preventDefault` + `stopImmediatePropagation`, so no
 *   page listener after ours acts on it) — only while the context lives: an
 *   orphaned script (the extension reloaded under an open tab) lets the
 *   keystroke through and removes its listener; anything else passes
 *   untouched.
 *
 * Known limits: page listeners registered on the window's capture phase
 * before the arm see the chord first (the arm waits for the gate read); keys
 * typed inside this extension's guarded text surfaces never reach the window
 * (the key guard keeps them there), so the chord is inert in them; an
 * editable field inside a closed shadow root is invisible to the event path,
 * so a may-type chord pressed there opens the palette instead of typing.
 */
import type { Logger } from '../../../lib/logger';
import {
  boundedAsk,
  type AskOutcome,
  type ScheduleTimer
} from '../../../lib/messaging/bounded-ask';
import { followPaletteChord } from '../../../lib/palette-chord/follow';
import {
  chordKeydownAction,
  takesTypedText,
  type ChordBinding
} from '../../../lib/palette-chord/keydown';
import { formatChord, type PaletteChord } from '../../../lib/storage/palette-chord';
import type { ChordPlatform } from '../../../lib/storage/palette-chord-platform';

/**
 * Narrow the background's platform answer at the boundary (two bundles meet
 * there, and a missing receiver answers nothing typed): only an explicit
 * `'mac'` is macOS.
 *
 * @param reply The raw reply.
 */
export function narrowChordPlatform(reply: unknown): ChordPlatform {
  return reply === 'mac' ? 'mac' : 'other';
}

/**
 * How long the platform ask may stay unanswered before the navigator's
 * platform stands in. The background answers from one local API call; a
 * service worker cold start stays well inside this, and a later answer is
 * dropped (the stand-in agrees with it unless the browser masks its
 * navigator platform).
 */
export const PLATFORM_ASK_TIMEOUT_MS = 2_000;

/** The trigger's seams (the palette module's wiring binds the real ones). */
export interface ChordTriggerDeps {
  /** Where the capture listener goes (the top frame's window). */
  readonly target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  /**
   * Whether the content script's context still lives, read before a match is
   * consumed (reading it also runs the invalidation cleanup on a dead one).
   */
  isLive(): boolean;
  /** Read the validated chord (rejects on a dead context). */
  readChord(): Promise<PaletteChord>;
  /** Follow validated chord writes; returns the unwatch. */
  watchChord(onChange: (chord: PaletteChord) => void): () => void;
  /** Ask the background for the keyboard convention (raw reply; may reject). */
  askPlatform(): Promise<unknown>;
  /** The navigator's convention: the stand-in when the ask goes unanswered. */
  fallbackPlatform(): ChordPlatform;
  /** The ask's deadline timer (cleared with the context). */
  readonly schedule: ScheduleTimer;
  /** Run cleanup when the context dies. */
  onInvalidated(cleanup: () => void): void;
  readonly log: Logger;
}

/** The chord trigger the palette module arms. */
export interface ChordTrigger {
  /**
   * Listen for the chord (idempotent while armed); the first arm resolves
   * the binding.
   *
   * @param onChord Called once per matched keystroke.
   * @returns The disarm (removes the listener; idempotent).
   */
  arm(onChord: () => void): () => void;
  /** The active chord in the platform's notation, or null until resolved. */
  hint(): string | null;
  /** The resolved binding, or null until both halves are known (tests, hint). */
  binding(): ChordBinding | null;
}

/**
 * Create the trigger (inert until its first arm).
 *
 * @param deps See {@link ChordTriggerDeps}.
 */
export function startChordTrigger(deps: ChordTriggerDeps): ChordTrigger {
  const { log } = deps;
  let chord: PaletteChord | null = null;
  let platform: ChordPlatform | null = null;
  let resolving = false;
  let dead = false;
  let onChord: (() => void) | null = null;
  let unwatch: (() => void) | null = null;

  const binding = (): ChordBinding | null =>
    chord === null || platform === null ? null : { chord, platform };

  const onKeyDown = (event: Event): void => {
    const current = binding();
    const fire = onChord;
    if (current === null || fire === null) return;
    try {
      const keydown = event as KeyboardEvent;
      const action = chordKeydownAction(keydown, current, () =>
        takesTypedText(keydown.composedPath())
      );
      if (action !== 'open') return;
      // An orphaned script must not take the page's keystroke for nothing.
      if (!deps.isLive()) {
        disarm();
        return;
      }
      keydown.preventDefault();
      keydown.stopImmediatePropagation();
      fire();
    } catch (cause) {
      // Never into the page: the keystroke goes on as if we were not here.
      log.warn('Handling a keystroke for the palette chord failed', cause);
    }
  };

  /** Follow the chord (watch first, then read) and ask for the convention. */
  const resolve = (): void => {
    if (resolving) return;
    resolving = true;
    unwatch = followPaletteChord(deps, (next) => {
      chord = next;
    });
    void (async (): Promise<void> => {
      try {
        platform = platformFromOutcome(
          await boundedAsk({
            send: () => deps.askPlatform(),
            parse: narrowChordPlatform,
            timeoutMs: PLATFORM_ASK_TIMEOUT_MS,
            schedule: deps.schedule
          })
        );
      } catch (cause) {
        // A broken seam (the ask never rejects): the majority convention.
        log.warn('Keyboard convention unresolved — using the Ctrl convention', cause);
        platform = 'other';
      }
    })();
  };

  /**
   * The ask's answer, or the navigator's stand-in when it went unanswered
   * (no receiver, a failed send, the deadline) — never a fixed guess, which
   * would kill a macOS ⌘ chord for the page's lifetime.
   */
  const platformFromOutcome = (outcome: AskOutcome<ChordPlatform>): ChordPlatform => {
    if (outcome.kind === 'reply') return outcome.reply;
    const fallback = deps.fallbackPlatform();
    log.warn(
      `Keyboard convention unanswered — using the navigator's (${fallback})`,
      outcome.kind === 'failed' ? outcome.cause : outcome.kind
    );
    return fallback;
  };

  const disarm = (): void => {
    if (onChord === null) return;
    onChord = null;
    deps.target.removeEventListener('keydown', onKeyDown, true);
  };

  deps.onInvalidated(() => {
    dead = true;
    disarm();
    const stop = unwatch;
    unwatch = null;
    try {
      stop?.();
    } catch (cause) {
      log.debug('Unwatching the palette chord failed', cause);
    }
  });

  return {
    arm(next: () => void): () => void {
      if (dead) return () => undefined;
      resolve();
      if (onChord === null) deps.target.addEventListener('keydown', onKeyDown, true);
      onChord = next;
      return () => {
        if (onChord === next) disarm();
      };
    },
    hint(): string | null {
      const current = binding();
      return current === null ? null : formatChord(current.chord, current.platform);
    },
    binding
  };
}
