/**
 * The detail share store: `null` for fresh, removed and corrupt values,
 * round trips under the local area key, reset by removal, the writer's guard.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  PANEL_DETAIL_SHARE_KEY,
  parseDetailShare,
  readDetailShare,
  writeDetailShare
} from './panel-detail-share';

/** The bare key under the local area. */
const LOCAL_KEY = PANEL_DETAIL_SHARE_KEY.replace(/^local:/, '');

beforeEach(() => {
  fakeBrowser.reset();
});

describe('parseDetailShare', () => {
  it('trusts shares in (0, 1) and degrades anything else to null', () => {
    for (const share of [0.01, 0.5, 0.99]) expect(parseDetailShare(share)).toBe(share);
    for (const corrupt of [null, undefined, 0, 1, -0.3, 1.2, Number.NaN, '0.5', {}, [0.5], true]) {
      expect(parseDetailShare(corrupt)).toBeNull();
    }
  });
});

describe('readDetailShare / writeDetailShare', () => {
  it('reads null on a fresh install', async () => {
    expect(await readDetailShare()).toBeNull();
  });

  it('round-trips a share under the local area key only', async () => {
    await writeDetailShare(0.62);
    expect(await readDetailShare()).toBe(0.62);
    expect(await fakeBrowser.storage.local.get(LOCAL_KEY)).toEqual({ [LOCAL_KEY]: 0.62 });
    expect(await fakeBrowser.storage.sync.get(LOCAL_KEY)).toEqual({});
  });

  it('removes the key on null (reset to the default)', async () => {
    await writeDetailShare(0.4);
    await writeDetailShare(null);
    expect(await fakeBrowser.storage.local.get(LOCAL_KEY)).toEqual({});
    expect(await readDetailShare()).toBeNull();
  });

  it('reads corrupt storage as null', async () => {
    await fakeBrowser.storage.local.set({ [LOCAL_KEY]: 'wide' });
    expect(await readDetailShare()).toBeNull();
    await fakeBrowser.storage.local.set({ [LOCAL_KEY]: 4 });
    expect(await readDetailShare()).toBeNull();
  });

  it('refuses a share outside (0, 1) without writing', async () => {
    for (const bad of [0, 1, -1, Number.NaN]) {
      await expect(writeDetailShare(bad)).rejects.toThrow(RangeError);
    }
    expect(await fakeBrowser.storage.local.get(LOCAL_KEY)).toEqual({});
  });
});
