/**
 * The runner: liveness follows its host, every start re-validates the
 * configuration (a refused one never reaches the beacon) and hands the
 * beacon fresh options; the extension liveness check reads the runtime id.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BEACON_TEST_DEFAULTS } from '../../lib/beacon-test/config';
import type { BeaconRunHandle } from '../../lib/beacon-test/runner-bridge';
import { createRunner, extensionAlive } from './index';

/** A settled handle the fake start returns. */
const HANDLE: BeaconRunHandle = {
  done: Promise.resolve({ kind: 'bailed', reason: 'screen-size' }),
  partial: () => null,
  cancel: () => undefined
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createRunner', () => {
  it('follows the host liveness', () => {
    let alive = true;
    const runner = createRunner({ alive: () => alive, document });
    expect(runner.alive()).toBe(true);
    alive = false;
    expect(runner.alive()).toBe(false);
  });

  it('starts a valid configuration with fresh beacon options', () => {
    const start = vi.fn(() => HANDLE);
    const runner = createRunner({ alive: () => true, document }, start);
    const config = { ...BEACON_TEST_DEFAULTS, features: { aboveTheFold: true, lazyRender: false } };
    expect(runner.start(config)).toBe(HANDLE);
    expect(start).toHaveBeenCalledWith({
      is_mobile: false,
      elements: 'img,video,picture,p,main,div,li,svg,section,header,span',
      width_threshold: 1600,
      height_threshold: 700,
      lrc_threshold: 1800,
      debug: true,
      status: { atf: true, lrc: false }
    });
  });

  it('refuses an invalid configuration without starting the beacon', async () => {
    const start = vi.fn(() => HANDLE);
    const runner = createRunner({ alive: () => true, document }, start);
    const handle = runner.start({
      ...BEACON_TEST_DEFAULTS,
      widthThreshold: 0,
      selectors: ['div[']
    });
    await expect(handle.done).resolves.toEqual({
      kind: 'failed',
      message: 'Invalid beacon test configuration (no-feature, threshold, selector-invalid)'
    });
    expect(handle.partial()).toBeNull();
    expect(() => {
      handle.cancel();
    }).not.toThrow();
    expect(start).not.toHaveBeenCalled();
  });
});

describe('extensionAlive', () => {
  it('is alive with a runtime id, dead without one or when the read throws', () => {
    expect(extensionAlive()).toBe(true);
    const id = vi.spyOn(browser.runtime, 'id', 'get');
    id.mockReturnValue(undefined as unknown as string);
    expect(extensionAlive()).toBe(false);
    id.mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });
    expect(extensionAlive()).toBe(false);
  });
});
