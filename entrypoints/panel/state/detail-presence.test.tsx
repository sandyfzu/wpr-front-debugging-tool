/**
 * The detail-presence store: closed by default, publish/clear, the
 * route-change reset (including a publish made during the new page's own
 * mount, and a round trip back to the route that had a detail open), and the
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
    store.setDetailOpen(true);
    store.setDetailOpen(true);
    expect(store.detailOpen()).toBe(true);
    store.setDetailOpen(false);
    store.setDetailOpen(false);
    expect(store.detailOpen()).toBe(false);
    dispose();
  });

  it('resets on a route change and stays reset on the way back', () => {
    const { store, go, dispose } = harness();
    store.setDetailOpen(true);
    go('javascript');
    expect(store.detailOpen()).toBe(false);
    go('detections');
    expect(store.detailOpen()).toBe(false);
    dispose();
  });

  it('reads false in the same flush as the route change, before any effect runs', () => {
    const { store, go, dispose } = harness();
    store.setDetailOpen(true);
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
    store.setDetailOpen(true);
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
      createEffect(() => {
        presence.setDetailOpen(open());
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
      createRenderEffect(
        on(
          route,
          (current) => {
            if (current === 'javascript') presence.setDetailOpen(true);
          },
          { defer: true }
        )
      );
    });
    store.setDetailOpen(true);
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
    store.setDetailOpen(true);
    store.setDetailOpen(true);
    expect(runs).toBe(2);
    go('stylesheets');
    expect(runs).toBe(3);
    dispose();
  });

  it('gives every factory call its own state (nothing module-level)', () => {
    const first = harness();
    first.store.setDetailOpen(true);
    const second = harness();
    expect(second.store.detailOpen()).toBe(false);
    expect(first.store.detailOpen()).toBe(true);
    first.dispose();
    second.dispose();
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
