/**
 * The background entrypoint's wiring, pinned where a missing line would
 * otherwise pass every subsystem's own tests: the toolbar click registers
 * once, with its production defaults, in `main()`'s first synchronous turn
 * (a click that wakes the worker must find the listener). Every subsystem
 * is a double; only the wiring runs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./toolbar-click', () => ({ registerToolbarClick: vi.fn() }));
vi.mock('./badge', () => ({
  initBadge: vi.fn(() => ({})),
  createDisabledBadgeRuntime: vi.fn(() => ({})),
  watchBadgeGate: vi.fn(() => Promise.resolve())
}));
vi.mock('./device-simulation', () => ({
  initDeviceSimSessions: vi.fn(() => ({ sweep: () => Promise.resolve() })),
  createDisabledDeviceSimSessions: vi.fn()
}));
vi.mock('./known-conflicts', () => ({
  registerKnownConflictsService: vi.fn(() => ({
    prime: () => Promise.resolve(),
    refreshNow: () => Promise.resolve(null)
  }))
}));
vi.mock('./latest-exclusion-list', () => ({
  registerLatestExclusionList: vi.fn(() => ({ prime: () => Promise.resolve() }))
}));
vi.mock('./headers', () => ({ initHeaderCapture: vi.fn() }));
vi.mock('./context-menus', () => ({ registerContextMenus: vi.fn() }));
vi.mock('./exclusion-sessions', () => ({ initExclusionSessions: vi.fn() }));
vi.mock('./tab-push-relay', () => ({ registerTabPushRelay: vi.fn() }));
vi.mock('./tab-relay', () => ({ registerTabRelay: vi.fn() }));
vi.mock('./chord-platform', () => ({ registerChordPlatform: vi.fn() }));
vi.mock('./command-palette', () => ({ registerCommandPalette: vi.fn() }));
vi.mock('./rucss-fetch', () => ({ registerRucssFetch: vi.fn() }));
vi.mock('./beacon-runner-load', () => ({ registerBeaconRunnerLoad: vi.fn() }));
vi.mock('./data-consent', () => ({
  registerDataConsent: vi.fn(),
  backgroundConsentCheck: vi.fn()
}));

const { registerToolbarClick } = await import('./toolbar-click');
const { watchBadgeGate } = await import('./badge');
const background = (await import('./index')).default;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('background wiring', () => {
  it('registers the toolbar click once, with its defaults, before any boot await', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    background.main();
    // Synchronous: no await has run yet in `main()`.
    expect(registerToolbarClick).toHaveBeenCalledExactlyOnceWith();
    // The rest of the boot completes without a wiring failure.
    await vi.waitFor(() => {
      expect(watchBadgeGate).toHaveBeenCalledOnce();
    });
    expect(error).not.toHaveBeenCalled();
  });
});
