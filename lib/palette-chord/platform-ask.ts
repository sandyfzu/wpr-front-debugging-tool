/**
 * The keyboard convention as a listening surface learns it: a bounded ask to
 * the background (the one context that can always call
 * `runtime.getPlatformInfo` — content scripts never can, and Firefox's
 * DevTools pages get only the content-script API set plus `devtools.*`),
 * with the navigator's convention standing in when the ask goes unanswered.
 * Shared by the page trigger and the DevTools panel, so both resolve it by
 * the same rules.
 */
import type { Logger } from '../logger';
import { boundedAsk, type AskOutcome, type ScheduleTimer } from '../messaging/bounded-ask';
import type { ChordPlatform } from '../storage/palette-chord-platform';

/**
 * How long the platform ask may stay unanswered before the navigator's
 * platform stands in. The background answers from one local API call; a
 * service worker cold start stays well inside this, and a later answer is
 * dropped (the stand-in agrees with it unless the browser masks its
 * navigator platform).
 */
export const PLATFORM_ASK_TIMEOUT_MS = 2_000;

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

/** What {@link askChordPlatform} runs against (each surface binds its own). */
export interface ChordPlatformAsk {
  /** Ask the background for the keyboard convention (raw reply; may reject or throw). */
  askPlatform(): Promise<unknown>;
  /** The navigator's convention: the stand-in when the ask goes unanswered. */
  fallbackPlatform(): ChordPlatform;
  /** The ask's deadline timer (a surface with a lifetime passes one that dies with it). */
  readonly schedule?: ScheduleTimer;
  /** Receives the degrade warnings. */
  readonly log: Pick<Logger, 'warn'>;
}

/**
 * The answer, or the navigator's stand-in when the ask went unanswered (no
 * receiver, a failed send, the deadline) — never a fixed guess, which would
 * kill a macOS ⌘ chord for the surface's lifetime.
 *
 * @param source See {@link ChordPlatformAsk}.
 * @param outcome The bounded ask's outcome.
 */
function platformFromOutcome(
  source: ChordPlatformAsk,
  outcome: AskOutcome<ChordPlatform>
): ChordPlatform {
  if (outcome.kind === 'reply') return outcome.reply;
  const fallback = source.fallbackPlatform();
  source.log.warn(
    `Keyboard convention unanswered — using the navigator's (${fallback})`,
    outcome.kind === 'failed' ? outcome.cause : outcome.kind
  );
  return fallback;
}

/**
 * Resolve the keyboard convention through the background. Never rejects: an
 * unanswered ask resolves the navigator's convention, and a broken seam (a
 * throwing stand-in) the majority Ctrl convention.
 *
 * @param source See {@link ChordPlatformAsk}.
 */
export async function askChordPlatform(source: ChordPlatformAsk): Promise<ChordPlatform> {
  try {
    return platformFromOutcome(
      source,
      await boundedAsk({
        send: () => source.askPlatform(),
        parse: narrowChordPlatform,
        timeoutMs: PLATFORM_ASK_TIMEOUT_MS,
        schedule: source.schedule
      })
    );
  } catch (cause) {
    source.log.warn('Keyboard convention unresolved — using the Ctrl convention', cause);
    return 'other';
  }
}
