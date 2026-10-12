/**
 * The size gate's latch, mounted the way the overlay component mounts this
 * creation inside its component root: the composition in front of the `src`
 * bindings stays deterministic across engines. The latch's flush-dependent
 * contract (the first open moment locking it permanently through squeezed
 * fits) rides the browser tier — the unit vitest resolves the solid
 * server build, whose write flushing differs from the real engine's — that
 * tier's pin is the latched-src squeeze row in
 * `tests/e2e/suites/site-side-by-side.spec.ts`.
 */
import { createRoot, createSignal, type Accessor } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createSizeGateLatch } from './gate-latch';

/**
 * Mount the latch over the given live gate, exactly the component's mount
 * (an owned root the engine evaluates at creation), with the dispose handed
 * out for the row's end.
 *
 * @param live The gate's live availability.
 * @returns The satisfied reader plus the root's dispose.
 */
function mount(live: Accessor<boolean>): { read: () => boolean; dispose: () => void } {
  let read!: () => boolean;
  let done!: () => void;
  createRoot((dispose) => {
    done = dispose;
    // The hand-off mirrors ui.tsx's: the helper owns the tracked scope.

    read = createSizeGateLatch(live);
  });
  return { read, dispose: done };
}

describe('createSizeGateLatch', () => {
  it('passes a gate that reads open at mount straight through — the first commit is the real load', () => {
    const [live] = createSignal(true);
    // eslint-disable-next-line solid/reactivity -- the latch owns the tracked scope (its mount-time effect)
    const { read, dispose } = mount(live);
    expect(read()).toBe(true);
    dispose();
  });

  it('a gate that never opened keeps the halves src-less at mount', () => {
    const [live] = createSignal(false);
    // eslint-disable-next-line solid/reactivity -- the latch owns the tracked scope (its mount-time effect)
    const { read, dispose } = mount(live);
    expect(read()).toBe(false);
    dispose();
  });
});
