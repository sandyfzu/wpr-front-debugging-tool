/**
 * The one way an on-page surface follows the on-page UI gate
 * (`sync:page-ui-gate`): the watch is armed before the boot read, so a
 * write landing while the read is in flight wins and the read's (older)
 * answer is dropped — no write is ever lost. Values reach the consumer
 * validated (missing or corrupt storage reads as the gate's default, on),
 * deduplicated (a same-value rewrite or a foreign write re-delivering the
 * current value applies nothing) and only while the context lives.
 *
 * A boot read that rejects leaves the gate unknown: the consumer mounts
 * nothing on a guess and follows the gate's next write. An invalidated
 * context (extension reload) stops the watch and silences every late
 * delivery.
 */
import type { Logger } from '../logger';
import { readPageUiEnabled, watchPageUiGate } from '../storage/page-ui-gate';

/** Where the gate's values come from (validated by the source). */
export interface PageUiGateSource {
  /** Follow every write; returns the unwatch. */
  watch(onChange: (enabled: boolean) => void): () => void;
  /** Read the gate once; rejects as the platform does (e.g. a dead context). */
  read(): Promise<boolean>;
}

/** The real gate item's validated watch and read. */
export const PAGE_UI_GATE_SOURCE: PageUiGateSource = {
  watch: watchPageUiGate,
  read: readPageUiEnabled
};

/** What following the gate needs from its host (a content script's context). */
export interface PageUiGateFollowerDeps {
  readonly source: PageUiGateSource;
  /** Whether the host's context is dead (late deliveries are dropped). */
  isInvalid(): boolean;
  /** Run cleanup once the host's context dies. */
  onInvalidated(cleanup: () => void): void;
  readonly log: Pick<Logger, 'warn' | 'error'>;
}

/** A running follower. */
export interface PageUiGateFollower {
  /** The last applied value; null while the gate is still unknown. */
  current(): boolean | null;
}

/**
 * Follow the gate: arm the watch, then read once.
 *
 * @param deps The source and the host's lifecycle.
 * @param apply Receives each changed value (the first known value included);
 *   a throw is logged, never propagated into the storage listener.
 * @returns The follower.
 */
export function followPageUiGate(
  deps: PageUiGateFollowerDeps,
  apply: (enabled: boolean) => void
): PageUiGateFollower {
  const { log } = deps;
  let current: boolean | null = null;
  /** Whether a write was delivered (the boot read is then stale). */
  let written = false;

  const deliver = (enabled: boolean): void => {
    if (deps.isInvalid() || enabled === current) return;
    current = enabled;
    try {
      apply(enabled);
    } catch (cause) {
      log.error('Applying the on-page UI gate failed', cause);
    }
  };

  let unwatch: (() => void) | null = null;
  try {
    unwatch = deps.source.watch((enabled) => {
      written = true;
      deliver(enabled);
    });
  } catch (cause) {
    // The boot read still decides this page; only live changes are lost.
    log.error('Watching the on-page UI gate failed', cause);
  }
  deps.onInvalidated(() => {
    try {
      unwatch?.();
    } catch (cause) {
      log.warn('Stopping the on-page UI gate watch failed during teardown', cause);
    }
    unwatch = null;
  });

  deps.source
    .read()
    .then((enabled) => {
      if (!written) deliver(enabled);
    })
    .catch((cause: unknown) => {
      if (deps.isInvalid()) return;
      log.warn('Reading the on-page UI gate failed — waiting for its next change', cause);
    });

  return { current: () => current };
}
