/**
 * The size gate's latch: the live gate guards the first load (each half
 * navigates once, at the device size, under the rule the open established)
 * and the view holds it unlocked from the moment the gate reads open. In
 * auto the live gate is true at mount, so the halves' first `src` commit is
 * the real load; in phone the fits arrive late and release it. Either way
 * the gate can never re-lock afterwards: a later squeezed measurement must
 * not strip a loaded frame's `src` — that removal really blanks the frame
 * (verified live: an attribute removal turns a loaded document into
 * `about:blank`) and the next non-null fit would re-navigate it, a full
 * reload born from a layout transient. Rescale happens live through the
 * rescaler instead; navigation belongs to the first load and to the
 * machine's own state changes.
 */
import type { Accessor } from 'solid-js';
import { createEffect, createMemo, createSignal } from 'solid-js';

/**
 * The memo backing the overlay's `src` bindings: the live gate's first open
 * moment latches it permanently true. Deliberately not a one-way `once`
 * wrapper on the challenge above: same outcome, three Solid atoms, testable.
 *
 * @param liveOpen The gate's live availability per presentation and fits.
 * @returns Whether the halves may carry their URLs — monotone: once true, never false again.
 */
export function createSizeGateLatch(liveOpen: Accessor<boolean>): () => boolean {
  const [unlockedOnce, unlockFirstLoad] = createSignal(false);
  createEffect(() => {
    if (liveOpen()) unlockFirstLoad(true);
  });
  return createMemo(() => unlockedOnce() || liveOpen());
}
