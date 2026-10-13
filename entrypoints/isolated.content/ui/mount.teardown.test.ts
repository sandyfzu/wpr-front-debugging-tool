/**
 * The mount's teardown contracts that need a controlled follow: a throwing
 * stop must not skip the view's disposal (and must not escape — the documented
 * WXT ordering makes this disposer run before the shadow-host cleanup), and a
 * failed render must unwind the subscription the mount armed — the documented
 * `@throws` behavior of `mountShadowUi`.
 */
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountShadowUi } from './mount';

const stopFollowing: () => void = vi.fn(() => {
  throw new Error('Extension context invalidated');
});

/**
 * The follow is mocked at the seam the mount composes over (the real one's
 * stop never throws except in a dead context, which happy-dom cannot produce):
 * apply nothing, hand back the throwing stop. The mount code stays untouched.
 */
vi.mock('./live-theme', (): Record<string, unknown> => ({
  followStoredAppearance: (): Promise<() => void> => Promise.resolve(stopFollowing)
}));

/**
 * The renderer is mocked at the exact boundary the mount composes over (same
 * rationale as `mount.test.ts`: vitest resolves `solid-js/web` to Solid's
 * server build) — a view node rendered into the container, disposer removes
 * it. The view factory may throw (the failure leg under test).
 */
vi.mock('solid-js/web', (): Record<string, unknown> => ({
  render: (view: () => JSX.Element, container: HTMLElement): (() => void) => {
    // The probe views return elements; a JSX.Element may carry primitives
    // per Solid's definition, so materialize as the child node the mock
    // mounts (`remove` lives on the ChildNode side of the DOM types).
    const node = view() as Node & ChildNode;
    container.append(node);
    return () => {
      node.remove();
    };
  }
}));

/** Probe view returning a detached element. */
function probeView(): JSX.Element {
  const el = document.createElement('div');
  el.className = 'teardown-probe';
  return el;
}

/** A view factory that explodes before anything renders. */
function explodingView(): JSX.Element {
  throw new Error('view factory exploded');
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  // Spies restored even when an assertion fails mid-test (no console leak
  // through worker reuse).
  vi.restoreAllMocks();
});

describe('mountShadowUi teardown contracts', () => {
  it('disposes the view first even when stopping the follow throws, without escaping', async () => {
    const container = document.createElement('div');
    const dispose = await mountShadowUi(container, probeView);
    expect(container.querySelector('.teardown-probe')).not.toBeNull();
    expect(() => {
      dispose();
    }).not.toThrow();
    // The view left the container (the real destructive order: view disposal
    // runs before the throwing stop, never skipped by it).
    expect(container.querySelector('.teardown-probe')).toBeNull();
    expect(stopFollowing).toHaveBeenCalledTimes(1);
  });

  it('swallows the dead-context stop with an actionable prefixed warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const container = document.createElement('div');
    const dispose = await mountShadowUi(container, probeView);
    expect(() => {
      dispose();
    }).not.toThrow();
    expect(String(warn.mock.calls[0]?.[0])).toContain('[WPR FDT]');
  });

  it('unwinds the armed follow when the render itself fails', async () => {
    const container = document.createElement('div');
    await expect(mountShadowUi(container, explodingView)).rejects.toThrow('view factory exploded');
    // The follow's stop ran exactly once: the failed mount left no subscription.
    expect(stopFollowing).toHaveBeenCalledTimes(1);
  });
});
