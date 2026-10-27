/**
 * The on-page UI gate: default-on reads (fresh, removed, corrupt), the
 * validator's boolean-only trust, write round trips, and the validated
 * watch (corrupt writes and removals reach followers as the default).
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PAGE_UI_GATE_DEFAULT,
  PAGE_UI_GATE_KEY,
  pageUiGateStore,
  parsePageUiGate,
  readPageUiEnabled,
  setPageUiGate,
  watchPageUiGate
} from './page-ui-gate';

/** The bare key under the sync area (the store key minus its area prefix). */
const SYNC_KEY = PAGE_UI_GATE_KEY.replace(/^sync:/, '');

beforeEach(() => {
  fakeBrowser.reset();
});

describe('parsePageUiGate', () => {
  it('trusts real booleans only', () => {
    expect(parsePageUiGate(true)).toBe(true);
    expect(parsePageUiGate(false)).toBe(false);
  });

  it('degrades every non-boolean to the default (on)', () => {
    expect(PAGE_UI_GATE_DEFAULT).toBe(true);
    for (const corrupt of [null, undefined, 0, 1, 'false', 'true', [], {}, { enabled: false }]) {
      expect(parsePageUiGate(corrupt)).toBe(true);
    }
  });
});

describe('readPageUiEnabled / setPageUiGate', () => {
  it('reads on for a fresh install', async () => {
    expect(await readPageUiEnabled()).toBe(true);
  });

  it('round-trips both states', async () => {
    await setPageUiGate(false);
    expect(await readPageUiEnabled()).toBe(false);
    await setPageUiGate(true);
    expect(await readPageUiEnabled()).toBe(true);
  });

  it('writes under the sync area key', async () => {
    await setPageUiGate(false);
    expect(await fakeBrowser.storage.sync.get(SYNC_KEY)).toEqual({ [SYNC_KEY]: false });
  });

  it('reads corrupt storage as on, never as off', async () => {
    for (const corrupt of ['false', 0, null, { enabled: false }]) {
      await fakeBrowser.storage.sync.set({ [SYNC_KEY]: corrupt });
      expect(await readPageUiEnabled()).toBe(true);
    }
  });

  it('reads a removed key as on', async () => {
    await setPageUiGate(false);
    await pageUiGateStore.removeValue();
    expect(await readPageUiEnabled()).toBe(true);
  });
});

describe('watchPageUiGate', () => {
  it('delivers each validated write and stops after unsubscribe', async () => {
    const onChange = vi.fn<(enabled: boolean) => void>();
    const unwatch = watchPageUiGate(onChange);
    await setPageUiGate(false);
    await setPageUiGate(true);
    expect(onChange.mock.calls).toEqual([[false], [true]]);
    unwatch();
    unwatch(); // idempotent
    await setPageUiGate(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('delivers corrupt writes and removals as the default', async () => {
    await setPageUiGate(false);
    const onChange = vi.fn<(enabled: boolean) => void>();
    const unwatch = watchPageUiGate(onChange);
    await fakeBrowser.storage.sync.set({ [SYNC_KEY]: 'off' });
    await setPageUiGate(false);
    await pageUiGateStore.removeValue();
    expect(onChange.mock.calls).toEqual([[true], [false], [true]]);
    unwatch();
  });
});
