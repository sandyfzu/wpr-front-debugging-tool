/**
 * The background wiring over the fake browser: every session channel is
 * registered and answers through the real messenger, the registry holds
 * the Chromium row, the tab-close and update hooks reach the stores, and a
 * session tab's loaded page gets the overlay back.
 * The lifecycle itself is pinned in `lib/exclusion-session/controller.test.ts`.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { sendMessage } from '../../lib/messaging';
import { EMPTY_EXCLUSION_SET } from '../../lib/exclusion-builder/set';
import {
  getExclusionSessionRecords,
  putExclusionSessionRecord
} from '../../lib/storage/exclusion-sessions';
import {
  answerOverlayOpen,
  answerOverlayPresented,
  initExclusionSessions
} from './exclusion-sessions';
import {
  getSimulationMarkers,
  rememberSimulationMarker
} from '../../lib/storage/simulation-markers';
import { EXCLUSION_OVERLAY_SCRIPT } from './exclusion-overlay';
import { CHROMIUM_INTERCEPTION_ROW } from './chromium-interception';
import { INTERCEPTION_BACKENDS } from './interception-backends';

const WARNING = { state: 'unavailable', cause: 'detached', at: 1 } as const;

/** Let unawaited listener work settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeAll(() => {
  // The fake browser leaves the debugger events unimplemented; the Chromium
  // row's backend registers its listeners on them at creation.
  vi.spyOn(browser.debugger.onEvent, 'addListener').mockImplementation(() => {});
  vi.spyOn(browser.debugger.onDetach, 'addListener').mockImplementation(() => {});
  initExclusionSessions();
});

describe('exclusion-session wiring', () => {
  it('registers the Chromium debugger backend row in a Chromium build (run-time detected)', () => {
    expect(INTERCEPTION_BACKENDS).toContain(CHROMIUM_INTERCEPTION_ROW);
  });

  it('keeps the Firefox-only streaming-filter row out of a Chromium build', () => {
    // The test runner builds for Chromium.
    expect(INTERCEPTION_BACKENDS.map((row) => row.id)).not.toContain('stream-filter');
  });

  it('registers the streaming-filter row in a Firefox build', async () => {
    vi.stubEnv('BROWSER', 'firefox');
    vi.resetModules();
    try {
      const firefox = await import('./interception-backends');
      // …and only it: the debugger-protocol row stays out of the Firefox bundle.
      expect(firefox.INTERCEPTION_BACKENDS.map((row) => row.id)).toEqual(['stream-filter']);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('answers the overlay channels (a tab-less sender is no page)', async () => {
    await expect(
      sendMessage('applyExclusionSession', { set: EMPTY_EXCLUSION_SET })
    ).resolves.toEqual({
      outcome: 'unavailable',
      cause: 'unsupported-page'
    });
    await expect(sendMessage('stopExclusionSession')).resolves.toEqual({ state: 'inactive' });
    await expect(sendMessage('getExclusionSession')).resolves.toEqual({ state: 'inactive' });
    await expect(sendMessage('getSavedExclusionSet')).resolves.toEqual({ set: null });
    await expect(sendMessage('saveExclusionSet', { set: EMPTY_EXCLUSION_SET })).resolves.toEqual({
      outcome: 'not-saved',
      reason: 'unsupported-page'
    });
  });

  it('refuses the panel channel to a sender that is not this extension’s page, reaching the sender', async () => {
    // The fake runtime delivers an empty sender (no extension id).
    await expect(sendMessage('getExclusionSessionForTab', { tabId: 1 })).rejects.toThrow(
      /only extension pages/
    );
  });

  it('cleans a closed tab’s record', async () => {
    await putExclusionSessionRecord(7, WARNING);
    await fakeBrowser.tabs.onRemoved.trigger(7, { windowId: 1, isWindowClosing: false });
    await flush();
    await expect(getExclusionSessionRecords()).resolves.toEqual({});
  });

  it('refuses a marker verification from a sender that is no top-frame page, reaching the sender', async () => {
    await expect(
      sendMessage('verifySimulationMarker', { markerId: '0123456789abcdef0123456789abcdef' })
    ).rejects.toThrow(/top-frame page/);
  });

  it('forgets a closed tab’s simulation markers, other tabs kept', async () => {
    const entry = (markerId: string) => ({
      markerId,
      origin: 'https://site.test',
      features: ['delay_js'] as const
    });
    await rememberSimulationMarker(21, entry('a'.repeat(32)));
    await rememberSimulationMarker(22, entry('b'.repeat(32)));
    await fakeBrowser.tabs.onRemoved.trigger(21, { windowId: 1, isWindowClosing: false });
    await flush();
    await expect(getSimulationMarkers()).resolves.toEqual({ '22': [entry('b'.repeat(32))] });
  });

  it('forgets every simulation marker on an extension update, not on install', async () => {
    const entry = {
      markerId: 'c'.repeat(32),
      origin: 'https://site.test',
      features: ['delay_js'] as const
    };
    await rememberSimulationMarker(23, entry);
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    await flush();
    await expect(getSimulationMarkers()).resolves.toMatchObject({ '23': [entry] });
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '0.0.0' });
    await flush();
    await expect(getSimulationMarkers()).resolves.toEqual({});
  });

  it('clears every session on an extension update, not on install', async () => {
    await putExclusionSessionRecord(8, WARNING);
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    await flush();
    await expect(getExclusionSessionRecords()).resolves.toEqual({ '8': WARNING });
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '0.0.0' });
    await flush();
    await expect(getExclusionSessionRecords()).resolves.toEqual({});
  });

  it('answers the panel’s overlay open only for this extension’s tab-less pages', async () => {
    const open = vi.fn(() => Promise.resolve('injected' as const));
    const panel = { id: browser.runtime.id };
    await expect(answerOverlayOpen(panel, { tabId: 4 }, open)).resolves.toBe('injected');
    expect(open).toHaveBeenCalledWith(4);
    await expect(
      answerOverlayOpen({ id: browser.runtime.id, tab: { id: 4 } }, { tabId: 4 }, open)
    ).rejects.toThrow(/only extension pages/);
    await expect(answerOverlayOpen({ id: 'other' }, { tabId: 4 }, open)).rejects.toThrow(
      /only extension pages/
    );
    await expect(answerOverlayOpen(panel, { tabId: '4' }, open)).rejects.toThrow(/malformed/);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('refuses the open channel to the fake runtime’s anonymous sender, reaching the sender', async () => {
    await expect(sendMessage('openExclusionOverlay', { tabId: 1 })).rejects.toThrow(
      /only extension pages/
    );
  });

  it('acknowledges and drops a presentation push from a sender that is no page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(sendMessage('exclusionOverlayPresented', { open: false })).resolves.toBe(true);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('records a top-frame page’s presentation push for its tab, and drops a frame’s', () => {
    const presented = vi.fn(() => Promise.resolve());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const page = { tab: { id: 6 }, frameId: 0, url: 'https://example.com/a' };
      expect(answerOverlayPresented(page, { open: false }, { presented })).toBe(true);
      expect(presented).toHaveBeenCalledWith(6, false);
      expect(answerOverlayPresented({ ...page, frameId: 3 }, { open: true }, { presented })).toBe(
        false
      );
      expect(answerOverlayPresented(page, { open: 'yes' }, { presented })).toBe(false);
      expect(answerOverlayPresented(undefined, { open: true }, { presented })).toBe(false);
      expect(presented).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('re-opens the overlay when a session tab’s page of its origin finishes loading', async () => {
    const origin = 'http://127.0.0.1:8493';
    await putExclusionSessionRecord(11, {
      state: 'active',
      origin,
      set: EMPTY_EXCLUSION_SET,
      startedAt: 5,
      document: null
    });
    const calls: unknown[] = [];
    const execute = vi
      .spyOn(browser.scripting, 'executeScript')
      .mockImplementation((injection: unknown) => {
        calls.push(injection);
        // The slot probe answers "claimed: inject"; the file injection, nothing.
        return Promise.resolve([{ frameId: 0, documentId: 'd', result: 'inject' }]) as never;
      });
    try {
      const tab = { id: 11, url: `${origin}/fdt/` } as never;
      // Loading, then another origin, then no session: nothing re-opens.
      await fakeBrowser.tabs.onUpdated.trigger(11, { status: 'loading' }, tab);
      await fakeBrowser.tabs.onUpdated.trigger(11, { status: 'complete' }, {
        id: 11,
        url: 'https://example.com/'
      } as never);
      await fakeBrowser.tabs.onUpdated.trigger(12, { status: 'complete' }, tab);
      await flush();
      expect(calls).toEqual([]);
      await fakeBrowser.tabs.onUpdated.trigger(11, { status: 'complete' }, tab);
      await flush();
      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({
        target: { tabId: 11, frameIds: [0] },
        args: [expect.any(String), { mode: 'reopen', presentation: 'open', origin }]
      });
      expect(calls[1]).toEqual({
        target: { tabId: 11, frameIds: [0] },
        files: [EXCLUSION_OVERLAY_SCRIPT]
      });
    } finally {
      execute.mockRestore();
      await fakeBrowser.tabs.onRemoved.trigger(11, { windowId: 1, isWindowClosing: false });
      await flush();
    }
  });
});
