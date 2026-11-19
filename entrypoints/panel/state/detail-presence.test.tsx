/**
 * The detail-presence store: closed by default, publish/clear, the
 * route-change reset (including a publish made during the new page's own
 * mount, and a round trip back to the route that had a detail open), several
 * claims on one page (interleavings, release of one, route switch), and the
 * shell-only context hook.
 */
import { cleanup, render } from '@solidjs/testing-library';
import {
  batch,
  createEffect,
  createRenderEffect,
  createRoot,
  createSignal,
  on,
  type JSX
} from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import type { RouteId } from '../routes';
import {
  createDetailPresence,
  DetailPresenceContext,
  useDetailPresence,
  type DetailPresenceStore
} from './detail-presence';

afterEach(() => {
  cleanup();
});

/** A store over a controllable route, inside its own reactive root. */
interface Harness {
  readonly store: DetailPresenceStore;
  readonly go: (to: RouteId) => void;
  readonly dispose: () => void;
}

/**
 * Build a store over a route signal starting at `detections`.
 *
 * @param createProbe Optional setup run in the same root after the store (a
 *   publisher or a reader probe).
 */
function harness(
  createProbe?: (store: DetailPresenceStore, route: () => RouteId) => void
): Harness {
  return createRoot((dispose) => {
    const [route, setRoute] = createSignal<RouteId>('detections');
    const store = createDetailPresence(route);
    createProbe?.(store, route);
    return { store, go: (to) => setRoute(to), dispose };
  });
}

describe('createDetailPresence', () => {
  it('starts closed', () => {
    const { store, dispose } = harness();
    expect(store.detailOpen()).toBe(false);
    dispose();
  });

  it('opens and closes on the current route; repeats are idempotent', () => {
    const { store, dispose } = harness();
    const list = store.claim();
    list.set(true);
    list.set(true);
    expect(store.detailOpen()).toBe(true);
    list.set(false);
    list.set(false);
    expect(store.detailOpen()).toBe(false);
    dispose();
  });

  it('resets on a route change and stays reset on the way back', () => {
    const { store, go, dispose } = harness();
    const list = store.claim();
    list.set(true);
    go('javascript');
    expect(store.detailOpen()).toBe(false);
    go('detections');
    expect(store.detailOpen()).toBe(false);
    dispose();
  });

  it('reads false in the same flush as the route change, before any effect runs', () => {
    const { store, go, dispose } = harness();
    const list = store.claim();
    list.set(true);
    batch(() => {
      go('javascript');
      // Inside the batch no effect has run yet: the read must already be keyed
      // to the new route, not wait for the stale-record drop.
      expect(store.detailOpen()).toBe(false);
    });
    expect(store.detailOpen()).toBe(false);
    dispose();
  });

  it('never shows a render-phase reader a stale true for the new route', () => {
    const seen: [RouteId, boolean][] = [];
    const { store, go, dispose } = harness((presence, route) => {
      createRenderEffect(() => {
        seen.push([route(), presence.detailOpen()]);
      });
    });
    const list = store.claim();
    list.set(true);
    go('javascript');
    expect(seen).toEqual([
      ['detections', false],
      ['detections', true],
      ['javascript', false]
    ]);
    dispose();
  });

  it('does not subscribe a publishing effect to the route', () => {
    let runs = 0;
    const { store, go, dispose } = harness((presence) => {
      const [open] = createSignal(true);
      const list = presence.claim();
      createEffect(() => {
        list.set(open());
        runs += 1;
      });
    });
    expect(runs).toBe(1);
    expect(store.detailOpen()).toBe(true);
    go('javascript');
    go('stylesheets');
    // A route-subscribed publisher would re-run and re-publish onto the new page.
    expect(runs).toBe(1);
    expect(store.detailOpen()).toBe(false);
    dispose();
  });

  it('keeps a publish the new page makes while mounting (render phase)', () => {
    const { store, go, dispose } = harness((presence, route) => {
      // Render effects run before user effects: the earliest a page can write.
      const newPage = presence.claim();
      createRenderEffect(
        on(
          route,
          (current) => {
            if (current === 'javascript') newPage.set(true);
          },
          { defer: true }
        )
      );
    });
    store.claim().set(true);
    go('javascript');
    expect(store.detailOpen()).toBe(true);
    go('stylesheets');
    expect(store.detailOpen()).toBe(false);
    dispose();
  });

  it('notifies readers once per actual change', () => {
    let runs = 0;
    const { store, go, dispose } = harness((presence) => {
      createEffect(() => {
        presence.detailOpen();
        runs += 1;
      });
    });
    expect(runs).toBe(1);
    go('javascript');
    expect(runs).toBe(1);
    const list = store.claim();
    list.set(true);
    list.set(true);
    expect(runs).toBe(2);
    go('stylesheets');
    expect(runs).toBe(3);
    dispose();
  });

  it('gives every factory call its own state (nothing module-level)', () => {
    const first = harness();
    first.store.claim().set(true);
    const second = harness();
    expect(second.store.detailOpen()).toBe(false);
    expect(first.store.detailOpen()).toBe(true);
    first.dispose();
    second.dispose();
  });
});

describe('several claims on one page', () => {
  it('is open while any claim is open, in any open/close order', () => {
    const { store, dispose } = harness();
    const runtime = store.claim();
    const beacon = store.claim();
    runtime.set(true);
    beacon.set(true);
    runtime.set(false);
    // The other list still shows its detail: one closing never hides it.
    expect(store.detailOpen()).toBe(true);
    runtime.set(true);
    beacon.set(false);
    expect(store.detailOpen()).toBe(true);
    runtime.set(false);
    expect(store.detailOpen()).toBe(false);
    dispose();
  });

  it('a release removes only its own claim, for good', () => {
    const { store, dispose } = harness();
    const runtime = store.claim();
    const beacon = store.claim();
    runtime.set(true);
    beacon.set(true);
    runtime.release();
    expect(store.detailOpen()).toBe(true);
    // A write after release (an unmounted list) never counts again.
    runtime.set(true);
    beacon.set(false);
    expect(store.detailOpen()).toBe(false);
    runtime.release();
    beacon.release();
    expect(store.detailOpen()).toBe(false);
    dispose();
  });

  it('releasing the only open claim closes', () => {
    const { store, dispose } = harness();
    const list = store.claim();
    list.set(true);
    list.release();
    expect(store.detailOpen()).toBe(false);
    dispose();
  });

  it('a route switch closes every claim; none comes back, a fresh publish counts', () => {
    const { store, go, dispose } = harness();
    const runtime = store.claim();
    const beacon = store.claim();
    runtime.set(true);
    beacon.set(true);
    go('javascript');
    expect(store.detailOpen()).toBe(false);
    go('detections');
    expect(store.detailOpen()).toBe(false);
    beacon.set(true);
    expect(store.detailOpen()).toBe(true);
    runtime.set(false);
    expect(store.detailOpen()).toBe(true);
    dispose();
  });

  it('counts a new page’s claim beside a stale one the switch has not dropped yet', () => {
    const { store, go, dispose } = harness();
    const oldPage = store.claim();
    const newPage = store.claim();
    oldPage.set(true);
    batch(() => {
      go('javascript');
      newPage.set(true);
      // The old record is still there (no effect ran): it must not hide the new one.
      expect(store.detailOpen()).toBe(true);
    });
    expect(store.detailOpen()).toBe(true);
    newPage.set(false);
    expect(store.detailOpen()).toBe(false);
    dispose();
  });

  it('notifies readers only when the aggregate answer changes', () => {
    let runs = 0;
    const { store, dispose } = harness((presence) => {
      createEffect(() => {
        presence.detailOpen();
        runs += 1;
      });
    });
    const runtime = store.claim();
    const beacon = store.claim();
    runtime.set(true);
    expect(runs).toBe(2);
    beacon.set(true);
    runtime.set(false);
    runtime.release();
    expect(runs).toBe(2);
    beacon.release();
    expect(runs).toBe(3);
    dispose();
  });
});

describe('useDetailPresence', () => {
  it('throws outside the panel shell', () => {
    createRoot((dispose) => {
      expect(() => useDetailPresence()).toThrow('useDetailPresence() ran outside the panel shell.');
      dispose();
    });
  });

  it('returns the provided store', () => {
    const { store, dispose } = harness();
    let seen: DetailPresenceStore | undefined;
    /** Reads the hook where a page body would. */
    function Probe(): JSX.Element {
      seen = useDetailPresence();
      return null;
    }
    render(() => (
      <DetailPresenceContext.Provider value={store}>
        <Probe />
      </DetailPresenceContext.Provider>
    ));
    expect(seen).toBe(store);
    dispose();
  });
});
