/**
 * Test-only stand-in for `./mount`'s `mountShadowUi`: each call parks until
 * the test settles it — exactly the awaited appearance read + render window
 * the shadow-surface lifecycle must survive. Faithful to the real mount where
 * the lifecycle depends on it: a render settled after its removal renders
 * nothing (the real mount re-checks the signal right before `render()`), and
 * a disposer empties the WHOLE container (Solid's `render` disposer does
 * `container.textContent = ''`). Suites install it with
 * `vi.mock('<path>/mount', () => import('<path>/deferred-mount.testing'))`
 * and drive {@link renders}; never imported by production code.
 */
import type { JSX } from 'solid-js';

/** One render a mount started: its removal signal and the hands to settle it. */
export interface PendingRender {
  readonly container: HTMLElement;
  readonly signal: AbortSignal | undefined;
  /**
   * Settle the render: a probe node + its disposer, or — when the mount was
   * removed by now — nothing rendered and a disposer that only counts.
   */
  resolve(): void;
  /** Fail the render with this cause. */
  reject(cause: unknown): void;
  /** How many times the tree's disposer ran. */
  disposals: number;
  /** Make the disposer throw after counting (a dead-context unwatch). */
  failDispose: boolean;
}

/** Every render started since the last {@link resetRenders}, in order. */
export const renders: PendingRender[] = [];

/** Forget the recorded renders (call in `beforeEach`). */
export function resetRenders(): void {
  renders.length = 0;
}

/**
 * The deferred mount (same signature as the real one).
 *
 * @param container The UI container.
 * @param _shadow The shadow root (unused: isolation is the real mount's).
 * @param _view The view (unused: a probe node stands in for it).
 * @param signal The mount's removal signal.
 * @returns The disposer, once the test resolves the render.
 */
export function mountShadowUi(
  container: HTMLElement,
  _shadow: ShadowRoot,
  _view: () => JSX.Element,
  signal?: AbortSignal
): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const pending: PendingRender = {
      container,
      signal,
      disposals: 0,
      failDispose: false,
      resolve: () => {
        const rendered = signal?.aborted !== true;
        if (rendered) {
          const node = document.createElement('p');
          node.className = 'probe-view';
          container.append(node);
        }
        resolve(() => {
          pending.disposals += 1;
          if (pending.failDispose) throw new Error('dispose exploded');
          // Solid's disposer clears the shared container, not just its own nodes.
          if (rendered) container.textContent = '';
        });
      },
      reject
    };
    renders.push(pending);
  });
}

/** Let pending promise callbacks and storage events run. */
export async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
