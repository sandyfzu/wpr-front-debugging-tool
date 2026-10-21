import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  OVERLAY_PRESENTATIONS_KEY,
  OVERLAY_PRESENTATION_LIMIT,
  getOverlayPresentation,
  parseOverlayPresentations,
  removeOverlayPresentation,
  setOverlayPresentation
} from './overlay-presentations';

const RAW_KEY = OVERLAY_PRESENTATIONS_KEY.replace('session:', '');

beforeEach(() => {
  fakeBrowser.reset();
});

describe('overlay presentations store', () => {
  it('remembers and forgets a tab’s presentation', async () => {
    expect(await getOverlayPresentation(3)).toBeNull();
    await setOverlayPresentation(3, 'folded');
    await setOverlayPresentation(4, 'open');
    expect(await getOverlayPresentation(3)).toBe('folded');
    await setOverlayPresentation(3, 'open');
    expect(await getOverlayPresentation(3)).toBe('open');
    await removeOverlayPresentation(3);
    expect(await getOverlayPresentation(3)).toBeNull();
    expect(await getOverlayPresentation(4)).toBe('open');
  });

  it('keeps the most recently written tabs within the limit (write order, not tab id)', async () => {
    for (let tab = 0; tab < OVERLAY_PRESENTATION_LIMIT; tab++) {
      await setOverlayPresentation(tab, 'folded', 1_000);
    }
    // The audit proof: rewrite the lowest id, then add one tab past the limit.
    await setOverlayPresentation(0, 'open', 1_000);
    await setOverlayPresentation(OVERLAY_PRESENTATION_LIMIT, 'folded', 1_000);
    expect(await getOverlayPresentation(0)).toBe('open');
    expect(await getOverlayPresentation(1)).toBeNull();
    expect(await getOverlayPresentation(OVERLAY_PRESENTATION_LIMIT)).toBe('folded');
    const stored = (await fakeBrowser.storage.session.get(RAW_KEY))[RAW_KEY] as object;
    expect(Object.keys(stored)).toHaveLength(OVERLAY_PRESENTATION_LIMIT);
  });

  it('reads a corrupt store tolerantly (junk dropped, never trusted)', async () => {
    await fakeBrowser.storage.session.set({
      [RAW_KEY]: {
        '5': 'folded',
        '9': { presentation: 'open', at: 3 },
        '06': 'open',
        x: 'open',
        '7': 'closed',
        '8': 1,
        '10': { presentation: 'open', at: -1 },
        '11': { presentation: 'x', at: 1 }
      }
    });
    // A bare presentation is the earlier shape (oldest); entries carry their write order.
    expect(await getOverlayPresentation(5)).toBe('folded');
    expect(await getOverlayPresentation(9)).toBe('open');
    expect(await getOverlayPresentation(10)).toBeNull();
    expect(await getOverlayPresentation(11)).toBeNull();
    expect(await getOverlayPresentation(6)).toBeNull();
    expect(await getOverlayPresentation(7)).toBeNull();
    expect(parseOverlayPresentations(null)).toEqual({});
    expect(parseOverlayPresentations(['open'])).toEqual({});
  });

  it('refuses a junk tab id', async () => {
    await expect(setOverlayPresentation(-1, 'open')).rejects.toThrow(RangeError);
    expect(await getOverlayPresentation(-1)).toBeNull();
    await expect(removeOverlayPresentation(1.5)).resolves.toBeUndefined();
  });
});
