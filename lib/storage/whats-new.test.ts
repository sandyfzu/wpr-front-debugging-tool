/**
 * The What's new stored values: the marker's raw round trip (absent reads
 * null; validation is the decision's job) and the synced setting's
 * default-on, validated read / write / watch.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseWhatsNewOnUpdate,
  readWhatsNewMarker,
  readWhatsNewOnUpdate,
  setWhatsNewOnUpdate,
  watchWhatsNewOnUpdate,
  WHATS_NEW_MARKER_KEY,
  WHATS_NEW_ON_UPDATE_DEFAULT,
  WHATS_NEW_ON_UPDATE_KEY,
  writeWhatsNewMarker
} from './whats-new';

const MARKER_KEY = WHATS_NEW_MARKER_KEY.replace(/^local:/, '');
const SETTING_KEY = WHATS_NEW_ON_UPDATE_KEY.replace(/^sync:/, '');

beforeEach(() => {
  fakeBrowser.reset();
});

describe('the marker', () => {
  it('lives in the device-local area', () => {
    expect(WHATS_NEW_MARKER_KEY.startsWith('local:')).toBe(true);
  });

  it('reads null when absent and round-trips a written version', async () => {
    expect(await readWhatsNewMarker()).toBeNull();
    await writeWhatsNewMarker('3.0.0');
    expect(await readWhatsNewMarker()).toBe('3.0.0');
    expect(await fakeBrowser.storage.local.get(MARKER_KEY)).toEqual({ [MARKER_KEY]: '3.0.0' });
  });

  it('hands a corrupt stored value back as is', async () => {
    await fakeBrowser.storage.local.set({ [MARKER_KEY]: { not: 'a version' } });
    expect(await readWhatsNewMarker()).toEqual({ not: 'a version' });
  });
});

describe('the setting', () => {
  it('is synced and default on', async () => {
    expect(WHATS_NEW_ON_UPDATE_KEY.startsWith('sync:')).toBe(true);
    expect(WHATS_NEW_ON_UPDATE_DEFAULT).toBe(true);
    expect(await readWhatsNewOnUpdate()).toBe(true);
  });

  it('trusts real booleans only', async () => {
    expect(parseWhatsNewOnUpdate(false)).toBe(false);
    for (const corrupt of [null, undefined, 0, 'false', {}, []]) {
      expect(parseWhatsNewOnUpdate(corrupt)).toBe(true);
    }
    await fakeBrowser.storage.sync.set({ [SETTING_KEY]: 'off' });
    expect(await readWhatsNewOnUpdate()).toBe(true);
  });

  it('round-trips writes and reaches followers validated', async () => {
    const seen = vi.fn<(enabled: boolean) => void>();
    const stop = watchWhatsNewOnUpdate(seen);
    await setWhatsNewOnUpdate(false);
    expect(await readWhatsNewOnUpdate()).toBe(false);
    await fakeBrowser.storage.sync.set({ [SETTING_KEY]: 7 });
    await vi.waitFor(() => {
      expect(seen.mock.calls).toEqual([[false], [true]]);
    });
    stop();
    await setWhatsNewOnUpdate(false);
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
