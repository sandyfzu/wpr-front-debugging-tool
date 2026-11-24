/**
 * The What's new glue: the tab opens in the chosen window (a new window
 * when none is usable, after a bounded wait for the browser's first one),
 * the address carries the decision's floor, and the registered
 * `onInstalled` listener plus the
 * start check drive the real storage — an update opens one tab, an install
 * none, a repeated event none.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WHATS_NEW_PAGE_PATH } from '../../lib/release-notes/page-path';
import { readWhatsNewMarker, setWhatsNewOnUpdate } from '../../lib/storage/whats-new';
import type { WindowFacts } from '../../lib/release-notes/target-window';
import { openWhatsNewTab, registerWhatsNew, type WhatsNewTabApi } from './whats-new';

/** A tab API double over fixed windows. */
function tabApi(
  lastFocused: WindowFacts | null,
  all: readonly WindowFacts[] = [],
  created: WindowFacts | null = null
): {
  api: WhatsNewTabApi;
  createTab: ReturnType<typeof vi.fn<(url: string, windowId: number) => Promise<unknown>>>;
  createWindow: ReturnType<typeof vi.fn<(url: string) => Promise<unknown>>>;
  getAllNormal: ReturnType<typeof vi.fn<() => Promise<readonly WindowFacts[]>>>;
  waitForWindow: ReturnType<typeof vi.fn<(timeoutMs: number) => Promise<WindowFacts | null>>>;
} {
  const createTab = vi.fn<(url: string, windowId: number) => Promise<unknown>>(() =>
    Promise.resolve({})
  );
  const createWindow = vi.fn<(url: string) => Promise<unknown>>(() => Promise.resolve({}));
  const getAllNormal = vi.fn<() => Promise<readonly WindowFacts[]>>(() => Promise.resolve(all));
  const waitForWindow = vi.fn<(timeoutMs: number) => Promise<WindowFacts | null>>(() =>
    Promise.resolve(created)
  );
  return {
    api: {
      getLastFocused: () =>
        lastFocused === null
          ? Promise.reject(new Error('No window'))
          : Promise.resolve(lastFocused),
      getAllNormal,
      waitForWindow,
      createTab,
      createWindow
    },
    createTab,
    createWindow,
    getAllNormal,
    waitForWindow
  };
}

const NORMAL: WindowFacts = { id: 3, type: 'normal', incognito: false, focused: true };
const URL = 'chrome-extension://id/whats-new.html';

beforeEach(() => {
  fakeBrowser.reset();
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openWhatsNewTab', () => {
  it('opens in the last-focused normal window without listing the others', async () => {
    const double = tabApi(NORMAL);
    await openWhatsNewTab(URL, double.api);
    expect(double.createTab).toHaveBeenCalledExactlyOnceWith(URL, 3);
    expect(double.getAllNormal).not.toHaveBeenCalled();
    expect(double.waitForWindow).not.toHaveBeenCalled();
  });

  it('falls back to another window when the last-focused one is private or missing', async () => {
    const privateWindow = tabApi({ ...NORMAL, incognito: true }, [
      { ...NORMAL, id: 9, focused: false }
    ]);
    await openWhatsNewTab(URL, privateWindow.api);
    expect(privateWindow.createTab).toHaveBeenCalledExactlyOnceWith(URL, 9);

    expect(privateWindow.waitForWindow).not.toHaveBeenCalled();
  });

  it('with no window yet, opens in the first one the browser creates', async () => {
    const startup = tabApi(null, [], { ...NORMAL, id: 11 });
    await openWhatsNewTab(URL, startup.api);
    expect(startup.waitForWindow).toHaveBeenCalledExactlyOnceWith(3_000);
    expect(startup.createTab).toHaveBeenCalledExactlyOnceWith(URL, 11);
    expect(startup.createWindow).not.toHaveBeenCalled();
  });

  it('lists once more after the wait, then creates a window only when still none', async () => {
    const none = tabApi(null, []);
    await openWhatsNewTab(URL, none.api);
    expect(none.waitForWindow).toHaveBeenCalledOnce();
    expect(none.getAllNormal).toHaveBeenCalledTimes(2);
    expect(none.createWindow).toHaveBeenCalledExactlyOnceWith(URL);
    expect(none.createTab).not.toHaveBeenCalled();

    const late = tabApi(null, []);
    late.getAllNormal.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...NORMAL, id: 12 }]);
    await openWhatsNewTab(URL, late.api);
    expect(late.createTab).toHaveBeenCalledExactlyOnceWith(URL, 12);
    expect(late.createWindow).not.toHaveBeenCalled();
  });

  it('rejects as the browser does (the announcer logs it)', async () => {
    const double = tabApi(NORMAL);
    double.createTab.mockRejectedValueOnce(new Error('refused'));
    await expect(openWhatsNewTab(URL, double.api)).rejects.toThrow('refused');
  });
});

describe('registerWhatsNew', () => {
  /** Register over a 3.0.0 manifest with a tab double. */
  function register(): {
    createTab: ReturnType<typeof tabApi>['createTab'];
    catchUp: () => Promise<void>;
  } {
    vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({
      manifest_version: 3,
      name: 'WPR Front Debugging Tool',
      version: '3.0.0'
    });
    vi.spyOn(fakeBrowser.runtime, 'getURL').mockImplementation(
      (path: string) => `chrome-extension://id${path}`
    );
    const double = tabApi(NORMAL);
    const { catchUp } = registerWhatsNew(double.api);
    return { createTab: double.createTab, catchUp };
  }

  it('opens the page once for an update, never again on a repeat or a restart', async () => {
    const { createTab, catchUp } = register();
    await catchUp();
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '2.2.5' });
    await vi.waitFor(() => {
      expect(createTab).toHaveBeenCalledOnce();
    });
    expect(createTab).toHaveBeenCalledWith(
      `chrome-extension://id${WHATS_NEW_PAGE_PATH}?since=2.2.5`,
      3
    );
    expect(await readWhatsNewMarker()).toBe('3.0.0');

    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '2.2.5' });
    await catchUp();
    expect(createTab).toHaveBeenCalledOnce();
  });

  it('seeds the marker silently on install', async () => {
    const { createTab } = register();
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    await vi.waitFor(async () => {
      expect(await readWhatsNewMarker()).toBe('3.0.0');
    });
    expect(createTab).not.toHaveBeenCalled();
  });

  it('honors the opt-out', async () => {
    await setWhatsNewOnUpdate(false);
    const { createTab } = register();
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '2.2.5' });
    await vi.waitFor(async () => {
      expect(await readWhatsNewMarker()).toBe('3.0.0');
    });
    expect(createTab).not.toHaveBeenCalled();
  });
});
