/**
 * A focus move retried over a few frames, that never takes focus back from
 * someone else: a just-revealed panel can refuse focus for a frame, but if
 * another UI (or the page) claims focus meanwhile, the move is dropped.
 */

/** What a focus retry needs from the page, injected so it runs without a DOM. */
export interface FocusRetryDeps<T> {
  /** Run on the next frame. */
  readonly requestFrame: (run: () => void) => void;
  /**
   * Try the move once: `true` when focus took, `false` when it did not,
   * `undefined` when there is nothing to focus (gives up).
   */
  readonly attempt: () => boolean | undefined;
  /** The page's focused element right now (document level). */
  readonly active: () => T;
  /**
   * Whether `active` is unclaimed: nothing focused (`null`/body) or focus
   * already inside the UI making the move.
   */
  readonly isFree: (active: T) => boolean;
  /**
   * Whether `active` is held by another UI that must keep focus (e.g. a
   * palette that dismisses on outside focus): the move stops even when focus
   * sat there at call time.
   */
  readonly isClaimed: (active: T) => boolean;
}

/**
 * Attempts the move on each of the next `tries` frames until it takes.
 * Stops early once focus moved since the call to somewhere that is neither
 * free nor where it was then — someone else claimed it, and it stays there.
 * Focus where it already was at call time (e.g. a page control the move is
 * meant to take over) does not stop it — unless it is claimed (checked on
 * every frame, call-time focus included).
 *
 * @param deps - Frame scheduling, the attempt, and the focus probe.
 * @param tries - Frames to try on (≥ 1); the move is dropped after them.
 * @throws {@link RangeError} When `tries` is not a positive integer.
 */
export function retryFocus<T>(deps: FocusRetryDeps<T>, tries: number): void {
  if (!Number.isInteger(tries) || tries < 1)
    throw new RangeError(`retryFocus: tries must be a positive integer, got ${String(tries)}`);
  const before = deps.active();
  const step = (left: number): void => {
    deps.requestFrame(() => {
      const now = deps.active();
      if (deps.isClaimed(now) || (now !== before && !deps.isFree(now))) return;
      if (deps.attempt() === false && left > 1) step(left - 1);
    });
  };
  step(tries);
}

/**
 * What to do, one frame after a state change, about a focused overlay
 * control that may have been unmounted.
 *
 * - `reclaim` — the control is gone and focus fell to the page (nothing
 *   focused): land it back in the overlay.
 * - `forget` — focus sits somewhere else (another injected UI, a page
 *   control): the user moved on, so the lost control is no longer ours to
 *   repair, now or on any later change.
 * - `keep` — nothing to do yet (no control lost).
 */
export type LostFocusAction = 'reclaim' | 'forget' | 'keep';

/**
 * Decides {@link LostFocusAction}. Reads the DOCUMENT's focus, never the
 * overlay's own root: a shadow root answers `null` both when focus fell out
 * and when it moved into another shadow root (e.g. the detection strip), so
 * only the document tells "fell to the page" apart from "taken elsewhere".
 *
 * @param lost Whether the overlay's last focused control is disconnected.
 * @param active The document's focused element (`null`, `body` or the root
 *   element = nothing: a body-less document, e.g. XHTML or SVG, answers its
 *   root element when nothing is focused).
 * @param body The document's body (`null` when it has none).
 * @param root The document's root element.
 * @returns The action.
 */
export function lostFocusAction<T>(
  lost: boolean,
  active: T | null,
  body: T | null,
  root: T | null
): LostFocusAction {
  if (!lost) return 'keep';
  return active === null || active === body || active === root ? 'reclaim' : 'forget';
}
