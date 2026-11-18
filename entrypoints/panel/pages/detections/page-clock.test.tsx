/**
 * The Detections page's clock lifecycle: one aging clock armed at mount
 * (the shell mounts page bodies only over loaded data) and stopped at
 * unmount — no ticking timer outlives the page.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataState } from '../../state/fdt-state-machine';
import { makeFdtData } from '../../state/fixtures';
import { createDetectionsLayout, DetectionsLayoutContext } from '../../state/detections-layout';
import { FdtDataContext, type FdtDataStore } from '../../state/use-fdt-data';

const clock = vi.hoisted(() => ({ setLoaded: vi.fn(), stop: vi.fn(), created: 0 }));

vi.mock('../../status-bar/aging-clock', () => ({
  realAgingClockDeps: () => ({}),
  createAgingClock: () => {
    clock.created += 1;
    return { now: () => 0, setLoaded: clock.setLoaded, stop: clock.stop };
  }
}));

const { DetectionsPage } = await import('./page');

afterEach(() => {
  cleanup();
});

describe('DetectionsPage clock', () => {
  it('arms one clock at mount and stops it at unmount', () => {
    const [state] = createSignal<DataState>({ status: 'ready', data: makeFdtData(), fetchedAt: 0 });
    const store: FdtDataStore = {
      state,
      start: vi.fn(),
      stop: vi.fn(),
      retry: vi.fn(),
      reload: vi.fn()
    };
    const view = render(() => (
      <FdtDataContext.Provider value={store}>
        <DetectionsLayoutContext.Provider value={createDetectionsLayout()}>
          <DetectionsPage />
        </DetectionsLayoutContext.Provider>
      </FdtDataContext.Provider>
    ));
    expect(clock.created).toBe(1);
    expect(clock.setLoaded).toHaveBeenCalledExactlyOnceWith(true);
    expect(clock.stop).not.toHaveBeenCalled();
    view.unmount();
    expect(clock.stop).toHaveBeenCalledTimes(1);
  });
});
