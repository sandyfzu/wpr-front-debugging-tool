/**
 * The compare overlay's scroll-sync engine, pure and DOM-free.
 *
 * Two layers live here, both unit-tested:
 * - the mapping: one half's position becomes a position on the other half's
 *   own range. Proportional by design, because the halves regularly differ
 *   in height (a cached page vs its `?nowprocket=1` twin; device variants
 *   diverge more) — the source's progress through its own range (a 0–1
 *   ratio) is what transfers, not the absolute offset;
 * - the driver: the burst state machine that turns scroll notifications into
 *   mapped applications without a feedback loop. The DOM halves and their
 *   listeners are the entrypoint's adapters (they never hold judgment);
 *   the driver only coordinates reads, applications and suppression.
 */

/** One half of the compare overlay: the cached page or the cache-bypassed one. */
export type CompareSide = 'cached' | 'bypassed';

/** Both sides, in the overlay's visual order (left, then right). */
export const COMPARE_SIDES: readonly CompareSide[] = ['cached', 'bypassed'];

/**
 * The side opposite `side` — the overlay has exactly two halves, so the
 * pairing is fixed and total.
 *
 * @param side The side to complement.
 */
export function otherSide(side: CompareSide): CompareSide {
  return side === 'cached' ? 'bypassed' : 'cached';
}

/** One half's scroll facts: a position within its own scrollable range. */
export interface FrameScrollState {
  /** The document's current scroll offset (the scrolling element's scrollTop). */
  y: number;
  /** The scrollable range, `scrollHeight − clientHeight` (0 = unscrollable). */
  range: number;
}

/**
 * Refuse a broken read per the fail-fast rule: finite numbers, non-negative,
 * and `y` within the range. These shapes are impossible for a coherent DOM
 * read — a document navigating between two property reads produces exactly
 * them — so a caller that receives one must not drive from it.
 *
 * @param state The read to check.
 * @param which Which half produced it, for the error message.
 * @throws {@link Error} naming the offending half, field and value.
 */
function assertScrollState(state: FrameScrollState, which: string): void {
  for (const field of ['y', 'range'] as const) {
    const value = state[field];
    if (!Number.isFinite(value)) {
      throw new Error(`Scroll-sync ${which}.${field} is not a finite number: ${String(value)}`);
    }
  }
  if (state.range < 0) {
    throw new Error(`Scroll-sync ${which}.range is negative: ${String(state.range)}`);
  }
  if (state.y < 0 || state.y > state.range) {
    throw new Error(
      `Scroll-sync ${which}.y is outside its own range: ${String(state.y)} / ${String(state.range)}`
    );
  }
}

/**
 * Map `source`'s position onto `target`'s own range: clamp the rounded
 * `ratio × range` product into the target's bounds.
 *
 * Zero-range halves branch, never drive: an unscrollable source carries no
 * meaningful progress (null), and an unscrollable target has no position to
 * apply (null). Broken reads throw — they cannot come from a coherent read,
 * so the input is treated as the bug it is.
 *
 * @param source The half the user scrolled.
 * @param target The half to reposition.
 * @returns The target's scroll offset, or null when nothing can be applied.
 * @throws {@link Error} when a state violates the read contract.
 */
export function computeSyncTarget(
  source: FrameScrollState,
  target: FrameScrollState
): number | null {
  assertScrollState(source, 'source');
  assertScrollState(target, 'target');
  if (source.range === 0 || target.range === 0) return null;
  const ratio = source.y / source.range;
  return Math.min(Math.max(Math.round(ratio * target.range), 0), target.range);
}

/**
 * One comparison half as the driver sees it. The port contract: never
 * throws — expected page states (a cross-origin document, a torn read, an
 * absent window) come back as `null` reads, and the driver branches on
 * them; anything escaping would be adapter's own bug, surfaced by the
 * content script's global error handlers.
 */
export interface ScrollSyncHalf {
  /** The half's scroll facts right now, or null when unreadable. */
  read(): FrameScrollState | null;
  /** Apply a mapped position — instantly, never a smooth glide (a glide would re-enter the driver through its own suppression window). */
  apply(y: number): void;
}

/**
 * The asynchronous steps the driver needs, injected so tests run the queue
 * by hand; the entrypoint binds the host page's animation frames.
 */
export interface ScrollSyncClock {
  /** Schedule `callback` on the next animation frame. */
  nextFrame(callback: () => void): void;
}

export interface ScrollSyncDriver {
  /**
   * A user-driven scroll on `side`. Bursts coalesce per animation frame (the
   * newest side wins) and the receiving half's programmatic echoes are
   * ignored until the suppression window closes — the next scroll after it
   * retakes driver control.
   *
   * @param side The half the user scrolled.
   */
  onScroll(side: CompareSide): void;
  /** Stop the driver: pending scheduled steps become no-ops, suppression resets. */
  dispose(): void;
}

/**
 * Create the burst driver over the two halves.
 *
 * Semantics (each pinned by tests):
 * - one burst per animation frame at most; the last scroll's side drives it;
 * - a burst reads both halves fresh (never cached metrics — per-side
 *   refreshes are absorbed for free), maps, applies once to the opposite
 *   half, then opens a suppression window on it;
 * - the window spans two animation frames (an echo's scroll steps run
 *   before the next frame's callbacks; the second covers engine variance)
 *   and only the newest application's clear wins, so continuous driving
 *   keeps the window open and a fresh user scroll after the burst takes over.
 *
 * @param halves The two halves, keyed by side.
 * @param clock The injected frame scheduler.
 */
export function createScrollSyncDriver(
  halves: Readonly<Record<CompareSide, ScrollSyncHalf>>,
  clock: ScrollSyncClock
): ScrollSyncDriver {
  let disposed = false;
  /** The side whose scroll the owed burst mirrors; null when no burst is owed. */
  let pendingSide: CompareSide | null = null;
  /** A burst callback is sitting in the clock's queue. */
  let burstQueued = false;
  /** Per-side echo suppression; the receiving half's own scroll is noise for the window's span. */
  const suppressed: Record<CompareSide, boolean> = { cached: false, bypassed: false };
  /** Monotonic application token: only the newest clear closes the window it opened. */
  let appliedEpoch = 0;

  /** One coalesced burst: read fresh, map, apply to the opposite half, suppress its echo. */
  const runBurst = (): void => {
    if (disposed) return;
    burstQueued = false;
    const side = pendingSide;
    pendingSide = null;
    // Unreachable while the queue bookkeeping holds (a queued burst always
    // carries its side); kept as the explicit invariant guard.
    if (side === null) return;
    const source = halves[side].read();
    const target = halves[otherSide(side)].read();
    // An unreadable half (torn read, absent window) cannot drive a position.
    if (source === null || target === null) return;
    const mapped = computeSyncTarget(source, target);
    // A zero-range half cannot carry a position — nothing to apply, nothing to suppress.
    if (mapped === null) return;
    const receiving = otherSide(side);
    halves[receiving].apply(mapped);
    suppressed[receiving] = true;
    const epoch = ++appliedEpoch;
    // Two frames: the echo's scroll steps run before the first frame's
    // callbacks; the second covers engine ordering variance.
    clock.nextFrame(() => {
      clock.nextFrame(() => {
        if (!disposed && epoch === appliedEpoch) suppressed[receiving] = false;
      });
    });
  };

  return {
    onScroll(side: CompareSide): void {
      if (disposed || suppressed[side]) return;
      pendingSide = side;
      if (burstQueued) return;
      burstQueued = true;
      clock.nextFrame(runBurst);
    },
    dispose(): void {
      disposed = true;
    }
  };
}
