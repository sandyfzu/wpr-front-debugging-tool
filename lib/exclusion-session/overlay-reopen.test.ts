import { describe, expect, it, vi } from 'vitest';
import { EMPTY_EXCLUSION_SET } from '../exclusion-builder/set';
import type { ExclusionSessionStatus } from '../messaging/exclusion-session';
import {
  OVERLAY_PRESENTATION_GLOBAL,
  createOverlayReopener,
  shouldReopenOverlay,
  takeOverlayPresentation,
  type OverlayPresentation
} from './overlay-reopen';

const ORIGIN = 'http://127.0.0.1:8493';

const ACTIVE: ExclusionSessionStatus = {
  state: 'active',
  origin: ORIGIN,
  set: EMPTY_EXCLUSION_SET,
  startedAt: 1,
  document: null
};

describe('takeOverlayPresentation', () => {
  it('reads a left presentation once, then it is gone', () => {
    const scope: Record<string, unknown> = { [OVERLAY_PRESENTATION_GLOBAL]: 'folded' };
    expect(takeOverlayPresentation(scope)).toBe('folded');
    expect(OVERLAY_PRESENTATION_GLOBAL in scope).toBe(false);
    expect(takeOverlayPresentation(scope)).toBeNull();
  });

  it('answers null for nothing left or junk, removing the junk too', () => {
    expect(takeOverlayPresentation({})).toBeNull();
    for (const junk of ['OPEN', 'closed', 1, null, { open: true }]) {
      const scope: Record<string, unknown> = { [OVERLAY_PRESENTATION_GLOBAL]: junk };
      expect(takeOverlayPresentation(scope)).toBeNull();
      expect(OVERLAY_PRESENTATION_GLOBAL in scope).toBe(false);
    }
  });
});

describe('shouldReopenOverlay', () => {
  it('re-opens on a page of the active session’s origin', () => {
    expect(shouldReopenOverlay(ACTIVE, `${ORIGIN}/fdt/`)).toBe(true);
    expect(shouldReopenOverlay(ACTIVE, `${ORIGIN}/fdt/?x=1#h`)).toBe(true);
  });

  it('never re-opens on another origin of the tab (scheme and port count)', () => {
    expect(shouldReopenOverlay(ACTIVE, 'http://localhost:8493/fdt/')).toBe(false);
    expect(shouldReopenOverlay(ACTIVE, 'https://127.0.0.1:8493/')).toBe(false);
    expect(shouldReopenOverlay(ACTIVE, 'http://127.0.0.1:8494/')).toBe(false);
  });

  it('never re-opens without an active session, or without a usable URL', () => {
    expect(shouldReopenOverlay({ state: 'inactive' }, `${ORIGIN}/`)).toBe(false);
    expect(
      shouldReopenOverlay({ state: 'unavailable', cause: 'attach-denied', at: 1 }, `${ORIGIN}/`)
    ).toBe(false);
    expect(shouldReopenOverlay(ACTIVE, undefined)).toBe(false);
    expect(shouldReopenOverlay(ACTIVE, 'not a url')).toBe(false);
  });
});

/** A re-opener over recording doubles. */
function rig(status: (tabId: number) => Promise<ExclusionSessionStatus>) {
  const reopened: [number, OverlayPresentation][] = [];
  const log = { warn: vi.fn() };
  const reopener = createOverlayReopener({
    status,
    reopen: (tabId, presentation) => {
      reopened.push([tabId, presentation]);
      return Promise.resolve('injected');
    },
    log
  });
  return { reopener, reopened, log };
}

describe('createOverlayReopener', () => {
  it('re-opens open by default on a session page, nothing elsewhere', async () => {
    const { reopener, reopened } = rig((tabId) =>
      Promise.resolve(tabId === 1 ? ACTIVE : { state: 'inactive' })
    );
    await reopener.pageLoaded(1, `${ORIGIN}/a`);
    await reopener.pageLoaded(2, `${ORIGIN}/a`);
    await reopener.pageLoaded(1, 'https://example.com/');
    expect(reopened).toEqual([[1, 'open']]);
  });

  it('brings the overlay back the way the user left it, per tab', async () => {
    const { reopener, reopened } = rig(() => Promise.resolve(ACTIVE));
    reopener.presented(1, false);
    reopener.presented(2, true);
    await reopener.pageLoaded(1, `${ORIGIN}/a`);
    await reopener.pageLoaded(2, `${ORIGIN}/a`);
    reopener.presented(1, true);
    await reopener.pageLoaded(1, `${ORIGIN}/b`);
    expect(reopened).toEqual([
      [1, 'folded'],
      [2, 'open'],
      [1, 'open']
    ]);
  });

  it('forgets a closed tab’s presentation', async () => {
    const { reopener, reopened } = rig(() => Promise.resolve(ACTIVE));
    reopener.presented(1, false);
    reopener.tabClosed(1);
    await reopener.pageLoaded(1, `${ORIGIN}/a`);
    expect(reopened).toEqual([[1, 'open']]);
  });

  it('opens nothing and logs when the session cannot be read', async () => {
    const { reopener, reopened, log } = rig(() => Promise.reject(new Error('queue wait')));
    await expect(reopener.pageLoaded(1, `${ORIGIN}/a`)).resolves.toBeUndefined();
    expect(reopened).toEqual([]);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not be read'),
      expect.objectContaining({ tabId: 1 })
    );
  });
});
