/**
 * The nav pin store: `auto` for fresh, removed and corrupt values, round
 * trips of every pin under the local area key, and the writer's guard.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { NAV_PINS, type NavPin } from '../panel/nav-mode';
import {
  PANEL_NAV_PIN_KEY,
  panelNavPinStore,
  parseNavPin,
  readNavPin,
  setNavPin
} from './panel-nav-pin';

/** The bare key under the local area. */
const LOCAL_KEY = PANEL_NAV_PIN_KEY.replace(/^local:/, '');

beforeEach(() => {
  fakeBrowser.reset();
});

describe('parseNavPin', () => {
  it('trusts the three pins and degrades anything else to auto', () => {
    for (const pin of NAV_PINS) expect(parseNavPin(pin)).toBe(pin);
    for (const corrupt of [null, undefined, '', 'RAIL', 1, true, {}, ['rail']]) {
      expect(parseNavPin(corrupt)).toBe('auto');
    }
  });
});

describe('readNavPin / setNavPin', () => {
  it('reads auto on a fresh install', async () => {
    expect(await readNavPin()).toBe('auto');
  });

  it('round-trips every pin under the local area key', async () => {
    for (const pin of NAV_PINS) {
      await setNavPin(pin);
      expect(await readNavPin()).toBe(pin);
      expect(await fakeBrowser.storage.local.get(LOCAL_KEY)).toEqual({ [LOCAL_KEY]: pin });
    }
    expect(await fakeBrowser.storage.sync.get(LOCAL_KEY)).toEqual({});
  });

  it('reads corrupt storage and a removed key as auto', async () => {
    await fakeBrowser.storage.local.set({ [LOCAL_KEY]: 'sideways' });
    expect(await readNavPin()).toBe('auto');
    await setNavPin('rail');
    await panelNavPinStore.removeValue();
    expect(await readNavPin()).toBe('auto');
  });

  it('refuses a value outside the vocabulary without writing', async () => {
    await expect(setNavPin('wide' as NavPin)).rejects.toThrow(TypeError);
    expect(await fakeBrowser.storage.local.get(LOCAL_KEY)).toEqual({});
  });
});
