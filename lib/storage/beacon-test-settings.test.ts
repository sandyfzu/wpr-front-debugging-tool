/** The beacon test settings store: key, defaults, round trip, tolerant read, strict write. */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BEACON_TEST_SETTINGS, type BeaconTestSettings } from '../beacon-test/settings';
import {
  BEACON_TEST_SETTINGS_KEY,
  getBeaconTestSettings,
  setBeaconTestSettings
} from './beacon-test-settings';

const SETTINGS: BeaconTestSettings = {
  ...DEFAULT_BEACON_TEST_SETTINGS,
  aboveTheFold: true,
  widthThreshold: 'oops'
};

beforeEach(() => {
  fakeBrowser.reset();
});

describe('beacon test settings store', () => {
  it('lives under local:beacon-test-settings and reads the defaults fresh', async () => {
    expect(BEACON_TEST_SETTINGS_KEY).toBe('local:beacon-test-settings');
    expect(await getBeaconTestSettings()).toEqual(DEFAULT_BEACON_TEST_SETTINGS);
  });

  it('round-trips settings as typed (a run-invalid threshold included)', async () => {
    await setBeaconTestSettings(SETTINGS);
    expect(await getBeaconTestSettings()).toEqual(SETTINGS);
    expect(await fakeBrowser.storage.local.get('beacon-test-settings')).toEqual({
      'beacon-test-settings': SETTINGS
    });
  });

  it('reads a corrupt field as its default and refuses a wrong-typed write', async () => {
    await fakeBrowser.storage.local.set({ 'beacon-test-settings': { ...SETTINGS, mobile: 1 } });
    expect(await getBeaconTestSettings()).toEqual({ ...SETTINGS, mobile: false });
    await expect(
      setBeaconTestSettings({ ...SETTINGS, mobile: 'no' as unknown as boolean })
    ).rejects.toThrow(new RangeError('Invalid beacon test settings: mobile is not a boolean'));
  });
});
