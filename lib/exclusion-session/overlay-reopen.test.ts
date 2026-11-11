import { describe, expect, it, vi } from 'vitest';
import { EMPTY_EXCLUSION_SET } from '../exclusion-builder/set';
import type { ExclusionSessionStatus } from '../messaging/exclusion-session';
import {
  OVERLAY_STATUS_READ_ATTEMPTS,
  createOverlayReopener,
  restoreSessionOverlays,
  shouldReopenOverlay,
  type OverlayPresentation,
  type PresentationMemory
} from './overlay-reopen';
import { DeadlineExceededError } from './timeouts';

const ORIGIN = 'http://127.0.0.1:8493';

const ACTIVE: ExclusionSessionStatus = {
  state: 'active',
  origin: ORIGIN,
  set: EMPTY_EXCLUSION_SET,
  startedAt: 1,
  document: null
};

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

/** An in-memory presentation store (optionally failing). */
function memory(fail = false): PresentationMemory & { map: Map<number, OverlayPresentation> } {
  const map = new Map<number, OverlayPresentation>();
  const guard = (): Promise<void> =>
    fail ? Promise.reject(new Error('store down')) : Promise.resolve();
  return {
    map,
    get: async (tabId) => {
      await guard();
      return map.get(tabId) ?? null;
    },
    set: async (tabId, presentation) => {
      await guard();
      map.set(tabId, presentation);
    },
    remove: async (tabId) => {
      await guard();
      map.delete(tabId);
    }
  };
}

/** A re-opener over recording doubles. */
function rig(
  status: (tabId: number) => Promise<ExclusionSessionStatus>,
  options: { memory?: ReturnType<typeof memory>; reopen?: () => Promise<unknown> } = {}
) {
  const reopened: [number, OverlayPresentation, string][] = [];
  const log = { warn: vi.fn() };
  const presentations = options.memory ?? memory();
  const reopener = createOverlayReopener({
    status,
    reopen: (tabId, presentation, origin) => {
      reopened.push([tabId, presentation, origin]);
      return options.reopen?.() ?? Promise.resolve('reopened');
    },
    presentations,
    log
  });
  return { reopener, reopened, log, presentations };
}

describe('createOverlayReopener', () => {
  it('re-opens open by default on a session page, with the session origin, nothing elsewhere', async () => {
    const { reopener, reopened } = rig((tabId) =>
      Promise.resolve(tabId === 1 ? ACTIVE : { state: 'inactive' })
    );
    await reopener.pageLoaded(1, `${ORIGIN}/a`);
    await reopener.pageLoaded(2, `${ORIGIN}/a`);
    await reopener.pageLoaded(1, 'https://example.com/');
    expect(reopened).toEqual([[1, 'open', ORIGIN]]);
  });

  it('brings the overlay back the way the user left it, per tab (remembered in the store)', async () => {
    const { reopener, reopened, presentations } = rig(() => Promise.resolve(ACTIVE));
    await reopener.presented(1, false);
    await reopener.presented(2, true);
    expect(presentations.map.get(1)).toBe('folded');
    await reopener.pageLoaded(1, `${ORIGIN}/a`);
    await reopener.pageLoaded(2, `${ORIGIN}/a`);
    await reopener.presented(1, true);
    await reopener.pageLoaded(1, `${ORIGIN}/b`);
    expect(reopened.map(([tab, presentation]) => [tab, presentation])).toEqual([
      [1, 'folded'],
      [2, 'open'],
      [1, 'open']
    ]);
  });

  it('keeps the memory across a background restart (a new re-opener, the same store)', async () => {
    const store = memory();
    await rig(() => Promise.resolve(ACTIVE), { memory: store }).reopener.presented(1, false);
    const restarted = rig(() => Promise.resolve(ACTIVE), { memory: store });
    await restarted.reopener.pageLoaded(1, `${ORIGIN}/a`);
    expect(restarted.reopened[0]?.[1]).toBe('folded');
  });

  it('forgets a closed tab’s presentation', async () => {
    const { reopener, reopened } = rig(() => Promise.resolve(ACTIVE));
    await reopener.presented(1, false);
    await reopener.tabClosed(1);
    await reopener.pageLoaded(1, `${ORIGIN}/a`);
    expect(reopened[0]?.[1]).toBe('open');
  });

  it('drops a presentation push that lands after its tab closed', async () => {
    const { reopener, presentations } = rig(() => Promise.resolve(ACTIVE));
    await reopener.tabClosed(1);
    await reopener.presented(1, false);
    expect(presentations.map.has(1)).toBe(false);
  });

  it('coalesces load events of one tab: never two re-opens at once, one follow-up run', async () => {
    let release!: () => void;
    let running = 0;
    let most = 0;
    const { reopener, reopened } = rig(() => Promise.resolve(ACTIVE), {
      reopen: async () => {
        running += 1;
        most = Math.max(most, running);
        await new Promise<void>((resolve) => (release = resolve));
        running -= 1;
      }
    });
    await reopener.presented(1, false);
    // The race: a load plus SPA history moves right after it.
    const calls = [
      reopener.pageLoaded(1, `${ORIGIN}/x`),
      reopener.pageLoaded(1, `${ORIGIN}/x#y`),
      reopener.pageLoaded(1, `${ORIGIN}/z`)
    ];
    await vi.waitFor(() => {
      expect(reopened).toHaveLength(1);
    });
    release();
    await vi.waitFor(() => {
      expect(reopened).toHaveLength(2);
    });
    release();
    await Promise.all(calls);
    expect(most).toBe(1);
    // Two runs for three events (the follow-up asks once more, with the
    // latest URL); the page's slot makes a run that finds an overlay a no-op.
    expect(reopened.map(([, presentation]) => presentation)).toEqual(['folded', 'folded']);
  });

  it('runs again for a later load once the earlier run settled', async () => {
    const { reopener, reopened } = rig(() => Promise.resolve(ACTIVE));
    await reopener.pageLoaded(1, `${ORIGIN}/a`);
    await reopener.pageLoaded(1, `${ORIGIN}/b`);
    expect(reopened).toHaveLength(2);
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

  it('asks again when the status read missed a deadline: the applied page still gets its overlay', async () => {
    // The loaded page's one load event: a status read that missed its store
    // or queue deadline (a loaded machine) must not lose the re-open.
    let asks = 0;
    const { reopener, reopened, log } = rig(() => {
      asks += 1;
      return asks === 1
        ? Promise.reject(new DeadlineExceededError('Session read', 500))
        : Promise.resolve(ACTIVE);
    });
    await reopener.pageLoaded(1, `${ORIGIN}/a`);
    expect(asks).toBe(2);
    expect(reopened).toEqual([[1, 'open', ORIGIN]]);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('gives up, logged, once every attempt missed its deadline', async () => {
    // The status answers on the next ask: an uncapped retry would re-open.
    let asks = 0;
    const { reopener, reopened, log } = rig(() => {
      asks += 1;
      return asks <= OVERLAY_STATUS_READ_ATTEMPTS
        ? Promise.reject(new DeadlineExceededError('tabStatus queue wait', 500))
        : Promise.resolve(ACTIVE);
    });
    await expect(reopener.pageLoaded(1, `${ORIGIN}/a`)).resolves.toBeUndefined();
    expect(asks).toBe(OVERLAY_STATUS_READ_ATTEMPTS);
    expect(reopened).toEqual([]);
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not be read'),
      expect.objectContaining({ tabId: 1, attempts: OVERLAY_STATUS_READ_ATTEMPTS })
    );
  });

  it('never asks again after a failure that is no missed deadline', async () => {
    let asks = 0;
    const { reopener, reopened } = rig(() => {
      asks += 1;
      return Promise.reject(new Error('store down'));
    });
    await reopener.pageLoaded(1, `${ORIGIN}/a`);
    expect(asks).toBe(1);
    expect(reopened).toEqual([]);
  });

  it('re-reads after a missed deadline: a Stop that landed meanwhile opens nothing', async () => {
    const answers: (() => Promise<ExclusionSessionStatus>)[] = [
      () => Promise.reject(new DeadlineExceededError('Session read', 500)),
      () => Promise.resolve({ state: 'inactive' })
    ];
    const { reopener, reopened } = rig(() =>
      (answers.shift() ?? (() => Promise.resolve(ACTIVE)))()
    );
    await reopener.pageLoaded(1, `${ORIGIN}/a`);
    expect(reopened).toEqual([]);
  });

  it('degrades a failing presentation store to the open panel, logged, never rejecting', async () => {
    const { reopener, reopened, log } = rig(() => Promise.resolve(ACTIVE), {
      memory: memory(true)
    });
    await expect(reopener.presented(1, false)).resolves.toBeUndefined();
    await reopener.pageLoaded(1, `${ORIGIN}/a`);
    await expect(reopener.tabClosed(1)).resolves.toBeUndefined();
    expect(reopened[0]?.[1]).toBe('open');
    expect(log.warn).toHaveBeenCalledTimes(3);
  });
});

describe('restoreSessionOverlays', () => {
  /** Recording deps over the given records and tab URLs. */
  function deps(
    records: () => Promise<Record<string, { state: string }>>,
    urls: Record<number, string>
  ) {
    const pageLoaded = vi.fn<(tabId: number, url: string | undefined) => Promise<void>>(() =>
      Promise.resolve()
    );
    const warn = vi.fn();
    return {
      pageLoaded,
      warn,
      value: {
        records,
        tabUrl: (tabId: number) => {
          const url = urls[tabId];
          return url === undefined ? Promise.reject(new Error('No tab')) : Promise.resolve(url);
        },
        reopener: { pageLoaded },
        log: { warn }
      }
    };
  }

  it('re-runs the page-load re-open for every active session tab only', async () => {
    const d = deps(
      () =>
        Promise.resolve({
          '3': { state: 'active' },
          '4': { state: 'unavailable' },
          '5': { state: 'active' }
        }),
      { 3: 'https://a.test/', 5: 'https://b.test/x' }
    );
    await restoreSessionOverlays(d.value);
    expect(d.pageLoaded.mock.calls).toEqual([
      [3, 'https://a.test/'],
      [5, 'https://b.test/x']
    ]);
  });

  it('skips a closed tab and a malformed key, warning for the closed tab', async () => {
    const d = deps(
      () => Promise.resolve({ '7': { state: 'active' }, 'x': { state: 'active' } }),
      {}
    );
    await restoreSessionOverlays(d.value);
    expect(d.pageLoaded).not.toHaveBeenCalled();
    expect(d.warn).toHaveBeenCalledTimes(1);
  });

  it('never rejects on an unreadable session store', async () => {
    const d = deps(() => Promise.reject(new Error('storage down')), {});
    await expect(restoreSessionOverlays(d.value)).resolves.toBeUndefined();
    expect(d.warn).toHaveBeenCalledTimes(1);
  });
});
