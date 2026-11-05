/** The tester configuration store: defaults, round trips, tolerant reads, strict writes, watch. */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RUCSS_TESTER_CONFIG,
  RUCSS_CONFIG_LIMITS,
  type RucssTesterConfig
} from '../rucss-tester/config';
import {
  RUCSS_TESTER_CONFIG_KEY,
  getRucssTesterConfig,
  setRucssTesterConfig,
  watchRucssTesterConfig
} from './rucss-tester-config';

/** The bare key under the local area. */
const LOCAL_KEY = RUCSS_TESTER_CONFIG_KEY.replace(/^local:/, '');

/** A valid non-default configuration. */
const CONFIG: RucssTesterConfig = {
  ...DEFAULT_RUCSS_TESTER_CONFIG,
  safelist: '.a',
  replacements: [{ search: 'x', replacement: 'y' }],
  mobile: true
};

beforeEach(() => {
  fakeBrowser.reset();
});

describe('rucss tester config store', () => {
  it('lives under local:rucss-tester-config', () => {
    expect(RUCSS_TESTER_CONFIG_KEY).toBe('local:rucss-tester-config');
  });

  it('reads the defaults on a fresh install', async () => {
    expect(await getRucssTesterConfig()).toEqual(DEFAULT_RUCSS_TESTER_CONFIG);
  });

  it('round-trips a configuration under the local area', async () => {
    await setRucssTesterConfig(CONFIG);
    expect(await getRucssTesterConfig()).toEqual(CONFIG);
    expect(await fakeBrowser.storage.local.get(LOCAL_KEY)).toEqual({ [LOCAL_KEY]: CONFIG });
  });

  it('reads a corrupt stored value field by field', async () => {
    await fakeBrowser.storage.local.set({ [LOCAL_KEY]: { ...CONFIG, mobile: 'yes', extra: 1 } });
    expect(await getRucssTesterConfig()).toEqual({ ...CONFIG, mobile: false });
    await fakeBrowser.storage.local.set({ [LOCAL_KEY]: 'junk' });
    expect(await getRucssTesterConfig()).toEqual(DEFAULT_RUCSS_TESTER_CONFIG);
  });

  it('refuses an invalid write, naming the field, and keeps the stored value', async () => {
    await setRucssTesterConfig(CONFIG);
    const broken = { ...CONFIG, home: 'no' } as unknown as RucssTesterConfig;
    await expect(setRucssTesterConfig(broken)).rejects.toThrow(
      new RangeError('Invalid RUCSS tester configuration: home must be a boolean')
    );
    expect(await getRucssTesterConfig()).toEqual(CONFIG);
  });

  it('refuses a write over the byte budget, naming the cause, and keeps the stored value', async () => {
    await setRucssTesterConfig(CONFIG);
    // Each control character is 6 bytes of stored JSON: two capped CSS fields pass 1 MiB.
    const escaped = '\u0001'.repeat(RUCSS_CONFIG_LIMITS.cssChars);
    await expect(
      setRucssTesterConfig({ ...CONFIG, prepend: escaped, append: escaped })
    ).rejects.toThrow(/^Invalid RUCSS tester configuration: .* over the 1048576-byte budget$/);
    expect(await getRucssTesterConfig()).toEqual(CONFIG);
  });

  it('validates and stores one snapshot: an accessor is read once', async () => {
    let reads = 0;
    // Small on the first read, over the field cap on any later one.
    const shifty = {
      ...CONFIG,
      get prepend(): string {
        reads += 1;
        return reads === 1 ? 'a{}' : 'x'.repeat(RUCSS_CONFIG_LIMITS.cssChars + 1);
      }
    };
    await setRucssTesterConfig(shifty);
    expect(reads).toBe(1);
    expect(await getRucssTesterConfig()).toEqual({ ...CONFIG, prepend: 'a{}' });
  });

  it('refuses a value that is not plain data, keeping the stored value', async () => {
    await setRucssTesterConfig(CONFIG);
    const withFunction = { ...CONFIG, mobile: () => true } as unknown as RucssTesterConfig;
    await expect(setRucssTesterConfig(withFunction)).rejects.toThrow(
      new RangeError('Invalid RUCSS tester configuration: not plain data')
    );
    const proxied = new Proxy(CONFIG, {});
    await expect(setRucssTesterConfig(proxied)).rejects.toThrow(RangeError);
    expect(await getRucssTesterConfig()).toEqual(CONFIG);
  });

  it('delivers validated values to watchers, and stops after unsubscribe', async () => {
    const seen = vi.fn<(config: RucssTesterConfig) => void>();
    const stop = watchRucssTesterConfig(seen);
    await setRucssTesterConfig(CONFIG);
    await fakeBrowser.storage.local.set({ [LOCAL_KEY]: { ...CONFIG, safelist: 7 } });
    await fakeBrowser.storage.local.remove(LOCAL_KEY);
    await vi.waitFor(() => {
      expect(seen).toHaveBeenCalledTimes(3);
    });
    expect(seen.mock.calls.map(([config]) => config)).toEqual([
      CONFIG,
      { ...CONFIG, safelist: '' },
      DEFAULT_RUCSS_TESTER_CONFIG
    ]);
    stop();
    await setRucssTesterConfig(DEFAULT_RUCSS_TESTER_CONFIG);
    expect(seen).toHaveBeenCalledTimes(3);
  });
});
