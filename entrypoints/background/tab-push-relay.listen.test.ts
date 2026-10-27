/**
 * The production push listeners are registered all or none: a registration
 * that throws rolls back the ones already made, so a failed start never
 * leaves the background answering a push. The messenger is a double whose
 * Nth registration can be made to throw.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const messenger = vi.hoisted(() => ({
  /** The registration index that throws (-1: none). */
  failAt: -1,
  registered: [] as { type: string; remove: () => void }[]
}));

vi.mock('../../lib/messaging', () => ({
  onMessage: (type: string): (() => void) => {
    if (messenger.registered.length === messenger.failAt) {
      throw new Error(`cannot register ${type}`);
    }
    const remove = vi.fn();
    messenger.registered.push({ type, remove });
    return remove;
  }
}));

const { listenForTabPushes } = await import('./tab-push-relay');

afterEach(() => {
  messenger.failAt = -1;
  messenger.registered.length = 0;
});

describe('listenForTabPushes — all or none', () => {
  it('registers the three pushes and stops all three', () => {
    const stop = listenForTabPushes(vi.fn());
    expect(messenger.registered.map((entry) => entry.type)).toEqual([
      'notifyPanelReload',
      'allScriptsLoaded',
      'undefinedReferencesUpdated'
    ]);
    stop();
    for (const entry of messenger.registered)
      expect(entry.remove, entry.type).toHaveBeenCalledOnce();
    // A second stop removes nothing twice.
    stop();
    for (const entry of messenger.registered)
      expect(entry.remove, entry.type).toHaveBeenCalledOnce();
  });

  for (const failAt of [1, 2]) {
    it(`rolls back the registrations already made when registration ${String(failAt + 1)} throws`, () => {
      messenger.failAt = failAt;
      expect(() => listenForTabPushes(vi.fn())).toThrow(/cannot register/);
      expect(messenger.registered).toHaveLength(failAt);
      for (const entry of messenger.registered) {
        expect(entry.remove, entry.type).toHaveBeenCalledOnce();
      }
    });
  }

  it('a first registration that throws leaves nothing registered', () => {
    messenger.failAt = 0;
    expect(() => listenForTabPushes(vi.fn())).toThrow(/cannot register notifyPanelReload/);
    expect(messenger.registered).toEqual([]);
  });
});
