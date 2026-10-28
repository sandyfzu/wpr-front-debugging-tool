/**
 * The one way an on-page surface follows the on-page UI gate
 * (`sync:page-ui-gate`): the watch is armed before the boot read, so a
 * write landing while the read is in flight wins and the read's (older)
 * answer is dropped — no write is ever lost. Values reach the consumer
 * validated (missing or corrupt storage reads as the gate's default, on),
 * deduplicated (a same-value rewrite or a foreign write re-delivering the
 * current value applies nothing) and only while the context lives.
 *
 * A boot read that rejects is retried once, at once (no timer: a storage
 * read either answers or the context is dying); a second rejection leaves
 * the gate unknown — the consumer mounts nothing on a guess and follows the
 * gate's next write. An invalidated context (extension reload) stops the
 * watch and silences every late delivery.
 */
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
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

  /** Whether the read is moot: a write already decided, or the context died. */
  const readMoot = (): boolean => written || deps.isInvalid();

  /** One boot read; a rejection is retried once, then waits for a write. */
  const readOnce = (attempt: 1 | 2): void => {
    deps.source
      .read()
      .then((enabled) => {
        if (!written) deliver(enabled);
      })
      .catch((cause: unknown) => {
        if (readMoot()) return;
        if (attempt === 1) {
          readOnce(2);
          return;
        }
        log.warn('Reading the on-page UI gate failed twice — waiting for its next change', cause);
      });
  };
  readOnce(1);

  return { current: () => current };
}

/**
 * The follower deps of a content script: the real gate item, the context's
 * liveness and teardown, the module's logger — the one literal every gated
 * surface shares.
 *
 * @param ctx The content script's context.
 * @param log The surface's logger.
 * @returns Deps for {@link followPageUiGate} (and the gated-surface machine).
 */
export function pageUiGateDeps(
  ctx: Pick<ContentScriptContext, 'isInvalid' | 'onInvalidated'>,
  log: Pick<Logger, 'warn' | 'error'>
): PageUiGateFollowerDeps {
  return {
    source: PAGE_UI_GATE_SOURCE,
    isInvalid: () => ctx.isInvalid,
    onInvalidated: (cleanup) => {
      ctx.onInvalidated(cleanup);
    },
    log
  };
}

/** Why an instance ended on the gate (the abort reason). */
export const PAGE_UI_OFF_REASON = 'On-page UI turned off';

/**
 * Follow the gate for a surface instance that only lives while it is on
 * (an injected overlay): the first off value — the boot read or a write,
 * e.g. one racing the injection — ends it, once.
 *
 * @param deps The gate source and the host's lifecycle.
 * @param end Ends the instance (receives {@link PAGE_UI_OFF_REASON}).
 * @returns The follower.
 */
export function endWhenPageUiOff(
  deps: PageUiGateFollowerDeps,
  end: (reason: string) => void
): PageUiGateFollower {
  let ended = false;
  return followPageUiGate(deps, (enabled) => {
    if (enabled || ended) return;
    ended = true;
    end(PAGE_UI_OFF_REASON);
  });
}
